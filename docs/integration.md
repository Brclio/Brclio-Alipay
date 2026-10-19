# Brclio Pay 产品接入指南（交给 AI 即可）

支付中心：`https://pay.bornforthis.cn`，接入管理：`https://pay.bornforthis.cn/admin`。支付宝应用及电脑/手机网站支付权限已核实，2026-10-15 `xhs-downloader` 一笔 ¥3 日付实付已确认支付宝付款、通知送达和实际后端会员开通；临时验收关闭后，用户明确授权正式开放，正式配置为 `PAYMENT_ENABLED=true`。其他套餐、客户端、手机渠道或退款未据此标记为已实付验证。实时开关看 `/api/health` 或签名目录的 `acceptingPayments`；`ready:true` 仅表示配置齐全，首页或后台可访问都不证明某笔付款成功。

推荐在 `/admin` 登录后生成并复制完整 AI 接入任务：内含通用 Skill、单平台新增/更新范围、域名模式、套餐来源和最长 2 小时的授权。AI 无需附件即可读取 Skill，并用同一 Bearer 授权下载辅助脚本，详见 [管理后台](admin.md)。以下协议供实现和检查产品后端使用。

## 直接给产品开发 AI 的任务

> 为当前产品接入 Brclio Pay，阅读本文件及 examples/payment-client.mjs、examples/webhook-handler.mjs。先检查现有登录、业务订单和权益存储。由产品后端签名读取 GET /api/v1/catalog，展示并校验启用商品，不缓存或使用明确短缓存。新增登录用户的后端下单接口，商品使用支付中心登记的 SKU；业务订单绑定当前用户并锁定金额与实际权益快照。createOrder 响应金额若与用户确认报价不同，不放出收银台链接，让用户确认新价并用新业务订单重建。把通过核对的 checkoutUrl 交给网页/桌面/安卓客户端。实现 HTTPS 支付通知接口，基于原始请求体验签，校验 mode=live、clientId、业务订单归属、SKU、历史订单金额快照与币种；在一个持久事务中去重 event.id 并按原承诺开通权益，事务提交后才返回 2xx。权益说明字符串不能自动执行开通规则。实现当前用户订单查询和返回页，返回参数只定位订单，禁止据此认定成功。服务端密钥通过 Secret 管理，禁止进入前端、客户端包、Git、日志。保留原有业务功能。完成签名错误、金额错误、目录与下单之间改价、跨用户访问、重复通知和失败重试测试；验收须证明实际权益落库。没有真实人民币价格或业务规则时列出缺失项，不编造或自行换汇，不执行真实付款。

接入也包括付款后的客户端同步，不能停在打开付款页或服务端开通。网页返回、桌面 focus、移动 resume 和重启恢复待核实订单时查询产品后端，`PAID` 且权益仍 pending 时继续有界等待；实际权益确认后刷新账号、会员标识及功能权限。可适配无密钥的 `examples/payment-completion.mjs`，详细响应约定见第 5 节。

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

目录响应为 `{clientId,name,enabled,acceptingPayments,mode,currency:'CNY',version,skus:{SKU:{subject,amount,enabled,description?,entitlement?}}}`，不含任何密钥。`enabled` 表示当前平台是否启用，`acceptingPayments` 表示总收款开关与当前平台均允许新购买；它不证明支付宝权限、实际到账或权益开通。此接口配置齐全后可用，关闭总收款开关不影响读取。产品后端应不缓存或使用明确短缓存；框架若默认缓存服务端 fetch，须关闭该缓存，不能把目录固化为静态构建。不同语言按与正常下单相同的 HMAC 规则签名 GET 空请求体。

`acceptingPayments=false` 时保留价格展示、已有订单查单与权益处理，暂停新购买并明确提示在线收款未开放。刷新目录后可恢复购买；收款开关变化不改变商品 `version` 或历史报价。该字段为兼容新增，旧服务未返回时不可据此宣称已开放收款。目录读取后开关仍可能变化：创建订单或发起付款收到 `503 / PAYMENTS_DISABLED` 时显示固定的“在线收款尚未开放”，不把它当成网络故障盲目重试。保留原业务订单引用，恢复时复用同一请求；不要据此删除订单或开通权益。客户端模板错误对象提供 `code` 与 `status`，未知错误仍应使用脱敏提示。

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

接口 `POST /api/v1/orders`，JSON 字段只有 `productOrderId`、`sku`、`returnUrl`。新单价格和标题取支付中心目录，金额字符串用人民币两位小数。相同 clientId + productOrderId 永久幂等：相同 SKU 和返回地址的重试返回原订单快照，后台改价或改标题不改变已有订单，也不导致原请求冲突；改变请求的 SKU 或返回地址返回 409。需要重新购买当前报价时，产品后端创建新的业务订单号，并在放出付款链接前继续核对用户确认报价与原订单权威金额。

响应包含 `id`、`productOrderId`、`sku`、`amount`、`currency:"CNY"`、`status`、`expiresAt`、`mode`、`checkoutUrl`。付款期限为创建后 **10 分钟**；已有 `PENDING` 订单同样按 `createdAt + 10 分钟` 收尾。到期立即禁止再次发起付款，不会因重试创建或重新打开链接延长期限；已关闭或到期订单需要重新购买时，产品后端必须创建新的业务订单号，不能复用原 `productOrderId`。

到期收尾先验签查询支付宝：已付按正常流程确认付款；已有未付款交易须取得支付宝关单成功确认；交易不存在或已关闭时才确认本地 `CLOSED`。关单与移出补查队列、报表更新同事务完成，成功后不再周期补查。查询或关单失败时保留 `PENDING` 并重试，付款入口仍关闭。后台每 5 分钟处理到期订单，通常在下一轮关闭（无积压且上游正常时，创建后约 10–15 分钟），主动刷新也会执行收尾；期限不是后台状态已经改为 `CLOSED` 的保证。迟到且验签、环境、订单和金额均有效的付款通知仍可将 `CLOSED` 恢复为 `PAID`，产品必须继续按原订单快照幂等履约。

历史已签发的 30 分钟支付宝付款链接，其 `time_expire` 不能追溯改写；支付中心到期拒绝重新发起不等于已经撤销这些旧链接，仍需上游关单。若旧链接产生迟到的真实付款，中心和产品仍按原订单核对入账与履约。

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

支付页在 `PENDING` 时查询付款结果，在 `PAID / fulfillmentStatus=pending` 时继续 GET 查询产品通知状态；自动等待有时间与次数上限，不自动发起付款或重复执行主动查单 POST。通知送达后，live 订单倒计时返回已登记的安全 HTTPS 地址，用户可选择留在此页；sandbox 不自动返回。HTTPS 导航不能保证原生桌面应用被操作系统唤起，应用回到前台时自行查单仍是必需路径。

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

`paidAt` 优先采用已验签的支付宝 `gmt_payment` 或查单 `send_pay_date`，按上海时区解析并保存为 UTC ISO 时间；旧数据或提供方未给出付款时间时，才回退为首次中心确认时间。提供了格式无效的时间会被拒绝，已确认订单的时间与金额快照不因重试改写。事件 `createdAt` 是中心记录事件的时间，与实际付款时间可以不同。通知请求头：`X-Brclio-Event`、`X-Brclio-Timestamp`、`X-Brclio-Signature`。签名为 `HMAC-SHA256(webhookSecret, timestamp + '.' + 原始JSON请求体)`；校验五分钟时窗，先验签再解析。可使用 `verifyPaymentEvent()`，它默认仅接受 `mode=live`。

**必须落库幂等**：唯一键 event.id；校验业务订单归属、clientId、SKU、金额、币种；开通权益与“该事件已处理”放在同一持久事务里。相同事件再次到达也返回 2xx。先返回 200 后异步开通会丢失可靠性，禁止这样做。不要用内存 Set 去重。

所有 2xx 都视作产品已接收。其它状态、超时和重定向都会重试，事件 ID 保持不变；投递请求的时间戳和签名重新计算。五分钟定时任务处理队列，失败指数退避，最大间隔24小时，持续保留未成功事件。至少一次投递意味着产品必须容忍重复。

`fulfillmentStatus:delivered` 表示回调返回 2xx，支付中心无法直接证明产品权益确实已生效。产品要在权益提交后返回成功，并在自己的账单页读取实际权益状态。

## 5. 查询与返回页

```js
const order = await pay.getOrder(paymentOrderId); // GET /api/v1/orders/:id
const refreshed = await pay.refreshOrder(paymentOrderId); // POST .../:id/refresh
```

查询只允许该产品的订单。产品还须限制为当前登录用户自己的业务订单。`refresh` 主动向支付宝查单，未到期订单最多每 60 秒一次；到期订单直接执行关单收尾，不先持久化 `lastCheckedAt` 节流，查询或关单失败不会产生仅更新时间戳的提交。普通 GET 不调用支付宝，不写订单。读取仍消耗 GitHub API 配额，优先低频或按需查询，停止等待后关闭轮询。

返回地址附带 `payment_order_id`、`product_order_id`；这两个字段都可被用户伪造，只用于找订单。返回页调用产品自己的后端查单。必须确认 `status=PAID`、`mode=live`、正确 SKU 和金额，再走与 webhook 相同的幂等权益事务（或等待回调）。`PENDING` 不能开通，`CLOSED` 不能继续付款。10 分钟到期但尚未获得关闭确认的订单可能仍为 `PENDING`，收银台会阻止再次发起；产品不要将它显示为仍可付款。已关闭后重购必须新建业务订单，保留原订单以接收迟到的有效付款结果。

### 客户端等待与实际权益

产品后端向当前登录用户暴露其自己的订单状态，同时读取**该订单权益事务是否已提交**。中心 `PAID` 和 `fulfillmentStatus=delivered` 不能替代这个产品侧状态；账号原本已有会员也不能证明新购订单已履约。下面是 `examples/payment-completion.mjs` 的产品适配格式，不是新增的支付中心 API：

```json
{"productOrderId":"当前用户的业务订单号","mode":"live","paymentStatus":"PAID","entitlementStatus":"pending"}
```

`paymentStatus` 为 `PENDING / PAID / CLOSED`，`entitlementStatus` 为 `pending / active`；只有该订单实际权益事务已提交才返回 `active`。后端核对身份和归属、环境、金额与历史快照；前端不能自行从回跳参数、其他用户的订单或中心 delivered 推导 active。模板只调用产品自己的已认证后端，不含签名密钥。确认 `live + PAID + active` 后先重新读取账号及权限，再展示开通完成。

```js
import { createPaymentCompletionWatcher } from './payment-completion.mjs';
const watcher = createPaymentCompletionWatcher({
  productOrderId: savedBusinessOrderId,
  queryOrder: (id, { signal }) => productApi.getMyPaymentStatus(id, { signal }),
  refreshAccount: ({ signal }) => productApi.reloadCurrentAccountAndPermissions({ signal }),
  onState: ({ status, code }) => renderPaymentProgress(status, code),
});
await watcher.start(); // 下单后或恢复当前用户待核实订单时
// 手动查询：运行中用 check()；超时/登录恢复后用 start()。
// 组件卸载、离开、退出/切换账号前 watcher.dispose()；新用户创建新的 watcher。
```

`productApi` 与 `renderPaymentProgress` 为产品需适配的现有接口/UI，非支付中心 SDK。`queryOrder` 返回上述归一化结构；两个适配器都要传递 AbortSignal，并在更新账号缓存前复核当前会话，避免切账号时旧请求覆盖新用户。原生移动端按自身 resume 生命周期调用 start/check，挂载和卸载时清理监听。

保存按用户隔离的待核实业务订单引用，别记录带 `#token` 的 checkoutUrl；下单后、HTTPS 返回、focus/resume、重启恢复都使用同一个等待流程。默认可每 15 秒查询、最多等待 5 分钟，隐藏时暂停、恢复时立即查询，避免并发；客户端等待超时不等于服务端订单已关闭，保留订单和“查询付款与权益状态”，不要提示重复付款。收到 `CLOSED` 时结束本轮等待，可提供以新业务订单号重新购买的入口，但保留原单查证和有效付款通知处理。退出或切换账号时清理计时器/监听、取消请求并丢弃旧账号迟到响应。新一轮手动查询可重启等待。真实权益确认后同步弹窗、会员徽标、到期时间及功能授权，不能只修改提示文字。

### 由产品项目完成开放

用户已授权接入并上线收款时，产品 AI 在自己的仓库完成配置应用、后端 Secret 与回调部署、客户端状态同步以及网页/安装包发布。中心 `/api/health` 的 `ready/acceptingPayments` 和产品签名目录的 `enabled/acceptingPayments` 均为 true、live 环境与可售商品匹配后，可按授权开放产品入口，不需回支付仓库再次改总开关或部署。新产品可在其创建计划中登记 `enabled:true`；已有产品只在本次任务授权恢复时改变启用状态。

单平台临时授权不提供总开关或商户配置权限。若总开关关闭、商户权限不足、固定域名不够或授权过期，报告具体阻塞并保留已完成的产品实现。人工实付由用户在产品项目完成，随后分别核对付款、通知、实际权益与客户端显示；配置保存、模拟测试或网页发布都不能代表已安装的桌面/Android 前端已经更新。

创建成功后要修改已登记配置，需要新的 update 授权；原 create 令牌即使未过期或允许 auto 来源，也只能幂等重放原计划，不能变成更新授权。应用前先确认最终路由与商品；临时授权到期不影响已交付长期凭证和产品日常收款。

## 6. 沙箱、失败与验收

沙箱必须使用单独 Worker、独立 GitHub 数据仓库、沙箱应用/网关和独立产品密钥及测试回调。不可切换现有生产账本的模式。订单与通知都保存 mode，生产接收端拒绝沙箱事件。

错误统一为 `{ "error": { "code": "...", "message": "..." } }`。401 是签名/时钟问题，409 包括重复业务订单内容冲突或支付环境不符，503 表示配置未完成/收款未启用/存储或提供方暂不可用。网络失败重试下单时必须复用相同 productOrderId。

验收顺序：无效签名拒绝 → 客户端改价拒绝 → 不同产品/用户不能查他人订单 → 重复通知只开通一次 → webhook失败后能重试 → 沙箱事件不会开通正式权益 → 付款晚于回跳/回调延迟时持续等待 → focus/resume 与重启恢复同用户待单、切账号取消旧请求 → 支付宝真实小额付款（人工完成） → 实际产品权益落库 → 用户返回后会员标识及实际受限功能同步。

GitHub 存储有请求配额和延迟，适用于低交易量；高流量前必须按真实请求数量压测并评估存储架构。当前没有订阅自动扣款、原生 App SDK、退款 API 或退款后的自动权益撤销。
