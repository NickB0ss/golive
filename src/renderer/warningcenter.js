'use strict';

// Controlador de DOM separado do registro: assim o app decide quando cada
// aviso existe e este modulo cuida apenas de como ele fica acessivel na barra.
(function (root) {
  const ICONS = {
    grave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 8.5l7 7m0-7l-7 7"/></svg>',
    atencao: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2.8 20.5h18.4L12 3Z"/><path d="M12 9v5m0 3h.01"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></svg>',
  };

  function create(doc) {
    const button = doc.getElementById('warn-center');
    const buttonIcon = doc.getElementById('warn-center-icon');
    const panel = doc.getElementById('warn-center-panel');
    const count = doc.getElementById('warn-center-count');
    const label = doc.getElementById('warn-center-label');
    const live = doc.getElementById('warn-center-live');
    const wrap = doc.getElementById('warn-center-wrap');
    let dismissHandler = null;
    let actionHandler = null;
    let pinned = false;
    let leaveTimer = null;
    let previousKeys = new Set();

    function setOpen(open) {
      panel.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
    }

    function openForHover() {
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => setOpen(true), 120);
    }

    function closeIfNotPinned() {
      clearTimeout(leaveTimer);
      if (!pinned) leaveTimer = setTimeout(() => setOpen(false), 120);
    }

    function itemKey(item) {
      return JSON.stringify([item.id, item.severidade, item.titulo, item.detalhe, item.rotuloCurto, item.acao]);
    }

    function icon(severidade) {
      const el = doc.createElement('span');
      el.className = `warn-center-icon warn-center-icon-${severidade}`;
      el.innerHTML = ICONS[severidade];
      return el;
    }

    function renderItem(item) {
      const entry = doc.createElement('article');
      entry.className = `warn-center-item warn-center-item-${item.severidade}`;
      entry.appendChild(icon(item.severidade));

      const body = doc.createElement('div');
      body.className = 'warn-center-item-body';
      const title = doc.createElement('strong');
      title.textContent = item.titulo;
      const detail = doc.createElement('p');
      detail.textContent = item.detalhe;
      body.append(title, detail);

      if (item.acao) {
        const action = doc.createElement('button');
        action.type = 'button';
        action.className = 'warn-center-action';
        action.textContent = item.acao.texto;
        action.addEventListener('click', (event) => {
          event.stopPropagation();
          actionHandler?.(item.id, item.acao.id);
        });
        body.appendChild(action);
      }
      entry.appendChild(body);

      if (item.dispensavel) {
        const dismiss = doc.createElement('button');
        dismiss.type = 'button';
        dismiss.className = 'warn-center-dismiss';
        dismiss.setAttribute('aria-label', `Dispensar ${item.titulo}`);
        dismiss.title = 'Dispensar aviso';
        dismiss.textContent = '×';
        dismiss.addEventListener('click', (event) => {
          event.stopPropagation();
          dismissHandler?.(item.id);
        });
        entry.appendChild(dismiss);
      }
      return entry;
    }

    function render(items, summary) {
      const hasWarnings = summary.total > 0;
      button.hidden = !hasWarnings;
      if (!hasWarnings) {
        pinned = false;
        setOpen(false);
      }
      button.classList.remove('warn-center-grave', 'warn-center-atencao', 'warn-center-info');
      if (summary.pior) button.classList.add(`warn-center-${summary.pior}`);
      buttonIcon.innerHTML = ICONS[summary.pior] || '';
      count.textContent = summary.total > 1 ? String(summary.total) : '';
      count.hidden = summary.total < 2;
      label.textContent = summary.pior === 'grave' ? (summary.rotuloCurto || '') : '';
      label.hidden = !label.textContent;
      button.setAttribute('aria-label', `${summary.total} ${summary.total === 1 ? 'aviso' : 'avisos'}`);

      panel.textContent = '';
      items.forEach((item) => panel.appendChild(renderItem(item)));

      const currentKeys = new Set(items.map(itemKey));
      const entered = items.filter((item) => !previousKeys.has(itemKey(item)));
      if (entered.length) live.textContent = `${entered.length} ${entered.length === 1 ? 'novo aviso' : 'novos avisos'}`;
      if (entered.some((item) => item.severidade === 'grave')) {
        button.classList.remove('warn-center-pulse');
        void button.offsetWidth;
        button.classList.add('warn-center-pulse');
      }
      previousKeys = currentKeys;
    }

    button.addEventListener('focus', () => setOpen(true));
    button.addEventListener('click', () => {
      pinned = !pinned;
      setOpen(pinned);
    });
    wrap.addEventListener('pointerenter', openForHover);
    wrap.addEventListener('pointerleave', closeIfNotPinned);
    wrap.addEventListener('focusout', () => {
      setTimeout(() => {
        if (!pinned && !wrap.contains(doc.activeElement)) setOpen(false);
      }, 0);
    });
    doc.addEventListener('mousedown', (event) => {
      if (pinned && !wrap.contains(event.target)) {
        pinned = false;
        setOpen(false);
      }
    });
    doc.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || panel.hidden) return;
      event.preventDefault();
      pinned = false;
      setOpen(false);
      button.focus();
    });

    return {
      render,
      onDismiss(handler) { dismissHandler = handler; },
      onAction(handler) { actionHandler = handler; },
    };
  }

  const api = { create };
  root.GoLive = root.GoLive || {};
  root.GoLive.warningcenter = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
