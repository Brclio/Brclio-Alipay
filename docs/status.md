# 交付状态 · 2026-10-13

## 已完成

- 通用支付中心：服务端签名下单、固定 SKU 价格、电脑/手机网站支付收银台、返回产品、订单查询、主动查单、严格 RSA2 异步通知校验、Git 原子付款/outbox、通知签名与重试。
- Cloudflare Worker `brclio-pay` 已部署，五分钟 Cron 已生效。Cloudflare Pages `brclio-pay` 通过服务绑定转发给 Worker，未使用 Vercel。
- 正式域名 https://pay.bornforthis.cn 已绑定；Cloudflare 域名验证为 active，阿里云权威 DNS 为 `pay CNAME brclio-pay.pages.dev`。HTTPS 首页、健康检查、接入文档均返回200。
- 数据使用用户指定的 `BrclioData/Brclio-Alipay-Data` 私有仓库，main 已初始化，令牌的仓库读取与初始化写入已成功。此前自动创建的空数据仓库已归档，不作为运行时账本。
- 应用公钥已确认与本机私钥配对。应用私钥、支付宝公钥、收款 PID、GitHub Token、CHECKOUT_SECRET、CLIENTS_JSON 已配置为 Worker Secrets，未进入源码或文档。
- 86项测试、TypeScript检查、Wrangler构建通过；真实 workerd 验证 RSA2 请求签名、原始响应验签、通知验签、篡改拒绝、HMAC、上海时间戳、SDK敏感调试日志抑制。生产依赖审计0漏洞。
- 本地浏览器验证桌面与390px手机布局，以及测试订单待付款→已付款待通知→通知送达、会话恢复和令牌移除。线上 HTTP 验证通过；浏览器工具超时，未取得线上截图。
- AI接入指南、服务端客户端示例、webhook事务接入示例、产品注册脚本及支付宝应用资料已提供。

## 当前收款状态

`PAYMENT_ENABLED=false`，`CLIENTS_JSON=[]`。用户要求先开发通用服务、后接实际产品，所以没有编造商品或业务订单，健康检查目前返回 ready:false、acceptingPayments:false。

用户已确认提交支付宝应用审核。正式只读查单能够验证支付宝响应签名，但最近一次返回 `isv.not-online-app`（应用未上线）。这不是付款成功证据。没有执行真实收款、退款或实际产品权益开通。

## 后续接入

1. 应用审核通过后，运行 `node scripts/alipay-preflight.mjs` 检查正式只读查询；返回签名必须有效，预期不存在的测试订单应返回 ACQ.TRADE_NOT_EXIST。
2. 按 docs/integration.md 登记首个真实产品、SKU、价格、返回域名和已部署的 webhook。把独立产品凭据放到该产品后端 Secrets。
3. 更新 Worker 的 CLIENTS_JSON，完成产品验签、金额/业务订单校验和持久事务幂等开通测试，再明确启用收款。
4. 由用户完成真实小额付款；核对支付宝交易、GitHub订单、签名通知与实际权益。该阶段才能确认正式收款与开通闭环。

电脑网站支付商户页当前显示单笔≤2,000元、单日≤20,000元，提额处理中。实际额度以平台最新结果为准。
