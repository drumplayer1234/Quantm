import { h, duration } from '../dom.js';
import { button, link, go, toast } from '../ui.js';
import * as api from '../api.js';
import { motionAllowed } from '../audio-reactivity.js';
import { COMMANDS, WINDOWS, parseCommand, completeCommand, logLine, spectrumText } from './tmux-helpers.js';
import { renderWorkspace } from './tmux-workspace.js';

export function mount(ctx) {
  const { player, store } = ctx;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const logs = [];
  const workspaces = new Set();
  let alive = true;
  let previousFocus;
  let completions = [];
  let completionIndex = 0;
  let lastFrame = -Infinity;
  let cursorTime = 0;
  const now = h('span.tmux-status-title');
  const clock = h('span.tmux-clock');
  const state = h('span.tmux-state');
  const cursor = h('span.tmux-cursor', { 'aria-hidden': 'true' }, '█');
  const input = h('input.tmux-command', {
    type: 'text', 'aria-label': 'Terminal command. Tab completes; Escape closes; Enter runs.',
    placeholder: 'help · Tab completes · Esc closes', autocomplete: 'off', spellcheck: 'false'
  });
  const prompt = h('form.tmux-prompt', { hidden: true }, h('label', { for: 'tmux-command' }, ':'), input, cursor,
    button('Run', () => prompt.requestSubmit(), 'btn-outline'), button('Close', () => close(), 'btn-outline'));
  prompt.querySelectorAll('button').forEach(control => { control.type = 'button'; });
  input.id = 'tmux-command';
  const windows = h('nav.tmux-windows', { 'aria-label': 'Session windows' });
  WINDOWS.forEach((name, i) => windows.append(link(`#/${name}`, `${i}:${name}`)));
  const open = button('[quantm] :', () => show(), 'btn-outline');
  open.title = 'Command launcher (: or Ctrl+K)';
  const status = h('div.tmux-status', open, windows, now, clock, state);
  const shell = h('div.tmux-shell', status, prompt);
  document.body.append(shell);

  function write(message) {
    if (!alive) return;
    logs.push(logLine(message));
    if (logs.length > 50) logs.shift();
    workspaces.forEach(workspace => workspace.log(logs));
  }
  function fail(message) { write(`error: ${message}`); toast(message, 'error'); }
  function syncStatus() {
    now.textContent = player.current?.title || 'Choose a track · :help';
    now.title = now.textContent;
    clock.textContent = `${duration((player.audio.currentTime || 0) * 1000)} / ${duration((player.duration || 0) * 1000)}`;
    state.textContent = player.playing ? '▶ PLAY' : 'Ⅱ PAUSE';
    for (const a of windows.children) {
      const current = (location.hash.split('/')[1]?.split('?')[0] || 'home') === a.hash.slice(2);
      if (current) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }
  function syncMotion() {
    // Cursor opacity comes from the shared frame loop, so minimizing stops it too.
    cursor.style.opacity = '1';
    if (!motionAllowed(ctx.settings, reduced)) workspaces.forEach(w => w.spectrum(spectrumText()));
  }
  function show() {
    if (!prompt.hidden) { input.focus(); return; }
    previousFocus = document.activeElement;
    prompt.hidden = false;
    input.focus();
  }
  function close() {
    prompt.hidden = true;
    input.value = '';
    completions = [];
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  async function execute(value) {
    const { name, argument } = parseCommand(value);
    if (!name) return;
    write(`:${value}`);
    if (name === 'help') {
      write(`${COMMANDS.join(' · ')} | go ${WINDOWS.join('|')} | search <text>`);
      toast('Commands: play, pause, next, prev, like, go <page>, search <text>, shuffle likes. Tab completes; Esc closes.');
    } else if (['play', 'pause', 'next', 'prev'].includes(name) && !argument) {
      if (!player.current) { fail('Choose a track first.'); return; }
      await player[name]();
    } else if (name === 'like' && !argument) {
      if (!player.current) { fail('Choose a track first.'); return; }
      await store.toggleLike(player.current);
    } else if (name === 'go' && WINDOWS.includes(argument.toLowerCase())) go(`#/${argument.toLowerCase()}`);
    else if (name === 'search' && argument) go(`#/search?q=${encodeURIComponent(argument)}`);
    else if (name === 'shuffle' && argument.toLowerCase() === 'likes') {
      if (!store.me?.id) { fail('Sign in to load Likes.'); return; }
      const tracks = await api.myTrackLikes(store.me.id).next();
      if (!alive) return;
      if (!tracks.length) { fail('Your Likes are empty.'); return; }
      await player.shufflePlay(tracks, { label: 'Likes', href: '#/library/likes' });
    } else fail(`Unknown command: ${value}. Try help.`);
  }
  ctx.on(prompt, 'submit', e => {
    e.preventDefault();
    const value = input.value;
    close();
    execute(value).catch(error => { if (alive) fail(error.message || 'Command failed.'); });
  });
  ctx.on(input, 'input', () => { completions = []; });
  ctx.on(input, 'keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab' && !e.shiftKey) {
      if (!completions.length) { completions = completeCommand(input.value); completionIndex = 0; }
      if (completions.length) { e.preventDefault(); input.value = completions[completionIndex++ % completions.length]; }
    }
  });
  // Capture before the application's Ctrl+K search shortcut, and never claim ':' while typing.
  const shortcut = e => {
    const typing = e.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
    if ((e.key === ':' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
      e.preventDefault(); e.stopImmediatePropagation(); show();
    }
    if (e.key === 'Escape' && !prompt.hidden) { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  };
  document.addEventListener('keydown', shortcut, true);
  ctx.views.override('home', async () => ({ render(container) {
    const workspace = renderWorkspace(container, ctx, logs, write);
    workspaces.add(workspace);
    return () => { workspace.destroy(); workspaces.delete(workspace); };
  } }));
  ctx.on(ctx.moments, 'trackchange', ({ track }) => write(`track → ${track?.title || 'none'}`));
  ctx.on(ctx.moments, 'playstate', ({ playing }) => { write(playing ? 'transport → play' : 'transport → pause'); syncMotion(); });
  ctx.on(ctx.moments, 'like', ({ track, liked }) => write(`${liked ? 'liked' : 'unliked'} → ${track?.title || track?.id}`));
  ctx.on(ctx.moments, 'transition', ({ phase, from, to }) => write(`DJ ${phase} → ${from?.title || 'track'} / ${to?.title || 'track'}`));
  ['track', 'state', 'time'].forEach(event => ctx.on(player, event, syncStatus));
  ctx.on(document, 'routechange', syncStatus);
  ctx.on(store, 'settings', syncMotion);
  ctx.on(reduced, 'change', syncMotion);
  ctx.on(document, 'visibilitychange', syncMotion);
  ctx.on(document, 'appvisibility', syncMotion);
  ctx.frame(frame => {
    if (!motionAllowed(ctx.settings, reduced)) { syncMotion(); return; }
    if (!frame.playing || frame.time - lastFrame >= 70) {
      workspaces.forEach(w => w.spectrum(spectrumText(frame)));
      lastFrame = frame.time;
    }
    cursorTime += frame.dt;
    cursor.style.opacity = !frame.playing || Math.floor(cursorTime / 0.65) % 2 === 0 ? '1' : '0';
  });
  write('session attached · ↑/↓ select · Enter plays · :help · drag pane borders');
  syncStatus(); syncMotion();
  return () => {
    alive = false;
    document.removeEventListener('keydown', shortcut, true);
    workspaces.forEach(w => w.destroy());
    workspaces.clear();
    if (shell.contains(document.activeElement)) close();
    shell.remove();
  };
}
