// Bridge API + wallet base URL (GitHub Pages, mobile WebView, local bridge).
(function () {
  try {
    const legacyKeys = [
      ['SHIVA_BRIDGE_URL', 'ONEX_BRIDGE_URL'],
      ['SHIVA_FALLBACK', 'ONEX_FALLBACK'],
      ['shiva_wallet_url_override', 'onex_wallet_url_override'],
      ['shiva_balance_history', 'onex_balance_history'],
      ['shiva_dapp_connected', 'onex_dapp_connected'],
      ['shiva_theme', 'onex_theme'],
    ];
    for (const [oldKey, newKey] of legacyKeys) {
      const v = localStorage.getItem(oldKey);
      if (v && !localStorage.getItem(newKey)) localStorage.setItem(newKey, v);
    }
    if (window.__SHIVA_BRIDGE_DEPLOY__ && !window.__ONEX_BRIDGE_DEPLOY__) {
      window.__ONEX_BRIDGE_DEPLOY__ = window.__SHIVA_BRIDGE_DEPLOY__;
    }
    if (window.SHIVA_BRIDGE_URL && !window.ONEX_BRIDGE_URL) {
      window.ONEX_BRIDGE_URL = window.SHIVA_BRIDGE_URL;
    }
  } catch (_) {}

  const STORAGE_KEY = 'ONEX_BRIDGE_URL';
  // Set by GitHub Actions (ONEX_BRIDGE_PUBLIC_URL) or scripts/set-bridge-url.ps1
  window.__ONEX_BRIDGE_DEPLOY__ = window.__ONEX_BRIDGE_DEPLOY__ || '';
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get('bridge');
  if (fromQuery) {
    const u = fromQuery.trim().replace(/\/$/, '');
    try { localStorage.setItem(STORAGE_KEY, u); } catch (_) {}
    window.ONEX_BRIDGE_URL = u;
  } else {
    let stored = '';
    try { stored = localStorage.getItem(STORAGE_KEY) || ''; } catch (_) {}
    const deploy = (window.__ONEX_BRIDGE_DEPLOY__ || '').replace(/\/$/, '');
    window.ONEX_BRIDGE_URL = (stored || deploy || window.ONEX_BRIDGE_URL || '').replace(/\/$/, '');
  }

  // GitHub Pages static wallet → public bridge (override via ?bridge= or Settings).
  if (!window.ONEX_BRIDGE_URL) {
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') {
      window.ONEX_BRIDGE_URL = 'http://127.0.0.1:9338';
    } else if (location.pathname.startsWith('/wallet') || h === 'zblockchainsystem.com' || h === 'www.zblockchainsystem.com') {
      window.ONEX_BRIDGE_URL = location.origin;
    } else if (h.includes('github.io') || h.includes('git.anakatech.llc')) {
      window.ONEX_BRIDGE_URL = 'http://51.75.64.28:9338';
    }
  }

  const scripts = document.getElementsByTagName('script');
  for (let i = scripts.length - 1; i >= 0; i--) {
    const src = scripts[i].src;
    if (src && /\/config\.js(\?|$)/.test(src)) {
      window.ONEX_WALLET_BASE = new URL('./', src).href;
      break;
    }
  }
  if (!window.ONEX_WALLET_BASE) {
    window.ONEX_WALLET_BASE = location.href.replace(/[^/]*$/, '');
  }
})();
