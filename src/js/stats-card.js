// The shareable "My Quantm stats" card: a 1080x1350 PNG drawn on a canvas in the current theme's colors.
// It is built on this computer and never uploaded anywhere; you choose whether to save or copy it.
import { artwork } from './dom.js';
import { iconMarkup } from './icons.js';
import { getStats, rangeTotals, topArtists, topGenres, streaks, badgeList, formatListening } from './stats.js';

export const CARD_W = 1080;
export const CARD_H = 1350;

/** Theme colors and font, read from the CSS variables on <html> */
export function readTheme() {
  const css = getComputedStyle(document.documentElement);
  const pick = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const body = getComputedStyle(document.body);
  return {
    bg: pick('--bg', '#121212'),
    surface: pick('--surface', '#1e1e1e'),
    text: pick('--text', '#f2f2f2'),
    muted: pick('--muted', '#a0a0a0'),
    accent: pick('--accent', '#ff5500'),
    accentText: pick('--accent-text', '#ffffff'),
    font: (body && body.fontFamily) || 'system-ui, sans-serif'
  };
}

function loadImage(src, crossOrigin) {
  return new Promise((resolve) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** The user's avatar as an image. window.native.image returns a data URL, which keeps the canvas untainted. */
async function loadAvatar(user) {
  if (!user || !user.avatar_url) return null;
  const url = artwork(user.avatar_url, 't500x500');
  try {
    const dataUrl = await window.native.image(url);
    if (dataUrl) return await loadImage(dataUrl, false);
  } catch (e) { /* fall through */ }
  return loadImage(url, true);
}

const svgImage = (name, size, color) =>
  loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(iconMarkup(name, size, color)), false);

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Shorten text with an ellipsis so it fits in maxWidth at the current font */
function fit(ctx, text, maxWidth) {
  let out = String(text);
  if (ctx.measureText(out).width <= maxWidth) return out;
  while (out.length > 1 && ctx.measureText(out + '…').width > maxWidth) out = out.slice(0, -1);
  return out.trimEnd() + '…';
}

/** Everything the card shows, gathered from the stats */
export function cardData(user, now = Date.now()) {
  const data = getStats();
  const month = rangeTotals(data, 'month', now);
  return {
    name: (user && user.username) || 'Listener',
    hours: formatListening(month.seconds),
    plays: month.plays,
    artists: topArtists(data, 'month', 3, now),
    genre: topGenres(data, 'month', 1, now)[0] || topGenres(data, 'all', 1, now)[0] || null,
    streak: streaks(data, now),
    badges: badgeList(data, now).filter(b => b.earned).sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, 4)
  };
}

async function draw(canvas, user, info, avatarImage) {
  const t = readTheme();
  const ctx = canvas.getContext('2d');
  const font = (weight, size) => `${weight} ${size}px ${t.font}`;
  const W = CARD_W;
  const H = CARD_H;

  // background with soft accent glows
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, W, H);
  for (const [x, y, r, a] of [[W * 0.9, 80, 760, 0.32], [60, H * 0.95, 640, 0.18]]) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, t.accent);
    glow.addColorStop(1, 'transparent');
    ctx.globalAlpha = a;
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalAlpha = 1;

  // panel
  roundRect(ctx, 48, 48, W - 96, H - 96, 56);
  ctx.fillStyle = t.surface;
  ctx.globalAlpha = 0.92;
  ctx.fill();
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = t.text;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = 1;

  const left = 112;
  const right = W - 112;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // header: avatar, name, title
  const cx = left + 60;
  const cy = 176;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 60, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (avatarImage) {
    ctx.drawImage(avatarImage, cx - 60, cy - 60, 120, 120);
  } else {
    ctx.fillStyle = t.accent;
    ctx.fillRect(cx - 60, cy - 60, 120, 120);
    ctx.fillStyle = t.accentText;
    ctx.font = font(800, 64);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(info.name.trim().charAt(0).toUpperCase() || '?', cx, cy + 3);
  }
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = t.text;
  ctx.font = font(800, 54);
  ctx.fillText(fit(ctx, info.name, right - (left + 156)), left + 156, cy - 4);
  ctx.fillStyle = t.accent;
  ctx.font = font(700, 32);
  ctx.fillText('My Quantm stats', left + 156, cy + 42);

  // big numbers
  const label = (text, x, y) => {
    ctx.fillStyle = t.muted;
    ctx.font = font(700, 24);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.fillText(text.toUpperCase(), x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  };
  label('Hours · last 30 days', left, 320);
  ctx.fillStyle = t.accent;
  ctx.font = font(800, 190);
  ctx.fillText(info.hours.value, left, 490);
  const valueWidth = ctx.measureText(info.hours.value).width;
  ctx.fillStyle = t.text;
  ctx.font = font(700, 44);
  ctx.fillText(info.hours.unit, left + valueWidth + 20, 490);

  const col = 700;
  label('Streak', col, 372);
  ctx.fillStyle = t.text;
  ctx.font = font(800, 60);
  ctx.fillText(`${info.streak.current} day${info.streak.current === 1 ? '' : 's'}`, col, 436);
  label('Plays', col, 488);
  ctx.fillText(String(info.plays), col, 548);

  // top artists
  const rule = (y) => {
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = t.text;
    ctx.fillRect(left, y, right - left, 2);
    ctx.globalAlpha = 1;
  };
  rule(590);
  label('Top artists', left, 650);
  if (!info.artists.length) {
    ctx.fillStyle = t.muted;
    ctx.font = font(600, 40);
    ctx.fillText('Play some music to fill this in', left, 720);
  }
  info.artists.forEach((artist, i) => {
    const y = 724 + i * 92;
    ctx.fillStyle = t.accent;
    ctx.beginPath();
    ctx.arc(left + 32, y - 14, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = t.accentText;
    ctx.font = font(800, 34);
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), left + 32, y - 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = t.muted;
    ctx.font = font(600, 30);
    const plays = `${artist.plays} play${artist.plays === 1 ? '' : 's'}`;
    ctx.fillText(plays, right, y - 2);
    const playsWidth = ctx.measureText(plays).width;
    ctx.textAlign = 'left';
    ctx.fillStyle = t.text;
    ctx.font = font(700, 46);
    ctx.fillText(fit(ctx, artist.name, right - left - 100 - playsWidth - 24), left + 92, y);
  });

  // top genre
  rule(1008);
  label('Top genre', left, 1068);
  ctx.fillStyle = t.accent;
  ctx.font = font(800, 56);
  ctx.fillText(fit(ctx, info.genre ? info.genre.name : 'None yet', right - left), left, 1134);

  // badges
  rule(1174);
  const badgeIcons = await Promise.all(info.badges.map(b => svgImage(b.icon, 96, t.accentText)));
  info.badges.forEach((badge, i) => {
    const x = left + 44 + i * 170;
    ctx.fillStyle = t.accent;
    ctx.beginPath();
    ctx.arc(x, 1236, 44, 0, Math.PI * 2);
    ctx.fill();
    if (badgeIcons[i]) ctx.drawImage(badgeIcons[i], x - 24, 1212, 48, 48);
  });
  if (!info.badges.length) {
    label('Badges', left, 1240);
    ctx.fillStyle = t.muted;
    ctx.font = font(600, 30);
    ctx.fillText('None earned yet', left + 150, 1240);
  }

  // footer: logo and name
  const logo = await svgImage('logo', 96, t.accent);
  ctx.textAlign = 'right';
  ctx.fillStyle = t.text;
  ctx.font = font(800, 40);
  ctx.fillText('Quantm', right, 1262);
  const nameWidth = ctx.measureText('Quantm').width;
  if (logo) ctx.drawImage(logo, right - nameWidth - 56, 1228, 44, 44);
  ctx.textAlign = 'left';
}

function isTainted(canvas) {
  try {
    canvas.getContext('2d').getImageData(0, 0, 1, 1);
    return false;
  } catch (e) {
    return true;
  }
}

/** Draw the card and return the canvas. If the avatar tainted it, the card is redrawn with a letter instead. */
export async function renderCard(user, now = Date.now()) {
  const info = cardData(user, now);
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  await draw(canvas, user, info, await loadAvatar(user));
  if (isTainted(canvas)) {
    canvas.width = CARD_W; // resets the canvas
    await draw(canvas, user, info, null);
  }
  return canvas;
}

export const cardBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

/** Download the card as a PNG */
export async function saveCard(canvas) {
  const blob = await cardBlob(canvas);
  if (!blob) throw new Error('Could not create the image');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'quantm-stats.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Copy the card to the clipboard as an image */
export async function copyCard(canvas) {
  const blob = await cardBlob(canvas);
  if (!blob) throw new Error('Could not create the image');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
