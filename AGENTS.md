# Brclio Pay maintenance

- 支付服务运行于 Cloudflare Worker `brclio-pay`；Pages `brclio-pay` 是阿里云外部 DNS 的子域名入口，使用 PAYMENT_BACKEND 服务绑定。保留阿里云 DNS，不改根域名 nameserver。
- 持久订单与 outbox 仅存 `BrclioData/Brclio-Alipay-Data` 私有仓库；不得引入 D1、KV、R2 或新数据库，除非用户改变该约束。
- `docs/integration.md` 是产品接入约定，`examples/` 是服务端实现示例。接口变更必须同步文档和示例。
- `/admin` 是平台接入管理；通用 Skill 位于 `skills/brclio-pay-integrate/`，运行 `node scripts/build-skill.mjs` 同步示例模板和 Worker 内置下载内容。复制的 AI 任务须自包含完整 Skill，并允许用同一受限 Bearer 授权下载包；不能依赖用户另附 ZIP。
- 管理密码只通过 stdin 交给 `scripts/configure-admin.mjs`，明文不落盘、不进入命令历史。保留现有 REGISTRY_ENCRYPTION_KEY；已有加密注册表时禁止重新生成 key 覆盖，不能因解密失败退回 legacy CLIENTS_JSON。
- 平台注册表仅在私有 GitHub 保存 AES-256-GCM 密文。只有加密记录不存在时才允许 legacy 初始化；订单/outbox 不属于注册表加密，文档不要声称所有数据都加密。
- AI 授权最多两小时，绑定一个 clientId、create/update 操作，可撤销；domainMode=fixed 限制已填来源，domainMode=auto 是用户明确授权 AI 自动新增该平台所需公网 HTTPS 来源，plan 展示 addedOrigins、apply 原子记录来源和审计。旧授权默认 fixed；自动模式不能突破单平台、有效期或产品仓库权限。pricingMode=detect/manual 支持项目套餐取证或人工规则；mode=create/update 与 paymentMode=live/sandbox 分开。context/plan/apply 不能泄露其他平台或商户/全账号凭据，修改使用单平台 CAS 并保留原长期密钥、其他平台与历史订单。
- /admin 提供经营概览、订单记录、商品与价格、AI接入、平台与授权。营业额是已确认付款总额，按上海付款日期/环境隔离统计，不能宣称支付宝净结算或退款后净收入。统计索引与付款账本同事务幂等更新，旧账覆盖不足必须提示并分批补建；不能默默漏算旧订单。
- 商品支持停售及说明；改价仅影响新单，旧订单/通知按历史快照。GET /api/v1/catalog 是单产品签名目录，首次AI接入要实现产品后端目录读取和报价核对；变价竞争时不能悄悄放行付款，权益文案不等于实际权益执行逻辑。
- 改价不能改变历史订单金额；修改回调需评估待投递事件。停用平台阻止新建/新发起支付，已有通知、查单及重试继续。撤销临时授权不等于撤销已发给产品的长期凭证或回滚已应用配置。
- 所有 Secret 只在本机 secrets/ 与 Cloudflare Secrets；禁止打印、提交、嵌入前端、APK 或桌面包。不要读取并传播全账号 gh OAuth token。
- 价格从服务端 SKU 取值；浏览器 return_url 不能确认付款；验签后核对 AppID、PID、金额、订单号；订单和待发送事件原子写入；通知至少一次投递，产品权益必须幂等。
- live/sandbox 使用独立部署、账本、密钥和回调。禁止把沙箱事件用来开通正式权益。
- 支付核心变更运行 npm run check 与 npm run test:runtime；运行时测试使用临时内存密钥，不执行真实付款。保持 SDK payload debuglog 关闭与上海时区时间戳。
- 发布 Worker 用 npm run deploy；发布 Pages 入口用 npm run deploy:pages。域名状态用 node scripts/pages-domain.mjs status 检查，命令不打印凭据。
- 未完成应用审核、产品配置与人工实付验收前保持 PAYMENT_ENABLED=false。分别报告代码验证、部署、域名证书、真实到账、产品实际开通证据。
