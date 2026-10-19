import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { COMMANDS, WINDOWS, parseCommand, completeCommand, paneSize, logLine, spectrumText } from '../src/js/packs/tmux-helpers.js';
import { PACKS } from '../src/js/theme-packs.js';
import { installBrowser } from './helpers/browser.js';

test('tmux commands preserve search text and normalize command names', () => {
  assert.deepEqual(parseCommand('  SEARCH  jazz & soul  '), { name: 'search', argument: 'jazz & soul' });
  assert.deepEqual(parseCommand(''), { name: '', argument: '' });
  assert.deepEqual(parseCommand('shuffle likes'), { name: 'shuffle', argument: 'likes' });
});

test('completion offers command names and valid route destinations', () => {
  assert.deepEqual(completeCommand('p'), ['play', 'pause', 'prev']);
  assert.deepEqual(completeCommand('sh'), ['shuffle likes']);
  assert.deepEqual(completeCommand('go st'), ['go stats']);
  assert.deepEqual(completeCommand('go '), WINDOWS.map(name => `go ${name}`));
  assert.deepEqual(completeCommand(''), COMMANDS);
  assert.deepEqual(completeCommand('search some artist'), []);
  assert.deepEqual(completeCommand('invalid'), []);
});

test('pane sizes tolerate corrupted storage and clamp keyboard and pointer movement', () => {
  assert.equal(paneSize(null, 55), 55);
  assert.equal(paneSize('60'), 60);
  assert.equal(paneSize(NaN), 60);
  assert.equal(paneSize(Infinity), 60);
  assert.equal(paneSize(-100), 25);
  assert.equal(paneSize(120), 75);
  assert.equal(paneSize(48.5), 48.5);
});

test('event log timestamps are fixed width and track names cannot inject log lines', () => {
  assert.equal(logLine('track → song\nnew\r\nline\tend', new Date(2026, 0, 1, 2, 3, 4)), '02:03:04 │ track → song new line end');
});

test('spectrum is bounded, silent when stopped, and separates the three bands', () => {
  const zero = spectrumText();
  assert.equal(zero.includes('█'), false);
  assert.equal(zero.includes('▓'), false);
  assert.equal(spectrumText({ bass: 1, level: 1, playing: false }), zero);
  const bass = spectrumText({ bass: 1, mid: 0, treble: 0, level: 10, playing: true });
  const rows = bass.split('\n');
  assert.equal(rows.length, 8);
  assert.ok(rows.slice(0, 5).every(row => row.length === 24 && row.slice(8).trim() === ''));
  assert.ok(rows[7].includes('▓'.repeat(20)));
  assert.doesNotThrow(() => spectrumText({ bass: Infinity, mid: NaN, treble: -2, level: -1, playing: true }));
});

test('tmux registers its pack, palette, radius, and stylesheet link', async () => {
  installBrowser();
  const { PRESET_STYLES, PRESETS, PRESET_RADIUS, contrast } = await import('../src/js/theme.js');
  assert.equal(PACKS.tmux.layout, 'panes');
  assert.equal(PRESET_STYLES['Terminal Multiplexer'], 'tmux');
  assert.equal(PRESET_RADIUS['Terminal Multiplexer'], 0);
  const c = PRESETS['Terminal Multiplexer'];
  for (const bg of ['bg', 'surface', 'bar']) {
    for (const fg of ['text', 'muted', 'accent', 'wavePlayed']) assert.ok(contrast(c[fg], c[bg]) >= 4.5, `${fg} on ${bg}`);
  }
  assert.ok(contrast(c.accentText, c.accent) >= 4.5);
  assert.ok(existsSync(new URL('../src/styles/themes/tmux.css', import.meta.url)));
  const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  assert.match(html, /<link rel="stylesheet" href="styles\/themes\/listening-room.css">\s*<link rel="stylesheet" href="styles\/themes\/tmux.css">/);
  const terminal = readFileSync(new URL('../src/styles/themes/terminal.css', import.meta.url), 'utf8');
  assert.match(terminal, /:is\(html\[data-style="terminal"\], html\[data-style="tmux"\]\)/);
});
