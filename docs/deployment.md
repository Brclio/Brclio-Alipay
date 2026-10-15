# Cloudflare 部署与密钥操作

## 当前结构

- Worker：`brclio-pay`。
- 域名入口：Cloudflare Pages `brclio-pay.pages.dev`，通过 service binding 调用支付 Worker。
- 自定义域名：`pay.bornforthis.cn`，在 Pages 绑定；阿里云 DNS 添加 `pay CNAME brclio-pay.pages.dev`。
- 数据仓库：`BrclioData/Brclio-Alipay-Data`（私有，main 已初始化）。
- 应用 ID：`2021007109602288`。
- 默认 `PAYMENT_ENABLED=false`。密钥缺失时 `ready=false`。
- 本机 secrets/ 不提交 Git；运行时密钥存 Cloudflare Worker Secrets。
- 管理入口 `/admin`；账户、加密注册表及单平台 AI 授权见 [接入管理](admin.md)。

## GitHub 自动部署

目标代码仓库为 `Brclio/Brclio-Alipay`，生产分支为 `main`。使用 **Cloudflare Workers Builds** 监听推送，由同一次构建顺序发布已有 Worker 和 Pages。私有账本仓库不接入构建，也不触发代码发布。

现有 Pages `brclio-pay` 是 Direct Upload 项目，不能原地切换到 Pages Git integration。保留该项目、自定义域名与 PAYMENT_BACKEND 绑定，构建通过现有 `deploy:pages` 命令上传入口；不重建项目、不修改阿里云 DNS。参见 [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) 和 [Workers Builds 配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)。

代码提供两条统一命令：

```sh
npm run ci:verify
npm run deploy:all
```

`ci:verify` 先同步 Skill 和文档，再运行类型检查、自动测试、构建与 workerd 运行时验证。测试使用临时内存凭据和模拟上游，不执行真实付款。`deploy:all` 先发布 Worker，再发布 Pages，最后执行只读 HTTPS 验收。任何步骤失败均返回非零退出码，不继续后续发布步骤。

`.github/workflows/ci.yml` 为 main 推送、Pull Request 与手动触发提供 GitHub 检查；它只有 `contents:read` 权限，不接收部署凭据，也不发布生产服务。生产发布只由 Cloudflare 这一条路径负责，避免两个发布器竞争。

### 一次性控制台绑定

在 Cloudflare 当前账户的 **Workers & Pages → Worker brclio-pay → Settings → Builds → Connect** 中选择 GitHub 仓库。注意选择 Worker，Pages 项目保持 Direct Upload。

| 配置 | 值 |
| --- | --- |
| Git repository | `Brclio/Brclio-Alipay` |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `npm ci && npm run ci:verify` |
| Deploy command | `npm run deploy:all` |
| Non-production / preview builds | 关闭，其他分支仅运行 GitHub CI |
| Build variable `NODE_VERSION` | `22` |
| Build variable `SKIP_DEPENDENCY_INSTALL` | `1`（安装由上述 `npm ci` 统一执行） |
| Build variable `CLOUDFLARE_ACCOUNT_ID` | `c8b059429c868f6d0e528f9e10325f46` |

Build API token 使用该账户内的 `Workers Scripts:Edit`、`Cloudflare Pages:Edit` 及 `Account Settings:Read` 权限。Cloudflare 自动创建的默认 Worker 构建令牌不包含 Pages 权限，不能直接用于本项目的双发布。选择已具备这些权限的令牌，或由账户持有人创建相应令牌并在 Builds 中选择；令牌只存本机 `secrets/` 或 Cloudflare 的构建 Secret，不复制到 GitHub、聊天或日志。支付宝私钥、管理密码、注册表加密 key 与私有 GitHub 账本凭据仅在原 Worker runtime Secrets 中，构建不需要它们。

第一次绑定需存在 Cloudflare GitHub App 的仓库访问授权。只需要代码仓库；本次已只读确认 Brclio 组织现有安装可访问该仓库，不代表构建触发器已经建立。若控制台要求新增 App 授权、创建认证凭据或验证账户，由账户持有人完成对应确认。

### 发布验收、重试与回退

首次绑定后推送一个提交，确认 Cloudflare Builds 自动启动，记录 Git commit、Build ID、Worker version 和 Pages deployment ID。仅看到“仓库已连接”不能证明自动发布成功。`node scripts/deployment-preflight.mjs` 检查 Worker 与域名入口的版本、环境及实际收款状态和仓库配置一致，并检查后台资源、匿名管理接口拒绝与静态 Skill ZIP 不公开；不登录后台、不创建订单、不调用支付宝。HTTPS 成功说明该连接的证书可用；域名控制台状态另用本机 `node scripts/pages-domain.mjs status` 查看。

Worker 和 Pages 是两次发布，不能视为原子部署。若 Worker 已成功、Pages 失败，先修复权限或上传问题，再从相同提交重试；不要重新生成任何业务 Secret。Cloudflare 可能跳过尚未启动的旧排队构建，但不能依赖它回滚或取消已经开始的发布。生产只使用 main，不建立第二条自动发布路径；回退用 Git revert 后推送 main，并验证两部分均更新。

自动部署只改变代码和配置。`wrangler.jsonc` 中 vars 会随发布应用，`PAYMENT_ENABLED` 仍需按人工实付验收流程控制；不能在控制台临时改开关后期待下次 Git 发布自动保留。既有 Worker Secrets 由 Wrangler 保留，流水线不执行 `bootstrap`、`prepare-secrets`、`configure-admin` 或 `secret bulk`。

**2026-10-15 绑定进度**：统一命令、CI 与只读验收已准备，195 项自动测试及全部运行时检查通过；现有 Worker 和域名入口的只读预检通过。现有 Wrangler OAuth 可发布 Worker/Pages，但 Builds API 返回 403，尚未确认生产 Git 触发器。完成控制台绑定并取得真实推送构建证据后再更新此状态。

## 商户 RSA 密钥

`node scripts/bootstrap.mjs` 生成 RSA2048 PKCS8 应用私钥以及应用公钥，已有密钥不会被覆盖。

1. 在支付宝开发设置选择密钥方式 RSA2，由账号持有人设置 `secrets/alipay-app-public.txt` 中的**应用公钥**。
2. 从支付宝下载/复制对应的**支付宝公钥**，保存在本机 `secrets/alipay-public.pem`。这不是第一步的应用公钥。
3. 查到正式收款 PID（通常以2088开头的16位标识），配置为 ALIPAY_SELLER_ID。
4. 处理应用资料与审核；本项目没有代替用户接受协议、执行付款或自动设置账户凭据。

应用私钥只留本机和 Worker Secret。不要粘贴到聊天、截图、GitHub Issue 或源码。

## GitHub 访问凭据

由账号持有人创建只允许访问 `BrclioData/Brclio-Alipay-Data` 的 fine-grained PAT，权限仅 Metadata:Read 与 Contents:Read and write。保存至自己的本机环境/Secret 管理器，设置有效期并记录轮换。也可后续改用单仓库 GitHub App installation token，但当前实现接收现成令牌，不负责签发 App token。

不要把 gh 登录使用的全账号 OAuth 凭据复制到支付 Worker。本次没有这样做。私有仓库已有 main 分支；代码每次访问会验证仓库仍是 private，拒绝公开仓库。

## 发布 Secrets

准备 GITHUB_TOKEN、ALIPAY_SELLER_ID 本机环境变量，然后：

```sh
node scripts/prepare-secrets.mjs
npx wrangler secret bulk secrets/worker-secrets.json
```

脚本读取本机应用私钥、支付宝公钥、checkout-secret.txt 和 clients.json，输出被 Git 忽略的0600权限文件。clients.json 可先为空，真实产品通过管理后台登记；配置和验收完成前保持收款关闭。不要打印该 JSON，也不要上传整个 secrets/ 目录。

所需 Secret 名称：GITHUB_TOKEN、ALIPAY_PRIVATE_KEY、ALIPAY_PUBLIC_KEY、ALIPAY_SELLER_ID、CHECKOUT_SECRET、CLIENTS_JSON。仓库名 GITHUB_REPOSITORY 不是密钥，已在 wrangler vars 中设置；生成文件仅包含真正的 Secrets。

## 管理账户、加密 key 与动态平台目录

`scripts/configure-admin.mjs` 从 stdin 接收 JSON `{email,password}`，真实输入不能写入源码、命令参数或文件。在本机交互终端可运行：

```sh
python3 -c 'import getpass,json,sys; print("管理员邮箱：",file=sys.stderr); email=input().strip(); password=getpass.getpass("管理员密码："); json.dump({"email":email,"password":password},sys.stdout)' | node scripts/configure-admin.mjs
npx wrangler secret bulk secrets/admin-worker-secrets.json
```

明文密码不落盘；被 Git 忽略的0600文件只保存邮箱、派生密码哈希及运行所需 Secret：`ADMIN_EMAIL`、`ADMIN_PASSWORD_HASH`、`ADMIN_PASSWORD_PEPPER`、`ADMIN_SESSION_SECRET`、`REGISTRY_ENCRYPTION_KEY`。重新配置账户时保留已有 pepper、会话 Secret 和加密 key。若本机文件丢失但 GitHub 已有加密注册表，先恢复原 key；新生成 key 无法恢复旧数据。

平台注册表位于 `system/clients.enc.json`，平台凭证、授权哈希、计划及审计使用 AES-256-GCM 加密保存。该记录存在时优先于 `CLIENTS_JSON`；缺 key、错误 key、密文损坏或格式错误必须报错，不退回旧配置。仅记录不存在时允许 legacy 初始化，第一次保存后由后台管理。

订单与 outbox 沿用原持久层，并非所有账本文件都由此加密。加密 key 只存 Worker Secret 和本机安全备份，不能进入数据仓库；只有仓库备份而无 key 无法恢复平台注册表。

部署时保留 `wrangler.jsonc` 中登录、接入 API 和支付 API 的限流绑定。它们限制请求频率，不提供持久订单数据库；GitHub 配额仍需按实际流量评估。管理写入使用同源 Origin 与 CSRF 验证，短期授权限制为一个平台及允许域名，不授予全局账号或商户凭据。

## 营业额报表与旧账索引补建

报表使用现有私有 GitHub 数据仓库，不增加 D1、KV、R2 或其它数据库，也不需要新 Secret。新订单、付款/关闭状态及通知送达时，源订单和报表索引在同一事务更新。发布后先在后台检查覆盖提示，旧订单未完成补建前只能把金额和列表视为部分数据。

管理员登录后可读取 `GET /api/admin/reports/summary?month=YYYY-MM`，按需附 `clientId`；订单记录为 `GET /api/admin/reports/orders`，支持 `month`、`clientId`、`status`、`limit`、`cursor`。这里仅报表白名单接口接受这些查询参数，产品支付 API 与临时接入 API 仍不接受 query。每页最多 25 笔，按创建时间倒序；最多扫描 40 个索引，短页/空页有 `nextCursor` 时仍需继续。

补建通过已登录后台或 `POST /api/admin/reports/rebuild` 执行，需同源 Origin、管理员 Cookie 和有效 CSRF。JSON 参数 `{limit?,cursor?}`，`limit` 为 1–5，默认 5。保存响应 `nextCursor` 并分批续接，直到 `coverage.complete=true`；无须让浏览器持续运行无限循环，也不要为补建改动付款总开关。补建可以安全重复，不执行支付宝交易、不改变订单或权益、不补发原先不存在的付款事件。若存在未索引记录但游标走到末尾，后续调用会重新定位遗漏记录。

`coverage.scope=ledger` 检查同仓整个账本，`missingOrders>0` 时不要把“全历史”数字当成完整总额。统计使用订单快照的整数分金额；当月成交、支付笔数、通知待送达及日趋势按上海时间的付款确认月份，待付款/已关闭按创建月份的当前状态。列表月份筛选创建月。超时而未获关闭确认仍记待付款。营业额不等于支付宝净结算或退款后净收入，通知送达也不能代替产品实际开通验收；`sandbox` 金额不计入 `live`。

容量上限沿用每 JSON 256 KiB、每事务 64 文件/1 MiB；报表每个目录前缀最多 20,000 个 JSON。月统计最多 31 个日项，全历史统计是常量字段计数，订单索引按单笔分桶。遇到 `REPORTING_CAPACITY` 或 `TRUNCATED_GIT_TREE` 应停止补建并安排归档/容量评估，不能删旧账、忽略错误或将部分结果标记为完整。GitHub 配额、并发重试和 Worker 子请求限制也会影响批量操作；短暂失败可用原游标重试。

报表索引与订单/outbox 一样保存在私有 GitHub，未使用注册表加密；只有 `system/clients.enc.json` 中的平台、授权、计划和审计属于 AES-256-GCM 加密范围。

## 验证与启用

```sh
npm run check
npm run test:runtime
npm run test:security-runtime
npm run deploy
npm run deploy:pages
```

先查看 `/api/health`。`ready=true` 只表示所需配置齐全，不能证明应用审核、产品权限或实际付款通过。

管理端线上只读检查可使用 `scripts/admin-preflight.mjs`，以标准输入提供 `{email,password}`。它检查匿名拒绝、登录、会话、平台/授权/审计读取、Skill 下载与退出，不创建平台、订单或授权。输出仅包含布尔检查及稳定错误码，不显示登录凭据。

Worker 的原生 `fetch` 使用 `redirect:manual` 并显式拒绝重定向；绑定到类属性的默认发送函数使用箭头包装以保留全局接收者。`test:security-runtime` 验证真实 workerd 网络 API 和模拟上游，防止回归为 Worker 不支持的 `redirect:error` 或丢失原生接收者。浏览器和 Node 专用脚本的请求选项按各自运行时处理。

`cloudflare/pages/wrangler.jsonc` 管理 Pages 的 PAYMENT_BACKEND 服务绑定。Pages `_worker.js` 将原始请求转发到同账号支付 Worker，密钥和五分钟 Cron 都在 Worker 中。阿里云 DNS 无需更换 nameserver；为 `pay` 添加 `CNAME brclio-pay.pages.dev`，处理同名记录冲突。Cloudflare 侧已登记自定义域名，用 `node scripts/pages-domain.mjs status` 查看证书与验证状态。

确认正式应用审核通过、电脑/手机网站支付权限可用，产品 webhook 与权益事务已部署，且准备进行人工小额实付后，再将 wrangler vars 中 `PAYMENT_ENABLED` 改为 `true` 并部署。真实付款由用户完成；验收要核实支付宝交易、GitHub 付款订单、已投递事件以及产品实际权益四处一致。

2026-10-13 商户产品页显示电脑网站支付当前单笔上限2,000元、单日上限20,000元，提额申请处理中。请以最新审核结果为准，商品价格不要超出实际额度。

`PAYMENT_ENABLED=false` 仅停止新建/新发起支付；已有订单通知、查单与队列重试继续处理，避免已付款用户被漏开通。若安全事件需要完全停服，在 Cloudflare 限制访问并人工核对未完成订单。

商户运行密钥通过 Secret 管理；已初始化平台通过后台或受限计划更新，不能用 CLIENTS_JSON 覆盖加密注册表。更新保留原 API/webhook Secret 与其他平台，版本冲突后重新读取核对。商品改价不修改历史订单金额；修改回调前评估待投递事件并让新接收端就绪。

更换 CHECKOUT_SECRET 会使旧收银台链接失效，产品后端可用相同业务订单重新取得链接。商户应用或沙箱环境变更必须使用独立账本与部署。REGISTRY_ENCRYPTION_KEY 不能随发布随意替换；密钥迁移需另行完成现有数据重加密及恢复验证。

GitHub 有全局令牌/API配额、二级限流与提交延迟；持续监控失败/重试队列。不要直接删除未完成订单、event 或 queue。Git 历史不能自然删除敏感资料，所以本项目不存买家姓名、手机号或支付账户，productOrderId 应使用不含个人信息的不透明标识。
