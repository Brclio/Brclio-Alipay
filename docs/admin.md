# 接入管理与 AI 授权

管理入口：`https://pay.bornforthis.cn/admin`。管理员登录后，可以查看平台、预览并保存单个平台配置、生成 AI 接入任务、查看及撤销短期授权。这里的“平台”和支付 API 中的产品 `clientId` 是同一个隔离单位。

当前 `PAYMENT_ENABLED=false`，正式应用审核和真实付款仍待验证。管理后台可准备产品配置，但注册平台、生成任务或保存商品都不代表已经能够真实收款。

## 一键交给产品开发 AI

1. 登录 `/admin`，为新平台填写固定 `clientId`，或从已有平台选择“生成更新任务”。
2. 填写允许 AI 配置的 HTTPS 来源，每行一个，例如 `https://brclio.com`、`https://app.brclio.com`。它们必须是你控制的产品来源；来源不包含具体路径。确有需要才授权 `https://*.brclio.com`，该形式不包含根域名。
3. 点击“生成并复制 AI 接入任务”。任务包含完整通用 Skill、目标平台、操作范围、到期时间，以及最长 2 小时的临时接入令牌。把完整任务交给负责该产品后端的 AI 即可，不需要额外附 ZIP。
4. AI 先检查原产品登录、订单、权益和已有支付代码，再读取授权 context、生成变更计划、核对前后差异并应用。AI 对产品仓库的访问、编辑和部署仍需来自当前用户任务授权。
5. 完成后查看平台配置、版本和授权状态；必要时撤销未到期授权。

复制任务属于敏感内容，其中的短期令牌允许读取**该平台**的接入凭证并执行指定新增或更新操作。不要贴到公开 Issue、日志、群聊或源码。它不包含管理员密码、支付宝应用私钥、GitHub Token、其他平台密钥或全账号凭据。

通用 Skill 可在登录后复制或下载：`GET /api/admin/skill`、`GET /api/admin/skill.zip`。拿到复制任务的 AI 也可使用临时 Bearer 授权请求 `GET /api/integration/v1/skill.zip`，解压到任务临时目录使用；不需要管理员 Cookie、额外全局账号授权或自动安装全局 Skill。令牌放在 Authorization 请求头，不能放入 URL/query。

## 授权如何限制操作

- 每次授权绑定一个 `clientId`，`mode=create` 表示新建，`mode=update` 表示修改已存在平台；它与 `paymentMode=live/sandbox` 是不同概念。
- 管理页面签发的授权有效期为 2 小时，不能凭令牌扩大目标、延长有效期或访问别的平台。服务端保存令牌哈希，原始令牌仅在生成任务时交付。
- 新增或修改的 webhook 来源、返回来源必须处于授权域名范围内。更新时可以保留未改动的原地址；授权不允许把新回调改到无关域名。
- 新平台应用成功后，才生成该平台长期 API/webhook 凭证。更新平台保留原凭证，不通过配置计划旋转密钥。
- 授权撤销或过期后，context、Skill 下载、plan、apply 等后续授权请求均不能继续。已完成的配置不会自动回滚，已经交付给产品后端的长期凭证也不会因短期授权撤销而失效。

管理页面的“清除显示”仅清理当前任务文本，不等于撤销授权；使用“短期授权”列表中的撤销操作才会使服务端授权失效。

## 配置版本与计划应用

`GET /api/integration/v1/context` 返回目标平台视图、`client.version`、`allowedOrigins`、操作类型和实际支付环境。新平台 `client=null`，版本使用 `absent`。返回的 `credentials` 只属于目标平台；通用 CLI 默认隐藏它们。

`POST /api/integration/v1/plan` 接收完整的目标 `config` 与 `expectedVersion`，返回 `planId`、`before`、`after`、`baseVersion` 和到期时间。计划最多保留 15 分钟，且不能超出授权有效期。`POST /api/integration/v1/apply` 使用同一授权提交 `{planId}`，再次核对目标、域名范围和配置版本后应用。

这是按单个平台进行的版本比较更新：新平台要求 `absent`，已有平台要求读取时的 SHA-256 版本。若另一个任务已经修改同一平台，返回 409；重新读取并核对差异，不能强行覆盖。修改其他平台不应导致当前平台被整表替换。重复提交已成功应用的同一计划返回原结果。

手动配置也先预览，再保存目标平台与其读取时的版本。已有平台 ID 保持不变，更新保存原 API/webhook Secret；其他平台、历史订单与付款事件保持独立。

改价影响之后创建的订单，历史订单保存的金额不会改变。修改 webhook 会影响尚未成功投递的通知，应先让新接收端就绪并安排旧端过渡。停止平台会阻止新订单和新发起付款，已有付款通知、查单及重试仍须处理。不要删除历史订单或待投递事件来“清理”配置。

## 管理员与加密存储配置

在本机交互终端运行以下流程，邮箱和密码由终端输入，不写进命令历史或明文 JSON 文件：

```sh
python3 -c 'import getpass,json,sys; print("管理员邮箱：",file=sys.stderr); email=input().strip(); password=getpass.getpass("管理员密码："); json.dump({"email":email,"password":password},sys.stdout)' | node scripts/configure-admin.mjs
npx wrangler secret bulk secrets/admin-worker-secrets.json
```

脚本从标准输入接收 `{email,password}`，密码要求 12–1024 个字符。密码经带 pepper 的 PBKDF2 派生，**明文密码不落盘**；输出仅说明准备完成。被 Git 忽略的 `secrets/admin-worker-secrets.json` 权限为 0600，包含账户邮箱、密码哈希、pepper、会话签名密钥和注册表加密密钥。该文件仍是敏感 Secret 文件，不能打印或提交。

Secret 名称：`ADMIN_EMAIL`、`ADMIN_PASSWORD_HASH`、`ADMIN_PASSWORD_PEPPER`、`ADMIN_SESSION_SECRET`、`REGISTRY_ENCRYPTION_KEY`。脚本在已有本机配置存在时保留 pepper、会话密钥和注册表加密密钥，修改密码只更新盐及派生哈希。新密码哈希部署后，旧登录会话因凭证指纹不符而失效。

登录使用 Secure、HttpOnly、SameSite=Strict 的主机 Cookie，会话有效期为 8 小时；管理写操作校验同源 Origin 和 CSRF Token。登录与临时接入 API 的限流绑定需随 Worker 配置部署。页面不内置管理员账户或密码。

平台目录、平台长期凭证、授权哈希、计划与审计记录使用 AES-256-GCM 加密后写入私有 GitHub 数据仓库的 `system/clients.enc.json`。`REGISTRY_ENCRYPTION_KEY` 只保留在本机安全备份及 Cloudflare Secret，不能放进该仓库。这里加密的是接入注册表；订单和 outbox 仍按原架构保存，并非所有 GitHub 文件都经过此加密。

**加密密钥必须保留。** 已有加密注册表时，不要用新生成的随机 key 覆盖旧 key。若本机配置文件丢失，先从安全备份恢复原 key，再运行配置流程；不能靠重新生成密钥恢复旧数据。

仅当 `system/clients.enc.json` 不存在时，服务才读取旧 `CLIENTS_JSON` 作为初始化基线。第一次保存注册表后，加密数据成为权威来源；再修改 legacy Secret 不会覆盖后台配置。加密数据存在但格式错误、损坏、缺少 key 或无法解密时必须报错，**禁止退回旧 Secret 继续运行**，否则会重新启用旧商品或旧凭证。

## 接入与验证边界

管理配置和 Skill 只负责支付中心侧登记及指导产品代码接入。产品自己的登录认证、订单归属、原始请求体验签、金额核对、数据库事务去重和权益开通仍由产品后端实现。长期凭证只能进入该后端的 Secret；通用 CLI 仅在明确指定 `--credentials-file` 时，独占写入 Git 忽略的新 0600 文件。

本次最终验证结果见 [交付状态](status.md)。正式应用审核、真实小额付款、支付宝到账和实际产品权益落库必须分别取得证据；管理后台保存成功不能代替这些验收。
