// Settings: theme editor, playback options, account, shortcuts and about.
// Theme edits apply live (CSS variables are global) and are saved with a short debounce.
import { h, debounce } from '../dom.js';
import { icon } from '../icons.js';
import { store, settings, saveSettings, VISUALIZER_DEFAULTS } from '../store.js';
import { player } from '../player.js';
import { VISUALIZER_STYLES, VISUALIZER_COLORS, VISUALIZER_POSITIONS, VISUALIZER_LIMITS } from '../visualizer.js';
import * as theme from '../theme.js';
import * as look from '../appearance.js';
import { pageHeader, button, toast, avatar, confirmDialog, promptDialog } from '../ui.js';

const TABS = [
  { id: 'theme', label: 'Theme & colors', icon: 'palette' },
  { id: 'appearance', label: 'Appearance', icon: 'edit' },
  { id: 'playback', label: 'Playback', icon: 'play' },
  { id: 'account', label: 'Account', icon: 'user' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'queue' },
  { id: 'about', label: 'About', icon: 'cloud' }
];

export async function render(page, params) {
  const active = TABS.some(t => t.id === params.tab) ? params.tab : 'theme';
  const cleanups = [];

  const nav = h('nav.settings-nav', TABS.map(t =>
    h('a.settings-nav-link' + (t.id === active ? '.active' : ''), { href: '#/settings/' + t.id }, icon(t.icon, 18), h('span', t.label))
  ));

  const builders = { theme: themeTab, appearance: appearanceTab, playback: playbackTab, account: accountTab, shortcuts: shortcutsTab, about: aboutTab };
  const content = h('div.settings-content' + (active === 'theme' ? '.wide' : ''), await builders[active](cleanups));

  page.append(
    pageHeader('Settings', { subtitle: 'Make Quantm yours' }),
    h('div.settings-layout', nav, content)
  );
  return () => cleanups.forEach(fn => fn());
}

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

/** Titled card section */
function card(title, description, ...children) {
  return h('section.settings-card',
    h('h2.settings-card-title', title),
    description ? h('p.settings-card-desc', description) : null,
    ...children
  );
}

/** Reusable toggle switch (styled checkbox). Returns the label element. */
function switchEl(checked, onChange) {
  const input = h('input', { type: 'checkbox', checked, onchange: () => onChange(input.checked, input) });
  return h('span.settings-switch', input, h('span.settings-switch-track', h('span.settings-switch-knob')));
}

/** A row with title + description on the left and a switch on the right */
function toggleRow(title, desc, checked, onChange) {
  return h('label.settings-row',
    h('span.settings-row-text', h('span.settings-row-title', title), h('span.settings-row-desc', desc)),
    switchEl(checked, onChange)
  );
}

// ---------------------------------------------------------------------------
// Theme tab
// ---------------------------------------------------------------------------

const clone = (t) => ({ preset: t.preset, colors: Object.assign({}, t.colors), radius: t.radius, style: t.style || '' });

/** "#abc" / "ABCDEF" / "#aabbcc" -> "#aabbcc", or null if invalid. short=false only accepts 6 digits */
function normalizeHex(value, short = true) {
  let v = String(value).trim().replace(/^#/, '');
  if (short && /^[0-9a-f]{3}$/i.test(v)) v = v.split('').map(c => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(v) ? '#' + v.toLowerCase() : null;
}

function hslToHex(hue, sat, light) {
  hue = ((hue % 360) + 360) % 360;
  sat = Math.max(0, Math.min(100, sat)) / 100;
  light = Math.max(0, Math.min(100, light)) / 100;
  const k = (n) => (n + hue / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

const rand = (min, max) => min + Math.random() * (max - min);

/** A pleasant random palette: accent from a random hue, bg derived from it, contrast checked */
function randomColors() {
  const hue = Math.floor(rand(0, 360));
  const dark = Math.random() < 0.65;
  const bgHue = hue + rand(-15, 15);
  const accent = hslToHex(hue, rand(65, 90), dark ? rand(55, 66) : rand(44, 54));
  const bgSat = rand(12, 36);

  const colors = dark ? {
    bg: hslToHex(bgHue, bgSat, rand(6, 10)),
    surface: hslToHex(bgHue, bgSat, rand(12, 16)),
    bar: hslToHex(bgHue, bgSat, rand(9, 12)),
    text: hslToHex(bgHue, rand(10, 30), rand(92, 96)),
    muted: hslToHex(bgHue, rand(8, 18), rand(62, 70)),
    wave: hslToHex(bgHue, bgSat, rand(22, 30))
  } : {
    bg: hslToHex(bgHue, bgSat, rand(94, 97)),
    surface: hslToHex(bgHue, bgSat, 100),
    bar: hslToHex(bgHue, bgSat, rand(98, 100)),
    text: hslToHex(bgHue, rand(15, 30), rand(8, 14)),
    muted: hslToHex(bgHue, rand(6, 14), rand(34, 42)),
    wave: hslToHex(bgHue, bgSat, rand(76, 82))
  };

  // accent text: whichever of white / near-black reads better on the accent
  colors.accent = accent;
  colors.accentText = theme.contrast('#ffffff', accent) >= theme.contrast('#0a0a0a', accent) ? '#ffffff' : '#0a0a0a';
  colors.wavePlayed = Math.random() < 0.7 ? accent : hslToHex(hue + 150, rand(70, 90), dark ? 62 : 48);

  // nudge text colors until they're comfortably readable on the background
  const nudge = (key, target) => {
    let light = dark ? 70 : 38;
    for (let i = 0; i < 20 && theme.contrast(colors[key], colors.bg) < target; i++) {
      light += dark ? 3 : -3;
      colors[key] = hslToHex(bgHue, 12, light);
    }
  };
  nudge('text', 7);
  nudge('muted', 4.5);
  return colors;
}

/** Fake waveform bar heights (percent), fixed so cards look consistent */
const WAVE = [40, 70, 55, 90, 65, 35, 80, 60, 95, 50, 75, 45, 85, 55, 30, 65, 40, 70];

function waveBars(played = 7) {
  return h('span.settings-wave', WAVE.map((height, i) =>
    h('span' + (i < played ? '.on' : ''), { style: { height: height + '%' } })
  ));
}

/** Inline custom properties for a preset mock (colors scoped to the mock only) */
function mockVars(c) {
  return `--m-bg:${c.bg};--m-surface:${c.surface};--m-bar:${c.bar};--m-text:${c.text};--m-muted:${c.muted};` +
    `--m-accent:${c.accent};--m-accent-text:${c.accentText};--m-wave:${c.wave};--m-wp:${c.wavePlayed}`;
}

/** Mini UI mock drawn in a preset's colors */
function presetMock(colors) {
  return h('div.settings-mock', { style: mockVars(colors) },
    h('div.settings-mock-bar', h('span.settings-mock-dot'), h('span.settings-mock-line')),
    h('div.settings-mock-body',
      h('div.settings-mock-card',
        h('span.settings-mock-play'),
        h('div.settings-mock-lines', h('span.settings-mock-text'), h('span.settings-mock-muted')),
        waveBars()
      )
    )
  );
}

async function themeTab(cleanups) {
  let draft = clone(theme.getTheme());
  const rows = {};         // key -> { color, text, warn }
  const presetCards = {};  // preset name -> element

  const persist = debounce(() => theme.saveTheme(clone(draft)), 300);
  // apply to the whole app right away, save shortly after
  const live = () => { theme.applyTheme(draft); persist(); };
  // used by discrete actions (presets, random, import, reset)
  const commit = (next) => { draft = clone(next); theme.saveTheme(clone(draft)); syncAll(); };

  // --- contrast warnings -------------------------------------------------------
  const CHECKS = [
    { key: 'text', against: 'bg', min: 4.5, what: 'the background' },
    { key: 'muted', against: 'bg', min: 3, what: 'the background' },
    { key: 'accentText', against: 'accent', min: 3, what: 'the accent' }
  ];
  const updateWarnings = () => {
    for (const { key, against, min, what } of CHECKS) {
      const ratio = theme.contrast(draft.colors[key], draft.colors[against]);
      const warn = rows[key].warn;
      warn.textContent = ratio < min ? `Low contrast against ${what} (${ratio.toFixed(1)}:1, aim for ${min}:1)` : '';
      warn.classList.toggle('show', ratio < min);
    }
  };

  const updatePresetMarks = () => {
    for (const [name, el] of Object.entries(presetCards)) el.classList.toggle('active', draft.preset === name);
  };

  // --- color rows --------------------------------------------------------------
  const setColor = (key, hex, source) => {
    draft.colors[key] = hex;
    draft.preset = 'Custom';
    const row = rows[key];
    if (source !== 'color') row.color.value = hex;
    if (source !== 'text') row.text.value = hex;
    row.text.classList.remove('invalid');
    updateWarnings();
    updatePresetMarks();
    live();
  };

  const colorRow = ({ key, label, hint }) => {
    const color = h('input.settings-color', { type: 'color', value: draft.colors[key], title: label,
      oninput: () => setColor(key, color.value, 'color') });
    const text = h('input.input.settings-hex', { value: draft.colors[key], maxLength: 7, spellcheck: false, 'aria-label': label + ' hex value',
      oninput: () => {
        const hex = normalizeHex(text.value, false);
        text.classList.toggle('invalid', !hex);
        if (hex) setColor(key, hex, 'text');
      },
      onchange: () => {
        const hex = normalizeHex(text.value);
        if (hex) setColor(key, hex);
        else text.value = draft.colors[key];
        text.classList.remove('invalid');
      } });
    const warn = h('div.settings-warn');
    rows[key] = { color, text, warn };
    return h('div.settings-color-row',
      color,
      h('div.settings-color-info', h('div.settings-row-title', label), h('div.settings-row-desc', hint), warn),
      text
    );
  };

  // --- radius ------------------------------------------------------------------
  const radiusValue = h('span.settings-range-value', draft.radius + 'px');
  const radius = h('input.settings-range', { type: 'range', min: 0, max: 20, step: 1, value: draft.radius, 'aria-label': 'Corner roundness',
    oninput: () => {
      draft.radius = Number(radius.value);
      radiusValue.textContent = draft.radius + 'px';
      live();
    } });

  // --- sync every control with `draft` after a bulk change -----------------------
  function syncAll() {
    for (const { key } of theme.THEME_FIELDS) {
      rows[key].color.value = draft.colors[key];
      rows[key].text.value = draft.colors[key];
      rows[key].text.classList.remove('invalid');
    }
    radius.value = draft.radius;
    radiusValue.textContent = draft.radius + 'px';
    updateWarnings();
    updatePresetMarks();
  }

  // --- preset gallery ----------------------------------------------------------
  const gallery = h('div.settings-presets', Object.entries(theme.PRESETS).map(([name, colors]) => {
    const el = h('button.settings-preset', { type: 'button', title: 'Use ' + name,
      onclick: () => {
        if (theme.PRESET_STYLES[name] === 'liquid') offerSeeThrough();
        commit({ preset: name, colors: Object.assign({}, colors), radius: name in theme.PRESET_RADIUS ? theme.PRESET_RADIUS[name] : draft.radius, style: theme.PRESET_STYLES[name] || '' });
      } },
      presetMock(colors),
      h('span.settings-preset-name', h('span', name), icon('check', 14))
    );
    presetCards[name] = el;
    return el;
  }));

  // --- actions -----------------------------------------------------------------
  const randomize = () => commit({ preset: 'Custom', colors: randomColors(), radius: draft.radius, style: '' });

  const exportIt = async () => {
    try {
      await window.native.copy(theme.exportTheme(draft));
      toast('Theme copied to clipboard');
    } catch (e) {
      toast("Couldn't copy the theme", 'error');
    }
  };

  const importIt = async () => {
    const text = await promptDialog('Import theme', { label: 'Paste theme JSON', placeholder: '{ "colors": { ... } }', confirmLabel: 'Import' });
    if (!text) return;
    try {
      commit(theme.importTheme(text));
      toast('Theme imported');
    } catch (e) {
      toast("That isn't a valid Quantm theme", 'error');
    }
  };

  const reset = () => {
    commit(theme.DEFAULT_THEME);
    toast('Theme reset to default');
  };

  const editor = h('div.settings-theme-main',
    card('Presets', 'Pick a starting point, then fine-tune it below.', gallery),
    card('Custom colors', 'Changes apply instantly across the whole app.',
      h('div.settings-colors', theme.THEME_FIELDS.map(colorRow)),
      h('div.settings-radius',
        h('div.settings-row-text', h('span.settings-row-title', 'Corner roundness'), h('span.settings-row-desc', 'Cards, inputs and artwork')),
        h('div.settings-range-wrap', radius, radiusValue)
      )
    ),
    card('Tools', null,
      h('div.settings-actions',
        button('Random theme', randomize, 'btn-outline', 'repeat'),
        button('Export to clipboard', exportIt, 'btn-outline', 'upload'),
        button('Import…', importIt, 'btn-outline', 'download'),
        h('div.spacer'),
        button('Reset to default', reset, 'btn-ghost', 'history')
      )
    )
  );

  syncAll();
  return h('div.settings-theme', editor, previewPanel());
}

/** Live preview built from the real app classes (they follow the global variables) */
function previewPanel() {
  return h('aside.settings-preview',
    h('div.sidebar-title', h('span', 'Live preview')),
    h('div.settings-preview-box',
      h('div.settings-pv-row',
        h('div.track-art', icon('album', 22)),
        h('div.settings-pv-meta',
          h('div.track-title', 'Midnight Drive'),
          h('div.track-sub', h('span', 'Nova Bloom'), h('span', '· 3:42'))
        ),
        h('span.tag-pill', 'Electronic')
      ),
      h('div.settings-pv-wave', waveBars(9)),
      h('div.settings-pv-actions',
        h('button.play-btn', { type: 'button', 'aria-label': 'Play' }, icon('play', 22)),
        h('button.btn.btn-primary.btn-sm', { type: 'button' }, 'Follow'),
        h('button.btn.btn-outline.btn-sm', { type: 'button' }, 'Share'),
        h('button.icon-btn.active', { type: 'button', 'aria-label': 'Liked' }, icon('heartFilled')),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Repost' }, icon('repost'))
      ),
      h('div.settings-pv-text',
        h('div', 'Primary text looks like this.'),
        h('div.muted', 'Secondary text looks like this.'),
        h('a.settings-pv-link', { href: '#/settings/theme' }, 'Accent link')
      ),
      h('div.settings-pv-bar',
        h('button.pb-play', { type: 'button', 'aria-label': 'Pause' }, icon('pause', 20)),
        h('span.pb-time', '1:12'),
        h('div.pb-progress', h('div.pb-track', h('div.pb-fill', { style: { width: '38%' } }))),
        h('span.pb-time', '3:42')
      )
    )
  );
}

// ---------------------------------------------------------------------------
// Appearance tab: layout, background, artwork colors, fonts, waveform, schedule
// ---------------------------------------------------------------------------

/** Row with a set of chips; the clicked chip becomes active */
function chipRow(title, desc, options, value, onPick) {
  const chips = h('div.chips');
  options.forEach((option) => {
    const chip = h('button.chip' + (option.id === value ? '.active' : ''), {
      onclick: (e) => {
        e.preventDefault();
        chips.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
        onPick(option.id);
      }
    }, option.label);
    chips.append(chip);
  });
  return h('div.settings-row.settings-row-wrap',
    h('span.settings-row-text', h('span.settings-row-title', title), desc ? h('span.settings-row-desc', desc) : null),
    chips
  );
}

/** Row with a range slider and a live value label */
function sliderRow(title, desc, { min, max, step = 1, value, unit = '' }, onInput) {
  const label = h('span.settings-range-value', value + unit);
  const slider = h('input.settings-range', { type: 'range', min, max, step, value,
    oninput: () => { label.textContent = slider.value + unit; onInput(Number(slider.value)); } });
  return h('div.settings-row',
    h('span.settings-row-text', h('span.settings-row-title', title), desc ? h('span.settings-row-desc', desc) : null),
    h('div.settings-range-wrap', slider, label)
  );
}

function selectRow(title, desc, options, value, onChange) {
  const select = h('select.input.settings-select', { onchange: () => onChange(select.value) },
    options.map(o => h('option', { value: o.id, selected: o.id === value }, o.label)));
  return h('div.settings-row',
    h('span.settings-row-text', h('span.settings-row-title', title), desc ? h('span.settings-row-desc', desc) : null),
    select
  );
}

/** Picking Liquid Glass with an opaque window: offer the real see-through effect once */
async function offerSeeThrough() {
  const mode = await window.native.windowMode();
  if (!mode.supported || mode.seeThrough || localStorage.getItem('quantm.offeredSeeThrough')) return;
  localStorage.setItem('quantm.offeredSeeThrough', '1');
  const ok = await confirmDialog('Make the window see-through?', 'Liquid Glass looks best when your desktop shows through it. Quantm will restart to turn this on. You can change it later in Settings → Appearance → Window.', 'Restart & turn on');
  if (ok) window.native.setSeeThrough(true);
}

/** See-through window: needs a restart because a window can't become transparent later */
function windowCard(mode) {
  if (!mode.supported) return null;
  return card('Window', 'Let your desktop and other windows show through Liquid Glass themes, blurred like real glass. Quantm restarts to apply this.',
    toggleRow('See-through window', mode.seeThrough ? 'On. Pick a Liquid Glass theme to see the effect.' : 'Off', mode.seeThrough, async (on, input) => {
      const ok = await confirmDialog(on ? 'Make the window see-through?' : 'Turn off see-through?', 'Quantm will restart to apply this. Music stops for a moment.', 'Restart now');
      if (!ok) { input.checked = !on; return; }
      window.native.setSeeThrough(on);
    })
  );
}

async function appearanceTab() {
  const a = look.getAppearance();
  const save = (patch) => {
    try { return look.saveAppearance(patch); } catch (e) { toast(e.message, 'error'); }
  };
  const saveSoon = debounce(save, 150);

  // --- background picture picker ---
  const preview = h('div.settings-bg-preview', { style: { backgroundImage: a.bgImage ? `url("${a.bgImage}")` : '' } },
    a.bgImage ? null : h('span.muted.small', 'No picture chosen'));
  const bgModes = [{ id: 'none', label: 'None' }, { id: 'artwork', label: 'Song artwork' }, { id: 'image', label: 'My picture' }];
  const markMode = (mode) => bgRow.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('active', bgModes[i].id === mode));
  const fileInput = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' },
    onchange: async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        const dataUrl = await look.imageFileToDataUrl(file);
        save({ bgImage: dataUrl, background: 'image' });
        preview.style.backgroundImage = `url("${dataUrl}")`;
        preview.textContent = '';
        markMode('image');
        toast('Background updated');
      } catch (e) { toast(e.message, 'error'); }
      fileInput.value = '';
    } });
  const bgRow = chipRow('Background', 'Show a picture behind the app', bgModes, a.background, (mode) => {
    if (mode === 'image' && !look.getAppearance().bgImage) {
      markMode(look.getAppearance().background);
      return fileInput.click();
    }
    save({ background: mode });
  });

  const presetNames = Object.keys(theme.PRESETS).map(name => ({ id: name, label: name }));
  const schedule = a.schedule;
  const setSchedule = (patch) => save({ schedule: Object.assign({}, look.getAppearance().schedule, patch) });
  const timeInput = (key) => h('input.input.settings-time', { type: 'time', value: schedule[key], onchange: (e) => setSchedule({ [key]: e.target.value }) });

  return h('div',
    card('Layout', 'Arrange Quantm the way you like it.',
      chipRow('Navigation', 'Links in the top bar, or in a sidebar on the left', [{ id: 'top', label: 'Top bar' }, { id: 'sidebar', label: 'Sidebar' }], a.nav, (v) => save({ nav: v })),
      chipRow('Player bar', 'Where the playback controls sit', [{ id: 'bottom', label: 'Bottom' }, { id: 'top', label: 'Top' }], a.playerPosition, (v) => save({ playerPosition: v })),
      chipRow('Density', 'Compact fits more on screen', [{ id: 'comfortable', label: 'Comfortable' }, { id: 'compact', label: 'Compact' }], a.density, (v) => save({ density: v })),
      toggleRow('Show play counts', 'On track rows and feed cards', a.showPlays, (on) => save({ showPlays: on })),
      toggleRow('Show genre tags', 'On track rows and feed cards', a.showGenres, (on) => save({ showGenres: on }))
    ),
    card('Background', "Use the playing song's artwork or your own picture as the app background.",
      bgRow,
      h('div.settings-row',
        h('span.settings-row-text', h('span.settings-row-title', 'Your picture'), h('span.settings-row-desc', 'JPG, PNG or WebP. Large images are resized.')),
        h('div.settings-bg-actions', preview,
          button('Choose…', () => fileInput.click(), 'btn-sm', 'upload'),
          button('Remove', () => {
            const current = look.getAppearance().background;
            save({ bgImage: '', background: current === 'image' ? 'none' : current });
            if (current === 'image') markMode('none');
            preview.style.backgroundImage = '';
            preview.textContent = 'No picture chosen';
          }, 'btn-ghost.btn-sm'),
          fileInput)
      ),
      sliderRow('Dim', 'How much the theme color covers the picture', { min: 0, max: 95, value: a.bgDim, unit: '%' }, (v) => saveSoon({ bgDim: v })),
      sliderRow('Blur', 'Soften the picture', { min: 0, max: 60, value: a.bgBlur, unit: 'px' }, (v) => saveSoon({ bgBlur: v }))
    ),
    card('Colors', null,
      toggleRow('Match the playing song', "The accent color changes to fit each track's artwork", a.artworkColors, (on) => {
        save({ artworkColors: on });
        if (on) look.refreshArtworkAccent();
      })
    ),
    card('Text', null,
      selectRow('Font', 'Used everywhere in the app', look.FONTS, a.font, (v) => save({ font: v })),
      sliderRow('Zoom', 'Make everything bigger or smaller', { min: 70, max: 150, step: 5, value: a.zoom, unit: '%' }, (v) => saveSoon({ zoom: v }))
    ),
    card('Waveforms', null,
      chipRow('Style', 'How track waveforms are drawn', look.WAVE_STYLES, a.waveStyle, (v) => save({ waveStyle: v })),
      sliderRow('Bar thickness', null, { min: 1, max: 6, value: a.waveThickness, unit: 'px' }, (v) => saveSoon({ waveThickness: v }))
    ),
    windowCard(await window.native.windowMode()),
    card('Theme schedule', 'Switch between two themes automatically, like a light theme by day and a dark one at night.',
      toggleRow('Switch themes automatically', "Uses your computer's clock", schedule.enabled, (on) => setSchedule({ enabled: on })),
      selectRow('Day theme', null, presetNames, schedule.day, (v) => setSchedule({ day: v })),
      selectRow('Night theme', null, presetNames, schedule.night, (v) => setSchedule({ night: v })),
      h('div.settings-row',
        h('span.settings-row-text', h('span.settings-row-title', 'Day starts / night starts')),
        h('div.settings-times', timeInput('dayStart'), h('span.muted', 'to'), timeInput('nightStart'))
      )
    )
  );
}

// ---------------------------------------------------------------------------
// Playback tab
// ---------------------------------------------------------------------------

async function playbackTab(cleanups) {
  const pct = () => Math.round(settings.volume * 100);
  const valueLabel = h('span.settings-range-value', pct() + '%');
  const slider = h('input.settings-range', { type: 'range', min: 0, max: 100, step: 1, value: pct(), 'aria-label': 'Default volume',
    oninput: () => {
      valueLabel.textContent = slider.value + '%';
      player.setVolume(Number(slider.value) / 100);
    } });

  // keep the slider honest if volume changes from the player bar or keyboard
  cleanups.push(store.on('settings', () => {
    if (Math.abs(Number(slider.value) - pct()) > 0.5) {
      slider.value = pct();
      valueLabel.textContent = pct() + '%';
    }
  }));

  const onNotifications = async (on, input) => {
    if (on && 'Notification' in window && Notification.permission !== 'granted') {
      const result = await Notification.requestPermission();
      if (result !== 'granted') {
        input.checked = false;
        saveSettings({ notifications: false });
        toast('Notifications are blocked for Quantm in system settings', 'error');
        return;
      }
    }
    saveSettings({ notifications: on });
  };

  return h('div',
    card('Playback', null,
      toggleRow('Autoplay related tracks', 'Keep the music going with similar tracks when the queue ends.', settings.autoplayRelated,
        (on) => saveSettings({ autoplayRelated: on })),
      toggleRow('Desktop notifications', 'Show a notification when a new track starts playing.', settings.notifications, onNotifications),
      toggleRow('Normalize volume', 'Even out loud and quiet tracks so every song plays at a similar level.', settings.normalize !== false,
        (on) => player.setNormalize(on))
    ),
    visualizerCard(),
    card('Volume', 'The level Quantm plays at. You can also change it from the player bar.',
      h('div.settings-radius',
        h('div.settings-row-text', h('span.settings-row-title', 'Default volume'), h('span.settings-row-desc', 'Applies right now and next time you open the app')),
        h('div.settings-range-wrap', slider, valueLabel)
      )
    )
  );
}

/** The player bar visualizer: every option applies live and is saved immediately */
function visualizerCard() {
  const set = (patch) => saveSettings(patch);
  const d = VISUALIZER_DEFAULTS;
  const val = (key) => (settings[key] === undefined ? d[key] : settings[key]);
  const limit = (key) => ({ min: VISUALIZER_LIMITS[key][0], max: VISUALIZER_LIMITS[key][1] });

  const picker = (key, label) => {
    const input = h('input.settings-color', { type: 'color', value: val(key), title: label, 'aria-label': label,
      oninput: () => set({ [key]: input.value }) });
    return h('label.settings-viz-color', input, h('span.muted.small', label));
  };
  const colorsRow = h('div.settings-row.settings-viz-colors' + (val('visualizerColor') === 'custom' ? '' : '.hidden'),
    h('span.settings-row-text', h('span.settings-row-title', 'Custom colors'), h('span.settings-row-desc', 'A gradient from the bottom to the top of the visualizer')),
    h('div.settings-viz-pickers', picker('visualizerColorA', 'Bottom'), picker('visualizerColorB', 'Top'))
  );

  const el = card('Visualizer', 'A small animated spectrum in the player bar. Every change applies right away.',
    toggleRow('Show visualizer', 'Animate the player bar along with the music.', settings.visualizer !== false,
      (on) => set({ visualizer: on })),
    chipRow('Style', 'How the visualizer is drawn', VISUALIZER_STYLES, val('visualizerStyle'), (v) => set({ visualizerStyle: v })),
    chipRow('Color', 'Theme colors, your accent, a moving rainbow, or your own pair', VISUALIZER_COLORS, val('visualizerColor'), (v) => {
      colorsRow.classList.toggle('hidden', v !== 'custom');
      set({ visualizerColor: v });
    }),
    colorsRow,
    sliderRow('Bars', 'How many columns (bars, mirrored, dots and circle)', { ...limit('bars'), value: val('visualizerBars') }, (v) => set({ visualizerBars: v })),
    sliderRow('Width', null, { ...limit('width'), step: 2, value: val('visualizerWidth'), unit: 'px' }, (v) => set({ visualizerWidth: v })),
    sliderRow('Height', 'The player bar is 76px tall', { ...limit('height'), value: val('visualizerHeight'), unit: 'px' }, (v) => set({ visualizerHeight: v })),
    sliderRow('Sensitivity', 'How strongly it reacts to the music', { min: 50, max: 250, step: 5, value: Math.round(val('visualizerSensitivity') * 100), unit: '%' }, (v) => set({ visualizerSensitivity: v / 100 })),
    sliderRow('Smoothness', 'Higher is slower and smoother, lower is snappier', { min: 0, max: 95, step: 1, value: Math.round(val('visualizerSmoothing') * 100), unit: '%' }, (v) => set({ visualizerSmoothing: v / 100 })),
    toggleRow('Falling peaks', "Small caps that hold at each bar's high point, then drop (bars, mirrored, dots).", !!val('visualizerPeaks'), (on) => set({ visualizerPeaks: on })),
    toggleRow('Glow', 'A soft glow around the visualizer.', !!val('visualizerGlow'), (on) => set({ visualizerGlow: on })),
    chipRow('Position', 'Where it sits in the player bar', VISUALIZER_POSITIONS, val('visualizerPosition'), (v) => set({ visualizerPosition: v })),
    h('div.settings-actions',
      button('Reset visualizer', () => {
        saveSettings(Object.assign({}, VISUALIZER_DEFAULTS));
        el.replaceWith(visualizerCard());
        toast('Visualizer reset to default');
      }, 'btn-outline', 'history')
    )
  );
  return el;
}

// ---------------------------------------------------------------------------
// Account tab
// ---------------------------------------------------------------------------

async function accountTab() {
  const me = store.me;
  const plan = me && me.consumer_subscription && me.consumer_subscription.product && me.consumer_subscription.product.name;

  const signOut = async () => {
    if (!await confirmDialog('Sign out?', 'You will need to sign in with SoundCloud again to use Quantm.', 'Sign out', true)) return;
    player.pause();
    await window.native.auth.logout();
    location.hash = '';
    location.reload();
  };

  const resignIn = async () => {
    try {
      const ok = await window.native.auth.login();
      if (ok) location.reload();
    } catch (e) {
      toast("Couldn't sign in. Please try again.", 'error');
    }
  };

  return h('div',
    card('Account', null,
      me ? h('div.settings-account',
        avatar(me, 72),
        h('div.settings-account-info',
          h('div.settings-account-name', me.username),
          me.full_name && me.full_name !== me.username ? h('div.muted', me.full_name) : null,
          h('div.settings-account-meta',
            plan ? h('span.tag-pill', plan) : null,
            h('a.link', { href: '#/user/' + me.id }, 'View profile')
          )
        )
      ) : h('p.muted', 'You are not signed in.'),
      h('div.settings-actions',
        button('Sign out', signOut, 'btn-outline', 'logout'),
        button('Re-sign in', resignIn, 'btn-ghost', 'user')
      )
    ),
    card('Your login', null,
      h('div.settings-note', icon('lock', 20),
        h('p', 'Your SoundCloud token is stored encrypted on this computer only. It is never sent anywhere except to SoundCloud when you use the app. Signing out removes it.')
      )
    )
  );
}

// ---------------------------------------------------------------------------
// Shortcuts tab
// ---------------------------------------------------------------------------

const SHORTCUTS = [
  { title: 'Playback', items: [
    ['Play / pause', [['Space']]],
    ['Next track', [['Ctrl', '→']]],
    ['Previous track', [['Ctrl', '←']]],
    ['Seek forward 10 seconds', [['→']]],
    ['Seek back 10 seconds', [['←']]],
    ['Volume up', [['Ctrl', '↑']]],
    ['Volume down', [['Ctrl', '↓']]],
    ['Mute / unmute', [['M']]],
    ['Like current track', [['L']]],
    ['Toggle shuffle', [['S']]],
    ['Cycle repeat mode', [['R']]]
  ] },
  { title: 'Navigation', items: [
    ['Search', [['Ctrl', 'F'], ['Ctrl', 'K']]],
    ['Go back', [['Alt', '←']], 'or the mouse back button'],
    ['Go forward', [['Alt', '→']], 'or the mouse forward button']
  ] }
];

async function shortcutsTab() {
  const keys = (combos) => h('span.settings-keys', combos.map((combo, i) => [
    i ? h('span.settings-keys-or', 'or') : null,
    h('span.settings-combo', combo.map((k, j) => [j ? h('span.settings-plus', '+') : null, h('kbd', k)]))
  ]));

  return h('div',
    SHORTCUTS.map(group => card(group.title, null,
      h('div.settings-shortcuts', group.items.map(([label, combos, extra]) =>
        h('div.settings-shortcut',
          h('span.settings-shortcut-label', label, extra ? h('span.muted.small', ' · ' + extra) : null),
          keys(combos)
        )
      ))
    )),
    h('p.muted.small.settings-foot', 'Shortcuts are paused while you are typing in a text field.')
  );
}

// ---------------------------------------------------------------------------
// About tab
// ---------------------------------------------------------------------------

async function aboutTab() {
  let version = '';
  try {
    const info = await window.native.info();
    version = info && info.version ? 'Version ' + info.version : '';
  } catch (e) { /* version is optional */ }

  return h('div',
    card('About', null,
      h('div.settings-about',
        h('div.settings-about-logo', icon('cloud', 44)),
        h('div',
          h('div.settings-about-name', 'Quantm'),
          h('div.muted', version || 'A desktop app for SoundCloud')
        )
      ),
      h('p.settings-about-text', 'Quantm is open source (GPL-3.0), a successor to Soundnode.'),
      h('div.settings-actions',
        button('View on GitHub', () => window.native.openExternal('https://github.com/'), 'btn-outline', 'external')
      )
    ),
    card('Credits', null,
      h('ul.settings-credits',
        h('li', 'Original Soundnode by Michael Lancaster and contributors.'),
        h('li', 'Audio streaming powered by hls.js.')
      ),
      h('p.muted.small.settings-foot', 'Not affiliated with SoundCloud.')
    )
  );
}
