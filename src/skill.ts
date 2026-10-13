import { skillFiles } from './skill-data';

export function skillMarkdown(): string {
  return skillFiles['brclio-pay-integrate/SKILL.md'];
}

export interface IntegrationPromptOptions {
  clientId: string;
  mode: 'create' | 'update';
  paymentMode?: 'live' | 'sandbox';
  token: string;
  expiresAt: string;
  baseUrl: string;
}

/** Only this per-task prompt contains the short-lived, single-product grant. */
export function makeIntegrationPrompt({ clientId, mode, paymentMode, token, expiresAt, baseUrl }: IntegrationPromptOptions): string {
  const base = new URL(baseUrl);
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(clientId) || !['create', 'update'].includes(mode)
    || (paymentMode !== undefined && !['live', 'sandbox'].includes(paymentMode))
    || !/^brp_int_[A-Za-z0-9_-]{20,2000}$/.test(token) || !Number.isFinite(Date.parse(expiresAt))
    || base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new TypeError('Invalid scoped integration context');
  }
  return `请使用下方完整的 $brclio-pay-integrate Skill，为当前已授权的产品后端接入或更新 Brclio Pay。仅复制本消息即可开始，不需要另行附上 ZIP。先检查现有认证、订单、权益、支付与回调代码；保留它们，再完成最小改动。此临时授权仅允许指定产品的 context / plan / apply，不扩大目标仓库或发布权限。

授权产品：${clientId}
操作类型：${mode === 'create' ? '新增该产品接入' : '修改该产品现有接入'}
支付环境：${paymentMode || '读取 context.paymentMode 确认；操作类型不表示支付环境'}
支付中心：${base.origin}
授权到期：${new Date(expiresAt).toISOString()}
临时接入令牌（敏感，仅当前任务使用）：${token}

将临时令牌仅用于进程环境变量 BRCLIO_PAY_INTEGRATION_TOKEN，并设置 BRCLIO_PAY_BASE_URL。不要输出、提交或写入通用 Skill。用同一 Bearer 令牌请求 GET ${base.origin}/api/integration/v1/skill.zip，下载到当前任务专用、被 Git 忽略的临时目录并解压。凭证放在 Authorization 请求头，不放在 URL/query，也不开启 verbose 请求日志。下载只提供通用 Skill 与辅助脚本；不用全局安装。读取解压后的 SKILL.md 和 references/integration.md，从包内运行 scripts/inspect-platform.mjs 与 scripts/integration-client.mjs。

读取 /api/integration/v1/context 后，以 client.version 或 absent 生成单产品变更计划，核对 before / after 再应用；不要改动其他产品。产品长期凭证只进入其可信后端的 Secret；只有需要落地且用户任务授权时，使用脚本的 --credentials-file 写入 Git 忽略的 0600 新文件。

按 Skill 的接入协议实现服务端固定 SKU 下单、验签 webhook、持久化事务去重及权益开通；付款返回参数不能直接开通。沙箱不能开通正式权益。先做本地/模拟验证，真实扣款与部署仍按当前用户授权执行。最终报告配置版本、代码入口、验证结果和未完成项，不展示任何凭证。

---
以下为本任务可直接使用的完整通用 Skill；仅以上临时授权部分含任务凭证，通用包不包含凭证。

${skillMarkdown()}`;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function header(length: number): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(length);
  return { bytes, view: new DataView(bytes.buffer) };
}

/** Small deterministic UTF-8 ZIP using method 0 (stored); no runtime filesystem. */
export function skillZip(): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const entries = Object.entries(skillFiles).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  for (const [name, value] of entries) {
    if (!/^brclio-pay-integrate\/[A-Za-z0-9_./-]+$/.test(name) || name.split('/').some(part => part === '..' || part === '')) throw new TypeError('Unsafe skill archive path');
    const filename = encoder.encode(name);
    const data = encoder.encode(value);
    const checksum = crc32(data);
    const local = header(30 + filename.length);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, 0x0800, true);
    local.view.setUint16(12, 0x0021, true);
    local.view.setUint32(14, checksum, true);
    local.view.setUint32(18, data.length, true);
    local.view.setUint32(22, data.length, true);
    local.view.setUint16(26, filename.length, true);
    local.bytes.set(filename, 30);
    const directory = header(46 + filename.length);
    directory.view.setUint32(0, 0x02014b50, true);
    directory.view.setUint16(4, 20, true);
    directory.view.setUint16(6, 20, true);
    directory.view.setUint16(8, 0x0800, true);
    directory.view.setUint16(14, 0x0021, true);
    directory.view.setUint32(16, checksum, true);
    directory.view.setUint32(20, data.length, true);
    directory.view.setUint32(24, data.length, true);
    directory.view.setUint16(28, filename.length, true);
    directory.view.setUint32(42, offset, true);
    directory.bytes.set(filename, 46);
    chunks.push(local.bytes, data);
    central.push(directory.bytes);
    offset += local.bytes.length + data.length;
  }
  const centralLength = central.reduce((sum, item) => sum + item.length, 0);
  const end = header(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(8, entries.length, true);
  end.view.setUint16(10, entries.length, true);
  end.view.setUint32(12, centralLength, true);
  end.view.setUint32(16, offset, true);
  const result = new Uint8Array(offset + centralLength + end.bytes.length);
  let cursor = 0;
  for (const chunk of [...chunks, ...central, end.bytes]) { result.set(chunk, cursor); cursor += chunk.length; }
  return result;
}
