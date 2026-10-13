# Cloudflare 部署与密钥操作

## 当前结构

- Worker：`brclio-pay`。
- 域名入口：Cloudflare Pages `brclio-pay.pages.dev`，通过 service binding 调用支付 Worker。
- 自定义域名：`pay.bornforthis.cn`，在 Pages 绑定；阿里云 DNS 添加 `pay CNAME brclio-pay.pages.dev`。
- 数据仓库：`BrclioData/Brclio-Alipay-Data`（私有，main 已初始化）。
- 应用 ID：`2021007109602288`。
- 默认 `PAYMENT_ENABLED=false`。密钥缺失时 `ready=false`。
- 本机 secrets/ 不提交 Git；运行时密钥存 Cloudflare Worker Secrets。

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

注册至少一个真实产品之后，准备 GITHUB_TOKEN、ALIPAY_SELLER_ID 本机环境变量，然后：

```sh
node scripts/prepare-secrets.mjs
npx wrangler secret bulk secrets/worker-secrets.json
```

脚本读取本机应用私钥、支付宝公钥、checkout-secret.txt 和 clients.json，输出被 Git 忽略的0600权限文件。不要打印该 JSON，也不要上传整个 secrets/ 目录。

所需 Secret 名称：GITHUB_TOKEN、ALIPAY_PRIVATE_KEY、ALIPAY_PUBLIC_KEY、ALIPAY_SELLER_ID、CHECKOUT_SECRET、CLIENTS_JSON。仓库名 GITHUB_REPOSITORY 不是密钥，已在 wrangler vars 中设置；生成文件仅包含真正的 Secrets。

## 验证与启用

```sh
npm run check
npm run test:runtime
npm run deploy
npm run deploy:pages
```

先查看 `/api/health`。`ready=true` 只表示所需配置齐全，不能证明应用审核、产品权限或实际付款通过。

`cloudflare/pages/wrangler.jsonc` 管理 Pages 的 PAYMENT_BACKEND 服务绑定。Pages `_worker.js` 将原始请求转发到同账号支付 Worker，密钥和五分钟 Cron 都在 Worker 中。阿里云 DNS 无需更换 nameserver；为 `pay` 添加 `CNAME brclio-pay.pages.dev`，处理同名记录冲突。Cloudflare 侧已登记自定义域名，用 `node scripts/pages-domain.mjs status` 查看证书与验证状态。

确认正式应用审核通过、电脑/手机网站支付权限可用，产品 webhook 与权益事务已部署，且准备进行人工小额实付后，再将 wrangler vars 中 `PAYMENT_ENABLED` 改为 `true` 并部署。真实付款由用户完成；验收要核实支付宝交易、GitHub 付款订单、已投递事件以及产品实际权益四处一致。

2026-10-13 商户产品页显示电脑网站支付当前单笔上限2,000元、单日上限20,000元，提额申请处理中。请以最新审核结果为准，商品价格不要超出实际额度。

`PAYMENT_ENABLED=false` 仅停止新建/新发起支付；已有订单通知、查单与队列重试继续处理，避免已付款用户被漏开通。若安全事件需要完全停服，在 Cloudflare 限制访问并人工核对未完成订单。

密钥/CLIENTS_JSON 更新用 Secret 管理；新增SKU需保留已有商品定义直到历史订单结束。更换 CHECKOUT_SECRET 会使旧收银台链接失效，产品后端可用相同业务订单重新取得链接。更换商户应用或沙箱环境时必须使用独立账本与部署。

GitHub 有全局令牌/API配额、二级限流与提交延迟；持续监控失败/重试队列。不要直接删除未完成订单、event 或 queue。Git 历史不能自然删除敏感资料，所以本项目不存买家姓名、手机号或支付账户，productOrderId 应使用不含个人信息的不透明标识。
