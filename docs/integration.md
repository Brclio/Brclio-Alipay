# Brclio Pay 产品接入指南（交给 AI 即可）

支付中心：`https://pay.bornforthis.cn`，接入管理：`https://pay.bornforthis.cn/admin`。支付宝应用已上线，当前 `PAYMENT_ENABLED=false`，真实收款和产品实际开通仍待验收。`ready:true` 仅表示配置齐全，首页或后台可访问都不证明真实付款成功。

推荐在 `/admin` 登录后生成并复制完整 AI 接入任务：内含通用 Skill、单平台新增/更新范围、域名模式、套餐来源和最长 2 小时的授权。AI 无需附件即可读取 Skill，并用同一 Bearer 授权下载辅助脚本，详见 [管理后台](admin.md)。以下协议供实现和检查产品后端使用。

## 直接给产品开发 AI 的任务

> 为当前产品接入 Brclio Pay，阅读本文件及 examples/payment-client.mjs、examples/webhook-handler.mjs。先检查现有登录、业务订单和权益存储。由产品后端签名读取 GET /api/v1/catalog，展示并校验启用商品，不缓存或使用明确短缓存。新增登录用户的后端下单接口，商品使用支付中心登记的 SKU；业务订单绑定当前用户并锁定金额与实际权益快照。createOrder 响应金额若与用户确认报价不同，不放出收银台链接，让用户确认新价并用新业务订单重建。把通过核对的 checkoutUrl 交给网页/桌面/安卓客户端。实现 HTTPS 支付通知接口，基于原始请求体验签，校验 mode=live、clientId、业务订单归属、SKU、历史订单金额快照与币种；在一个持久事务中去重 event.id 并按原承诺开通权益，事务提交后才返回 2xx。权益说明字符串不能自动执行开通规则。实现当前用户订单查询和返回页，返回参数只定位订单，禁止据此认定成功。服务端密钥通过 Secret 管理，禁止进入前端、客户端包、Git、日志。保留原有业务功能。完成签名错误、金额错误、目录与下单之间改价、跨用户访问、重复通知和失败重试测试；验收须证明实际权益落库。没有真实人民币价格或业务规则时列出缺失项，不编造或自行换汇，不执行真实付款。

## 1. 注册或更新一个产品

每个产品一个 `clientId`、独立 `apiSecret` 和 `webhookSecret`、登记的 HTTPS 回调、返回来源和商品目录。所有密钥只存产品可信后端。更新时保留原密钥，不重置原产品订单、权益或其他支付提供方。

管理员可在 `/admin` 手动预览保存，或签发单平台 AI 任务。`mode=create/update` 表示新增/更新操作，`paymentMode=live/sandbox` 才是支付环境。临时令牌不进入源码、计划、日志或通用 Skill；不会授予管理员、支付宝、GitHub 或其他平台凭据。

受限 AI 流程：

1. `GET /api/integration/v1/skill.zip` 下载通用包，解压到任务临时目录，先检查原业务代码。
2. `GET /api/integration/v1/context` 读取目标配置、允许域名、支付环境和 `client.version`。新平台版本为 `absent`，创建前没有长期凭证。
3. `POST /api/integration/v1/plan` 提交 `{config,expectedVersion}`，核对 `before`、`after` 和目标；计划最多 15 分钟且受授权到期时间限制。
4. `POST /api/integration/v1/apply` 提交 `{planId}`。再次按目标平台版本和域名范围校验，返回配置及目标凭证。重复应用已完成的同一计划返回原结果。

以上接入 API 使用 `Authorization: Bearer 临时令牌`，不用产品 HMAC，也不把令牌放到 query。授权最长 2 小时且可撤销，不能扩大目标；撤销不回滚已应用配置或撤销已交付的长期凭证。对产品仓库的编辑和发布仍需当前用户授权。

409 版本冲突时重新读取并核对差异，不能强制覆盖。变更只针对目标平台，保存其他平台、原长期密钥和未请求修改的字段。配置字段为 `id`、`name`、`webhookUrl`、`returnOrigins`、`skus`、`enabled`，不包含凭证。

域名有两种模式：`domainMode=fixed` 的新增或修改 webhook/返回来源须在 `allowedOrigins` 内；`domainMode=auto` 允许 AI 为指定产品自动加入必要合法公网 HTTPS 来源，初始来源可空，plan 展示 `addedOrigins`，apply 原子纳入授权记录（最多 100 个），后台可查看管理。旧授权缺省 fixed。两种模式都允许 AI 自行设计来源下的具体路径，不会授予其他产品、DNS 或域名购买权限。推荐精确来源；确有需要可登记 `https://*.brclio.com`，只匹配子域名，不匹配根域名或 `brclio.com.evil.tld`。产品日常下单不能自行指定 webhook，它必须是登记的公网 HTTPS 域名。

套餐也有两种来源：`pricingMode=detect`（缺省）先读取目标项目已有后端商品配置、可用只读套餐记录及定价文档，列出证据位置并与前端展示核对；`pricingMode=manual` 使用用户在任务里明确提供的规则。无可靠依据或存在冲突时先问用户，禁止编造真实价格或权益。必须核实币种：中心只有 CNY，不把 USD 等外币价格直接当人民币，也不自行换汇。证据报告不包含 Secret、客户或订单隐私。

每个 SKU 必填 `subject`（最多 120 字）和 `amount`（人民币两位小数字符串）；可选 `enabled`（默认 true，false 停售）、`description`（最多 500 字）、`entitlement`（最多 1000 字，描述权益和有效期）。权益说明仅是目录元数据，目标产品负责实现对应规则。后台可直接编辑这些字段，保存前预览单平台差异并核对版本。

改价只影响新订单，历史订单金额保持不变。已实现目录读取的产品会读取后台新价；旧产品须先让 AI 完成一次目录展示/下单校验改造。权益说明不会自动改变产品开通逻辑，真实规则修改仍须同步产品。业务订单保存创建时金额与权益快照，不能用最新套餐校验旧付款。停售 SKU 阻止新下单，已有订单继续支付确认与开通；删除 SKU 前也要保留原业务订单快照。回调修改影响待投递通知，需先部署新接收端并安排过渡。停止平台阻止新订单和新发起付款，已有支付确认及重试继续处理。

平台注册表与长期凭证加密保存在私有 GitHub 仓库。旧 `scripts/add-product.mjs` / `CLIENTS_JSON` 仅适用于加密记录尚不存在的初始化；已有加密记录由后台管理，修改 legacy Secret 不会替换它，解密失败也不回退。不要用旧脚本全量覆盖已接入平台，加密 key 必须保留，详见 [部署](deployment.md)。

## 2. 产品后端创建订单

复制 `examples/payment-client.mjs` 到产品后端。Node.js 及支持 nodejs_compat 的 Cloudflare Worker 可使用；其它语言按下述协议实现。

先通过产品可信后端读取目录：

```js
const catalog = await pay.catalog(); // GET /api/v1/catalog，用产品长期凭证签名
if (catalog.clientId !== env.PAY_CLIENT_ID || catalog.mode !== 'live' || catalog.currency !== 'CNY') {
  throw new Error('支付目录环境不匹配');
}
// 仅通过产品自己的接口返回公开商品；前端永远拿不到 apiSecret。
const availableSkus = catalog.enabled
  ? Object.entries(catalog.skus).filter(([, item]) => item.enabled)
  : [];
```

目录响应为 `{clientId,name,enabled,mode,currency:'CNY',version,skus:{SKU:{subject,amount,enabled,description?,entitlement?}}}`，不含任何密钥。此接口配置齐全后可用，关闭总收款开关不影响读取。产品后端应不缓存或使用明确短缓存；框架若默认缓存服务端 fetch，须关闭该缓存，不能把目录固化为静态构建。不同语言按与正常下单相同的 HMAC 规则签名 GET 空请求体。

```js
import {createPaymentClient} from './payment-client.mjs';
const pay = createPaymentClient({
  clientId: env.PAY_CLIENT_ID,
  apiSecret: env.PAY_API_SECRET
});
// 先创建并持久保存属于当前登录用户的业务订单；禁止客户端指定他人订单。
const payment = await pay.createOrder({
  productOrderId: businessOrder.id,
  sku: 'pro-month',
  returnUrl: 'https://app.brclio.com/billing/return'
});
// 保存 payment.id 和本地业务订单的映射，向当前用户返回 checkoutUrl。
```

业务订单先保存用户已确认的 SKU、报价和产品实际权益规则快照。`createOrder` 返回的 SKU、amount 是当笔支付订单权威；目录读取与下单之间可能改价，应在返回 checkoutUrl 前与已确认报价核对。不一致时不给出付款链接，提示用户确认新报价，并用新的业务订单号重建；不能悄悄涨价，也不能继续用旧金额接收新支付。确认一致后持久保存支付订单 ID 和快照，再交付链接。历史 webhook 永远按该笔订单的快照核对。

接口 `POST /api/v1/orders`，JSON 字段只有 `productOrderId`、`sku`、`returnUrl`。价格和标题取支付中心目录。金额字符串用人民币两位小数。相同 clientId + productOrderId 永久幂等；变更 SKU、价格、标题或返回地址返回 409。需要重新付款时，产品后端创建新的业务订单号。

响应包含 `id`、`productOrderId`、`sku`、`amount`、`currency:"CNY"`、`status`、`expiresAt`、`mode`、`checkoutUrl`。

签名请求头：

```text
X-Brclio-Client: 产品clientId
X-Brclio-Timestamp: Unix秒，误差不超过300秒
X-Brclio-Nonce: 16~80字符，字母数字下划线连字符
X-Brclio-Signature: HMAC-SHA256 十六进制
```

签名原文用换行连接，最后没有换行：

```text
大写HTTP方法
URL pathname（禁止query参数）
timestamp
nonce
SHA256(原始HTTP请求体UTF-8字节)的hex
```

用 apiSecret 对原文计算 HMAC-SHA256。GET 请求体为空字符串。签名后不要重新格式化 JSON。nonce 提供请求熵；服务端依赖五分钟时窗和业务订单幂等，不持久保存 nonce。重复合法下单不会创建第二笔订单。

## 3. 网页、桌面和安卓打开收银台

- 网页：当前页面导航到 checkoutUrl。
- Electron / Tauri / macOS / Windows：使用系统默认浏览器打开。
- Android：用 HTTPS ACTION_VIEW / Custom Tabs 打开；不要把支付中心密钥放进 APK。

收银台根据当前可用产品支持电脑网站和手机网站支付。原生 Android 支付宝 SDK 尚未实现，需要另行开通 App 支付和接入。

checkoutUrl 的 `#token=` 是单订单访问令牌。不要记录或分享完整链接。收银台将令牌存入 sessionStorage，并立即清理地址栏 fragment；支付宝返回后通常可恢复同一浏览器会话。若换浏览器/关闭会话，用户从产品重新打开相同业务订单取得链接即可。支付宝同步返回只用于显示页面，不作为支付凭据。

可使用 Android App Links / iOS Universal Links 接收登记的 HTTPS 返回地址；没有配置系统链接时就显示产品网页。当前支付中心不接受任意自定义 scheme 回跳。

## 4. 签名通知与幂等开通

支付中心向登记的 webhookUrl POST JSON：

```json
{
  "id":"evt_pay_01234567890123456789012345678901",
  "type":"payment.paid",
  "mode":"live",
  "createdAt":"2026-10-13T14:00:00.000Z",
  "data":{
    "orderId":"pay_01234567890123456789012345678901",
    "productOrderId":"你的业务订单号",
    "clientId":"my-product",
    "sku":"pro-month",
    "amount":"9.90",
    "currency":"CNY",
    "tradeNo":"支付宝交易号",
    "paidAt":"2026-10-13T14:00:00.000Z"
  }
}
```

`paidAt` 是支付中心确认时间。通知请求头：`X-Brclio-Event`、`X-Brclio-Timestamp`、`X-Brclio-Signature`。签名为 `HMAC-SHA256(webhookSecret, timestamp + '.' + 原始JSON请求体)`；校验五分钟时窗，先验签再解析。可使用 `verifyPaymentEvent()`，它默认仅接受 `mode=live`。

**必须落库幂等**：唯一键 event.id；校验业务订单归属、clientId、SKU、金额、币种；开通权益与“该事件已处理”放在同一持久事务里。相同事件再次到达也返回 2xx。先返回 200 后异步开通会丢失可靠性，禁止这样做。不要用内存 Set 去重。

所有 2xx 都视作产品已接收。其它状态、超时和重定向都会重试，事件 ID 保持不变；投递请求的时间戳和签名重新计算。五分钟定时任务处理队列，失败指数退避，最大间隔24小时，持续保留未成功事件。至少一次投递意味着产品必须容忍重复。

`fulfillmentStatus:delivered` 表示回调返回 2xx，支付中心无法直接证明产品权益确实已生效。产品要在权益提交后返回成功，并在自己的账单页读取实际权益状态。

## 5. 查询与返回页

```js
const order = await pay.getOrder(paymentOrderId); // GET /api/v1/orders/:id
const refreshed = await pay.refreshOrder(paymentOrderId); // POST .../:id/refresh
```

查询只允许该产品的订单。产品还须限制为当前登录用户自己的业务订单。`refresh` 主动向支付宝查单，单订单最多每60秒一次；普通 GET 不调用支付宝，不写订单。读取仍消耗 GitHub API 配额，优先低频或按需查询，停止等待后关闭轮询。

返回地址附带 `payment_order_id`、`product_order_id`；这两个字段都可被用户伪造，只用于找订单。返回页调用产品自己的后端查单。必须确认 `status=PAID`、`mode=live`、正确 SKU 和金额，再走与 webhook 相同的幂等权益事务（或等待回调）。`PENDING` 不能开通，`CLOSED` 不能继续付款。过期但尚未查到支付宝终态的订单可能仍为 PENDING，收银台会阻止再次发起。

## 6. 沙箱、失败与验收

沙箱必须使用单独 Worker、独立 GitHub 数据仓库、沙箱应用/网关和独立产品密钥及测试回调。不可切换现有生产账本的模式。订单与通知都保存 mode，生产接收端拒绝沙箱事件。

错误统一为 `{ "error": { "code": "...", "message": "..." } }`。401 是签名/时钟问题，409 包括重复业务订单内容冲突或支付环境不符，503 表示配置未完成/收款未启用/存储或提供方暂不可用。网络失败重试下单时必须复用相同 productOrderId。

验收顺序：无效签名拒绝 → 客户端改价拒绝 → 不同产品/用户不能查他人订单 → 重复通知只开通一次 → webhook失败后能重试 → 沙箱事件不会开通正式权益 → 支付宝真实小额付款（人工完成） → 实际产品权益落库 → 用户返回后可见已开通。

GitHub 存储有请求配额和延迟，适用于低交易量；高流量前必须按真实请求数量压测并评估存储架构。当前没有订阅自动扣款、原生 App SDK、退款 API 或退款后的自动权益撤销。
