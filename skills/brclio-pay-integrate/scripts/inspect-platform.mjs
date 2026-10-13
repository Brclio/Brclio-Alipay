import { readdir, readFile, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ignored = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', '.next', '.wrangler', '.turbo', 'coverage', '.venv', 'venv']);
const sensitive = name => /^\.env(?:\.|$)/i.test(name) || /(?:secret|credential|password|private[-_]?key|token)/i.test(name)
  || /\.(?:pem|key|p12|pfx|crt|keystore|sqlite|db|log)$/i.test(name);
const source = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|php|rb|vue|svelte|json)$/i;
const providers = { alipay: /alipay|支付宝/i, stripe: /stripe/i, paddle: /paddle/i, lemonsqueezy: /lemon.?squeezy/i, wechat: /wechat.?pay|weixin.?pay|微信支付/i, paypal: /paypal/i };
const capabilities = { authentication: /auth|session|login|登录/i, orders: /order|checkout|订单/i, entitlements: /entitlement|subscription|license|membership|权益/i, webhook: /webhook|callback|notify|回调/i };

export async function inspectPlatform(directory) {
  const root = await realpath(directory);
  const files = [];
  let skippedSensitive = 0;
  let truncated = false;
  async function walk(current, depth) {
    if (depth > 16 || files.length >= 5000) { truncated = true; return; }
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      if (entry.isSymbolicLink() || ignored.has(entry.name)) continue;
      if (sensitive(entry.name)) { skippedSensitive++; continue; }
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute, depth + 1);
      else if (entry.isFile() && source.test(entry.name)) {
        if (files.length >= 5000) { truncated = true; break; }
        files.push({ absolute, relative: path.relative(root, absolute).split(path.sep).join('/') });
      }
    }
  }
  await walk(root, 0);
  const matches = [];
  let packageDependencies = [];
  for (const file of files) {
    if ((await lstat(file.absolute)).size > 256 * 1024) continue;
    const content = await readFile(file.absolute, 'utf8');
    const foundProviders = Object.entries(providers).filter(([, pattern]) => pattern.test(content)).map(([name]) => name);
    const foundCapabilities = Object.entries(capabilities).filter(([, pattern]) => pattern.test(file.relative)).map(([name]) => name);
    if (foundProviders.length || foundCapabilities.length) matches.push({ path: file.relative, providers: foundProviders, capabilities: foundCapabilities });
    if (file.relative === 'package.json') {
      try {
        const pkg = JSON.parse(content);
        packageDependencies = [...new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})])].sort();
      } catch { /* Inventory must not print malformed file contents. */ }
    }
  }
  return { filesScanned: files.length, skippedSensitive, truncated, packageDependencies, matches };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error();
    process.stdout.write(JSON.stringify(await inspectPlatform(process.argv[2]), null, 2) + '\n');
  } catch { process.stderr.write('Unable to inspect repository. Supply one readable product repository path.\n'); process.exitCode = 1; }
}
