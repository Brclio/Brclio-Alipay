(() => {
  'use strict';

  const ids = [
    'loginView', 'dashboardView', 'loginForm', 'loginEmail', 'loginPassword', 'loginButton',
    'loginMessage', 'accountEmail', 'logoutButton', 'globalMessage', 'grantForm', 'grantClientId',
    'grantOrigins', 'grantModeLabel', 'resetGrantButton', 'generateGrantButton', 'grantMessage',
    'copySkillButton', 'outputPanel', 'outputTitle', 'outputMeta', 'taskOutput', 'copyOutputButton',
    'clearOutputButton', 'outputMessage', 'clientsLoading', 'clientsEmpty', 'clientsList',
    'clientCount', 'reloadClientsButton', 'manualSection', 'manualTitle', 'editContext',
    'newClientButton', 'clientForm', 'clientId', 'clientName', 'webhookUrl', 'returnOrigins',
    'skuRows', 'addSkuButton', 'clientEnabled', 'previewButton', 'editMessage', 'conflictNotice',
    'reloadCurrentButton', 'diffPanel', 'diffTarget', 'diffList', 'saveClientButton', 'cancelPreviewButton',
    'reloadGrantsButton', 'grantsMessage', 'grantsEmpty', 'grantsList',
  ];
  const ui = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  let session = null;
  let clients = [];
  let busy = false;
  let grantMode = 'create';
  let editingClient = null;
  let pendingSave = null;
  let outputExpiry = null;
  let outputTimer = null;
  let outputKind = null;
  let outputGrantId = null;

  class ApiError extends Error {
    constructor(status, code, message) {
      super('Admin request failed');
      this.status = status;
      this.code = code;
      this.publicMessage = typeof message === 'string' ? message.slice(0, 300) : '';
    }
  }
  class InputError extends Error {}

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function message(target, text, kind = 'info') {
    target.textContent = text;
    target.classList.remove('notice-error', 'notice-success');
    if (kind !== 'info') target.classList.add(`notice-${kind}`);
    target.hidden = !text;
  }
  function syncControls() {
    document.querySelectorAll('[data-busy-lock]').forEach((control) => { control.disabled = busy; });
    ui.saveClientButton.disabled = busy || !pendingSave;
    ui.copyOutputButton.disabled = busy || (outputKind === 'grant' && outputExpiry !== null && Date.now() >= outputExpiry);
    ui.loginForm.setAttribute('aria-busy', String(busy));
    ui.grantForm.setAttribute('aria-busy', String(busy));
    ui.clientForm.setAttribute('aria-busy', String(busy));
  }
  async function operation(button, progressText, action) {
    if (busy) return;
    busy = true;
    const previousLabel = button?.textContent;
    if (button && progressText) button.textContent = progressText;
    syncControls();
    try { await action(); }
    finally {
      busy = false;
      if (button && previousLabel !== undefined) button.textContent = previousLabel;
      syncControls();
    }
  }

  async function request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (method !== 'GET' && path !== '/login' && session?.csrfToken) headers['X-CSRF-Token'] = session.csrfToken;
      const response = await fetch(`/api/admin${path}`, {
        method, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: controller.signal,
      });
      const data = response.status === 204 ? {} : await response.json().catch(() => null);
      if (!response.ok) throw new ApiError(response.status, data?.error?.code, data?.error?.message);
      if (data === null) throw new ApiError(502, 'INVALID_RESPONSE', '管理服务暂时没有返回完整结果，请重试。');
      return data;
    } finally { window.clearTimeout(timeout); }
  }
  function report(error, target) {
    if (error instanceof ApiError && error.status === 401 && session) {
      showLogin('会话已过期，请重新登录。');
      return;
    }
    const text = error instanceof InputError ? error.message
      : error instanceof ApiError && error.publicMessage ? error.publicMessage
      : error?.name === 'AbortError' ? '请求超时，请稍后重试。'
      : '暂时无法连接管理服务，请检查网络后重试。';
    message(target, text, 'error');
  }

  function clearOutput() {
    if (outputTimer !== null) window.clearTimeout(outputTimer);
    outputTimer = null;
    outputExpiry = null;
    outputKind = null;
    outputGrantId = null;
    ui.taskOutput.value = '';
    ui.outputMeta.textContent = '';
    ui.outputMessage.textContent = '';
    ui.outputPanel.hidden = true;
  }
  function showLogin(notice = '') {
    session = null;
    clients = [];
    clearOutput();
    resetGrant();
    resetEditor();
    ui.clientsList.replaceChildren();
    ui.grantsList.replaceChildren();
    ui.grantsEmpty.textContent = '正在读取授权…';
    ui.grantsEmpty.hidden = false;
    message(ui.grantsMessage, '');
    ui.accountEmail.textContent = '';
    ui.accountEmail.hidden = true;
    ui.logoutButton.hidden = true;
    ui.dashboardView.hidden = true;
    ui.loginView.hidden = false;
    ui.loginPassword.value = '';
    message(ui.loginMessage, notice, notice ? 'error' : 'info');
    document.title = '管理员登录 · Brclio Pay';
  }
  function showDashboard(data) {
    if (!data?.user || typeof data.user.email !== 'string' || typeof data.csrfToken !== 'string' || !data.csrfToken) {
      throw new ApiError(502, 'INVALID_SESSION', '登录会话信息不完整，请重新登录。');
    }
    session = { user: { email: data.user.email }, csrfToken: data.csrfToken };
    ui.accountEmail.textContent = data.user.email;
    ui.accountEmail.hidden = false;
    ui.logoutButton.hidden = false;
    ui.loginView.hidden = true;
    ui.dashboardView.hidden = false;
    ui.loginPassword.value = '';
    message(ui.loginMessage, '');
    message(ui.globalMessage, '');
    document.title = '接入管理 · Brclio Pay';
  }

  function publicClient(value) {
    if (!value || typeof value.id !== 'string' || typeof value.name !== 'string'
      || typeof value.version !== 'string' || typeof value.webhookUrl !== 'string'
      || !Array.isArray(value.returnOrigins) || !value.skus || typeof value.skus !== 'object') {
      throw new ApiError(502, 'INVALID_CLIENT', '平台列表信息不完整，请刷新重试。');
    }
    // Keep an explicit public-field whitelist; credentials never enter UI state.
    const skus = Object.create(null);
    for (const [code, sku] of Object.entries(value.skus)) {
      if (typeof sku?.subject !== 'string' || typeof sku.amount !== 'string') throw new ApiError(502, 'INVALID_CLIENT', '商品配置暂时无法读取。');
      skus[code] = { subject: sku.subject, amount: sku.amount };
    }
    return { id: value.id, name: value.name, webhookUrl: value.webhookUrl,
      returnOrigins: value.returnOrigins.filter((origin) => typeof origin === 'string'),
      skus, enabled: value.enabled !== false, version: value.version,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined };
  }
  async function loadClients() {
    ui.clientsLoading.hidden = false;
    const result = await request('/clients');
    if (!Array.isArray(result.clients)) throw new ApiError(502, 'INVALID_CLIENTS', '暂时无法读取平台列表。');
    clients = result.clients.map(publicClient);
    renderClients();
    ui.clientsLoading.hidden = true;
    try { await loadGrants(); } catch (error) { report(error, ui.grantsMessage); }
  }
  async function loadGrants() {
    const result = await request('/grants');
    if (!Array.isArray(result.grants)) throw new ApiError(502, 'INVALID_GRANTS', '暂时无法读取短期授权。');
    const grants = result.grants.map((value) => {
      if (!value || typeof value.id !== 'string' || typeof value.clientId !== 'string'
        || !['create', 'update'].includes(value.mode) || !Array.isArray(value.allowedOrigins)
        || !Number.isFinite(Date.parse(value.expiresAt))) throw new ApiError(502, 'INVALID_GRANTS', '短期授权信息不完整，请刷新。');
      return { id: value.id, clientId: value.clientId, mode: value.mode,
        allowedOrigins: value.allowedOrigins.filter((origin) => typeof origin === 'string'),
        expiresAt: value.expiresAt, revokedAt: typeof value.revokedAt === 'string' ? value.revokedAt : null };
    });
    const rows = grants.map((grant) => {
      const active = !grant.revokedAt && Date.parse(grant.expiresAt) > Date.now();
      const row = element('article', `grant-row${grant.id === outputGrantId ? ' is-current' : ''}`);
      const content = element('div', '');
      const heading = element('div', 'grant-row-heading');
      heading.append(element('strong', '', grant.clientId), element('span', `admin-badge${active ? '' : ' disabled'}`, grant.revokedAt ? '已撤销' : active ? '有效' : '已到期'));
      content.append(heading,
        element('p', 'grant-row-meta', `${grant.mode === 'create' ? '新建平台' : '更新平台'} · 有效至 ${timeLabel(new Date(grant.expiresAt))}（北京时间）`),
        element('p', 'grant-row-meta', `授权来源 · ${grant.allowedOrigins.join('、')}`));
      row.append(content);
      if (active) {
        const revoke = element('button', 'admin-text-button revoke-grant-button', '撤销授权');
        revoke.type = 'button'; revoke.setAttribute('data-busy-lock', '');
        revoke.setAttribute('aria-label', `撤销 ${grant.clientId} 的${grant.mode === 'create' ? '新建' : '更新'}授权`);
        revoke.addEventListener('click', () => {
          void operation(revoke, '正在撤销…', async () => {
            try {
              await request(`/grants/${encodeURIComponent(grant.id)}/revoke`, { method: 'POST' });
              if (grant.id === outputGrantId) clearOutput();
              await loadGrants();
              message(ui.grantsMessage, `已撤销 ${grant.clientId} 的这次授权。对应 AI 任务不能继续使用。`, 'success');
            } catch (error) { report(error, ui.grantsMessage); }
          });
        });
        row.append(revoke);
      }
      return row;
    });
    ui.grantsList.replaceChildren(...rows);
    ui.grantsEmpty.textContent = '目前没有可显示的短期授权。生成接入任务后，可在这里查看并撤销。';
    ui.grantsEmpty.hidden = grants.length > 0;
    message(ui.grantsMessage, '');
    syncControls();
  }
  function renderClients() {
    const rows = clients.map((client) => {
      const article = element('article', 'client-row');
      article.setAttribute('aria-label', `${client.name} 接入配置`);
      const content = element('div', 'client-row-content');
      const heading = element('div', 'client-heading');
      heading.append(element('h3', '', client.name), element('span', `admin-badge${client.enabled ? '' : ' disabled'}`, client.enabled ? '允许新订单' : '已停止新订单'));
      content.append(heading, element('p', 'client-id', client.id), element('p', 'client-address', `付款通知 · ${client.webhookUrl}`));
      content.append(element('p', 'client-products', `${Object.keys(client.skus).length} 个商品 · 返回来源 ${client.returnOrigins.join('、')}`));
      const actions = element('div', 'client-row-actions');
      const grant = element('button', 'button button-secondary', '复制 AI 更新任务');
      grant.type = 'button'; grant.setAttribute('data-busy-lock', '');
      grant.setAttribute('aria-label', `复制 ${client.name} 的 AI 更新任务`);
      grant.addEventListener('click', () => {
        selectGrantClient(client);
        void generateGrant(grant);
      });
      const edit = element('button', 'admin-text-button', '编辑配置');
      edit.type = 'button'; edit.setAttribute('data-busy-lock', '');
      edit.setAttribute('aria-label', `编辑 ${client.name} 的配置`);
      edit.addEventListener('click', () => openEditor(client));
      actions.append(grant, edit); article.append(content, actions); return article;
    });
    ui.clientsList.replaceChildren(...rows);
    ui.clientCount.textContent = String(clients.length);
    ui.clientsEmpty.hidden = clients.length > 0;
    syncControls();
  }

  function originsFromText(value) {
    const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) throw new InputError('请填写至少一个你控制的 HTTPS 来源。');
    const origins = lines.map((line) => {
      if (line.length > 300) throw new InputError('单个来源不能超过 300 个字符。');
      if (line.startsWith('https://*.')) {
        const domain = line.slice('https://*.'.length);
        const validWildcard = domain.length <= 253 && domain.includes('.')
          && domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
          && !/^[\d.]+$/.test(domain) && !domain.endsWith('.localhost') && !domain.endsWith('.local');
        if (!validWildcard) throw new InputError('子域名规则使用完整格式 https://*.brclio.com，不包含端口、路径或更多通配符。');
        return line;
      }
      let url;
      try { url = new URL(line); } catch { throw new InputError(`来源格式不正确：${line}`); }
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || url.pathname !== '/' || url.hostname.includes('*')) {
        throw new InputError('来源填写 HTTPS 协议、域名与可选端口，例如 https://app.brclio.com；不要填写路径或登录信息。子域名规则使用 https://*.brclio.com。');
      }
      if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local') || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) throw new InputError('来源需要使用公网 HTTPS 域名。');
      return url.origin;
    });
    const unique = [...new Set(origins)];
    if (unique.length > 50) throw new InputError('每个平台最多配置 50 个来源。');
    return unique;
  }
  function validId(value) {
    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(value)) throw new InputError('平台标识使用 2 至 64 位小写英文字母、数字、下划线或连字符，并以字母或数字开头。');
    return value;
  }
  function resetGrant() {
    grantMode = 'create';
    ui.grantForm.reset();
    ui.grantClientId.readOnly = false;
    ui.grantModeLabel.textContent = '新建平台任务';
    ui.grantModeLabel.classList.remove('update-mode');
    ui.resetGrantButton.hidden = true;
    message(ui.grantMessage, '');
  }
  function selectGrantClient(client) {
    grantMode = 'update';
    ui.grantClientId.value = client.id;
    ui.grantClientId.readOnly = true;
    let webhookOrigin = '';
    try { webhookOrigin = new URL(client.webhookUrl).origin; } catch { /* Public config is revalidated by the server. */ }
    ui.grantOrigins.value = [...new Set([webhookOrigin, ...client.returnOrigins].filter(Boolean))].join('\n');
    ui.grantModeLabel.textContent = `更新平台 · ${client.id}`;
    ui.grantModeLabel.classList.add('update-mode');
    ui.resetGrantButton.hidden = false;
    message(ui.grantMessage, '');
  }
  function timeLabel(date) {
    return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }
  function setOutput(content, { title, meta, kind, expiresAt, grantId } = {}) {
    clearOutput();
    ui.outputTitle.textContent = title || 'AI 接入任务';
    ui.outputMeta.textContent = meta || '';
    ui.taskOutput.value = content;
    ui.copyOutputButton.textContent = kind === 'skill' ? '复制 Skill' : '复制任务';
    outputKind = kind || 'grant';
    outputGrantId = typeof grantId === 'string' ? grantId : null;
    outputExpiry = expiresAt ? Date.parse(expiresAt) : null;
    ui.outputPanel.hidden = false;
    if (outputExpiry !== null && Number.isFinite(outputExpiry)) {
      outputTimer = window.setTimeout(() => {
        ui.outputMessage.textContent = '此任务授权已到期，请重新生成后交给 AI。';
        syncControls();
      }, Math.max(0, outputExpiry - Date.now()));
    }
    syncControls();
  }
  async function copyOutput() {
    if (!ui.taskOutput.value) return false;
    try {
      await navigator.clipboard.writeText(ui.taskOutput.value);
      ui.outputMessage.textContent = outputKind === 'skill' ? 'Skill 已复制，可以交给 AI。' : '接入任务已复制，可以交给开发该产品的 AI。';
      return true;
    } catch {
      ui.outputMessage.textContent = `内容已生成。浏览器未完成自动复制，请点击“${outputKind === 'skill' ? '复制 Skill' : '复制任务'}”或手动选择下方内容。`;
      return false;
    }
  }
  async function generateGrant(button = ui.generateGrantButton) {
    if (!ui.grantForm.reportValidity()) return;
    await operation(button, '正在生成授权任务…', async () => {
      try {
        message(ui.grantMessage, '');
        clearOutput();
        const clientId = validId(ui.grantClientId.value.trim());
        const allowedOrigins = originsFromText(ui.grantOrigins.value);
        if (grantMode === 'create' && clients.some((client) => client.id === clientId)) throw new InputError('此平台标识已经存在，请从平台列表生成它的更新任务。');
        const result = await request('/grants', { method: 'POST', body: { clientId, mode: grantMode, allowedOrigins } });
        if (typeof result.prompt !== 'string' || !result.prompt || !Number.isFinite(Date.parse(result.expiresAt))) {
          throw new ApiError(502, 'INVALID_GRANT', '任务结果不完整，请重新生成。');
        }
        setOutput(result.prompt, {
          title: grantMode === 'create' ? 'AI 平台接入任务' : 'AI 平台更新任务', kind: 'grant', expiresAt: result.expiresAt, grantId: result.grantId,
          meta: `平台 ${clientId} · ${grantMode === 'create' ? '仅创建此平台' : '仅更新此平台'} · 授权至 ${timeLabel(new Date(result.expiresAt))}（北京时间）`,
        });
        const copied = await copyOutput();
        message(ui.grantMessage, copied ? '任务已生成并复制。短期权限仅适用于所选平台。' : '任务已生成，请在下方复制完整内容。', 'success');
        try { await loadGrants(); } catch (error) { report(error, ui.grantsMessage); }
      } catch (error) { report(error, ui.grantMessage); }
    });
  }

  function invalidatePreview() {
    pendingSave = null;
    ui.diffPanel.hidden = true;
    syncControls();
  }
  function addSku(code = '', value = { subject: '', amount: '' }) {
    const row = element('div', 'sku-row');
    for (const [field, label, current] of [['code', '商品代码', code], ['subject', '商品名称', value.subject], ['amount', '价格（元）', value.amount]]) {
      const wrapper = element('label', '');
      wrapper.append(element('span', 'sku-mobile-label', label));
      const input = element('input', 'admin-input');
      input.type = 'text'; input.required = true; input.value = current;
      input.dataset.field = field; input.setAttribute('data-busy-lock', ''); input.setAttribute('aria-label', label);
      input.maxLength = field === 'subject' ? 120 : field === 'code' ? 80 : 9;
      if (field === 'amount') input.inputMode = 'decimal';
      if (field === 'code') { input.autocomplete = 'off'; input.spellcheck = false; }
      wrapper.append(input); row.append(wrapper);
    }
    const remove = element('button', 'remove-sku', '×');
    remove.type = 'button'; remove.setAttribute('aria-label', '移除此商品'); remove.setAttribute('data-busy-lock', '');
    remove.addEventListener('click', () => { row.remove(); invalidatePreview(); });
    row.append(remove); ui.skuRows.append(row); syncControls();
  }
  function resetEditor() {
    editingClient = null;
    ui.clientForm.reset();
    ui.clientId.readOnly = false;
    ui.skuRows.replaceChildren();
    addSku();
    ui.manualTitle.textContent = '手动注册或编辑平台';
    ui.editContext.textContent = '注册一个新平台，已有平台可从列表进入编辑。';
    ui.conflictNotice.hidden = true;
    message(ui.editMessage, '');
    invalidatePreview();
  }
  function openEditor(client) {
    resetEditor();
    editingClient = client;
    ui.clientId.value = client.id; ui.clientId.readOnly = true;
    ui.clientName.value = client.name; ui.webhookUrl.value = client.webhookUrl;
    ui.returnOrigins.value = client.returnOrigins.join('\n'); ui.clientEnabled.checked = client.enabled;
    ui.skuRows.replaceChildren();
    Object.entries(client.skus).forEach(([code, sku]) => addSku(code, sku));
    if (!Object.keys(client.skus).length) addSku();
    ui.manualTitle.textContent = `编辑平台 · ${client.name}`;
    ui.editContext.textContent = `正在编辑 ${client.id}。平台标识固定，保存时校验当前版本。`;
    ui.manualSection.open = true;
    ui.manualSection.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
  function readConfig() {
    const id = validId(ui.clientId.value.trim());
    if (!editingClient && clients.some((client) => client.id === id)) throw new InputError('此平台标识已经存在，请从列表进入编辑，避免覆盖已有平台。');
    if (editingClient && id !== editingClient.id) throw new InputError('已有平台的标识不能更改。');
    const name = ui.clientName.value.trim();
    if (!name || name.length > 80) throw new InputError('产品名称需要为 1 至 80 个字符。');
    let webhook;
    try { webhook = new URL(ui.webhookUrl.value.trim()); } catch { throw new InputError('请填写完整的 HTTPS 付款通知地址。'); }
    if (webhook.protocol !== 'https:' || webhook.username || webhook.password || webhook.hash || webhook.search) {
      throw new InputError('付款通知地址需要使用 HTTPS，且不包含登录信息、查询参数或片段。');
    }
    const returnOrigins = originsFromText(ui.returnOrigins.value);
    const skus = Object.create(null);
    const rows = [...ui.skuRows.querySelectorAll('.sku-row')];
    if (!rows.length) throw new InputError('请至少配置一个商品。');
    for (const row of rows) {
      const code = row.querySelector('[data-field="code"]').value.trim();
      const subject = row.querySelector('[data-field="subject"]').value.trim();
      const amount = row.querySelector('[data-field="amount"]').value.trim();
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(code) || ['__proto__', 'constructor', 'prototype'].includes(code)) throw new InputError('商品代码使用 1 至 80 位英文字母、数字、下划线或连字符，并避免保留名称。');
      if (Object.hasOwn(skus, code)) throw new InputError(`商品代码重复：${code}`);
      if (!subject) throw new InputError(`请填写商品 ${code} 的名称。`);
      if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) throw new InputError(`商品 ${code} 的价格应大于 0，最高 999999.99 元，最多保留两位小数。`);
      const [whole, fraction = ''] = amount.split('.');
      skus[code] = { subject, amount: `${whole}.${fraction.padEnd(2, '0')}` };
    }
    return { id, name, webhookUrl: webhook.href, returnOrigins, skus, enabled: ui.clientEnabled.checked };
  }
  function skuSummary(skus) {
    return Object.entries(skus).sort(([a], [b]) => a.localeCompare(b)).map(([code, sku]) => `${code} · ${sku.subject} · ¥${sku.amount}`).join('\n');
  }
  function changesFor(config) {
    const before = editingClient;
    const fields = [
      ['平台标识', before?.id, config.id], ['产品名称', before?.name, config.name],
      ['通知地址', before?.webhookUrl, config.webhookUrl],
      ['返回来源', before?.returnOrigins.join('\n'), config.returnOrigins.join('\n')],
      ['商品配置', before ? skuSummary(before.skus) : undefined, skuSummary(config.skus)],
      ['新订单', before ? before.enabled ? '允许创建' : '停止创建' : undefined, config.enabled ? '允许创建' : '停止创建'],
    ];
    return fields.filter(([, oldValue, newValue]) => oldValue !== newValue);
  }
  function previewConfig() {
    try {
      message(ui.editMessage, ''); ui.conflictNotice.hidden = true;
      const config = readConfig();
      const changes = changesFor(config);
      if (!changes.length) { invalidatePreview(); message(ui.editMessage, '没有发现需要保存的变更。'); return; }
      pendingSave = { config, expectedVersion: editingClient ? editingClient.version : 'absent' };
      ui.diffTarget.textContent = `${editingClient ? '更新已有平台' : '注册新平台'} · ${config.id}`;
      ui.diffList.replaceChildren(...changes.map(([label, before, after]) => {
        const row = element('div', ''); const value = element('dd', '');
        if (before !== undefined) value.append(element('span', 'diff-old', `当前：${before}`));
        value.append(element('span', 'diff-new', `${before === undefined ? '新增' : '改为'}：${after}`));
        row.append(element('dt', '', label), value); return row;
      }));
      ui.diffPanel.hidden = false; syncControls();
      ui.diffPanel.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
    } catch (error) { invalidatePreview(); report(error, ui.editMessage); }
  }

  ui.loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!ui.loginForm.reportValidity()) return;
    void operation(ui.loginButton, '正在登录…', async () => {
      try {
        message(ui.loginMessage, '');
        const data = await request('/login', { method: 'POST', body: { email: ui.loginEmail.value.trim(), password: ui.loginPassword.value } });
        showDashboard(data);
        try { await loadClients(); } catch (error) { ui.clientsLoading.hidden = true; report(error, ui.globalMessage); }
      } catch (error) { ui.loginPassword.value = ''; report(error, ui.loginMessage); }
    });
  });
  ui.logoutButton.addEventListener('click', () => {
    void operation(ui.logoutButton, '正在退出…', async () => {
      try { await request('/logout', { method: 'POST' }); showLogin(); }
      catch (error) { report(error, ui.globalMessage); }
    });
  });
  ui.grantForm.addEventListener('submit', (event) => { event.preventDefault(); void generateGrant(); });
  ui.resetGrantButton.addEventListener('click', resetGrant);
  ui.copySkillButton.addEventListener('click', () => {
    void operation(ui.copySkillButton, '正在读取 Skill…', async () => {
      try {
        const result = await request('/skill');
        if (typeof result.content !== 'string' || !result.content) throw new ApiError(502, 'INVALID_SKILL', 'Skill 内容暂时无法读取。');
        setOutput(result.content, { title: '通用接入 Skill', meta: '通用说明，不含平台凭据。具体平台授权由上方接入任务提供。', kind: 'skill' });
        await copyOutput();
        message(ui.grantMessage, '通用 Skill 已准备好。平台接入还需要上方生成的短期授权任务。', 'success');
      } catch (error) { report(error, ui.grantMessage); }
    });
  });
  ui.copyOutputButton.addEventListener('click', () => { void copyOutput(); });
  ui.clearOutputButton.addEventListener('click', () => { clearOutput(); syncControls(); });
  ui.reloadClientsButton.addEventListener('click', () => {
    void operation(ui.reloadClientsButton, '正在刷新…', async () => {
      try { message(ui.globalMessage, ''); await loadClients(); }
      catch (error) { ui.clientsLoading.hidden = true; report(error, ui.globalMessage); }
    });
  });
  ui.reloadGrantsButton.addEventListener('click', () => {
    void operation(ui.reloadGrantsButton, '正在刷新…', async () => {
      try { await loadGrants(); } catch (error) { report(error, ui.grantsMessage); }
    });
  });
  ui.newClientButton.addEventListener('click', resetEditor);
  ui.addSkuButton.addEventListener('click', () => { addSku(); invalidatePreview(); });
  ui.clientForm.addEventListener('input', invalidatePreview);
  ui.clientForm.addEventListener('change', invalidatePreview);
  ui.clientForm.addEventListener('submit', (event) => { event.preventDefault(); if (ui.clientForm.reportValidity()) previewConfig(); });
  ui.cancelPreviewButton.addEventListener('click', invalidatePreview);
  ui.saveClientButton.addEventListener('click', () => {
    if (!pendingSave) return;
    void operation(ui.saveClientButton, '正在保存此平台…', async () => {
      const submission = pendingSave;
      try {
        const result = await request('/clients', { method: 'POST', body: submission });
        const saved = publicClient(result.client);
        const existing = clients.findIndex((client) => client.id === saved.id);
        if (existing < 0) clients.push(saved); else clients[existing] = saved;
        renderClients(); openEditor(saved);
        message(ui.editMessage, '此平台配置已保存，其它平台保持不变。', 'success');
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          invalidatePreview(); ui.conflictNotice.hidden = false;
          message(ui.editMessage, '版本发生冲突，本次修改没有覆盖服务器配置。', 'error');
        } else { report(error, ui.editMessage); }
      }
    });
  });
  ui.reloadCurrentButton.addEventListener('click', () => {
    const id = editingClient?.id || ui.clientId.value.trim();
    void operation(ui.reloadCurrentButton, '正在加载最新配置…', async () => {
      try {
        await loadClients();
        const latest = clients.find((client) => client.id === id);
        if (!latest) throw new InputError('该平台当前不存在，请重新选择平台或注册新平台。');
        openEditor(latest); message(ui.editMessage, '已加载最新配置，请重新编辑并预览。');
      } catch (error) { ui.clientsLoading.hidden = true; report(error, ui.editMessage); }
    });
  });

  resetEditor();
  void operation(null, null, async () => {
    try {
      showDashboard(await request('/session'));
      try { await loadClients(); } catch (error) { ui.clientsLoading.hidden = true; report(error, ui.globalMessage); }
    } catch (error) {
      showLogin();
      if (!(error instanceof ApiError && error.status === 401)) report(error, ui.loginMessage);
    }
  });
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    clearOutput();
    void operation(null, null, async () => {
      try { showDashboard(await request('/session')); await loadClients(); }
      catch (error) { showLogin('请重新确认登录状态。'); if (!(error instanceof ApiError && error.status === 401)) report(error, ui.loginMessage); }
    });
  });
})();
