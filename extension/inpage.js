(function () {
  if (window.onex) return;
  const listeners = new Map();
  let selectedAddress = null;

  function emit(event, data) {
    (listeners.get(event) || []).forEach((fn) => {
      try { fn(data); } catch (_) {}
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.target !== 'onex-inpage') return;
    const { type, payload, id } = event.data;
    if (type === 'accounts') {
      selectedAddress = payload[0] || null;
      emit('accountsChanged', payload);
    }
    if (type === 'rpcResult' && window.__onexPending && window.__onexPending[id]) {
      const { resolve, reject } = window.__onexPending[id];
      delete window.__onexPending[id];
      if (payload.error) reject(new Error(payload.error));
      else resolve(payload.result);
    }
  });

  const provider = {
    isOneX: true,
    isMetaMask: false,
    request({ method, params = [] }) {
      return new Promise((resolve, reject) => {
        const id = Math.random().toString(36).slice(2);
        window.__onexPending = window.__onexPending || {};
        window.__onexPending[id] = { resolve, reject };
        window.postMessage({ target: 'onex-content', type: 'rpc', id, method, params }, '*');
      });
    },
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
  };
  window.onex = provider;
})();
