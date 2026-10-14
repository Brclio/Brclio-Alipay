# Brclio Pay 接入协议

## 单产品接入授权

`BRCLIO_PAY_BASE_URL` 默认为 `https://pay.bornforthis.cn`。临时令牌通过 `Authorization: Bearer …` 发送，仅用于以下接入管理 API，不用于正常支付请求。

| 方法与路径 | 请求 / 作用 |
| --- | --- |
| `GET /api/integration/v1/skill.zip` | 使用同一个临时 Bearer 授权下载通用 Skill 包；不通过 URL 传递凭证，解压到任务临时目录即可使用 |
| `GET /api/integration/v1/context` | `{clientId,mode,paymentMode,pricingMode,domainMode,allowedOrigins,expiresAt,client,credentials,payBaseUrl,docsUrl}`；`client` 为当前配置或 null，凭证只属于目标产品，不输出它 |
| `POST /api/integration/v1/plan` | `{ "config": {…}, "expectedVersion": "absent"或当前版本 }`；返回 `{planId,clientId,mode,baseVersion,expiresAt,before,after,addedOrigins}` |
| `POST /api/integration/v1/apply` | `{ "planId": "…" }`；返回 `{client,credentials,appliedAt}`，应用同一授权目标的有效计划 |

`mode` 为 `create` 或 `update`，表示授权操作；`paymentMode` 为 `live` 或 `sandbox`，表示实际支付环境。`pricingMode=detect/manual` 指项目读取/人工指定商品规则；`domainMode=auto/fixed` 指允许 AI 为该产品增加必要来源/固定域名范围。缺省 pricingMode=detect、domainMode=fixed，以兼容旧授权。`ClientView` 为 `{id,name,webhookUrl,returnOrigins,skus,enabled,version}`；版本是目标配置的 SHA-256。使用 `context.client?.version ?? 'absent'` 作为 expectedVersion。新产品 context 中 client / credentials 都为 null；创建应用后才返回凭证。

fixed 模式新增/变更来源须满足 context.allowedOrigins。auto 模式允许空初始来源：AI 根据目标项目路由提交合法公网 HTTPS 来源，plan 用 `addedOrigins` 展示，apply 原子纳入该授权记录（累计最多 100 个），管理员可查看。自动来源模式不授予其他平台、DNS、域名购买或产品仓库权限；不应添加无关来源。两种模式都可以在合法来源内设计具体路径。

根据实际 context 响应使用返回的产品 ID、环境和版本，不把示例当作现状。授权过期/撤销（401、403）、目标不符、计划过期或并发版本冲突时停止依赖该结果的变更；不要反复重试写入。需要时重新读取 context，保留用户已完成的实现。

计划的 `config` 不包含凭证，结构如下；使用真实业务内容替换示例：

```json
{
  "config": {
    "id": "target-product-id",
    "name": "产品名称",
    "webhookUrl": "https://product.example/api/brclio-payment",
    "returnOrigins": ["https://product.example"],
    "skus": {"pro": {"subject": "产品 Pro", "amount": "9.90", "enabled": true, "description": "真实商品说明", "entitlement": "真实权益及有效期"}},
    "enabled": true
  },
  "expectedVersion": "absent"
}
```

金额为大于零、两位小数的 CNY 字符串。登记明确的 HTTPS origin；不要为了省事开放所有域名。`brclio.com` 和子域名可按业务配置，但统一支付域名不替代支付宝对经营主体、商品和域名的审核。

商品必填 subject（最多 120 字）和 amount；可选 enabled（默认 true，false 停售）、description（最多 500 字）、entitlement（最多 1000 字）。权益说明不是支付中心的自动开通逻辑；目标产品必须实现对应规则。detect 先从后端商品配置、已有只读权限的套餐记录及定价文档取证，再与前端交叉核对；manual 按用户明确规则填写。缺失或冲突时询问用户，不编造。改价同时安排产品展示/下单和金额校验更新，旧业务订单按创建时金额与权益快照继续处理。

detect 必须确认币种；中心只有人民币 CNY。项目现有 USD 等外币金额不能直接当人民币或自行换汇，需用户提供人民币收费规则。

## 正常支付 API

正常支付使用**产品长期 API Secret 的 HMAC**，不是临时接入令牌：

- `GET /api/v1/catalog`：读取当前产品公开目录 `{clientId,name,enabled,mode,currency:'CNY',version,skus:{SKU:{subject,amount,enabled,description?,entitlement?}}}`，不含凭证。总收款开关关闭时仍可读配置齐全的目录。产品停用或商品停售应停止新购买。
- `POST /api/v1/orders`，JSON `{productOrderId,sku,returnUrl}`；返回付款订单与包含令牌 fragment 的 `checkoutUrl`。
- `GET /api/v1/orders/:id`，读取持久化状态。
- `POST /api/v1/orders/:id/refresh`，请求受节流的补偿查询，可发送 `{}`。

头字段为 `X-Brclio-Client`、`X-Brclio-Timestamp`（Unix 秒）、`X-Brclio-Nonce`（`[A-Za-z0-9_-]{16,80}`）和 `X-Brclio-Signature`（十六进制 HMAC-SHA256）。允许时间偏差为 5 分钟。服务端 API 不接受 query string。

签名原文为 `METHOD_UPPERCASE + '\n' + pathname + '\n' + timestamp + '\n' + nonce + '\n' + sha256_hex(rawBody)`，末尾无额外换行。GET 的 body 为空字符串。签名后不能改变 JSON 空白、顺序或编码。

`(clientId, productOrderId)` 保持唯一。相同内容重复创建取得同一付款订单；修改 SKU 或返回地址应使用新的业务订单号。保持原产品业务订单、用户和购买资格为权威，不让客户端改价。付款状态包括 `PENDING`、`PAID`、`CLOSED`；权益投递状态 `delivered` 仅表示产品确认接收通知。

模板提供 `pay.catalog()`。产品通过自己的后端读取目录展示/校验启用商品，不缓存或明确短缓存；不能把支付凭证给客户端，也不能将价格长期固化在构建产物里。只有实现了目录读取的产品会读取后台新价，旧产品不会凭空自动更新。目录 entitlement 仅说明，实际开通规则修改仍需产品实现。

目录读取与创建订单之间可能发生改价。产品业务订单记录用户已确认报价及实际权益规则快照，再核对 `createOrder` 响应的 SKU/amount（当单权威）：不一致就不向用户放出 checkoutUrl，提示确认新报价，并以新业务订单号重建。确认一致后持久保存支付订单 ID、金额及权益快照，再交付收银台链接。旧 webhook 按该笔业务订单快照核对，禁止拿最新目录验证旧付款。

## 产品 webhook 与持久开通

付款事件是至少一次投递。请求头：

- `X-Brclio-Event`：稳定事件 ID。
- `X-Brclio-Timestamp`：此次投递的 Unix 秒。
- `X-Brclio-Signature`：`HMAC-SHA256(webhookSecret, timestamp + '.' + rawBody)` 的十六进制值。

验证原始请求体后解析。事件结构为 `{id,type:'payment.paid',mode:'live'|'sandbox',createdAt,data:{orderId,productOrderId,clientId,sku,amount,currency:'CNY',tradeNo,paidAt}}`。要求 header 事件 ID 与 body 一致，环境与当前产品接收端一致，订单和金额与原产品存储一致。默认只接受 live 事件；隔离的测试接收端才能接受 sandbox。

在产品数据库事务中：读取对应业务订单和用户、核对 SKU/金额/环境、以事件 ID 或付款订单 ID 唯一去重、写入权益、更新业务订单。已经提交的重复事件也返回 2xx；临时数据库故障返回非 2xx，让支付中心重试。先返回成功再异步但无持久保证地开通会丢单。

付款回跳 URL 不是权益凭证。跨浏览器、未安装支付宝、系统回到不同应用时仍依赖后端 webhook/查单；不要承诺原生应用必然自动回到前台。
