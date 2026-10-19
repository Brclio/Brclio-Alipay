import {GitHubStore,GitHubError} from './store';
import {createAlipay} from './alipay';
import {authenticate,authenticateCheckout,authenticateHeaders} from './auth';
import {clients,configurationReady,HttpError,requireReady,requireThat} from './config';
import {Payments} from './payments';
import type {Env,ProductClient} from './types';
import {handleAdmin} from './admin';
import {handleIntegration} from './integration';
import {Registry} from './registry';
import {hmacSha256,sha256} from './crypto';

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
let cachedStore:{token:string;repository:string;branch:string;store:GitHubStore}|undefined;
function storeFor(env:Env):GitHubStore {
  if(cachedStore && cachedStore.token===env.GITHUB_TOKEN && cachedStore.repository===env.GITHUB_REPOSITORY && cachedStore.branch===env.GITHUB_BRANCH)return cachedStore.store;
  const store=new GitHubStore({token:env.GITHUB_TOKEN,repository:env.GITHUB_REPOSITORY,branch:env.GITHUB_BRANCH});
  cachedStore={token:env.GITHUB_TOKEN,repository:env.GITHUB_REPOSITORY,branch:env.GITHUB_BRANCH,store};return store;
}
async function runtimeEnv(env:Env,store?:import('./types').Store):Promise<Env> {
  const registered=await new Registry(env,store || storeFor(env)).resolveClients();
  return {...env,CLIENTS_JSON:JSON.stringify(registered)};
}
let healthCache:{key:string;until:number;value:Record<string,unknown>}|undefined;
export function service(env:Env):Payments {
  if(cached?.env===env)return cached.payments;
  const payments=new Payments(env,storeFor(env),createAlipay(env));
  cached={env,payments};return payments;
}

export async function handle(request:Request,env:Env,ctx:ExecutionContext,provided?:Payments):Promise<Response> {
  try {
    const url=new URL(request.url);const path=url.pathname;
    if (request.method==='GET' && path==='/api/health') {
      const key=hmacSha256(env.CHECKOUT_SECRET || 'unconfigured',JSON.stringify([env.GITHUB_REPOSITORY,env.PAYMENT_ENABLED,env.CLIENTS_JSON,env.REGISTRY_ENCRYPTION_KEY]));
      if(healthCache?.key===key && healthCache.until>Date.now())return secure(json(healthCache.value));
      let ready=false;try{ready=configurationReady(await runtimeEnv(env,provided?.store));}catch{/* report availability only */}
      const value={service:'Brclio Pay',version:'0.3.0',ready,acceptingPayments:ready && env.PAYMENT_ENABLED==='true',mode:env.PAYMENT_MODE || 'live'};
      healthCache={key,until:Date.now()+15000,value};return secure(json(value));
    }
    if(path.startsWith('/api/admin/'))return secure(await handleAdmin(request,env,provided?.store || storeFor(env)));
    if(path.startsWith('/api/integration/')) {
      requireThat(env.INTEGRATION_LIMITER && env.ADMIN_SESSION_SECRET,503,'INTEGRATION_NOT_CONFIGURED','接入服务尚未完成配置');
      const limit=await env.INTEGRATION_LIMITER.limit({key:hmacSha256(env.ADMIN_SESSION_SECRET,'integration-ip:'+(request.headers.get('CF-Connecting-IP') || 'unknown'))});
      requireThat(limit.success,429,'INTEGRATION_RATE_LIMIT','接入请求过于频繁，请稍后重试');
      return secure(await handleIntegration(request,env,provided?.store || storeFor(env)));
    }
    if (request.method==='GET' && path==='/payment/return') {
      const id=url.searchParams.get('out_trade_no');requireThat(id && /^pay_[a-f0-9]{32}$/.test(id),400,'INVALID_ORDER','订单参数错误');
      // A return query is untrusted. It grants no rights and cannot change payment status.
      return secure(Response.redirect(`${env.PAY_BASE_URL}/checkout/${id}`,303));
    }
    if (!path.startsWith('/api/')) {
      requireThat(['GET','HEAD'].includes(request.method),405,'METHOD_NOT_ALLOWED','请求方法不支持');
      const staticUrl=new URL(request.url);
      if(['/admin','/admin/','/admin.html'].includes(path))staticUrl.pathname='/admin.html';
      if(path.startsWith('/skills/') || path.endsWith('.zip'))throw new HttpError(404,'NOT_FOUND','文件不存在');
      if (/^\/checkout\/pay_[a-f0-9]{32}$/.test(path)) staticUrl.pathname='/checkout.html';
      return secure(await env.ASSETS.fetch(new Request(staticUrl,{method:request.method})));
    }
    // Reject invalid routes and missing/expired credentials before spending a GitHub read.
    const productMatch=/^\/api\/v1\/orders\/(pay_[a-f0-9]{32})(\/refresh)?$/.exec(path);
    const checkoutMatch=/^\/api\/checkout\/(pay_[a-f0-9]{32})(\/(pay|refresh))?$/.exec(path);
    if(path==='/api/alipay/notify') {
      requireThat(request.method==='POST',405,'METHOD_NOT_ALLOWED','请求方法不支持');
      requireThat(request.headers.get('Content-Type')?.split(';')[0].trim()==='application/x-www-form-urlencoded',415,'INVALID_CONTENT_TYPE','通知类型错误');
    } else if(path==='/api/v1/orders' || path==='/api/v1/catalog' || productMatch) {
      requireThat(request.method===(path==='/api/v1/orders' || productMatch?.[2]?'POST':'GET'),405,'METHOD_NOT_ALLOWED','请求方法不支持');
      authenticateHeaders(request);
    } else if(checkoutMatch) {
      requireThat(!url.search,400,'INVALID_REQUEST','请通过 Authorization 传递支付令牌');
      requireThat(request.method===(checkoutMatch[3]?'POST':'GET'),405,'METHOD_NOT_ALLOWED','请求方法不支持');
      authenticateCheckout(request,checkoutMatch[1],env);
    } else throw new HttpError(404,'NOT_FOUND','接口不存在');
    if(env.PAYMENT_API_LIMITER) {
      const limit=await env.PAYMENT_API_LIMITER.limit({key:hmacSha256(env.CHECKOUT_SECRET,'payment-ip:'+(request.headers.get('CF-Connecting-IP') || 'unknown'))});
      requireThat(limit.success,429,'PAYMENT_RATE_LIMIT','请求过于频繁，请稍后重试');
    }
    env=await runtimeEnv(env,provided?.store);
    requireReady(env,false);
    const payments=provided || service(env);
    if(path==='/api/v1/catalog') {
      const raw=await readBody(request);requireThat(raw==='',400,'INVALID_REQUEST','目录接口不接受请求体');
      const client=authenticate(request,raw,env);
      const skus=Object.fromEntries(Object.entries(client.skus).sort(([a],[b])=>a.localeCompare(b)).map(([sku,item])=>[sku,{...item,enabled:item.enabled!==false}]));
      return secure(json({clientId:client.id,name:client.name,enabled:client.enabled!==false,acceptingPayments:env.PAYMENT_ENABLED==='true' && client.enabled!==false,mode:env.PAYMENT_MODE,currency:'CNY',version:sha256(JSON.stringify(skus)),skus}));
    }
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
      requireThat(client.enabled!==false,403,'CLIENT_DISABLED','该平台已暂停新订单');
      return secure(json(await payments.create(client,parseJson(raw)),201));
    }
    if (productMatch) {
      requireThat(request.method===(productMatch[2]?'POST':'GET'),405,'METHOD_NOT_ALLOWED','请求方法不支持');
      const raw=await readBody(request);requireThat(raw==='' || raw==='{}',400,'INVALID_REQUEST','此接口不接受参数');
      const client=authenticate(request,raw,env);let order=await payments.order(productMatch[1]);
      requireThat(order.clientId===client.id,404,'NOT_FOUND','订单不存在');
      if(productMatch[2])order=await payments.refresh(order.id);
      if(productMatch[2] && order.status==='PAID')ctx.waitUntil(payments.deliver(`evt_${order.id}`,client).catch(()=>console.warn('webhook_delivery_failed')));
      return secure(json({...payments.view(order,client),productOrderId:order.productOrderId,sku:order.sku,tradeNo:order.tradeNo,paidAt:order.paidAt}));
    }
    if(checkoutMatch) {
      requireThat(!url.search,400,'INVALID_REQUEST','请通过 Authorization 传递支付令牌');
      const [,id,,action]=checkoutMatch;authenticateCheckout(request,id,env);
      requireThat(request.method===(action?'POST':'GET'),405,'METHOD_NOT_ALLOWED','请求方法不支持');
      let order=await payments.order(id);const client=findClient(env,order.clientId);
      if(action==='refresh')order=await payments.refresh(id);
      if(action==='pay') {
        const expiresAt=payments.paymentExpiresAt(order);
        requireReady(env,true);requireThat(order.status==='PENDING' && Date.now()<Date.parse(expiresAt),409,'ORDER_NOT_PAYABLE','订单已支付、关闭或过期，请返回产品创建新订单');
        requireThat(client.enabled!==false,403,'CLIENT_DISABLED','该平台已暂停新付款');
        const input=parseJson(await readBody(request)) as {channel?:string};
        requireThat(input && ['page','wap'].includes(input.channel || '') && env.ALIPAY_CHANNELS.split(',').includes(input.channel!),400,'CHANNEL_UNAVAILABLE','该支付方式尚未启用');
        return secure(json({paymentUrl:payments.gateway.paymentUrl({id:order.id,subject:order.subject,totalAmount:order.amount,expiresAt},{channel:input.channel as 'page'|'wap',notifyUrl:`${env.PAY_BASE_URL}/api/alipay/notify`,pageReturnUrl:`${env.PAY_BASE_URL}/payment/return`})}));
      }
      if(action==='refresh' && order.status==='PAID')ctx.waitUntil(payments.deliver(`evt_${id}`,client).catch(()=>console.warn('webhook_delivery_failed')));
      return secure(json(payments.view(order,client)));
    }
    throw new HttpError(404,'NOT_FOUND','接口不存在');
  } catch(error) {
    const status=error instanceof HttpError?error.status:error instanceof GitHubError && error.status===409?409:503;
    const code=error instanceof HttpError || error instanceof GitHubError?error.code:'SERVICE_UNAVAILABLE';
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
    ctx.waitUntil((async()=>{try {const effective=await runtimeEnv(env);requireReady(effective,false);await service(effective).maintenance(clients(effective));}catch{console.warn('maintenance_not_ready');}})());
  }
};
