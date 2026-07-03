let config = null;
let dexRegistry = null;
let activeDex = null;
let provider = null;
let signer = null;
let wizardStep = 1;
let validated = false;

const API_KEY_STORAGE = 'onex-token-lab-api-key';
const VIEWS = ['landing', 'generate', 'wizard', 'dashboard', 'mirrors', 'markets', 'liquidity'];

const MISSION_EPOCH = Date.now();
const telStreams = {};
let telAnimFrame = null;

function pad2(n) { return String(n).padStart(2, '0'); }

function formatUTC(d) {
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

function formatMET(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `T+ ${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
}

function startMissionClock() {
  const utcEl = document.getElementById('clock-utc');
  const metEl = document.getElementById('clock-met');
  if (!utcEl || !metEl) return;
  const tick = () => {
    const now = new Date();
    utcEl.textContent = formatUTC(now);
    metEl.textContent = formatMET(Date.now() - MISSION_EPOCH);
  };
  tick();
  setInterval(tick, 1000);
}

function telColor(name) {
  if (name === 'green') return '#39ff14';
  if (name === 'amber') return '#ffb347';
  return '#00d4ff';
}

function pushTelSample(id, value) {
  if (!telStreams[id]) telStreams[id] = [];
  const stream = telStreams[id];
  stream.push(Number(value) || 0);
  if (stream.length > 40) stream.shift();
}

function drawTelSpark(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const id = canvas.dataset.telId || canvas.closest('.tel-card')?.dataset?.tel;
  const stream = telStreams[id] || [];
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (stream.length < 2) return;
  const min = Math.min(...stream);
  const max = Math.max(...stream);
  const range = max - min || 1;
  const color = telColor(canvas.dataset.color || 'cyan');
  const points = stream.map((v, i) => ({
    x: (i / (stream.length - 1)) * (w - 4) + 2,
    y: h - 4 - ((v - min) / range) * (h - 8),
  }));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.lineTo(w - 2, h);
  ctx.lineTo(2, h);
  ctx.closePath();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function animateTelemetry() {
  document.querySelectorAll('.tel-spark').forEach(drawTelSpark);
  telAnimFrame = requestAnimationFrame(animateTelemetry);
}

function seedTelStream(id, base, variance) {
  if (telStreams[id]?.length) return;
  telStreams[id] = Array.from({ length: 24 }, (_, i) =>
    base + Math.sin(i * 0.4) * variance + (Math.random() - 0.5) * variance * 0.5
  );
}

function initTelemetry() {
  seedTelStream('chains', 7, 1.5);
  seedTelStream('live', 0, 2);
  seedTelStream('tokens', 0, 3);
  seedTelStream('latency', 42, 12);
  seedTelStream('console-chains', 7, 1);
  seedTelStream('console-live', 0, 2);
  seedTelStream('console-tokens', 0, 3);
  seedTelStream('console-signal', 98, 3);
  updateTelemetryValues(7, 0, 0);
  const latEl = document.getElementById('tel-latency');
  if (latEl) latEl.textContent = '42 ms';

  setInterval(() => {
    const lat = 28 + Math.random() * 35;
    pushTelSample('latency', lat);
    const el = document.getElementById('tel-latency');
    if (el) el.textContent = `${Math.round(lat)} ms`;

    pushTelSample('console-signal', 94 + Math.random() * 5);
    const sig = document.getElementById('tel-console-signal');
    if (sig) sig.textContent = `${Math.round(94 + Math.random() * 5)}%`;

    const ts = document.getElementById('telemetry-ts');
    if (ts) ts.textContent = `SYNC ${formatUTC(new Date())} UTC`;
    const cts = document.getElementById('telemetry-console-ts');
    if (cts) cts.textContent = `LIVE ${formatUTC(new Date())} UTC`;
  }, 2000);

  if (!telAnimFrame) animateTelemetry();
}

function updateTelemetryValues(chains, live, tokens) {
  const set = (id, val, streamId) => {
    const el = document.getElementById(id);
    if (el && val != null) el.textContent = String(val);
    if (streamId != null && val != null) pushTelSample(streamId, val);
  };
  set('tel-chains', chains, 'chains');
  set('tel-live', live, 'live');
  set('tel-tokens', tokens, 'tokens');
  set('tel-console-chains', chains, 'console-chains');
  set('tel-console-live', live, 'console-live');
  set('tel-console-tokens', tokens, 'console-tokens');
}

const LAB_ADJECTIVES = ['Alpha', 'Nova', 'Quantum', 'Golden', 'Swift', 'Prime', 'Hyper', 'Neo', 'Ultra', 'Meta', 'Solar', 'Apex'];
const LAB_NOUNS = ['Chain', 'Coin', 'Labs', 'Vault', 'Swap', 'Flow', 'Wave', 'Node', 'Pay', 'Fund', 'Mint', 'Core'];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const TOKEN_OWNER_ABI = [
  'function enableTrading() external',
  'function setAutomatedMarketMakerPair(address pair, bool value) external',
  'function tradingEnabled() view returns (bool)',
  'function featureFlags() view returns (uint32)',
];

let lastDeployFeatures = null;

function isAddr(a) {
  return typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a.trim());
}

const FLAG = {
  MINTABLE: 1 << 0,
  ENABLE_TRADING: 1 << 1,
  PAUSABLE: 1 << 2,
  BLACKLIST: 1 << 3,
  MAX_WALLET: 1 << 4,
  MAX_TX: 1 << 5,
  ANTI_BOT: 1 << 6,
  LIQ_TAX: 1 << 7,
  DIV_TAX: 1 << 8,
  BURN_TAX: 1 << 9,
  WALLET_TAX: 1 << 10,
  PERMIT: 1 << 11,
};

function pctOfSupplyBig(supplyRaw, pct) {
  const p = BigInt(Math.max(0, Math.round(pct * 100)));
  return (supplyRaw * p) / 10000n;
}

function readWalletTaxes() {
  const addrs = [];
  const bps = [];
  document.querySelectorAll('.wallet-tax-row').forEach(row => {
    const a = row.querySelector('.wallet-tax-addr')?.value.trim();
    const p = parseFloat(row.querySelector('.wallet-tax-pct')?.value);
    if (a && a.startsWith('0x') && !isNaN(p) && p > 0) {
      addrs.push(a);
      bps.push(Math.min(2500, Math.round(p * 100)));
    }
  });
  return { addrs, bps };
}

function taxPct(id) {
  const el = document.getElementById(id);
  const v = parseFloat(el?.value);
  return isNaN(v) || v <= 0 ? 0 : v;
}

function buildFeatureFlags() {
  let flags = 0;
  if (document.getElementById('feat-mintable')?.checked) flags |= FLAG.MINTABLE;
  if (document.querySelector('input[data-feat="enableTrading"]')?.checked) flags |= FLAG.ENABLE_TRADING;
  if (document.querySelector('input[data-feat="pausable"]')?.checked) flags |= FLAG.PAUSABLE;
  if (document.querySelector('input[data-feat="blacklist"]')?.checked) flags |= FLAG.BLACKLIST;
  if (document.querySelector('input[data-feat="maxWallet"]')?.checked) flags |= FLAG.MAX_WALLET;
  if (document.querySelector('input[data-feat="maxTx"]')?.checked) flags |= FLAG.MAX_TX;
  if (document.querySelector('input[data-feat="antiBot"]')?.checked) flags |= FLAG.ANTI_BOT;
  if (document.getElementById('tax-liquidity')?.checked && taxPct('tax-liquidity-pct') > 0) flags |= FLAG.LIQ_TAX;
  if (document.getElementById('tax-dividend')?.checked && taxPct('tax-dividend-pct') > 0) flags |= FLAG.DIV_TAX;
  if (document.getElementById('tax-burn')?.checked && taxPct('tax-burn-pct') > 0) flags |= FLAG.BURN_TAX;
  if (document.querySelector('input[data-feat="permit"]')?.checked) flags |= FLAG.PERMIT;
  const wt = readWalletTaxes();
  if (wt.addrs.length) flags |= FLAG.WALLET_TAX;
  return { flags, walletTaxAccounts: wt.addrs, walletTaxBps: wt.bps };
}

function getChainMeta(slug) {
  slug = slug || document.getElementById('chain-select')?.value || 'bsc';
  return (config?.chains || []).find(c => c.slug === slug);
}

function getSelectedChain() {
  return getChainMeta() || config || { slug: 'bsc', chainId: 56, explorer: 'https://bscscan.com', rpcUrl: '' };
}

function isEvmDeployChain(chain) {
  return chain && Number(chain.chainId) > 0 && !!chain.rpcUrl;
}

function explorerForToken(token) {
  return token?.explorer || getChainMeta(token?.chainSlug)?.explorer || config?.explorer || 'https://bscscan.com';
}

function chainQuery(token) {
  const slug = token?.chainSlug || getSelectedChain().slug;
  return slug ? `?chain=${encodeURIComponent(slug)}` : '';
}

function populateChainSelect() {
  const sel = document.getElementById('chain-select');
  if (!sel || !config?.chains?.length) return;
  sel.innerHTML = config.chains.map(c => {
    const tag = c.liquiditySupported ? ' · liquidity' : (c.tokenType === 'erc20' ? '' : ' · track only');
    return `<option value="${c.slug}">${c.name}${tag}</option>`;
  }).join('');
  sel.value = config.chainSlug || 'bsc';
  updateChainBanner();
}

function updateChainBanner() {
  const banner = document.getElementById('chain-banner');
  if (!banner) return;
  const chain = getSelectedChain();
  if (!isEvmDeployChain(chain)) {
    banner.textContent = `${chain.name}: OneX contract deploy runs on EVM mainnets. Pick BSC, Ethereum, Base, or Polygon below — or track tokens in Dashboard.`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

async function ensureChain(chain) {
  const target = '0x' + Number(chain.chainId).toString(16);
  const net = await provider.getNetwork();
  if (Number(net.chainId) === Number(chain.chainId)) return;
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: target }],
    });
  } catch (e) {
    if (e.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: target,
          chainName: chain.name,
          nativeCurrency: { name: chain.nativeSymbol, symbol: chain.nativeSymbol, decimals: 18 },
          rpcUrls: [chain.rpcUrl],
          blockExplorerUrls: [chain.explorer],
        }],
      });
    } else {
      throw e;
    }
  }
}

function buildFeaturesPayload(creator) {
  const { flags, walletTaxAccounts, walletTaxBps } = buildFeatureFlags();
  const owner = document.getElementById('diff-owner')?.checked
    ? document.getElementById('owner-addr').value.trim()
    : creator;
  const recipient = document.getElementById('diff-recipient')?.checked
    ? document.getElementById('recipient-addr').value.trim()
    : creator;
  return {
    chain: getSelectedChain().slug,
    flags,
    owner,
    recipient,
    maxWalletPct: parseFloat(document.getElementById('opt-max-wallet-pct')?.value) || 2,
    maxTxPct: parseFloat(document.getElementById('opt-max-tx-pct')?.value) || 1,
    antiBotCooldown: parseInt(document.getElementById('opt-cooldown')?.value, 10) || 30,
    liquidityTaxPct: document.getElementById('tax-liquidity')?.checked ? taxPct('tax-liquidity-pct') : 0,
    dividendTaxPct: document.getElementById('tax-dividend')?.checked ? taxPct('tax-dividend-pct') : 0,
    burnTaxPct: document.getElementById('tax-burn')?.checked ? taxPct('tax-burn-pct') : 0,
    walletTaxAccounts,
    walletTaxBps,
  };
}

async function buildInitParams() {
  const f = getTokenFields();
  const method = document.getElementById('deploy-method')?.value || 'metamask';
  let creator = '';
  if (method === 'metamask') {
    if (!signer) await connectWallet();
    creator = await signer.getAddress();
  } else if (signer) {
    creator = await signer.getAddress();
  }
  const features = buildFeaturesPayload(creator);
  const supplyRaw = ethers.parseUnits(f.supply, f.decimals);
  const owner = features.owner || creator;
  const recipient = features.recipient || creator || owner;
  if (!isAddr(owner)) throw new Error('Connect wallet or set a valid token owner.');
  if (!isAddr(recipient)) throw new Error('Set a valid supply recipient address.');

  let maxWallet = 0n;
  let maxTx = 0n;
  if (features.flags & FLAG.MAX_WALLET) maxWallet = pctOfSupplyBig(supplyRaw, features.maxWalletPct);
  if (features.flags & FLAG.MAX_TX) maxTx = pctOfSupplyBig(supplyRaw, features.maxTxPct);

  const liqBps = Math.min(2500, Math.round((features.liquidityTaxPct || 0) * 100));
  const divBps = Math.min(2500, Math.round((features.dividendTaxPct || 0) * 100));
  const burnBps = Math.min(2500, Math.round((features.burnTaxPct || 0) * 100));
  const totalTax = liqBps + divBps + burnBps + features.walletTaxBps.reduce((a, b) => a + b, 0);
  if (totalTax > 2500) throw new Error('Total tax cannot exceed 25%');

  const maxSupply = (features.flags & FLAG.MINTABLE) ? supplyRaw * 2n : supplyRaw;

  return {
    init: {
      name: f.name,
      symbol: f.symbol.toUpperCase(),
      decimals: Number(f.decimals),
      initialSupply: supplyRaw,
      owner,
      recipient,
      flags: Number(features.flags),
      maxSupply,
      maxWallet,
      maxTx,
      antiBotCooldown: BigInt(features.antiBotCooldown),
      liquidityTaxBps: liqBps,
      dividendTaxBps: divBps,
      burnTaxBps: burnBps,
      liquidityWallet: owner,
      dividendWallet: owner,
      walletTaxAccounts: features.walletTaxAccounts,
      walletTaxRates: features.walletTaxBps.map((n) => Number(n)),
    },
    features,
  };
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeSymbol(name) {
  const words = name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  let sym = words.map(w => w[0]).join('').toUpperCase().slice(0, 5);
  if (sym.length < 3) sym = (words[0] || 'ONX').slice(0, 4).toUpperCase();
  return sym;
}

function getTokenFields() {
  return {
    name: document.getElementById('token-name').value.trim(),
    symbol: document.getElementById('token-symbol').value.trim().toUpperCase(),
    decimals: parseInt(document.getElementById('token-decimals').value, 10) || 18,
    supply: document.getElementById('token-supply').value.trim(),
    contractName: document.getElementById('contract-name').value.trim(),
  };
}

function generateTokenFields() {
  const name = `OneX ${pick(LAB_ADJECTIVES)} ${pick(LAB_NOUNS)}`;
  const symbol = makeSymbol(name);
  document.getElementById('token-name').value = name;
  document.getElementById('token-symbol').value = symbol;
  document.getElementById('token-decimals').value = '18';
  document.getElementById('token-supply').value = '1000000000';
  syncContractName();
  setMsg(document.getElementById('create-msg'), `Generated ${symbol} — review each step, then Deploy.`, 'ok');
}

function syncContractName() {
  const name = document.getElementById('token-name').value.trim();
  const custom = document.querySelector('input[name="contract-name-mode"]:checked')?.value === 'custom';
  const el = document.getElementById('contract-name');
  if (custom) {
    el.readOnly = false;
    if (!el.value || el.dataset.auto === '1') el.value = name.replace(/\s+/g, '');
    el.dataset.auto = '0';
  } else {
    el.readOnly = true;
    el.value = name ? name.replace(/\s+/g, '') : '';
    el.dataset.auto = '1';
  }
}

function getApiKey() {
  return localStorage.getItem(API_KEY_STORAGE) || '';
}

function setApiKey(key) {
  if (key) localStorage.setItem(API_KEY_STORAGE, key);
  else localStorage.removeItem(API_KEY_STORAGE);
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const key = getApiKey();
  if (key) headers['X-API-Key'] = key;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.error) {
    data.error = res.status === 401 ? 'API key required — open Settings' : `HTTP ${res.status}`;
  }
  return data;
}

function setMsg(el, text, type = '') {
  if (!el) return;
  el.textContent = text;
  el.className = 'status-msg' + (type ? ' ' + type : '');
}

function setGlobalStatus(text, type = '') {
  const el = document.getElementById('global-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'global-status' + (type ? ' ' + type : '');
}

function shortAddr(a) {
  if (!a) return '';
  return a.slice(0, 6) + '…' + a.slice(-4);
}

function fmtUsd(n) {
  if (n == null || isNaN(n)) return '$0.00';
  if (n < 0.000001) return '< $0.000001';
  return '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function registryChainSlug(slug) {
  const m = { eth: 'ethereum', ethereum: 'ethereum', bnb: 'bsc', bsc: 'bsc', matic: 'polygon', arb: 'arbitrum', op: 'optimism', avax: 'avalanche' };
  return m[slug] || slug || 'bsc';
}

function explorerForChainSlug(slug) {
  const c = (config?.chains || []).find(ch => registryChainSlug(ch.slug) === registryChainSlug(slug));
  return (c?.explorer || config?.explorer || 'https://bscscan.com').replace(/\/$/, '');
}

async function copyText(text, btn, label) {
  if (!text) return;
  await navigator.clipboard.writeText(text);
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = label || 'Copied';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  }
}

function getLiqChainSlug() {
  return registryChainSlug(document.getElementById('liq-chain')?.value || 'bsc');
}

function getLiqDexId() {
  return document.getElementById('liq-dex')?.value || 'pancake-v2';
}

function getLiqTokenAddr() {
  const manual = document.getElementById('liq-token-addr')?.value?.trim();
  if (manual?.startsWith('0x')) return manual;
  return document.getElementById('liq-token')?.value || '';
}

async function loadDexRegistry() {
  dexRegistry = await api('/api/dex/registry');
  return dexRegistry;
}

function populateLiqChains() {
  const sel = document.getElementById('liq-chain');
  if (!sel || !dexRegistry?.chains) return;
  const order = ['bsc', 'ethereum', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'base'];
  sel.innerHTML = order.filter(id => dexRegistry.chains[id]).map(id => {
    const c = dexRegistry.chains[id];
    return `<option value="${id}">${c.name}</option>`;
  }).join('');
  populateLiqDexes();
}

function populateLiqDexes() {
  const chain = getLiqChainSlug();
  const sel = document.getElementById('liq-dex');
  const cfg = dexRegistry?.chains?.[chain];
  if (!sel || !cfg) return;
  sel.innerHTML = (cfg.dexes || []).map(d =>
    `<option value="${d.id}">${d.name} (V${d.version})</option>`
  ).join('');
  populateLiqQuotes();
  refreshActiveDex();
}

function populateLiqQuotes() {
  const chain = getLiqChainSlug();
  const cfg = dexRegistry?.chains?.[chain];
  const sel = document.getElementById('liq-quote');
  if (!sel || !cfg?.quotes) return;
  sel.innerHTML = cfg.quotes.map(q =>
    `<option value="${q.id}">${q.symbol}${q.id === 'usdt' || q.id === 'usdc' ? ' (best for $1)' : ''}</option>`
  ).join('');
  if ([...sel.options].some(o => o.value === 'usdt')) sel.value = 'usdt';
  updateQuoteLabel();
}

async function refreshActiveDex() {
  const chain = getLiqChainSlug();
  const dex = getLiqDexId();
  activeDex = await api(`/api/dex/registry?chain=${encodeURIComponent(chain)}&dex=${encodeURIComponent(dex)}`);
  const btn = document.getElementById('btn-add-liquidity');
  if (btn) {
    if (activeDex?.liquidityMode === 'router-v2') {
      btn.textContent = `Add liquidity on ${activeDex.name} (MetaMask)`;
      btn.disabled = false;
    } else {
      btn.textContent = `Open ${activeDex?.name || 'DEX'} UI (V3/V4)`;
    }
  }
  checkPair();
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return sign + Number(n).toFixed(2) + '%';
}

function showView(name) {
  if (!VIEWS.includes(name)) name = 'landing';
  VIEWS.forEach(v => {
    document.getElementById('view-' + v)?.classList.toggle('hidden', v !== name);
  });
  document.querySelectorAll('.nav-links a').forEach(a => {
    a.classList.toggle('active', a.dataset.nav === name);
  });
  if (name === 'dashboard') renderDashboard();
  if (name === 'mirrors') renderFlashMirror();
  if (name === 'markets') renderMarkets();
  if (name === 'liquidity') {
    populateLiqChains();
    fillLiquidityTokens();
    renderLiquidityHistory();
    renderLiquidityWalletBanner();
    checkPair();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
  closeMissionNav();
}

function setMissionNavOpen(open) {
  const toggle = document.getElementById('nav-toggle');
  const links = document.getElementById('mission-nav-links');
  if (!toggle || !links) return;
  links.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  document.body.classList.toggle('nav-open', open);
}

function closeMissionNav() {
  setMissionNavOpen(false);
}

function setWizardStep(step) {
  wizardStep = step;
  document.querySelectorAll('.step-tab').forEach(tab => {
    const n = parseInt(tab.dataset.step, 10);
    tab.classList.toggle('active', n === step);
    tab.classList.toggle('done', n < step);
  });
  document.querySelectorAll('.wizard-step').forEach(panel => {
    panel.classList.toggle('hidden', parseInt(panel.dataset.stepPanel, 10) !== step);
  });
  if (step === 4) renderSummary();
}

function validateStep1() {
  const f = getTokenFields();
  if (!f.name || f.name.length > 50) return 'Token name is required (max 50 chars).';
  if (!f.symbol || f.symbol.length > 20) return 'Token symbol is required (max 20 chars).';
  if (!f.supply || isNaN(Number(f.supply)) || Number(f.supply) < 1) return 'Enter a valid initial supply.';
  if (f.decimals < 1 || f.decimals > 18) return 'Decimals must be between 1 and 18.';
  const chain = getSelectedChain();
  if (!isEvmDeployChain(chain)) {
    return `${chain.name} is track-only — select an EVM chain (BSC, Ethereum, Base, Polygon, etc.) to deploy.`;
  }
  if (document.getElementById('diff-recipient').checked) {
    const addr = document.getElementById('recipient-addr').value.trim();
    if (!isAddr(addr)) return 'Enter a valid supply recipient address.';
  }
  if (document.getElementById('diff-owner').checked) {
    const addr = document.getElementById('owner-addr').value.trim();
    if (!isAddr(addr)) return 'Enter a valid token owner address.';
  }
  return null;
}

function getSelectedFeatures() {
  const optional = [];
  document.querySelectorAll('.feature-toggles input[data-feat]').forEach(inp => {
    if (inp.checked) optional.push(inp.dataset.feat);
  });
  if (document.getElementById('feat-mintable')?.checked) optional.push('mintable');
  const taxes = [];
  if (document.getElementById('tax-liquidity')?.checked) taxes.push(`Liquidity ${document.getElementById('tax-liquidity-pct').value || 0}%`);
  if (document.getElementById('tax-dividend')?.checked) taxes.push(`Dividend ${document.getElementById('tax-dividend-pct').value || 0}%`);
  if (document.getElementById('tax-burn')?.checked) taxes.push(`Burn ${document.getElementById('tax-burn-pct').value || 0}%`);
  const wt = readWalletTaxes();
  wt.addrs.forEach((a, i) => taxes.push(`Wallet ${shortAddr(a)} ${(wt.bps[i] / 100).toFixed(2)}%`));
  return { optional, taxes };
}

function renderSummary() {
  const f = getTokenFields();
  const { optional, taxes } = getSelectedFeatures();
  const chain = document.getElementById('chain-select');
  const chainLabel = chain.options[chain.selectedIndex].text;
  const walletLabel = document.getElementById('wallet-addr')?.textContent || '';
  const rows = [
    ['Blockchain', chainLabel],
    ['Token name', f.name],
    ['Token symbol', f.symbol],
    ['Contract name', f.contractName || f.name.replace(/\s+/g, '')],
    ['Initial supply', f.supply + ' tokens'],
    ['Decimals', String(f.decimals)],
    ['Optional features', optional.length ? optional.join(', ') : 'None'],
    ['Taxes', taxes.length ? taxes.join(', ') : 'None'],
    ['Deploy wallet', walletLabel || 'Not connected — click Connect Wallet'],
  ];

  const box = document.getElementById('summary-box');
  box.innerHTML = rows.map(([k, v]) =>
    `<div class="summary-row"><span>${k}</span><strong>${v || '—'}</strong></div>`
  ).join('');

  const warn = document.getElementById('summary-warn');
  const { flags } = buildFeatureFlags();
  if (flags & FLAG.ENABLE_TRADING) {
    warn.textContent = 'EnableTrading is on — call enableTrading() from the owner wallet after deploy to open public trading.';
    warn.classList.remove('hidden');
  } else {
    warn.classList.add('hidden');
  }
  validated = false;
}

function validateConfiguration() {
  const err = validateStep1();
  if (err) {
    setMsg(document.getElementById('create-msg'), err, 'error');
    return;
  }
  if (!signer) {
    setMsg(document.getElementById('create-msg'), 'Connect your wallet before deploying.', 'error');
    return;
  }
  validated = true;
  setMsg(document.getElementById('create-msg'), 'Configuration validated — click Deploy to confirm in MetaMask.', 'ok');
}

function applyProductionSettings() {
  const isProd = config?.env === 'production';
  const needsKey = !!config?.apiKeyRequired;
  const hasKey = !!getApiKey();

  const envEl = document.getElementById('env-badge');
  if (envEl) {
    envEl.textContent = isProd ? 'production' : (config?.env || 'development');
    envEl.classList.toggle('prod', isProd);
  }

  const label = document.getElementById('settings-env-label');
  if (label) {
    label.textContent = isProd ? 'Production' : 'Development';
    label.classList.toggle('prod', isProd);
  }

  const hint = document.getElementById('settings-env-hint');
  if (hint) {
    hint.textContent = isProd
      ? 'Deploy, register, and liquidity POST endpoints require a valid API key.'
      : 'Development mode — API key is optional.';
    hint.className = 'status-msg' + (isProd ? ' ok' : '');
  }

  const status = document.getElementById('settings-key-status');
  if (status) {
    if (hasKey) {
      status.textContent = 'API key saved in this browser. Deploy is unlocked.';
      status.className = 'status-msg ok';
    } else if (needsKey) {
      status.textContent = 'API key required — paste BSC_LAUNCHER_API_KEY from bsc-launcher/.env';
      status.className = 'status-msg error';
    } else {
      status.textContent = 'No API key saved (not required in development).';
      status.className = 'status-msg';
    }
  }

  const btn = document.getElementById('btn-settings');
  if (btn) btn.classList.toggle('settings-needed', needsKey && !hasKey);

  if (needsKey && !hasKey && !sessionStorage.getItem('settings-dismissed')) {
    openSettings();
  }
}

function renderLiquidityWalletBanner() {
  const el = document.getElementById('liq-wallet-banner');
  if (!el || !config) return;
  const addr = config.deployerAddress || '0x05868c29D58d1EC275Cf078356c03F79B1975600';
  const mode = config.poolLiveMode || 'metamask';
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="flash-market-item"><span>Pool wallet</span><strong class="mono">${esc(addr)}</strong></div>
    <div class="flash-market-item"><span>Mode</span><strong>${mode === 'cli' ? 'CLI + key' : 'MetaMask'}</strong></div>
    <div class="flash-market-item"><span>Fund on BSC</span><strong>BNB + USDT</strong></div>
    <p class="flash-market-note">${mode === 'metamask'
      ? 'Connect MetaMask with this wallet, then click <strong>BSCScan $1B USDT test</strong> and <strong>Add liquidity</strong>.'
      : 'CLI pool deploy enabled via FLASH_DEPLOYER_PRIVATE_KEY.'}
      <a href="https://bscscan.com/address/${esc(addr)}" target="_blank" rel="noopener">BSCScan</a></p>`;
}

async function loadConfig() {
  config = await api('/api/config');
  if (config.error) throw new Error(config.error);
  await loadDexRegistry().catch(() => { dexRegistry = null; });
  populateChainSelect();
  populateLiqChains();
  renderLiquidityWalletBanner();
  const buildEl = document.getElementById('footer-build');
  if (buildEl && config.build) buildEl.textContent = config.build;
  const backendOpt = document.querySelector('#deploy-method option[value="backend"]');
  if (backendOpt && !config.backendDeployEnabled) {
    backendOpt.disabled = true;
    backendOpt.textContent = 'Platform wallet (not configured)';
  }
  applyProductionSettings();
}

function openSettings() {
  document.getElementById('settings-modal').classList.remove('hidden');
  document.getElementById('settings-api-key').value = getApiKey();
  applyProductionSettings();
}

function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
  if (config?.apiKeyRequired && !getApiKey()) {
    sessionStorage.setItem('settings-dismissed', '1');
  }
}

function saveSettings() {
  const key = document.getElementById('settings-api-key').value.trim();
  if (config?.apiKeyRequired && !key) {
    setMsg(document.getElementById('settings-key-status'), 'Enter the API key from .env', 'error');
    return;
  }
  setApiKey(key);
  sessionStorage.removeItem('settings-dismissed');
  applyProductionSettings();
  closeSettings();
  setGlobalStatus(config?.apiKeyRequired ? 'Production · API key saved' : 'Settings saved', 'ok');
  setMsg(document.getElementById('create-msg'), 'Production settings saved.', 'ok');
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('settings-api-key');
  const btn = document.getElementById('btn-toggle-key');
  if (!input || !btn) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.textContent = show ? 'Hide' : 'Show';
}

async function connectWallet() {
  if (!window.ethereum) {
    alert('MetaMask not detected. Install MetaMask or another Web3 wallet.');
    return;
  }
  const chain = getSelectedChain();
  if (!isEvmDeployChain(chain)) {
    alert('Select an EVM chain in the wizard before connecting MetaMask.');
    return;
  }
  provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send('eth_requestAccounts', []);
  await ensureChain(chain);
  provider = new ethers.BrowserProvider(window.ethereum);
  signer = await provider.getSigner();
  const addr = await signer.getAddress();
  document.getElementById('wallet-addr').textContent = shortAddr(addr);
  document.getElementById('btn-connect').textContent = 'Connected';
  if (wizardStep === 4) renderSummary();
}

async function deployMetaMask() {
  const f = getTokenFields();
  const { init, features } = await buildInitParams();
  lastDeployFeatures = features;

  const factory = new ethers.ContractFactory(
    config.contractAbi,
    config.contractBytecode,
    signer
  );

  setMsg(document.getElementById('create-msg'), 'Confirm deploy transaction in MetaMask…');
  const deployRequest = await factory.getDeployTransaction(init);
  const sent = await signer.sendTransaction({
    ...deployRequest,
    gasLimit: 6_500_000n,
  });
  const txHash = sent.hash;
  setMsg(document.getElementById('create-msg'), `Waiting for ${getSelectedChain().name} confirmation…`);
  const receipt = await sent.wait();
  if (!receipt || receipt.status !== 1) throw new Error('Deploy transaction failed on-chain');
  const address = receipt.contractAddress;
  if (!address) throw new Error('No contract address — check explorer for tx ' + txHash);
  const creator = await signer.getAddress();

  const reg = await api('/api/tokens/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractAddress: address,
      name: f.name,
      symbol: f.symbol.toUpperCase(),
      decimals: f.decimals,
      supply: f.supply,
      txHash,
      creator,
      chain: getSelectedChain().slug,
      features,
    }),
  });

  if (reg.error) throw new Error(reg.error);
  const exp = getSelectedChain().explorer || config.explorer;
  reg.token = reg.token || { contractAddress: address, name: f.name, symbol: f.symbol.toUpperCase(), txHash, chainSlug: getSelectedChain().slug };
  reg.explorerTokenUrl = reg.explorerTokenUrl || (exp + '/token/' + address);
  reg.explorerTxUrl = reg.explorerTxUrl || (exp + '/tx/' + txHash);
  return reg;
}

async function deployBackend() {
  const f = getTokenFields();
  const { features } = await buildInitParams();
  setMsg(document.getElementById('create-msg'), 'Deploying via platform wallet…');
  const j = await api('/api/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: f.name,
      symbol: f.symbol,
      decimals: f.decimals,
      supply: f.supply,
      chain: getSelectedChain().slug,
      features,
    }),
  });
  if (j.error) throw new Error(j.error);
  return j;
}

function showDeployResult(data) {
  const el = document.getElementById('deploy-result');
  const token = data.token || data;
  const exp = explorerForToken(token);
  const tokenUrl = data.explorerTokenUrl || (exp + '/token/' + token.contractAddress);
  const txUrl = data.explorerTxUrl || (exp + '/tx/' + token.txHash);
  const chainLabel = token.chainName || getChainMeta(token.chainSlug)?.name || getSelectedChain().name;
  const flags = lastDeployFeatures?.flags ?? buildFeatureFlags().flags;
  const tradingBtn = (flags & FLAG.ENABLE_TRADING)
    ? '<button type="button" class="btn btn-outline" id="btn-enable-trading">Enable trading now</button>'
    : '';
  el.innerHTML = `
    <p class="status-msg ok">Token deployed on ${chainLabel} with all selected on-chain features!</p>
    <p><strong>${token.symbol}</strong> — ${token.name}</p>
    <p class="token-meta">${token.contractAddress}</p>
    <p class="token-links">
      <a href="${tokenUrl}" target="_blank" rel="noopener">View on explorer</a>
      <a href="${txUrl}" target="_blank" rel="noopener">View transaction</a>
      <a href="#" id="link-add-liq">Add liquidity →</a>
      <a href="#" id="link-dashboard">Open dashboard →</a>
      ${tradingBtn}
    </p>`;
  el.classList.remove('hidden');
  document.getElementById('btn-enable-trading')?.addEventListener('click', () =>
    enableTradingOnToken(token.contractAddress)
  );
  document.getElementById('link-add-liq')?.addEventListener('click', (e) => {
    e.preventDefault();
    showView('liquidity');
    presetDollarListing(token.contractAddress);
  });
  document.getElementById('link-dashboard')?.addEventListener('click', (e) => {
    e.preventDefault();
    showView('dashboard');
  });
}

async function enableTradingOnToken(tokenAddr) {
  if (!signer) await connectWallet();
  const msg = document.getElementById('create-msg');
  try {
    const token = new ethers.Contract(tokenAddr, TOKEN_OWNER_ABI, signer);
    setMsg(msg, 'Confirm enableTrading() in MetaMask…');
    const tx = await token.enableTrading();
    await tx.wait();
    setMsg(msg, 'Trading is now enabled on your token.', 'ok');
  } catch (err) {
    setMsg(msg, err.reason || err.message || String(err), 'error');
  }
}

async function markPairOnToken(tokenAddr, pairAddr) {
  if (!signer || !isAddr(pairAddr)) return;
  try {
    const token = new ethers.Contract(tokenAddr, TOKEN_OWNER_ABI, signer);
    const tx = await token.setAutomatedMarketMakerPair(pairAddr, true);
    await tx.wait();
  } catch (_) { /* optional */ }
}

function presetBscscan1BUsdt(tokenAddr) {
  showView('liquidity');
  const chainSel = document.getElementById('liq-chain');
  if (chainSel) chainSel.value = 'bsc';
  populateLiqDexes();
  const dexSel = document.getElementById('liq-dex');
  if (dexSel) dexSel.value = 'pancake-v2';
  refreshActiveDex();
  const addr = tokenAddr || '0x8944A53814b99E14c7BAE33814548a1F32bDCA8b';
  const addrEl = document.getElementById('liq-token-addr');
  if (addrEl) addrEl.value = addr;
  document.getElementById('liq-target-usd').value = '1';
  const quote = document.getElementById('liq-quote');
  if (quote) quote.value = 'usdt';
  document.getElementById('liq-token-amount').value = '1000000000';
  updateQuoteLabel();
  calculateLiquidityQuote();
  checkPair();
  const preview = document.getElementById('liq-price-preview');
  if (preview) {
    preview.innerHTML += ' · <strong>BSCScan mcap ≈ $1,000,000,000</strong>';
  }
}

function presetDollarListing(tokenAddr) {
  showView('liquidity');
  const sel = document.getElementById('liq-token');
  const addr = document.getElementById('liq-token-addr');
  if (addr && tokenAddr) addr.value = tokenAddr;
  if (sel && tokenAddr) sel.value = tokenAddr;
  document.getElementById('liq-target-usd').value = '1';
  const quote = document.getElementById('liq-quote');
  if (quote) quote.value = 'usdt';
  updateQuoteLabel();
  if (!document.getElementById('liq-token-amount').value) {
    document.getElementById('liq-token-amount').value = '10000';
  }
  calculateLiquidityQuote();
  checkPair();
}

async function calculateLiquidityQuote() {
  const tokenAmount = document.getElementById('liq-token-amount').value.trim();
  const targetUsd = document.getElementById('liq-target-usd').value.trim() || '1';
  const quote = document.getElementById('liq-quote').value;
  const chain = getLiqChainSlug();
  const preview = document.getElementById('liq-price-preview');
  if (!tokenAmount) {
    setMsg(preview, 'Enter token amount first', 'error');
    return;
  }
  const q = await api('/api/liquidity/quote?tokenAmount=' + encodeURIComponent(tokenAmount) +
    '&targetUsd=' + encodeURIComponent(targetUsd) + '&quote=' + encodeURIComponent(quote) +
    '&chain=' + encodeURIComponent(chain));
  if (q.error) {
    setMsg(preview, q.error, 'error');
    return;
  }
  document.getElementById('liq-quote-amount').value = q.quoteAmount;
  const mcap = q.marketCapUsd ? fmtUsd(q.marketCapUsd) : '';
  preview.innerHTML = `Listing price: <span class="price-tag">$${q.targetUsd}</span> per token · add <strong>${q.quoteAmount} ${q.quoteSymbol}</strong>${mcap ? ` · mcap <strong>${mcap}</strong>` : ''}`;
  preview.className = 'status-msg ok';
}

function minAmount(amount) {
  return (amount * 95n) / 100n;
}

function deadline() {
  return Math.floor(Date.now() / 1000) + 60 * 20;
}

async function ensureAllowance(tokenContract, owner, spender, amount) {
  const allowance = await tokenContract.allowance(owner, spender);
  if (allowance >= amount) return;
  setMsg(document.getElementById('liq-msg'), 'Approve token spend in MetaMask…');
  const tx = await tokenContract.approve(spender, ethers.MaxUint256);
  await tx.wait();
}

async function addLiquidityMetaMask() {
  if (!signer) await connectWallet();
  const chainSlug = getLiqChainSlug();
  const chain = (config?.chains || []).find(c => registryChainSlug(c.slug) === chainSlug)
    || { chainId: 56, rpcUrl: 'https://bsc-dataseed.binance.org', name: 'BNB Chain', explorer: 'https://bscscan.com' };
  await ensureChain(chain);

  const dex = activeDex || await api(`/api/dex/registry?chain=${encodeURIComponent(chainSlug)}&dex=${encodeURIComponent(getLiqDexId())}`);
  if (dex?.liquidityMode === 'link-only') {
    window.open(dex.liquidityUrl, '_blank', 'noopener');
    throw new Error(`Open ${dex.name} in browser — V3/V4 liquidity is added in the DEX UI.`);
  }
  if (!dex?.router) throw new Error('DEX router not configured');

  const tokenAddr = getLiqTokenAddr();
  const quoteId = document.getElementById('liq-quote').value;
  const tokenAmountHuman = document.getElementById('liq-token-amount').value.trim();
  const quoteAmountHuman = document.getElementById('liq-quote-amount').value.trim();
  if (!tokenAddr) throw new Error('Enter or select a token address');

  const list = await api('/api/tokens');
  const tok = Array.isArray(list) ? list.find(t => t.contractAddress.toLowerCase() === tokenAddr.toLowerCase()) : null;
  const decimals = tok?.decimals ?? 8;

  const router = new ethers.Contract(dex.router, dex.routerAbi, signer);
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
  const owner = await signer.getAddress();
  const amountToken = ethers.parseUnits(tokenAmountHuman, decimals);
  const to = owner;
  const dl = deadline();

  let tx;
  if (quoteId === 'bnb' || quoteId === 'wbnb' || quoteId === 'weth' || quoteId === 'wmatic' || quoteId === 'wavax') {
    const amountETH = ethers.parseEther(quoteAmountHuman);
    await ensureAllowance(token, owner, dex.router, amountToken);
    setMsg(document.getElementById('liq-msg'), 'Confirm add liquidity (native pair) in MetaMask…');
    tx = await router.addLiquidityETH(
      tokenAddr, amountToken, minAmount(amountToken), minAmount(amountETH), to, dl,
      { value: amountETH }
    );
  } else {
    const quote = (dex.quotes || []).find(q => q.id === quoteId);
    if (!quote) throw new Error('Unknown quote token');
    const amountQuote = ethers.parseUnits(quoteAmountHuman, quote.decimals);
    const quoteToken = new ethers.Contract(quote.address, ERC20_ABI, signer);
    await ensureAllowance(token, owner, dex.router, amountToken);
    await ensureAllowance(quoteToken, owner, dex.router, amountQuote);
    setMsg(document.getElementById('liq-msg'), 'Confirm add liquidity (USDT pair) in MetaMask…');
    tx = await router.addLiquidity(
      tokenAddr, quote.address, amountToken, amountQuote,
      minAmount(amountToken), minAmount(amountQuote), to, dl
    );
  }

  setMsg(document.getElementById('liq-msg'), `Waiting for ${chain.name} confirmation…`);
  await tx.wait();

  const pairQ = `token=${encodeURIComponent(tokenAddr)}&quote=${quoteId}&chain=${encodeURIComponent(chainSlug)}&dex=${encodeURIComponent(getLiqDexId())}`;
  const pair = await api('/api/liquidity/pair?' + pairQ);
  const reg = await api('/api/liquidity/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chainSlug,
      dexId: getLiqDexId(),
      tokenAddress: tokenAddr,
      quoteId,
      pairAddress: pair.pairAddress || '',
      tokenAmount: tokenAmountHuman,
      quoteAmount: quoteAmountHuman,
      txHash: tx.hash,
      creator: owner,
    }),
  });
  if (reg.error) throw new Error(reg.error);
  if (reg.liquidity?.pairAddress || pair.pairAddress) {
    await markPairOnToken(tokenAddr, reg.liquidity?.pairAddress || pair.pairAddress);
  }
  return reg;
}

function showLiquidityResult(data) {
  const el = document.getElementById('liq-result');
  const liq = data.liquidity || data;
  const exp = data.explorerTokenUrl || (config.explorer + '/token/' + liq.tokenAddress);
  const target = document.getElementById('liq-target-usd')?.value || '1';
  const amt = document.getElementById('liq-token-amount')?.value || '0';
  const mcap = fmtUsd(Number(amt) * Number(target));
  el.innerHTML = `
    <p class="status-msg ok">Pool live — BSCScan shows ~$${target}/token · mcap ~${mcap} in ~5–15 min</p>
    <p class="token-meta">Pair: ${liq.pairAddress || 'indexing…'}</p>
    <p class="token-links">
      <a href="${exp}" target="_blank" rel="noopener"><strong>View on BSCScan</strong></a>
      ${data.dexUrl ? `<a href="${data.dexUrl}" target="_blank" rel="noopener">DEX</a>` : ''}
      ${data.dexscreenerUrl ? `<a href="${data.dexscreenerUrl}" target="_blank" rel="noopener">DexScreener</a>` : ''}
      <a href="${data.explorerTxUrl || config.explorer + '/tx/' + liq.txHash}" target="_blank" rel="noopener">View TX</a>
    </p>`;
  el.classList.remove('hidden');
}

async function renderMarkets() {
  const grid = document.getElementById('markets-dex-grid');
  if (grid) {
    const reg = dexRegistry || await loadDexRegistry();
    const chains = reg?.chains || {};
    grid.innerHTML = Object.entries(chains).map(([id, c]) => {
      const dexes = (c.dexes || []).map(d => `${d.name}`).join(', ');
      return `<div class="token-card"><h3>${esc(c.name)}</h3><p class="token-meta">${esc(dexes)}</p></div>`;
    }).join('') || '<p class="status-msg">No DEX registry.</p>';
  }
  const book = await fetchFlashMirror({ reload: true }).catch(() => ({}));
  const addr = book.canonicalAddress || '0x8944A53814b99E14c7BAE33814548a1F32bDCA8b';
  const tok = document.getElementById('markets-token');
  const name = document.getElementById('markets-name');
  const sym = document.getElementById('markets-symbol');
  if (tok && !tok.value) tok.value = addr;
  if (name && !name.value) name.value = book.name || 'Flash Coin';
  if (sym && !sym.value) sym.value = book.symbol || 'wFLASH';
}

async function runMarketsBridge() {
  const el = document.getElementById('markets-result');
  const chain = document.getElementById('markets-chain')?.value || 'bsc';
  const token = document.getElementById('markets-token')?.value?.trim();
  const name = document.getElementById('markets-name')?.value?.trim();
  const symbol = document.getElementById('markets-symbol')?.value?.trim();
  if (!token) {
    if (el) el.innerHTML = '<p class="status-msg error">Enter token address</p>';
    return;
  }
  if (el) el.innerHTML = '<p class="status-msg">Building listing bridge…</p>';
  const data = await api('/api/listings/bridge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chainSlug: chain, tokenAddress: token, name, symbol, save: true }),
  });
  if (data.error) {
    if (el) el.innerHTML = `<p class="status-msg error">${esc(data.error)}</p>`;
    return;
  }
  const providers = (data.providers || []).map(p =>
    `<div class="token-card"><h3>${esc(p.name)} <span class="badge">${esc(p.status)}</span></h3>
     <p class="token-meta">Score ${data.readiness?.score || 0} · ${esc((data.readiness?.missing || []).join(', '))}</p>
     <div class="token-links"><a href="${esc(p.submitUrl)}" target="_blank" rel="noopener">Submit</a></div></div>`
  ).join('');
  if (el) el.innerHTML = `
    <div class="flash-mirror-meta">Readiness ${data.readiness?.ready ? '<span class="badge live">READY</span>' : '<span class="badge predicted">PENDING</span>'} · Liq ${fmtUsd(data.readiness?.liquidityUsd || 0)}</div>
    ${providers}`;
}

async function runFlashMarketsBridge() {
  const el = document.getElementById('markets-result');
  if (el) el.innerHTML = '<p class="status-msg">Loading Flash Coin 7-chain bridge…</p>';
  const data = await api('/api/listings/flash').catch(() => ({}));
  if (!data.chains?.length) {
    if (el) el.innerHTML = '<p class="status-msg error">No flash mirror data</p>';
    return;
  }
  if (el) el.innerHTML = data.chains.map(c => `
    <div class="token-card">
      <h3>${esc(c.chainName)} <span class="badge ${c.listing?.readiness?.ready ? 'live' : 'predicted'}">${c.listing?.readiness?.ready ? 'Ready' : 'Pending'}</span></h3>
      <p class="token-meta mono">${esc(c.address)}</p>
      <p class="token-meta">Transfer: ${c.listing?.readiness ? (c.listing.readiness.transferable !== false ? 'YES' : 'NO') : '—'} · Score ${c.listing?.readiness?.score || 0}</p>
      <div class="token-links"><a href="${esc(c.listing?.explorerTokenUrl || '')}" target="_blank" rel="noopener">Explorer</a></div>
    </div>`).join('');
}

async function fillLiquidityTokens() {
  const sel = document.getElementById('liq-token');
  const addrEl = document.getElementById('liq-token-addr');
  if (!sel) return;
  const list = await api('/api/tokens');
  if (!Array.isArray(list) || !list.length) {
    sel.innerHTML = '<option value="">Deploy a token first</option>';
    return;
  }
  sel.innerHTML = '<option value="">Select launched token…</option>' +
    list.map(t => `<option value="${t.contractAddress}">${t.symbol} — ${t.name}</option>`).join('');
  const flash = list.find(t => t.deployMethod === 'mirror' || (t.symbol || '').toLowerCase() === 'wflash');
  if (flash) {
    sel.value = flash.contractAddress;
    if (addrEl && !addrEl.value.trim()) addrEl.value = flash.contractAddress;
  }
}

async function checkPair() {
  const info = document.getElementById('liq-pair-info');
  const token = getLiqTokenAddr();
  const quote = document.getElementById('liq-quote')?.value || 'usdt';
  const chain = getLiqChainSlug();
  const dex = getLiqDexId();
  if (!token || !info) return;
  const pair = await api(`/api/liquidity/pair?token=${encodeURIComponent(token)}&quote=${quote}&chain=${chain}&dex=${dex}`);
  if (pair.exists) {
    const url = pair.dexUrl || pair.liquidityUrl || '#';
    info.innerHTML = `Pool exists: <a href="${url}" target="_blank" rel="noopener">${shortAddr(pair.pairAddress)}</a>`;
    info.className = 'status-msg ok';
  } else if (pair.liquidityMode === 'link-only') {
    info.innerHTML = `No pool — <a href="${pair.liquidityUrl}" target="_blank" rel="noopener">Open ${esc(pair.dexName || 'DEX')} UI</a>`;
    info.className = 'status-msg';
  } else {
    info.textContent = `No pool yet — creates new ${pair.dexName || 'V2'} pair on ${chain}.`;
    info.className = 'status-msg';
  }
}

async function renderLiquidityHistory() {
  const el = document.getElementById('liq-history');
  if (!el) return;
  const list = await api('/api/liquidity');
  if (!Array.isArray(list) || !list.length) {
    el.innerHTML = '<p class="status-msg">No pools yet.</p>';
    return;
  }
  el.innerHTML = list.map(l => {
    const exp = explorerForChainSlug(l.chainSlug || 'bsc');
    const chainLabel = (l.chainSlug || 'bsc').toUpperCase();
    const payload = encodeURIComponent(JSON.stringify(l));
    return `
    <div class="token-card">
      <strong>${shortAddr(l.tokenAddress)} / ${(l.quoteId || 'bnb').toUpperCase()}</strong>
      <p class="status-msg">${chainLabel} · ${esc(l.dexId || 'dex')} · ${l.tokenAmount} tokens + ${l.quoteAmount} ${(l.quoteId || 'bnb').toUpperCase()}</p>
      <div class="token-links">
        ${l.txHash ? `<a href="${exp}/tx/${l.txHash}" target="_blank" rel="noopener">TX</a>` : ''}
        ${l.pairAddress ? `<a href="${exp}/address/${l.pairAddress}" target="_blank" rel="noopener">Pair</a>` : ''}
        <button type="button" class="btn btn-ghost btn-sm btn-copy-liq-card" data-liq="${payload}">Copy params</button>
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('.btn-copy-liq-card').forEach(btn => {
    btn.addEventListener('click', () => {
      try {
        const l = JSON.parse(decodeURIComponent(btn.getAttribute('data-liq')));
        const text = [
          'OneX Liquidity',
          `Chain: ${l.chainSlug || 'bsc'}`,
          `DEX: ${l.dexId || 'pancake-v2'}`,
          `Token: ${l.tokenAddress}`,
          `Token amount: ${l.tokenAmount}`,
          `Quote: ${l.quoteId || 'bnb'} ${l.quoteAmount}`,
          `Pair: ${l.pairAddress || '—'}`,
          `TX: ${l.txHash || '—'}`,
        ].join('\n');
        copyText(text, btn, 'Copied');
      } catch (_) { /* ignore */ }
    });
  });
}

async function copyLiquidityParams() {
  const btn = document.getElementById('btn-copy-liquidity');
  const token = getLiqTokenAddr();
  const tokenAmt = document.getElementById('liq-token-amount')?.value || '1000000000';
  const quoteAmt = document.getElementById('liq-quote-amount')?.value || tokenAmt;
  const chain = getLiqChainSlug();
  const data = await api('/api/liquidity/copy?chain=' + encodeURIComponent(chain) +
    '&token=' + encodeURIComponent(token) +
    '&tokenAmount=' + encodeURIComponent(tokenAmt) +
    '&quoteAmount=' + encodeURIComponent(quoteAmt));
  if (data.error) {
    setMsg(document.getElementById('liq-msg'), data.error, 'error');
    return;
  }
  await copyText(data.copyText || JSON.stringify(data, null, 2), btn, 'Copied');
  setMsg(document.getElementById('liq-msg'), 'Liquidity params copied to clipboard.', 'ok');
}

async function fixAllPending() {
  const el = document.getElementById('flash-mirror-list');
  const btn = document.getElementById('btn-fix-pending');
  if (btn) btn.disabled = true;
  if (el) el.innerHTML = '<p class="status-msg">Fixing pending — registering Flash Coin, reloading mirrors…</p>';
  try {
    const res = await api('/api/fix-pending?reload=1', { method: 'POST' });
    if (res.error) throw new Error(res.error);
    const book = await fetchFlashMirror(false);
    if (el) {
      el.innerHTML = flashMirrorCardHTML(book, false);
      wireFlashCopyButtons(el);
    }
    await fillLiquidityTokens();
    const addr = res.canonicalAddress || res.flashCoinAddress;
    if (res.pendingChains > 0 && addr) {
      presetBscscan1BUsdt(addr);
      setMsg(document.getElementById('liq-msg'),
        `${res.pendingChains} chain(s) still need on-chain deploy — add BSC liquidity via MetaMask to activate mirrors.`,
        '');
    }
    setGlobalStatus(`Pending fix: ${res.liveChains || 0} live · ${res.pendingChains || 0} pending`,
      res.pendingChains ? '' : 'ok');
  } catch (err) {
    if (el) el.innerHTML = `<p class="status-msg error">${esc(err.message || String(err))}</p>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleLiquidity(e) {
  e.preventDefault();
  const msg = document.getElementById('liq-msg');
  document.getElementById('liq-result').classList.add('hidden');
  const btn = document.getElementById('btn-add-liquidity');
  btn.disabled = true;
  try {
    const data = await addLiquidityMetaMask();
    setMsg(msg, 'Liquidity added on PancakeSwap.', 'ok');
    showLiquidityResult(data);
    renderLiquidityHistory();
  } catch (err) {
    setMsg(msg, err.message || String(err), 'error');
  } finally {
    btn.disabled = false;
  }
}

function updateQuoteLabel() {
  const quote = document.getElementById('liq-quote')?.value || 'bnb';
  const label = document.getElementById('liq-quote-label');
  if (label) label.textContent = (quote === 'usdt' ? 'USDT' : 'BNB') + ' amount';
  checkPair();
}

async function handleDeploy(e) {
  if (e) e.preventDefault();
  if (wizardStep !== 4) return;
  const msg = document.getElementById('create-msg');
  document.getElementById('deploy-result').classList.add('hidden');
  const method = document.getElementById('deploy-method').value;
  const btn = document.getElementById('btn-deploy');
  const err = validateStep1();
  if (err) {
    setMsg(msg, err, 'error');
    return;
  }
  if (method === 'metamask' && !signer) {
    try { await connectWallet(); } catch (ex) {
      setMsg(msg, ex.message || 'Connect MetaMask first', 'error');
      return;
    }
  }
  btn.disabled = true;
  try {
    let data;
    if (method === 'metamask') {
      data = await deployMetaMask();
    } else {
      data = await deployBackend();
    }
    setMsg(msg, `Deployed on ${getSelectedChain().name}.`, 'ok');
    showDeployResult(data);
  } catch (err2) {
    const detail = err2.shortMessage || err2.reason || err2.message || String(err2);
    setMsg(msg, detail, 'error');
    setGlobalStatus(detail, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function enrichToken(token) {
  const addr = token.contractAddress;
  const q = chainQuery(token);
  const [bscscan, price] = await Promise.all([
    api('/api/bscscan/' + addr + q).catch(() => ({})),
    api('/api/price/' + addr + q).catch(() => ({})),
  ]);
  return { token, bscscan, price };
}

async function fetchFlashMirror(opts) {
  const o = typeof opts === 'object' ? opts : { verify: !!opts };
  const params = new URLSearchParams();
  if (o.verify) params.set('verify', '1');
  if (o.reload) params.set('reload', '1');
  const q = params.toString() ? '?' + params.toString() : '';
  return api('/api/flash-mirror' + q).catch(() => ({}));
}

function fmtXfer(dep) {
  return dep.transferable ? '<span class="badge live">YES</span>' : '<span class="badge predicted">NO</span>';
}

function fmtMirrorVal(v) {
  if (v === null || v === undefined || v === '') return '—';
  return esc(String(v));
}

function fmtMirrorPrice(dep) {
  if (dep.priceUsd > 0) return fmtUsd(dep.priceUsd);
  if (dep.impliedPriceUsd > 0) return `${fmtUsd(dep.impliedPriceUsd)} <span class="badge predicted">target</span>`;
  return '—';
}

function fmtMirrorMcap(dep) {
  const onChain = dep.onChainMarketCapUsd || (dep.priceUsd > 0 ? dep.marketCapUsd : 0);
  if (onChain > 0) return `${fmtUsd(onChain)} <span class="badge live">on-chain</span>`;
  if (dep.impliedMarketCapUsd > 0) return `${fmtUsd(dep.impliedMarketCapUsd)} <span class="badge predicted">implied</span>`;
  if (dep.marketCapUsd > 0) return fmtUsd(dep.marketCapUsd);
  return '—';
}

function pickMarketDep(list) {
  return list.find(d => d.chainId === 'bsc')
    || list.find(d => d.priceUsd > 0 || d.liquidityUsd > 0)
    || list[0];
}

function mirrorMarketStrip(book) {
  const list = book.deployments || [];
  const dep = pickMarketDep(list);
  if (!dep) return '';
  const chain = dep.chainName || dep.chainId || 'BSC';
  return `
    <div class="flash-market-strip">
      <div class="flash-market-item"><span>Market price</span><strong>${fmtMirrorPrice(dep)}</strong></div>
      <div class="flash-market-item"><span>On-chain cap</span><strong>${fmtMirrorMcap(dep)}</strong></div>
      <div class="flash-market-item"><span>Liquidity</span><strong>${fmtMirrorUsd(dep.liquidityUsd)}</strong></div>
      <div class="flash-market-item"><span>Holders</span><strong>${dep.holders > 0 ? dep.holders : '—'}</strong></div>
      <div class="flash-market-item"><span>Chain</span><strong>${esc(chain)}</strong></div>
      ${!dep.hasLiquidity && dep.impliedMarketCapUsd > 0 ? '<p class="flash-market-note">Implied cap = supply × $1 listing target. Add liquidity on BSC for live DexScreener / BSCScan values.</p>' : ''}
    </div>`;
}

function fmtMirrorUsd(v) {
  return v > 0 ? fmtUsd(v) : '—';
}

function mirrorTxLink(dep) {
  const exp = (dep.explorer || '').replace(/\/$/, '');
  if (!dep.txHash || !exp) return '—';
  const url = `${exp}/tx/${dep.txHash}`;
  return `<a href="${url}" target="_blank" rel="noopener" class="mono">${esc(shortAddr(dep.txHash))}</a>`;
}

function mirrorPairLink(dep) {
  const exp = (dep.explorer || '').replace(/\/$/, '');
  if (!dep.pairAddress || !exp) return fmtMirrorVal(dep.pairAddress);
  return `<a href="${exp}/address/${dep.pairAddress}" target="_blank" rel="noopener" class="mono">${esc(shortAddr(dep.pairAddress))}</a>`;
}

function mirrorDetailGrid(dep, book) {
  const addr = dep.contractAddress || dep.predictedAddress || book.canonicalAddress || '';
  const exp = (dep.explorer || '').replace(/\/$/, '');
  const fields = [
    ['Chain ID', dep.chainId],
    ['Token name', dep.tokenName || book.name],
    ['Symbol', dep.symbol || book.symbol],
    ['Standard', dep.tokenStandard || 'real-token'],
    ['Decimals', dep.decimals ?? book.decimals ?? 8],
    ['Contract', addr],
    ['Predicted', dep.predictedAddress || addr],
    ['Supply (human)', dep.totalSupplyHuman || dep.supplyHuman || dep.wrapAmountHuman || book.wrapAmountPerChain],
    ['Supply (raw)', dep.totalSupply || '—'],
    ['Wrap / chain', dep.wrapAmountHuman || book.wrapAmountPerChain || '1000000000'],
    ['Owner', dep.ownerAddress || '—'],
    ['Owner balance (raw)', dep.ownerBalance || '—'],
    ['Owner balance', dep.ownerBalanceHuman || '—'],
    ['Transferable', dep.transferable ? 'YES' : 'NO'],
    ['Price USD', dep.priceUsd > 0 ? fmtUsd(dep.priceUsd) : (dep.impliedPriceUsd > 0 ? fmtUsd(dep.impliedPriceUsd) + ' (target)' : '—')],
    ['On-chain cap', dep.onChainMarketCapUsd > 0 ? fmtUsd(dep.onChainMarketCapUsd) : '—'],
    ['Implied cap', dep.impliedMarketCapUsd > 0 ? fmtUsd(dep.impliedMarketCapUsd) : '—'],
    ['Market cap', dep.marketCapUsd > 0 ? fmtUsd(dep.marketCapUsd) : '—'],
    ['Liquidity USD', dep.liquidityUsd > 0 ? fmtUsd(dep.liquidityUsd) : '—'],
    ['Has liquidity', dep.hasLiquidity ? 'YES' : 'NO'],
    ['Holders', dep.holders > 0 ? String(dep.holders) : '—'],
    ['DEX', dep.dexId || '—'],
    ['Pair', dep.pairAddress || '—'],
    ['Status', dep.status || 'predicted'],
    ['On-chain', dep.verifiedOnChain ? 'verified' : 'pending'],
    ['RPC', dep.rpc || '—'],
    ['Explorer', dep.explorerTokenUrl || (exp && addr ? `${exp}/token/${addr}` : '—')],
    ['TX', dep.txHash || '—'],
    ['Deployed', dep.deployedAt || '—'],
  ];
  return `
    <div class="flash-detail-card">
      <h4>${esc(dep.chainName || dep.chainId)} <span class="flash-chain-status ${dep.verifiedOnChain ? 'live' : 'predicted'}">${dep.verifiedOnChain ? '● Live' : '○ Predicted'}</span></h4>
      <dl class="flash-detail-dl">
        ${fields.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="mono">${typeof v === 'string' && v.startsWith('http') ? `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v)}</a>` : esc(String(v ?? '—'))}</dd>`).join('')}
      </dl>
      ${addr ? `<button type="button" class="btn btn-outline btn-sm btn-copy-chain-addr" data-addr="${addr}">Copy contract</button>` : ''}
    </div>`;
}

function flashMirrorCardHTML(book, compact) {
  const list = book.deployments || [];
  if (!list.length) {
    return '<p class="flash-mirror-empty">No mirror data. Run <code>onex flash-coin-mirror</code>.</p>';
  }
  const canonical = book.canonicalAddress || list[0]?.contractAddress || '';
  const liveCount = list.filter(d => d.status === 'live' || d.verifiedOnChain).length;
  const allLive = liveCount === list.length;
  const statusBadge = allLive
    ? '<span class="badge live">All live</span>'
    : liveCount > 0
      ? `<span class="badge predicted">${liveCount}/${list.length} live</span>`
      : '<span class="badge predicted">Pending deploy</span>';

  if (compact) {
    return `
      <div class="flash-summary-compact">
        <div class="flash-summary-row">
          ${statusBadge}
          <span class="badge same">${esc(book.symbol || 'wFLASH')}</span>
          <span class="flash-summary-meta">${list.length} chains · ${liveCount} on-chain</span>
        </div>
        ${canonical ? `<code class="mono flash-summary-addr">${esc(canonical)}</code>` : ''}
      </div>`;
  }

  const rows = list.map((dep, i) => {
    const live = dep.status === 'live' || dep.verifiedOnChain;
    const addr = dep.contractAddress || dep.predictedAddress || book.canonicalAddress || '';
    const exp = (dep.explorer || '').replace(/\/$/, '');
    const tokenUrl = dep.explorerTokenUrl || (exp && addr ? `${exp}/token/${addr}` : '');
    const supply = dep.totalSupplyHuman || dep.supplyHuman || dep.wrapAmountHuman || book.wrapAmountPerChain || '1000000000';
    const supplyRaw = dep.totalSupply || '—';
    const ownerBal = dep.ownerBalanceHuman || dep.ownerBalance || '—';
    const owner = dep.ownerAddress ? shortAddr(dep.ownerAddress) : '—';
    const price = fmtMirrorPrice(dep);
    const mcap = fmtMirrorMcap(dep);
    const liq = fmtMirrorUsd(dep.liquidityUsd);
    const holders = dep.holders > 0 ? String(dep.holders) : '—';
    const dex = dep.dexId || '—';
    const deployed = dep.deployedAt ? dep.deployedAt.slice(0, 10) : '—';
    const links = [
      tokenUrl ? `<a href="${tokenUrl}" target="_blank" rel="noopener">Explorer</a>` : '',
    ].filter(Boolean).join(' · ') || '—';
    return `
      <tr class="flash-row-main" data-chain-idx="${i}">
        <td class="flash-chain-name">${esc(dep.chainName || dep.chainId)}</td>
        <td><span class="flash-chain-status ${live ? 'live' : 'predicted'}">${live ? '● Live' : '○ Pending'}</span></td>
        <td class="flash-addr-cell">
          <code class="mono flash-full-addr">${esc(addr)}</code>
          ${addr ? `<button type="button" class="btn btn-ghost btn-sm btn-copy-row-addr" data-addr="${esc(addr)}" title="Copy contract address">Copy</button>` : ''}
        </td>
        <td>${esc(String(dep.decimals ?? book.decimals ?? 8))}</td>
        <td>${esc(supply)}</td>
        <td class="mono flash-raw">${fmtMirrorVal(supplyRaw)}</td>
        <td class="mono">${esc(owner)}</td>
        <td class="mono">${fmtMirrorVal(ownerBal)}</td>
        <td>${price}</td>
        <td>${mcap}</td>
        <td>${liq}</td>
        <td>${holders}</td>
        <td>${esc(dex)}</td>
        <td>${mirrorPairLink(dep)}</td>
        <td>${mirrorTxLink(dep)}</td>
        <td>${fmtMirrorVal(deployed)}</td>
        <td>${fmtXfer(dep)}</td>
        <td class="token-links">${links}</td>
      </tr>`;
  }).join('');

  const detailGrid = list.map(dep => mirrorDetailGrid(dep, book)).join('');

  const pendingCount = list.length - liveCount;
  const pendingBanner = pendingCount > 0 ? `
    <div class="flash-pending-banner status-msg">
      ${pendingCount} chain(s) pending on-chain verification.
      <button type="button" class="btn btn-primary btn-sm" id="btn-fix-pending-inline">Fix all pending</button>
      <button type="button" class="btn btn-outline btn-sm" id="btn-copy-liq-inline">Copy BSC liquidity</button>
    </div>` : '';

  const poolMode = config?.poolLiveMode || 'metamask';
  const deployer = config?.deployerAddress || '';
  const footMsg = poolMode === 'metamask'
    ? `Pending chains need on-chain deploy + liquidity. Use <strong>Fix all pending</strong>, then add pool on BSC via MetaMask${deployer ? ` (<code>${esc(shortAddr(deployer))}</code>)` : ''}.`
    : 'Live deploy: set <code>FLASH_DEPLOYER_PRIVATE_KEY</code> in <code>bsc-launcher/.env</code>, then run <code>scripts/make-pool-live.ps1</code>';

  const metaRow = `
    <div class="flash-mirror-meta">
      <span>Origin <strong>${esc(book.originToken || 'FLASH')}</strong> · ${esc(book.originSupplyHuman || '1000000000')} supply</span>
      <span>Wrap <strong>${esc(book.wrapAmountPerChain || '1000000000')}</strong> / chain</span>
      <span>Decimals <strong>${esc(String(book.decimals ?? 8))}</strong></span>
      <span>Standard <strong>${esc(depTokenStandard(book))}</strong></span>
      ${book.payloadReloaded ? '<span class="badge live">Payload reloaded</span>' : ''}
    </div>`;

  return `
    <div class="flash-mirror-card">
      <div class="flash-mirror-hero">
        <div class="flash-mirror-brand">
          <h3>${esc(book.name || 'Flash Coin')} ${statusBadge}</h3>
          <p>${esc(book.originToken || 'FLASH')} on OneX → ${list.length} EVM chains · ${esc(book.mirrorMode || 'create2-same-address')}</p>
        </div>
        <div class="flash-mirror-stats">
          <div class="stat"><strong>${list.length}</strong><span>Chains</span></div>
          <div class="stat"><strong>${liveCount}</strong><span>On-chain</span></div>
          <div class="stat"><strong>${list.filter(d => d.transferable).length}</strong><span>Transferable</span></div>
        </div>
      </div>
      ${mirrorMarketStrip(book)}
      ${pendingBanner}
      ${metaRow}
      ${canonical ? `
      <div class="flash-mirror-address" id="mirror-contract-address">
        <label>Contract address (all 7 chains)</label>
        <div class="flash-mirror-address-row">
          <code class="mono" id="flash-canonical-addr">${esc(canonical)}</code>
          <button type="button" class="btn btn-outline btn-sm btn-copy-flash-addr">Copy address</button>
          <a class="btn btn-ghost btn-sm" href="https://bscscan.com/token/${esc(canonical)}" target="_blank" rel="noopener">BSCScan</a>
        </div>
      </div>` : ''}
      <div class="flash-mirror-table-wrap">
        <table class="flash-mirror-table flash-mirror-table-full">
          <thead><tr>
            <th>Chain</th><th>Status</th><th>Contract</th><th>Dec</th>
            <th>Supply</th><th>Supply raw</th><th>Owner</th><th>Owner bal</th>
            <th>Price</th><th>Mkt cap</th><th>Liquidity</th><th>Holders</th><th>DEX</th><th>Pair</th><th>TX</th><th>Deployed</th><th>Xfer</th><th>Links</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="flash-detail-grid">
        <h4 class="flash-detail-grid-title">Full contract details (all chains)</h4>
        ${detailGrid}
      </div>
      <div class="flash-mirror-foot">${footMsg}</div>
    </div>`;
}

function wireFlashCopyButtons(root) {
  root?.querySelectorAll('.btn-copy-flash-addr').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = root.querySelector('#flash-canonical-addr')?.textContent?.trim();
      if (!code) return;
      copyText(code, btn, 'Copied');
    });
  });
  root?.querySelectorAll('.btn-copy-row-addr').forEach(btn => {
    btn.addEventListener('click', () => {
      const addr = btn.getAttribute('data-addr');
      if (!addr) return;
      copyText(addr, btn, 'Copied');
    });
  });
  root?.querySelectorAll('.btn-copy-chain-addr').forEach(btn => {
    btn.addEventListener('click', () => {
      const addr = btn.getAttribute('data-addr');
      if (!addr) return;
      copyText(addr, btn, 'Copied');
    });
  });
  root?.querySelector('#btn-fix-pending-inline')?.addEventListener('click', fixAllPending);
  root?.querySelector('#btn-copy-liq-inline')?.addEventListener('click', async () => {
    presetBscscan1BUsdt();
    await copyLiquidityParams();
  });
}

async function renderFlashMirror(opts = {}) {
  const el = document.getElementById('flash-mirror-list');
  if (!el) return;
  const reload = !!opts.reload;
  const verify = !!opts.verify;
  el.innerHTML = reload || verify
    ? '<p class="status-msg">Reloading mirror contract addresses and on-chain details…</p>'
    : '<p class="status-msg">Loading mirror contract addresses…</p>';
  const book = await fetchFlashMirror(reload || verify ? { reload, verify } : false);
  el.innerHTML = flashMirrorCardHTML(book, false);
  wireFlashCopyButtons(el);
}

async function renderFlashMirrorSummary() {
  const el = document.getElementById('flash-mirror-summary');
  if (!el) return;
  const book = await fetchFlashMirror(false);
  el.innerHTML = flashMirrorCardHTML(book, true);
  const statChains = document.getElementById('stat-chains');
  const statLive = document.getElementById('stat-live');
  const list = book.deployments || [];
  const liveCount = list.filter(d => d.status === 'live' || d.verifiedOnChain).length;
  if (statChains) statChains.textContent = String(list.length || '—');
  if (statLive) statLive.textContent = String(liveCount);
  const tokenCount = document.getElementById('stat-tokens')?.textContent;
  const tokens = tokenCount && tokenCount !== '—' ? Number(tokenCount) : 0;
  updateTelemetryValues(list.length, liveCount, tokens);
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function depTokenStandard(book) {
  const d = (book.deployments || [])[0];
  return d?.tokenStandard || 'real-token';
}

async function renderDashboard() {
  await renderFlashMirrorSummary();
  const el = document.getElementById('token-list');
  const statTokens = document.getElementById('stat-tokens');
  const list = await api('/api/tokens');
  if (list.error) {
    el.innerHTML = `<p class="status-msg error">${list.error}</p>`;
    return;
  }
  if (statTokens) statTokens.textContent = String(list.length || 0);
  const chains = document.getElementById('stat-chains')?.textContent;
  const live = document.getElementById('stat-live')?.textContent;
  updateTelemetryValues(
    chains && chains !== '—' ? Number(chains) : 7,
    live && live !== '—' ? Number(live) : 0,
    list.length
  );
  if (!list.length) {
    el.innerHTML = '<p class="status-msg">No tokens yet. <a href="#" data-nav="generate">Create your first token</a>.</p>';
    el.querySelector('[data-nav]')?.addEventListener('click', (e) => { e.preventDefault(); showView('generate'); });
    return;
  }

  el.innerHTML = '<p class="status-msg">Loading on-chain data…</p>';
  const enriched = await Promise.all(list.map(enrichToken));
  el.innerHTML = enriched.map(({ token, bscscan, price }) => {
    const exp = explorerForToken(token);
    const tokenUrl = exp + '/token/' + token.contractAddress;
    const txUrl = exp + '/tx/' + token.txHash;
    const chainBadge = token.chainName || getChainMeta(token.chainSlug)?.name || 'EVM';
    const hasLiq = price && price.hasLiquidity;
    const nearOne = price?.priceUsd >= 0.95 && price?.priceUsd <= 1.05;
    const priceLabel = hasLiq ? (nearOne ? '<span class="price-tag">~$1</span>' : fmtUsd(price.priceUsd)) : '$0.00';
    return `
      <div class="token-card">
        <h3>${token.symbol} <span class="badge">${chainBadge}</span> <span class="badge">${token.deployMethod || 'metamask'}</span></h3>
        <p class="token-meta">${token.name} · supply ${token.supply}</p>
        <p class="token-meta">${token.contractAddress}</p>
        <div class="token-stats">
          <div class="stat"><strong>${priceLabel}</strong><span>Price</span></div>
          <div class="stat"><strong>${fmtPct(price?.priceChange24h)}</strong><span>24h</span></div>
          <div class="stat"><strong>${bscscan?.holders || '—'}</strong><span>Holders</span></div>
          <div class="stat"><strong>${price?.liquidityUsd ? fmtUsd(price.liquidityUsd) : '—'}</strong><span>Liquidity</span></div>
        </div>
        <div class="token-links">
          <a href="${tokenUrl}" target="_blank" rel="noopener">Explorer</a>
          <a href="${txUrl}" target="_blank" rel="noopener">TX</a>
          ${!hasLiq && (token.chainSlug === 'bsc' || !token.chainSlug) ? `<a href="#" class="link-liq" data-addr="${token.contractAddress}">Add liquidity</a>` : ''}
        </div>
      </div>`;
  }).join('');
  el.querySelectorAll('.link-liq').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      showView('liquidity');
      presetDollarListing(a.dataset.addr);
    });
  });
}

async function lookupAddress() {
  const input = document.getElementById('lookup-addr');
  const msg = document.getElementById('lookup-msg');
  const addr = (input.value || '').trim();
  if (!addr.startsWith('0x') || addr.length < 10) {
    setMsg(msg, 'Enter a valid BSC address (0x…)', 'error');
    return;
  }
  const chain = getSelectedChain().slug;
  setMsg(msg, 'Looking up on-chain…');
  const data = await api('/api/tokens/' + encodeURIComponent(addr) + (chain ? `?chain=${encodeURIComponent(chain)}` : ''));
  if (data.error) {
    setMsg(msg, data.error, 'error');
    return;
  }
  const info = data.bscscan || {};
  if (info.isWallet) {
    setMsg(msg, 'This is a wallet address, not a token contract.', 'error');
    return;
  }
  const price = data.price || {};
  setMsg(msg, `${info.symbol || info.tokenName || 'Token'} — ${fmtUsd(price.priceUsd || 0)}`, 'ok');
}

function resetWizard() {
  document.getElementById('wizard-form').reset();
  document.getElementById('token-decimals').value = '18';
  document.getElementById('chain-select').value = config?.chainSlug || 'bsc';
  updateChainBanner();
  document.querySelectorAll('.conditional').forEach(el => { el.disabled = true; });
  syncContractName();
  validated = false;
  setWizardStep(1);
  setMsg(document.getElementById('create-msg'), '', '');
  document.getElementById('deploy-result').classList.add('hidden');
}

function bindToggle(checkId, inputId) {
  const check = document.getElementById(checkId);
  const input = document.getElementById(inputId);
  if (!check || !input) return;
  check.addEventListener('change', () => {
    input.disabled = !check.checked;
    if (!check.checked) input.value = '';
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* Event bindings */
document.getElementById('nav-toggle')?.addEventListener('click', () => {
  const links = document.getElementById('mission-nav-links');
  setMissionNavOpen(!links?.classList.contains('open'));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeMissionNav();
});
document.querySelectorAll('[data-nav]').forEach(el => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    showView(el.dataset.nav);
  });
});

function startWizard(chainSlug) {
  showView('wizard');
  setWizardStep(1);
  if (chainSlug) {
    const sel = document.getElementById('chain-select');
    if (sel) sel.value = chainSlug;
    updateChainBanner();
  }
}

document.getElementById('btn-start-erc20')?.addEventListener('click', () => startWizard('bsc'));
document.getElementById('btn-start-spl')?.addEventListener('click', () => startWizard('spl'));
document.getElementById('btn-start-sui')?.addEventListener('click', () => startWizard('sui'));
document.getElementById('chain-select')?.addEventListener('change', updateChainBanner);

document.querySelectorAll('.step-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const step = parseInt(tab.dataset.step, 10);
    if (step > wizardStep && step > 1) {
      const err = validateStep1();
      if (err && wizardStep === 1) {
        setMsg(document.getElementById('create-msg'), err, 'error');
        return;
      }
    }
    setWizardStep(step);
  });
});

document.querySelectorAll('[data-next]').forEach(btn => {
  btn.addEventListener('click', () => {
    const next = parseInt(btn.dataset.next, 10);
    if (next > 1) {
      const err = validateStep1();
      if (err) {
        setMsg(document.getElementById('create-msg'), err, 'error');
        return;
      }
    }
    setWizardStep(next);
  });
});

document.querySelectorAll('[data-prev]').forEach(btn => {
  btn.addEventListener('click', () => setWizardStep(parseInt(btn.dataset.prev, 10)));
});

document.getElementById('btn-wizard-reset')?.addEventListener('click', resetWizard);
document.getElementById('btn-generate')?.addEventListener('click', generateTokenFields);
document.getElementById('btn-validate')?.addEventListener('click', validateConfiguration);
document.getElementById('wizard-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  if (wizardStep === 4) handleDeploy(e);
});
document.getElementById('btn-deploy')?.addEventListener('click', handleDeploy);
document.getElementById('btn-connect')?.addEventListener('click', connectWallet);
document.getElementById('btn-refresh')?.addEventListener('click', renderDashboard);
document.getElementById('btn-mirror-refresh')?.addEventListener('click', () => renderFlashMirror());
document.getElementById('btn-mirror-verify')?.addEventListener('click', async () => {
  const el = document.getElementById('flash-mirror-list');
  if (el) el.innerHTML = '<p class="status-msg">Verifying contracts on-chain (7 chains)…</p>';
  const book = await fetchFlashMirror({ verify: true, reload: true });
  if (el) {
    el.innerHTML = flashMirrorCardHTML(book, false);
    wireFlashCopyButtons(el);
  }
});
document.getElementById('btn-mirror-reload')?.addEventListener('click', () => renderFlashMirror({ reload: true, verify: true }));
document.getElementById('btn-fix-pending')?.addEventListener('click', fixAllPending);
document.getElementById('btn-copy-liquidity')?.addEventListener('click', copyLiquidityParams);
document.getElementById('btn-lookup')?.addEventListener('click', lookupAddress);
document.getElementById('btn-settings')?.addEventListener('click', openSettings);
document.getElementById('btn-settings-save')?.addEventListener('click', saveSettings);
document.getElementById('btn-settings-close')?.addEventListener('click', closeSettings);
document.getElementById('btn-toggle-key')?.addEventListener('click', toggleApiKeyVisibility);
document.getElementById('liquidity-form')?.addEventListener('submit', handleLiquidity);
document.getElementById('liq-token')?.addEventListener('change', checkPair);
document.getElementById('liq-quote')?.addEventListener('change', () => { updateQuoteLabel(); calculateLiquidityQuote(); });
document.getElementById('liq-token-amount')?.addEventListener('input', debounce(calculateLiquidityQuote, 400));
document.getElementById('liq-target-usd')?.addEventListener('input', debounce(calculateLiquidityQuote, 400));
document.getElementById('btn-calc-dollar')?.addEventListener('click', () => {
  document.getElementById('liq-target-usd').value = '1';
  document.getElementById('liq-quote').value = 'usdt';
  updateQuoteLabel();
  calculateLiquidityQuote();
});
document.getElementById('btn-bscscan-1b')?.addEventListener('click', () => presetBscscan1BUsdt());
document.getElementById('btn-markets-bridge')?.addEventListener('click', runMarketsBridge);
document.getElementById('btn-markets-refresh')?.addEventListener('click', runFlashMarketsBridge);
document.getElementById('liq-chain')?.addEventListener('change', () => { populateLiqDexes(); });
document.getElementById('liq-dex')?.addEventListener('change', refreshActiveDex);
document.getElementById('liq-token-addr')?.addEventListener('input', debounce(checkPair, 400));
document.getElementById('liq-token')?.addEventListener('change', () => {
  const v = document.getElementById('liq-token')?.value;
  const addr = document.getElementById('liq-token-addr');
  if (addr && v) addr.value = v;
  checkPair();
});
document.getElementById('btn-open-dex')?.addEventListener('click', () => {
  if (activeDex?.liquidityUrl) window.open(activeDex.liquidityUrl, '_blank', 'noopener');
});

document.getElementById('token-name')?.addEventListener('input', syncContractName);
document.querySelectorAll('input[name="contract-name-mode"]').forEach(r => {
  r.addEventListener('change', syncContractName);
});

bindToggle('diff-recipient', 'recipient-addr');
bindToggle('diff-owner', 'owner-addr');
bindToggle('tax-liquidity', 'tax-liquidity-pct');
bindToggle('tax-dividend', 'tax-dividend-pct');
bindToggle('tax-burn', 'tax-burn-pct');

loadConfig()
  .then(() => {
    startMissionClock();
    initTelemetry();
    const n = (config.chains || []).filter(c => c.live).length;
    const prod = config.env === 'production';
    const keyOk = !config.apiKeyRequired || !!getApiKey();
    if (prod && !keyOk) {
      setGlobalStatus('AUTH REQUIRED — configure API key in settings', 'error');
    } else {
      setGlobalStatus(`SYS NOMINAL · ${n} chains · ${config.env || 'development'}`, 'ok');
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('preset') === 'bscscan1b' || params.get('view') === 'liquidity') {
      presetBscscan1BUsdt();
    } else {
      showView('landing');
    }
    api('/api/fix-pending').catch(() => {});
  })
  .catch(err => {
    setGlobalStatus(err.message || 'Failed to load', 'error');
    setMsg(document.getElementById('create-msg'), err.message, 'error');
    showView('landing');
  });
