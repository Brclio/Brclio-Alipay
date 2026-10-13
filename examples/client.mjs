import {createPaymentClient} from './payment-client.mjs';
const {PAY_CLIENT_ID,PAY_API_SECRET,PAY_SKU,PAY_PRODUCT_ORDER_ID,PAY_RETURN_URL,PAY_BASE_URL}=process.env;
if(!PAY_SKU || !PAY_PRODUCT_ORDER_ID || !PAY_RETURN_URL)throw new Error('Set PAY_CLIENT_ID, PAY_API_SECRET, PAY_SKU, PAY_PRODUCT_ORDER_ID and PAY_RETURN_URL in server environment');
const client=createPaymentClient({baseUrl:PAY_BASE_URL,clientId:PAY_CLIENT_ID,apiSecret:PAY_API_SECRET});
const order=await client.createOrder({productOrderId:PAY_PRODUCT_ORDER_ID,sku:PAY_SKU,returnUrl:PAY_RETURN_URL});
// Do not log checkoutUrl: its fragment contains the order-specific checkout credential.
console.log(JSON.stringify({orderId:order.id,status:order.status,amount:order.amount,checkoutLinkReceived:!!order.checkoutUrl}));
