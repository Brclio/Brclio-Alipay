export interface Env {
  ASSETS: Fetcher;
  PAY_BASE_URL: string;
  PAYMENT_MODE: 'live' | 'sandbox';
  PAYMENT_ENABLED: string;
  ALIPAY_CHANNELS: string;
  ALIPAY_APP_ID: string;
  ALIPAY_PRIVATE_KEY: string;
  ALIPAY_PUBLIC_KEY: string;
  ALIPAY_SELLER_ID: string;
  ALIPAY_GATEWAY?: string;
  GITHUB_TOKEN: string;
  GITHUB_REPOSITORY: string;
  GITHUB_BRANCH: string;
  CHECKOUT_SECRET: string;
  CLIENTS_JSON: string;
  REGISTRY_ENCRYPTION_KEY?: string;
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD_HASH?: string;
  ADMIN_PASSWORD_PEPPER?: string;
  ADMIN_SESSION_SECRET?: string;
  ADMIN_LOGIN_LIMITER?: {limit(options:{key:string}):Promise<{success:boolean}>};
  INTEGRATION_LIMITER?: {limit(options:{key:string}):Promise<{success:boolean}>};
  PAYMENT_API_LIMITER?: {limit(options:{key:string}):Promise<{success:boolean}>};
}
export interface ProductClient {
  id: string;
  name: string;
  apiSecret: string;
  webhookSecret: string;
  webhookUrl: string;
  returnOrigins: string[];
  skus: Record<string, {subject: string; amount: string}>;
  enabled?: boolean;
}
export interface Order {
  id: string;
  mode: 'live' | 'sandbox';
  clientId: string;
  productOrderId: string;
  sku: string;
  subject: string;
  amount: string;
  status: 'PENDING' | 'PAID' | 'CLOSED';
  createdAt: string;
  expiresAt: string;
  returnUrl: string;
  requestHash: string;
  tradeNo?: string;
  paidAt?: string;
  lastCheckedAt?: string;
  fulfillmentStatus: 'pending' | 'delivered';
}
export interface PaymentEvent {
  id: string;
  type: 'payment.paid';
  mode: 'live' | 'sandbox';
  createdAt: string;
  data: {orderId: string; productOrderId: string; clientId: string; sku: string; amount: string; currency: 'CNY'; tradeNo: string; paidAt: string};
}
export interface Delivery {
  event: PaymentEvent;
  attempts: number;
  nextAttemptAt: string;
  deliveredAt?: string;
  lastStatus?: number;
  leaseId?: string;
  leaseUntil?: string;
}
export interface WorkQueue { orders: string[]; deliveries: string[] }
export interface Transaction {
  read<T>(path: string): Promise<T | null>;
  put(path: string, value: unknown): void;
}
export interface Store {
  readJson<T>(path: string): Promise<T | null>;
  transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T>;
}
