import { h, clear, duration } from '../dom.js';
import { button } from '../ui.js';
import * as api from '../api.js';
import { paneSize, spectrumText } from './tmux-helpers.js';

export function renderWorkspace(container, ctx, logs, write) {
  const { player, store } = ctx;
  const off = [];
  let alive = true;
  let active = 'likes';
  let selected = 0;
  let request = 0;
  let sizes = { browser: 60, queue: 55 };
  try {
    const saved = JSON.parse(localStorage.getItem('quantm.tmux.panes'));
    sizes = { browser: paneSize(saved?.browser, 60), queue: paneSize(saved?.queue, 55) };
  } catch { /* Private storage and old values use the default split. */ }
  const listen = (target, event, fn) => {
    if (target.on) off.push(target.on(event, fn));
    else { target.addEventListener(event, fn); off.push(() => target.removeEventListener(event, fn)); }
  };
  const sources = {
    likes: { tracks: [], pager: store.me?.id ? api.myTrackLikes(store.me.id) : null },
    feed: { tracks: [], pager: api.stream() },
    history: { tracks: [], pager: api.myPlayHistory() }
  };
  const caption = h('p.tmux-hint', '↑/↓ select · Enter plays · Tab switches panes');
  const body = h('tbody');
  const table = h('table.tmux-table', { 'aria-label': 'Browser tracks. Up and Down select; Enter plays.' },
    h('thead', h('tr', ...['#', 'title', 'artist', 'time'].map(text => h('th', { scope: 'col' }, text)))), body);
  const message = h('p.tmux-message', { role: 'status' });
  const more = button('Load more', () => load(), 'btn-outline');
  const tabs = h('div.tmux-tabs', { role: 'group', 'aria-label': 'Browser source' });
  const tabButtons = {};
  for (const [key, label] of [['likes', 'likes'], ['feed', 'feed'], ['history', 'queue history']]) {
    tabButtons[key] = button(`[${label}]`, () => selectSource(key), 'btn-outline');
    tabButtons[key].setAttribute('aria-controls', 'tmux-browser-tracks');
    tabs.append(tabButtons[key]);
  }
  const browserScroll = h('div.tmux-scroll', { id: 'tmux-browser-tracks' }, table, message, more);
  const browser = pane('01', 'browser', tabs, caption, browserScroll);
  const queueList = h('div.tmux-scroll.tmux-queue-list');
  const queueCount = h('span.tmux-count');
  const queue = pane('02', 'queue', queueCount, queueList);
  const spectrum = h('pre.tmux-spectrum', { 'aria-hidden': 'true' }, spectrumText());
  const analyzer = pane('03', 'spectrum', h('p.tmux-hint', 'signal / bass · mid · treble'), spectrum);
  const right = h('div.tmux-right', queue);
  const grid = h('div.tmux-grid', browser);
  const vertical = divider('browser', grid, false);
  const horizontal = divider('queue', right, true);
  right.append(horizontal, analyzer);
  grid.append(vertical, right);
  const log = h('pre.tmux-log', { tabindex: '0', 'aria-label': 'Session event log, most recent 50 events' });
  const header = h('header.tmux-heading', h('h1', 'QUANTM / listening workstation'), h('span', 'session 0 · panes'));
  container.classList.add('tmux-workspace');
  container.append(header, grid, h('section.tmux-log-pane', h('h2', '04 ─ log'), log));
  function pane(index, name, ...children) {
    return h('section.tmux-pane', { 'aria-label': name }, h('h2', `${index} ─ ${name}`), ...children);
  }
  function saveSizes() {
    try { localStorage.setItem('quantm.tmux.panes', JSON.stringify(sizes)); } catch { /* Optional persistence. */ }
  }
  function applySizes() {
    grid.style.setProperty('--tmux-browser', `${sizes.browser}fr`);
    grid.style.setProperty('--tmux-rest', `${100 - sizes.browser}fr`);
    right.style.setProperty('--tmux-queue', `${sizes.queue}fr`);
    right.style.setProperty('--tmux-spectrum', `${100 - sizes.queue}fr`);
    vertical.setAttribute('aria-valuenow', String(Math.round(sizes.browser)));
    horizontal.setAttribute('aria-valuenow', String(Math.round(sizes.queue)));
  }
  function divider(key, parent, horizontal) {
    let dragging = null;
    const el = h('div.tmux-divider', {
      role: 'separator', tabindex: '0', 'aria-label': `Resize ${key} pane. Arrow keys resize. Home resets.`,
      'aria-orientation': horizontal ? 'horizontal' : 'vertical', 'aria-valuemin': '25', 'aria-valuemax': '75',
      title: 'Drag to resize · Arrow keys resize · Home resets'
    }, horizontal ? '─' : '│');
    const stacked = () => !horizontal && window.matchMedia('(max-width: 900px)').matches;
    const orient = () => el.setAttribute('aria-orientation', horizontal || stacked() ? 'horizontal' : 'vertical');
    listen(window, 'resize', orient);
    orient();
    listen(el, 'pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); el.focus();
      dragging = e.pointerId;
      el.setPointerCapture(e.pointerId);
    });
    listen(el, 'pointermove', e => {
      if (dragging !== e.pointerId) return;
      const bounds = parent.getBoundingClientRect();
      const y = horizontal || stacked();
      const length = y ? bounds.height : bounds.width;
      if (!length) return;
      sizes[key] = paneSize(((y ? e.clientY - bounds.top : e.clientX - bounds.left) / length) * 100);
      applySizes();
    });
    const end = () => { if (dragging !== null && el.hasPointerCapture(dragging)) el.releasePointerCapture(dragging); dragging = null; saveSizes(); };
    listen(el, 'pointerup', end);
    listen(el, 'pointercancel', end);
    listen(el, 'lostpointercapture', () => { dragging = null; saveSizes(); });
    off.push(() => { if (dragging !== null && el.hasPointerCapture(dragging)) el.releasePointerCapture(dragging); });
    listen(el, 'keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      sizes[key] = e.key === 'Home' ? (key === 'browser' ? 60 : 55) : paneSize(sizes[key] + (['ArrowLeft', 'ArrowUp'].includes(e.key) ? -2 : 2));
      applySizes(); saveSizes();
    });
    return el;
  }
  function tracks() { return sources[active].tracks; }
  function play(index) {
    const list = tracks();
    const href = active === 'history' ? '#/library/history' : active === 'likes' ? '#/library/likes' : '#/feed';
    Promise.resolve(player.playList(list, index, { label: active, href })).catch(error => { if (alive) write(`error: ${error.message}`); });
  }
  function selectRow(index, focus = true) {
    selected = Math.max(0, Math.min(tracks().length - 1, index));
    [...body.children].forEach((row, i) => {
      row.classList.toggle('selected', i === selected);
      row.querySelector('button').tabIndex = i === selected ? 0 : -1;
    });
    if (focus) body.children[selected]?.querySelector('button').focus();
  }
  function drawBrowser() {
    clear(body);
    tracks().forEach((track, index) => {
      const title = h('button.tmux-track-title', { title: `${track.title} · Enter to play`, onclick: () => { selectRow(index); play(index); }, onfocus: () => selectRow(index, false) }, track.title || 'Untitled');
      body.append(h('tr', h('td', String(index + 1).padStart(2, '0')), h('td', title), h('td', { title: track.user?.username || '' }, track.user?.username || 'Unknown'), h('td', duration(track.duration))));
    });
    selectRow(selected, false);
    message.textContent = tracks().length ? `${tracks().length} tracks loaded` : 'No tracks yet. Load more or choose another source.';
    more.disabled = !sources[active].pager || sources[active].pager.done;
    more.textContent = sources[active].pager?.done ? 'End of collection' : 'Load more';
  }
  async function load() {
    const key = active;
    const source = sources[key];
    if (!source.pager || source.pager.done || source.busy) return;
    source.busy = true;
    const version = ++request;
    more.disabled = true;
    message.textContent = 'Loading…';
    try {
      const batch = await source.pager.next();
      if (!alive) return;
      const items = key === 'feed' ? batch.map(item => item.track) : batch;
      const seen = new Set(source.tracks.map(t => t.id));
      items.filter(t => t?.id && t.kind !== 'playlist').forEach(t => { if (!seen.has(t.id)) { source.tracks.push(t); seen.add(t.id); } });
      source.loaded = true;
      if (active === key) drawBrowser();
    } catch (error) {
      if (alive && key === active && version === request) {
        message.textContent = `Could not load tracks: ${error.message || 'Try again.'}`;
        more.disabled = false;
        more.textContent = 'Retry';
      }
      if (alive) write(`error: ${key} could not load`);
    } finally { source.busy = false; }
  }
  function selectSource(key) {
    active = key; selected = 0;
    Object.entries(tabButtons).forEach(([name, tab]) => tab.setAttribute('aria-pressed', String(name === key)));
    drawBrowser();
    if (!sources[key].loaded) load();
  }
  listen(table, 'keydown', e => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    selectRow(e.key === 'Home' ? 0 : e.key === 'End' ? tracks().length - 1 : selected + (e.key === 'ArrowDown' ? 1 : -1));
  });
  function drawQueue() {
    const focused = queueList.contains(document.activeElement) ? Number(document.activeElement.dataset.index) : null;
    clear(queueList);
    const start = Math.max(0, player.index);
    queueCount.textContent = `${Math.max(0, player.queue.length - start - 1)} upcoming`;
    if (!player.queue.length) queueList.append(h('p.tmux-message', 'Queue empty. Select a browser track.'));
    player.queue.slice(start, start + 80).forEach((track, offset) => {
      const index = start + offset;
      const current = index === player.index;
      const row = h('button.tmux-queue-row', {
        dataset: { index }, 'aria-current': current ? 'true' : null,
        title: `${track.title} · Enter to jump`, onclick: () => player.jump(index)
      }, h('span', current ? '▶' : String(index + 1)), h('span', track.title), h('span', duration(track.duration)));
      row.classList.toggle('current', current);
      queueList.append(row);
    });
    if (player.queue.length - start > 80) queueList.append(h('p.tmux-hint', 'Next 80 shown · full queue in player bar'));
    if (focused !== null) (queueList.querySelector(`[data-index="${focused}"]`) || queueList.querySelector('button'))?.focus();
  }
  listen(queueList, 'keydown', e => {
    if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const rows = [...queueList.querySelectorAll('button')];
    const index = rows.indexOf(document.activeElement);
    rows[Math.max(0, Math.min(rows.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  });
  listen(player, 'queue', drawQueue);
  listen(player, 'track', drawQueue);
  function updateLog(lines) {
    const bottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
    log.textContent = lines.join('\n');
    if (bottom) log.scrollTop = log.scrollHeight;
  }
  applySizes(); selectSource('likes'); drawQueue(); updateLog(logs);
  return {
    log: updateLog,
    spectrum(text) { if (spectrum.textContent !== text) spectrum.textContent = text; },
    destroy() { if (!alive) return; alive = false; off.forEach(fn => fn()); container.classList.remove('tmux-workspace'); }
  };
}
