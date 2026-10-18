import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser } from './helpers/browser.js';

installBrowser();
const { hexToRgb, luminance, contrast, importTheme, exportTheme, DEFAULT_THEME } = await import('../src/js/theme.js');

test('hexToRgb supports full and short hex colors', () => {
  assert.deepEqual(hexToRgb('#ff5500'), [255, 85, 0]);
  assert.deepEqual(hexToRgb('#aBc'), [170, 187, 204]);
  assert.deepEqual(hexToRgb('123456'), [18, 52, 86]);
  assert.deepEqual(hexToRgb('#000000'), [0, 0, 0]);
});

test('luminance and contrast have known reference values', () => {
  assert.equal(luminance('#000000'), 0);
  assert.equal(luminance('#ffffff'), 1);
  assert.equal(luminance('#ff0000'), 0.2126);
  assert.ok(Math.abs(luminance('#808080') - 0.2158605) < 0.000001);
  assert.equal(contrast('#000000', '#ffffff'), 21);
  assert.equal(contrast('#ff5500', '#ff5500'), 1);
  assert.equal(contrast('#123456', '#abcdef'), contrast('#abcdef', '#123456'));
});

test('theme import/export preserves custom colors, radius and supported style', () => {
  const theme = { preset: 'Custom', colors: { ...DEFAULT_THEME.colors, accent: '#123abc' }, radius: 0, style: 'glass' };
  assert.deepEqual(importTheme(exportTheme(theme)), theme);
  assert.deepEqual(importTheme(exportTheme(importTheme(exportTheme(theme)))), theme);
});

test('theme import rejects invalid input and defaults invalid slots', () => {
  assert.throws(() => importTheme('not json'), SyntaxError);
  assert.throws(() => importTheme('{}'), /Not a Quantm theme/);
  const imported = importTheme(JSON.stringify({ colors: { accent: 'red', text: '#abcdef', unknown: '#123456' }, style: 'unknown' }));
  assert.equal(imported.colors.accent, DEFAULT_THEME.colors.accent);
  assert.equal(imported.colors.text, '#abcdef');
  assert.equal(imported.radius, DEFAULT_THEME.radius);
  assert.equal(imported.style, '');
  assert.equal(imported.colors.unknown, undefined);
  assert.equal(imported.preset, 'Custom');
});
