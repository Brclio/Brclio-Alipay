// Test-only network harness. Node intercepts every outbound request; no real providers are contacted.
import { GitHubStore, GitHubError } from '../src/store';
import { Payments, type Gateway } from '../src/payments';
import { Reporting } from '../src/reporting';
import type { Env, ProductClient, Store, Transaction } from '../src/types';
// @ts-expect-error The shipped JavaScript integration template intentionally has no TypeScript declaration.
import { createPaymentClient } from '../examples/payment-client.mjs';

async function throwsTypeError(action: () => Promise<unknown>, pattern: RegExp): Promise<boolean> {
  try { await action(); return false; }
  catch (error) { return error instanceof TypeError && pattern.test(error.message); }
}
async function webhook(url: string): Promise<{ delivered: boolean; rejectedRedirect: boolean; reportingAtomic: boolean }> {
  const now = Date.now();
  const orderId = `pay_${'1'.repeat(32)}`;
  const eventId = `evt_${orderId}`;
  const values = new Map<string, any>([
    [`events/${eventId}.json`, { event: { id: eventId, type: 'payment.paid', mode: 'live', createdAt: new Date(now).toISOString(),
      data: { orderId, productOrderId: 'network-fixture', clientId: 'fixture', sku: 'pro', amount: '1.00', currency: 'CNY', tradeNo: '2026101422001400000000000000', paidAt: new Date(now).toISOString() } },
    attempts: 0, nextAttemptAt: new Date(now - 1000).toISOString() }],
    [`orders/${orderId}.json`, { id: orderId,mode:'live',clientId:'fixture',productOrderId:'network-fixture',sku:'pro',subject:'Runtime fixture',amount:'1.00',status:'PAID',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+1800000).toISOString(),paidAt:new Date(now).toISOString(),tradeNo:'2026101422001400000000000000',requestHash:'fixture-only',returnUrl:'https://product.runtime.invalid/account',fulfillmentStatus: 'pending' }],
    ['system/queue.json', { orders: [], deliveries: [eventId] }],
  ]);
  const store: Store = {
    readJson: async <T>(path: string) => structuredClone((values.get(path) ?? null) as T | null),
    openSnapshot: async () => {
      const snapshot=structuredClone(values);
      return {revision:'fixture',listJsonPaths:(prefix:string)=>[...snapshot.keys()].filter(path=>path.startsWith(prefix)),readJson:async<T>(path:string)=>structuredClone((snapshot.get(path)??null) as T|null)};
    },
    transaction: async <T>(callback: (tx: Transaction) => Promise<T>) => {
      const writes = new Map<string, unknown>();
      const result = await callback({
        read: async <V>(path: string) => structuredClone((writes.has(path) ? writes.get(path) : values.get(path) ?? null) as V | null),
        put: (path, value) => { writes.set(path, structuredClone(value)); },
      });
      for (const [path, value] of writes) values.set(path, value);
      return result;
    },
  };
  const client: ProductClient = { id: 'fixture', name: 'Fixture', apiSecret: 'fixture-api-'.repeat(4), webhookSecret: 'fixture-webhook-'.repeat(4),
    webhookUrl: url, returnOrigins: ['https://product.runtime.invalid'], skus: { pro: { subject: 'Fixture', amount: '1.00' } } };
  const gateway: Gateway = { query: async () => null, verifyNotification: () => false, paymentUrl: () => '' };
  const payments = new Payments({ PAYMENT_MODE: 'live' } as Env, store, gateway, () => now);
  await payments.deliver(eventId, client);
  const delivery = values.get(`events/${eventId}.json`);
  let reportingAtomic=true;
  if(delivery.deliveredAt){
    const month=new Date(now+8*3600_000).toISOString().slice(0,7),summary=await new Reporting(store,'live').summary({month});
    reportingAtomic=summary.paidCount===1&&summary.paidAmountCents===100&&summary.deliveryPendingCount===0&&summary.coverage.complete;
  }
  return { delivered: !!delivery.deliveredAt && values.get(`orders/${orderId}.json`).fulfillmentStatus === 'delivered',
    rejectedRedirect: delivery.lastStatus === 302 && !delivery.deliveredAt && Date.parse(delivery.nextAttemptAt) > now,reportingAtomic };
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).hostname !== 'store-runtime.test') return new Response(null, { status: 404 });
    const receiver = { fetch: globalThis.fetch };
    const legacyPropertyRejected = await throwsTypeError(() => receiver.fetch('https://native.runtime.invalid/'), /Illegal invocation/);
    const unsupportedRedirectRejected = await throwsTypeError(() => fetch('https://native.runtime.invalid/', { redirect: 'error' }), /Invalid redirect value/);
    const missingStore = new GitHubStore({ token: 'fixture-token', repository: 'fixture/private' });
    const existingStore = new GitHubStore({ token: 'fixture-token', repository: 'fixture/existing' });
    const privateReadMissing = await missingStore.readJson('system/clients.enc.json') === null;
    const privateReadExisting = (await existingStore.readJson<{ status: string }>('orders/pay_native.json'))?.status === 'PAID';
    const listing=await new GitHubStore({token:'fixture-token',repository:'fixture/snapshot'}).openSnapshot();
    const immutableListing=listing.listJsonPaths('orders/').join(',')==='orders/pay_native.json'&&(await listing.readJson<{status:string}>('orders/pay_native.json'))?.status==='PAID';
    let redirectRejected = false;
    try { await new GitHubStore({ token: 'fixture-token', repository: 'fixture/redirect' }).readJson('system/clients.enc.json'); }
    catch (error) { redirectRejected = error instanceof GitHubError && error.status === 302; }
    const delivered = await webhook('https://product.runtime.invalid/payment');
    const redirected = await webhook('https://redirect.runtime.invalid/payment');
    const example = createPaymentClient({ baseUrl: 'https://pay.runtime.invalid', clientId: 'fixture', apiSecret: 'fixture-api-'.repeat(4) });
    const exampleOrder = await example.createOrder({ productOrderId: 'native-example', sku: 'pro', returnUrl: 'https://product.runtime.invalid/account' });
    const exampleRead = await example.getOrder(exampleOrder.id);
    const exampleRefresh = await example.refreshOrder(exampleOrder.id);
    let exampleRedirectRejected = false;
    try {
      await createPaymentClient({ baseUrl: 'https://pay-redirect.runtime.invalid', clientId: 'fixture', apiSecret: 'fixture-api-'.repeat(4) }).getOrder(exampleOrder.id);
    } catch { exampleRedirectRejected = true; }
    return Response.json({ legacyPropertyRejected, unsupportedRedirectRejected, privateReadMissing, privateReadExisting, redirectRejected,
      webhookDelivered: delivered.delivered, webhookRedirectQueued: redirected.rejectedRedirect,reportingAtomic:delivered.reportingAtomic,immutableListing,
      exampleNativeFetch: exampleOrder.id === `pay_${'1'.repeat(32)}` && exampleRead.status === 'PENDING' && exampleRefresh.status === 'PAID', exampleRedirectRejected });
  },
};
