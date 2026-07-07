(function () {
  const cfg = window.ONEX_SITE || {};
  const production = cfg.productionUrl || 'https://zblockchainsystem.com';
  const walletPath = cfg.walletPath || '/wallet/';
  const walletUrl = cfg.walletUrl || (production.replace(/\/$/, '') + walletPath);
  const consoleUrl = cfg.consoleUrl || cfg.missionControlUrl || (production.replace(/\/$/, '') + '/token-lab/');

  document.querySelectorAll('[data-wallet]').forEach(el => {
    el.href = walletUrl;
  });
  document.querySelectorAll('[data-explorer]').forEach(el => {
    el.href = production.replace(/\/$/, '') + '/explorer/';
  });
  document.querySelectorAll('[data-console]').forEach(el => {
    el.href = consoleUrl;
  });

  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');
  function setNavOpen(open) {
    if (!navToggle || !navLinks) return;
    navLinks.classList.toggle('open', open);
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.classList.toggle('nav-open', open);
  }
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => setNavOpen(!navLinks.classList.contains('open')));
    navLinks.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => setNavOpen(false));
    });
    document.addEventListener('click', e => {
      if (!navLinks.classList.contains('open')) return;
      const inner = navToggle.closest('.nav-inner');
      if (inner && !inner.contains(e.target)) setNavOpen(false);
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') setNavOpen(false);
    });
  }

  const toast = document.getElementById('toast');
  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  }

  document.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.dataset.copy;
      navigator.clipboard?.writeText(text).then(() => showToast('Copied to clipboard'));
    });
  });

  const form = document.getElementById('contact-form');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(form);
      const to = fd.get('department') || 'hello@zblockchainsystem.com';
      const subject = encodeURIComponent('[OneX] ' + (fd.get('subject') || 'Website inquiry'));
      const body = encodeURIComponent(
        'Name: ' + fd.get('name') + '\nEmail: ' + fd.get('email') + '\n\n' + fd.get('message')
      );
      window.location.href = 'mailto:' + to + '?subject=' + subject + '&body=' + body;
    });
  }

  function productionStatusCandidates() {
    const host = (location.hostname || '').toLowerCase();
    const urls = [];
    if (host === 'zblockchainsystem.com' || host === 'www.zblockchainsystem.com') {
      urls.push('/bridge/production/status');
    }
    urls.push(production.replace(/\/$/, '') + '/bridge/production/status');
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.github.io')) {
      urls.push('http://127.0.0.1:9338/bridge/production/status');
    }
    return [...new Set(urls)];
  }

  function fmtUsd(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function renderProductionStatus(j) {
    const panel = document.getElementById('production-status');
    const dot = document.getElementById('prod-status-dot');
    const title = document.getElementById('prod-status-title');
    const grid = document.getElementById('prod-status-grid');
    const heroBadge = document.getElementById('hero-badge');
    if (!panel || !grid) return;

    const live = j && j.production !== false && !j.error;
    const nodeOk = !!(j && j.nodeReady);
    const bankOk = !!(j && j.onlineBank && j.onlineBank.online);
    const hybxOk = !!(j && (j.hybx || j.hybrix) && (j.hybx?.enabled || j.hybrix?.enabled));
    const fineractOk = !!(j && j.fineract && j.fineract.online);

    if (dot) {
      dot.classList.remove('loading', 'live', 'degraded', 'offline');
      if (!j || j.error) dot.classList.add('offline');
      else if (live && nodeOk && bankOk) dot.classList.add('live');
      else if (live) dot.classList.add('degraded');
      else dot.classList.add('offline');
    }

    if (title) {
      if (!j || j.error) title.textContent = 'Production bridge unreachable';
      else if (live) title.textContent = (j.domain || 'zblockchainsystem.com') + ' · production live';
      else title.textContent = 'Bridge online · development mode';
    }

    if (heroBadge) {
      heroBadge.classList.toggle('offline', !live || !nodeOk);
    }
    if (j && j.error) {
      setText('hero-badge-text', 'Production bridge unreachable');
    } else if (live) {
      setText('hero-badge-text', (j.domain || 'zblockchainsystem.com') + ' · production live');
    } else if (j) {
      setText('hero-badge-text', 'Bridge online · development mode');
    }

    if (j && !j.error) {
      const tokens = j.platform?.totalTokens ?? j.platform?.tokens ?? '—';
      const cards = j.virtualCards?.active ?? j.virtualCards?.cards ?? 0;
      const hybxCards = j.virtualCards?.hybxCards ?? 0;
      setText('stat-chains', tokens !== '—' ? String(tokens) : '13+');
      setText('stat-node', nodeOk ? 'Online' : 'PoW');
      setText('stat-node-label', nodeOk ? 'Node online' : 'Ed25519 consensus');
      setText('stat-ledger', j.ledgerTotalUsd != null ? fmtUsd(j.ledgerTotalUsd) : 'ONEX');
      setText('stat-ledger-label', j.ledgerEntries != null ? j.ledgerEntries + ' ledger entries' : 'Real ledger');
      setText('stat-bank', bankOk ? 'Online' : 'NSB');
      setText('stat-bank-label', bankOk
        ? ((j.onlineBank?.accounts || 0) + ' accounts · ' + cards + ' cards (' + hybxCards + ' HYBX)')
        : 'Bank & cards');
    }

    if (!j || j.error) {
      grid.innerHTML = '<p style="margin:0;color:var(--text-muted);font-size:0.88rem">Could not reach the production bridge. Deploy the stack or open the wallet locally.</p>';
      return;
    }

    const rows = [
      ['Mode', j.mode || (j.production ? 'production' : 'development')],
      ['Node', nodeOk ? 'Online' : 'Offline'],
      ['Real ledger', j.ledgerTotalUsd != null ? fmtUsd(j.ledgerTotalUsd) : '—'],
      ['Platform tokens', j.platform?.totalTokens ?? '—'],
      ['Online bank', bankOk ? 'Online · ' + (j.onlineBank?.accounts || 0) + ' accounts' : 'Offline'],
      ['HYBX bridge', hybxOk ? 'Enabled' : 'Disabled'],
      ['HYBX middleware', (j.hybxMiddleware?.routes ?? 0) + ' routes · ' + (j.hybxMiddleware?.chains ?? 0) + ' chains'],
      ['Fineract core bank', fineractOk ? 'Online · ' + (j.fineract?.accounts || 0) + ' accounts' : (j.fineract?.enabled ? 'Configured' : 'Disabled')],
      ['Virtual cards', (j.virtualCards?.active ?? 0) + ' active · ' + (j.virtualCards?.hybxCards ?? 0) + ' HYBX'],
    ];

    grid.innerHTML = rows.map(([label, value]) =>
      `<div class="production-status-item"><span>${label}</span><strong>${value}</strong></div>`
    ).join('');
  }

  async function loadProductionStatus() {
    const candidates = productionStatusCandidates();
    document.querySelectorAll('[data-status-api]').forEach(el => {
      const href = candidates.find(u => u.startsWith('http')) || (production.replace(/\/$/, '') + '/bridge/production/status');
      el.href = href;
    });
    let lastErr = null;
    for (const url of candidates) {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' }, mode: 'cors' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        renderProductionStatus(await res.json());
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    renderProductionStatus({ error: String(lastErr?.message || lastErr || 'unreachable') });
  }

  if (document.getElementById('production-status')) {
    loadProductionStatus();
    setInterval(loadProductionStatus, 60000);
  }
})();
