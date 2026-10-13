# Brclio Pay 接入协议

## 单产品接入授权

`BRCLIO_PAY_BASE_URL` 默认为 `https://pay.bornforthis.cn`。临时令牌通过 `Authorization: Bearer …` 发送，仅用于以下接入管理 API，不用于正常支付请求。

| 方法与路径 | 请求 / 作用 |
| --- | --- |
| `GET /api/integration/v1/skill.zip` | 使用同一个临时 Bearer 授权下载通用 Skill 包；不通过 URL 传递凭证，解压到任务临时目录即可使用 |
| `GET /api/integration/v1/context` | `{clientId,mode,paymentMode,allowedOrigins,expiresAt,client,credentials,payBaseUrl,docsUrl}`；`client` 为当前配置或 null，凭证只属于目标产品，不输出它 |
| `POST /api/integration/v1/plan` | `{ "config": {…}, "expectedVersion": "absent"或当前版本 }`；返回 `{planId,clientId,mode,baseVersion,expiresAt,before,after}` |
| `POST /api/integration/v1/apply` | `{ "planId": "…" }`；返回 `{client,credentials,appliedAt}`，应用同一授权目标的有效计划 |

`mode` 为 `create` 或 `update`，表示授权操作；`paymentMode` 为 `live` 或 `sandbox`，表示实际支付环境，不能混用。`ClientView` 为 `{id,name,webhookUrl,returnOrigins,skus,enabled,version}`；版本是目标配置的 SHA-256。使用 `context.client?.version ?? 'absent'` 作为 expectedVersion。新产品 context 中 client / credentials 都为 null；创建应用后才返回凭证。目标域名须满足 context.allowedOrigins 的授权限制。

根据实际 context 响应使用返回的产品 ID、环境和版本，不把示例当作现状。授权过期/撤销（401、403）、目标不符、计划过期或并发版本冲突时停止依赖该结果的变更；不要反复重试写入。需要时重新读取 context，保留用户已完成的实现。

计划的 `config` 不包含凭证，结构如下；使用真实业务内容替换示例：

```json
{
  "config": {
    "id": "target-product-id",
    "name": "产品名称",
    "webhookUrl": "https://product.example/api/brclio-payment",
    "returnOrigins": ["https://product.example"],
    "skus": {"pro": {"subject": "产品 Pro", "amount": "9.90"}},
    "enabled": true
  },
  "expectedVersion": "absent"
}
```

金额为大于零、两位小数的 CNY 字符串。登记明确的 HTTPS origin；不要为了省事开放所有域名。`brclio.com` 和子域名可按业务配置，但统一支付域名不替代支付宝对经营主体、商品和域名的审核。

## 正常支付 API

正常支付使用**产品长期 API Secret 的 HMAC**，不是临时接入令牌：

- `POST /api/v1/orders`，JSON `{productOrderId,sku,returnUrl}`；返回付款订单与包含令牌 fragment 的 `checkoutUrl`。
- `GET /api/v1/orders/:id`，读取持久化状态。
- `POST /api/v1/orders/:id/refresh`，请求受节流的补偿查询，可发送 `{}`。

头字段为 `X-Brclio-Client`、`X-Brclio-Timestamp`（Unix 秒）、`X-Brclio-Nonce`（`[A-Za-z0-9_-]{16,80}`）和 `X-Brclio-Signature`（十六进制 HMAC-SHA256）。允许时间偏差为 5 分钟。服务端 API 不接受 query string。

签名原文为 `METHOD_UPPERCASE + '\n' + pathname + '\n' + timestamp + '\n' + nonce + '\n' + sha256_hex(rawBody)`，末尾无额外换行。GET 的 body 为空字符串。签名后不能改变 JSON 空白、顺序或编码。

`(clientId, productOrderId)` 保持唯一。相同内容重复创建取得同一付款订单；修改 SKU 或返回地址应使用新的业务订单号。保持原产品业务订单、用户和购买资格为权威，不让客户端改价。付款状态包括 `PENDING`、`PAID`、`CLOSED`；权益投递状态 `delivered` 仅表示产品确认接收通知。

## 产品 webhook 与持久开通

付款事件是至少一次投递。请求头：

- `X-Brclio-Event`：稳定事件 ID。
- `X-Brclio-Timestamp`：此次投递的 Unix 秒。
- `X-Brclio-Signature`：`HMAC-SHA256(webhookSecret, timestamp + '.' + rawBody)` 的十六进制值。

验证原始请求体后解析。事件结构为 `{id,type:'payment.paid',mode:'live'|'sandbox',createdAt,data:{orderId,productOrderId,clientId,sku,amount,currency:'CNY',tradeNo,paidAt}}`。要求 header 事件 ID 与 body 一致，环境与当前产品接收端一致，订单和金额与原产品存储一致。默认只接受 live 事件；隔离的测试接收端才能接受 sandbox。

在产品数据库事务中：读取对应业务订单和用户、核对 SKU/金额/环境、以事件 ID 或付款订单 ID 唯一去重、写入权益、更新业务订单。已经提交的重复事件也返回 2xx；临时数据库故障返回非 2xx，让支付中心重试。先返回成功再异步但无持久保证地开通会丢单。

付款回跳 URL 不是权益凭证。跨浏览器、未安装支付宝、系统回到不同应用时仍依赖后端 webhook/查单；不要承诺原生应用必然自动回到前台。
