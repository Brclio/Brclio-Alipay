# Brclio Pay

统一支付宝收银中心，计划运行于 **https://pay.bornforthis.cn**。Cloudflare Worker 执行服务，订单与通知队列保存在 **GitHub 私有仓库**，不使用 D1、KV、R2 或第三方数据库。

支持独立产品后端接入，适用于 `brclio.com`、指定子域名以及通过浏览器打开收银台的桌面和 Android 客户端。支付宝应用：`2021007109602288`。

- [产品接入指南，可直接交给 AI](docs/integration.md)
- [支付宝配置与审核](docs/alipay-setup.md)
- [架构、信任边界与容量](docs/architecture.md)
- [部署与密钥操作](docs/deployment.md)
- [本次交付和验证状态](docs/status.md)

## 本地开发

需要 Node.js 22.12+ 或 24+。

```sh
npm ci
npm run check
npm run dev
```

没有配置商户密钥时，首页正常展示；`GET /api/health` 返回 `ready:false`，收款接口拒绝交易。没有假支付成功模式。

## 首次设置

```sh
node scripts/bootstrap.mjs
```

应用私钥、应用公钥、收银台令牌密钥存入本机 `secrets/`。已有文件不会被覆盖；该目录已由 Git 忽略。**应用公钥**交给支付宝，**支付宝公钥**交给服务验签，二者不可混用。注册首个实际产品见接入指南。

## 收款与开通

产品后端创建订单 → 统一收银台 → 支付宝 → 验签通知/主动查单 → 原子写入付款及待发送事件 → 产品验签并幂等开通 → 返回产品。

浏览器返回参数只用于定位订单。产品必须通过自己的服务端确认付款、核对商品和金额并幂等开通。`fulfillmentStatus:delivered` 仅表示产品端已返回 HTTP 2xx，产品接收端应当在权益事务提交后才返回 2xx。

目前实现单次付款；自动续订、原生 App SDK、自动退款和退款后的权益撤销不在本版本中。退款需人工处理并在产品侧同步权益。

GitHub 存储适合起步阶段的低交易量；存在 API 配额与提交延迟，不能承诺高并发或数据库级吞吐。商品经营内容、实际收银台和产品域名须满足支付宝签约要求；域名中转不代表免备案。

收银台视觉使用 Brclio Design System，署名 Brclio。设计系统原始资源与规范遵循其 CC BY-NC-SA 4.0 许可。
