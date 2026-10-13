import type {Env,Order,ProductClient,Store,Delivery,WorkQueue} from './types';
import {allowedReturn,money,requireThat} from './config';
import {sha256,hmacSha256,randomId} from './crypto';
import {checkoutToken} from './auth';
export interface Trade {
  outTradeNo: string; tradeNo: string; tradeStatus: string; totalAmount: string; sellerId?: string; paidAt?: string;
}
export interface Gateway {query(id:string):Promise<Trade|null>;verifyNotification(data:Record<string,string>):boolean;paymentUrl(order:{id:string;subject:string;totalAmount:string;expiresAt?:string},options:{channel:'page'|'wap';pageReturnUrl:string;notifyUrl:string}):string}
const orderPath = (id:string) => `orders/${id}.json`;
const eventId = (id:string) => `evt_${id}`;
const deliveryPath = (id:string) => `events/${id}.json`;
const emptyQueue = ():WorkQueue => ({orders:[],deliveries:[]});
export class Payments {
  constructor(public env:Env,public store:Store,public gateway:Gateway,public now:()=>number=Date.now,public send:typeof fetch=fetch) {}
  async order(id:string):Promise<Order> {
    requireThat(/^pay_[a-f0-9]{32}$/.test(id),404,'NOT_FOUND','订单不存在');
    const order = await this.store.readJson<Order>(orderPath(id));
    requireThat(order,404,'NOT_FOUND','订单不存在');
    requireThat(order.mode===this.env.PAYMENT_MODE,409,'ENVIRONMENT_MISMATCH','订单不属于当前支付环境');
    return order;
  }
  async create(client:ProductClient,body:unknown):Promise<Record<string,unknown>> {
    requireThat(body && typeof body === 'object' && !Array.isArray(body),400,'INVALID_REQUEST','订单参数错误');
    const input = body as Record<string,unknown>;
    requireThat(Object.keys(input).every(k=>['productOrderId','sku','returnUrl'].includes(k)),400,'INVALID_REQUEST','仅允许 productOrderId、sku、returnUrl');
    requireThat(typeof input.productOrderId === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(input.productOrderId) && typeof input.sku === 'string' && Object.hasOwn(client.skus,input.sku) && typeof input.returnUrl === 'string' && input.returnUrl.length <= 2000,400,'INVALID_REQUEST','业务订单或商品参数错误');
    const item = client.skus[input.sku];
    const returnUrl = allowedReturn(input.returnUrl,client.returnOrigins);
    const requestHash = sha256(JSON.stringify({productOrderId:input.productOrderId,sku:input.sku,returnUrl,amount:item.amount,subject:item.subject}));
    const index = `indexes/${client.id}/${sha256(input.productOrderId)}.json`;
    const id = randomId('pay_');
    const now = this.now();
    const order = await this.store.transaction(async tx => {
      const existing = await tx.read<{id:string}>(index);
      if (existing) {
        const previous = await tx.read<Order>(orderPath(existing.id));
        requireThat(previous?.mode===this.env.PAYMENT_MODE,409,'ENVIRONMENT_MISMATCH','订单不属于当前支付环境');
        requireThat(previous && previous.requestHash === requestHash,409,'IDEMPOTENCY_CONFLICT','相同业务订单号不能修改商品、金额或返回地址');
        return previous;
      }
      const queue = await tx.read<WorkQueue>('system/queue.json') || emptyQueue();
      requireThat(queue.orders.length < 2000,503,'CAPACITY','待支付订单过多，请稍后再试');
      const created:Order = {id,mode:this.env.PAYMENT_MODE,clientId:client.id,productOrderId:input.productOrderId as string,sku:input.sku as string,subject:item.subject,amount:money(item.amount),status:'PENDING',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+30*60_000).toISOString(),returnUrl,requestHash,fulfillmentStatus:'pending'};
      tx.put(orderPath(id),created); tx.put(index,{id});
      queue.orders.push(id); tx.put('system/queue.json',queue);
      return created;
    });
    return {...this.view(order,client), checkoutUrl:`${this.env.PAY_BASE_URL}/checkout/${order.id}#token=${checkoutToken(order.id,this.env)}`, productOrderId:order.productOrderId,sku:order.sku};
  }
  view(order:Order,client:ProductClient) {
    return {id:order.id,subject:order.subject,amount:order.amount,currency:'CNY',status:order.status,productName:client.name,expiresAt:order.expiresAt,returnUrl:this.returnUrl(order),fulfillmentStatus:order.fulfillmentStatus,mode:order.mode,channels:this.env.ALIPAY_CHANNELS.split(',')};
  }
  returnUrl(order:Order):string {
    const url = new URL(order.returnUrl); url.searchParams.set('payment_order_id',order.id); url.searchParams.set('product_order_id',order.productOrderId); return url.toString();
  }
  async applyTrade(trade:Trade):Promise<Order> {
    const now = new Date(this.now()).toISOString();
    return this.store.transaction(async tx => {
      const order = await tx.read<Order>(orderPath(trade.outTradeNo));
      requireThat(order,404,'NOT_FOUND','订单不存在');
      requireThat(order.mode===this.env.PAYMENT_MODE,409,'ENVIRONMENT_MISMATCH','订单不属于当前支付环境');
      requireThat(money(trade.totalAmount) === order.amount && (!trade.sellerId || trade.sellerId === this.env.ALIPAY_SELLER_ID),400,'PAYMENT_MISMATCH','交易信息与订单不匹配');
      requireThat(!order.tradeNo || order.tradeNo === trade.tradeNo,400,'PAYMENT_MISMATCH','支付宝交易号不匹配');
      if (order.status === 'PAID') return order;
      if (['TRADE_SUCCESS','TRADE_FINISHED'].includes(trade.tradeStatus)) {
        requireThat(/^\d{10,64}$/.test(trade.tradeNo),400,'PAYMENT_MISMATCH','支付宝交易号无效');
        order.status='PAID'; order.tradeNo=trade.tradeNo; order.paidAt=now;
        const id = eventId(order.id);
        const delivery:Delivery = {event:{id,type:'payment.paid',mode:order.mode,createdAt:now,data:{orderId:order.id,productOrderId:order.productOrderId,clientId:order.clientId,sku:order.sku,amount:order.amount,currency:'CNY',tradeNo:trade.tradeNo,paidAt:now}},attempts:0,nextAttemptAt:now};
        tx.put(deliveryPath(id),delivery);
        const queue = await tx.read<WorkQueue>('system/queue.json') || emptyQueue();
        queue.orders=queue.orders.filter(x=>x!==order.id);
        if (!queue.deliveries.includes(id)) queue.deliveries.push(id);
        tx.put('system/queue.json',queue);
      } else if (trade.tradeStatus === 'TRADE_CLOSED') {
        order.status='CLOSED';
        const queue = await tx.read<WorkQueue>('system/queue.json') || emptyQueue();
        queue.orders=queue.orders.filter(x=>x!==order.id); tx.put('system/queue.json',queue);
      } else return order;
      tx.put(orderPath(order.id),order);
      return order;
    });
  }
  async notification(data:Record<string,string>):Promise<Order|null> {
    requireThat(data.sign_type==='RSA2' && this.gateway.verifyNotification(data),400,'INVALID_SIGNATURE','支付宝通知验签失败');
    requireThat(data.app_id===this.env.ALIPAY_APP_ID && data.seller_id===this.env.ALIPAY_SELLER_ID,400,'PAYMENT_MISMATCH','应用或收款账户不匹配');
    const order = await this.order(data.out_trade_no);
    requireThat(money(data.total_amount)===order.amount,400,'PAYMENT_MISMATCH','交易金额不匹配');
    if (!['TRADE_SUCCESS','TRADE_FINISHED','TRADE_CLOSED'].includes(data.trade_status)) return null;
    return this.applyTrade({outTradeNo:data.out_trade_no,tradeNo:data.trade_no,tradeStatus:data.trade_status,totalAmount:data.total_amount,sellerId:data.seller_id});
  }
  async refresh(id:string):Promise<Order> {
    const now = this.now();
    const claimed = await this.store.transaction(async tx=>{
      const order = await tx.read<Order>(orderPath(id));
      requireThat(order,404,'NOT_FOUND','订单不存在');
      requireThat(order.mode===this.env.PAYMENT_MODE,409,'ENVIRONMENT_MISMATCH','订单不属于当前支付环境');
      if (order.status!=='PENDING' || (order.lastCheckedAt && now-Date.parse(order.lastCheckedAt)<60_000)) return false;
      order.lastCheckedAt=new Date(now).toISOString();tx.put(orderPath(id),order);return true;
    });
    if (claimed) {
      const trade = await this.gateway.query(id);
      requireThat(!trade || trade.outTradeNo === id,502,'PAYMENT_MISMATCH','查询交易号不匹配');
      if (trade) await this.applyTrade(trade);
    }
    return this.order(id);
  }
  async deliver(id:string,client:ProductClient):Promise<void> {
    const now = this.now(); const leaseId=randomId('lease_');
    const delivery=await this.store.transaction(async tx=>{
      const d=await tx.read<Delivery>(deliveryPath(id));
      if (!d || d.deliveredAt || Date.parse(d.nextAttemptAt)>now || (d.leaseUntil && Date.parse(d.leaseUntil)>now)) return null;
      requireThat(d.event.data.clientId===client.id,400,'CLIENT_MISMATCH','产品不匹配');
      requireThat(d.event.mode===this.env.PAYMENT_MODE,409,'ENVIRONMENT_MISMATCH','订单不属于当前支付环境');
      d.leaseId=leaseId;d.leaseUntil=new Date(now+60_000).toISOString();d.attempts++;tx.put(deliveryPath(id),d);return d;
    });
    if (!delivery) return;
    const body=JSON.stringify(delivery.event);const timestamp=String(Math.floor(now/1000));
    let status=0;
    try {
      const response=await this.send(client.webhookUrl,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10_000),headers:{'Content-Type':'application/json','X-Brclio-Event':id,'X-Brclio-Timestamp':timestamp,'X-Brclio-Signature':hmacSha256(client.webhookSecret,timestamp+'.'+body)},body});
      status=response.status;await response.body?.cancel();
    } catch { /* Durable retry remains queued. Never log payment bodies. */ }
    await this.store.transaction(async tx=>{
      const d=await tx.read<Delivery>(deliveryPath(id));
      if (!d || d.leaseId!==leaseId || d.deliveredAt) return;
      d.lastStatus=status;delete d.leaseId;delete d.leaseUntil;
      if (status>=200 && status<300) {
        d.deliveredAt=new Date(this.now()).toISOString();
        const order=await tx.read<Order>(orderPath(d.event.data.orderId));
        if (order) {order.fulfillmentStatus='delivered';tx.put(orderPath(order.id),order);}
        const queue=await tx.read<WorkQueue>('system/queue.json') || emptyQueue();
        queue.deliveries=queue.deliveries.filter(x=>x!==id);tx.put('system/queue.json',queue);
      } else d.nextAttemptAt=new Date(this.now()+Math.min(24*3600_000,30_000*2**Math.min(d.attempts,12))).toISOString();
      tx.put(deliveryPath(id),d);
    });
  }
  async maintenance(productClients:ProductClient[]):Promise<void> {
    const batch=await this.store.transaction(async tx=>{
      const q=await tx.read<WorkQueue>('system/queue.json') || emptyQueue();
      const orders=q.orders.slice(0,5),deliveries=q.deliveries.slice(0,10);
      if (q.orders.length>5) q.orders=[...q.orders.slice(5),...orders];
      if (q.deliveries.length>10) q.deliveries=[...q.deliveries.slice(10),...deliveries];
      if (q.orders.length>5 || q.deliveries.length>10) tx.put('system/queue.json',q);
      return {orders,deliveries};
    });
    for (const id of batch.orders) {
      try {
        const order=await this.order(id);
        if (this.now()-Date.parse(order.createdAt)>7*24*3600_000) {
          await this.store.transaction(async tx=>{const q=await tx.read<WorkQueue>('system/queue.json') || emptyQueue();q.orders=q.orders.filter(x=>x!==id);tx.put('system/queue.json',q);});
        } else await this.refresh(id);
      } catch {console.warn('reconciliation_failed');}
    }
    for (const id of batch.deliveries) {
      try {
        const d=await this.store.readJson<Delivery>(deliveryPath(id));
        const client=productClients.find(c=>c.id===d?.event.data.clientId);
        if (client) await this.deliver(id,client);
      } catch {console.warn('webhook_retry_failed');}
    }
  }
}
