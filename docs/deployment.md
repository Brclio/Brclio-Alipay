# Cloudflare 部署与密钥操作

## 当前结构

- 目标 Cloudflare 账号：`aiyuechuang@gmail.com`，Account ID `cacceff607775c81f667b7a951d4639f`；本机 Wrangler、根 Worker 配置和 Pages 部署包装脚本均指向此账号。
- 目标 Worker：`brclio-pay`，原生入口 `https://brclio-pay.aiyuechuang.workers.dev`。
- 目标域名入口：Cloudflare Pages `brclio-pay-aiyuechuang`，入口 `https://brclio-pay-aiyuechuang.pages.dev`，通过已验证的同账号 `PAYMENT_BACKEND` service binding 调用目标 Worker。
- 公开入口保持 `https://pay.bornforthis.cn`，已迁到目标 Pages；阿里云 `pay` CNAME 已改为 `brclio-pay-aiyuechuang.pages.dev`，目标域名、验证与证书状态均为 `active`。根域名 nameserver 保留阿里云。
- 数据仓库：`BrclioData/Brclio-Alipay-Data`（私有，main 已初始化）。
- 应用 ID：`2021007109602288`。
- 首次未完成验收时 `PAYMENT_ENABLED=false`；现有正式服务经此前授权为 `true`，维护时保留。密钥缺失时 `ready=false`。
- 本机 secrets/ 不提交 Git；2026-10-18 用户选择 Worker 运行时变量在控制台使用 Text 明文维护，详见 [环境变量说明](environment-variables.md)。构建令牌仍使用 Secret。
- 管理入口 `/admin`；账户、加密注册表及单平台 AI 授权见 [接入管理](admin.md)。

## 2026-10-18 账号迁移进行中

目标账号的 Worker 与 Pages 已部署，18 项 Text 运行变量已配置，原 11 项敏感变量与既有备份逐项一致。目标 Worker、目标 Pages 和公开域名三个入口共同通过 42 次 GET 连续性核对，能够解密原平台注册表、读取固定私有仓库 `main` 的全部 3 笔既有订单，并使用原产品签名及原收银台令牌读取这些订单，队列与报表核对通过。目标 Pages 项目 ID 为 `4be13ccb-e737-4267-8b79-eb59d94c8767`，已验证的首次迁移部署 ID 为 `815dd7cc-438a-4aa2-88ff-71021d98ba90`，同账号服务绑定已验证；最终代码提交与发布 ID 以 [交付状态](status.md) 的后续记录为准。产品长期 API/webhook 密钥、商户、付款环境、公开 `PAY_BASE_URL`、订单快照与数据仓库均保留。

用户已只修改阿里云 `pay` CNAME，`8.8.8.8` 与 `1.1.1.1` 均解析到目标 Pages，目标自定义域名的状态、验证与证书均为 `active`，公开 HTTPS 入口已通过上述核对。源 Worker 的 Cron 已清空验证，旧 main 构建触发器已备份并删除，源账号活跃触发器为 0；旧自定义域名已成功解绑，解绑后目标状态仍均为 active，Worker 与公开域名部署预检全部通过。旧 Worker 和 Pages 的默认入口保留回退。

目标 `*/5 * * * *` Cron 配置已核对。源 Cron 停用后，账本仍出现既有订单查单时间推进，构成目标补偿任务运行的间接证据；尚未取得带目标账号归属的定时调用日志，不能声称已完成独立的调度事件追踪。

目标账号自动发布尚未完成：Brclio 连接记录的 `has_valid_oauth_token=false`，CI/令牌管理 API 返回 403，内置浏览器操作持续超时，仍需恢复目标关联、配置构建令牌并验证触发器。当前使用受控手动发布；源账号 2026-10-15 的成功记录不能证明目标账号已有自动发布能力。268 项测试及全部 workerd 运行时检查通过，最终提交和手动发布结果另行记录。本轮只读验证不产生新的真实付款或产品权益开通证据。

迁移不复制或初始化一套新账本，也不引入 D1、KV、R2 或新数据库。切换公开入口前后均使用同一私有 GitHub 数据仓库和原密钥；不能通过恢复旧快照覆盖迁移期间产生的订单、付款或通知状态。回退仅调整入口或部署，继续使用当前账本；保留待投递事件并核对补偿任务，避免新旧部署同时运行带来的重复投递，产品端仍必须幂等。

## GitHub 自动部署

目标代码仓库为 `Brclio/Brclio-Alipay`，生产分支为 `main`。自动发布方案使用 **Cloudflare Workers Builds** 监听推送，由同一次构建顺序发布已有 Worker 和 Pages；目标账号尚未完成这一配置，当前使用受控手动发布。私有账本仓库不接入构建，也不触发代码发布。

目标 Pages `brclio-pay-aiyuechuang` 使用 Direct Upload，构建通过 `deploy:pages` 上传入口，绑定同账号 Worker `brclio-pay`；源账号项目 `brclio-pay` 保留回退，不参与目标账号日常发布。Direct Upload 项目不能原地切换到 Pages Git integration。Wrangler 4.150 对新名称执行 `pages project create` 时会转交 Workers 创建流程；需要先通过 Cloudflare Pages API 创建真正的 Pages 项目，再执行现有 `deploy:pages` 命令，不能把同名普通 Worker 当作 Pages 项目。参见 [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) 和 [Workers Builds 配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)。

Pages 的 Wrangler 配置不支持 `account_id`，不能把根 Worker 配置的账号字段复制进去。`npm run deploy:pages` 通过 `scripts/deploy-pages.mjs` 读取根 `wrangler.jsonc` 的 `account_id`，以子进程环境变量 `CLOUDFLARE_ACCOUNT_ID` 传给 Wrangler，并从 `cloudflare/pages/wrangler.jsonc` 读取项目名后部署；已有 shell 账号变量不会覆盖根配置的目标账号。

代码提供两条统一命令：

```sh
npm run ci:verify
npm run deploy:all
```

`ci:verify` 先同步 Skill 和文档，再运行类型检查、自动测试、构建与 workerd 运行时验证。测试使用临时内存凭据和模拟上游，不执行真实付款。`deploy:all` 先发布 Worker，再发布 Pages，最后执行只读 HTTPS 验收。任何步骤失败均返回非零退出码，不继续后续发布步骤。

`.github/workflows/ci.yml` 为 main 推送、Pull Request 与手动触发提供 GitHub 检查；它只有 `contents:read` 权限，不接收部署凭据，也不发布生产服务。生产发布只面向目标 Cloudflare 账号；完成 Builds 前按下述命令手动发布，不恢复源账号触发器或建立第二条自动发布路径。

### 一次性控制台绑定

确认 Cloudflare 登录邮箱为 `aiyuechuang@gmail.com`、Account ID 为 `cacceff607775c81f667b7a951d4639f`，再在 **Workers & Pages → Worker brclio-pay → Settings → Builds → Connect** 中选择 GitHub 仓库。注意选择目标账号的 Worker，Pages 项目保持 Direct Upload；浏览器登录与本机 Wrangler 登录分别核对，不能仅凭项目同名判断账号。

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
| Build variable `CLOUDFLARE_ACCOUNT_ID` | `cacceff607775c81f667b7a951d4639f` |
| Build variable `WRANGLER_SEND_METRICS` | `false` |

Build API token 使用目标账户范围的 `Workers Scripts:Edit`、`Cloudflare Pages:Edit` 及 `Account Settings:Read` 权限；若同一令牌还用于 API 管理构建连接、令牌与触发器，另需用户范围的 `Workers Builds Configuration:Edit`。仅有 Worker/Pages 发布权限不能保证 Builds 配置 API 可用。Cloudflare 自动创建的默认 Worker 构建令牌不包含 Pages 权限，不能直接用于本项目的双发布。选择已具备相应权限的令牌，或由账户持有人创建并在 Builds 中选择；令牌只存本机 `secrets/` 或 Cloudflare 的构建 Secret，不复制到 GitHub、聊天或日志。支付宝私钥、管理员派生配置、注册表加密 key 与私有 GitHub 账本凭据属于 Worker 运行时配置，按 [最新维护约定](environment-variables.md#2026-10-18-维护约定) 使用控制台 Text；构建不需要它们，也不保存管理员明文密码。

第一次绑定需存在 Cloudflare GitHub App 的仓库访问授权。构建只连接代码仓库，不连接 BrclioData 私有账本。2026-10-15 的 App 重装及账户关联发生在源账号 `hibrclio@gmail.com`，不是目标账号有效连接的证明。2026-10-18 已发现目标账号存在 Brclio 连接但 OAuth 无效，应优先恢复该目标关联，不能直接卸载共享 App。若控制台要求新增 App 授权、创建认证凭据或验证账户，由账户持有人完成对应确认。

若 GitHub 已安装 App，但 Cloudflare 找不到 Brclio 仓库或连接返回 `8000008`（Git account disconnected），需检查该安装是否关联当前 Cloudflare 账户；已有安装不能证明关联有效。Cloudflare 建议一个 GitHub 账户只关联一个 Cloudflare 账户，Workers 与 Pages 共用 App。通过当前账户的连接入口重新授权；确需卸载重装时，只处理 Brclio 组织中的 Cloudflare Workers and Pages，保留原仓库授权范围，并先评估相关项目的新构建会暂停。已部署服务仍继续托管。参见 [GitHub 集成与重新安装](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/#reinstall-the-cloudflare-github-app)。

### 发布验收、重试与回退

首次绑定后推送一个提交，确认 Cloudflare Builds 自动启动，记录 Git commit、Build ID、Worker version 和 Pages deployment ID。仅看到“仓库已连接”不能证明自动发布成功。`node scripts/deployment-preflight.mjs` 检查 Worker 与域名入口的版本、环境及实际收款状态和仓库配置一致，并检查后台资源、匿名管理接口拒绝与静态 Skill ZIP 不公开；不登录后台、不创建订单、不调用支付宝。HTTPS 成功说明该连接的证书可用；域名控制台状态另用本机 `node scripts/pages-domain.mjs status` 查看。

Worker 和 Pages 是两次发布，不能视为原子部署。若 Worker 已成功、Pages 失败，先修复权限或上传问题，再从相同提交重试；不要重新生成任何业务 Secret。Cloudflare 可能跳过尚未启动的旧排队构建，但不能依赖它回滚或取消已经开始的发布。生产只使用 main，不建立第二条自动发布路径；回退用 Git revert 后推送 main，当前阶段还须按同一提交手动发布，Builds 完成并验证后才可依赖自动发布；始终验证两部分均更新。

自动部署只改变代码和配置。`wrangler.jsonc` 中 7 项 vars 会随发布应用，仍以代码为准；`PAYMENT_ENABLED` 不能在控制台临时改动后期待下次 Git 发布自动保留。维护配置使用 `keep_vars: true` 保留控制台独有的敏感 Text 项，不把真实值写进仓库；同名 vars 仍按代码覆盖。流水线不执行 `bootstrap`、`prepare-secrets`、`configure-admin` 或 `secret bulk`。详见 [配置来源与发布规则](environment-variables.md#配置来源与发布规则)。

**2026-10-15 源账号历史绑定配置**：`hibrclio@gmail.com`（Account ID `c8b059429c868f6d0e528f9e10325f46`）的仓库连接已建立，Worker 只有一个生产触发器 `b3209105-b573-4810-b91b-f04ca466a8d9`，分支仅 `main`，构建/发布命令及四项变量按当时源账号配置。专用令牌已登记在源账号 Cloudflare Builds。统一验证包含 195 项自动测试及运行时检查，GitHub CI 的 `ab0f353` 提交验证成功。迁移后的目标账号不能复用这一验收结论；某次发布是否成功，仍须按该提交的 `build_outcome=success`、Worker version、Pages deployment 和 HTTPS 验收结果判断。

## 商户 RSA 密钥

`node scripts/bootstrap.mjs` 生成 RSA2048 PKCS8 应用私钥以及应用公钥，已有密钥不会被覆盖。

1. 在支付宝开发设置选择密钥方式 RSA2，由账号持有人设置 `secrets/alipay-app-public.txt` 中的**应用公钥**。
2. 从支付宝下载/复制对应的**支付宝公钥**，保存在本机 `secrets/alipay-public.pem`。这不是第一步的应用公钥。
3. 查到正式收款 PID（通常以2088开头的16位标识），配置为 ALIPAY_SELLER_ID。
4. 处理应用资料与审核；本项目没有代替用户接受协议、执行付款或自动设置账户凭据。

应用私钥只留本机受限备份和 Worker 运行时配置；控制台 Text 的选择、可读维护代价及边界见 [环境变量说明](environment-variables.md)。不要粘贴到聊天、截图、GitHub Issue 或源码。

## GitHub 访问凭据

由账号持有人创建只允许访问 `BrclioData/Brclio-Alipay-Data` 的 fine-grained PAT，权限仅 Metadata:Read 与 Contents:Read and write。保存至自己的本机环境/Secret 管理器，设置有效期并记录轮换。也可后续改用单仓库 GitHub App installation token，但当前实现接收现成令牌，不负责签发 App token。

不要把 gh 登录使用的全账号 OAuth 凭据复制到支付 Worker。本次没有这样做。私有仓库已有 main 分支；代码每次访问会验证仓库仍是 private，拒绝公开仓库。

## 首次 Secret 上传与恢复

以下保留默认安全的 Secret 上传方式，供首次采用 Secret 管理或明确恢复 Secret 类型时使用。**它会把相应变量上传为 Secret 类型，不是当前 Text 维护约定下的日常发布步骤。** 已部署服务仅改变显示类型时，应保留原值，按 [环境变量说明](environment-variables.md) 在原 Worker 运行时设置中维护；不能上传旧备份或重新初始化生产。

准备 GITHUB_TOKEN、ALIPAY_SELLER_ID 本机环境变量，然后：

```sh
node scripts/prepare-secrets.mjs
npx wrangler secret bulk secrets/worker-secrets.json
```

脚本读取本机应用私钥、支付宝公钥、checkout-secret.txt 和 clients.json，输出被 Git 忽略的0600权限文件。clients.json 可先为空，真实产品通过管理后台登记；配置和验收完成前保持收款关闭。不要打印该 JSON，也不要上传整个 secrets/ 目录。

此文件包含原 6 项敏感变量：GITHUB_TOKEN、ALIPAY_PRIVATE_KEY、ALIPAY_PUBLIC_KEY、ALIPAY_SELLER_ID、CHECKOUT_SECRET、CLIENTS_JSON。仓库名 GITHUB_REPOSITORY 不是密钥，已在 wrangler vars 中设置；文件中即使有可公开标识也按敏感整包处理，不打印真实值。

## 管理账户、加密 key 与动态平台目录

`scripts/configure-admin.mjs` 从 stdin 接收 JSON `{email,password}`，真实输入不能写入源码、命令参数或文件。在本机交互终端可运行下列默认 Secret 初始化/恢复流程；第二条命令会恢复 Secret 类型，当前 Text 维护时应按 [环境变量说明](environment-variables.md#默认安全上传方式与本项目-text-约定) 只更新确需变更的字段并保留其余原值：

```sh
python3 -c 'import getpass,json,sys; print("管理员邮箱：",file=sys.stderr); email=input().strip(); password=getpass.getpass("管理员密码："); json.dump({"email":email,"password":password},sys.stdout)' | node scripts/configure-admin.mjs
npx wrangler secret bulk secrets/admin-worker-secrets.json
```

明文密码不落盘；被 Git 忽略的0600文件只保存邮箱、派生密码哈希及原 5 项敏感运行变量：`ADMIN_EMAIL`、`ADMIN_PASSWORD_HASH`、`ADMIN_PASSWORD_PEPPER`、`ADMIN_SESSION_SECRET`、`REGISTRY_ENCRYPTION_KEY`。重新配置账户时保留已有 pepper、会话密钥和加密 key。若本机文件丢失但 GitHub 已有加密注册表，先恢复原 key；新生成 key 无法恢复旧数据。

平台注册表位于 `system/clients.enc.json`，平台凭证、授权哈希、计划及审计使用 AES-256-GCM 加密保存。该记录存在时优先于 `CLIENTS_JSON`；缺 key、错误 key、密文损坏或格式错误必须报错，不退回旧配置。仅记录不存在时允许 legacy 初始化，第一次保存后由后台管理。

订单与 outbox 沿用原持久层，并非所有账本文件都由此加密。加密 key 只存 Worker 运行时配置和本机安全备份，当前控制台 Text 维护约定见 [环境变量说明](environment-variables.md)；不能进入数据仓库，只有仓库备份而无 key 无法恢复平台注册表。

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

`cloudflare/pages/wrangler.jsonc` 管理目标账号 Pages `brclio-pay-aiyuechuang` 的 PAYMENT_BACKEND 服务绑定。Pages `_worker.js` 将动态请求转发到同账号支付 Worker，密钥和五分钟 Cron 都在 Worker 中。阿里云 DNS 无需更换 nameserver；先验证目标 Pages 默认入口，再安排域名绑定及将 `pay` 的 CNAME 从 `brclio-pay.pages.dev` 改为 `brclio-pay-aiyuechuang.pages.dev`，随后核对证书与公开入口。用 `node scripts/pages-domain.mjs status` 查看当前配置所指目标 Pages 的域名状态；目标状态不能代替源入口或实际 DNS 检查。

公开静态文件仅精确放行 `/styles.css`、`/admin.css`、`/admin.js`、`/checkout.js` 和 `/landing.js`：Worker 的 `assets.run_worker_first` 负模式与 Pages 的 `_routes.json` 排除名单保持一致，访问这些文件直接走平台静态分发。`public/_headers` 为直接静态响应保留与业务 Worker 相同的安全头及 `Cache-Control: no-store`，避免发布后使用过期脚本；HTML、API、付款回跳、查单和 Skill ZIP 继续经过支付 Worker。不要扩大成所有 `.js` 或所有路径的旁路。规则依据见 [Worker 静态路由](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)、[Pages 路由](https://developers.cloudflare.com/pages/functions/routing/)。

`npm run build:pages` 清理并重新生成 Pages 发布目录，同步 `_worker.js`、`_routes.json`、`_headers` 与公开文件，避免残留旧脚本。先发布 Worker，再发布 Pages；五个静态文件的内容在这次优化中未变，过渡期旧入口仍可正确转发。后续发版/回滚同样要同步两个入口。`node scripts/deployment-preflight.mjs` 对两个生产入口核对公开文件的字节哈希、MIME、安全头、禁止长期缓存，以及匿名管理与订单查询、静态 ZIP 的拒绝边界。

### 账号迁移的只读连续性核对

```sh
node scripts/verify-migration.mjs --help
node scripts/verify-migration.mjs --base https://brclio-pay.aiyuechuang.workers.dev --base https://brclio-pay-aiyuechuang.pages.dev --base https://pay.bornforthis.cn
```

脚本只发送 GET：读取固定私有仓库 `BrclioData/Brclio-Alipay-Data` 的 `main`、验证 AES-GCM 注册表可解密，核对原订单的不可变快照、状态不倒退、outbox/队列及报表一致性，再用原产品签名和收银台 HMAC 读取每个目标入口的目录和全部对应环境订单。它不调用 `/refresh`、`/pay`、管理写入或支付宝，不创建订单、不恢复数据、不补建索引、不重新投递权益。

默认仅在内存读取被 Git 忽略的原运行变量备份；用 `--runtime` 指定其他可靠备份，用 `--baseline` 指定受限迁移前快照。提供基线时，验证原注册表、历史快照和 Git 祖先历史连续性；没有基线只能证明当前一致性和可访问性。可用 `--out secrets/<新的证据文件名>.json` 创建 0600 的脱敏证据，文件必须位于 `secrets/` 内且不存在。输出仅计数、布尔值和哈希，不输出凭据、订单内容、金额或入口 URL；只传入可信目标 origin。

当前报表从已索引订单重新计算，未覆盖旧订单会单独计数，不能把部分覆盖说成全历史完整。账号身份、DNS/证书、Cron 实际执行、Builds 触发器、真实到账与产品实际开通需要分别验证；只读脚本通过不代表这些项目全部完成。

确认正式应用审核通过、电脑/手机网站支付权限可用，产品 webhook 与权益事务已部署，且准备进行人工小额实付后，再将 wrangler vars 中 `PAYMENT_ENABLED` 改为 `true` 并部署。真实付款由用户完成；验收要核实支付宝交易、GitHub 付款订单、已投递事件以及产品实际权益四处一致。

2026-10-13 商户产品页显示电脑网站支付当前单笔上限2,000元、单日上限20,000元，提额申请处理中。请以最新审核结果为准，商品价格不要超出实际额度。

`PAYMENT_ENABLED=false` 仅停止新建/新发起支付；已有订单通知、查单与队列重试继续处理，避免已付款用户被漏开通。若安全事件需要完全停服，在 Cloudflare 限制访问并人工核对未完成订单。

商户运行密钥按 [最新运行变量维护约定](environment-variables.md) 管理；已初始化平台通过后台或受限计划更新，不能用 CLIENTS_JSON 覆盖加密注册表。更新保留原 API/webhook Secret 与其他平台，版本冲突后重新读取核对。商品改价不修改历史订单金额；修改回调前评估待投递事件并让新接收端就绪。

更换 CHECKOUT_SECRET 会使旧收银台链接失效，产品后端可用相同业务订单重新取得链接。商户应用或沙箱环境变更必须使用独立账本与部署。REGISTRY_ENCRYPTION_KEY 不能随发布随意替换；密钥迁移需另行完成现有数据重加密及恢复验证。

GitHub 有全局令牌/API配额、二级限流与提交延迟；持续监控失败/重试队列。不要直接删除未完成订单、event 或 queue。Git 历史不能自然删除敏感资料，所以本项目不存买家姓名、手机号或支付账户，productOrderId 应使用不含个人信息的不透明标识。
