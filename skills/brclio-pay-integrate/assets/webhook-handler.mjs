import {verifyPaymentEvent} from './payment-client.mjs';
/** Adapt to your server route. applyEntitlement must use a DURABLE transaction, never an in-memory Set. */
export function createWebhookHandler({clientId,webhookSecret,applyEntitlement}) {
  if(typeof applyEntitlement!=='function')throw new Error('Durable entitlement transaction required');
  return async request=>{
    if(request.method!=='POST')return new Response('method not allowed',{status:405});
    if(Number(request.headers.get('Content-Length') || 0)>16_384)return new Response('too large',{status:413});
    const rawBody=await request.text();let event;
    try{event=verifyPaymentEvent({rawBody,headers:request.headers,webhookSecret,clientId});}
    catch{return new Response('invalid event',{status:401});}
    try {
      // In one transaction: match your pending order's owner, SKU, expected amount;
      // insert event.id uniquely; grant the entitlement; mark your business order paid.
      // A duplicate committed event must also succeed. Never rely on redirect parameters.
      await applyEntitlement(event);
      return new Response('ok');
    } catch{return new Response('retry later',{status:503});}
  };
}
