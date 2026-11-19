/* ============================================================
   海风城市冲刺 · Coastal City Sprint
   伪 3D 城市跑酷：单一消失点透视，世界物体（道路、护栏、
   金币、障碍、终点拱门、路边装饰）全部经过同一个 proj() 投影，
   保证透视一致；0-300m 海滨公路 / 300-700m 城市高架 /
   700-1000m 夜间灯牌街区，1000m 终点结算。
   ============================================================ */
(() => {
'use strict';

/* ---------------- 小工具 ---------------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mod = (a, m) => ((a % m) + m) % m;
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const _hexCache = {};
function rgb(hex) {
  let c = _hexCache[hex];
  if (!c) { const n = parseInt(hex.slice(1), 16); c = _hexCache[hex] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  return c;
}
const mixA = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = a => 'rgb(' + (a[0] | 0) + ',' + (a[1] | 0) + ',' + (a[2] | 0) + ')';
const cssA = (a, al) => 'rgba(' + (a[0] | 0) + ',' + (a[1] | 0) + ',' + (a[2] | 0) + ',' + al + ')';
const mix3arr = (a, b, c, w) => [
  a[0] * w[0] + b[0] * w[1] + c[0] * w[2],
  a[1] * w[0] + b[1] * w[1] + c[1] * w[2],
  a[2] * w[0] + b[2] * w[1] + c[2] * w[2]
];
function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return String(m).padStart(2, '0') + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
}
function setText(el, str) { if (el.__t !== str) { el.__t = str; el.textContent = str; } }

/* ---------------- 配置 ---------------- */
const CFG = {
  camH: 1.7,            // 相机离地高度（世界单位）
  roadHalf: 1.6,        // 路面半宽
  laneX: [-1, 0, 1],    // 三条跑道中心
  pz: 3.1,              // 玩家相对相机的固定距离
  g: 21.5,              // 重力
  jumpV: 7.6,           // 起跳速度（最高点约 1.34）
  speedBase: 15,        // 初始速度 m/s
  speedMax: 19.5,
  speedRamp: 0.0045,    // 随距离缓慢加速
  laneRate: 10,         // 换道插值速率
  objWin: 1.2           // 碰撞判定纵深
};

/* ---------------- DOM ---------------- */
const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const ui = {
  hud: $('hud'), coin: $('coin-count'), shieldBadge: $('shield-badge'),
  fill: $('prog-fill'), dot: $('prog-dot'), time: $('time-el'),
  overlay: $('overlay'),
  panels: {
    menu: $('panel-menu'), count: $('panel-count'), fail: $('panel-fail'),
    win: $('panel-win'), pause: $('panel-pause')
  },
  countNum: $('count-num'),
  failDist: $('fail-dist'), failCoins: $('fail-coins'), failZone: $('fail-zone'), failTip: $('fail-tip'),
  winTime: $('win-time'), winCoins: $('win-coins'), winBest: $('win-best'), winMedal: $('win-medal'),
  menuBest: $('menu-best'),
  touch: $('touch'), mute: $('btn-mute'), pauseBtn: $('btn-pause')
};

/* ---------------- 三阶段调色板 ---------------- */
const PAL_HEX = [
  { // 0 清晨海滨
    skyTop: '#3fa8ee', skyBot: '#d9f2ff', ground: '#ecd9ae',
    roadA: '#97a1ae', roadB: '#8e98a5', edge: '#ffffff', dash: '#ffffff',
    rail: '#eef4f9', railDark: '#b9c9d8', fog: '#d9f2ff'
  },
  { // 1 城市高架（暖霾）
    skyTop: '#5f9fd8', skyBot: '#f0d7ac', ground: '#9a9aa2',
    roadA: '#6e7683', roadB: '#666e7b', edge: '#f4f6f8', dash: '#f4f6f8',
    rail: '#d6e0ea', railDark: '#9dafc0', fog: '#e8d9bc'
  },
  { // 2 夜间灯牌街区
    skyTop: '#070b24', skyBot: '#30204e', ground: '#12142a',
    roadA: '#272d46', roadB: '#212740', edge: '#ffd76e', dash: '#ffd76e',
    rail: '#5f74ac', railDark: '#37456f', fog: '#191338'
  }
];
const PAL = PAL_HEX.map(p => { const o = {}; for (const k in p) o[k] = rgb(p[k]); return o; });

// 装饰用颜色
const COL = {
  trunk: rgb('#8a6a4f'), leaf: rgb('#2f9e5f'), pillar: rgb('#5c6470'),
  pole: rgb('#464e5c'), bbBg: rgb('#22283a'), neonBg: rgb('#181030'),
  lampWarm: rgb('#ffe08a'), lampOff: rgb('#e1e4ec')
};
const NEON_COLS = ['#ff4d6d', '#ffd166', '#4dd4ff', '#b388ff', '#3ddc97'];
const NEON_TXT = ['海风', '冲刺', '灯牌', '夜行', '不夜', '冲呀'];

/* ---------------- 视口与投影 ---------------- */
const view = { w: 0, h: 0, cx: 0, hy: 0, focal: 1, zNear: 2.6, zFar: 110 };
let dpr = 1;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  dpr = clamp(window.devicePixelRatio || 1, 1, 2);
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  view.w = w; view.h = h; view.cx = w / 2;
  view.hy = Math.round(h * 0.42);
  view.focal = Math.min(h * 0.92, w * 1.25);
  view.zNear = CFG.camH * view.focal / Math.max(1, h - view.hy);
}
// 一切世界物体共用的投影：x 横向、y 高度（0=路面），rz 相机前方距离
function proj(x, y, rz) {
  const s = view.focal / rz;
  const t = clamp(1 - rz / view.zFar, 0, 1);
  const curve = S.curve * t * t * 2.4;   // 轻微弯道，远处归零，消失点不变
  return { x: view.cx + (x + curve) * s, y: view.hy + (CFG.camH - y) * s, s };
}
function phaseWeights(d) {
  const w1 = 1 - sstep(260, 340, d);
  const w3 = sstep(660, 740, d);
  return [w1, Math.max(0, 1 - w1 - w3), w3];
}
let WP = null; // 每帧混合后的调色板
function blendPal(d) {
  const w = phaseWeights(d);
  const o = { w };
  for (const k in PAL[0]) {
    const a = PAL[0][k], b = PAL[1][k], c = PAL[2][k];
    o[k] = [
      a[0] * w[0] + b[0] * w[1] + c[0] * w[2],
      a[1] * w[0] + b[1] * w[1] + c[1] * w[2],
      a[2] * w[0] + b[2] * w[1] + c[2] * w[2]
    ];
  }
  return o;
}
function fogF(rz) { return Math.pow(clamp((rz - 24) / (view.zFar - 24), 0, 1), 1.15) * 0.92; }
function shadeArr(arr, rz) { return css(mixA(arr, WP.fog, fogF(rz))); }
function shadeHex(hex, rz) { return css(mixA(rgb(hex), WP.fog, fogF(rz))); }

/* ---------------- 环境元素（比例坐标，随窗口缩放） ---------------- */
const STARS = [], CLOUDS = [], GULLS = [], BOATS = [];
function initAmbient() {
  const r = mulberry32(77);
  for (let i = 0; i < 90; i++) STARS.push({ u: r(), v: r() * 0.9, s: 1 + r() * 1.4, ph: r() * 6.28 });
  for (let i = 0; i < 6; i++) CLOUDS.push({ u: r(), v: 0.15 + r() * 0.5, sc: 0.6 + r() * 0.7, sp: 0.5 + r() });
  for (let i = 0; i < 4; i++) GULLS.push({ u: r(), v: 0.10 + r() * 0.35, ph: r() * 6.28, sp: 0.6 + r() * 0.8 });
  for (let i = 0; i < 3; i++) BOATS.push({ u: r(), sp: 0.5 + r(), sc: r(), dv: r() });
}
function makeSkyline(seed, h0, h1, w0, w1, gapMax) {
  const r = mulberry32(seed); const arr = []; let u = 0;
  while (u < 3000) {
    const bw = w0 + r() * (w1 - w0);
    const win = []; const wn = 2 + ((r() * 7) | 0);
    for (let i = 0; i < wn; i++) win.push({ x: 0.08 + r() * 0.78, y: 0.10 + r() * 0.72 });
    arr.push({ u, w: bw, h: h0 + r() * (h1 - h0), win });
    u += bw + 4 + r() * gapMax;
  }
  return arr;
}
const SKY_FAR = makeSkyline(101, 0.05, 0.15, 26, 60, 36);
const SKY_MID = makeSkyline(202, 0.09, 0.24, 34, 84, 60);
const FAR_TONES = [rgb('#cfe3f2'), rgb('#9db3c9'), rgb('#141b3a')];
const MID_TONES = [rgb('#b6d3ea'), rgb('#7b92ae'), rgb('#1c2547')];
const LINES = []; // 速度线
for (let i = 0; i < 14; i++) LINES.push({ x: 0, y: 0, life: Math.random() * 0.6 });

/* ---------------- 游戏状态 ---------------- */
const S = {
  mode: 'boot',        // menu | count | running | paused | fail | finish
  attract: true,       // 主菜单演示模式
  t: 0, time: 0, distance: 0, speed: 0, coins: 0,
  laneIdx: 1, laneX: 0, y: 0, vy: 0, jumping: false,
  shield: false, invuln: 0, runPhase: 0,
  curve: 0, curveTarget: 0, curveTimer: 1,
  countT: 0, lastCount: null, goT: null,
  crashT: 0, failShown: false, failKind: '',
  finishT: 0, winShown: false, finalTime: 0,
  dec: [], obj: [], particles: [], confetti: [],
  decorZ: 6, objZ: 58, lastShieldZ: -999,
  rng: mulberry32(1),
  muted: false
};

/* ---------------- 存储 ---------------- */
function loadBest() { try { return +localStorage.getItem('ccs-best') || 0; } catch (e) { return 0; } }
function saveBest(t) { try { localStorage.setItem('ccs-best', String(t)); } catch (e) {} }
function loadMuted() { try { return localStorage.getItem('ccs-muted') === '1'; } catch (e) { return false; } }
function saveMuted(v) { try { localStorage.setItem('ccs-muted', v ? '1' : '0'); } catch (e) {} }

/* ---------------- 音效（WebAudio 极简合成） ---------------- */
let AC = null;
function ensureAudio() {
  if (!AC) { try { const C = window.AudioContext || window.webkitAudioContext; if (C) AC = new C(); } catch (e) { AC = null; } }
  if (AC && AC.state === 'suspended') { try { AC.resume().catch(() => {}); } catch (e) {} }
}
function tone(f0, f1, dur, type, vol, delay) {
  if (S.muted) return;
  ensureAudio(); const a = AC;
  if (!a || a.state !== 'running') return;
  try {
    const t0 = a.currentTime + (delay || 0);
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(f0, 1), t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  } catch (e) {}
}
const sCoin = () => { tone(950, 1500, 0.11, 'sine', 0.10); tone(1420, 1900, 0.10, 'sine', 0.07, 0.05); };
const sJump = () => tone(250, 560, 0.16, 'triangle', 0.10);
const sLane = () => tone(300, 360, 0.05, 'sine', 0.05);
const sCrash = () => { tone(200, 55, 0.4, 'sawtooth', 0.16); tone(90, 40, 0.35, 'square', 0.10, 0.02); };
const sBreak = () => tone(700, 180, 0.22, 'square', 0.10);
const sShield = () => { tone(520, 1050, 0.25, 'sine', 0.10); tone(780, 1560, 0.22, 'sine', 0.07, 0.08); };
const sCount = n => tone(n === 0 ? 1050 : 640, n === 0 ? 1050 : 640, 0.14, 'sine', 0.09);
const sFinish = () => {
  [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.16, 'triangle', 0.10, i * 0.13));
  tone(1046, 1568, 0.4, 'sine', 0.08, 0.55);
};

/* ---------------- 世界生成 ---------------- */
function addCoin(z, lane, y) { S.obj.push({ kind: 'coin', z, lane, y: y == null ? 0.55 : y, seed: Math.random(), dead: false }); }
function addBarrier(z, lane) { S.obj.push({ kind: 'barrier', z, lane, dead: false }); }
function addBlock(z, lane) { S.obj.push({ kind: 'block', z, lane, dead: false }); }

function spawnChunk(z) {
  const rng = S.rng;
  if (z > 975) { S.objZ = z + 70; return; }        // 终点前留出干净冲刺段
  const diff = clamp(z / 1000, 0, 1);
  const r = rng();
  let gap;
  if (S.attract) {                                  // 主菜单演示：只有金币
    const lane = (rng() * 3) | 0;
    for (let i = 0; i < 6; i++) addCoin(z + i * 4, lane);
    S.objZ = z + 58; return;
  }
  if (r < 0.32) {                                   // 直线金币
    const lane = (rng() * 3) | 0, n = 5 + ((rng() * 3) | 0);
    for (let i = 0; i < n; i++) addCoin(z + i * 4, lane);
    gap = n * 4 + lerp(26, 18, diff) + rng() * 8;
  } else if (r < 0.50) {                            // 跳跃路障 + 拱形金币
    const lane = (rng() * 3) | 0;
    addBarrier(z + 10, lane);
    const ys = [0.55, 0.95, 1.15, 0.95, 0.55];
    for (let i = 0; i < 5; i++) addCoin(z + 10 + (i - 2) * 3, lane, ys[i]);
    gap = 30 + rng() * 8;
  } else if (r < 0.66) {                            // 红墙换道
    const free = (rng() * 3) | 0;
    const others = [0, 1, 2].filter(l => l !== free);
    const nBlk = (diff > 0.35 && rng() < 0.55) ? 2 : 1;
    for (let i = 0; i < nBlk; i++) addBlock(z + 6, others[i]);
    if (rng() < 0.6) for (let i = 0; i < 4; i++) addCoin(z + 2 + i * 4, free);
    gap = lerp(30, 22, diff) + rng() * 6;
  } else if (r < 0.80) {                            // 路障排（可全跳）
    const lanes = [0, 1, 2].sort(() => rng() - 0.5);
    const nB = (diff > 0.55 && rng() < 0.35) ? 3 : 2;
    for (let i = 0; i < nB; i++) addBarrier(z + 6, lanes[i]);
    gap = lerp(28, 21, diff) + rng() * 6;
  } else if (r < 0.87 && z - S.lastShieldZ > 200) { // 护盾道具
    S.lastShieldZ = z;
    S.obj.push({ kind: 'shield', z, lane: (rng() * 3) | 0, dead: false });
    gap = 26;
  } else {                                          // 蛇形金币
    let lane = (rng() * 3) | 0;
    for (let i = 0; i < 8; i++) {
      addCoin(z + i * 4, lane);
      if (i % 2 === 1) lane = clamp(lane + (rng() < 0.5 ? -1 : 1), 0, 2);
    }
    gap = 40 + rng() * 8;
  }
  S.objZ = z + Math.max(gap, 20);
}

function spawnDecorAt(z, slot) {
  const w = phaseWeights(z);
  const dom = (w[0] >= w[1] && w[0] >= w[2]) ? 0 : (w[1] >= w[2] ? 1 : 2);
  const r = S.rng();
  const side = r < 0.5 ? -1 : 1;
  if (dom === 0) {                                  // 海滨：棕榈与灌木
    S.dec.push({ kind: 'palm', z, x: side * (2.5 + S.rng() * 0.9), seed: S.rng() });
    if (r < 0.45) S.dec.push({ kind: 'palm', z: z + 4, x: -side * (2.5 + S.rng() * 0.9), seed: S.rng() });
    if (r > 0.8) S.dec.push({ kind: 'bush', z: z + 8, x: -side * (2.3 + S.rng() * 0.5), seed: S.rng() });
  } else if (dom === 1) {                           // 高架：桥墩、广告牌、路灯
    if (slot % 2 === 0) {
      S.dec.push({ kind: 'pillar', z, x: -2.5 });
      S.dec.push({ kind: 'pillar', z, x: 2.5 });
    } else if (r < 0.4) {
      S.dec.push({ kind: 'billboard', z, x: side * (3.1 + S.rng() * 0.5), seed: S.rng(), col: NEON_COLS[(S.rng() * NEON_COLS.length) | 0] });
    } else if (r > 0.78) {
      S.dec.push({ kind: 'lamp', z, x: side * 2.3, dir: -side });
    }
  } else {                                          // 夜街：灯牌、路灯
    if (r < 0.72) {
      S.dec.push({
        kind: 'neon', z, x: side * (2.6 + S.rng() * 0.6),
        seed: S.rng(), col: NEON_COLS[(S.rng() * NEON_COLS.length) | 0],
        txt: NEON_TXT[(S.rng() * NEON_TXT.length) | 0]
      });
    }
    if (slot % 2 === 0) S.dec.push({ kind: 'lamp', z: z + 6, x: -side * 2.3, dir: side });
    if (r > 0.9) S.dec.push({ kind: 'pillar', z: z + 2, x: -side * 2.6 });
  }
}

function genWorld() {
  S.dec = []; S.obj = [];
  S.decorZ = 6; S.objZ = 58; S.lastShieldZ = -999;
  S.rng = mulberry32((Math.random() * 1e9) | 0);
  fillAhead();
}
function fillAhead() {
  const limit = S.distance + view.zFar + 40;
  let slot = Math.round(S.decorZ / 12);
  while (S.decorZ < limit) { spawnDecorAt(S.decorZ, slot); S.decorZ += 12; slot++; }
  while (S.objZ < limit) spawnChunk(S.objZ);
}
function cull() {
  const dmin = S.distance + 0.9;
  while (S.dec.length && S.dec[0].z < dmin) S.dec.shift();
  while (S.obj.length && S.obj[0].z < dmin) S.obj.shift();
}

/* ---------------- 输入 ---------------- */
function move(dir) {
  if (S.mode !== 'running') return;
  const ni = clamp(S.laneIdx + dir, 0, 2);
  if (ni !== S.laneIdx) { S.laneIdx = ni; sLane(); }
}
function jump() {
  if (S.mode !== 'running' || S.jumping) return;
  S.jumping = true; S.vy = CFG.jumpV; sJump();
}
function togglePause() {
  if (S.mode === 'running') { S.mode = 'paused'; showPanel('pause'); setTouchVisible(false); }
  else if (S.mode === 'paused') resumeGame();
}
function resumeGame() { S.mode = 'running'; hideOverlay(); setTouchVisible(true); }
function toggleMute() {
  S.muted = !S.muted; saveMuted(S.muted); updateMuteIcon();
}
function updateMuteIcon() { setText(ui.mute, S.muted ? '🔇' : '🔊'); }

document.addEventListener('keydown', e => {
  const k = e.key;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].indexOf(k) >= 0) e.preventDefault();
  ensureAudio();
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') move(-1);
  else if (k === 'ArrowRight' || k === 'd' || k === 'D') move(1);
  else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') {
    if (S.mode === 'menu') startGame(); else jump();
  } else if (k === 'Enter') {
    if (S.mode === 'menu' || (S.mode === 'fail' && S.failShown) || (S.mode === 'finish' && S.winShown)) startGame();
  } else if (k === 'p' || k === 'P' || k === 'Escape') togglePause();
  else if (k === 'm' || k === 'M') toggleMute();
});

// 触屏：底部按钮 + 滑动手势
const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
function setTouchVisible(v) { if (hasTouch) ui.touch.hidden = !v; }
function bindBtn(id, fn) {
  const el = $(id);
  el.addEventListener('pointerdown', e => { e.preventDefault(); ensureAudio(); fn(); }, { passive: false });
}
bindBtn('tb-left', () => move(-1));
bindBtn('tb-right', () => move(1));
bindBtn('tb-jump', () => jump());

let swipe = null;
canvas.addEventListener('pointerdown', e => { ensureAudio(); swipe = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', e => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  swipe = null;
  if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1);
  else if (dy < -36) jump();
  else if (Math.abs(dx) < 12 && Math.abs(dy) < 12) jump();   // 轻点即跳
});
canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

document.addEventListener('visibilitychange', () => { if (document.hidden && S.mode === 'running') togglePause(); });
window.addEventListener('blur', () => { if (S.mode === 'running') togglePause(); });

/* ---------------- UI 流程 ---------------- */
function showPanel(name) {
  ui.overlay.hidden = false;
  for (const k in ui.panels) ui.panels[k].hidden = (k !== name);
}
function hideOverlay() { ui.overlay.hidden = true; }
function restartCountAnim() {
  try { ui.countNum.style.animation = 'none'; void ui.countNum.offsetWidth; ui.countNum.style.animation = ''; } catch (e) {}
}
function updateMenuBest() {
  const b = loadBest();
  if (b > 0) { ui.menuBest.hidden = false; setText(ui.menuBest, '🏆 最佳完赛纪录 · ' + fmtTime(b / 1000)); }
}
function startGame() {
  S.attract = false;
  resetRun();
  S.mode = 'count'; S.countT = 3.0; S.lastCount = null;
  ui.hud.hidden = true;
  showPanel('count');
  setTouchVisible(true);
}
function resetRun() {
  S.distance = 0; S.time = 0; S.coins = 0; S.speed = 0;
  S.laneIdx = 1; S.laneX = 0; S.y = 0; S.vy = 0; S.jumping = false;
  S.shield = false; S.invuln = 0; S.runPhase = 0;
  S.curve = 0; S.curveTarget = 0; S.curveTimer = 1;
  S.crashT = 0; S.failShown = false; S.failKind = '';
  S.finishT = 0; S.winShown = false; S.finalTime = 0; S.goT = null;
  S.particles = []; S.confetti = [];
  genWorld();
  updateHUD();
}
function zoneName(d) {
  return d < 300 ? '🏖️ 海滨公路段' : d < 700 ? '🌆 城市高架段' : '🌃 灯牌街区段';
}
function fillFailPanel() {
  setText(ui.failDist, Math.floor(S.distance) + ' m');
  setText(ui.failCoins, '🪙 ' + S.coins);
  setText(ui.failZone, zoneName(S.distance));
  const tip = S.failKind === 'block'
    ? '深红高墙跳不过去，提前换到空跑道。'
    : S.failKind === 'barrier'
      ? '橙色路障要提前起跳，金币拱就是起跳点。'
      : '注意前方跑道上的障碍，护盾可以挡一次撞击。';
  setText(ui.failTip, '💡 ' + tip);
}
function fillWinPanel() {
  setText(ui.winTime, fmtTime(S.finalTime));
  setText(ui.winCoins, '🪙 ' + S.coins);
  setText(ui.winMedal, S.coins >= 90 ? '🥇' : S.coins >= 60 ? '🥈' : '🥉');
  const prev = loadBest();
  if (!prev || S.finalTime * 1000 < prev) {
    saveBest(Math.round(S.finalTime * 1000));
    setText(ui.winBest, '🏅 新纪录！' + fmtTime(S.finalTime));
  } else {
    setText(ui.winBest, fmtTime(prev / 1000));
  }
  updateMenuBest();
}
function failRun(kind) {
  S.failKind = kind;
  S.mode = 'fail'; S.crashT = 0;
  sCrash();
  try { if (navigator.vibrate) navigator.vibrate(180); } catch (e) {}
}
function finishRun() {
  S.finalTime = S.time;
  S.mode = 'finish'; S.finishT = 0;
  sFinish();
  const W = view.w, H = view.h;
  const cols = ['#ff5a5f', '#ffd166', '#3fb6ff', '#8f7bff', '#3ddc97'];
  for (let i = 0; i < 120; i++) {
    S.confetti.push({
      x: Math.random() * W, y: -20 - Math.random() * H * 0.4,
      vx: (Math.random() - 0.5) * 130, vy: 60 + Math.random() * 170,
      rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 10,
      col: cols[(Math.random() * cols.length) | 0], life: 3 + Math.random() * 2
    });
  }
}
function hitObstacle(o) {
  if (S.shield) {
    S.shield = false; S.invuln = 1.3;
    sBreak();
    burst(proj(S.laneX, 0.6, CFG.pz), '#54dcff', 14);
    return;
  }
  failRun(o.kind);
}

/* ---------------- 碰撞 ---------------- */
function collide() {
  const pz = CFG.pz;
  for (const o of S.obj) {
    if (o.dead) continue;
    const rz = o.z - S.distance;
    if (rz < pz - CFG.objWin || rz > pz + CFG.objWin) continue;
    if (Math.abs(S.laneX - CFG.laneX[o.lane]) > 0.62) continue;
    if (o.kind === 'coin') {
      if (Math.abs(S.y - o.y) < 0.95) {
        o.dead = true; S.coins++; sCoin();
        burst(proj(CFG.laneX[o.lane], o.y, rz), '#ffd45c', 7);
      }
    } else if (o.kind === 'shield') {
      o.dead = true; S.shield = true; sShield();
    } else if (o.kind === 'barrier') {
      if (S.invuln <= 0 && S.y < 0.52) hitObstacle(o);
    } else if (o.kind === 'block') {
      if (S.invuln <= 0 && S.y < 1.42) hitObstacle(o);
    }
    if (S.mode !== 'running') break;
  }
}

/* ---------------- 粒子 ---------------- */
function burst(p, col, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 160;
    S.particles.push({
      x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
      life: 0.35 + Math.random() * 0.3, max: 0.6, r: 1.5 + Math.random() * 2.5,
      col, grav: 320
    });
  }
}
function landPuff() {
  const g = proj(S.laneX, 0, CFG.pz);
  for (let i = 0; i < 6; i++) {
    S.particles.push({
      x: g.x + (Math.random() - 0.5) * 20, y: g.y, vx: (Math.random() - 0.5) * 60, vy: -20 - Math.random() * 40,
      life: 0.3, max: 0.3, r: 2 + Math.random() * 2, col: 'rgba(220,225,235,0.8)', grav: 60
    });
  }
}
function updateParticles(dt) {
  for (let i = S.particles.length - 1; i >= 0; i--) {
    const p = S.particles[i];
    p.life -= dt;
    if (p.life <= 0) { S.particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.grav * dt;
  }
  for (let i = S.confetti.length - 1; i >= 0; i--) {
    const c = S.confetti[i];
    c.life -= dt;
    if (c.life <= 0 || c.y > view.h + 30) { S.confetti.splice(i, 1); continue; }
    c.x += c.vx * dt; c.y += c.vy * dt; c.vy += 220 * dt; c.rot += c.vr * dt;
  }
  const sf = Math.max(clamp((S.speed - 16.2) / 3.3, 0, 1), WP.w[2] * 0.6);
  for (const L of LINES) {
    L.life -= dt * (sf > 0.05 ? 1.4 : 3);
    if (L.life <= 0) {
      L.x = Math.random() * view.w;
      L.y = view.hy + Math.random() * (view.h - view.hy);
      L.life = 0.3 + Math.random() * 0.5;
    }
  }
}

/* ---------------- 主更新 ---------------- */
function update(dt) {
  S.t += dt;
  S.curveTimer -= dt;
  if (S.curveTimer <= 0) {
    S.curveTimer = 2.5 + Math.random() * 2.5;
    const amp = (!S.attract && S.distance > 930) ? 0 : 0.30;
    S.curveTarget = (Math.random() * 2 - 1) * amp;
  }
  S.curve += (S.curveTarget - S.curve) * Math.min(1, dt * 1.1);

  if (S.mode === 'menu') {
    S.distance += 8 * dt;
    if (S.distance > 1040) { S.distance = 0; genWorld(); }
  } else if (S.mode === 'count') {
    S.countT -= dt;
    const n = Math.ceil(S.countT);
    if (n !== S.lastCount && n > 0) { S.lastCount = n; setText(ui.countNum, String(n)); restartCountAnim(); sCount(n); }
    if (S.countT <= 0) {
      setText(ui.countNum, 'GO!'); restartCountAnim(); sCount(0);
      S.mode = 'running'; S.time = 0;
      ui.hud.hidden = false;
      S.goT = 0;
    }
  } else if (S.mode === 'running') {
    S.time += dt;
    S.speed = Math.min(CFG.speedMax, CFG.speedBase + S.distance * CFG.speedRamp);
    S.distance += S.speed * dt;
    if (S.goT != null) { S.goT += dt; if (S.goT > 0.55) { hideOverlay(); S.goT = null; } }
    if (S.distance >= 1000) finishRun();
  } else if (S.mode === 'finish') {
    S.finishT += dt;
    S.speed = Math.max(3.5, S.speed - 12 * dt);
    S.distance += S.speed * dt;
    if (S.finishT > 1.45 && !S.winShown) { S.winShown = true; fillWinPanel(); showPanel('win'); setTouchVisible(false); }
  } else if (S.mode === 'fail') {
    S.crashT += dt;
    if (S.crashT > 0.95 && !S.failShown) { S.failShown = true; fillFailPanel(); showPanel('fail'); setTouchVisible(false); }
  }

  if (S.mode !== 'menu') {
    const target = CFG.laneX[S.laneIdx];
    S.laneX += (target - S.laneX) * Math.min(1, dt * CFG.laneRate);
    if (S.jumping) {
      S.vy -= CFG.g * dt; S.y += S.vy * dt;
      if (S.y <= 0) { S.y = 0; S.vy = 0; S.jumping = false; landPuff(); }
    }
    S.runPhase += (S.mode === 'fail' ? 2 : (S.speed * 0.55 + 4)) * dt * 2.2;
  }
  if (S.invuln > 0) S.invuln -= dt;

  fillAhead(); cull();
  if (S.mode === 'running') collide();
  updateParticles(dt);
  updateHUD();
}

function updateHUD() {
  setText(ui.coin, '🪙 ' + S.coins);
  setText(ui.time, fmtTime(S.mode === 'finish' ? S.finalTime : S.time));
  const pct = clamp(S.distance / 1000 * 100, 0, 100);
  ui.fill.style.width = pct.toFixed(1) + '%';
  ui.dot.style.left = pct.toFixed(1) + '%';
  if (S.shield) ui.shieldBadge.classList.remove('off');
  else ui.shieldBadge.classList.add('off');
}

/* ---------------- 渲染：天空 ---------------- */
function drawSky() {
  const W = view.w, H = view.h, hy = view.hy;
  const g = ctx.createLinearGradient(0, 0, 0, hy + 2);
  g.addColorStop(0, css(WP.skyTop)); g.addColorStop(1, css(WP.skyBot));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, hy + 2);

  const w0 = WP.w[0], w1 = WP.w[1], w3 = WP.w[2];
  if (w3 > 0.02) {                                     // 星
    for (const st of STARS) {
      const a = w3 * (0.35 + 0.65 * Math.abs(Math.sin(S.t * 1.8 + st.ph)));
      ctx.fillStyle = 'rgba(240,244,255,' + a.toFixed(3) + ')';
      ctx.fillRect(st.u * W, st.v * hy * 0.96, st.s, st.s);
    }
  }
  if (w0 > 0.02) {                                     // 太阳
    const sx = W * 0.76, sy = hy - H * 0.20, sr = H * 0.055;
    const gl = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 3.2);
    gl.addColorStop(0, 'rgba(255,244,214,' + (0.85 * w0).toFixed(3) + ')');
    gl.addColorStop(1, 'rgba(255,244,214,0)');
    ctx.fillStyle = gl; ctx.fillRect(sx - sr * 3.2, sy - sr * 3.2, sr * 6.4, sr * 6.4);
    ctx.fillStyle = 'rgba(255,250,235,' + w0.toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
  }
  if (w3 > 0.02) {                                     // 月亮
    const mx = W * 0.70, my = hy - H * 0.26, mr = H * 0.040;
    ctx.fillStyle = 'rgba(244,240,224,' + (w3 * 0.95).toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = w3; ctx.fillStyle = css(WP.skyTop);
    ctx.beginPath(); ctx.arc(mx + mr * 0.42, my - mr * 0.22, mr * 0.86, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  const ca = Math.min(1, w0 * 0.9 + w1 * 0.35);        // 云
  if (ca > 0.03) {
    ctx.fillStyle = 'rgba(255,255,255,' + (ca * 0.8).toFixed(3) + ')';
    for (const c of CLOUDS) {
      const x = mod(c.u * W - S.distance * 0.30 + S.t * 6 * c.sp, W + 260) - 130;
      const y = c.v * hy * 0.5 + hy * 0.10, s = c.sc * H * 0.03;
      ctx.beginPath();
      ctx.ellipse(x, y, s * 1.7, s * 0.62, 0, 0, Math.PI * 2);
      ctx.ellipse(x - s, y + s * 0.18, s * 0.95, s * 0.5, 0, 0, Math.PI * 2);
      ctx.ellipse(x + s, y + s * 0.16, s * 1.05, s * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const ga = Math.min(0.8, w0 * 0.9 + w1 * 0.5);       // 海鸥
  if (ga > 0.04) {
    ctx.strokeStyle = 'rgba(48,60,80,' + ga.toFixed(3) + ')';
    ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    for (const gl2 of GULLS) {
      const x = mod(gl2.u * W + S.t * 16 * gl2.sp, W + 140) - 70;
      const y = gl2.v * hy * 0.75 + Math.sin(S.t * 1.3 + gl2.ph) * 12;
      const fl = Math.sin(S.t * 7 + gl2.ph) * 3.5;
      ctx.beginPath();
      ctx.moveTo(x - 7, y); ctx.quadraticCurveTo(x - 3.5, y - 4 - fl, x, y);
      ctx.quadraticCurveTo(x + 3.5, y - 4 - fl, x + 7, y); ctx.stroke();
    }
  }
}

/* ---------------- 渲染：远景（海面、帆船、天际线） ---------------- */
function drawBackdrop() {
  const W = view.w, H = view.h, hy = view.hy;
  if (WP.w[0] > 0.01) {                                // 海面
    const sh = H * 0.070;
    ctx.globalAlpha = WP.w[0];
    const g = ctx.createLinearGradient(0, hy - sh, 0, hy + 1);
    g.addColorStop(0, '#2e7cb5'); g.addColorStop(1, '#8ed2ee');
    ctx.fillStyle = g; ctx.fillRect(0, hy - sh, W, sh + 1);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 12; i++) {
      const yy = hy - sh + (i / 12) * sh;
      const xx = mod(i * 137.5 - S.distance * 1.2 + S.t * 20, W);
      ctx.fillRect(xx, yy, 18 + i * 2.2, 1);
    }
    for (const b of BOATS) {                           // 帆船
      const x = mod(b.u * W + S.t * 7 * b.sp, W + 120) - 60;
      const y = hy - sh * 0.35 + b.dv * sh * 0.4;
      const s = H * 0.016 * (0.8 + b.sc * 0.4);
      ctx.fillStyle = '#f6f9fc';
      ctx.beginPath(); ctx.moveTo(x, y - s * 1.6); ctx.lineTo(x, y); ctx.lineTo(x - s * 0.75, y); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + s * 0.12, y - s * 1.2); ctx.lineTo(x + s * 0.12, y); ctx.lineTo(x + s * 0.85, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#31465e'; ctx.fillRect(x - s * 0.85, y, s * 1.8, s * 0.28);
    }
    ctx.globalAlpha = 1;
  }
  skylineLayer(SKY_FAR, 0.34, FAR_TONES, 0.42);
  skylineLayer(SKY_MID, 0.62, MID_TONES, 0.15);
}
function skylineLayer(arr, factor, tones, haze) {
  const W = view.w, hy = view.hy, H = view.h;
  const span = 3000, sc = clamp(W / 1000, 0.62, 1.5);
  const off = mod(S.distance * factor * 2.2, span);
  const sway = -S.curve * H * (factor > 0.5 ? 0.10 : 0.06);
  const tone = mix3arr(tones[0], tones[1], tones[2], WP.w);
  ctx.fillStyle = css(mixA(tone, WP.skyBot, haze));
  for (let k = -1; k <= 1; k++) {
    for (const b of arr) {
      const bx = (b.u - off + k * span) * sc + sway;
      if (bx > W || bx + b.w * sc < 0) continue;
      const bh = b.h * H;
      ctx.fillRect(bx, hy - bh + 1, b.w * sc, bh);
    }
  }
  const wl = WP.w[2] * 0.95 + WP.w[1] * 0.10;          // 夜窗
  if (wl > 0.05) {
    ctx.fillStyle = 'rgba(255,214,110,' + Math.min(0.9, wl).toFixed(3) + ')';
    for (let k = -1; k <= 1; k++) {
      for (const b of arr) {
        const bx = (b.u - off + k * span) * sc + sway;
        if (bx > W || bx + b.w * sc < 0) continue;
        const bh = b.h * H;
        for (const wd of b.win) {
          ctx.fillRect(bx + wd.x * b.w * sc, hy - bh + 1 + wd.y * bh, Math.max(1.5, 2.2 * sc), Math.max(2, 3.2 * sc));
        }
      }
    }
  }
}

/* ---------------- 渲染：路面与护栏 ---------------- */
function quadZ(xa, xb, z1, z0, fill) {
  const a = proj(xa, 0, z1), b = proj(xb, 0, z1), c = proj(xb, 0, z0), d = proj(xa, 0, z0);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
  ctx.closePath(); ctx.fill();
}
function rectZ(xa, xb, ya, yb, rz, fill) {
  const a = proj(xa, ya, rz), b = proj(xb, yb, rz);
  ctx.fillStyle = fill;
  ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
  return a;
}
function drawGroundRoad() {
  const W = view.w, H = view.h, hy = view.hy;
  ctx.fillStyle = css(WP.ground);
  ctx.fillRect(0, hy, W, H - hy);
  const N = 44, zn = view.zNear, zf = view.zFar, d = S.distance;
  for (let i = N; i >= 1; i--) {
    const z1 = zn * Math.pow(zf / zn, i / N);
    const z0 = zn * Math.pow(zf / zn, (i - 1) / N);
    const stripe = Math.floor((d + z1) / 3) % 2 === 0;
    quadZ(-CFG.roadHalf, CFG.roadHalf, z1, z0, shadeArr(stripe ? WP.roadA : WP.roadB, z1));
    const ecol = shadeArr(WP.edge, z1);
    quadZ(-CFG.roadHalf + 0.02, -CFG.roadHalf + 0.11, z1, z0, ecol);
    quadZ(CFG.roadHalf - 0.11, CFG.roadHalf - 0.02, z1, z0, ecol);
    if (Math.floor((d + z1) / 4) % 2 === 0) {          // 车道虚线
      const dcol = shadeArr(WP.dash, z1);
      quadZ(-0.52, -0.44, z1, z0, dcol);
      quadZ(0.44, 0.52, z1, z0, dcol);
    }
  }
}
function railBand(x, yT, yB) {
  const step = 4;
  let z0 = Math.floor((S.distance + view.zNear) / step) * step - step;
  let pT = null, pB = null;
  for (; z0 < S.distance + view.zFar; z0 += step) {
    const rz = z0 - S.distance;
    if (rz < view.zNear - 0.01) { pT = null; pB = null; continue; }
    const t = proj(x, yT, rz), b = proj(x, yB, rz);
    if (pT) {
      ctx.fillStyle = shadeArr(WP.rail, rz);
      ctx.beginPath();
      ctx.moveTo(pT.x, pT.y); ctx.lineTo(t.x, t.y);
      ctx.lineTo(b.x, b.y); ctx.lineTo(pB.x, pB.y);
      ctx.closePath(); ctx.fill();
    }
    pT = t; pB = b;
  }
}
function drawRails() {
  for (let side = -1; side <= 1; side += 2) {
    const x = side * (CFG.roadHalf + 0.10);
    railBand(x, 0.62, 0.55);
    railBand(x, 0.36, 0.31);
    let z = Math.floor((S.distance + view.zNear) / 3) * 3;
    for (; z < S.distance + view.zFar; z += 3) {
      const rz = z - S.distance;
      if (rz < view.zNear - 0.01) continue;
      const b = proj(x, 0, rz), t = proj(x, 0.58, rz);
      if (b.s < 1.5) continue;
      const wpx = Math.max(1, 0.05 * b.s);
      ctx.fillStyle = shadeArr(WP.railDark, rz);
      ctx.fillRect(t.x - wpx / 2, t.y, wpx, b.y - t.y);
    }
  }
}

/* ---------------- 渲染：装饰物 ---------------- */
function drawDecor(dc) {
  const rz = dc.z - S.distance;
  const x = dc.x;
  if (dc.kind === 'palm') {
    const h = 1.35 + dc.seed * 0.6;
    const b = proj(x, 0, rz), t = proj(x, h, rz);
    ctx.strokeStyle = shadeArr(COL.trunk, rz); ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, 0.07 * b.s);
    ctx.beginPath(); ctx.moveTo(b.x, b.y);
    ctx.quadraticCurveTo(b.x + 0.10 * b.s, (b.y + t.y) / 2, t.x, t.y); ctx.stroke();
    const fw = 0.5 * b.s * (0.8 + dc.seed * 0.4);
    ctx.strokeStyle = shadeArr(COL.leaf, rz);
    ctx.lineWidth = Math.max(1.2, 0.045 * b.s);
    for (let k = 0; k < 5; k++) {
      const ang = -Math.PI / 2 + (k - 2) * 0.5;
      const ex = t.x + Math.cos(ang) * fw, ey = t.y + Math.sin(ang) * fw * 0.6;
      ctx.beginPath(); ctx.moveTo(t.x, t.y);
      ctx.quadraticCurveTo(t.x + Math.cos(ang) * fw * 0.5, t.y + Math.sin(ang) * fw * 0.6 - 0.08 * b.s, ex, ey);
      ctx.stroke();
    }
  } else if (dc.kind === 'bush') {
    const b = proj(x, 0, rz);
    ctx.fillStyle = shadeArr(COL.leaf, rz);
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, Math.max(2, 0.30 * b.s), Math.max(1.5, 0.20 * b.s), 0, Math.PI, 0);
    ctx.fill();
  } else if (dc.kind === 'pillar') {
    const b = proj(x, 0, rz);
    const w = Math.max(2, 0.5 * b.s);
    ctx.fillStyle = shadeArr(COL.pillar, rz);
    ctx.fillRect(b.x - w / 2, b.y, w, view.h - b.y);
    const cw = Math.max(1, 0.08 * b.s);
    ctx.fillStyle = shadeHex('#454d59', rz);
    ctx.fillRect(b.x - w / 2 - cw, b.y, w + cw * 2, Math.max(2, 0.12 * b.s));
  } else if (dc.kind === 'billboard') {
    const b = proj(x, 0, rz);
    const pw = Math.max(1.5, 0.06 * b.s);
    const top = proj(x, 1.1, rz);
    ctx.fillStyle = shadeArr(COL.pole, rz);
    ctx.fillRect(b.x - pw / 2, top.y, pw, b.y - top.y);
    const p1 = proj(x - 0.95, 1.9, rz), p2 = proj(x + 0.95, 1.0, rz);
    ctx.fillStyle = shadeArr(COL.bbBg, rz);
    ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
    const bx = p1.x + (p2.x - p1.x) * 0.08, bw = (p2.x - p1.x) * 0.84;
    const by = p1.y + (p2.y - p1.y) * 0.12, bh = (p2.y - p1.y) * 0.76;
    ctx.fillStyle = dc.col;
    ctx.fillRect(bx, by, bw, bh * 0.55);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(bx, by + bh * 0.65, bw * 0.6, Math.max(1, bh * 0.10));
    ctx.fillRect(bx, by + bh * 0.82, bw * 0.4, Math.max(1, bh * 0.10));
  } else if (dc.kind === 'neon') {
    const b = proj(x, 0, rz);
    const pw = Math.max(1.2, 0.045 * b.s);
    const top = proj(x, 1.75, rz);
    ctx.fillStyle = shadeArr(COL.pole, rz);
    ctx.fillRect(b.x - pw / 2, top.y, pw, b.y - top.y);
    const p1 = proj(x - 0.26, 1.72, rz), p2 = proj(x + 0.26, 0.62, rz);
    const bw = p2.x - p1.x, bh = p2.y - p1.y;
    ctx.save();
    if (rz < 30) { ctx.shadowColor = dc.col; ctx.shadowBlur = Math.min(20, 0.35 * b.s); }
    ctx.fillStyle = shadeArr(COL.neonBg, rz);
    ctx.fillRect(p1.x, p1.y, bw, bh);
    ctx.restore();
    ctx.strokeStyle = dc.col;
    ctx.lineWidth = Math.max(1, 0.03 * b.s);
    ctx.strokeRect(p1.x, p1.y, bw, bh);
    const flick = 0.72 + 0.28 * Math.abs(Math.sin(S.t * 7 + dc.seed * 13));
    ctx.save();
    ctx.globalAlpha = flick;
    if (rz < 30) { ctx.shadowColor = dc.col; ctx.shadowBlur = Math.min(16, 0.3 * b.s); }
    ctx.fillStyle = dc.col;
    ctx.font = '700 ' + (0.30 * b.s).toFixed(1) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let ci = 0; ci < dc.txt.length; ci++) {
      ctx.fillText(dc.txt[ci], (p1.x + p2.x) / 2, p1.y + bh * (0.30 + ci * 0.40));
    }
    ctx.restore();
  } else if (dc.kind === 'lamp') {
    const b = proj(x, 0, rz);
    const top = proj(x, 2.05, rz);
    const pw = Math.max(1.2, 0.05 * b.s);
    ctx.strokeStyle = shadeArr(COL.pole, rz); ctx.lineWidth = pw; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(top.x, top.y); ctx.stroke();
    const arm = proj(x - dc.dir * 0.55, 1.95, rz);
    ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(arm.x, arm.y); ctx.stroke();
    const lr = Math.max(1.5, 0.10 * b.s);
    if (WP.w[2] > 0.1) {
      ctx.save();
      ctx.shadowColor = 'rgba(255,214,120,0.95)';
      ctx.shadowBlur = Math.min(22, 0.4 * b.s);
      ctx.fillStyle = css(COL.lampWarm);
      ctx.beginPath(); ctx.ellipse(arm.x, arm.y + lr * 0.4, lr, lr * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      const gp = proj(x - dc.dir * 0.55, 0, rz);
      const rr = Math.max(4, 0.9 * b.s);
      const grd = ctx.createRadialGradient(gp.x, gp.y, 0, gp.x, gp.y, rr);
      grd.addColorStop(0, 'rgba(255,214,120,' + (0.30 * WP.w[2]).toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(255,214,120,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.ellipse(gp.x, gp.y, rr, Math.max(2, 0.35 * b.s), 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = shadeArr(COL.lampOff, rz);
      ctx.beginPath(); ctx.ellipse(arm.x, arm.y + lr * 0.4, lr, lr * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/* ---------------- 渲染：跑道物体（金币/路障/红墙/护盾/终点） ---------------- */
function drawObj(o) {
  const rz = o.z - S.distance;
  const lx = CFG.laneX[o.lane];
  if (o.kind === 'coin') {
    const p = proj(lx, o.y, rz);
    const spin = Math.abs(Math.cos(S.t * 4 + o.seed * 9));
    const r = Math.max(1.5, 0.21 * p.s * (0.35 + 0.65 * spin));
    ctx.save();
    if (rz < 28) { ctx.shadowColor = 'rgba(255,205,80,0.9)'; ctx.shadowBlur = Math.min(18, 0.3 * p.s); }
    ctx.fillStyle = '#ffd45c';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#a87500';
    ctx.lineWidth = Math.max(1, 0.03 * p.s);
    ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 0.55, r * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (o.kind === 'barrier') {
    const leg = shadeHex('#5a6472', rz);
    rectZ(lx - 0.40, lx - 0.32, 0.16, 0, rz, leg);
    rectZ(lx + 0.32, lx + 0.40, 0.16, 0, rz, leg);
    const a = rectZ(lx - 0.46, lx + 0.46, 0.58, 0.16, rz, shadeHex('#ff7a3d', rz));
    rectZ(lx - 0.46, lx + 0.46, 0.42, 0.32, rz, shadeHex('#ffffff', rz));
    if (WP.w[2] > 0.15) {                              // 夜间警示灯
      const p = proj(lx, 0.63, rz);
      const blink = Math.sin(S.t * 6 + rz * 0.7) > 0;
      ctx.fillStyle = blink ? '#ff4d5e' : shadeHex('#7a2a32', rz);
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.5, 0.05 * p.s), 0, Math.PI * 2); ctx.fill();
    }
  } else if (o.kind === 'block') {
    rectZ(lx - 0.5, lx + 0.5, 1.42, 1.12, rz, shadeHex('#8e2340', rz));
    rectZ(lx - 0.5, lx + 0.5, 1.12, 0, rz, shadeHex('#c2334d', rz));
    const band = shadeHex('#f2f4f8', rz);
    slantBand(lx, 0.5, 1.00, 0.82, rz, band);
    slantBand(lx, 0.5, 0.62, 0.44, rz, band);
    rectZ(lx - 0.53, lx + 0.53, 1.46, 1.40, rz, WP.w[2] > 0.2 ? '#ff4d5e' : shadeHex('#e8ecf2', rz));
    if (WP.w[2] > 0.15) {
      const p = proj(lx, 1.5, rz);
      const blink = Math.sin(S.t * 6 + rz * 0.7) > 0;
      ctx.fillStyle = blink ? '#ffd166' : shadeHex('#7a5a20', rz);
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.5, 0.05 * p.s), 0, Math.PI * 2); ctx.fill();
    }
  } else if (o.kind === 'shield') {
    const p = proj(lx, 0.7, rz);
    const r = Math.max(3, 0.30 * p.s);
    ctx.save();
    ctx.shadowColor = 'rgba(80,220,255,0.9)';
    ctx.shadowBlur = 14;
    ctx.strokeStyle = '#54dcff';
    ctx.lineWidth = Math.max(2, 0.07 * p.s);
    ctx.setLineDash([0.22 * p.s, 0.14 * p.s]);
    ctx.lineDashOffset = -S.t * 0.8 * p.s;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.3, 0, Math.PI * 2); ctx.fill();
  }
}
function slantBand(lx, cw, yA, yB, rz, fill) {
  const sh = y => -y * 0.35;
  const p1 = proj(lx - cw + sh(yA), yA, rz), p2 = proj(lx + cw + sh(yA), yA, rz);
  const p3 = proj(lx + cw + sh(yB), yB, rz), p4 = proj(lx - cw + sh(yB), yB, rz);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y);
  ctx.closePath(); ctx.fill();
}
function drawFinish() {
  const rz = 1000 - S.distance;
  if (rz <= 0.9 || rz > view.zFar) return;
  for (let side = -1; side <= 1; side += 2) {
    const x = side * 1.95;
    const b = proj(x, 0, rz), t = proj(x, 2.1, rz);
    ctx.fillStyle = shadeHex('#f2f5f8', rz);
    ctx.fillRect(t.x, t.y, Math.max(2, 0.16 * b.s), b.y - t.y);
  }
  const p1 = proj(-1.95, 2.1, rz), p2 = proj(1.95, 1.62, rz);
  const grad = ctx.createLinearGradient(p1.x, 0, p2.x, 0);
  grad.addColorStop(0, shadeHex('#ff5a5f', rz));
  grad.addColorStop(1, shadeHex('#ffd166', rz));
  ctx.fillStyle = grad;
  ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
  const pt = proj(0, 1.86, rz);
  ctx.fillStyle = shadeHex('#ffffff', rz);
  ctx.font = '900 ' + (0.30 * pt.s).toFixed(1) + 'px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('FINISH', pt.x, pt.y);
  for (let c = 0; c < 12; c++) {                       // 格纹带
    const xa = -1.95 + c * (3.9 / 12), xb = xa + 3.9 / 12;
    rectZ(xa, xb, 1.62, 1.45, rz, c % 2 ? shadeHex('#10141f', rz) : shadeHex('#f5f7fa', rz));
  }
}

/* ---------------- 渲染：排序绘制世界 ---------------- */
function drawWorldSorted() {
  const list = [];
  const zf = view.zFar, d = S.distance;
  for (const dc of S.dec) {
    const rz = dc.z - d;
    if (rz > 0.9 && rz < zf) list.push([rz, drawDecor, dc]);
  }
  for (const o of S.obj) {
    if (o.dead) continue;
    const rz = o.z - d;
    if (rz > 0.9 && rz < zf) list.push([rz, drawObj, o]);
  }
  const frz = 1000 - d;
  if (frz > 0.9 && frz < zf) list.push([frz, drawFinish, null]);
  list.sort((a, b) => b[0] - a[0]);
  for (const it of list) it[1](it[2]);
}

/* ---------------- 渲染：玩家 ---------------- */
function drawPlayer() {
  if (S.mode === 'menu') return;
  const s = view.focal / CFG.pz;
  const gp = proj(S.laneX, 0, CFG.pz);
  const bp = proj(S.laneX, S.y, CFG.pz);
  const shR = 0.32 * s * (1 - Math.min(S.y / 1.7, 0.55));
  ctx.fillStyle = 'rgba(10,14,26,0.30)';
  ctx.beginPath(); ctx.ellipse(gp.x, gp.y, shR, shR * 0.32, 0, 0, Math.PI * 2); ctx.fill();

  ctx.save();
  ctx.translate(bp.x, bp.y);
  if (S.mode === 'fail') {
    ctx.rotate(Math.min(S.crashT * 7, 2.2));
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, S.crashT - 0.5) * 1.6);
  } else if (S.invuln > 0 && Math.floor(S.t * 14) % 2 === 0) {
    ctx.globalAlpha = 0.45;
  }
  const u = s;
  const air = S.jumping;
  const ph = S.runPhase;
  const sw = Math.sin(ph);

  if (S.shield) {                                      // 护盾环
    ctx.strokeStyle = 'rgba(84,220,255,' + (0.6 + 0.3 * Math.sin(S.t * 5)).toFixed(2) + ')';
    ctx.lineWidth = Math.max(2, 0.03 * u);
    ctx.beginPath(); ctx.arc(0, -0.31 * u, 0.42 * u, 0, Math.PI * 2); ctx.stroke();
  }
  // 双腿
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#22304d';
  ctx.lineWidth = 0.055 * u;
  ctx.beginPath();
  if (air) {
    ctx.moveTo(0, -0.30 * u); ctx.lineTo(0.10 * u, -0.20 * u); ctx.lineTo(0.16 * u, -0.08 * u);
    ctx.moveTo(0, -0.30 * u); ctx.lineTo(-0.06 * u, -0.18 * u); ctx.lineTo(-0.10 * u, -0.05 * u);
  } else {
    ctx.moveTo(0, -0.30 * u); ctx.lineTo(sw * 0.10 * u, -0.16 * u); ctx.lineTo(sw * 0.20 * u, 0);
    ctx.moveTo(0, -0.30 * u); ctx.lineTo(-sw * 0.10 * u, -0.16 * u); ctx.lineTo(-sw * 0.20 * u, 0);
  }
  ctx.stroke();
  // 鞋
  ctx.fillStyle = '#f5f7fa';
  if (air) {
    ctx.beginPath(); ctx.arc(0.16 * u, -0.08 * u, 0.035 * u, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-0.10 * u, -0.05 * u, 0.035 * u, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(sw * 0.20 * u, 0, 0.035 * u, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-sw * 0.20 * u, 0, 0.035 * u, 0, Math.PI * 2); ctx.fill();
  }
  // 背包
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(-0.14 * u, -0.50 * u, 0.09 * u, 0.17 * u);
  // 躯干
  ctx.strokeStyle = '#ff5a5f';
  ctx.lineWidth = 0.11 * u;
  ctx.beginPath(); ctx.moveTo(0, -0.30 * u); ctx.lineTo(0, -0.52 * u); ctx.stroke();
  // 手臂
  ctx.strokeStyle = '#e04850';
  ctx.lineWidth = 0.045 * u;
  const aw = air ? 0.8 : sw;
  ctx.beginPath();
  ctx.moveTo(0, -0.50 * u); ctx.lineTo(aw * 0.10 * u, -0.40 * u); ctx.lineTo(aw * 0.17 * u, -0.34 * u);
  ctx.moveTo(0, -0.50 * u); ctx.lineTo(-aw * 0.10 * u, -0.40 * u); ctx.lineTo(-aw * 0.17 * u, -0.34 * u);
  ctx.stroke();
  ctx.fillStyle = '#ffd9b8';
  ctx.beginPath(); ctx.arc(aw * 0.17 * u, -0.34 * u, 0.026 * u, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(-aw * 0.17 * u, -0.34 * u, 0.026 * u, 0, Math.PI * 2); ctx.fill();
  // 头
  ctx.fillStyle = '#ffd9b8';
  ctx.beginPath(); ctx.arc(0.02 * u, -0.61 * u, 0.075 * u, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2a2e3a';
  ctx.beginPath(); ctx.arc(0.02 * u, -0.63 * u, 0.072 * u, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
  ctx.restore();
}

/* ---------------- 渲染：特效与后期 ---------------- */
function drawFX() {
  const W = view.w, H = view.h, hy = view.hy;
  const sf = Math.max(clamp((S.speed - 16.2) / 3.3, 0, 1) * 0.8, WP.w[2] * 0.45);
  if (sf > 0.05 && (S.mode === 'running' || S.mode === 'finish')) {
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineCap = 'round';
    for (const L of LINES) {
      const dx = L.x - view.cx, dy = L.y - hy;
      const r = Math.max(20, Math.hypot(dx, dy));
      const nx = dx / r, ny = dy / r;
      const len = (14 + 50 * sf) * (1.2 - L.life);
      ctx.globalAlpha = clamp(L.life * 0.30 * sf, 0, 0.2);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(L.x - nx * len * 0.2, L.y - ny * len * 0.2);
      ctx.lineTo(L.x + nx * len * 0.8, L.y + ny * len * 0.8);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  for (const p of S.particles) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.col;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const c of S.confetti) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    ctx.globalAlpha = clamp(c.life, 0, 1);
    ctx.fillStyle = c.col;
    ctx.fillRect(-3.5, -5.5, 7, 11);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  if (WP.w[2] > 0.01) {                                // 夜色滤镜
    ctx.fillStyle = 'rgba(8,10,34,' + (WP.w[2] * 0.14).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
  }
  const vg = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.45, W / 2, H * 0.55, H * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(4,8,20,0.34)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

/* ---------------- 主渲染 ---------------- */
function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (S.mode === 'fail' && S.crashT < 0.35) {
    const a = (1 - S.crashT / 0.35) * 7;
    ctx.translate((Math.random() * 2 - 1) * a, (Math.random() * 2 - 1) * a);
  }
  WP = blendPal(S.distance);
  drawSky();
  drawBackdrop();
  drawGroundRoad();
  drawRails();
  drawWorldSorted();
  drawPlayer();
  drawFX();
}

/* ---------------- 启动 ---------------- */
let last = 0;
function tick(now) {
  requestAnimationFrame(tick);
  if (!last) last = now;
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (S.mode !== 'paused') update(dt);
  render();
}
function boot() {
  resize();
  WP = blendPal(0);   // 首帧 update 先于 render，需提前初始化混合调色板
  window.addEventListener('resize', resize);
  initAmbient();
  S.muted = loadMuted();
  updateMuteIcon();
  updateMenuBest();
  genWorld();
  S.mode = 'menu'; S.attract = true;
  ui.hud.hidden = true;
  showPanel('menu');
  setTouchVisible(false);
  ui.pauseBtn.addEventListener('click', () => togglePause());
  ui.mute.addEventListener('click', () => { ensureAudio(); toggleMute(); });
  $('btn-start').addEventListener('click', () => { ensureAudio(); startGame(); });
  $('btn-retry').addEventListener('click', () => { ensureAudio(); startGame(); });
  $('btn-again').addEventListener('click', () => { ensureAudio(); startGame(); });
  $('btn-restart').addEventListener('click', () => { ensureAudio(); startGame(); });
  $('btn-resume').addEventListener('click', () => { ensureAudio(); resumeGame(); });
  requestAnimationFrame(tick);
}
boot();

// 调试钩子（不影响游戏）
window.__CCS = { S, CFG, view, startGame, ui };
})();
