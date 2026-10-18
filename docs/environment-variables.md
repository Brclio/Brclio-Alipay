# 环境变量维护说明

本文记录 Brclio Pay 的运行配置、用途、生成方式、存放位置及更新影响。只记录名称、非敏感配置和操作方法；真实私钥、令牌、密码哈希、pepper、加密 key 和产品凭据不进入 Git、文档、聊天或日志。

## 2026-10-18 维护约定

用户于 2026-10-18 明确选择：支付 Worker 的部署运行时变量在 Cloudflare 控制台使用 **Text / Plaintext** 类型，便于后续查看和维护。原 11 项 Secret 的转换必须沿用原值，只改变控制台存储类型，不重新生成凭据，不修改支付协议、商户、平台、商品、历史订单或通知队列。

Text 变量可由拥有相应 Cloudflare 控制台权限的人查看和复制，维护便利的代价是失去 Secret 类型的值隐藏保护。它们仍是服务端敏感配置，不因此成为公开 HTTP 接口，也不能进入前端脚本、桌面包、APK、公开静态资源或错误响应。管理员登录仍校验密码派生哈希，**不新增或保存管理员明文密码变量**。

此选择只适用于本项目 Worker 的运行时变量。Cloudflare Builds 的部署令牌仍按构建 Secret 管理；Pages 只使用原有服务绑定；产品自己的后端凭据保持原配置。私有 GitHub 中的平台注册表继续使用 AES-256-GCM 密文，订单、outbox 与报表索引沿用原持久层，不能据此声称全部数据都加密。

2026-10-18 先在源账号 `hibrclio@gmail.com` 将原 11 项 Secret 以原备份值转换为 Text；加上原有 7 项参数，共 18 项字符串运行变量。转换后逐项读取类型及比较原备份值通过，原注册表密文未改变，管理员会话校验、旧收银台签名校验及现有产品签名目录读取通过，保持 `live` 和收款开启。

随后按用户要求迁往内置浏览器登录的 `aiyuechuang@gmail.com`，Account ID 为 `cacceff607775c81f667b7a951d4639f`。目标 Worker `brclio-pay` 已部署至 `https://brclio-pay.aiyuechuang.workers.dev`，18 项运行变量均为 Text，原 11 项敏感值逐项保留，`keep_vars: true` 保留。Cloudflare 登录邮箱的变化不改变 `ADMIN_EMAIL`、商户、产品长期凭据、私有数据仓库或分支。

服务及公开域名已迁至目标账号：用户仅将阿里云 `pay` CNAME 改为 `brclio-pay-aiyuechuang.pages.dev`，`8.8.8.8` 与 `1.1.1.1` 已解析到新入口，目标域名、验证与证书状态均为 `active`。目标 Worker、Pages 和 `https://pay.bornforthis.cn` 三个入口共同通过 42 次 GET 连续性核对，原注册表、全部 3 笔历史订单和旧收银台令牌可读，队列及报表一致。

源 Cron 已停用、原 main 自动构建触发器已备份并删除，源活跃触发器为 0；旧自定义域名已解绑，目标域名状态仍均为 active，Worker 与公开域名部署预检全部通过。旧 Worker/Pages 默认入口保留回退。目标五分钟 Cron 配置已核对，源 Cron 停用后账本查单时间继续推进，属于间接运行证据，尚未取得带目标账号归属的调度调用日志。目标 Builds 的 OAuth、构建令牌和触发器尚待完成，当前使用受控手动发布。代码发布及后续部署保留须以 [交付状态](status.md) 对应 Git 提交的实际发布结果和只读验收记录为准；本轮未执行真实付款，不能据此新增资金到账或产品实际开通的验收结论。

## 配置来源与发布规则

| 配置位置 | 内容 | 后续维护方式 |
| --- | --- | --- |
| 根目录 `wrangler.jsonc` 的 `vars` | 下表 7 项非敏感运行参数 | 代码为准；修改后正常发布。同名控制台值会在发布时采用代码中的值。 |
| 目标账号 `aiyuechuang@gmail.com` → Worker `brclio-pay` → Settings → Variables and Secrets | 原 11 项 Secret 对应的 Text 变量，以及必要时配置的 `ALIPAY_GATEWAY` | 核对 Account ID；只在控制台和本机受限备份中维护真实值，不把值补进 `wrangler.jsonc`。 |
| 根目录 `wrangler.jsonc` 的 `keep_vars: true` | 保留控制台独有的变量 | 正常发布必须保留此配置，避免清除未列入仓库 `vars` 的运行凭据；它不阻止代码覆盖同名 `vars`。 |
| `cloudflare/pages/wrangler.jsonc` | 目标 Pages `brclio-pay-aiyuechuang` 的 `PAYMENT_BACKEND` 服务绑定 | 指向目标账号 Worker `brclio-pay`；不复制运行凭据，不能跨账号绑定源 Worker。 |
| 根目录 `wrangler.jsonc` 的 `account_id` 与 `scripts/deploy-pages.mjs` | Worker 与 Pages 共同的部署账号来源 | Pages Wrangler 文件不支持 `account_id`；包装脚本将根账号以 `CLOUDFLARE_ACCOUNT_ID` 注入部署子进程，并读取 Pages 配置中的项目名。 |
| Cloudflare Worker → Settings → Builds | 构建参数和专用部署令牌 | 与 Worker 运行时配置分开管理；不把支付运行凭据交给构建。 |
| 本机被 Git 忽略的 `secrets/` | 原始密钥和受限备份文件 | 目录权限 0700、敏感文件权限 0600；只保留在本机受控位置，不上传整个目录。 |

Cloudflare 控制台中“运行时变量”和“构建变量”不是同一层。运行时变量由 Worker 的 `env` 读取；构建变量供 Node、npm 和 Wrangler 发布过程使用。把密钥放进 Builds 不能替代 Worker 运行时配置。

原 Secret 类型不能从控制台重新读出值。转换前必须确认持有与当前部署一致的本机原值；没有可靠原值就保留现状并先恢复备份，不能通过重新生成来补齐。尤其不能从 `gh` 的全账号 OAuth 登录凭据猜取或替换数据仓库令牌。

## 仓库管理的 7 项运行参数

以下值是当前仓库配置，不代表每次阅读时线上一定相同。发布后使用 `/api/health` 和部署验收核对运行环境、版本及收款状态。

| 名称 | 当前仓库值 | 用途及来源 | 修改影响 |
| --- | --- | --- | --- |
| `PAY_BASE_URL` | `https://pay.bornforthis.cn` | 支付中心公开 HTTPS origin；生成收银台链接、支付宝通知和回跳地址，校验管理员同源请求。 | 只能使用无路径、查询参数和凭据的 HTTPS origin。改域名需同步 Pages 绑定、DNS、证书和产品入口，不能单独改此值。 |
| `ALIPAY_APP_ID` | `2021007109602288` | 支付宝应用标识，来自支付宝开放平台；用于签名和异步通知 AppID 核对。 | 必须与应用私钥、公钥、收款 PID、正式/沙箱环境匹配；不要在已有正式账本上直接换应用。 |
| `PAYMENT_MODE` | `live` | 支付环境，允许 `live` 或 `sandbox`；订单、事件、查询和报表按环境核对。 | 沙箱须独立部署、账本、应用、密钥和回调；不能在现有正式服务上直接改成 sandbox。 |
| `PAYMENT_ENABLED` | `true` | 新订单和新发起付款的总开关，字符串必须是 `true` 或 `false`。 | 当前正式服务有此前用户开放授权，应保留 `true`。`false` 仍允许已有通知、查单和队列重试，不删除订单或撤销权益。 |
| `ALIPAY_CHANNELS` | `page,wap` | 已开放渠道；`page` 为电脑网站支付，`wap` 为手机网站支付。 | 只启用真实已签约的渠道；以英文逗号分隔，不加入空格或未实现渠道。 |
| `GITHUB_REPOSITORY` | `BrclioData/Brclio-Alipay-Data` | 保存订单、outbox、队列、报表索引及加密注册表的私有仓库，格式 `owner/repository`。 | 不得改到公开仓库或空仓库；切换仓库会改变可见账本和注册表。维持既有私有仓库，不增加 D1、KV、R2 或新数据库。 |
| `GITHUB_BRANCH` | `main` | 数据仓库持久读写分支；存储实现省略时也默认 `main`。 | 不能通过更换分支绕过旧订单或平台注册表；迁移需单独设计并核对未完成通知。 |

`PAYMENT_ENABLED=false` 是首次部署尚未审核、配置或人工实付验收时的要求，不是维护现有已开放服务时要重置的状态。2026-10-15 的既有实付和开放记录见 [交付状态](status.md)；新增套餐、客户端或退款仍需各自验收。

## 控制台管理的 11 项敏感运行变量

下表原 Secret 类型逐项以**同名、同值**维护为 Text，账号迁移继续沿用原值。Text/Secret 对应用代码均以字符串 `env.NAME` 提供；不能以显示方式或账号调整为由改变值。没有安全的业务默认值，缺失时不得用示例值或随机值替代。

| 名称 | 用途与要求 | 原值来源 / 首次生成方式 | 后续维护与影响 |
| --- | --- | --- | --- |
| `GITHUB_TOKEN` | 读写固定私有数据仓库；不能为空或含换行。 | 账号持有人创建仅访问 `BrclioData/Brclio-Alipay-Data` 的 fine-grained PAT，权限 Metadata:Read、Contents:Read and write；在本机受限配置中保留原值。 | 记录有效期。轮换先验证新令牌具有同仓库、同分支权限，再替换并核对账本读取；禁止使用全账号 `gh` OAuth token。 |
| `ALIPAY_PRIVATE_KEY` | 商户应用 RSA2 签名私钥，RSA 至少 2048 位；支持 PKCS8/PKCS1 PEM。 | 首次 `node scripts/bootstrap.mjs` 生成 RSA2048 PKCS8，写入 `secrets/alipay-private.pem`，对应应用公钥在 `alipay-app-public.pem/.txt`。 | 既有服务保留当前私钥；更换必须与支付宝该应用已登记的应用公钥成对处理，不能仅生成新 key 并部署。保留 PEM 内容和换行。 |
| `ALIPAY_PUBLIC_KEY` | 验证支付宝签名响应及通知，RSA 至少 2048 位。 | 从对应应用的支付宝开放平台取得，原本保存到 `secrets/alipay-public.pem`。 | 这是**支付宝公钥**，不是本机生成并交给支付宝的**应用公钥**；两者不能混用。只按支付宝对应应用的公钥变更更新。 |
| `ALIPAY_SELLER_ID` | 正式收款账户 PID，用于发起支付及通知/查单核对；格式为 `2088` 开头的 16 位标识。 | 支付宝商户控制台；本机预检使用 `secrets/alipay-seller-id.txt`，准备上传脚本从本机进程环境读取。 | 必须保留原收款账户；不要把买家 ID、应用 ID 或沙箱 PID 填入正式服务。 |
| `CHECKOUT_SECRET` | 对订单号生成收银台链接 HMAC，亦用于支付 API 限流键；配置就绪要求至少 32 字符。 | `bootstrap.mjs` 首次生成 32 随机字节并编码为 64 位 hex，保存到 `secrets/checkout-secret.txt`。 | 保留原值。更换会使旧收银台链接失效，产品后端需用同一业务订单重新取得链接；常规发布不轮换。 |
| `CLIENTS_JSON` | legacy 产品列表，包含平台 API/webhook 长期密钥、回调、来源和商品；合法 JSON 数组。 | 首次 `bootstrap.mjs` 写入 `secrets/clients.json`，初值 `[]`；旧 `add-product.mjs` 可在尚未建立加密注册表时生成平台记录。 | 只有 `system/clients.enc.json` 不存在时可初始化；已有注册表由后台管理，修改此变量不会覆盖它。保留原内容，不能用空数组或旧本机文件清掉现有产品。 |
| `ADMIN_EMAIL` | 管理员登录账户邮箱，脚本去空白并转小写。 | 通过 stdin 提交 `{email,password}` 给 `scripts/configure-admin.mjs`；邮箱与派生配置保存到本机受限文件。 | 改邮箱会改变会话身份，旧会话失效；不影响产品长期密钥。 |
| `ADMIN_PASSWORD_HASH` | 管理员密码派生结果，格式 `pbkdf2-sha256$100000$<64位hex盐>$<64位hex哈希>`。 | 仅由 `configure-admin.mjs` 从 stdin 密码生成：先做带 pepper 的 HMAC，再 PBKDF2-SHA256 100000 次，输出 32 字节。 | 不能填写原密码。改密码需通过脚本更新哈希，并保留原 pepper、session key、registry key；新哈希部署后旧会话失效。 |
| `ADMIN_PASSWORD_PEPPER` | 密码 HMAC pepper，64 位小写 hex，必须与当前密码哈希配套。 | `configure-admin.mjs` 在对应原字段存在且非空时复用，否则生成 32 随机字节；已有但不完整的文件也会触发生成。 | 单独换值会导致原密码登录失败；常规修改密码时先恢复完整原配置并保留。 |
| `ADMIN_SESSION_SECRET` | 管理员会话 Cookie HMAC、管理员与接入 API 的限流键，64 位小写 hex。 | `configure-admin.mjs` 在对应原字段存在且非空时复用，否则生成 32 随机字节；已有但不完整的文件也会触发生成。 | 单独更换使已登录会话失效；日常发布和变量类型转换保留原值。 |
| `REGISTRY_ENCRYPTION_KEY` | 平台注册表 AES-256-GCM 加解密 key，64 位 hex、恰好 32 字节。 | `configure-admin.mjs` 在对应原字段缺失或为空时生成，即使本机文件已存在；已有加密注册表时必须先恢复并使用其原 key，不能执行生成后上传。 | **不可直接重新生成或覆盖**。错误 key、缺 key 或密文损坏必须报错，不退回 `CLIENTS_JSON`。迁移须另行完成已有数据重加密及恢复验证。 |

`prepare-secrets.mjs` 可把 6 项支付/legacy 变量集中到 `secrets/worker-secrets.json`；本机也可能保留首次上传文件 `secrets/initial-worker-secrets.json` 及单独的商户 PID 文件。5 项管理员/注册表变量集中在 `secrets/admin-worker-secrets.json`。本轮维护的 11 项原值备份为 `secrets/runtime-variables-maintenance.json`。这些文件均不提交 Git，也不自动证明与现网一致；操作前需要核对可靠性。不要为仅改变控制台类型而运行生成脚本。

平台 `apiSecret` 与 `webhookSecret` 在加密注册表中保存，是已接入产品的长期凭据，并非独立 Worker 环境变量。后台更新平台会保留它们；本次维护不能重建平台、修改长期凭据或让产品重新接入。

## 可选支付宝网关

`ALIPAY_GATEWAY` 不在当前仓库 `vars` 中，可按需要在 Worker 控制台配置 Text：

| 环境 | 设置 |
| --- | --- |
| 正式 `live` | 省略时 SDK 使用 `https://openapi.alipay.com/gateway.do`；显式设置也只能使用这个正式网关。 |
| 独立沙箱 `sandbox` | 显式配置 `https://openapi-sandbox.dl.alipaydev.com/gateway.do` 或 `https://openapi.alipaydev.com/gateway.do`。虽然 SDK 有沙箱默认值，服务配置检查仍要求存在可识别的沙箱网关。 |

代码只接受以上官方网关，并拒绝环境不匹配。不要给现有正式部署新增沙箱网关，也不要为“补全所有变量”添加不必要的覆盖值。

## 非字符串绑定与计划任务

这些项目不是可复制为 Text 的环境变量，应保留原 Cloudflare 绑定类型和目标。

| 名称 / 配置 | 位置与当前配置 | 作用 |
| --- | --- | --- |
| `ASSETS` | Worker 静态资源绑定，目录 `public/` | 提供页面和受控公开资源；不要用字符串替代。 |
| `ADMIN_LOGIN_LIMITER` | Worker Rate limit，namespace `2026101401`，5 次/60 秒 | 管理员登录保护；缺失时拒绝登录。 |
| `INTEGRATION_LIMITER` | Worker Rate limit，namespace `2026101402`，30 次/60 秒 | 单平台 AI 接入 API 限流；缺失时拒绝接入服务。 |
| `PAYMENT_API_LIMITER` | Worker Rate limit，namespace `2026101403`，120 次/60 秒 | 支付 API 限流；维护时保留既有保护。 |
| `PAYMENT_BACKEND` | 目标 Pages `brclio-pay-aiyuechuang` service binding → 同账号 Worker `brclio-pay` | 域名入口把动态请求转发给目标支付服务，Pages 无需持有商户或管理员运行凭据。 |
| `triggers.crons` | Worker `*/5 * * * *` | 每五分钟补偿查单及通知重试，不能因变量维护删除。 |

阿里云仍负责外部 DNS，根域名 nameserver 保留。单纯改变变量类型不需要新项目；本次跨账号迁移在目标账号新建 Worker 与 Pages，正式切换时只更新 `pay` 的 CNAME 至 `brclio-pay-aiyuechuang.pages.dev`，源项目保留回退。不新建数据库或存储资源，GitHub 原账本及加密注册表继续使用同仓同分支。

## 构建与本机工具变量

| 名称 | 设置 / 默认 | 用途与生成方式 |
| --- | --- | --- |
| `NODE_VERSION` | Builds `22` | 固定构建 Node 主版本；直接配置，无需生成随机值。 |
| `SKIP_DEPENDENCY_INSTALL` | Builds `1` | 跳过平台预安装，由既定构建命令中的 `npm ci` 安装依赖。 |
| `CLOUDFLARE_ACCOUNT_ID` | 目标 Builds 使用 `cacceff607775c81f667b7a951d4639f`，与根 Worker 配置一致 | 确定 `aiyuechuang@gmail.com` 的目标部署账号；Pages 部署包装脚本总是从根配置注入此变量，Pages 配置本身不写 `account_id`。源账号旧 Builds 需单独处理，不能误向源账号发布。 |
| `WRANGLER_SEND_METRICS` | Builds 和 GitHub CI `false` | 关闭 Wrangler 遥测；不控制业务日志或支付状态。 |
| Build API token | Cloudflare Builds 选择的专用构建 Secret | 由账号持有人创建，包含目标账号 `Workers Scripts:Edit`、`Cloudflare Pages:Edit`、`Account Settings:Read`；通过 API 管理 Builds 配置时另需用户范围 `Workers Builds Configuration:Edit`。不放进 Worker 业务变量。 |
| `HTTPS_PROXY` / `https_proxy` | 本机可选，无业务默认值 | 仅供域名、部署和支付宝预检脚本访问网络；不需要部署到支付 Worker。带认证的代理 URL 也不能进入日志或仓库。 |
| `BRCLIO_PAY_BASE_URL` | 本机管理员预检默认 `https://pay.bornforthis.cn` | 仅 `scripts/admin-preflight.mjs` 使用；需要预检另一合法 HTTPS 入口时设置，不替代 Worker 的 `PAY_BASE_URL`。 |

构建命令为 `npm ci && npm run ci:verify`，部署命令为 `npm run deploy:all`；其中 `deploy:pages` 必须使用 `scripts/deploy-pages.mjs` 包装脚本以固定目标账号。目标账号的 Brclio 连接已存在但 OAuth 无效（`has_valid_oauth_token=false`），应恢复该关联并配置、验收构建令牌和触发器，不能盲目卸载共享 App。源账号的历史成功不能替代目标账号证据。构建无需读取支付宝、管理员、注册表或私有账本运行凭据，不执行任何密钥初始化或批量上传脚本。

产品服务端示例使用另一组配置：`PAY_BASE_URL`、`PAY_CLIENT_ID`、`PAY_API_SECRET`、`PAY_WEBHOOK_SECRET`。其中 API/webhook 密钥只在产品可信后端保存；`PAY_SKU`、`PAY_PRODUCT_ORDER_ID`、`PAY_RETURN_URL` 只供 `examples/client.mjs` 演示请求。支付中心显示类型调整不改变产品已有配置。产品接入约定见 [integration.md](integration.md)。

## 首次生成与恢复方式

### 本机密钥文件

```sh
node scripts/bootstrap.mjs
```

此命令适用于首次准备，已有文件不会被覆盖：生成 RSA2048 应用密钥对、32 字节收银台密钥和空 legacy 目录。它不能恢复丢失的既有密钥。已有线上服务但本机文件不全时，先恢复原备份，不将新生成的值上传覆盖。

支付宝公钥和商户 PID 来自支付宝控制台；GitHub 单仓库令牌来自账号持有人授权。它们不能通过随机生成获得。

### 默认安全上传方式与本项目 Text 约定

项目保留原 `Secret` 上传脚本，供首次采用 Secret 管理或明确恢复 Secret 类型时使用。以下命令会将相应名称上传为 **Secret**，不能作为当前 Text 维护约定下的日常发布步骤：

```sh
node scripts/prepare-secrets.mjs
npx wrangler secret bulk secrets/worker-secrets.json
```

`prepare-secrets.mjs` 需要本机进程环境中的 `GITHUB_TOKEN`、`ALIPAY_SELLER_ID`，再读取本机私钥、支付宝公钥、checkout secret 和 legacy clients，生成被 Git 忽略的 0600 文件。不要把真实值写成 shell 命令参数、打印文件或让 CI 执行此步骤；旧备份也不能直接当作现网状态覆盖。

管理员设置继续从 stdin 输入密码；在本机交互终端可用：

```sh
python3 -c 'import getpass,json,sys; print("管理员邮箱：",file=sys.stderr); email=input().strip(); password=getpass.getpass("管理员密码："); json.dump({"email":email,"password":password},sys.stdout)' | node scripts/configure-admin.mjs
```

密码只在内存中参与派生，脚本写入邮箱、哈希、pepper、session key 和 registry key，不保存明文密码。只有 `secrets/admin-worker-secrets.json` 中对应原字段存在且非空时，脚本才保留三把原 key；文件丢失、字段缺失或为空都会生成新值。维护已部署服务前先恢复完整原配置，尤其注册表已加密时必须恢复原加密 key，不能让脚本生成新 key 后覆盖部署。

```sh
npx wrangler secret bulk secrets/admin-worker-secrets.json
```

这条管理员上传命令也会恢复 Secret 类型。当前 Text 约定下，修改管理员密码只把脚本生成的新哈希和确实需要变更的字段更新到 Worker 对应 Text 项；其余原值逐字保留。任何类型切换都需要核对结果，不能依赖一份旧全量文件重新初始化生产。

## 保持现有支付接入的操作顺序

1. 先确认目标是 `aiyuechuang@gmail.com`、Account ID `cacceff607775c81f667b7a951d4639f` 的 Worker `brclio-pay` 运行时设置；浏览器与 Wrangler 分别核对账号，记录变量名称、类型、部署版本及当前 `live` / 收款状态，记录中不包含值。
2. 保留仓库管理的 7 项参数，尤其 `PAYMENT_ENABLED=true`、正式 AppID、原数据仓库及分支。确认发布配置保留 `keep_vars: true`；不删除非字符串绑定、Cron 或 Pages 入口。
3. 原 11 项敏感变量只以同名、同值维护为 Text，迁移到目标账号也逐字保留 PEM 换行、JSON 内容、hash 中的 `$` 和所有 key 原字节。避免先部署一个缺变量的中间版本；保存后确认它们共同存在，不把空白、掩码、占位符当作值。
4. 不重新运行初始化、不重建平台注册表、不改产品长期 API/webhook Secret、不改回调或 SKU；已有订单和待投递事件继续使用原配置。
5. 使用正常发布命令更新维护配置及文档，确认 Worker 与 Pages 对应发布均成功；未来也必须保留控制台专属 Text 项，不能用 `vars` 全量重置或旧 bulk 文件覆盖。
6. 执行只读验收，分别记录配置检查、代码检查、部署、HTTPS 入口与域名证书；只有人工实付且产品真实权益落库后，才记录新的到账/开通结论。

建议的验证命令：

```sh
npm run check
npm run test:runtime
npm run test:security-runtime
node scripts/deployment-preflight.mjs
node scripts/pages-domain.mjs status
node scripts/verify-migration.mjs --base https://brclio-pay.aiyuechuang.workers.dev --base https://brclio-pay-aiyuechuang.pages.dev --base https://pay.bornforthis.cn
```

运行时测试使用临时内存密钥和模拟上游，不执行真实付款。部署预检核对版本、`ready`、`acceptingPayments`、`mode`、资源、安全头及匿名拒绝边界，不创建订单；`ready=true` 只说明配置齐全。管理员只读预检可通过 stdin 登录，验证会话、平台列表和 Skill 下载，不输出凭据。无需为变量显示方式验证而触发真实收款、补建账本或重发产品权益。

`verify-migration.mjs` 的远程请求全部为 GET，使用本机受限原值备份，在内存解密原注册表、签名读取目录和历史订单、验证旧收银台令牌，并核对账本、outbox/队列与报表一致性。有迁移前基线时同时核对历史连续性，没有基线仅证明当前状态一致。脚本不调用 `/refresh` 或 `/pay`、不调用支付宝、不写账本、不补发权益；它也不验证账号归属、DNS/证书、Cron 执行、Builds、真实资金或产品权益。参数、脱敏证据文件与覆盖边界见 [账号迁移只读核对](deployment.md#账号迁移的只读连续性核对)。

## 常见故障定位

| 现象 / 错误 | 优先检查 | 不应采用的修复 |
| --- | --- | --- |
| 发布后 `ready=false` | 11 项控制台变量是否保留、是否同名同值；GitHub 权限；注册表 key；当前产品是否可解析。 | 随机生成新 key、上传空目录或更换数据仓库。 |
| `REGISTRY_DECRYPT_FAILED` / `REGISTRY_KEY_REQUIRED` | 恢复原 `REGISTRY_ENCRYPTION_KEY`，核对是否误填掩码、换行或另一环境的 key。 | 删除加密注册表、退回旧 `CLIENTS_JSON` 或生成 key 覆盖。 |
| 旧收银台链接失效 | `CHECKOUT_SECRET` 是否意外变化，变量内容是否包含额外空白。 | 重建产品或删除原订单；必要时由产品后端以原业务订单取得链接。 |
| 管理密码无效 | 原 hash 与 pepper 是否配套、hash 的 `$` 是否完整、邮箱是否正确。 | 把明文密码填进 `ADMIN_PASSWORD_HASH` 或单独轮换 pepper。 |
| 收款入口提示未开放 | `/api/health` 的 `acceptingPayments`、代码中的开关及平台是否启用。 | 因维护重置已授权的生产开关，或绕过开关直接发起支付。 |
| 签名、金额、PID 或 AppID 不匹配 | 确认正式应用、支付宝公钥、应用私钥及 PID 仍为同一组合；保留历史订单金额快照。 | 放宽验签、相信浏览器回跳或用最新 SKU 金额覆盖旧订单。 |
| 产品 webhook 拒绝签名 | 原平台注册表、`webhookSecret`、产品后端 Secret 和回调目标是否保持一致。 | 为重试重生成平台长期凭据，或修改已付款订单的金额。 |
| 下一次部署后 Text 项消失 | `keep_vars` 是否仍为 true，发布是否采用预期配置，是否有旧全量更新覆盖。 | 把真实值提交到 `wrangler.jsonc`、构建日志或代码仓库。 |

代码依据是 `src/types.ts`、`src/config.ts`、`src/alipay.ts`、`src/registry.ts`、`src/admin-auth.ts` 及 `scripts/` 中对应初始化/预检脚本；接口仍以 [产品接入指南](integration.md) 为准。
