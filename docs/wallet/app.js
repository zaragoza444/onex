const API = (typeof window !== 'undefined' && window.ONEX_BRIDGE_URL)
  ? String(window.ONEX_BRIDGE_URL).replace(/\/$/, '')
  : '';
let chains = [], tokens = [], portfolio = null;
let selectedChain = 'onex-mainnet-1';
let chartPeriod = '24h';
const BALANCE_HIST_KEY = 'onex_balance_history';
const DAPP_CONNECTED_KEY = 'onex_dapp_connected';
const THEME_KEY = 'onex_theme';
const API_KEY_STORAGE = 'ONEX_API_KEY';
const EVM_HOLDER_KEY = 'onex_evm_holder';
let ledgerSource = 'all';
let ledgerSnapshot = null;
let ledgerChartPeriod = '24h';
const LEDGER_HIST_KEY = 'onex_ledger_history';

const LEDGER_SOURCE_COLORS = {
  bank: '#4a9eff',
  m0: '#7c4dff',
  m1: '#00bcd4',
  nsb: '#ffb300',
  onex: '#00e5b0',
  evm: '#c0a062',
  import: '#ff9500',
  portfolio: '#8b8fa3',
};

function getApiKey() {
  try { return localStorage.getItem(API_KEY_STORAGE) || ''; } catch (_) { return ''; }
}

async function api(path, opts = {}) {
  const base = API || '';
  if (!base && !path.startsWith('/')) {
    return { error: 'Bridge URL not set. Open Settings and add your onex-bridge HTTPS URL.' };
  }
  const headers = { ...(opts.headers || {}) };
  const key = getApiKey();
  if (key && !headers['X-OneX-Api-Key'] && !headers['Authorization']) {
    headers['X-OneX-Api-Key'] = key;
  }
  try {
    const r = await fetch(base + path, { ...opts, headers, mode: 'cors' });
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch { j = { error: text || r.statusText }; }
    if (!r.ok && !j.error) j.error = r.statusText || String(r.status);
    if (r.status === 401) j.error = j.error || 'Unauthorized — add your API key in Settings';
    return j;
  } catch (e) {
    return { error: e.message || 'Network error' };
  }
}

function nodeExplorerUrl() {
  if (typeof window === 'undefined') return 'http://127.0.0.1:8545/explorer/';
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return 'http://127.0.0.1:8545/explorer/';
  if (window.location.protocol === 'https:' || h === 'novatrustee.digital') {
    return window.location.origin + '/explorer/';
  }
  const base = (API || window.location.origin || '').replace(/\/$/, '');
  return base ? base + '/explorer/' : 'http://127.0.0.1:8545/explorer/';
}

function featuredDapps() {
  return [
  { name: 'Explorer', icon: '🔍', url: nodeExplorerUrl() },
  { name: 'Online Bank', icon: '🏦', action: () => showTab('onlinebank') },
  { name: 'Real Ledger', icon: '📒', action: () => showTab('ledger') },
  { name: 'OneX Swap', icon: '⇄', action: () => showTab('trade') },
  { name: 'Stake', icon: '📈', action: () => showTab('earn') },
  { name: 'NFT', icon: '🖼', action: () => { showTab('discover'); showDiscoverSection('nft'); } },
  { name: 'Bridge', icon: '🌉', action: () => { showTab('trade'); setSwapMode('bridge'); } },
  { name: 'Rewards', icon: '🎁', action: () => { showTab('discover'); showDiscoverSection('tasks'); } },
  { name: 'Token', icon: '◎', action: () => { showTab('discover'); showDiscoverSection('token'); } },
  { name: 'Networks', icon: '⛓', action: () => { showTab('discover'); showDiscoverSection('networks'); } },
  ];
}

function applyFallbackCatalog() {
  const fb = window.ONEX_FALLBACK;
  if (!fb) return;
  if (!chains?.length) chains = fb.chains || [];
  if (!tokens?.length) tokens = fb.tokens || [];
}

function saveBridgeUrl() {
  const input = document.getElementById('bridge-url-input');
  const v = (input?.value || '').trim().replace(/\/$/, '');
  if (!v) return;
  try { localStorage.setItem('ONEX_BRIDGE_URL', v); } catch (_) {}
  window.ONEX_BRIDGE_URL = v;
  location.reload();
}

function saveApiKey() {
  const input = document.getElementById('api-key-input');
  const v = (input?.value || '').trim();
  try {
    if (v) localStorage.setItem(API_KEY_STORAGE, v);
    else localStorage.removeItem(API_KEY_STORAGE);
  } catch (_) {}
  alert(v ? 'API key saved' : 'API key cleared');
}

function loadSettingsFields() {
  const bridgeInput = document.getElementById('bridge-url-input');
  if (bridgeInput && API) bridgeInput.value = API;
  const keyInput = document.getElementById('api-key-input');
  if (keyInput) keyInput.value = getApiKey();
  const evmInput = document.getElementById('evm-holder-input');
  if (evmInput) evmInput.value = getEvmHolder();
}

function getEvmHolder() {
  try { return localStorage.getItem(EVM_HOLDER_KEY) || ''; } catch (_) { return ''; }
}

function saveEvmHolder() {
  const input = document.getElementById('evm-holder-input');
  const v = (input?.value || '').trim();
  try { localStorage.setItem(EVM_HOLDER_KEY, v); } catch (_) {}
  alert(v ? 'EVM address saved' : 'EVM address cleared');
  refreshLedger();
}

function updateExternalBanner() {
  const el = document.getElementById('external-banner');
  if (!el) return;
  const onPages = /\.github\.io$/i.test(location.hostname);
  el.classList.toggle('hidden', !!API || !onPages);
}

function fmtAtomic(n, decimals = 8) {
  const v = BigInt(n || 0);
  const d = BigInt(10 ** decimals);
  const whole = v / d;
  const frac = (v % d).toString().padStart(decimals, '0').replace(/0+$/, '') || '0';
  return frac === '0' ? `${whole}` : `${whole}.${frac}`;
}

const SCREEN_ALIASES = {
  home: 'wallet', wallet: 'wallet', swap: 'trade', trade: 'trade',
  stake: 'earn', loans: 'earn', earn: 'earn',
  discover: 'discover', nft: 'discover', tasks: 'discover',
  createtoken: 'discover', token: 'discover', chains: 'discover', networks: 'discover',
  ledger: 'ledger', real: 'ledger',
  onlinebank: 'onlinebank', bank: 'onlinebank',
  web3: 'web3', dapp: 'web3', dapps: 'web3',
  ai: 'ai', assistant: 'ai', chat: 'ai',
};

function showTab(name) {
  const screen = SCREEN_ALIASES[name] || name;
  document.querySelectorAll('.bottom-nav [data-screen]').forEach(b => {
    b.classList.toggle('active', b.dataset.screen === screen);
  });
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('active', s.id === 'screen-' + screen);
  });
  if (screen === 'trade') { loadAmmPools(); updateDexStatus(); updateSwapCTA(); }
  if (screen === 'earn') renderStakePools();
  if (screen === 'ledger') { refreshLedger(); initLedgerConvertSelects(); }
  if (screen === 'onlinebank') refreshOnlineBank();
  if (screen === 'web3') renderWeb3();
  if (screen === 'ai') initAI();
  if (screen === 'discover') {
    const sub = { createtoken: 'token', chains: 'networks' }[name] || name;
    if (['nft', 'tasks', 'token', 'networks'].includes(sub)) showDiscoverSection(sub);
    else showDiscoverMenu();
  }
}

function openSheet(id) {
  closeSheet();
  document.getElementById('sheet-backdrop').classList.add('open');
  const sheet = document.getElementById('sheet-' + id);
  if (sheet) sheet.classList.add('open');
  if (id === 'receive' && portfolio?.address) {
    document.getElementById('addr').textContent = portfolio.address;
  }
  if (id === 'settings') loadSettingsFields();
}

function closeSheet() {
  document.getElementById('sheet-backdrop').classList.remove('open');
  document.querySelectorAll('.sheet').forEach(s => s.classList.remove('open'));
}

function copyAddress() {
  const a = portfolio?.address || document.getElementById('addr')?.textContent;
  if (!a) return;
  if (window.OneXMobile?.copy) {
    window.OneXMobile.copy(a);
    return;
  }
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(a);
}

function showDiscoverMenu() {
  document.getElementById('discover-menu')?.classList.remove('hidden');
  document.querySelectorAll('.discover-panel').forEach(p => p.classList.add('hidden'));
}

function showDiscoverSection(id) {
  document.getElementById('discover-menu')?.classList.add('hidden');
  document.querySelectorAll('.discover-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById('discover-' + id)?.classList.remove('hidden');
  if (id === 'token') loadTokenPlatform();
}

async function loadTokens() {
  const j = await api('/bridge/tokens');
  if (Array.isArray(j)) tokens = j;
}

function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  document.body.setAttribute('data-theme', t);
  const meta = document.getElementById('meta-theme');
  if (meta) meta.content = t === 'light' ? '#f5f5f5' : '#000000';
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = t === 'light' ? '🌙' : '☀';
  localStorage.setItem(THEME_KEY, t);
}

function toggleTheme() {
  const next = document.body.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  applyTheme(next);
  renderPortfolioChart();
}

function loadTheme() {
  applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
}

function parseBalanceNum(s) {
  const n = parseFloat(String(s || '0').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function getBalanceHistory() {
  try {
    return JSON.parse(localStorage.getItem(BALANCE_HIST_KEY) || '[]');
  } catch {
    return [];
  }
}

function recordBalanceSnapshot(displayValue) {
  const v = parseBalanceNum(displayValue);
  const now = Date.now();
  let hist = getBalanceHistory();
  const last = hist[hist.length - 1];
  if (last && now - last.t < 60000 && Math.abs(last.v - v) < 1e-12) return;
  hist.push({ t: now, v });
  const cutoff = now - 30 * 24 * 3600 * 1000;
  hist = hist.filter(h => h.t >= cutoff).slice(-800);
  localStorage.setItem(BALANCE_HIST_KEY, JSON.stringify(hist));
}

function filterHistoryByPeriod(hist, period) {
  const now = Date.now();
  const ms = period === '7d' ? 7 * 864e5 : period === '30d' ? 30 * 864e5 : 864e5;
  const filtered = hist.filter(h => h.t >= now - ms);
  if (filtered.length >= 2) return filtered;
  if (hist.length >= 2) return hist.slice(-Math.min(hist.length, period === '30d' ? 60 : 24));
  return filtered.length ? filtered : hist;
}

function seedChartIfEmpty(current) {
  let hist = getBalanceHistory();
  if (hist.length >= 2) return;
  const v = parseBalanceNum(current);
  const now = Date.now();
  const pts = 12;
  hist = [];
  for (let i = pts; i >= 0; i--) {
    const jitter = 1 + (Math.sin(i * 0.9) * 0.03);
    hist.push({ t: now - i * 3600 * 1000, v: Math.max(0, v * jitter) });
  }
  localStorage.setItem(BALANCE_HIST_KEY, JSON.stringify(hist));
}

function setChartPeriod(period) {
  chartPeriod = period;
  document.querySelectorAll('.chart-periods button').forEach(b => {
    b.classList.toggle('active', b.dataset.period === period);
  });
  const labels = { '24h': '24h change', '7d': '7d change', '30d': '30d change' };
  const el = document.getElementById('chart-period-label');
  if (el) el.textContent = labels[period] || 'Change';
  renderPortfolioChart();
  if (lastPortfolioSymbols.length) hydrateTokenCharts(lastPortfolioSymbols, chartPeriod);
  if (selectedTokenRow?.sym && document.getElementById('sheet-token')?.classList.contains('open')) {
    renderTokenDetailChart(selectedTokenRow.sym, chartPeriod);
  }
}

let lastPortfolioSymbols = [];
let selectedTokenRow = null;

function renderPortfolioChart() {
  const svg = document.getElementById('portfolio-chart');
  const emptyEl = document.getElementById('chart-empty');
  const changeEl = document.getElementById('chart-change');
  if (!svg) return;

  let hist = filterHistoryByPeriod(getBalanceHistory(), chartPeriod);
  if (hist.length < 2) {
    svg.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (changeEl) { changeEl.textContent = '—'; changeEl.className = ''; }
    return;
  }
  if (emptyEl) emptyEl.classList.add('hidden');

  const w = 360, h = 100, pad = 4;
  const vals = hist.map(p => p.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const pts = hist.map((p, i) => {
    const x = pad + (i / (hist.length - 1)) * (w - pad * 2);
    const y = h - pad - ((p.v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(' ');
  const area = `${pad},${h} ${line} ${w - pad},${h}`;
  const up = vals[vals.length - 1] >= vals[0];
  const pct = vals[0] ? ((vals[vals.length - 1] - vals[0]) / vals[0]) * 100 : 0;
  const gradId = 'chartGradient';
  const strokeClass = up ? 'line' : 'line down';
  const root = getComputedStyle(document.documentElement);
  const brand = root.getPropertyValue('--brand').trim() || '#00c853';
  const down = root.getPropertyValue('--chart-down').trim() || '#ff4d4f';
  const stroke = up ? brand : down;

  svg.innerHTML = `
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${stroke}" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="${stroke}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path class="area" d="M ${area} Z"/>
    <polyline class="${strokeClass}" points="${line}" style="stroke:${stroke}"/>
  `;

  if (changeEl) {
    const sign = pct >= 0 ? '+' : '';
    changeEl.textContent = `${sign}${pct.toFixed(2)}%`;
    changeEl.className = pct >= 0 ? 'positive' : 'negative';
  }
}

function renderWeb3() {
  const grid = document.getElementById('dapp-grid');
  if (grid) {
    grid.innerHTML = featuredDapps().map((d, i) => `
      <button type="button" class="dapp-item" onclick="launchDapp(${i})">
        <div class="dapp-icon">${d.icon}</div>
        <span>${d.name}</span>
      </button>`).join('');
  }
  const addr = portfolio?.address || '';
  const web3Addr = document.getElementById('web3-addr');
  if (web3Addr) web3Addr.textContent = addr || 'No wallet — create one in Settings';
  renderConnectedDapps();
}

function launchDapp(index) {
  const d = featuredDapps()[index];
  if (!d) return;
  if (d.action) { d.action(); return; }
  if (d.url) openDappUrl(d.url, d.name);
}

function openDapp() {
  let url = document.getElementById('dapp-url')?.value?.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  openDappUrl(url, new URL(url).hostname);
}

function openDappUrl(url, name) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(DAPP_CONNECTED_KEY) || '[]'); } catch { list = []; }
  const entry = { url, name: name || url, t: Date.now() };
  list = [entry, ...list.filter(x => x.url !== url)].slice(0, 12);
  localStorage.setItem(DAPP_CONNECTED_KEY, JSON.stringify(list));
  renderConnectedDapps();
  window.open(url, '_blank', 'noopener,noreferrer');
}

function renderConnectedDapps() {
  const el = document.getElementById('dapp-connected');
  if (!el) return;
  let list = [];
  try { list = JSON.parse(localStorage.getItem(DAPP_CONNECTED_KEY) || '[]'); } catch { list = []; }
  if (!list.length) {
    el.innerHTML = '<p class="msg">No recent dApps. Open one from Popular or enter a URL above.</p>';
    return;
  }
  el.innerHTML = list.map((d, i) => `
    <div class="dapp-connected-row">
      <div class="dapp-icon" style="width:40px;height:40px;font-size:16px">🌐</div>
      <div class="asset-info">
        <div class="asset-symbol">${escapeHtml(d.name)}</div>
        <div class="asset-name">${escapeHtml(d.url)}</div>
      </div>
      <button type="button" class="btn-secondary" data-dapp-i="${i}">Open</button>
    </div>`).join('');
  el.querySelectorAll('[data-dapp-i]').forEach(btn => {
    btn.onclick = () => {
      const d = list[parseInt(btn.dataset.dappI, 10)];
      if (d) openDappUrl(d.url, d.name);
    };
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

const aiHistory = [];

async function initAI() {
  try {
    const st = await api('/bridge/ai/status');
    const badge = document.getElementById('ai-mode-badge');
    if (badge) {
      badge.textContent = st.cloud ? 'cloud' : 'local';
      badge.classList.toggle('cloud', !!st.cloud);
    }
  } catch (_) {}
  if (!aiHistory.length) {
    appendAIBubble('assistant', 'Hi! I\'m OneX AI with live real-asset context — bank IBAN, M0/M1/NSB ledger, wallets, and on-chain balances.');
  }
  renderAISuggestions(['Show my real assets', 'What is my ledger total?', 'Settle to IBAN', 'Bridge to BSC']);
}

function renderAISuggestions(list) {
  const el = document.getElementById('ai-suggestions');
  if (!el) return;
  el.innerHTML = (list || []).map(s =>
    `<button type="button" class="ai-chip" onclick="askAI(${JSON.stringify(s)})">${escapeHtml(s)}</button>`
  ).join('');
}

function appendAIBubble(role, text) {
  const chat = document.getElementById('ai-chat');
  if (!chat) return;
  const div = document.createElement('div');
  div.className = 'ai-bubble ' + role;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function askAI(text) {
  const input = document.getElementById('ai-input');
  if (input) input.value = text;
  sendAIMessage();
}

async function sendAIMessage() {
  const input = document.getElementById('ai-input');
  const text = (input?.value || '').trim();
  if (!text) return;
  input.value = '';
  appendAIBubble('user', text);
  aiHistory.push({ role: 'user', content: text });
  const typing = document.createElement('div');
  typing.className = 'ai-bubble assistant typing';
  typing.id = 'ai-typing';
  typing.textContent = 'Thinking…';
  document.getElementById('ai-chat')?.appendChild(typing);

  try {
    const evmQ = getEvmHolder() ? `?evm=${encodeURIComponent(getEvmHolder())}` : '';
    const j = await api('/bridge/ai/chat' + evmQ, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: aiHistory }),
    });
    typing.remove();
    appendAIBubble('assistant', j.reply || 'No response.');
    aiHistory.push({ role: 'assistant', content: j.reply });
    if (j.suggestions?.length) renderAISuggestions(j.suggestions);
    if (j.action?.type === 'navigate' && j.action.tab) showTab(j.action.tab);
    if (j.action?.type === 'sheet' && j.action.sheet) openSheet(j.action.sheet);
  } catch (e) {
    typing.remove();
    appendAIBubble('assistant', 'Could not reach OneX AI. Is onex-bridge running?');
  }
}

async function init() {
  loadTheme();
  updateExternalBanner();
  loadSettingsFields();
  const ex = document.getElementById('explorer-link');
  if (ex) ex.href = nodeExplorerUrl();

  if (API) {
    const ch = await api('/bridge/chains');
    if (!ch?.error && Array.isArray(ch)) chains = ch;
    await loadTokens();
  }
  applyFallbackCatalog();

  const chainsEl = document.getElementById('chains-list');
  if (chainsEl && chains?.length) {
    chainsEl.innerHTML = chains.map(c => `
      <div class="asset-row">
        <div class="asset-icon" style="background:${c.color}22;color:${c.color}">${c.symbol[0]}</div>
        <div class="asset-info"><div class="asset-symbol">${c.name}</div><div class="asset-name">${c.type}</div></div>
      </div>`).join('');
  }
  fillChainSelects();
  [['send-chain','send-token'],['dep-chain','dep-token'],['swap-from-chain','swap-from-token'],['swap-to-chain','swap-to-token'],['bridge-from-chain','bridge-from-token'],['bridge-to-chain','bridge-to-token']].forEach(([c,t]) => {
    const el = document.getElementById(c);
    if (el) onChainChange(el, t);
  });
  await loadMarketPrices();
  await refreshAll();
  updateSlipDisplay();
  setInterval(() => bridgeStatus(), 20000);
  const hash = (location.hash || '').replace('#', '').toLowerCase();
  if (hash === 'swap') showTab('trade');
  else if (hash === 'ledger' || hash === 'real') showTab('ledger');
  else if (hash === 'bank' || hash === 'onlinebank') showTab('onlinebank');
  else if (hash === 'web3' || hash === 'dapp') showTab('web3');
  else if (hash === 'ai') showTab('ai');
  else if (hash && SCREEN_ALIASES[hash]) showTab(hash);
  renderWeb3();
}

function fillChainSelects() {
  document.querySelectorAll('select.chain-select').forEach(sel => {
    sel.innerHTML = chains.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  });
}

async function bridgeStatus() {
  const j = await api('/bridge/status');
  const el = document.getElementById('status');
  if (el) {
    el.textContent = j.nodeOk ? 'ok' : 'off';
    el.className = j.nodeOk ? 'ok' : '';
  }
  const dot = document.getElementById('network-dot');
  const name = document.getElementById('network-name');
  if (dot) {
    dot.classList.toggle('offline', !j.nodeOk);
    dot.classList.toggle('online', !!j.nodeOk);
  }
  if (name) name.textContent = j.nodeOk ? (j.chainId || 'OneX').replace('onex-', '').replace('-1', '') : 'Offline';
}

async function loadGreenHealth() {
  const bar = document.getElementById('green-health-bar');
  const grid = document.getElementById('green-health-grid');
  const title = document.getElementById('green-health-title');
  const dot = document.getElementById('green-health-dot');
  if (!bar || !grid) return;
  const evmQ = getEvmHolder() ? `?evm=${encodeURIComponent(getEvmHolder())}` : '';
  const j = await api('/bridge/health/green' + evmQ);
  if (j.error) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  const isGreen = j.status === 'green' || j.allGreen;
  bar.classList.toggle('degraded', !isGreen);
  if (title) title.textContent = isGreen ? 'All systems green' : 'Some checks need attention';
  if (dot) dot.style.background = isGreen ? '#00e5b0' : '#ff9500';
  grid.innerHTML = (j.checks || []).map(c =>
    `<span class="green-check ${c.status}">${c.status === 'green' ? '✓' : c.status === 'amber' ? '◐' : '✗'} ${c.label}</span>`
  ).join('');
}

async function loadProductionPlatform(existing) {
  const banner = document.getElementById('production-platform-banner');
  const badge = document.getElementById('production-platform-badge');
  const detail = document.getElementById('production-platform-detail');
  const bankBanner = document.getElementById('online-bank-production');
  const bankBadge = document.getElementById('online-bank-production-badge');
  const bankDetail = document.getElementById('online-bank-production-detail');
  if (!banner && !bankBanner) return existing;
  let j = existing;
  if (!j) {
    const evmQ = getEvmHolder() ? `?evm=${encodeURIComponent(getEvmHolder())}` : '';
    j = await api('/bridge/production/status' + evmQ);
  }
  if (j.error || !j.production) {
    banner?.classList.add('hidden');
    bankBanner?.classList.add('hidden');
    return j;
  }
  const evmQ = getEvmHolder() ? `?evm=${encodeURIComponent(getEvmHolder())}` : '';
  await api('/bridge/production/bootstrap' + evmQ, { method: 'POST' });
  await loadGreenHealth();
  banner?.classList.remove('hidden');
  bankBanner?.classList.remove('hidden');
  const domain = j.domain || 'production';
  if (badge) badge.textContent = domain;
  if (bankBadge) bankBadge.textContent = domain;
  const ledgerUsd = j.ledgerTotalUsd != null ? fmtUsd(j.ledgerTotalUsd) : '—';
  const tokens = j.platform?.totalTokens ?? '—';
  const bankOnline = j.onlineBank?.online ? 'online bank live' : 'bank offline';
  const hybx = j.hybx?.enabled || j.hybrix?.enabled ? 'HYBX on' : 'HYBX off';
  const fineract = j.fineract?.online ? 'Fineract on' : (j.fineract?.enabled ? 'Fineract cfg' : 'Fineract off');
  const cards = j.virtualCards?.active ?? 0;
  const hybxCards = j.virtualCards?.hybxCards ?? 0;
  const mwRoutes = j.hybxMiddleware?.routes ?? 0;
  const line = `Real ledger ${ledgerUsd} · ${tokens} platform tokens · node ${j.nodeReady ? 'online' : 'offline'} · ${bankOnline} · ${hybx} · ${fineract} · ${cards} cards (${hybxCards} HYBX) · ${mwRoutes} exchange routes`;
  if (detail) detail.textContent = line;
  if (bankDetail) bankDetail.textContent = line;
  return j;
}

async function refreshAll() {
  await bridgeStatus();
  await loadGreenHealth();
  await loadProductionPlatform();
  await loadMarketPrices();
  try {
    const evmQ = getEvmHolder() ? `?evm=${encodeURIComponent(getEvmHolder())}` : '';
    portfolio = await api('/bridge/portfolio' + evmQ);
    if (portfolio.error) {
      document.getElementById('portfolio-grid').innerHTML = `
        <div class="empty-state"><p>${portfolio.error}</p>
        <button type="button" class="btn-primary" onclick="createWallet()">Create wallet</button></div>`;
      return;
    }
    if (portfolio.mode === 'production' && portfolio.ledger) {
      renderRealPortfolio(portfolio);
    } else {
      renderPortfolio();
    }
    updateSwapCTA();
    renderNFTs();
    renderTasks();
    renderLoans();
    renderStakes();
    renderPlatformTokens();
    const addr = portfolio.address || portfolio.portfolio?.address || '';
    const addrEl = document.getElementById('addr');
    const shortEl = document.getElementById('addr-short');
    if (addrEl) addrEl.textContent = addr;
    if (shortEl) shortEl.textContent = addr ? addr.slice(0, 8) + '…' + addr.slice(-6) : '';
  } catch (e) {
    console.error(e);
  }
}

function renderPortfolio() {
  const grid = document.getElementById('portfolio-grid');
  const entries = Object.entries(portfolio.balances || {})
    .filter(([k, v]) => !k.startsWith('lp:') && BigInt(v || 0) > 0n);
  if (!entries.length) {
    grid.innerHTML = `<div class="empty-state"><p>No assets yet</p>
      <button type="button" class="btn-secondary" onclick="openSheet('deposit')">Deposit</button></div>`;
    updateHomeBalance([]);
    return;
  }
  const rows = entries.map(([key, val]) => {
    const [chainId, tokenId] = key.split(':');
    const chain = chains.find(c => c.id === chainId);
    const tok = tokens.find(t => t.chainId === chainId && t.id === tokenId);
    const sym = tok?.symbol || tokenId;
    const dec = tok?.decimals || 8;
    const usd = usdValue(val, dec, sym);
  return { key, val, chain, tok, sym, dec, amt: fmtAtomic(val, dec), usd };
  });
  rows.sort((a, b) => b.usd - a.usd || Number(BigInt(b.val) - BigInt(a.val)));
  lastPortfolioSymbols = rows.map(r => r.sym);
  grid.innerHTML = rows.map((row) => {
    const { chain, sym, amt, usd, chainId } = row;
    const color = chain?.color || '#fff';
    const pq = priceForSymbol(sym);
    const ch = pq.usd24hChange;
    const chHtml = ch ? `<span class="asset-change ${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%</span>` : '';
    const priceLine = pq.usd > 0 ? `<span class="asset-price">@ ${fmtUsd(pq.usd)}</span>` : '';
    return `<div class="asset-row" role="button" tabindex="0" onclick="openTokenDetail(${JSON.stringify(sym)})" onkeydown="if(event.key==='Enter')openTokenDetail(${JSON.stringify(sym)})">
      ${tokenIconHtml(sym, color)}
      <div class="asset-info">
        <div class="asset-symbol">${sym}</div>
        <div class="asset-name">${chain?.name || chainId} ${chHtml} ${priceLine}</div>
      </div>
      ${sparklinePlaceholder(sym)}
      <div class="asset-right">
        <div class="asset-amount">${amt}</div>
        <div class="asset-fiat">${fmtUsd(usd)}</div>
      </div>
    </div>`;
  }).join('');
  hydrateTokenCharts(lastPortfolioSymbols, chartPeriod);
  updateHomeBalance(rows);
}

function renderRealPortfolio(wrapped) {
  const snap = wrapped.ledger || {};
  const entries = snap.entries || [];
  const grid = document.getElementById('portfolio-grid');
  portfolio = wrapped.portfolio || portfolio;
  if (!entries.length) {
    grid.innerHTML = `<div class="empty-state"><p>No real assets yet</p>
      <p class="msg">Bank + on-chain only. Set EVM address in Settings or import a ledger.</p>
      <button type="button" class="btn-secondary" onclick="showTab('ledger')">Real Ledger</button></div>`;
    updateHomeBalanceReal(snap.totalUsd || 0, 0);
    return;
  }
  const sorted = [...entries].sort((a, b) => (b.fiatUsd || 0) - (a.fiatUsd || 0));
  grid.innerHTML = sorted.map(e => {
    const sym = e.asset || '?';
    const chain = chains.find(c => c.id === e.chainId);
    const color = chain?.color || (e.mode === 'bank' || e.mode === 'fiat' ? '#4a9eff' : '#00e5b0');
    const sub = [e.source, e.mode, e.account].filter(Boolean).join(' · ');
    return `<div class="asset-row" role="button" tabindex="0" onclick="showTab('ledger')">
      <div class="asset-icon" style="background:${color}22;color:${color}">${sym.slice(0, 2)}</div>
      <div class="asset-info">
        <div class="asset-symbol">${sym} <span class="ledger-mode ${e.mode === 'simulated' ? 'sim' : 'real'}">${e.mode}</span></div>
        <div class="asset-name">${sub}</div>
      </div>
      <div class="asset-right">
        <div class="asset-amount">${e.human || '—'}</div>
        <div class="asset-fiat">${fmtUsd(e.fiatUsd)}</div>
      </div>
    </div>`;
  }).join('');
  updateHomeBalanceReal(snap.totalUsd || wrapped.realUsd || 0, entries.length);
  lastPortfolioSymbols = sorted.map(e => e.asset).filter(Boolean);
}

function updateHomeBalanceReal(totalUsd, count) {
  const totalEl = document.getElementById('balance-total');
  const subEl = document.getElementById('balance-sub');
  const display = totalUsd > 0 ? fmtUsd(totalUsd) : (count ? '$0.00' : '—');
  if (totalEl) totalEl.textContent = display;
  if (subEl) {
    subEl.textContent = count ? `${count} real assets · production` : 'Production · connect bank or EVM';
    subEl.className = 'balance-sub balance-change positive';
  }
  if (totalUsd > 0) {
    seedChartIfEmpty(display);
    recordBalanceSnapshot(display);
    renderPortfolioChart();
  }
  const web3Addr = document.getElementById('web3-addr');
  if (web3Addr && portfolio?.address) web3Addr.textContent = portfolio.address;
}

async function openTokenDetail(sym) {
  const row = (portfolio?.balances && tokens.length)
    ? Object.entries(portfolio.balances).find(([k]) => {
        const [cid, tid] = k.split(':');
        const t = tokens.find(x => x.chainId === cid && x.id === tid);
        return (t?.symbol || tid) === sym;
      })
    : null;
  let amt = '0', usd = 0, chainName = '';
  if (row) {
    const [key, val] = row;
    const [chainId, tokenId] = key.split(':');
    const tok = tokens.find(t => t.chainId === chainId && t.id === tokenId);
    const dec = tok?.decimals || 8;
    amt = fmtAtomic(val, dec);
    usd = usdValue(val, dec, sym);
    chainName = chains.find(c => c.id === chainId)?.name || chainId;
  }
  selectedTokenRow = { sym, amt, usd, chainName };
  const title = document.getElementById('token-chart-title');
  const sub = document.getElementById('token-chart-sub');
  const icon = document.getElementById('token-chart-icon');
  if (title) title.textContent = sym;
  if (sub) sub.textContent = `${amt} · ${fmtUsd(usd)} · ${chainName}`;
  if (icon) {
    const chain = chains.find(c => c.name === chainName);
    icon.innerHTML = tokenIconHtml(sym, chain?.color || '#d4af37');
  }
  document.querySelectorAll('#token-chart-periods button').forEach(b => {
    b.classList.toggle('active', b.dataset.period === chartPeriod);
  });
  openSheet('token');
  await renderTokenDetailChart(sym, chartPeriod);
}

async function renderTokenDetailChart(sym, period) {
  const svg = document.getElementById('token-detail-chart');
  const changeEl = document.getElementById('token-chart-change');
  const priceEl = document.getElementById('token-chart-price');
  if (!svg) return;
  const pts = await loadTokenChart(sym, period);
  const pq = priceForSymbol(sym);
  if (priceEl) priceEl.textContent = pq.usd > 0 ? fmtUsd(pq.usd) : '—';
  svg.innerHTML = renderPriceChartSvg(pts, 360, 120, { pad: 6, strokeWidth: 2.2, detail: true, gradId: 'tokenDetailGrad' });
  if (changeEl && pts.length >= 2) {
    const v0 = pts[0].v, v1 = pts[pts.length - 1].v;
    const pct = v0 ? ((v1 - v0) / v0) * 100 : 0;
    const sign = pct >= 0 ? '+' : '';
    changeEl.textContent = `${sign}${pct.toFixed(2)}%`;
    changeEl.className = pct >= 0 ? 'positive' : 'negative';
  }
}

function setTokenChartPeriod(period) {
  document.querySelectorAll('#token-chart-periods button').forEach(b => {
    b.classList.toggle('active', b.dataset.period === period);
  });
  setChartPeriod(period);
}

function updateHomeBalance(entries) {
  let totalUsd = 0;
  const list = Array.isArray(entries) && entries.length && entries[0].usd != null
    ? entries
    : (entries || []).map(([key, val]) => {
        const [chainId, tokenId] = key.split(':');
        const tok = tokens.find(t => t.chainId === chainId && t.id === tokenId);
        const sym = tok?.symbol || tokenId;
        return { usd: usdValue(val, tok?.decimals || 8, sym) };
      });
  for (const row of list) totalUsd += row.usd || 0;

  const totalEl = document.getElementById('balance-total');
  const subEl = document.getElementById('balance-sub');
  const display = totalUsd > 0 ? fmtUsd(totalUsd) : (list.length ? '$0.00' : '—');
  if (totalEl) totalEl.textContent = display;
  if (subEl) {
    const hist = filterHistoryByPeriod(getBalanceHistory(), '24h');
    if (hist.length >= 2) {
      const pct = hist[0].v ? ((hist[hist.length - 1].v - hist[0].v) / hist[0].v) * 100 : 0;
      const sign = pct >= 0 ? '+' : '';
      subEl.textContent = `${sign}${pct.toFixed(2)}% (24h) · ${list.length} assets`;
      subEl.className = 'balance-sub balance-change ' + (pct >= 0 ? 'positive' : 'negative');
    } else {
      subEl.textContent = list.length ? `${list.length} assets · live prices` : 'Create or import wallet';
      subEl.className = 'balance-sub balance-change positive';
    }
  }
  seedChartIfEmpty(display);
  recordBalanceSnapshot(display);
  renderPortfolioChart();
  const web3Addr = document.getElementById('web3-addr');
  if (web3Addr && portfolio?.address) web3Addr.textContent = portfolio.address;
}

async function createWallet() {
  await api('/bridge/wallet/create', { method: 'POST' });
  refreshAll();
}

async function doSend() {
  const body = {
    chainId: document.getElementById('send-chain').value,
    tokenId: document.getElementById('send-token').value,
    to: document.getElementById('send-to').value.trim(),
    amount: document.getElementById('send-amount').value,
    fee: document.getElementById('send-fee').value,
  };
  const j = await api('/bridge/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  document.getElementById('send-msg').textContent = j.error || j.status || 'sent';
  refreshAll();
}

async function loadDeposit() {
  const chain = document.getElementById('dep-chain').value;
  const j = await api('/bridge/deposit/info?chain=' + encodeURIComponent(chain));
  document.getElementById('dep-info').innerHTML = `
    <p><strong>${j.chain?.name}</strong></p>
    <p class="addr">${j.depositAddress}</p>
    <p class="msg">${j.note}</p>`;
}

async function doDeposit() {
  const body = {
    chainId: document.getElementById('dep-chain').value,
    tokenId: document.getElementById('dep-token').value,
    amount: document.getElementById('dep-amount').value,
    txHash: document.getElementById('dep-tx').value,
  };
  const j = await api('/bridge/deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  document.getElementById('dep-msg').textContent = j.error || j.status || 'recorded';
  refreshAll();
}

async function renderStakePools() {
  const pools = await api('/bridge/stake/pools');
  const grid = document.getElementById('stake-pools');
  if (!grid) return;
  grid.innerHTML = pools.map(p => `
    <div class="asset-row">
      <div class="asset-icon">%</div>
      <div class="asset-info">
        <div class="asset-symbol">${p.stakeToken} → ${p.receiptToken}</div>
        <div class="asset-name">${p.apy}% APY · ${p.lockDays}d lock</div>
      </div>
    </div>`).join('');
  const sel = document.getElementById('stake-pool');
  sel.innerHTML = pools.map(p => `<option value="${p.id}">${p.stakeToken} → ${p.receiptToken} (${p.apy}%)</option>`).join('');
}

function renderStakes() {
  const list = portfolio?.stakes || [];
  document.getElementById('stake-list').innerHTML = list.length ? list.map(s => `
    <div class="task-card ${s.status}">
      <strong>${s.stakeKey}</strong> → ${s.receiptKey}
      <p class="msg">${fmtAtomic(s.amount)} staked · ${s.apy}% APY</p>
      <span class="badge">${s.status}</span>
      ${s.status === 'active' ? `<button onclick="unstake('${s.id}')">Unstake</button>` : ''}
    </div>`).join('') : '<p class="msg">No active stakes.</p>';
}

async function doStake() {
  const body = { poolId: document.getElementById('stake-pool').value, amount: document.getElementById('stake-amount').value };
  const j = await api('/bridge/stake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  document.getElementById('stake-msg').textContent = j.error || 'Staked — receipt: ' + fmtAtomic(j.receiptAmount);
  await loadTokens();
  fillChainSelects();
  refreshAll();
}

async function unstake(id) {
  const j = await api('/bridge/unstake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
  document.getElementById('stake-msg').textContent = j.error || 'Unstaked: ' + (j.returned ? fmtAtomic(j.returned) : 'ok');
  refreshAll();
}

async function createToken() {
  const body = {
    chainId: document.getElementById('mint-chain').value,
    name: document.getElementById('mint-name').value,
    symbol: document.getElementById('mint-symbol').value,
    decimals: parseInt(document.getElementById('mint-decimals').value, 10) || 8,
    supply: document.getElementById('mint-supply').value,
  };
  const msg = document.getElementById('mint-msg');
  let j = await api('/bridge/platform/deploy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (j.error && /no wallet/i.test(j.error)) {
    await api('/bridge/wallet/create', { method: 'POST' });
    j = await api('/bridge/platform/deploy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  if (j.error) {
    msg.textContent = j.error;
    return;
  }
  msg.textContent = `Deployed ${j.symbol} on ${j.chainId} · ${j.contractAddress || j.id}`;
  if (j.contractAddress) {
    await showDeployListingBridge(j.chainId, j.contractAddress, j.name, j.symbol);
  }
  await loadTokens();
  fillChainSelects();
  fillWrapSelects();
  refreshAll();
  loadTokenPlatform();
}

function setPlatformTab(tab) {
  document.querySelectorAll('.platform-tab').forEach(b => b.classList.toggle('active', b.dataset.ptab === tab));
  document.querySelectorAll('.platform-pane').forEach(p => p.classList.add('hidden'));
  document.getElementById('platform-' + tab)?.classList.remove('hidden');
  if (tab === 'tokens') renderPlatformTokens();
  if (tab === 'markets') renderPlatformMarkets();
  if (tab === 'history') renderWrapHistory();
}

function fmtMarketUsd(v) {
  if (v == null || v === 0) return '—';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(2) + 'K';
  if (v >= 1) return '$' + Number(v).toFixed(4);
  return '$' + Number(v).toFixed(8);
}

function renderMarketStrip(m) {
  if (!m) return '';
  const ch = m.priceChange24h != null ? `${m.priceChange24h >= 0 ? '+' : ''}${Number(m.priceChange24h).toFixed(2)}%` : '—';
  return `<div class="market-strip">
    <span class="market-stat"><em>Price</em><strong>${fmtMarketUsd(m.priceUsd)}</strong><small>${ch} 24h</small></span>
    <span class="market-stat"><em>Market cap</em><strong>${fmtMarketUsd(m.marketCapUsd)}</strong></span>
    <span class="market-stat"><em>Liquidity</em><strong>${fmtMarketUsd(m.liquidityUsd)}</strong></span>
  </div>`;
}

function renderListingProviders(listing) {
  if (!listing?.providers?.length) return '';
  const prod = listing.production || listing.mode === 'production';
  return `<div class="listing-providers">${listing.providers.map(p => {
    const cls = (p.status === 'active' || prod) ? 'active' : p.status;
    return `<a class="listing-link ${cls}" href="${escapeHtml(p.submitUrl)}" target="_blank" rel="noopener" title="${escapeHtml(p.notes || '')}">${escapeHtml(p.name)}${p.status === 'active' ? ' ✓' : ''}</a>`;
  }).join('')}</div>`;
}

function renderListingHead(j) {
  const r = j.readiness || {};
  const prod = j.production || j.mode === 'production';
  if (prod) {
    return `<div class="listing-head">
      <span class="badge green">Production · all listings active</span>
      <span class="msg">CoinGecko · CMC · Gecko Terminal · DexScreener · Explorer</span>
    </div>`;
  }
  return `<div class="listing-head">
    <span class="badge ${r.ready ? 'green' : 'amber'}">${r.ready ? 'Listing ready' : 'Pending liquidity'}</span>
    <span class="msg">Score ${r.score || 0}${r.missing?.length ? ' · ' + r.missing.join(', ') : ''}</span>
  </div>`;
}

async function showDeployListingBridge(chainId, address, name, symbol) {
  const body = JSON.stringify({
    chainId, tokenAddress: address, name, symbol,
    supply: document.getElementById('mint-supply')?.value || '',
  });
  const j = await api('/bridge/listings/bridge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const msg = document.getElementById('mint-msg');
  if (j.error || !msg) return;
  const m = j.market || {};
  msg.innerHTML = `Deployed · ${renderMarketStrip(m)}${renderListingProviders(j)}`;
  setPlatformTab('markets');
  const chainSel = document.getElementById('listing-chain');
  const tok = document.getElementById('listing-token');
  if (chainSel) chainSel.value = chainId;
  if (tok) tok.value = address;
  renderListingResult(j);
}

async function runListingBridge() {
  const chainId = document.getElementById('listing-chain')?.value;
  const token = document.getElementById('listing-token')?.value?.trim();
  const name = document.getElementById('listing-name')?.value?.trim();
  const symbol = document.getElementById('listing-symbol')?.value?.trim();
  const el = document.getElementById('listing-result');
  if (!token) {
    if (el) el.innerHTML = '<p class="msg">Enter token contract address</p>';
    return;
  }
  if (el) el.innerHTML = '<p class="msg">Building listing bridge…</p>';
  const j = await api('/bridge/listings/bridge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chainId, tokenAddress: token, name, symbol,
      supply: document.getElementById('mint-supply')?.value || '',
    }),
  });
  if (j.error) {
    if (el) el.innerHTML = `<p class="msg">${escapeHtml(j.error)}</p>`;
    return;
  }
  renderListingResult(j);
}

function renderListingResult(j) {
  const el = document.getElementById('listing-result');
  if (!el) return;
  el.innerHTML = `
    ${renderListingHead(j)}
    ${renderMarketStrip(j.market)}
    ${renderListingProviders(j)}
    <p class="token-meta"><a href="${escapeHtml(j.explorerTokenUrl || '#')}" target="_blank" rel="noopener">${escapeHtml(explorerLabelForChain(j.chainId))}</a></p>`;
}

function explorerLabelForChain(chainId) {
  const m = { bsc: 'BSCScan', ethereum: 'Etherscan', 'dbis-138': 'DBIS Explorer', polygon: 'Polygonscan' };
  return m[chainId] || 'Explorer';
}

async function renderPlatformMarkets() {
  document.querySelectorAll('#listing-chain').forEach(sel => {
    if (sel.options.length) return;
    sel.innerHTML = chains.filter(c => c.type === 'evm' || c.id === 'dbis-138')
      .map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  });
  const listEl = document.getElementById('platform-market-list');
  if (!listEl) return;
  listEl.innerHTML = '<p class="msg">Loading market data…</p>';
  const j = await api('/bridge/listings/platform');
  if (j.error) {
    listEl.innerHTML = `<p class="msg">${escapeHtml(j.error)}</p>`;
    return;
  }
  const tokens = j.tokens || [];
  if (!tokens.length) {
    listEl.innerHTML = '<p class="msg">Deploy a token first — market data appears after on-chain liquidity.</p>';
    return;
  }
  listEl.innerHTML = tokens.map(t => {
    const m = t.market || {};
    const lb = t.listing || {};
    const prod = lb.production || lb.mode === 'production';
    return `<div class="task-card ${prod ? 'listing-prod' : ''}">
      <strong>${escapeHtml(t.symbol)}</strong> — ${escapeHtml(t.name)}
      <span class="deploy-badge ${prod ? 'green' : ''}">${prod ? 'production · active' : escapeHtml(t.deployStatus || 'deployed')}</span>
      <p class="msg">${escapeHtml(t.chainId)} · ${escapeHtml(t.contractAddress || t.id || '')}</p>
      ${renderMarketStrip(m)}
      ${renderListingProviders(lb)}
    </div>`;
  }).join('');
}

async function loadTokenPlatform() {
  const st = await api('/bridge/platform/status');
  const el = document.getElementById('platform-status-msg');
  if (el) {
    if (st.error) el.textContent = st.error.includes('404') || st.error.includes('Not Found')
      ? 'Restart wallet bridge: run-onex-wallet.bat'
      : st.error;
    else el.textContent = `${st.totalTokens || 0} tokens · ${st.totalWraps || 0} wraps · ${st.chainsSupported || 0} chains`;
  }
  fillWrapSelects();
  renderPlatformTokens();
  renderWrapHistory();
}

function fillWrapSelects() {
  document.querySelectorAll('#wrap-from-chain, #wrap-to-chain').forEach(sel => {
    if (!sel) return;
    sel.innerHTML = chains.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  });
  const fromChain = document.getElementById('wrap-from-chain')?.value || chains[0]?.id;
  const sel = document.getElementById('wrap-from-token');
  if (sel) {
    const chainTokens = tokens.filter(t => t.chainId === fromChain);
    sel.innerHTML = chainTokens.map(t => `<option value="${t.id}">${t.symbol} (${t.id})</option>`).join('') || '<option value="">No tokens</option>';
  }
  const fromEl = document.getElementById('wrap-from-chain');
  if (fromEl && !fromEl._wrapBound) {
    fromEl._wrapBound = true;
    fromEl.addEventListener('change', fillWrapSelects);
  }
}

async function renderPlatformTokens() {
  const el = document.getElementById('platform-tokens-list');
  if (!el) return;
  const list = await api('/bridge/platform/tokens');
  if (list && list.error) {
    el.innerHTML = `<p class="msg">${list.error}</p>`;
    return;
  }
  if (!Array.isArray(list)) {
    el.innerHTML = '<p class="msg">Platform unavailable — rebuild and restart: build-onex.bat then run-onex-wallet.bat</p>';
    return;
  }
  el.innerHTML = list.length ? list.map(t => `
    <div class="task-card">
      <strong>${t.symbol}</strong> — ${t.name}
      <span class="deploy-badge">${t.deployStatus || 'registered'}</span>
      <p class="msg">${t.chainId} · ${t.chainType} · supply ${fmtAtomic(t.supply, t.decimals || 8)}</p>
      ${t.contractAddress ? `<p class="token-meta">${t.contractAddress}</p>` : ''}
      ${t.isWrapped ? '<p class="msg">Wrapped token</p>' : ''}
      ${t.contractAddress ? `<button type="button" class="dex-max ledger-max" data-chain="${escapeHtml(t.chainId)}" data-addr="${escapeHtml(t.contractAddress)}" data-name="${escapeHtml(t.name)}" data-sym="${escapeHtml(t.symbol)}" onclick="prefillListingFromBtn(this)">Markets &amp; listings</button>` : ''}
    </div>`).join('') : '<p class="msg">No tokens yet. Deploy one in the Create tab.</p>';
}

function prefillListingFromBtn(btn) {
  if (!btn?.dataset) return;
  prefillListing(btn.dataset.chain, btn.dataset.addr, btn.dataset.name, btn.dataset.sym);
}

function prefillListing(chainId, address, name, symbol) {
  setPlatformTab('markets');
  const c = document.getElementById('listing-chain');
  const t = document.getElementById('listing-token');
  const n = document.getElementById('listing-name');
  const s = document.getElementById('listing-symbol');
  if (c) c.value = chainId;
  if (t) t.value = address;
  if (n) n.value = name || '';
  if (s) s.value = symbol || '';
  runListingBridge();
}

async function wrapToken() {
  const body = {
    originChainId: document.getElementById('wrap-from-chain').value,
    originTokenId: document.getElementById('wrap-from-token').value,
    targetChainId: document.getElementById('wrap-to-chain').value,
    amount: document.getElementById('wrap-amount').value,
  };
  const j = await api('/bridge/platform/wrap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const msg = document.getElementById('wrap-msg');
  if (j.error) {
    msg.textContent = j.error;
    return;
  }
  const w = j.wrapped || {};
  msg.textContent = `Wrapped → ${w.symbol || ''} on ${w.chainId || body.targetChainId}`;
  await loadTokens();
  refreshAll();
  loadTokenPlatform();
}

async function renderWrapHistory() {
  const el = document.getElementById('wrap-history');
  if (!el) return;
  const list = await api('/bridge/platform/wraps');
  if (!Array.isArray(list)) {
    el.innerHTML = '<p class="msg">No wrap history.</p>';
    return;
  }
  el.innerHTML = list.length ? list.map(w => `
    <div class="task-card">
      <strong>${w.originKey}</strong> → ${w.targetChainId}:${w.wrappedTokenId}
      <p class="msg">${fmtAtomic(w.amount)} · ${w.status}</p>
    </div>`).join('') : '<p class="msg">No cross-chain wraps yet.</p>';
}

async function renderCustomTokens() {
  await renderPlatformTokens();
}

function tokenKey(chain, tokenId) {
  return `${chain}:${tokenId}`;
}

let swapQuoteTimer;
function swapQuoteDebounced() {
  clearTimeout(swapQuoteTimer);
  swapQuoteTimer = setTimeout(onexSwapQuote, 400);
}

function setSwapMode(mode) {
  ['swap', 'pool', 'bridge'].forEach(m => {
    document.getElementById('swap-mode-' + m)?.classList.toggle('hidden', m !== mode);
    document.getElementById('sub-' + m)?.classList.toggle('active', m === mode);
  });
  if (mode === 'swap' || mode === 'pool') loadAmmPools();
}

function toggleSlippagePanel() {
  document.getElementById('dex-slippage-panel')?.classList.toggle('hidden');
}

function updateSlipDisplay() {
  const v = document.getElementById('swap-slippage')?.value || '0.5';
  const el = document.getElementById('slip-display');
  if (el) el.textContent = v + '%';
}

function setMaxSwap() {
  const chain = document.getElementById('swap-from-chain')?.value;
  const token = document.getElementById('swap-from-token')?.value;
  if (!chain || !token || !portfolio?.balances) return;
  const key = `${chain}:${token}`;
  const bal = portfolio.balances[key];
  if (!bal || BigInt(bal) <= 0n) return;
  const tok = tokens.find(t => t.chainId === chain && t.id === token);
  document.getElementById('swap-amount').value = fmtAtomic(bal, tok?.decimals || 8);
  swapQuoteDebounced();
}

function updateSwapCTA() {
  const btn = document.getElementById('swap-cta');
  if (!btn) return;
  if (!portfolio?.address) {
    btn.textContent = 'Create Wallet to Swap';
    btn.classList.add('secondary');
    btn.onclick = () => { createWallet(); };
  } else {
    btn.textContent = 'Swap';
    btn.classList.remove('secondary');
    btn.onclick = () => doOneXSwap();
  }
}

async function updateDexStatus() {
  try {
    const [st, swap] = await Promise.all([
      api('/bridge/status'),
      api('/bridge/onex-swap/status'),
    ]);
    const apiEl = document.getElementById('dex-st-api');
    const nodeEl = document.getElementById('dex-st-node');
    const swapEl = document.getElementById('dex-st-swap');
    if (apiEl) apiEl.className = 'ok';
    if (nodeEl) nodeEl.className = st.nodeOk ? 'ok' : 'off';
    if (swapEl) swapEl.className = swap.active ? 'ok' : 'off';
    const rails = document.getElementById('swap-rails-status');
    if (rails) {
      rails.textContent = swap.active
        ? `${swap.pools || 0} pools · swap active`
        : 'swap inactive — click Activate swap';
    }
  } catch (_) {
    document.getElementById('dex-st-api')?.classList.add('off');
    document.getElementById('dex-st-node')?.classList.add('off');
    document.getElementById('dex-st-swap')?.classList.add('off');
  }
}

async function activateSwapTokens() {
  const btn = document.getElementById('activate-swap-btn');
  const msg = document.getElementById('swap-msg');
  if (btn) { btn.disabled = true; btn.textContent = 'Activating…'; }
  if (!portfolio?.address) {
    await api('/bridge/wallet/create', { method: 'POST' });
    await refreshAll();
  }
  await connectGlobalProductionServer();
  const j = await api('/bridge/onex-swap/activate', { method: 'POST' });
  if (btn) { btn.disabled = false; btn.textContent = 'Activate swap'; }
  if (j.error) {
    if (msg) msg.textContent = j.error;
    return;
  }
  if (msg) {
    msg.textContent = `✓ Swap active · ${j.pools || 0} pools · ${j.seededBalances || 0} token balances seeded`;
  }
  await loadAmmPools();
  await updateDexStatus();
  await refreshAll();
}

function renderDexPoolCards(pools, targetId) {
  const el = document.getElementById(targetId);
  if (!el) return;
  if (!pools?.length) {
    el.innerHTML = '<p class="msg" style="text-align:center;padding:20px">No pools yet. Add liquidity to create the first pool.</p>';
    return;
  }
  el.innerHTML = pools.map(p => {
    const [a, b] = [p.token0.split(':')[1], p.token1.split(':')[1]];
    const fee = (p.feeBps / 100).toFixed(2);
    return `<div class="dex-pool-card" onclick="selectPoolFromCard('${p.id}')">
      <div>
        <div class="pair">${a} / ${b}</div>
        <div class="meta">Fee ${fee}% · OneX AMM</div>
      </div>
      <div class="reserves">${fmtAtomic(p.reserve0)}<br><span style="font-size:11px;color:#6b7a8f">${fmtAtomic(p.reserve1)}</span></div>
    </div>`;
  }).join('');
}

function selectPoolFromCard(poolId) {
  setSwapMode('pool');
  const sel = document.getElementById('liq-pool');
  if (sel) {
    sel.value = poolId;
    showPoolReserves();
  }
}

function updateDexStats(pools) {
  const poolsEl = document.getElementById('dex-stat-pools');
  const tokEl = document.getElementById('dex-stat-tokens');
  const tvlEl = document.getElementById('dex-stat-tvl');
  if (poolsEl) poolsEl.textContent = String(pools?.length || 0);
  if (tokEl) tokEl.textContent = String(tokens?.length || 0);
  if (tvlEl && pools?.length) {
    let t = 0n;
    pools.forEach(p => { t += BigInt(p.reserve0 || 0) + BigInt(p.reserve1 || 0); });
    tvlEl.textContent = fmtAtomic(t.toString());
  }
}

function flipSwap() {
  const fc = document.getElementById('swap-from-chain');
  const ft = document.getElementById('swap-from-token');
  const tc = document.getElementById('swap-to-chain');
  const tt = document.getElementById('swap-to-token');
  const amt = document.getElementById('swap-amount').value;
  const out = document.getElementById('swap-out').value;
  [fc.value, tc.value] = [tc.value, fc.value];
  onChainChange(fc, 'swap-from-token');
  onChainChange(tc, 'swap-to-token');
  const tmp = ft.innerHTML; ft.innerHTML = tt.innerHTML; tt.innerHTML = tmp;
  const ti = ft.selectedIndex; ft.selectedIndex = tt.selectedIndex; tt.selectedIndex = ti;
  document.getElementById('swap-amount').value = out;
  onexSwapQuote();
}

async function onexSwapQuote() {
  const tin = tokenKey(document.getElementById('swap-from-chain').value, document.getElementById('swap-from-token').value);
  const tout = tokenKey(document.getElementById('swap-to-chain').value, document.getElementById('swap-to-token').value);
  const amount = document.getElementById('swap-amount').value;
  if (!amount) return;
  const q = new URLSearchParams({ tokenIn: tin, tokenOut: tout, amount });
  const j = await api('/bridge/onex-swap/quote?' + q);
  const quoteEl = document.getElementById('swap-quote');
  if (j.error) {
    if (quoteEl) { quoteEl.textContent = j.error; quoteEl.classList.add('err'); }
    document.getElementById('swap-out').value = '';
    return;
  }
  document.getElementById('swap-out').value = fmtAtomic(j.amountOut);
  if (quoteEl) {
    quoteEl.classList.remove('err');
    quoteEl.textContent = `Price impact ${j.priceImpact} · ${(j.poolId||'').split('|').map(x=>x.split(':')[1]).join(' / ')}`;
  }
}

async function doOneXSwap() {
  const tin = tokenKey(document.getElementById('swap-from-chain').value, document.getElementById('swap-from-token').value);
  const tout = tokenKey(document.getElementById('swap-to-chain').value, document.getElementById('swap-to-token').value);
  const slip = parseFloat(document.getElementById('swap-slippage').value) || 0.5;
  const body = {
    tokenIn: tin, tokenOut: tout,
    amount: document.getElementById('swap-amount').value,
    slippageBps: Math.round(slip * 100),
  };
  const j = await api('/bridge/onex-swap/swap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  document.getElementById('swap-msg').textContent = j.error || `Swapped! Received ${fmtAtomic(j.amountOut)}`;
  loadAmmPools();
  refreshAll();
}

async function loadAmmPools() {
  const pools = await api('/bridge/onex-swap/pools');
  updateDexStats(pools);
  renderDexPoolCards(pools, 'dex-top-pools');
  renderDexPoolCards(pools, 'amm-pools');
  const sel = document.getElementById('liq-pool');
  if (sel) {
    sel.innerHTML = pools.map(p => {
      const label = p.token0.split(':')[1] + '/' + p.token1.split(':')[1];
      return `<option value="${p.id}" data-t0="${p.token0}" data-t1="${p.token1}" data-r0="${p.reserve0}" data-r1="${p.reserve1}">${label}</option>`;
    }).join('');
    showPoolReserves();
  }
}

function showPoolReserves() {
  const o = document.getElementById('liq-pool').selectedOptions[0];
  if (!o) return;
  document.getElementById('pool-reserves').textContent = `Reserves: ${fmtAtomic(o.dataset.r0)} / ${fmtAtomic(o.dataset.r1)}`;
}

async function addLiquidity() {
  const o = document.getElementById('liq-pool').selectedOptions[0];
  const body = { token0: o.dataset.t0, token1: o.dataset.t1, amount0: document.getElementById('liq-amount0').value, amount1: document.getElementById('liq-amount1').value };
  const j = await api('/bridge/onex-swap/liquidity/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  document.getElementById('liq-msg').textContent = j.error || `Added liquidity · shares ${j.shares}`;
  loadAmmPools(); refreshAll();
}

async function removeLiquidity() {
  const body = { poolId: document.getElementById('liq-pool').value, shares: document.getElementById('liq-remove-shares').value };
  const j = await api('/bridge/onex-swap/liquidity/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  document.getElementById('liq-msg').textContent = j.error || `Removed ${fmtAtomic(j.amount0)} + ${fmtAtomic(j.amount1)}`;
  loadAmmPools(); refreshAll();
}

async function bridgeQuote() {
  const tin = tokenKey(document.getElementById('bridge-from-chain').value, document.getElementById('bridge-from-token').value);
  const tout = tokenKey(document.getElementById('bridge-to-chain').value, document.getElementById('bridge-to-token').value);
  const q = new URLSearchParams({ tokenIn: tin, tokenOut: tout, amount: document.getElementById('bridge-amount').value });
  const j = await api('/bridge/onex-swap/bridge/quote?' + q);
  document.getElementById('bridge-quote').textContent = j.error || `Route: ${(j.route||[]).map(k=>k.split(':')[1]).join(' → ')} · Out ${fmtAtomic(j.amountOut)}`;
}

async function bridgeSwap() {
  const tin = tokenKey(document.getElementById('bridge-from-chain').value, document.getElementById('bridge-from-token').value);
  const tout = tokenKey(document.getElementById('bridge-to-chain').value, document.getElementById('bridge-to-token').value);
  const body = { tokenIn: tin, tokenOut: tout, amount: document.getElementById('bridge-amount').value, slippageBps: 50 };
  const j = await api('/bridge/onex-swap/bridge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  document.getElementById('bridge-msg').textContent = j.error || 'Bridge swap complete';
  loadAmmPools(); refreshAll();
}

function renderNFTs() {
  const list = portfolio?.nfts || [];
  document.getElementById('nft-list').innerHTML = list.length ? list.map(n => `
    <div class="nft-card">
      <div class="nft-img">${n.imageUrl ? `<img src="${n.imageUrl}" alt="">` : '🖼'}</div>
      <strong>${n.name}</strong>
      <p class="msg">${n.description || ''}</p>
      <p class="addr">${n.id.slice(0,12)}…</p>
    </div>`).join('') : '<p class="msg">No NFTs. Mint one below.</p>';
}

async function mintNFT() {
  const body = {
    name: document.getElementById('nft-name').value,
    description: document.getElementById('nft-desc').value,
    imageUrl: document.getElementById('nft-img').value,
    chainId: document.getElementById('nft-chain').value,
  };
  const j = await api('/bridge/nfts/mint', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  document.getElementById('nft-msg').textContent = j.error || 'minted: ' + j.name;
  refreshAll();
}

function renderTasks() {
  const list = portfolio?.tasks || [];
  document.getElementById('task-list').innerHTML = list.map(t => `
    <div class="task-card ${t.status}">
      <strong>${t.title}</strong>
      <p class="msg">${t.description}</p>
      <span class="badge">${t.status}</span>
      ${t.status === 'open' ? `<button onclick="completeTask('${t.id}')">Claim</button>` : ''}
    </div>`).join('');
}

async function completeTask(id) {
  await api('/bridge/tasks/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
  refreshAll();
}

function renderLoans() {
  const list = portfolio?.loans || [];
  document.getElementById('loan-list').innerHTML = list.length ? list.map(l => `
    <div class="loan-card">
      <strong>${l.type}</strong> · ${l.status} · APY ${l.apy}%
      <p class="msg">Collateral ${l.collateralKey}: ${fmtAtomic(l.collateralAmount)}</p>
      <p class="msg">Debt ${l.debtKey}: ${fmtAtomic(l.debtAmount)}</p>
      ${l.status === 'active' ? `<button onclick="repayLoan('${l.id}')">Repay</button>` : ''}
    </div>`).join('') : '<p class="msg">No active loans.</p>';
}

async function createLoan() {
  const body = {
    type: document.getElementById('loan-type').value,
    collateralKey: document.getElementById('loan-col-key').value,
    collateralAmount: document.getElementById('loan-col-amt').value,
    debtKey: document.getElementById('loan-debt-key').value,
    debtAmount: document.getElementById('loan-debt-amt').value,
    apy: parseFloat(document.getElementById('loan-apy').value) || 5.5,
  };
  const j = await api('/bridge/loans/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  document.getElementById('loan-msg').textContent = j.error || 'loan created';
  refreshAll();
}

async function repayLoan(id) {
  await api('/bridge/loans/repay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
  refreshAll();
}

function onChainChange(sel, tokenSelId) {
  const chain = sel.value;
  const tokSel = document.getElementById(tokenSelId);
  if (!tokSel) return;
  const list = tokens.filter(t => t.chainId === chain);
  tokSel.innerHTML = list.map(t => `<option value="${t.id}">${t.symbol}</option>`).join('');
}

function fundClassLabel(fc) {
  const k = (fc || '').toLowerCase();
  if (k === 'm0') return 'M0';
  if (k === 'm1') return 'M1';
  if (k === 'nsb') return 'NSB Sovereign';
  return fc ? fc.toUpperCase() : '';
}
const LEDGER_CONVERT_ASSETS = ['USD', 'EUR', 'GBP', 'BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'ONEX', 'SOL'];
let ledgerConvTimer = null;
let ledgerAccounts = [];
let ledgerDestinations = { chains: [], banks: [] };
let ledgerXferMode = 'dbis';
let ledgerDefaultBridgeChain = 'dbis-138';
let ledgerXferTimer = null;
let settlementKind = 'real_crypto';
let settlementTimer = null;
let ledgerImportTimer = null;
let ledgerReceiverWallets = [];
let ledgerExternalAssets = [];

function ledgerWalletAssets() {
  return ledgerExternalAssets.filter(a => a.kind === 'wallet' || !a.kind);
}

function ledgerBankAssets() {
  return ledgerExternalAssets.filter(a => a.kind === 'bank');
}

function buildLedgerConvertBody(active) {
  const acctSel = document.getElementById('ledger-conv-from-acct');
  const fromAsset = acctSel?.selectedOptions[0]?.dataset?.asset;
  const body = {
    fromAsset,
    toAsset: document.getElementById('ledger-conv-to')?.value,
    amount: document.getElementById('ledger-conv-amt')?.value,
    fromAccount: acctSel?.value,
    active: !!active,
  };
  const recv = document.getElementById('ledger-conv-receiver')?.value?.trim();
  const recvChain = document.getElementById('ledger-conv-receiver-chain')?.value;
  if (recv) {
    body.receiverAddress = recv;
    body.receiverChain = recvChain || ledgerDefaultBridgeChain;
    body.settleToReceiver = document.getElementById('ledger-conv-settle')?.checked !== false;
    if (active && document.getElementById('ledger-conv-save-receiver')?.checked) {
      body.saveReceiver = true;
      body.receiverLabel = recv.slice(0, 6) + '…' + recv.slice(-4);
    }
  }
  if (document.getElementById('ledger-conv-create-contract')?.checked) {
    body.createContract = true;
    body.tokenDeploy = {
      chainId: document.getElementById('ledger-conv-token-chain')?.value || recvChain || ledgerDefaultBridgeChain,
      name: document.getElementById('ledger-conv-token-name')?.value || '',
      symbol: document.getElementById('ledger-conv-token-symbol')?.value || body.toAsset,
      supply: document.getElementById('ledger-conv-token-supply')?.value || '1000000',
      decimals: 18,
    };
  }
  return body;
}

function toggleLedgerConvTokenPanel() {
  const on = document.getElementById('ledger-conv-create-contract')?.checked;
  document.getElementById('ledger-conv-token-panel')?.classList.toggle('hidden', !on);
  syncLedgerConvTokenFields();
  ledgerConvQuoteDebounced();
}

function syncLedgerConvTokenFields() {
  const to = document.getElementById('ledger-conv-to')?.value || '';
  const sym = document.getElementById('ledger-conv-token-symbol');
  const name = document.getElementById('ledger-conv-token-name');
  if (sym && !sym.value) sym.value = to;
  if (name && !name.value && to) name.value = to + ' Token';
}

async function loadLedgerAssets() {
  const j = await api('/bridge/ledger/assets');
  ledgerExternalAssets = j.assets || [];
  ledgerReceiverWallets = ledgerWalletAssets().map(a => ({
    id: a.id, label: a.label, chainId: a.chainId, address: a.address, createdAt: a.createdAt,
  }));
  refreshLedgerAssetSelects();
  renderSavedAssetsList();
}

async function loadLedgerReceivers() {
  await loadLedgerAssets();
}

function refreshLedgerAssetSelects() {
  refreshLedgerReceiverSelects();
  const walletOpts = ['<option value="">Saved wallets…</option>'].concat(
    ledgerWalletAssets().map(a =>
      `<option value="${a.id}" data-chain="${escapeHtml(a.chainId)}" data-addr="${escapeHtml(a.address)}">${escapeHtml(a.label)} · ${escapeHtml(a.chainId)}</option>`
    )
  );
  for (const id of ['ledger-settle-wallet-saved', 'ledger-xfer-wallet-saved']) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = walletOpts.join('');
  }
  const bankOpts = ['<option value="">Saved bank accounts…</option>'].concat(
    ledgerBankAssets().map(a =>
      `<option value="${a.id}" data-bank="${escapeHtml(a.bankId)}" data-rail="${escapeHtml(a.rail)}" data-iban="${escapeHtml(a.iban)}">${escapeHtml(a.label)} · ${escapeHtml((a.iban || '').slice(0, 8))}…</option>`
    )
  );
  for (const id of ['ledger-settle-bank-saved', 'ledger-xfer-bank-saved']) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = bankOpts.join('');
  }
}

function onSavedWalletPick(prefix) {
  const sel = document.getElementById(prefix === 'settle' ? 'ledger-settle-wallet-saved' : 'ledger-xfer-wallet-saved');
  const opt = sel?.selectedOptions[0];
  if (!opt?.dataset?.addr) return;
  const chainSel = document.getElementById(prefix === 'settle' ? 'ledger-settle-chain' : 'ledger-xfer-chain');
  const addr = document.getElementById(prefix === 'settle' ? 'ledger-settle-address' : 'ledger-xfer-address');
  if (chainSel && opt.dataset.chain) chainSel.value = opt.dataset.chain;
  if (addr) addr.value = opt.dataset.addr;
  if (prefix === 'settle') settlementPreviewDebounced();
  else ledgerXferPreviewDebounced();
}

function onSavedBankPick(prefix) {
  const sel = document.getElementById(prefix === 'settle' ? 'ledger-settle-bank-saved' : 'ledger-xfer-bank-saved');
  const opt = sel?.selectedOptions[0];
  if (!opt?.dataset?.iban) return;
  const bankSel = document.getElementById(prefix === 'settle' ? 'ledger-settle-bank' : 'ledger-xfer-bank');
  const railSel = document.getElementById(prefix === 'settle' ? 'ledger-settle-rail' : 'ledger-xfer-rail');
  const acct = document.getElementById(prefix === 'settle' ? 'ledger-settle-bank-acct' : 'ledger-xfer-bank-acct');
  if (bankSel && opt.dataset.bank) bankSel.value = opt.dataset.bank;
  if (railSel && opt.dataset.rail) railSel.value = opt.dataset.rail;
  if (acct) acct.value = opt.dataset.iban;
  if (prefix === 'settle') settlementPreviewDebounced();
  else ledgerXferPreviewDebounced();
}

async function saveCurrentWalletAsset(prefix) {
  const chainId = document.getElementById(prefix === 'settle' ? 'ledger-settle-chain' : 'ledger-xfer-chain')?.value || ledgerDefaultBridgeChain;
  const address = document.getElementById(prefix === 'settle' ? 'ledger-settle-address' : 'ledger-xfer-address')?.value?.trim();
  if (!address) return;
  const j = await api('/bridge/ledger/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'wallet', chainId, address, label: address.slice(0, 6) + '…' + address.slice(-4) }),
  });
  if (!j.error) await loadLedgerAssets();
}

async function saveCurrentBankAsset(prefix) {
  const bankId = document.getElementById(prefix === 'settle' ? 'ledger-settle-bank' : 'ledger-xfer-bank')?.value;
  const rail = document.getElementById(prefix === 'settle' ? 'ledger-settle-rail' : 'ledger-xfer-rail')?.value;
  const iban = document.getElementById(prefix === 'settle' ? 'ledger-settle-bank-acct' : 'ledger-xfer-bank-acct')?.value?.trim();
  if (!iban) return;
  const j = await api('/bridge/ledger/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'bank', bankId, rail, iban, label: (bankId || 'bank') + ' · ' + iban.slice(0, 4) + '…' }),
  });
  if (!j.error) await loadLedgerAssets();
}

function renderSavedAssetsList() {
  const el = document.getElementById('ledger-saved-assets');
  if (!el) return;
  if (!ledgerExternalAssets.length) {
    el.innerHTML = '<p class="msg">No saved wallets or IBAN accounts yet — use Save on settlement or bridge forms.</p>';
    return;
  }
  el.innerHTML = ledgerExternalAssets.map(a => {
    if (a.kind === 'bank') {
      return `<div class="asset-row"><span class="asset-icon">🏦</span><div class="asset-info"><strong>${escapeHtml(a.label)}</strong><small>${escapeHtml(a.bankId)} · ${escapeHtml((a.rail || 'iban').toUpperCase())} · ${escapeHtml(a.iban)}</small></div></div>`;
    }
    return `<div class="asset-row"><span class="asset-icon">👛</span><div class="asset-info"><strong>${escapeHtml(a.label)}</strong><small>${escapeHtml(a.chainId)} · ${escapeHtml(a.address)}</small></div></div>`;
  }).join('');
}

function refreshLedgerReceiverSelects() {
  const sel = document.getElementById('ledger-conv-receiver-saved');
  if (!sel) return;
  const opts = ['<option value="">Saved receivers…</option>'].concat(
    ledgerReceiverWallets.map(w =>
      `<option value="${w.id}" data-chain="${w.chainId}" data-addr="${w.address}">${escapeHtml(w.label || w.address.slice(0, 8))} · ${w.chainId}</option>`
    )
  );
  sel.innerHTML = opts.join('');
}

function onLedgerConvReceiverPick() {
  const sel = document.getElementById('ledger-conv-receiver-saved');
  const opt = sel?.selectedOptions[0];
  if (!opt?.dataset?.addr) return;
  const addr = document.getElementById('ledger-conv-receiver');
  const chain = document.getElementById('ledger-conv-receiver-chain');
  if (addr) addr.value = opt.dataset.addr;
  if (chain && opt.dataset.chain) chain.value = opt.dataset.chain;
  ledgerConvQuoteDebounced();
}

async function fillLedgerConvMyAddress() {
  let addr = getEvmHolder();
  if (!addr) {
    const caps = await api('/bridge/ledger/settlement/capabilities');
    addr = caps.evmSenderAddress || portfolio?.address || '';
  }
  const input = document.getElementById('ledger-conv-receiver');
  if (input && addr) {
    input.value = addr;
    ledgerConvQuoteDebounced();
  }
}

async function saveLedgerConvReceiver() {
  const addr = document.getElementById('ledger-conv-receiver')?.value?.trim();
  const chainId = document.getElementById('ledger-conv-receiver-chain')?.value || ledgerDefaultBridgeChain;
  if (!addr) return;
  const j = await api('/bridge/ledger/receivers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr, chainId, label: addr.slice(0, 6) + '…' + addr.slice(-4) }),
  });
  if (!j.error) {
    await loadLedgerAssets();
    const msg = document.getElementById('ledger-conv-result');
    if (msg) msg.textContent = 'Receiver saved';
  }
}

function fillLedgerConvChainSelects() {
  const chains = (typeof chainsList !== 'undefined' && chainsList?.length)
    ? chainsList
    : (window.ONEX_FALLBACK?.chains || []);
  const evmChains = chains.filter(c => c.type === 'evm' || c.id === 'dbis-138');
  const opts = evmChains.map(c => `<option value="${c.id}">${c.name || c.id}</option>`).join('');
  for (const id of ['ledger-conv-receiver-chain', 'ledger-conv-token-chain']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.innerHTML = opts;
    if (ledgerDefaultBridgeChain) el.value = ledgerDefaultBridgeChain;
  }
}

const CHAIN_NATIVE_ASSET = {
  'onex-mainnet-1': 'ONEX', ethereum: 'ETH', bsc: 'BNB', polygon: 'MATIC',
  'dbis-138': 'ETH', dbis: 'ETH', idbis: 'ETH',
  arbitrum: 'ETH', optimism: 'ETH', avalanche: 'AVAX', base: 'ETH',
  solana: 'SOL', bitcoin: 'BTC', tron: 'TRX', alltra: 'ALL',
};

const BANK_RAIL_LABELS = {
  ach: 'ACH (US)', sepa: 'SEPA (EU)', swift: 'SWIFT', wire: 'Wire',
  iban: 'IBAN', fps: 'FPS (UK)',
};

function refreshLedgerConvertUI(accounts) {
  ledgerAccounts = accounts || [];
  const acctSel = document.getElementById('ledger-conv-from-acct');
  const toSel = document.getElementById('ledger-conv-to');
  if (!acctSel || !toSel) return;

  if (!ledgerAccounts.length) {
    acctSel.innerHTML = '<option value="">No accounts — refresh ledger</option>';
  } else {
    acctSel.innerHTML = ledgerAccounts.map(a => {
      const fc = a.fundClass ? ` · ${fundClassLabel(a.fundClass)}` : '';
      return `<option value="${a.id}" data-asset="${a.asset}" data-bal="${a.balance}" data-fund="${a.fundClass || ''}">${a.asset} · ${a.balance}${fc} (${a.source})</option>`;
    }).join('');
  }

  const toOpts = LEDGER_CONVERT_ASSETS.map(a => `<option value="${a}">${a}</option>`).join('');
  toSel.innerHTML = toOpts;
  if (!toSel.value) toSel.value = 'USD';
  fillLedgerConvChainSelects();
  syncLedgerConvTokenFields();
  onLedgerConvAccountChange();
}

function initLedgerConvertSelects() {
  refreshLedgerConvertUI(ledgerAccounts);
}

function onLedgerConvAccountChange() {
  const acctSel = document.getElementById('ledger-conv-from-acct');
  const toSel = document.getElementById('ledger-conv-to');
  if (!acctSel || !toSel) return;
  const asset = acctSel.selectedOptions[0]?.dataset?.asset || '';
  if (asset && toSel.value === asset) {
    const alt = LEDGER_CONVERT_ASSETS.find(a => a !== asset);
    if (alt) toSel.value = alt;
  }
  syncLedgerConvTokenFields();
  ledgerConvQuoteDebounced();
}

function setLedgerConvMax() {
  const acctSel = document.getElementById('ledger-conv-from-acct');
  const amt = document.getElementById('ledger-conv-amt');
  if (!acctSel || !amt) return;
  const bal = acctSel.selectedOptions[0]?.dataset?.bal;
  if (bal) {
    amt.value = bal;
    ledgerConvQuoteDebounced();
  }
}

function ledgerConvQuoteDebounced() {
  clearTimeout(ledgerConvTimer);
  ledgerConvTimer = setTimeout(ledgerConvQuote, 320);
}

async function ledgerConvQuote() {
  const body = buildLedgerConvertBody(false);
  const preview = document.getElementById('ledger-conv-preview');
  if (!body.amount || !body.fromAsset || !body.toAsset || body.fromAsset === body.toAsset) {
    if (preview) preview.textContent = body.fromAsset === body.toAsset ? 'Pick a different target asset' : 'Enter amount for live quote';
    return;
  }
  const evm = getEvmHolder();
  const q = evm ? `?evm=${encodeURIComponent(evm)}` : '';
  const j = await api('/bridge/ledger/convert' + q, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (preview) {
    if (j.error) {
      preview.textContent = j.error;
      return;
    }
    let extra = '';
    if (j.receiver?.address) extra += ` → ${j.receiver.address.slice(0, 6)}…${j.receiver.address.slice(-4)}`;
    if (j.createContract || body.createContract) extra += ' · deploy token';
    preview.textContent = `≈ ${j.toAmount} ${j.toAsset} · ${fmtUsd(j.fiatUsd)} · rate ${Number(j.rate || 0).toFixed(6)}${extra}`;
  }
}

async function doLedgerConvert() {
  const body = buildLedgerConvertBody(true);
  const out = document.getElementById('ledger-conv-result');
  const btn = document.getElementById('ledger-conv-btn');
  if (!body.amount || !body.fromAsset || !body.toAsset || !body.fromAccount) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Converting…'; }
  const evm = getEvmHolder();
  const q = evm ? `?evm=${encodeURIComponent(evm)}` : '';
  const j = await api('/bridge/ledger/convert' + q, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (btn) { btn.disabled = false; btn.textContent = 'Convert from ledger'; }
  if (out) {
    if (j.error) {
      out.textContent = j.error;
    } else {
      let msg = `✓ ${j.fromAmount} ${j.fromAsset} → ${j.toAmount} ${j.toAsset}`;
      if (j.tokenDeploy?.contractAddress) msg += ` · contract ${j.tokenDeploy.contractAddress.slice(0, 8)}…`;
      if (j.receiver?.address) msg += ` · sent to ${j.receiver.address.slice(0, 6)}…${j.receiver.address.slice(-4)}`;
      if (j.settlementRef) msg += ` · ${j.settlementRef}`;
      out.textContent = msg;
    }
  }
  if (!j.error) {
    document.getElementById('ledger-conv-amt').value = '';
    const preview = document.getElementById('ledger-conv-preview');
    if (preview) preview.textContent = 'Enter amount for live quote';
    if (body.saveReceiver) await loadLedgerAssets();
    refreshLedger();
  }
}

function setLedgerSource(src) {
  ledgerSource = src;
  document.querySelectorAll('.ledger-filter').forEach(b => {
    b.classList.toggle('active', b.dataset.src === src);
  });
  refreshLedger();
}

function ledgerModeLabel(snap) {
  if (!snap) return '—';
  if (snap.mode === 'production' || snap.mode === 'prod') return 'production';
  return snap.mode || 'production';
}

function modeBadgeClass(mode) {
  if (mode === 'real' || mode === 'bank' || mode === 'fiat') return 'real';
  return 'sim';
}

async function loadLedgerStatus() {
  const el = document.getElementById('ledger-bank-status');
  const badge = document.getElementById('ledger-mode-badge');
  const j = await api('/bridge/ledger/status');
  if (j.error) {
    if (el) el.textContent = j.error;
    return;
  }
  if (badge) {
    badge.textContent = j.production ? 'production' : (j.mode || 'production');
    badge.classList.add('green');
  }
  const bank = j.bank || {};
  const parts = [];
  if (bank.configured) parts.push(`Provider: ${bank.provider || 'custom'}`);
  if (bank.plaid) parts.push('Plaid ready');
  if (bank.truelayer) parts.push('TrueLayer ready');
  if (bank.file) parts.push('Bank file');
  if (bank.customAPI) parts.push('Custom API');
  if (el) {
    el.textContent = parts.length ? parts.join(' · ') : 'No bank source configured on bridge server.';
  }
}

async function refreshBridge7() {
  const [st, ledgers] = await Promise.all([
    api('/bridge/bridge7/status'),
    api('/bridge/bridge7/ledgers'),
  ]);
  const badge = document.getElementById('bridge7-badge');
  const intro = document.getElementById('bridge7-intro');
  const list = document.getElementById('bridge7-sources');
  if (badge) badge.textContent = st.enabled ? (st.entries ? st.entries + ' entries' : 'Ready') : 'Off';
  if (intro) intro.textContent = `Bridge7 · local-ledger-2026 · ledger-pro · crypto-ledger · ${st.entries || 0} valued entries`;
  if (list) {
    const rows = ledgers.ledgers || st.sources || [];
    list.innerHTML = rows.map(r => `
      <div class="asset-row">
        <div class="asset-main">
          <div class="asset-name">${escapeHtml(r.provider || r.id)}</div>
          <div class="asset-sub">${escapeHtml(r.path || '')}</div>
        </div>
        <div class="asset-val">${r.loaded ? escapeHtml(String(r.entries)) + ' rows' : escapeHtml(r.error || '—')}</div>
      </div>`).join('');
  }
}

async function syncBridge7() {
  const msg = document.getElementById('bridge7-msg');
  const evmQ = getEvmHolder() ? `?evm=${encodeURIComponent(getEvmHolder())}` : '';
  const j = await api('/bridge/bridge7/sync' + evmQ, { method: 'POST' });
  if (msg) {
    if (j.error) msg.textContent = j.error;
    else msg.textContent = `✓ Synced ${j.entries || 0} entries · $${Number(j.importUsd || 0).toFixed(0)} import value`;
  }
  if (!j.error) {
    await refreshBridge7();
    await refreshLedger();
  }
}

async function refreshLedger() {
  await loadLedgerStatus();
  await refreshBridge7();
  await loadGreenHealth();
  const evm = getEvmHolder();
  const q = new URLSearchParams();
  if (ledgerSource && ledgerSource !== 'all') q.set('source', ledgerSource);
  if (evm) q.set('evm', evm);
  const path = '/bridge/ledger/read' + (q.toString() ? '?' + q.toString() : '');
  const snap = await api(path);
  const grid = document.getElementById('ledger-entries');
  if (snap.error) {
    if (grid) grid.innerHTML = `<div class="empty-state"><p>${snap.error}</p></div>`;
    return;
  }
  ledgerSnapshot = snap;
  renderLedger(snap);
  await loadLedgerAccounts();
}

async function loadLedgerAccounts() {
  const evm = getEvmHolder();
  const q = evm ? `?evm=${encodeURIComponent(evm)}` : '';
  const [j, dest, hist, caps, settlements, ledgerStatus] = await Promise.all([
    api('/bridge/ledger/accounts' + q),
    api('/bridge/ledger/destinations'),
    api('/bridge/ledger/transfers' + q),
    api('/bridge/ledger/settlement/capabilities'),
    api('/bridge/ledger/settlements' + q),
    api('/bridge/ledger/status'),
  ]);
  const accounts = j.accounts || [];
  ledgerDestinations = { chains: dest.chains || [], banks: dest.banks || [] };
  refreshLedgerConvertUI(accounts);

  const from = document.getElementById('ledger-xfer-from');
  const to = document.getElementById('ledger-xfer-to');
  if (from && !j.error) {
    const opts = accounts.map(a =>
      `<option value="${a.id}" data-asset="${a.asset}" data-bal="${a.balance}">${a.asset} · ${a.balance} (${a.source})</option>`
    ).join('');
    from.innerHTML = '<option value="">From account…</option>' + opts;
  }
  if (to && !j.error) {
    const opts = accounts.map(a =>
      `<option value="${a.id}">${a.asset} ${a.balance} (${a.source})</option>`
    ).join('');
    to.innerHTML = '<option value="">To account…</option>' + opts;
  }

  const chainSel = document.getElementById('ledger-xfer-chain');
  if (chainSel && ledgerDestinations.chains.length) {
    chainSel.innerHTML = ledgerDestinations.chains.map(c =>
      `<option value="${c.id}" data-symbol="${c.symbol}">${c.name} (${c.symbol})</option>`
    ).join('');
    const def = ledgerDefaultBridgeChain || 'dbis-138';
    const pick = [...chainSel.options].find(o => o.value === def) ||
      [...chainSel.options].find(o => o.value === 'dbis-138');
    if (pick) chainSel.value = pick.value;
    onLedgerXferChainChange();
  }
  const bankSel = document.getElementById('ledger-xfer-bank');
  if (bankSel && ledgerDestinations.banks.length) {
    bankSel.innerHTML = ledgerDestinations.banks.map(b =>
      `<option value="${b.id}" data-rails="${(b.rails || []).join(',')}">${b.name} (${b.country})</option>`
    ).join('');
    onLedgerXferBankChange();
  }
  renderLedgerXferHistory(hist.transfers || []);
  refreshSettlementUI(accounts, dest, caps, settlements.settlements || []);
  applyLedgerBridgeDefaults(ledgerStatus);
  loadLedgerAssets();
}

function applyLedgerBridgeDefaults(st) {
  if (st?.defaultBridgeChain) ledgerDefaultBridgeChain = st.defaultBridgeChain;
  const mode = ledgerDefaultBridgeChain === 'dbis-138' ? 'dbis' : 'bsc';
  setLedgerXferMode(mode);
}

function setLedgerXferMode(mode) {
  if (mode === 'dbis') {
    ledgerXferMode = 'chain';
    const chainSel = document.getElementById('ledger-xfer-chain');
    const conv = document.getElementById('ledger-xfer-convert');
    if (chainSel) chainSel.value = 'dbis-138';
    if (conv && !conv.value) conv.value = 'ETH';
    fillLedgerXferMyAddress();
  } else if (mode === 'bsc') {
    ledgerXferMode = 'chain';
    const chainSel = document.getElementById('ledger-xfer-chain');
    const conv = document.getElementById('ledger-xfer-convert');
    if (chainSel) chainSel.value = 'bsc';
    if (conv && !conv.value) conv.value = 'BNB';
    fillLedgerXferMyAddress();
  } else {
    ledgerXferMode = mode;
  }
  document.querySelectorAll('#ledger-bridge-tabs .ledger-xfer-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  const isChain = mode === 'chain' || mode === 'bsc' || mode === 'dbis';
  document.getElementById('ledger-xfer-panel-chain')?.classList.toggle('hidden', !isChain);
  document.getElementById('ledger-xfer-panel-bank')?.classList.toggle('hidden', mode !== 'bank');
  document.getElementById('ledger-xfer-panel-internal')?.classList.toggle('hidden', mode !== 'internal');
  const btn = document.getElementById('ledger-xfer-btn');
  if (btn) {
    btn.textContent = mode === 'dbis' ? 'Bridge to DBIS 138' :
      mode === 'bsc' ? 'Bridge to BSC' :
      mode === 'internal' ? 'Transfer internally' :
      mode === 'bank' ? 'Send to external bank' : 'Send to external chain';
  }
  if (mode === 'chain') onLedgerXferChainChange();
  ledgerXferPreviewDebounced();
}

function fillLedgerXferMyAddress() {
  const addr = getEvmHolder();
  const input = document.getElementById('ledger-xfer-address');
  if (input && addr) {
    input.value = addr;
    ledgerXferPreviewDebounced();
  }
}

function onLedgerXferChainChange() {
  const chain = document.getElementById('ledger-xfer-chain')?.value;
  const conv = document.getElementById('ledger-xfer-convert');
  if (chain && conv && !conv.value) {
    const native = CHAIN_NATIVE_ASSET[chain];
    if (native) {
      const opt = [...conv.options].find(o => o.value === native);
      if (opt) conv.value = native;
    }
  }
  ledgerXferPreviewDebounced();
}

function onLedgerXferBankChange() {
  const bankSel = document.getElementById('ledger-xfer-bank');
  const railSel = document.getElementById('ledger-xfer-rail');
  if (!bankSel || !railSel) return;
  const rails = (bankSel.selectedOptions[0]?.dataset?.rails || '').split(',').filter(Boolean);
  const allRails = ['ach', 'sepa', 'swift', 'wire', 'iban', 'fps'];
  const use = rails.length ? rails : allRails;
  railSel.innerHTML = use.map(r =>
    `<option value="${r}">${BANK_RAIL_LABELS[r] || r.toUpperCase()}</option>`
  ).join('');
  ledgerXferPreviewDebounced();
}

function setLedgerXferMax() {
  const from = document.getElementById('ledger-xfer-from');
  const amt = document.getElementById('ledger-xfer-amount');
  if (!from || !amt) return;
  const bal = from.selectedOptions[0]?.dataset?.bal;
  if (bal) {
    amt.value = bal;
    ledgerXferPreviewDebounced();
  }
}

function buildLedgerXferBody(preview) {
  const from = document.getElementById('ledger-xfer-from')?.value;
  const amount = document.getElementById('ledger-xfer-amount')?.value;
  const convertTo = document.getElementById('ledger-xfer-convert')?.value;
  if (!from || !amount) return null;

  const body = { fromAccount: from, amount, preview: !!preview };
  if (convertTo) body.convertTo = convertTo;

  if (ledgerXferMode === 'internal') {
    const to = document.getElementById('ledger-xfer-to')?.value;
    if (!to) return null;
    body.toAccount = to;
    return body;
  }

  if (ledgerXferMode === 'chain') {
    const chain = document.getElementById('ledger-xfer-chain')?.value;
    const address = document.getElementById('ledger-xfer-address')?.value?.trim();
    if (!chain || !address) return null;
    body.externalTo = `${chain}:${address}`;
    return body;
  }

  const bank = document.getElementById('ledger-xfer-bank')?.value;
  const rail = document.getElementById('ledger-xfer-rail')?.value;
  const acct = document.getElementById('ledger-xfer-bank-acct')?.value?.trim();
  if (!bank || !rail || !acct) return null;
  body.externalTo = `bank:${bank}:${rail}:${acct}`;
  return body;
}

function ledgerXferPreviewDebounced() {
  clearTimeout(ledgerXferTimer);
  ledgerXferTimer = setTimeout(ledgerXferPreview, 350);
}

async function ledgerXferPreview() {
  const preview = document.getElementById('ledger-xfer-preview');
  const body = buildLedgerXferBody(true);
  if (!body) {
    if (preview) preview.textContent = 'Select account, amount, and destination';
    return;
  }
  const evm = getEvmHolder();
  const q = evm ? `?evm=${encodeURIComponent(evm)}` : '';
  const j = await api('/bridge/ledger/transfer' + q, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!preview) return;
  if (j.error) {
    preview.textContent = j.error;
    return;
  }
  const ext = j.external;
  const dest = ext ? (ext.label || ext.chainId || ext.bankRail || j.transfer?.toAccount) : j.transfer?.toAccount;
  const conv = j.convert;
  const convTxt = conv ? ` → ${conv.toAmount} ${conv.toAsset}` : '';
  preview.textContent = `Preview: ${j.transfer?.amount} ${j.transfer?.asset}${convTxt} to ${dest}`;
}

async function doLedgerTransfer() {
  const msg = document.getElementById('ledger-xfer-msg');
  const btn = document.getElementById('ledger-xfer-btn');
  const body = buildLedgerXferBody(false);
  if (!body) {
    if (msg) msg.textContent = 'Complete all required fields';
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  const evm = getEvmHolder();
  const q = evm ? `?evm=${encodeURIComponent(evm)}` : '';
  const j = await api('/bridge/ledger/transfer' + q, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (btn) { btn.disabled = false; setLedgerXferMode(ledgerXferMode); }
  if (msg) {
    if (j.error) {
      msg.textContent = j.error;
    } else {
      const ext = j.external;
      const dest = ext ? (ext.label || ext.chainId || ext.bankRail) : j.transfer?.toAccount;
      const conv = j.convert;
      const convTxt = conv ? ` → ${conv.toAmount} ${conv.toAsset}` : '';
      msg.textContent = `✓ ${j.status}: ${j.transfer?.amount} ${j.transfer?.asset}${convTxt} → ${dest}${j.settlement ? ' · ' + j.settlement : ''}`;
    }
  }
  if (!j.error) {
    document.getElementById('ledger-xfer-amount').value = '';
    const preview = document.getElementById('ledger-xfer-preview');
    if (preview) preview.textContent = 'Select account, amount, and destination';
    refreshLedger();
  }
}

function refreshSettlementUI(accounts, dest, caps, settlements) {
  const from = document.getElementById('ledger-settle-from');
  const to = document.getElementById('ledger-settle-to');
  const opts = (accounts || []).map(a =>
    `<option value="${a.id}" data-bal="${a.balance}">${a.asset} · ${a.balance} (${a.source})</option>`
  ).join('');
  if (from) from.innerHTML = '<option value="">From account…</option>' + opts;
  if (to) to.innerHTML = '<option value="">To account…</option>' + opts;

  const chainSel = document.getElementById('ledger-settle-chain');
  const chains = dest?.chains || ledgerDestinations.chains || [];
  if (chainSel && chains.length) {
    chainSel.innerHTML = chains.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    chainSel.value = ledgerDefaultBridgeChain || 'dbis-138';
  }
  const bankSel = document.getElementById('ledger-settle-bank');
  const banks = dest?.banks || ledgerDestinations.banks || [];
  if (bankSel && banks.length) {
    bankSel.innerHTML = banks.map(b =>
      `<option value="${b.id}" data-rails="${(b.rails || []).join(',')}">${b.name}</option>`
    ).join('');
    onSettlementBankChange();
  }

  const capsEl = document.getElementById('ledger-settlement-caps');
  if (capsEl && caps) {
    const on = (k) => caps[k] ? '✓' : '·';
    const evmAddr = caps.evmSenderAddress ? ` · ${caps.evmSenderAddress.slice(0, 6)}…${caps.evmSenderAddress.slice(-4)}` : '';
    capsEl.innerHTML = [
      `<span class="green-check green">${on('realCrypto')} crypto</span>`,
      `<span class="green-check green">${on('realFiat')} fiat</span>`,
      `<span class="green-check ${caps.evmSettlement ? 'green' : 'amber'}">${on('evmSettlement')} EVM sender${evmAddr}</span>`,
      `<span class="green-check ${caps.onexSettlement ? 'green' : 'amber'}">${on('onexSettlement')} OneX wallet</span>`,
    ].join(' ');
  }
  renderSettlementHistory(settlements || []);
  setSettlementKind(settlementKind);
}

function setSettlementKind(kind) {
  settlementKind = kind;
  document.querySelectorAll('#ledger-settle-tabs [data-skind]').forEach(b => {
    b.classList.toggle('active', b.dataset.skind === kind);
  });
  document.getElementById('ledger-settle-panel-crypto')?.classList.toggle('hidden', kind !== 'real_crypto');
  document.getElementById('ledger-settle-panel-fiat')?.classList.toggle('hidden', kind !== 'real_fiat');
  document.getElementById('ledger-settle-panel-internal')?.classList.toggle('hidden', kind !== 'internal');
  const btn = document.getElementById('ledger-settle-btn');
  const labels = {
    real_crypto: 'Settle to real crypto',
    real_fiat: 'Settle to real fiat',
    vault: 'Convert to vault',
    internal: 'Internal settlement',
  };
  if (btn) btn.textContent = labels[kind] || 'Settle';
  if (kind === 'real_crypto') {
    const payout = document.getElementById('ledger-settle-payout');
    if (payout && !payout.value) payout.value = 'BNB';
    fillSettlementMyAddress();
  }
  settlementPreviewDebounced();
}

function onSettlementBankChange() {
  const bankSel = document.getElementById('ledger-settle-bank');
  const railSel = document.getElementById('ledger-settle-rail');
  if (!bankSel || !railSel) return;
  const rails = (bankSel.selectedOptions[0]?.dataset?.rails || '').split(',').filter(Boolean);
  const allRails = ['ach', 'sepa', 'swift', 'wire', 'iban', 'fps'];
  const use = rails.length ? rails : allRails;
  railSel.innerHTML = use.map(r =>
    `<option value="${r}">${BANK_RAIL_LABELS[r] || r.toUpperCase()}</option>`
  ).join('');
  settlementPreviewDebounced();
}

function setSettlementMax() {
  const from = document.getElementById('ledger-settle-from');
  const amt = document.getElementById('ledger-settle-amount');
  const bal = from?.selectedOptions[0]?.dataset?.bal;
  if (amt && bal) { amt.value = bal; settlementPreviewDebounced(); }
}

function fillSettlementMyAddress() {
  const addr = getEvmHolder();
  const input = document.getElementById('ledger-settle-address');
  if (input && addr) { input.value = addr; settlementPreviewDebounced(); }
}

function buildSettlementBody(preview) {
  const from = document.getElementById('ledger-settle-from')?.value;
  const amount = document.getElementById('ledger-settle-amount')?.value;
  const payout = document.getElementById('ledger-settle-payout')?.value;
  if (!from || !amount) return null;
  const body = { fromAccount: from, amount, payoutAsset: payout || '', kind: settlementKind, preview: !!preview };
  if (settlementKind === 'real_crypto') {
    const chain = document.getElementById('ledger-settle-chain')?.value;
    const address = document.getElementById('ledger-settle-address')?.value?.trim();
    if (!chain || !address) return null;
    body.externalTo = `${chain}:${address}`;
  } else if (settlementKind === 'real_fiat') {
    const bank = document.getElementById('ledger-settle-bank')?.value;
    const rail = document.getElementById('ledger-settle-rail')?.value;
    const acct = document.getElementById('ledger-settle-bank-acct')?.value?.trim();
    if (!bank || !rail || !acct) return null;
    body.externalTo = `bank:${bank}:${rail}:${acct}`;
  } else if (settlementKind === 'internal') {
    const to = document.getElementById('ledger-settle-to')?.value;
    if (!to) return null;
    body.toAccount = to;
  }
  return body;
}

function renderSettlementSteps(steps) {
  const el = document.getElementById('ledger-settlement-steps');
  if (!el) return;
  if (!steps?.length) { el.innerHTML = ''; return; }
  el.innerHTML = steps.map(s =>
    `<span class="ledger-settle-step ${s.status}">${s.phase}${s.detail ? ': ' + s.detail : ''}</span>`
  ).join('');
}

function settlementPreviewDebounced() {
  clearTimeout(settlementTimer);
  settlementTimer = setTimeout(settlementPreview, 350);
}

async function settlementPreview() {
  const preview = document.getElementById('ledger-settle-preview');
  const body = buildSettlementBody(true);
  if (!body) {
    if (preview) preview.textContent = 'Configure settlement';
    renderSettlementSteps([]);
    return;
  }
  const evm = getEvmHolder();
  const q = evm ? `?evm=${encodeURIComponent(evm)}` : '';
  const j = await api('/bridge/ledger/settle' + q, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!preview) return;
  if (j.error) {
    preview.textContent = j.error;
    renderSettlementSteps([]);
    return;
  }
  const s = j.settlement || {};
  renderSettlementSteps(s.steps);
  const conv = j.convert;
  const convTxt = conv ? ` → ${conv.toAmount} ${conv.toAsset}` : '';
  preview.textContent = `Preview: ${s.sourceAmount} ${s.sourceAsset}${convTxt} · ${s.kind}${s.destinationLabel ? ' → ' + s.destinationLabel : ''}`;
}

async function doSettlement() {
  const msg = document.getElementById('ledger-settle-msg');
  const btn = document.getElementById('ledger-settle-btn');
  const body = buildSettlementBody(false);
  if (!body) {
    if (msg) msg.textContent = 'Complete all required fields';
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Settling…'; }
  const evm = getEvmHolder();
  const q = evm ? `?evm=${encodeURIComponent(evm)}` : '';
  const j = await api('/bridge/ledger/settle' + q, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (btn) { btn.disabled = false; setSettlementKind(settlementKind); }
  if (msg) {
    if (j.error) {
      msg.textContent = j.error;
    } else {
      const s = j.settlement || {};
      msg.textContent = `✓ ${j.status}: ${s.payoutAmount} ${s.payoutAsset}${s.settlementRef ? ' · ' + s.settlementRef : ''}`;
    }
  }
  if (!j.error) {
    document.getElementById('ledger-settle-amount').value = '';
    refreshLedger();
  }
}

function renderSettlementHistory(list) {
  const el = document.getElementById('ledger-settlement-history');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div class="empty-state"><p>No settlements yet</p></div>';
    return;
  }
  el.innerHTML = list.slice(0, 10).map(s => {
    const st = (s.status || '').replace(/_/g, ' ');
    const cls = (s.status || '').replace(/\s/g, '_');
    return `<div class="asset-row ledger-row">
      <div class="asset-info">
        <div class="asset-symbol">${s.payoutAmount} ${s.payoutAsset} <span class="ledger-xfer-status ${cls}">${st}</span></div>
        <div class="asset-name">${s.kind} · ${s.destinationLabel || s.fromAccount}</div>
      </div>
      <div class="asset-right"><div class="asset-fiat">${s.sourceAmount} ${s.sourceAsset}</div></div>
    </div>`;
  }).join('');
}

function renderLedgerXferHistory(transfers) {
  const el = document.getElementById('ledger-xfer-history');
  if (!el) return;
  if (!transfers.length) {
    el.innerHTML = '<div class="empty-state"><p>No transfers yet</p></div>';
    return;
  }
  el.innerHTML = transfers.slice(0, 12).map(t => {
    const st = (t.status || 'completed').replace(/_/g, ' ');
    const cls = (t.status || 'completed').replace(/\s/g, '_');
    const to = t.toAccount?.replace(/^external:(chain|bank|onex):/, '') || t.toAccount;
    return `<div class="asset-row ledger-row">
      <div class="asset-info">
        <div class="asset-symbol">${t.amount} ${t.asset} <span class="ledger-xfer-status ${cls}">${st}</span></div>
        <div class="asset-name">→ ${to}${t.convertTo ? ' · conv ' + t.convertTo : ''}</div>
      </div>
      <div class="asset-right">
        <div class="asset-fiat">${t.toAmount && t.toAmount !== t.amount ? t.toAmount : ''}</div>
      </div>
    </div>`;
  }).join('');
}

function ledgerAllocationData(snap) {
  const d = { ...(snap.byFundUsd || {}) };
  const src = snap.bySourceUsd || {};
  for (const k of ['onex', 'evm', 'import', 'portfolio']) {
    if (src[k]) d[k] = src[k];
  }
  if (!Object.keys(d).length) return { ...src };
  return d;
}

function renderLedger(snap) {
  const totalEl = document.getElementById('ledger-total-usd');
  const srcEl = document.getElementById('ledger-source-totals');
  const grid = document.getElementById('ledger-entries');
  if (!grid) return;

  const total = snap.totalUsd || 0;
  if (totalEl) totalEl.textContent = fmtUsd(total);
  recordLedgerSnapshot(total);
  renderLedgerHistoryChart();
  renderLedgerAllocationChart(ledgerAllocationData(snap));

  if (srcEl) {
    const chips = [];
    const funds = snap.byFundUsd || {};
    Object.entries(funds).filter(([, v]) => v > 0).forEach(([k, v]) => {
      chips.push(`<span class="ledger-src-chip ledger-fc-${k}">${fundClassLabel(k)} ${fmtUsd(v)}</span>`);
    });
    const src = snap.bySourceUsd || {};
    Object.entries(src).filter(([, v]) => v > 0).forEach(([k, v]) => {
      if (k === 'bank' && Object.keys(funds).length) return;
      if (['m0', 'm1', 'nsb'].includes(k)) return;
      chips.push(`<span class="ledger-src-chip">${k} ${fmtUsd(v)}</span>`);
    });
    srcEl.innerHTML = chips.join('');
  }

  const entries = snap.entries || [];
  if (!entries.length) {
    grid.innerHTML = `<div class="empty-state"><p>No ledger entries for this filter.</p>
      <p class="msg">Connect bank (Plaid/TrueLayer), set EVM address in Settings, or import a ledger below.</p></div>`;
    return;
  }

  const sorted = [...entries].sort((a, b) => (b.fiatUsd || 0) - (a.fiatUsd || 0));
  grid.innerHTML = sorted.map(e => {
    const sym = e.asset || '?';
    const chain = chains.find(c => c.id === e.chainId);
    const color = chain?.color || (e.mode === 'bank' || e.mode === 'fiat' ? '#4a9eff' : '#00e5b0');
    const sub = [e.source, e.chainId, e.account].filter(Boolean).join(' · ');
    const fc = e.fundClass ? `<span class="ledger-fc-badge ledger-fc-${e.fundClass}">${fundClassLabel(e.fundClass)}</span>` : '';
    return `<div class="asset-row ledger-row">
      <div class="asset-icon" style="background:${color}22;color:${color}">${sym.slice(0, 2)}</div>
      <div class="asset-info">
        <div class="asset-symbol">${sym} ${fc} <span class="ledger-mode ${modeBadgeClass(e.mode)}">${e.mode}</span></div>
        <div class="asset-name">${sub || e.reference || ''}</div>
      </div>
      <div class="asset-right">
        <div class="asset-amount">${e.human || '—'}</div>
        <div class="asset-fiat">${fmtUsd(e.fiatUsd)}</div>
      </div>
    </div>`;
  }).join('');
}

async function doLedgerImport() {
  const raw = document.getElementById('ledger-import-json')?.value?.trim();
  const msg = document.getElementById('ledger-import-msg');
  const btn = document.getElementById('ledger-import-btn');
  if (!raw) return;
  let body;
  try { body = JSON.parse(raw); } catch (e) {
    if (msg) msg.textContent = 'Invalid JSON';
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }
  const evm = getEvmHolder();
  const q = evm ? `?evm=${encodeURIComponent(evm)}` : '';
  const j = await api('/bridge/ledger/import' + q, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, active: true }),
  });
  if (btn) { btn.disabled = false; btn.textContent = 'Import & value (active)'; }
  if (msg) {
    if (j.error) {
      msg.textContent = j.error;
    } else {
      const total = j.totalUsd ?? j.importUsd ?? 0;
      const synced = j.accountsSynced ?? j.entries ?? 0;
      msg.textContent = `✓ ${j.status}: ${j.entries} entries · ${fmtUsd(total)} total · ${synced} book accounts synced`;
    }
  }
  if (!j.error) {
    document.getElementById('ledger-import-json').value = '';
    const preview = document.getElementById('ledger-import-preview');
    if (preview) preview.textContent = 'Paste JSON for live value preview';
    ledgerSource = 'import';
    setLedgerSource('import');
    refreshLedger();
  }
}

function ledgerImportPreviewDebounced() {
  clearTimeout(ledgerImportTimer);
  ledgerImportTimer = setTimeout(ledgerImportPreview, 400);
}

async function ledgerImportPreview() {
  const raw = document.getElementById('ledger-import-json')?.value?.trim();
  const preview = document.getElementById('ledger-import-preview');
  if (!raw) {
    if (preview) preview.textContent = 'Paste JSON for live value preview';
    return;
  }
  let body;
  try { body = JSON.parse(raw); } catch (e) {
    if (preview) preview.textContent = 'Invalid JSON';
    return;
  }
  const evm = getEvmHolder();
  const q = (evm ? `?evm=${encodeURIComponent(evm)}&` : '?') + 'preview=1';
  const j = await api('/bridge/ledger/import' + q, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, preview: true }),
  });
  if (!preview) return;
  if (j.error) {
    preview.textContent = j.error;
    return;
  }
  const assets = Object.entries(j.byAssetUsd || {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k} ${fmtUsd(v)}`)
    .join(' · ');
  preview.textContent = `Preview: ${j.entries} entries · ${fmtUsd(j.importUsd || j.totalUsd || 0)}${assets ? ' — ' + assets : ''}`;
}

function getLedgerHistory() {
  try {
    return JSON.parse(localStorage.getItem(LEDGER_HIST_KEY) || '[]');
  } catch {
    return [];
  }
}

function recordLedgerSnapshot(totalUsd) {
  const v = Number(totalUsd) || 0;
  const now = Date.now();
  let hist = getLedgerHistory();
  const last = hist[hist.length - 1];
  if (last && now - last.t < 60000 && Math.abs(last.v - v) < 1e-6) return;
  hist.push({ t: now, v });
  const cutoff = now - 30 * 24 * 3600 * 1000;
  hist = hist.filter(h => h.t >= cutoff).slice(-800);
  localStorage.setItem(LEDGER_HIST_KEY, JSON.stringify(hist));
}

function setLedgerChartPeriod(period) {
  ledgerChartPeriod = period;
  document.querySelectorAll('.ledger-chart-periods button').forEach(b => {
    b.classList.toggle('active', b.dataset.period === period);
  });
  const labels = { '24h': '24h change', '7d': '7d change', '30d': '30d change' };
  const el = document.getElementById('ledger-chart-period-label');
  if (el) el.textContent = labels[period] || 'Change';
  renderLedgerHistoryChart();
}

function renderLedgerHistoryChart() {
  const svg = document.getElementById('ledger-history-chart');
  const emptyEl = document.getElementById('ledger-chart-empty');
  const changeEl = document.getElementById('ledger-chart-change');
  if (!svg) return;

  let hist = filterHistoryByPeriod(getLedgerHistory(), ledgerChartPeriod);
  if (hist.length < 2 && ledgerSnapshot?.totalUsd > 0) {
    const v = ledgerSnapshot.totalUsd;
    const now = Date.now();
    hist = [];
    for (let i = 12; i >= 0; i--) {
      const jitter = 1 + (Math.sin(i * 0.85) * 0.025);
      hist.push({ t: now - i * 3600 * 1000, v: Math.max(0, v * jitter) });
    }
  }
  if (hist.length < 2) {
    svg.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (changeEl) { changeEl.textContent = '—'; changeEl.className = ''; }
    return;
  }
  if (emptyEl) emptyEl.classList.add('hidden');

  const w = 360, h = 100, pad = 4;
  const vals = hist.map(p => p.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const pts = hist.map((p, i) => {
    const x = pad + (i / (hist.length - 1)) * (w - pad * 2);
    const y = h - pad - ((p.v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(' ');
  const area = `${pad},${h} ${line} ${w - pad},${h}`;
  const up = vals[vals.length - 1] >= vals[0];
  const pct = vals[0] ? ((vals[vals.length - 1] - vals[0]) / vals[0]) * 100 : 0;
  const gradId = 'ledgerChartGradient';
  const root = getComputedStyle(document.documentElement);
  const brand = root.getPropertyValue('--accent').trim() || '#00e5b0';
  const down = root.getPropertyValue('--chart-down').trim() || '#ff4d4f';
  const stroke = up ? brand : down;

  svg.innerHTML = `
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${stroke}" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="${stroke}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path class="area" fill="url(#${gradId})" d="M ${area} Z"/>
    <polyline class="line" points="${line}" style="stroke:${stroke};fill:none;stroke-width:2"/>
  `;

  if (changeEl) {
    const sign = pct >= 0 ? '+' : '';
    changeEl.textContent = `${sign}${pct.toFixed(2)}%`;
    changeEl.className = pct >= 0 ? 'positive' : 'negative';
  }
}

function renderLedgerAllocationChart(bySourceUsd) {
  const svg = document.getElementById('ledger-allocation-chart');
  const legend = document.getElementById('ledger-allocation-legend');
  if (!svg) return;

  const items = Object.entries(bySourceUsd || {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = items.reduce((s, [, v]) => s + v, 0);

  if (!total || !items.length) {
    svg.innerHTML = '<circle cx="60" cy="60" r="40" fill="none" stroke="var(--border)" stroke-width="14"/>';
    if (legend) legend.innerHTML = '<span class="msg">No allocation data</span>';
    return;
  }

  const cx = 60, cy = 60, r = 40, stroke = 14;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const arcs = items.map(([src, val]) => {
    const frac = val / total;
    const len = frac * circ;
    const color = LEDGER_SOURCE_COLORS[src] || '#8b8fa3';
    const dash = `${len} ${circ - len}`;
    const rot = (offset / circ) * 360 - 90;
    offset += len;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-dasharray="${dash}" transform="rotate(${rot} ${cx} ${cy})"/>`;
  });
  svg.innerHTML = arcs.join('') + `<circle cx="${cx}" cy="${cy}" r="28" fill="var(--bg-card)"/>`;

  if (legend) {
    legend.innerHTML = items.map(([src, val]) => {
      const pct = ((val / total) * 100).toFixed(1);
      const color = LEDGER_SOURCE_COLORS[src] || '#8b8fa3';
      return `<div class="ledger-alloc-row">
        <span><span class="ledger-alloc-dot" style="background:${color}"></span>${src}</span>
        <span class="ledger-alloc-pct">${pct}%</span>
      </div>`;
    }).join('');
  }
}

let onlineBankMode = 'internal';
let onlineBankMainTab = 'overview';
let onlineBankTimer = null;
let onlineBankDepositTimer = null;
let onlineBankAccounts = [];

function setOnlineBankMainTab(tab) {
  onlineBankMainTab = tab;
  document.querySelectorAll('#online-bank-main-tabs .ledger-xfer-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.bmain === tab);
  });
  const panes = ['overview', 'send', 'deposit', 'activity', 'receive', 'payees', 'hybx', 'fineract', 'swift', 'cards', 'cashcode', 'ledger'];
  panes.forEach(p => {
    document.getElementById('online-bank-pane-' + p)?.classList.toggle('hidden', tab !== p);
  });
  if (tab === 'ledger') loadOnlineBankLedger();
  if (tab === 'cards') refreshVirtualCards();
  if (tab === 'swift') loadSwiftSystem();
  if (tab === 'cashcode') refreshCashCodes();
  if (tab === 'activity') loadOnlineBankActivity();
  if (tab === 'receive') loadOnlineBankWire();
  if (tab === 'payees') renderOnlineBankPayees();
  if (tab === 'hybx') refreshHybrix();
  if (tab === 'fineract') refreshFineract();
}

function onlineBankQuick(tab) {
  setOnlineBankMainTab(tab);
}

function formatBankTxRows(txs, targetId) {
  const el = document.getElementById(targetId);
  if (!el) return;
  if (!txs?.length) {
    el.innerHTML = '<p class="msg">No transactions yet.</p>';
    return;
  }
  el.innerHTML = txs.map(t => {
    const dir = t.type === 'deposit' ? '+' : '−';
    const label = t.type === 'deposit'
      ? `${t.fromName || t.rail || 'deposit'} → ${t.toName || t.toAccount}`
      : `${t.fromName || t.fromAccount} → ${t.toName || t.toIban || t.toAccount || '—'}`;
    return `
    <div class="bank-tx-row">
      <strong>${dir} ${escapeHtml(t.amount)} ${escapeHtml(t.currency)} · ${escapeHtml(t.type)}</strong>
      <small>${escapeHtml(label)}</small>
      <small>${new Date((t.createdAt || 0) * 1000).toLocaleString()} · ${escapeHtml(t.reference || '')}
        <span class="bank-tx-status ${t.status === 'pending' ? 'pending' : ''}">${escapeHtml(t.status)}</span></small>
    </div>`;
  }).join('');
}

async function loadOnlineBankActivity() {
  const acct = document.getElementById('online-bank-activity-account')?.value || '';
  const type = document.getElementById('online-bank-activity-type')?.value || '';
  let url = '/bridge/bank/transactions?limit=100';
  if (acct) url += '&account=' + encodeURIComponent(acct);
  if (type) url += '&type=' + encodeURIComponent(type);
  const j = await api(url);
  formatBankTxRows(j.transactions || [], 'online-bank-activity-list');
}

function exportOnlineBankStatement() {
  const acct = document.getElementById('online-bank-activity-account')?.value || '';
  let url = API + '/bridge/bank/statement';
  if (acct) url += '?account=' + encodeURIComponent(acct);
  window.open(url, '_blank');
}

async function loadOnlineBankWire() {
  const sel = document.getElementById('online-bank-receive-account');
  const box = document.getElementById('online-bank-wire-details');
  if (!sel?.value || !box) return;
  const w = await api('/bridge/bank/wire?account=' + encodeURIComponent(sel.value));
  if (w.error) { box.innerHTML = `<p class="msg">${escapeHtml(w.error)}</p>`; return; }
  box.innerHTML = `
    <div class="bank-wire-row"><span>Beneficiary</span><strong>${escapeHtml(w.accountName)}</strong></div>
    <div class="bank-wire-row"><span>IBAN</span><code id="wire-iban">${escapeHtml(w.iban || '—')}</code></div>
    <div class="bank-wire-row"><span>SWIFT / BIC</span><code>${escapeHtml(w.swift)}</code></div>
    <div class="bank-wire-row"><span>Bank</span><strong>${escapeHtml(w.bankName)}</strong></div>
    <div class="bank-wire-row"><span>Currency</span><strong>${escapeHtml(w.currency)}</strong></div>
    <div class="bank-wire-row"><span>Reference</span><code>${escapeHtml(w.reference || '—')}</code></div>
    <div class="bank-wire-actions">
      ${w.iban ? '<button type="button" class="copy-btn" id="wire-copy-iban">Copy IBAN</button>' : ''}
      <button type="button" class="copy-btn" id="wire-copy-swift">Copy SWIFT</button>
      <button type="button" class="copy-btn" id="wire-copy-ref">Copy reference</button>
    </div>
    <p class="msg">Use this reference so deposits match your account.</p>`;
  document.getElementById('wire-copy-iban')?.addEventListener('click', () => copyText(w.iban));
  document.getElementById('wire-copy-swift')?.addEventListener('click', () => copyText(w.swift));
  document.getElementById('wire-copy-ref')?.addEventListener('click', () => copyText(w.reference));
}

function copyText(text) {
  if (!text) return;
  navigator.clipboard?.writeText(text);
}

function renderOnlineBankPayees() {
  const el = document.getElementById('online-bank-payees-list');
  if (!el) return;
  const banks = ledgerBankAssets();
  if (!banks.length) {
    el.innerHTML = '<p class="msg">No saved payees — add bank IBANs in Real Ledger → Saved destinations.</p>';
    return;
  }
  el.innerHTML = banks.map((a, i) => `
    <div class="bank-payee-card">
      <div class="bank-acct-name">${escapeHtml(a.label)}</div>
      <div class="bank-acct-iban">${escapeHtml(a.iban)}</div>
      <div class="bank-acct-meta">${escapeHtml(a.bankId)} · ${escapeHtml(a.rail)} · ${escapeHtml(a.currency || '')}</div>
      <button type="button" class="btn-secondary" data-payee-idx="${i}">Pay</button>
    </div>`).join('');
  el.querySelectorAll('[data-payee-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = banks[Number(btn.dataset.payeeIdx)];
      if (a) payOnlineBankPayee(a);
    });
  });
}

function payOnlineBankPayee(a) {
  setOnlineBankMainTab('send');
  setOnlineBankMode('iban');
  const ibanEl = document.getElementById('online-bank-iban');
  const bank = document.getElementById('online-bank-dest-bank');
  const railEl = document.getElementById('online-bank-rail');
  if (ibanEl) ibanEl.value = a.iban || '';
  if (bank && a.bankId) bank.value = a.bankId;
  if (railEl && a.rail) railEl.value = a.rail;
  onlineBankPreviewDebounced();
}

function fillOnlineBankActivityFilters(accts) {
  const sel = document.getElementById('online-bank-activity-account');
  const recv = document.getElementById('online-bank-receive-account');
  const opts = (accts || []).map(a =>
    `<option value="${a.id}">${escapeHtml(a.currency)} · ${escapeHtml(a.name)}</option>`
  ).join('');
  if (sel) sel.innerHTML = '<option value="">All accounts</option>' + opts;
  if (recv) recv.innerHTML = opts;
}

function setOnlineBankMode(mode) {
  onlineBankMode = mode;
  document.querySelectorAll('#online-bank-tabs .ledger-xfer-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.bmode === mode);
  });
  document.getElementById('online-bank-panel-internal')?.classList.toggle('hidden', mode !== 'internal');
  document.getElementById('online-bank-panel-iban')?.classList.toggle('hidden', mode !== 'iban');
  const btn = document.getElementById('online-bank-btn');
  if (btn) btn.textContent = mode === 'iban' ? 'Send IBAN payment' : 'Send internal transfer';
  onlineBankPreviewDebounced();
}

function fmtBankUsdTotals(totals) {
  if (!totals || typeof totals !== 'object') return '—';
  return Object.entries(totals).map(([c, v]) => `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${c}`).join(' · ');
}

function fundClassBadge(fc) {
  if (!fc) return '';
  return `<span class="deploy-badge green">${escapeHtml(fc.toUpperCase())}</span>`;
}

function renderOnlineBankAccounts(accts) {
  const el = document.getElementById('online-bank-accounts');
  if (!el) return;
  if (!accts?.length) {
    el.innerHTML = '<p class="msg">No accounts — set ONEX_BANK_LEDGER_FILE and refresh.</p>';
    return;
  }
  el.innerHTML = accts.map(a => `
    <div class="bank-account-card ${a.fundClass === 'nsb' || a.bank === 'nsb' ? 'nsb' : ''}">
      <div class="bank-acct-name">${escapeHtml(a.name)} ${fundClassBadge(a.fundClass)}</div>
      ${a.iban ? `<div class="bank-acct-iban">${escapeHtml(a.iban)}</div>` : ''}
      <div class="bank-acct-bal">${escapeHtml(a.balance)} ${escapeHtml(a.currency)}</div>
      <div class="bank-acct-meta">${escapeHtml(a.id)} · ${escapeHtml(a.status || 'active')}</div>
    </div>`).join('');
}

function fillOnlineBankSelects(accts) {
  const opts = (accts || []).map(a =>
    `<option value="${a.id}" data-bal="${escapeHtml(a.balance)}" data-cur="${escapeHtml(a.currency)}">${escapeHtml(a.currency)} · ${escapeHtml(a.balance)} — ${escapeHtml(a.name)}</option>`
  ).join('');
  const from = document.getElementById('online-bank-from');
  const to = document.getElementById('online-bank-to');
  const depTo = document.getElementById('online-bank-deposit-to');
  if (from) from.innerHTML = '<option value="">From account…</option>' + opts;
  if (to) to.innerHTML = '<option value="">To account…</option>' + opts;
  if (depTo) depTo.innerHTML = '<option value="">To account…</option>' + opts;

  const ccFrom = document.getElementById('cashcode-issue-from');
  const ccTo = document.getElementById('cashcode-redeem-to');
  if (ccFrom) ccFrom.innerHTML = '<option value="">From account…</option>' + opts;
  if (ccTo) ccTo.innerHTML = '<option value="">Credit to…</option>' + opts;

  const bankSel = document.getElementById('online-bank-dest-bank');
  if (bankSel && ledgerDestinations.banks?.length) {
    bankSel.innerHTML = ledgerDestinations.banks.map(b =>
      `<option value="${b.id}">${escapeHtml(b.name)}</option>`
    ).join('');
  }

  const ibanSel = document.getElementById('online-bank-iban-saved');
  if (ibanSel) {
    const banks = ledgerBankAssets();
    ibanSel.innerHTML = ['<option value="">Saved accounts…</option>'].concat(
      banks.map(a => `<option value="${escapeHtml(a.iban)}" data-bank="${escapeHtml(a.bankId)}" data-rail="${escapeHtml(a.rail)}">${escapeHtml(a.label)}</option>`)
    ).join('');
  }
}

function onOnlineBankIbanPick() {
  const sel = document.getElementById('online-bank-iban-saved');
  const opt = sel?.selectedOptions[0];
  if (!opt?.value) return;
  const iban = document.getElementById('online-bank-iban');
  const bank = document.getElementById('online-bank-dest-bank');
  const rail = document.getElementById('online-bank-rail');
  if (iban) iban.value = opt.value;
  if (bank && opt.dataset.bank) bank.value = opt.dataset.bank;
  if (rail && opt.dataset.rail) rail.value = opt.dataset.rail;
  onlineBankPreviewDebounced();
}

function setOnlineBankMax() {
  const from = document.getElementById('online-bank-from');
  const amt = document.getElementById('online-bank-amount');
  const bal = from?.selectedOptions[0]?.dataset?.bal;
  if (amt && bal) { amt.value = bal; onlineBankPreviewDebounced(); }
}

function buildOnlineBankBody(preview) {
  const fromAccount = document.getElementById('online-bank-from')?.value;
  const amount = document.getElementById('online-bank-amount')?.value;
  const reference = document.getElementById('online-bank-ref')?.value?.trim();
  if (!fromAccount || !amount) return null;
  const body = { fromAccount, amount, preview: !!preview };
  if (reference) body.reference = reference;
  if (onlineBankMode === 'internal') {
    const toAccount = document.getElementById('online-bank-to')?.value;
    if (!toAccount) return null;
    body.toAccount = toAccount;
  } else {
    const toIban = document.getElementById('online-bank-iban')?.value?.trim();
    if (!toIban) return null;
    body.toIban = toIban;
    body.toBank = document.getElementById('online-bank-dest-bank')?.value || 'generic';
    body.rail = document.getElementById('online-bank-rail')?.value || 'iban';
  }
  return body;
}

function onlineBankPreviewDebounced() {
  clearTimeout(onlineBankTimer);
  onlineBankTimer = setTimeout(onlineBankPreview, 350);
}

async function onlineBankPreview() {
  const preview = document.getElementById('online-bank-preview');
  const body = buildOnlineBankBody(true);
  if (!body) {
    if (preview) preview.textContent = 'Select accounts and amount';
    return;
  }
  const evmQ = getEvmHolder() ? `?evm=${encodeURIComponent(getEvmHolder())}` : '';
  const j = await api('/bridge/bank/send' + evmQ, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!preview) return;
  if (j.error) { preview.textContent = j.error; return; }
  const tx = j.transaction || {};
  const dest = tx.toName || tx.toIban || tx.toAccount || '—';
  preview.textContent = `Preview: ${tx.amount} ${tx.currency} → ${dest} (${tx.status || 'quoted'})`;
}

async function doOnlineBankSend() {
  return doOnlineBankTransfer();
}

async function doOnlineBankTransfer() {
  const msg = document.getElementById('online-bank-msg');
  const btn = document.getElementById('online-bank-btn');
  const body = buildOnlineBankBody(false);
  if (!body) {
    if (msg) msg.textContent = 'Complete all required fields';
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  const evmQ = getEvmHolder() ? `?evm=${encodeURIComponent(getEvmHolder())}` : '';
  const j = await api('/bridge/bank/send' + evmQ, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (btn) { btn.disabled = false; setOnlineBankMode(onlineBankMode); }
  if (msg) {
    if (j.error) msg.textContent = j.error;
    else {
      const tx = j.transaction || {};
      msg.textContent = `✓ ${j.status}: ${tx.amount} ${tx.currency}${tx.toIban ? ' → ' + tx.toIban : ''}${j.fromBalance ? ' · balance ' + j.fromBalance : ''}`;
    }
  }
  if (!j.error) {
    document.getElementById('online-bank-amount').value = '';
    await refreshOnlineBank();
  }
}

function buildOnlineBankDepositBody(preview) {
  const toAccount = document.getElementById('online-bank-deposit-to')?.value;
  const amount = document.getElementById('online-bank-deposit-amount')?.value;
  const source = document.getElementById('online-bank-deposit-source')?.value;
  const reference = document.getElementById('online-bank-deposit-ref')?.value?.trim();
  if (!toAccount || !amount) return null;
  const body = { toAccount, amount, source: source || 'wire', preview: !!preview };
  if (reference) body.reference = reference;
  return body;
}

function onlineBankDepositPreviewDebounced() {
  clearTimeout(onlineBankDepositTimer);
  onlineBankDepositTimer = setTimeout(onlineBankDepositPreview, 350);
}

async function onlineBankDepositPreview() {
  const preview = document.getElementById('online-bank-deposit-preview');
  const body = buildOnlineBankDepositBody(true);
  if (!body) {
    if (preview) preview.textContent = 'Select account and amount';
    return;
  }
  const evmQ = getEvmHolder() ? `?evm=${encodeURIComponent(getEvmHolder())}` : '';
  const j = await api('/bridge/bank/deposit' + evmQ, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!preview) return;
  if (j.error) { preview.textContent = j.error; return; }
  const tx = j.transaction || {};
  preview.textContent = `Preview: deposit ${tx.amount} ${tx.currency} → ${tx.toName || body.toAccount} (${tx.rail || body.source})`;
}

async function doOnlineBankDeposit() {
  const msg = document.getElementById('online-bank-deposit-msg');
  const body = buildOnlineBankDepositBody(false);
  if (!body) {
    if (msg) msg.textContent = 'Select account and amount';
    return;
  }
  const evmQ = getEvmHolder() ? `?evm=${encodeURIComponent(getEvmHolder())}` : '';
  const j = await api('/bridge/bank/deposit' + evmQ, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (msg) {
    if (j.error) msg.textContent = j.error;
    else {
      const tx = j.transaction || {};
      msg.textContent = `✓ Deposited ${tx.amount} ${tx.currency} · balance ${j.toBalance || '—'}`;
    }
  }
  if (!j.error) {
    document.getElementById('online-bank-deposit-amount').value = '';
    await refreshOnlineBank();
    if (onlineBankMainTab === 'ledger') loadOnlineBankLedger();
  }
}

function renderOnlineBankLedgerEntries(entries, summary) {
  const el = document.getElementById('online-bank-ledger-entries');
  const sumEl = document.getElementById('online-bank-ledger-summary');
  if (sumEl && summary) {
    const fc = summary.byFundUsd || {};
    const fcTxt = Object.entries(fc).map(([k, v]) => `${k.toUpperCase()} $${Number(v).toLocaleString()}`).join(' · ');
    sumEl.textContent = `Total $${Number(summary.totalUsd || 0).toLocaleString()}${fcTxt ? ' · ' + fcTxt : ''}`;
  }
  if (!el) return;
  if (!entries?.length) {
    el.innerHTML = '<p class="msg">No ledger entries.</p>';
    return;
  }
  el.innerHTML = entries.map(e => `
    <div class="asset-row">
      <span class="asset-icon">🏦</span>
      <div class="asset-info">
        <strong>${escapeHtml(e.human)} ${escapeHtml(e.asset)}</strong>
        <small>${escapeHtml(e.account || e.id)} · ${escapeHtml(e.fundClass || 'bank')} · $${Number(e.fiatUsd || 0).toLocaleString()}</small>
      </div>
    </div>`).join('');
}

async function loadOnlineBankLedger() {
  const j = await api('/bridge/bank/ledger');
  if (j.error) return;
  renderOnlineBankLedgerEntries(j.entries, j);
  renderOnlineBankTransactions(j.transactions || []);
}

function renderOnlineBankTransactions(txs) {
  formatBankTxRows(txs, 'online-bank-tx-list');
}

function renderOnlineBankRecent(txs) {
  formatBankTxRows((txs || []).slice(0, 8), 'online-bank-recent-tx');
}

async function refreshOnlineBank() {
  const evmQ = getEvmHolder() ? `?evm=${encodeURIComponent(getEvmHolder())}` : '';
  const [st, accts, txs, prod] = await Promise.all([
    api('/bridge/bank/status'),
    api('/bridge/bank/accounts'),
    api('/bridge/bank/transactions'),
    api('/bridge/production/status' + evmQ),
  ]);
  const badge = document.getElementById('online-bank-badge');
  if (badge) {
    if (prod && !prod.error && prod.production) {
      badge.textContent = prod.domain || 'Production';
    } else {
      badge.textContent = st.online ? 'Online' : 'Offline';
    }
  }
  const totalEl = document.getElementById('online-bank-total');
  if (totalEl) totalEl.textContent = fmtBankUsdTotals(st.totals);
  const meta = document.getElementById('online-bank-meta');
  if (meta) {
    let line = `${st.name || 'NSB'} · SWIFT ${st.swift || '—'} · ${st.accounts || 0} accounts · ${st.transactions || 0} tx`;
    if (prod && !prod.error) {
      const extras = [];
      if (prod.ledgerTotalUsd != null) extras.push('ledger ' + fmtUsd(prod.ledgerTotalUsd));
      if (prod.nodeReady != null) extras.push('node ' + (prod.nodeReady ? 'online' : 'offline'));
      if (prod.hybx?.enabled || prod.hybrix?.enabled) extras.push('HYBX');
      if (prod.fineract?.online) extras.push('Fineract');
      if (extras.length) line += ' · ' + extras.join(' · ');
    }
    meta.textContent = line;
  }
  await loadProductionPlatform(prod);
  onlineBankAccounts = accts.accounts || [];
  renderOnlineBankAccounts(onlineBankAccounts);
  fillOnlineBankSelects(onlineBankAccounts);
  fillOnlineBankActivityFilters(onlineBankAccounts);
  fillHybrixSelect(onlineBankAccounts);
  renderOnlineBankRecent(txs.transactions || []);
  if (onlineBankMainTab === 'ledger') {
    await loadOnlineBankLedger();
  } else if (onlineBankMainTab === 'cards') {
    await refreshVirtualCards();
  } else if (onlineBankMainTab === 'activity') {
    await loadOnlineBankActivity();
  } else if (onlineBankMainTab === 'receive') {
    loadOnlineBankWire();
  } else if (onlineBankMainTab === 'payees') {
    renderOnlineBankPayees();
  } else if (onlineBankMainTab === 'hybx') {
    await refreshHybrix();
  } else if (onlineBankMainTab === 'fineract') {
    await refreshFineract();
  } else if (onlineBankMainTab !== 'overview') {
    renderOnlineBankTransactions(txs.transactions || []);
  }
  if (!ledgerDestinations.banks?.length) {
    const dest = await api('/bridge/ledger/destinations');
    ledgerDestinations = dest || ledgerDestinations;
    fillOnlineBankSelects(onlineBankAccounts);
  }
  await loadLedgerAssets();
}

let virtualCards = [];
let virtualCardTimer = null;

function cardBrandClass(brand, issuer) {
  if ((issuer || '').toLowerCase() === 'hybx') return 'hybx';
  const b = (brand || '').toLowerCase();
  if (b === 'mastercard') return 'mastercard';
  return 'visa';
}

let virtualCardIssuerFilter = 'all';

function setVirtualCardFilter(issuer) {
  virtualCardIssuerFilter = issuer || 'all';
  document.querySelectorAll('[data-cissuer]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cissuer === virtualCardIssuerFilter);
  });
  renderVirtualCards(filterVirtualCards(virtualCards), lastVirtualCardStatus);
}

function filterVirtualCards(cards) {
  if (virtualCardIssuerFilter === 'all') return cards || [];
  return (cards || []).filter(c => (c.issuer || 'nsb').toLowerCase() === virtualCardIssuerFilter);
}

let lastVirtualCardStatus = null;

function formatCardPAN(c) {
  if (c.production && (c.panFull || c.panMasked)) {
    return c.panFull || c.panMasked;
  }
  return c.panMasked || ('•••• •••• •••• ' + (c.last4 || '0000'));
}

function renderCardProviders(providers) {
  if (!providers?.length) return '';
  return providers.map(p =>
    `<span class="deploy-badge ${p.status === 'active' ? 'green' : ''}">${escapeHtml(p.name)}</span>`
  ).join('');
}

function renderVirtualCards(cards, status, gridId) {
  lastVirtualCardStatus = status || lastVirtualCardStatus;
  const grid = document.getElementById(gridId || 'virtual-cards-grid');
  const mainGrid = !gridId || gridId === 'virtual-cards-grid';
  const badge = mainGrid ? document.getElementById('virtual-cards-badge') : null;
  const intro = mainGrid ? document.getElementById('virtual-cards-intro') : null;
  const prod = status?.production || (cards?.length && cards[0]?.production);
  const activeCount = (cards || []).filter(c => c.active).length;
  const nsb = status?.nsbCards ?? (cards || []).filter(c => (c.issuer || 'nsb') !== 'hybx').length;
  const hybx = status?.hybxCards ?? (cards || []).filter(c => (c.issuer || '') === 'hybx').length;
  if (badge) badge.textContent = prod ? `${activeCount} active · Production` : (status?.mode || '—');
  if (intro) {
    intro.textContent = prod
      ? `Cards 101.1 online · Apple Pay · Google Pay · 2D · wire · ${activeCount}/${cards?.length || 0} active (${nsb} NSB · ${hybx} HYBX)`
      : `NSB + HYBX virtual debit cards · ${activeCount} active (${nsb} NSB · ${hybx} HYBX)`;
  }
  const railsEl = document.getElementById('virtual-cards-rails');
  if (railsEl && status?.rails) {
    const r = status.rails;
    railsEl.textContent = `Rails: ${r.applePay ? 'Apple Pay ✓' : 'Apple Pay —'} · ${r.googlePay ? 'Google Pay ✓' : 'Google Pay —'} · ${r.twoD ? '2D ✓' : '2D —'} · ${r.wireTransfer ? 'Wire ✓' : 'Wire —'}`;
  }
  if (!grid) return;
  if (!cards?.length) {
    grid.innerHTML = '<p class="msg">No cards yet — production mode auto-issues NSB cards per account. HYBX tab → Sync → Issue HYBX virtual cards.</p>';
    return;
  }
  grid.innerHTML = cards.map(c => `
    <div class="virtual-card ${cardBrandClass(c.brand, c.issuer)} ${c.active ? 'active' : 'inactive'}">
      <div class="virtual-card-top">
        <span class="virtual-card-brand">${escapeHtml(c.issuer === 'hybx' ? 'HYBX' : (c.network || c.brand || 'CARD').toUpperCase())}</span>
        <span class="virtual-card-status ${c.active ? 'live' : ''}">${escapeHtml(c.active ? 'ACTIVE' : (c.status || '—'))}${c.production ? ' · PROD' : ''}</span>
      </div>
      <div class="virtual-card-pan">${escapeHtml(formatCardPAN(c))}</div>
      <div class="virtual-card-meta">
        <span>EXP ${escapeHtml(c.expiry || '—')}</span>
        <span>CVV ${escapeHtml(c.production ? (c.cvv || c.cvvHint || '—') : '***')}</span>
        <span>PIN ${escapeHtml(c.production ? (c.pin || '—') : '****')}</span>
      </div>
      <div class="virtual-card-meta">
        <span>${escapeHtml(c.label || c.accountName || 'Virtual card')}</span>
        <span>${escapeHtml(c.program ? 'Prog ' + c.program : '')}${c.bin ? ' · BIN ' + escapeHtml(c.bin) : ''}</span>
      </div>
      <div class="virtual-card-bal">
        <span>${escapeHtml(c.available || '0.00')} ${escapeHtml(c.currency || '')}</span>
        <span class="virtual-card-spent">limit ${escapeHtml(c.limit || '—')} · spent ${escapeHtml(c.spent || '0.00')}</span>
      </div>
      <div class="virtual-card-details">
        <div><span class="vc-label">Account</span> ${escapeHtml(c.accountId || '—')}</div>
        ${c.hybxAccountId ? `<div><span class="vc-label">HYBX</span> ${escapeHtml(c.hybxAccountId)}</div>` : ''}
        ${c.iban ? `<div><span class="vc-label">IBAN</span> ${escapeHtml(c.iban)}</div>` : ''}
        <div><span class="vc-label">Card ID</span> ${escapeHtml(c.id || '—')}</div>
      </div>
      <div class="virtual-card-wallets">
        ${c.applePay ? '<span class="deploy-badge green">Apple Pay</span>' : ''}
        ${c.googlePay ? '<span class="deploy-badge green">Google Pay</span>' : ''}
        ${c.twoD ? '<span class="deploy-badge green">2D</span>' : ''}
        ${c.threeDSecure ? '<span class="deploy-badge green">3DS</span>' : ''}
        ${c.wireTransfer ? '<span class="deploy-badge green">Wire</span>' : ''}
        ${c.program === '101.1' || c.bin === '1011' ? '<span class="deploy-badge green">101.1</span>' : ''}
        ${renderCardProviders(c.providers)}
      </div>
    </div>`).join('');
}

function fillVirtualCardSelect(cards) {
  const sel = document.getElementById('virtual-card-pick');
  if (!sel) return;
  sel.innerHTML = ['<option value="">Select card…</option>'].concat(
    (cards || []).map(c =>
      `<option value="${escapeHtml(c.id)}" data-avail="${escapeHtml(c.available)}" data-cur="${escapeHtml(c.currency)}">${escapeHtml(c.network || c.brand)} ${escapeHtml(c.production ? (c.panFull || c.panMasked || '') : '•••• ' + (c.last4 || ''))} — ${escapeHtml(c.available)} ${escapeHtml(c.currency)}</option>`
    )
  ).join('');
}

function fillCardReleaseSelect(cards) {
  const sel = document.getElementById('card-release-pick');
  if (!sel) return;
  const eligible = (cards || []).filter(c => c.program === '101.1' || c.bin === '1011');
  sel.innerHTML = ['<option value="">Select Cards 101.1…</option>'].concat(
    eligible.map(c =>
      `<option value="${escapeHtml(c.id)}" data-avail="${escapeHtml(c.available)}" data-cur="${escapeHtml(c.currency)}">${escapeHtml(c.network || c.brand)} ${escapeHtml(c.production ? (c.panFull || c.panMasked || '') : '•••• ' + (c.last4 || ''))} — ${escapeHtml(c.available)} ${escapeHtml(c.currency)}</option>`
    )
  ).join('');
  fillCardWireSelect(eligible);
}

function fillCardWireSelect(cards) {
  const sel = document.getElementById('card-wire-pick');
  if (!sel) return;
  const eligible = (cards || []).filter(c => c.program === '101.1' || c.bin === '1011');
  sel.innerHTML = ['<option value="">Select Cards 101.1…</option>'].concat(
    eligible.map(c =>
      `<option value="${escapeHtml(c.id)}" data-avail="${escapeHtml(c.available)}" data-cur="${escapeHtml(c.currency)}">${escapeHtml(c.network || c.brand)} ${escapeHtml(c.production ? (c.panFull || c.panMasked || '') : '•••• ' + (c.last4 || ''))} — ${escapeHtml(c.available)} ${escapeHtml(c.currency)}</option>`
    )
  ).join('');
}

function renderVirtualCardTransactions(txs) {
  const el = document.getElementById('virtual-card-tx-list');
  if (!el) return;
  if (!txs?.length) {
    el.innerHTML = '<p class="msg">No card transactions yet.</p>';
    return;
  }
  el.innerHTML = txs.map(t => `
    <div class="asset-row">
      <div class="asset-main">
        <div class="asset-name">${escapeHtml(t.merchant || 'Payment')}</div>
        <div class="asset-sub">${escapeHtml(t.reference || t.cardId || '')}</div>
      </div>
      <div class="asset-val">−${escapeHtml(t.amount)} ${escapeHtml(t.currency || '')}</div>
    </div>`).join('');
}

async function issueCards1011() {
  const msg = document.getElementById('virtual-cards-intro');
  const j = await api('/bridge/cards/101.1/issue', { method: 'POST' });
  if (msg) msg.textContent = j.error ? j.error : `✓ Cards 101.1 · ${j.count || 0} online · BIN ${j.bin || '1011'}`;
  await refreshVirtualCards();
}

async function activateCardRails1011() {
  const msg = document.getElementById('virtual-cards-intro');
  const j = await api('/bridge/cards/101.1/activate-rails', { method: 'POST' });
  if (msg) {
    msg.textContent = j.error ? j.error
      : `✓ Rails active · Apple Pay · Google Pay · 2D · 101.1 · wire · ${j.count || 0} cards`;
  }
  await refreshVirtualCards();
}

let cardWireTimer = null;
function cardWirePreviewDebounced() {
  clearTimeout(cardWireTimer);
  cardWireTimer = setTimeout(cardWirePreview, 350);
}

async function loadCardWireInstructions() {
  const box = document.getElementById('card-wire-instructions');
  const cardId = document.getElementById('card-wire-pick')?.value;
  if (!box || !cardId) {
    if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
    return;
  }
  const w = await api('/bridge/cards/wire?cardId=' + encodeURIComponent(cardId));
  if (w.error) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="bank-wire-row"><span>Receive via</span><strong>${escapeHtml(w.accountName || '—')}</strong></div>
    <div class="bank-wire-row"><span>IBAN</span><code>${escapeHtml(w.iban || '—')}</code></div>
    <div class="bank-wire-row"><span>SWIFT</span><code>${escapeHtml(w.swift || '—')}</code></div>
    <div class="bank-wire-row"><span>Reference</span><code>${escapeHtml(w.reference || '—')}</code></div>`;
}

async function cardWirePreview() {
  const preview = document.getElementById('card-wire-preview');
  const cardId = document.getElementById('card-wire-pick')?.value;
  const amount = document.getElementById('card-wire-amount')?.value;
  const iban = document.getElementById('card-wire-iban')?.value?.trim();
  if (!cardId || !amount || !iban) {
    if (preview) preview.textContent = 'Select card, amount, and IBAN';
    return;
  }
  const j = await api('/bridge/cards/101.1/wire', {
    method: 'POST',
    body: JSON.stringify({
      cardId, amount, beneficiaryIban: iban, preview: true,
      beneficiaryName: document.getElementById('card-wire-name')?.value?.trim(),
    }),
  });
  if (preview) preview.textContent = j.error ? j.error : `Preview wire ${amount} · Cards 101.1`;
}

async function doCardWireTransfer() {
  const msg = document.getElementById('card-wire-msg');
  const btn = document.getElementById('card-wire-btn');
  const cardId = document.getElementById('card-wire-pick')?.value;
  const amount = document.getElementById('card-wire-amount')?.value;
  const iban = document.getElementById('card-wire-iban')?.value?.trim();
  if (!cardId || !amount || !iban) {
    if (msg) msg.textContent = 'Card, amount, and IBAN required';
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  await connectGlobalProductionServer();
  const j = await api('/bridge/cards/101.1/wire', {
    method: 'POST',
    body: JSON.stringify({
      cardId, amount, beneficiaryIban: iban, preview: false,
      beneficiaryName: document.getElementById('card-wire-name')?.value?.trim(),
      reference: document.getElementById('card-wire-reference')?.value?.trim(),
    }),
  });
  if (btn) { btn.disabled = false; btn.textContent = 'Send wire transfer'; }
  if (j.error) {
    if (msg) msg.textContent = j.error;
    return;
  }
  if (msg) msg.textContent = `✓ Wire ${j.status}: ${amount} · ${j.wireRef || ''}`;
  await refreshVirtualCards();
  await refreshOnlineBank();
}

async function refreshVirtualCards() {
  const [status, txs] = await Promise.all([
    api('/bridge/cards/status'),
    api('/bridge/cards/transactions'),
  ]);
  let list = { cards: [] };
  if (status?.production) {
    list = await api('/bridge/cards/101.1/issue', { method: 'POST' });
    if (list.error) list = await api('/bridge/cards?activate=1');
    if (list.error) list = await api('/bridge/cards/activate', { method: 'POST' });
    if (list.error) list = await api('/bridge/cards');
  } else {
    list = await api('/bridge/cards');
  }
  if (list.error) {
    const intro = document.getElementById('virtual-cards-intro');
    if (intro) intro.textContent = list.error;
    return;
  }
  virtualCards = list.cards || [];
  const filtered = filterVirtualCards(virtualCards);
  renderVirtualCards(filtered, status);
  fillVirtualCardSelect(filtered);
  fillCardReleaseSelect(filtered);
  renderVirtualCardTransactions(txs.transactions || []);
}

function virtualCardPreviewDebounced() {
  clearTimeout(virtualCardTimer);
  virtualCardTimer = setTimeout(virtualCardPreview, 350);
}

async function virtualCardPreview() {
  const preview = document.getElementById('virtual-card-preview');
  const cardId = document.getElementById('virtual-card-pick')?.value;
  const amount = document.getElementById('virtual-card-amount')?.value;
  const merchant = document.getElementById('virtual-card-merchant')?.value?.trim();
  if (!cardId || !amount) {
    if (preview) preview.textContent = 'Select card and amount';
    return;
  }
  const evmQ = getEvmHolder() ? `?evm=${encodeURIComponent(getEvmHolder())}` : '';
  const j = await api('/bridge/cards/authorize' + evmQ, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId, amount, merchant, preview: true }),
  });
  if (!preview) return;
  if (j.error) { preview.textContent = j.error; return; }
  preview.textContent = `Preview: ${j.amount} ${j.currency} at ${j.merchant} · available ${j.available}`;
}

let swiftReleaseTimer = null;
let cardReleaseTimer = null;

function showFundReleaseScreen(screen, title, detail, ref) {
  const overlay = document.getElementById('fund-release-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden', 'black', 'white');
  overlay.classList.add(screen === 'white' ? 'white' : 'black');
  const t = document.getElementById('fund-release-title');
  const d = document.getElementById('fund-release-detail');
  const r = document.getElementById('fund-release-ref');
  const icon = document.getElementById('fund-release-icon');
  if (t) t.textContent = title || (screen === 'white' ? 'Funds released' : 'Processing');
  if (d) d.textContent = detail || '';
  if (r) r.textContent = ref ? `Ref: ${ref}` : '';
  if (icon) icon.textContent = screen === 'white' ? '✓' : '◆';
}

function hideFundReleaseScreen(delayMs = 0) {
  const run = () => {
    const overlay = document.getElementById('fund-release-overlay');
    if (overlay) overlay.classList.add('hidden');
  };
  if (delayMs > 0) setTimeout(run, delayMs);
  else run();
}

async function connectGlobalProductionServer() {
  const evmQ = getEvmHolder() ? `?evm=${encodeURIComponent(getEvmHolder())}` : '';
  return api('/bridge/production/connect' + evmQ, { method: 'POST' });
}

async function loadSwiftSystem() {
  const badge = document.getElementById('swift-status-badge');
  const meta = document.getElementById('swift-meta');
  const intro = document.getElementById('swift-intro');
  const sel = document.getElementById('swift-from-account');
  const j = await api('/bridge/bank/swift/status');
  if (badge) badge.textContent = j.production ? 'production' : 'live';
  if (meta) {
    meta.textContent = `BIC ${j.bic || '—'} · Global ${j.globalServer || '—'}`;
  }
  if (intro && j.globalServer) {
    intro.textContent = `Release NSB funds via SWIFT — global server ${j.globalServer}`;
  }
  if (sel && onlineBankAccounts?.length) {
    sel.innerHTML = onlineBankAccounts.map(a =>
      `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} · ${escapeHtml(a.balance)} ${escapeHtml(a.currency)}</option>`
    ).join('');
  }
}

function swiftReleasePreviewDebounced() {
  clearTimeout(swiftReleaseTimer);
  swiftReleaseTimer = setTimeout(swiftReleasePreview, 350);
}

async function swiftReleasePreview() {
  const preview = document.getElementById('swift-release-preview');
  const fromAccount = document.getElementById('swift-from-account')?.value;
  const amount = document.getElementById('swift-amount')?.value;
  const iban = document.getElementById('swift-beneficiary-iban')?.value?.trim();
  if (!fromAccount || !amount || !iban) {
    if (preview) preview.textContent = 'Enter account, amount, and IBAN';
    return;
  }
  const body = {
    fromAccount, amount, beneficiaryIban: iban, preview: true,
    beneficiaryBic: document.getElementById('swift-beneficiary-bic')?.value?.trim(),
    beneficiaryName: document.getElementById('swift-beneficiary-name')?.value?.trim(),
  };
  const j = await api('/bridge/bank/swift/release', { method: 'POST', body: JSON.stringify(body) });
  if (preview) preview.textContent = j.error ? j.error : `Preview SWIFT ${amount} → ${iban}`;
}

async function doSwiftRelease() {
  const msg = document.getElementById('swift-release-msg');
  const btn = document.getElementById('swift-release-btn');
  const fromAccount = document.getElementById('swift-from-account')?.value;
  const amount = document.getElementById('swift-amount')?.value;
  const iban = document.getElementById('swift-beneficiary-iban')?.value?.trim();
  if (!fromAccount || !amount || !iban) {
    if (msg) msg.textContent = 'Account, amount, and IBAN required';
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Releasing…'; }
  showFundReleaseScreen('black', 'Processing', 'Black screen · SWIFT release on global server…');
  await connectGlobalProductionServer();
  const body = {
    fromAccount, amount, beneficiaryIban: iban, preview: false,
    beneficiaryBic: document.getElementById('swift-beneficiary-bic')?.value?.trim(),
    beneficiaryName: document.getElementById('swift-beneficiary-name')?.value?.trim(),
    reference: document.getElementById('swift-reference')?.value?.trim(),
  };
  const j = await api('/bridge/bank/swift/release', { method: 'POST', body: JSON.stringify(body) });
  if (btn) { btn.disabled = false; btn.textContent = 'Release funds via SWIFT'; }
  if (j.error) {
    showFundReleaseScreen('black', 'Failed', j.error);
    hideFundReleaseScreen(2500);
    if (msg) msg.textContent = j.error;
    return;
  }
  const screen = j.screen || (j.status === 'released' ? 'white' : 'black');
  showFundReleaseScreen(screen, screen === 'white' ? 'Funds released' : 'Processing',
    `SWIFT ${j.swiftRef || ''} · ${j.globalServer || ''}`, j.swiftRef);
  hideFundReleaseScreen(screen === 'white' ? 2200 : 3500);
  if (msg) msg.textContent = `✓ ${j.status}: ${amount} via SWIFT · ${j.swiftRef || ''}`;
  await refreshOnlineBank();
}

function cardReleasePreviewDebounced() {
  clearTimeout(cardReleaseTimer);
  cardReleaseTimer = setTimeout(cardReleasePreview, 350);
}

async function cardReleasePreview() {
  const preview = document.getElementById('card-release-preview');
  const cardId = document.getElementById('card-release-pick')?.value;
  const amount = document.getElementById('card-release-amount')?.value;
  const iban = document.getElementById('card-release-iban')?.value?.trim();
  if (!cardId || !amount || !iban) {
    if (preview) preview.textContent = 'Select card, amount, and IBAN';
    return;
  }
  const j = await api('/bridge/cards/101.1/release', {
    method: 'POST',
    body: JSON.stringify({
      cardId, amount, beneficiaryIban: iban, preview: true,
      beneficiaryBic: document.getElementById('card-release-bic')?.value?.trim(),
      beneficiaryName: document.getElementById('card-release-name')?.value?.trim(),
    }),
  });
  if (preview) preview.textContent = j.error ? j.error : `Preview release ${amount} · Cards 101.1`;
}

async function doCardReleaseFunds() {
  const msg = document.getElementById('card-release-msg');
  const btn = document.getElementById('card-release-btn');
  const cardId = document.getElementById('card-release-pick')?.value;
  const amount = document.getElementById('card-release-amount')?.value;
  const iban = document.getElementById('card-release-iban')?.value?.trim();
  if (!cardId || !amount || !iban) {
    if (msg) msg.textContent = 'Card, amount, and IBAN required';
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Releasing…'; }
  showFundReleaseScreen('black', 'Cards 101.1', 'Black screen · releasing funds on global production server…');
  await connectGlobalProductionServer();
  const j = await api('/bridge/cards/101.1/release', {
    method: 'POST',
    body: JSON.stringify({
      cardId, amount, beneficiaryIban: iban, preview: false,
      beneficiaryBic: document.getElementById('card-release-bic')?.value?.trim(),
      beneficiaryName: document.getElementById('card-release-name')?.value?.trim(),
    }),
  });
  if (btn) { btn.disabled = false; btn.textContent = 'Release funds (production)'; }
  if (j.error) {
    showFundReleaseScreen('black', 'Release failed', j.error);
    hideFundReleaseScreen(2500);
    if (msg) msg.textContent = j.error;
    return;
  }
  const screen = j.screen || (j.status === 'released' ? 'white' : 'black');
  showFundReleaseScreen(screen,
    screen === 'white' ? 'Funds released · 101.1' : 'Processing · 101.1',
    `BIN 1011 · ${j.globalServer || ''}`, j.swiftRef);
  hideFundReleaseScreen(screen === 'white' ? 2500 : 4000);
  if (msg) msg.textContent = `✓ ${j.status}: ${amount} released · ${j.swiftRef || ''}`;
  await refreshVirtualCards();
  await refreshOnlineBank();
}

async function doVirtualCardPay() {
  const msg = document.getElementById('virtual-card-msg');
  const btn = document.getElementById('virtual-card-btn');
  const cardId = document.getElementById('virtual-card-pick')?.value;
  const amount = document.getElementById('virtual-card-amount')?.value;
  const merchant = document.getElementById('virtual-card-merchant')?.value?.trim();
  if (!cardId || !amount) {
    if (msg) msg.textContent = 'Select card and amount';
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Authorizing…'; }
  const evmQ = getEvmHolder() ? `?evm=${encodeURIComponent(getEvmHolder())}` : '';
  const j = await api('/bridge/cards/authorize' + evmQ, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId, amount, merchant, preview: false }),
  });
  if (btn) { btn.disabled = false; btn.textContent = 'Authorize payment'; }
  if (msg) {
    if (j.error) msg.textContent = j.error;
    else {
      const tx = j.transaction || {};
      msg.textContent = `✓ ${j.status}: ${tx.amount} ${tx.currency} · ${tx.merchant || merchant || 'Payment'}`;
    }
  }
  if (!j.error) {
    document.getElementById('virtual-card-amount').value = '';
    await refreshOnlineBank();
  }
}

let cashCodeIssueTimer = null;
let cashCodeRedeemTimer = null;

function cashCodeIssuePreviewDebounced() {
  clearTimeout(cashCodeIssueTimer);
  cashCodeIssueTimer = setTimeout(cashCodeIssuePreview, 350);
}

function cashCodeRedeemPreviewDebounced() {
  clearTimeout(cashCodeRedeemTimer);
  cashCodeRedeemTimer = setTimeout(cashCodeRedeemPreview, 350);
}

async function cashCodeIssuePreview() {
  const preview = document.getElementById('cashcode-issue-preview');
  const fromAccount = document.getElementById('cashcode-issue-from')?.value;
  const amount = document.getElementById('cashcode-issue-amount')?.value;
  const pin = document.getElementById('cashcode-issue-pin')?.value?.trim();
  const memo = document.getElementById('cashcode-issue-memo')?.value?.trim();
  if (!fromAccount || !amount) {
    if (preview) preview.textContent = 'Select account and amount';
    return;
  }
  const body = { fromAccount, amount, preview: true };
  if (pin) body.pin = pin;
  if (memo) body.memo = memo;
  const j = await api('/bridge/cashcode/issue', { method: 'POST', body: JSON.stringify(body) });
  if (preview) preview.textContent = j.error ? j.error : `Preview: issue ${amount} · ends ${j.cashCode?.codeLast4 || '****'}`;
}

async function cashCodeRedeemPreview() {
  const preview = document.getElementById('cashcode-redeem-preview');
  const code = document.getElementById('cashcode-redeem-code')?.value?.trim();
  const pin = document.getElementById('cashcode-redeem-pin')?.value?.trim();
  if (!code) {
    if (preview) preview.textContent = 'Enter code to verify';
    return;
  }
  const body = { code };
  if (pin) body.pin = pin;
  const j = await api('/bridge/cashcode/verify', { method: 'POST', body: JSON.stringify(body) });
  if (!preview) return;
  if (j.error) preview.textContent = j.error;
  else if (!j.valid) preview.textContent = `Invalid · ${j.status || 'not found'}`;
  else preview.textContent = `Valid: ${j.amount} ${j.currency} · ****-${j.codeLast4}${j.hasPin ? ' · PIN required' : ''}`;
}

function renderCashCodeList(codes) {
  const el = document.getElementById('cashcode-list');
  if (!el) return;
  if (!codes?.length) {
    el.innerHTML = '<p class="msg">No cash codes issued yet.</p>';
    return;
  }
  el.innerHTML = codes.map(c => `
    <div class="bank-tx-row">
      <strong>****-${escapeHtml(c.codeLast4)} · ${escapeHtml(c.amount)} ${escapeHtml(c.currency)} · ${escapeHtml(c.status)}</strong>
      <small>${escapeHtml(c.memo || c.issuerName || c.issuerAccount)}</small>
      <small>${new Date((c.createdAt || 0) * 1000).toLocaleString()}${c.expiresAt ? ' · expires ' + new Date(c.expiresAt * 1000).toLocaleString() : ''}</small>
      ${c.status === 'active' ? `<button type="button" class="dex-max" onclick="cancelCashCode('${escapeHtml(c.id)}','${escapeHtml(c.issuerAccount)}')">Cancel</button>` : ''}
    </div>`).join('');
}

async function refreshCashCodes() {
  const st = await api('/bridge/cashcode/status');
  const badge = document.getElementById('cashcode-badge');
  const intro = document.getElementById('cashcode-intro');
  if (badge) badge.textContent = st.enabled ? `${st.active || 0} active` : 'off';
  if (intro) intro.textContent = `Cash codes · escrow ${st.escrowHeld || '0.00'} · ${st.redeemed || 0} redeemed`;
  const from = document.getElementById('cashcode-issue-from')?.value;
  const q = from ? `?accountId=${encodeURIComponent(from)}` : '';
  const list = await api('/bridge/cashcode/list' + q);
  renderCashCodeList(list.codes || []);
}

async function doCashCodeIssue() {
  const msg = document.getElementById('cashcode-issue-msg');
  const box = document.getElementById('cashcode-issued-box');
  const fromAccount = document.getElementById('cashcode-issue-from')?.value;
  const amount = document.getElementById('cashcode-issue-amount')?.value;
  const pin = document.getElementById('cashcode-issue-pin')?.value?.trim();
  const memo = document.getElementById('cashcode-issue-memo')?.value?.trim();
  if (!fromAccount || !amount) {
    if (msg) msg.textContent = 'Select account and amount';
    return;
  }
  const body = { fromAccount, amount, preview: false };
  if (pin) body.pin = pin;
  if (memo) body.memo = memo;
  const j = await api('/bridge/cashcode/issue', { method: 'POST', body: JSON.stringify(body) });
  if (msg) msg.textContent = j.error ? j.error : '✓ Cash code issued';
  if (j.code && box) {
    box.classList.remove('hidden');
    document.getElementById('cashcode-issued-value').textContent = j.code;
    document.getElementById('cashcode-issued-detail').textContent =
      `${j.cashCode?.amount || amount} ${j.cashCode?.currency || ''} · share securely · single use`;
  }
  if (!j.error) {
    await refreshOnlineBank();
    await refreshCashCodes();
  }
}

async function doCashCodeRedeem() {
  const msg = document.getElementById('cashcode-redeem-msg');
  const code = document.getElementById('cashcode-redeem-code')?.value?.trim();
  const pin = document.getElementById('cashcode-redeem-pin')?.value?.trim();
  const toAccount = document.getElementById('cashcode-redeem-to')?.value;
  if (!code || !toAccount) {
    if (msg) msg.textContent = 'Enter code and destination account';
    return;
  }
  const body = { code, toAccount, preview: false };
  if (pin) body.pin = pin;
  const j = await api('/bridge/cashcode/redeem', { method: 'POST', body: JSON.stringify(body) });
  if (msg) {
    msg.textContent = j.error ? j.error :
      `✓ Redeemed ${j.cashCode?.amount || ''} ${j.cashCode?.currency || ''} · balance ${j.toBalance || '—'}`;
  }
  if (!j.error) {
    document.getElementById('cashcode-redeem-code').value = '';
    document.getElementById('cashcode-redeem-pin').value = '';
    await refreshOnlineBank();
    await refreshCashCodes();
  }
}

async function cancelCashCode(id, issuerAccount) {
  const j = await api('/bridge/cashcode/cancel', {
    method: 'POST',
    body: JSON.stringify({ id, issuerAccount }),
  });
  const msg = document.getElementById('cashcode-issue-msg');
  if (msg) msg.textContent = j.error ? j.error : '✓ Code cancelled · funds returned';
  await refreshOnlineBank();
  await refreshCashCodes();
}

let hybxExchangeTimer = null;
let hybxExchangeRoutes = [];

async function loadHybxExchangeRoutes() {
  const j = await api('/bridge/bank/hybx/exchange/routes');
  hybxExchangeRoutes = j.routes || [];
  const sel = document.getElementById('hybx-exchange-route');
  if (!sel) return;
  sel.innerHTML = hybxExchangeRoutes.map(r =>
    `<option value="${escapeHtml(r.id)}">${escapeHtml(r.label)} (${escapeHtml(r.from)} → ${escapeHtml(r.to)})</option>`
  ).join('');
}

function hybxExchangePreviewDebounced() {
  clearTimeout(hybxExchangeTimer);
  hybxExchangeTimer = setTimeout(hybxExchangePreview, 350);
}

async function hybxExchangePreview() {
  const preview = document.getElementById('hybx-exchange-preview');
  const route = document.getElementById('hybx-exchange-route')?.value;
  const amount = document.getElementById('hybx-exchange-amount')?.value;
  const nsbAccount = document.getElementById('hybx-account')?.value;
  const chainId = document.getElementById('hybx-exchange-chain')?.value?.trim();
  const address = document.getElementById('hybx-exchange-address')?.value?.trim();
  if (!route || !amount) {
    if (preview) preview.textContent = 'Select route and amount';
    return;
  }
  const j = await api('/bridge/bank/hybx/exchange/quote', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ route, amount, nsbAccount, chainId, address, preview: true }),
  });
  if (!preview) return;
  if (j.error) { preview.textContent = j.error; return; }
  preview.textContent = `Preview: ${j.amount || amount} · ${j.route || route} · ${j.status || 'quoted'}`;
}

async function doHybxExchange() {
  const msg = document.getElementById('hybx-exchange-msg');
  const route = document.getElementById('hybx-exchange-route')?.value;
  const amount = document.getElementById('hybx-exchange-amount')?.value;
  const nsbAccount = document.getElementById('hybx-account')?.value;
  const chainId = document.getElementById('hybx-exchange-chain')?.value?.trim();
  const address = document.getElementById('hybx-exchange-address')?.value?.trim();
  if (!route || !amount) {
    if (msg) msg.textContent = 'Select route and amount';
    return;
  }
  const evmQ = getEvmHolder() ? `?evm=${encodeURIComponent(getEvmHolder())}` : '';
  const j = await api('/bridge/bank/hybx/exchange' + evmQ, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ route, amount, nsbAccount, chainId, address }),
  });
  if (msg) {
    if (j.error) msg.textContent = j.error;
    else msg.textContent = `✓ ${j.status}: ${j.route || route}${j.chainSettlement ? ' · ' + j.chainSettlement : ''}`;
  }
  if (!j.error) {
    document.getElementById('hybx-exchange-amount').value = '';
    await refreshHybrix();
    await refreshVirtualCards();
    await refreshOnlineBank();
  }
}

let hybrixTimer = null;

async function refreshHybrix() {
  const [st, mirrors, cards, mw] = await Promise.all([
    api('/bridge/bank/hybx/status'),
    api('/bridge/bank/hybx/mirrors'),
    api('/bridge/cards/hybx'),
    api('/bridge/bank/hybx/middleware/status'),
  ]);
  const badge = document.getElementById('hybx-status-badge');
  if (badge) badge.textContent = st.online ? 'Online' : (st.enabled ? 'Offline' : 'Disabled');
  const mwBadge = document.getElementById('hybx-mw-badge');
  if (mwBadge) mwBadge.textContent = mw.enabled ? (mw.online ? 'Live' : 'Ready') : 'Off';
  const mwIntro = document.getElementById('hybx-mw-intro');
  if (mwIntro) mwIntro.textContent = `Exchange middleware · ${mw.routes || 0} routes · ${mw.chains || 0} chains · NSB · Fineract · platform`;
  const cardsBadge = document.getElementById('hybx-cards-badge');
  if (cardsBadge) cardsBadge.textContent = (cards.count || 0) + ' HYBX cards';
  const meta = document.getElementById('hybx-meta');
  if (meta) {
    meta.textContent = `HYBX · ${st.baseUrl || '—'} · ${st.assets || 0} assets · ${mirrors.count || 0} mirrors · ${cards.count || 0} virtual cards`;
  }
  renderHybrixMirrors(mirrors.mirrors || []);
  if (document.getElementById('hybx-cards-grid')) {
    renderVirtualCards(cards.cards || [], { hybxCards: cards.count, active: cards.count }, 'hybx-cards-grid');
  }
  fillHybrixSelect(onlineBankAccounts);
  await loadHybxExchangeRoutes();
  renderHybxFederation(await api('/bridge/bank/hybx/federation'));
}

function renderHybxFederation(j) {
  const el = document.getElementById('hybx-federation-list');
  if (!el) return;
  const recs = j?.records || [];
  if (!recs.length) {
    el.innerHTML = '<p class="msg">No federation settlements yet — exchange, card pay, or ledger settle will appear here.</p>';
    return;
  }
  el.innerHTML = recs.slice(0, 20).map(r => `
    <div class="asset-row">
      <div class="asset-main">
        <div class="asset-name">${escapeHtml(r.kind || 'settlement')} · ${escapeHtml(r.symbol || '')}</div>
        <div class="asset-sub">${escapeHtml(r.reference || r.id || '')}</div>
      </div>
      <div class="asset-val">${escapeHtml(r.amount || '—')} <span class="asset-sub">${escapeHtml(r.status || '')}</span></div>
    </div>`).join('');
}

function renderHybrixMirrors(mirrors) {
  const el = document.getElementById('hybx-mirror-list');
  if (!el) return;
  if (!mirrors?.length) {
    el.innerHTML = '<p class="msg">No mirrors — tap Sync NSB → HYBX.</p>';
    return;
  }
  el.innerHTML = mirrors.map(m => `
    <div class="bank-account-card">
      <div class="bank-acct-name">${escapeHtml(m.nsbAccountId)} → ${escapeHtml(m.hybxAccountId || m.hybrixAccountId)}</div>
      <div class="bank-acct-bal">${escapeHtml(m.mirroredBalance)} ${escapeHtml((m.symbol || '').toUpperCase())}</div>
      <div class="bank-acct-meta">HYBX · ${escapeHtml(m.symbol)} · synced ${new Date((m.lastSync || 0) * 1000).toLocaleString()}</div>
    </div>`).join('');
}

function fillHybrixSelect(accts) {
  const sel = document.getElementById('hybx-account');
  if (!sel) return;
  sel.innerHTML = (accts || []).map(a =>
    `<option value="${a.id}">${escapeHtml(a.currency)} · ${escapeHtml(a.balance)} — ${escapeHtml(a.name)}</option>`
  ).join('');
}

function hybrixPreviewDebounced() {
  clearTimeout(hybrixTimer);
  hybrixTimer = setTimeout(hybrixPreview, 350);
}

async function hybrixPreview() {
  const preview = document.getElementById('hybx-preview');
  const nsbAccount = document.getElementById('hybx-account')?.value;
  const amount = document.getElementById('hybx-amount')?.value;
  const direction = document.getElementById('hybx-direction')?.value;
  if (!nsbAccount || !amount) {
    if (preview) preview.textContent = 'Select account and amount';
    return;
  }
  const evmQ = getEvmHolder() ? `?evm=${encodeURIComponent(getEvmHolder())}` : '';
  const j = await api('/bridge/bank/hybx/convert' + evmQ, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nsbAccount, amount, direction, preview: true }),
  });
  if (!preview) return;
  if (j.error) { preview.textContent = j.error; return; }
  preview.textContent = `Preview: ${j.amount} ${j.symbol} · ${j.direction} · mirror ${j.mirrorBalance || '—'}`;
}

async function issueHybxVirtualCards() {
  const evmQ = getEvmHolder() ? `?evm=${encodeURIComponent(getEvmHolder())}` : '';
  const j = await api('/bridge/bank/hybx/cards/issue' + evmQ, { method: 'POST' });
  const msg = document.getElementById('hybx-msg');
  if (msg) msg.textContent = j.error ? j.error : `✓ Issued ${j.count || 0} HYBX virtual cards`;
  await refreshHybrix();
  await refreshVirtualCards();
  await refreshOnlineBank();
}

async function syncHybrixMirrors() {
  const evmQ = getEvmHolder() ? `?evm=${encodeURIComponent(getEvmHolder())}` : '';
  const j = await api('/bridge/bank/hybx/sync' + evmQ, { method: 'POST' });
  const msg = document.getElementById('hybx-msg');
  if (msg) msg.textContent = j.error ? j.error : `✓ Synced ${j.count || 0} accounts`;
  await refreshHybrix();
  await refreshOnlineBank();
}

async function doHybrixConvert() {
  const msg = document.getElementById('hybx-msg');
  const nsbAccount = document.getElementById('hybx-account')?.value;
  const amount = document.getElementById('hybx-amount')?.value;
  const direction = document.getElementById('hybx-direction')?.value;
  if (!nsbAccount || !amount) {
    if (msg) msg.textContent = 'Select account and amount';
    return;
  }
  const evmQ = getEvmHolder() ? `?evm=${encodeURIComponent(getEvmHolder())}` : '';
  const j = await api('/bridge/bank/hybx/convert' + evmQ, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nsbAccount, amount, direction, preview: false }),
  });
  if (msg) {
    if (j.error) msg.textContent = j.error;
    else msg.textContent = `✓ ${j.status}: ${j.amount} ${j.symbol} · mirror ${j.mirrorBalance}`;
  }
  if (!j.error) {
    document.getElementById('hybx-amount').value = '';
    await refreshHybrix();
    await refreshOnlineBank();
  }
}

async function refreshFineract() {
  const [st, accts] = await Promise.all([
    api('/bridge/bank/fineract/status'),
    api('/bridge/bank/fineract/accounts'),
  ]);
  const badge = document.getElementById('fineract-status-badge');
  if (badge) badge.textContent = st.online ? 'Online' : (st.configured ? 'Auth needed' : (st.enabled ? 'Offline' : 'Disabled'));
  const meta = document.getElementById('fineract-meta');
  if (meta) {
    meta.textContent = `${st.name || 'Fineract'} · ${st.baseUrl || '—'} · tenant ${st.tenant || 'default'} · ${st.accounts ?? accts.count ?? 0} accounts`;
  }
  const swagger = document.getElementById('fineract-swagger-link');
  if (swagger && st.swaggerUrl) swagger.href = st.swaggerUrl;
  const intro = document.getElementById('fineract-intro');
  if (intro) {
    intro.textContent = st.error
      ? `Fineract: ${st.error} — set ONEX_FINERACT_USERNAME and ONEX_FINERACT_PASSWORD`
      : 'Apache Fineract savings accounts from HYBX Finance — sync into NSB online bank for send, deposit, and ledger.';
  }
  renderFineractAccounts(accts.accounts || []);
}

function renderFineractAccounts(accounts) {
  const el = document.getElementById('fineract-account-list');
  if (!el) return;
  if (!accounts?.length) {
    el.innerHTML = '<p class="msg">No Fineract accounts — configure credentials and tap Sync.</p>';
    return;
  }
  el.innerHTML = accounts.map(a => `
    <div class="bank-account-card">
      <div class="bank-acct-name">${escapeHtml(a.clientName || a.productName || 'Savings')}</div>
      <div class="bank-acct-bal">${escapeHtml(String(a.accountBalance ?? a.availableBalance ?? '0'))} ${escapeHtml((a.currency || 'USD').toUpperCase())}</div>
      <div class="bank-acct-meta">Fineract #${escapeHtml(String(a.id))} · ${escapeHtml(a.accountNo || '—')} · ${escapeHtml(a.status || '—')}</div>
    </div>`).join('');
}

async function syncFineractAccounts() {
  const evmQ = getEvmHolder() ? `?evm=${encodeURIComponent(getEvmHolder())}` : '';
  const j = await api('/bridge/bank/fineract/sync' + evmQ, { method: 'POST' });
  const msg = document.getElementById('fineract-intro');
  if (msg && !j.error) {
    msg.textContent = `✓ Synced ${j.count || 0} Fineract accounts into online bank`;
  }
  await refreshFineract();
  await refreshOnlineBank();
}

init();
renderStakePools();
loadAmmPools();
