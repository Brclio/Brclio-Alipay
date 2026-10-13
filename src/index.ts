import {GitHubStore} from './store';
import {createAlipay} from './alipay';
import {authenticate,authenticateCheckout} from './auth';
import {clients,configurationReady,HttpError,requireReady,requireThat} from './config';
import {Payments} from './payments';
import type {Env,ProductClient} from './types';

function json(value:unknown,status=200):Response {return Response.json(value,{status});}
function secure(response:Response):Response {
  const res=new Response(response.body,response);
  res.headers.set('X-Content-Type-Options','nosniff');
  res.headers.set('Referrer-Policy','no-referrer');
  res.headers.set('Cache-Control','no-store');
  res.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.headers.set('Strict-Transport-Security','max-age=31536000');
  return res;
}
async function readBody(request:Request,limit=16_384):Promise<string> {
  requireThat(Number(request.headers.get('Content-Length') || 0)<=limit,413,'BODY_TOO_LARGE','请求过大');
  if (!request.body) return '';
  const reader=request.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false});let length=0;let text='';
  try {
    for (;;) {const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw new HttpError(413,'BODY_TOO_LARGE','请求过大');}text+=decoder.decode(value,{stream:true});}
    return text+decoder.decode();
  } finally {reader.releaseLock();}
}
function parseJson(raw:string):unknown {try{return JSON.parse(raw);}catch{throw new HttpError(400,'INVALID_JSON','JSON 格式错误');}}
function findClient(env:Env,id:string):ProductClient {const c=clients(env).find(c=>c.id===id);requireThat(c,503,'CLIENT_UNAVAILABLE','产品暂不可用');return c;}
let cached:{env:Env;payments:Payments}|undefined;
export function service(env:Env):Payments {
  if(cached?.env===env)return cached.payments;
  const payments=new Payments(env,new GitHubStore({token:env.GITHUB_TOKEN,repository:env.GITHUB_REPOSITORY,branch:env.GITHUB_BRANCH}),createAlipay(env));
  cached={env,payments};return payments;
}

export async function handle(request:Request,env:Env,ctx:ExecutionContext,provided?:Payments):Promise<Response> {
  try {
    const url=new URL(request.url);const path=url.pathname;
    if (request.method==='GET' && path==='/api/health') {
      let ready=false;try{ready=configurationReady(env);}catch{/* report availability only */}
      return secure(json({service:'Brclio Pay',version:'0.1.0',ready,acceptingPayments:ready && env.PAYMENT_ENABLED==='true',mode:env.PAYMENT_MODE || 'live'}));
    }
    if (request.method==='GET' && path==='/payment/return') {
      const id=url.searchParams.get('out_trade_no');requireThat(id && /^pay_[a-f0-9]{32}$/.test(id),400,'INVALID_ORDER','订单参数错误');
      // A return query is untrusted. It grants no rights and cannot change payment status.
      return secure(Response.redirect(`${env.PAY_BASE_URL}/checkout/${id}`,303));
    }
    if (!path.startsWith('/api/')) {
      requireThat(['GET','HEAD'].includes(request.method),405,'METHOD_NOT_ALLOWED','请求方法不支持');
      const staticUrl=new URL(request.url);
      if (/^\/checkout\/pay_[a-f0-9]{32}$/.test(path)) staticUrl.pathname='/checkout.html';
      return secure(await env.ASSETS.fetch(new Request(staticUrl,{method:request.method})));
    }
    requireReady(env,false);
    const payments=provided || service(env);
    if (path==='/api/alipay/notify' && request.method==='POST') {
      requireThat(request.headers.get('Content-Type')?.split(';')[0].trim()==='application/x-www-form-urlencoded',415,'INVALID_CONTENT_TYPE','通知类型错误');
      const raw=await readBody(request,32_768);const form=new URLSearchParams(raw);const data:Record<string,string>=Object.create(null);
      for (const [key,value] of form) {requireThat(!Object.hasOwn(data,key),400,'DUPLICATE_FIELD','重复通知字段');data[key]=value;}
      const order=await payments.notification(data);
      if(order?.status==='PAID')ctx.waitUntil(payments.deliver(`evt_${order.id}`,findClient(env,order.clientId)).catch(()=>console.warn('webhook_delivery_failed')));
      return secure(new Response('success',{headers:{'Content-Type':'text/plain;charset=utf-8'}}));
    }
    if (path==='/api/v1/orders' && request.method==='POST') {
      requireReady(env,true);
      requireThat(request.headers.get('Content-Type')?.split(';')[0].trim()==='application/json',415,'INVALID_CONTENT_TYPE','请求需要 JSON');
      const raw=await readBody(request);const client=authenticate(request,raw,env);
      return secure(json(await payments.create(client,parseJson(raw)),201));
    }
    const productMatch=/^\/api\/v1\/orders\/(pay_[a-f0-9]{32})(\/refresh)?$/.exec(path);
    if (productMatch) {
      requireThat(request.method===(productMatch[2]?'POST':'GET'),405,'METHOD_NOT_ALLOWED','请求方法不支持');
      const raw=await readBody(request);requireThat(raw==='' || raw==='{}',400,'INVALID_REQUEST','此接口不接受参数');
      const client=authenticate(request,raw,env);let order=await payments.order(productMatch[1]);
      requireThat(order.clientId===client.id,404,'NOT_FOUND','订单不存在');
      if(productMatch[2])order=await payments.refresh(order.id);
      if(productMatch[2] && order.status==='PAID')ctx.waitUntil(payments.deliver(`evt_${order.id}`,client).catch(()=>console.warn('webhook_delivery_failed')));
      return secure(json({...payments.view(order,client),productOrderId:order.productOrderId,sku:order.sku,tradeNo:order.tradeNo,paidAt:order.paidAt}));
    }
    const checkoutMatch=/^\/api\/checkout\/(pay_[a-f0-9]{32})(\/(pay|refresh))?$/.exec(path);
    if(checkoutMatch) {
      requireThat(!url.search,400,'INVALID_REQUEST','请通过 Authorization 传递支付令牌');
      const [,id,,action]=checkoutMatch;authenticateCheckout(request,id,env);
      requireThat(request.method===(action?'POST':'GET'),405,'METHOD_NOT_ALLOWED','请求方法不支持');
      let order=await payments.order(id);const client=findClient(env,order.clientId);
      if(action==='refresh')order=await payments.refresh(id);
      if(action==='pay') {
        requireReady(env,true);requireThat(order.status==='PENDING' && Date.now()+60_000<Date.parse(order.expiresAt),409,'ORDER_NOT_PAYABLE','订单已支付、关闭或即将过期，请返回产品创建新订单');
        const input=parseJson(await readBody(request)) as {channel?:string};
        requireThat(input && ['page','wap'].includes(input.channel || '') && env.ALIPAY_CHANNELS.split(',').includes(input.channel!),400,'CHANNEL_UNAVAILABLE','该支付方式尚未启用');
        return secure(json({paymentUrl:payments.gateway.paymentUrl({id:order.id,subject:order.subject,totalAmount:order.amount,expiresAt:order.expiresAt},{channel:input.channel as 'page'|'wap',notifyUrl:`${env.PAY_BASE_URL}/api/alipay/notify`,pageReturnUrl:`${env.PAY_BASE_URL}/payment/return`})}));
      }
      if(action==='refresh' && order.status==='PAID')ctx.waitUntil(payments.deliver(`evt_${id}`,client).catch(()=>console.warn('webhook_delivery_failed')));
      return secure(json(payments.view(order,client)));
    }
    throw new HttpError(404,'NOT_FOUND','接口不存在');
  } catch(error) {
    const status=error instanceof HttpError?error.status:503;
    const code=error instanceof HttpError?error.code:'SERVICE_UNAVAILABLE';
    const message=error instanceof HttpError?error.message:'服务暂不可用，请稍后重试';
    // SDK/provider errors may contain credentials; only stable internal codes go to logs.
    if(status>=500)console.warn(code);
    if(new URL(request.url).pathname==='/api/alipay/notify')return secure(new Response('failure',{status,headers:{'Content-Type':'text/plain;charset=utf-8'}}));
    return secure(json({error:{code,message}},status));
  }
}
export default {
  fetch:handle,
  async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext) {
    try {requireReady(env,false);ctx.waitUntil(service(env).maintenance(clients(env)));}catch{console.warn('maintenance_not_ready');}
  }
};
