"use strict";
/*
 * Escape Cup — the game.
 *
 * Your flag-ball and a rival's bounce inside nested, spinning rings. A ring
 * SHATTERS the moment either ball pokes through its gap; whoever breaks the last
 * ring wins the match. Five wins (Round of 32 -> Final) lifts the cup.
 *
 * Controls (one finger): DRAG sideways to spin every ring, TAP to kick your ball
 * toward where you tapped. Keyboard: arrows / A-D spin, Space kicks upward.
 *
 * Physics is the same model as the Escape Cup TikTok sim (../escape-cup/sim.py),
 * plus surface friction so spinning the rings actually flings the balls.
 */

// ---------------------------------------------------------------- teams
const TEAMS = [
  ["br", "Brazil", "#1DB954"], ["ar", "Argentina", "#6CACE4"], ["fr", "France", "#2F5BEA"],
  ["gb-eng", "England", "#E8E8E8"], ["es", "Spain", "#F1BF00"], ["de", "Germany", "#FFCE00"],
  ["pt", "Portugal", "#E42518"], ["it", "Italy", "#1FA64A"], ["nl", "Netherlands", "#FF7F00"],
  ["be", "Belgium", "#FDDA24"], ["hr", "Croatia", "#E8112D"], ["ma", "Morocco", "#C1272D"],
  ["jp", "Japan", "#FF2A4F"], ["kr", "South Korea", "#3A6FD8"], ["us", "USA", "#4A7BF7"],
  ["mx", "Mexico", "#10A35B"], ["ca", "Canada", "#FF3030"], ["au", "Australia", "#FFCD00"],
  ["ng", "Nigeria", "#12B35C"], ["eg", "Egypt", "#E0303D"], ["sn", "Senegal", "#00B350"],
  ["tr", "Turkey", "#F0303A"], ["pl", "Poland", "#F03050"], ["ua", "Ukraine", "#FFD500"],
  ["ph", "Philippines", "#2E6BE6"], ["id", "Indonesia", "#FF3B3B"], ["vn", "Vietnam", "#FFD700"],
  ["ch", "Switzerland", "#FF3B30"], ["co", "Colombia", "#FCD116"], ["uy", "Uruguay", "#7FB6F0"],
  ["ie", "Ireland", "#22B35E"], ["gb-sct", "Scotland", "#3C8DFF"],
];
const TEAM = Object.fromEntries(TEAMS.map(([c, n, col]) => [c, { code: c, name: n, color: col }]));
const ROUND_NAMES = ["Round of 32", "Round of 16", "Quarter-final", "Semi-final", "Final"];
const ROUND_SHORT = ["R32", "R16", "QF", "SF", "F"];
const FLAG_PRICE = 150;
const UPGRADES = {
  kick: { name: "Kick Power", desc: "Harder kicks", max: 5 },
  recharge: { name: "Quick Kick", desc: "Kick recharges faster", max: 5 },
};
const upgradeCost = (lvl) => 80 * (lvl + 1);

// ---------------------------------------------------------------- save
const SAVE_KEY = "escapecup.v1";
function defaultFlag() {
  const region = ((navigator.language || "").split("-")[1] || "").toLowerCase();
  const map = { gb: "gb-eng", uk: "gb-eng" };
  const code = map[region] || region;
  return TEAM[code] ? code : "br";
}
function freshSave() {
  const f = defaultFlag();
  return { v: 1, coins: 0, flag: f, owned: [f], cup: 1, round: 0, trophies: 0,
           kick: 0, recharge: 0, muted: false, opponents: null, seenTap: false, played: 0 };
}
let save = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && s.v === 1) return Object.assign(freshSave(), s);
  } catch (e) { /* incognito / blocked storage: play without saving */ }
  return freshSave();
})();
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }
function ensureOpponents() {
  if (save.opponents && save.opponents.length === 5 && !save.opponents.includes(save.flag)) return;
  const pool = TEAMS.map(t => t[0]).filter(c => c !== save.flag);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  save.opponents = pool.slice(0, 5);
  persist();
}

// ---------------------------------------------------------------- canvas
const cv = document.getElementById("c");
const ctx = cv.getContext("2d");
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
}
window.addEventListener("resize", resize);
resize();

// Flag balls are pre-rendered once into round sprites.
const SPRITE = 96;
const sprites = {};
function flagImg(code) { return FLAG_DATA[code]; }
function buildSprite(code) {
  const c = document.createElement("canvas"); c.width = c.height = SPRITE;
  const g = c.getContext("2d");
  const img = new Image();
  img.onload = () => {
    g.save(); g.beginPath(); g.arc(SPRITE / 2, SPRITE / 2, SPRITE / 2 - 4, 0, Math.PI * 2); g.clip();
    const h = SPRITE, w = h * 1.5; g.drawImage(img, (SPRITE - w) / 2, 0, w, h);
    // soft shading so it reads as a ball, not a sticker
    const sh = g.createRadialGradient(SPRITE * .35, SPRITE * .3, SPRITE * .05, SPRITE / 2, SPRITE / 2, SPRITE / 2);
    sh.addColorStop(0, "rgba(255,255,255,.35)"); sh.addColorStop(.5, "rgba(255,255,255,0)"); sh.addColorStop(1, "rgba(0,0,0,.35)");
    g.fillStyle = sh; g.fillRect(0, 0, SPRITE, SPRITE);
    g.restore();
    g.lineWidth = 5; g.strokeStyle = "#fff";
    g.beginPath(); g.arc(SPRITE / 2, SPRITE / 2, SPRITE / 2 - 4, 0, Math.PI * 2); g.stroke();
  };
  img.src = flagImg(code);
  sprites[code] = c;
  return c;
}
const sprite = (code) => sprites[code] || buildSprite(code);

// ---------------------------------------------------------------- audio
// Soft by design: sine/triangle voices, gentle attacks, everything low-passed.
const Audio = {
  ctx: null, master: null, adMuted: false,
  ensure() {
    if (this.ctx) { if (this.ctx.state === "suspended" && !this.adMuted) this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1900; lp.Q.value = 0.3;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
    this.master = c.createGain(); this.master.gain.value = save.muted ? 0 : 0.55;
    this.master.connect(lp); lp.connect(comp); comp.connect(c.destination);
  },
  setMuted(m) { save.muted = m; persist(); if (this.master) this.master.gain.value = m ? 0 : 0.55; },
  pauseForAd() { this.adMuted = true; if (this.ctx) this.ctx.suspend(); },
  resumeAfterAd() { this.adMuted = false; if (this.ctx) this.ctx.resume(); },
  tone(freq, dur, gain, type = "sine", attack = 0.012, when = 0) {
    if (!this.ctx || save.muted) return;
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  },
  noise(dur, gain, f0, f1) {
    if (!this.ctx || save.muted) return;
    const c = this.ctx, t = c.currentTime, n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(f0, t); f.frequency.linearRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
  },
  PENTA: [0, 2, 4, 7, 9, 12, 14, 16],
  note(i) { return 523.25 * Math.pow(2, this.PENTA[i % 8] / 12); },
  bounce(ring, speed) { this.tone(this.note(ring) * 0.5, 0.16, Math.min(0.05 + speed / 7000, 0.14), "triangle"); },
  brk(ring) { this.tone(this.note(ring), 0.35, 0.16); this.tone(this.note(ring + 2), 0.35, 0.09, "sine", 0.012, 0.03); this.noise(0.18, 0.08, 900, 300); },
  kick() { this.noise(0.14, 0.12, 500, 1100); this.tone(260, 0.12, 0.08, "sine", 0.008); },
  zap() { this.tone(196, 0.3, 0.12, "triangle"); this.tone(185, 0.3, 0.08, "triangle", 0.012, 0.05); },
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.6, 0.14, "sine", 0.02, i * 0.11)); },
  lose() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.5, 0.12, "triangle", 0.02, i * 0.16)); },
  click() { this.tone(660, 0.08, 0.06); },
};

// ---------------------------------------------------------------- physics constants (world units)
const BALL_R = 13, R0 = 62, SPACING = 23, THICK = 5;
const GRAV = 520, MIN_BOUNCE = 285, MAX_V = 830, FRICTION = 0.22;
const BREAK_DEPTH = 0.35 * BALL_R;
const STEP = 1 / 240;
const TAU = Math.PI * 2;
const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Tuned with tools/balance.js (bot player vs AI rival, hundreds of matches per level).
// Ring counts are always even: rings score 1, the final ring 2, so a match can't tie.
function levelParams(cup, round) {
  const d = (cup - 1) * 5 + round;          // overall difficulty 0,1,2...
  const t = Math.min(d / 12, 1);            // 0 -> 1 ramp over the first ~2.5 cups
  const lerp = (a, b) => a + (b - a) * t;
  return {
    d,
    nRings: Math.min(16, 6 + 2 * Math.ceil(d / 2)),
    gapLen: Math.max(44, 72 - d * 2),        // gap ARC LENGTH (world units), so outer rings aren't free
    spin: lerp(0.8, 1.7),                    // rings out-spin your finger: you time the gap, not park it
    counter: d >= 6,                         // alternate rings spin the other way: harder to line up
    hazardChance: d < 2 ? 0 : Math.min(0.8, 0.22 + d * 0.06),
    hazardHalf: Math.min(0.5, 0.22 + d * 0.02),
    // the rival plays like a person: it watches for the gap and kicks when it's close
    aiDelay: d === 0 ? 1e9 : 0.8,            // match 1 is a warm-up: the rival never kicks
    aiReact: lerp(0.6, 0.1),                 // seconds between looks
    aiWindow: lerp(0.2, 1.2),                // how close (rad) the gap must be before it kicks
    aiCooldown: lerp(2.2, 0.6),
    aiNoise: lerp(0.8, 0.05),
    aiPower: lerp(0.8, 1.1),
    final: round === 4,
  };
}

// ---------------------------------------------------------------- match
let G = null;
function newMatch({ headStart = false } = {}) {
  ensureOpponents();
  const P = levelParams(save.cup, save.round);
  const rings = [];
  const dir = Math.random() < 0.5 ? -1 : 1;
  let gapAt = rand(-Math.PI, Math.PI);
  for (let i = 0; i < P.nRings; i++) {
    const last = i === P.nRings - 1;
    const r = R0 + i * SPACING;
    // gap width as an arc length, but never narrower than the ball can fit through
    const gapHalf = Math.max((P.gapLen * (last ? 0.85 : 1)) / 2 / r, (BALL_R * 1.15) / r);
    // scattered gaps (not a neat spiral): each ring needs its own timing; the odd
    // near-aligned pair still gives combo moments
    gapAt = wrap(gapAt + (Math.random() < 0.2 ? rand(-0.25, 0.25) : rand(0.9, 2.4) * (Math.random() < 0.5 ? -1 : 1)));
    const omega = dir * P.spin * (P.counter && i % 2 ? -1 : 1) * (P.counter ? rand(0.85, 1.25) : 1);
    const hazards = [];
    if (i > 0 && Math.random() < P.hazardChance) {
      const n = P.d >= 9 && Math.random() < 0.4 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        // keep hazards off the gap's lips so the gap itself is always fair
        const off = (k === 0 ? 1 : -1) * rand(gapHalf + P.hazardHalf + 0.35, Math.PI - P.hazardHalf);
        hazards.push({ off, half: P.hazardHalf * rand(0.8, 1.1) });
      }
    }
    rings.push({ r, gapHalf, baseGapHalf: gapHalf, angle: gapAt, omega, hazards, alive: true });
  }
  const you = save.flag, rival = save.opponents[save.round];
  const mkBall = (team, side, isPlayer) => ({
    team, isPlayer, x: side * 22, y: -6, vx: 0, vy: 0, stun: 0, kickCd: 0, ai: P.aiDelay,
    trail: [], lastNote: 0, breaks: 0, flash: 0,
  });
  G = {
    P, rings, current: 0, rot: 0, rotVel: 0, pendingRot: 0, keyRot: 0,
    balls: [mkBall(you, -1, true), mkBall(rival, 1, false)],
    state: "ready", t: 0, timeScale: 1, slowmo: 0, winner: -1, endT: 0,
    frags: [], sparks: [], texts: [], shake: 0, combo: 0, lastPlayerBreak: -9,
    earned: 0, headStart, cam: G && G.cam ? G.cam : { x: 0, y: 0, s: 1 },
    idle: 0,
  };
  if (headStart) G.balls[1].stun = 3;
  updateHud();
}

function releaseBalls() {
  for (const b of G.balls) {
    const a = rand(-Math.PI * 0.85, -Math.PI * 0.15);     // launch upward-ish
    const s = rand(300, 380);
    b.vx = Math.cos(a) * s; b.vy = Math.sin(a) * s;
  }
}

function kickSpeed() { return 470 * (1 + 0.08 * save.kick); }
function kickCooldown() { return 1.0 * (1 - 0.1 * save.recharge); }

function kick(b, tx, ty, power = 1) {
  if (b.stun > 0 || b.kickCd > 0) return false;
  let dx = tx - b.x, dy = ty - b.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
  const s = (b.isPlayer ? kickSpeed() : 470 * power);
  b.vx = b.vx * 0.2 + dx * s; b.vy = b.vy * 0.2 + dy * s;
  b.kickCd = b.isPlayer ? kickCooldown() : 0.6;
  for (let i = 0; i < 8; i++) G.sparks.push({ x: b.x - dx * BALL_R, y: b.y - dy * BALL_R, vx: -dx * rand(60, 160) + rand(-60, 60), vy: -dy * rand(60, 160) + rand(-60, 60), life: 0.35, max: 0.35, col: "#ffffff", r: 2.2 });
  if (b.isPlayer) Audio.kick();
  return true;
}

function zap(b) {
  if (b.stun > 0) return;
  b.stun = 0.75; b.vx *= 0.25; b.vy *= 0.25; b.kickCd = Math.max(b.kickCd, 0.9); b.flash = 0.75;
  for (let i = 0; i < 14; i++) { const a = rand(0, TAU), s = rand(80, 220); G.sparks.push({ x: b.x, y: b.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5, max: 0.5, col: "#ff4d6d", r: 2.6 }); }
  G.shake = Math.max(G.shake, b.isPlayer ? 6 : 3);
  Audio.zap();
  if (b.isPlayer) { floatText(b.x, b.y - 26, "ZAPPED", "#ff4d6d"); vibrate(30); }
}

// closest point on a ring's solid arc to (bx, by); also reports the contact angle
function closestOnRing(ring, effAngle, bx, by) {
  const d = Math.hypot(bx, by) || 1e-9;
  const ang = Math.atan2(by, bx);
  const rel = wrap(ang - effAngle);
  if (Math.abs(rel) >= ring.gapHalf) return [bx / d * ring.r, by / d * ring.r, rel];
  const e = effAngle + (rel > 0 ? ring.gapHalf : -ring.gapHalf);
  return [Math.cos(e) * ring.r, Math.sin(e) * ring.r, rel > 0 ? ring.gapHalf : -ring.gapHalf];
}

function physicsStep(h, rotStep, dragOmega) {
  G.rot += rotStep;
  G.t += h;
  // stall breaker: after 15s every gap slowly widens so no match drags on
  const widen = Math.max(0, G.t - 15) * 0.03;
  for (const ring of G.rings) { ring.angle = wrap(ring.angle + ring.omega * h); ring.gapHalf = Math.min(ring.baseGapHalf + widen, 1.2); }
  const reach = BALL_R + THICK / 2;
  for (const b of G.balls) {
    if (b.stun > 0) { b.stun -= h; b.vy += GRAV * h * 0.35; } else b.vy += GRAV * h;
    b.kickCd = Math.max(0, b.kickCd - h);
    b.x += b.vx * h; b.y += b.vy * h;
    for (let k = G.current; k < Math.min(G.current + 3, G.rings.length); k++) {
      const ring = G.rings[k];
      const eff = ring.angle + G.rot;
      const [qx, qy, rel] = closestOnRing(ring, eff, b.x, b.y);
      let nx = b.x - qx, ny = b.y - qy; const dist = Math.hypot(nx, ny);
      if (dist >= reach || dist < 1e-9) continue;
      nx /= dist; ny /= dist;
      b.x += nx * (reach - dist); b.y += ny * (reach - dist);
      const om = ring.omega + dragOmega;
      const wx = -om * qy, wy = om * qx;                 // wall surface velocity
      let rvx = b.vx - wx, rvy = b.vy - wy;
      const vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        rvx -= 2 * vn * nx; rvy -= 2 * vn * ny;
        const tx = -ny, ty = nx, vt = rvx * tx + rvy * ty;  // friction: spinning rings drag the ball along
        rvx -= FRICTION * vt * tx; rvy -= FRICTION * vt * ty;
        b.vx = rvx + wx; b.vy = rvy + wy;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp < MIN_BOUNCE && b.stun <= 0) { b.vx *= MIN_BOUNCE / sp; b.vy *= MIN_BOUNCE / sp; }
        if (G.t - b.lastNote > 0.07 && k === G.current) { b.lastNote = G.t; Audio.bounce(k, -vn); }
        for (const hz of ring.hazards) if (Math.abs(wrap(rel - hz.off)) < hz.half) { zap(b); break; }
      }
    }
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > MAX_V) { b.vx *= MAX_V / sp; b.vy *= MAX_V / sp; }
  }
  // ball vs ball
  const [a, c] = G.balls;
  const dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy);
  if (d > 1e-9 && d < 2 * BALL_R) {
    const nx = dx / d, ny = dy / d, push = (2 * BALL_R - d) / 2;
    a.x -= nx * push; a.y -= ny * push; c.x += nx * push; c.y += ny * push;
    const rel = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny;
    if (rel > 0) { a.vx -= rel * nx; a.vy -= rel * ny; c.vx += rel * nx; c.vy += rel * ny; Audio.tone(300, 0.1, 0.06, "triangle"); }
  }
  // a ring breaks the moment a ball pokes into its gap
  const ring = G.rings[G.current];
  const eff = ring.angle + G.rot;
  for (let i = 0; i < 2; i++) {
    const b = G.balls[i];
    const dist = Math.hypot(b.x, b.y);
    const inGap = Math.abs(wrap(Math.atan2(b.y, b.x) - eff)) < ring.gapHalf;
    if ((inGap && dist > ring.r - BREAK_DEPTH) || dist > ring.r + BALL_R) { breakRing(i); break; }
  }
}

function breakRing(i) {
  const ring = G.rings[G.current], b = G.balls[i];
  const last = G.current === G.rings.length - 1;
  ring.alive = false; b.breaks += last ? 2 : 1;
  const eff = ring.angle + G.rot, col = ringColor(G.current);
  // shatter: the arc becomes spinning shards flying outward
  const n = 16;
  for (let k = 0; k < n; k++) {
    const a0 = eff + ring.gapHalf + (TAU - 2 * ring.gapHalf) * (k + 0.5) / n;
    const len = (TAU - 2 * ring.gapHalf) / n * ring.r;
    const x = Math.cos(a0) * ring.r, y = Math.sin(a0) * ring.r, out = rand(90, 220);
    G.frags.push({ x, y, vx: Math.cos(a0) * out - Math.sin(a0) * ring.omega * ring.r * 0.5, vy: Math.sin(a0) * out + Math.cos(a0) * ring.omega * ring.r * 0.5 - 60,
      ang: a0 + Math.PI / 2, spin: rand(-8, 8), len: len * 0.9, life: 1.1, max: 1.1, col });
  }
  G.shake = Math.max(G.shake, 4 + G.current * 0.3);
  Audio.brk(G.current);
  if (b.isPlayer) {
    const now = G.t;
    G.combo = now - G.lastPlayerBreak < 1.1 ? G.combo + 1 : 1;
    G.lastPlayerBreak = now;
    const coins = 5 * G.combo;
    G.earned += coins;
    floatText(b.x, b.y - 24, G.combo > 1 ? `COMBO x${G.combo}  +${coins}` : `+${coins}`, G.combo > 1 ? "#ffcf3f" : "#ffffff");
    vibrate(12);
  }
  G.current++;
  if (last) { endMatch(G.balls[0].breaks > G.balls[1].breaks ? 0 : 1); return; }
  if (G.current === G.rings.length - 1) showBanner("FINAL RING ×2", "#ffcf3f");
  updateHud();
}

function endMatch(winner) {
  G.winner = winner; G.state = "end"; G.endT = 0; G.slowmo = 1.4;
  G.shake = 14;
  const b = G.balls[winner];
  b.vy = Math.min(b.vy, -250);   // the winner pops out for the celebration
  for (let i = 0; i < 70; i++) {
    const a = rand(0, TAU), s = rand(120, 420);
    G.sparks.push({ x: b.x, y: b.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 100, life: rand(0.8, 1.6), max: 1.6,
      col: ["#ffcf3f", "#3f8cff", "#ff5fa2", "#43e97b", "#ffffff"][i % 5], r: rand(2, 4), confetti: true });
  }
  if (winner === 0) Audio.win(); else Audio.lose();
  vibrate(winner === 0 ? [20, 40, 20] : 60);
  updateHud();
  PokiSDK.gameplayStop();
}

function aiThink(dt) {
  const b = G.balls[1];
  if (b.stun > 0) return;
  b.ai -= dt;
  if (b.ai > 0 || b.kickCd > 0) return;
  b.ai = G.P.aiReact * rand(0.8, 1.2);
  const ring = G.rings[G.current];
  const gap = ring.angle + G.rot;
  if (Math.abs(wrap(Math.atan2(b.y, b.x) - gap)) > G.P.aiWindow) return;
  const a = gap + rand(-1, 1) * G.P.aiNoise;
  if (kick(b, Math.cos(a) * (ring.r + 30), Math.sin(a) * (ring.r + 30), G.P.aiPower)) b.kickCd = G.P.aiCooldown;
}

// ---------------------------------------------------------------- effects
function floatText(x, y, text, col) { G.texts.push({ x, y, text, col, life: 1.1, max: 1.1 }); }
function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
function ringColor(i) {
  if (G.P.final && i === G.rings.length - 1) return "hsl(45, 100%, 60%)";
  if (i === G.rings.length - 1) return "hsl(45, 100%, 62%)";
  const hue = (195 + i * (290 / Math.max(1, G.rings.length - 1))) % 360;
  return `hsl(${hue}, 95%, 62%)`;
}
let bannerTimer = 0;
function showBanner(text, col = "#fff") {
  const el = document.getElementById("banner");
  el.textContent = text; el.style.color = col; el.style.opacity = 1;
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => (el.style.opacity = 0), 1100);
}

// ---------------------------------------------------------------- input
const ptr = { id: null, x0: 0, y0: 0, x: 0, t0: 0, drag: false };
const keys = {};
function screenToWorld(sx, sy) {
  const c = G.cam;
  return [(sx - W / 2) / c.s + c.x, (sy - arenaCY()) / c.s + c.y];
}
function onFirstInput() {
  Audio.ensure();
  if (G.state === "ready") startPlay();
}
function startPlay() {
  G.state = "play";
  hide("title"); show("hud");
  releaseBalls();
  showBanner("GO!", "#ffffff");
  PokiSDK.gameplayStart();
  if (!save.seenTap) hintTimer = 0;
}
cv.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  onFirstInput();
  ptr.id = e.pointerId; ptr.x0 = ptr.x = e.clientX; ptr.y0 = e.clientY; ptr.t0 = performance.now(); ptr.drag = false;
  try { cv.setPointerCapture(e.pointerId); } catch (_) {}
});
cv.addEventListener("pointermove", (e) => {
  if (ptr.id !== e.pointerId) return;
  if (!ptr.drag && Math.hypot(e.clientX - ptr.x0, e.clientY - ptr.y0) > 8) { ptr.drag = true; dragged(); }
  if (ptr.drag && G.state === "play") G.pendingRot -= (e.clientX - ptr.x) * (TAU / (Math.min(W, H) * 1.5));
  ptr.x = e.clientX;
});
const endPtr = (e) => {
  if (ptr.id !== e.pointerId) return;
  if (!ptr.drag && performance.now() - ptr.t0 < 350 && G.state === "play") {
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    if (kick(G.balls[0], wx, wy)) tapped();
  }
  ptr.id = null;
};
cv.addEventListener("pointerup", endPtr);
cv.addEventListener("pointercancel", (e) => { if (ptr.id === e.pointerId) ptr.id = null; });
window.addEventListener("keydown", (e) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) e.preventDefault();
  if (Audio.adMuted) return;
  keys[e.key.toLowerCase()] = true;
  if (G.state === "ready" && !document.querySelector(".modal:not(.hidden)")) { onFirstInput(); }
  if ((e.key === " " || e.key === "ArrowUp" || e.key.toLowerCase() === "w") && G.state === "play") {
    const b = G.balls[0];
    if (kick(b, b.x, b.y - 100)) tapped();
  }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key.toLowerCase() === "a" || e.key.toLowerCase() === "d") dragged();
});
window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

// ---------------------------------------------------------------- onboarding hint (no text: show, don't tell)
let hintTimer = -1, hasDragged = false;
function dragged() { hasDragged = true; if (G.state !== "ready") hide("hint"); }
function tapped() { if (!save.seenTap) { save.seenTap = true; persist(); } hide("hint"); }
function updateHint(dt) {
  const el = document.getElementById("hint");
  if (G.state === "ready") { el.classList.remove("tap"); if (!hasDragged || save.played < 1) show("hint"); return; }
  if (G.state !== "play") { hide("hint"); return; }
  if (!hasDragged) { el.classList.remove("tap"); show("hint"); return; }
  if (!save.seenTap && hintTimer >= 0) {
    hintTimer += dt;
    if (hintTimer > 3) { el.classList.add("tap"); show("hint"); }
  }
}

// ---------------------------------------------------------------- camera
function arenaCY() { return W < H ? H * 0.56 : H * 0.55; }
function updateCamera(dt) {
  const fitR = Math.min(W * 0.48, H * 0.40);
  const cur = G.rings[Math.min(G.current, G.rings.length - 1)];
  const viewR = cur.r + SPACING * 2.2 + BALL_R;
  const fitS = fitR / viewR;
  const minS = 8.5 / BALL_R;                         // never let a ball shrink under ~8.5px
  let s = fitS, tx = 0, ty = 0;
  if (fitS < minS) {
    s = minS;
    const k = 1 - fitS / minS;
    const p = G.balls[0];
    tx = p.x * k; ty = p.y * k;                       // follow your ball once the arena outgrows the screen
  }
  const f = 1 - Math.exp(-dt * 3);
  G.cam.s += (s - G.cam.s) * f; G.cam.x += (tx - G.cam.x) * f; G.cam.y += (ty - G.cam.y) * f;
}

// ---------------------------------------------------------------- loop
let last = performance.now(), acc = 0;
function frame(now) {
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (Audio.adMuted) dt = 0;
  update(dt);
  draw(dt);
  requestAnimationFrame(frame);
}

function update(dt) {
  if (!G) return;
  updateHint(dt);
  // keyboard spin
  const kr = (keys["arrowleft"] || keys["a"] ? 1 : 0) - (keys["arrowright"] || keys["d"] ? 1 : 0);
  if (G.state === "play") G.pendingRot += kr * 3.2 * dt;

  if (G.state === "ready") {
    // attract: rings spin, balls idle-bob at the centre
    for (const ring of G.rings) ring.angle = wrap(ring.angle + ring.omega * dt * 0.5);
    G.idle += dt;
    G.balls.forEach((b, i) => { b.x = (i ? 1 : -1) * 22; b.y = -6 + Math.sin(G.idle * 4 + i * 1.7) * 5; });
  } else if (G.state === "play" || G.state === "end") {
    let ts = 1;
    if (G.state === "end") { G.endT += dt; ts = G.endT < 0.12 ? 0.05 : G.endT < 1.2 ? 0.35 : 1; }
    const sdt = dt * ts;
    if (G.state === "play") aiThink(sdt);
    acc += sdt;
    const steps = Math.min(40, Math.floor(acc / STEP));
    acc -= steps * STEP;
    const rotStep = steps ? G.pendingRot / steps : 0;
    const dragOmega = dt > 0 ? clamp(G.pendingRot / Math.max(sdt, 1e-3), -9, 9) : 0;
    G.rotVel += (dragOmega - G.rotVel) * 0.5;
    if (steps && G.state === "play") { for (let i = 0; i < steps && G.state === "play"; i++) physicsStep(STEP, rotStep, G.rotVel); G.pendingRot = 0; }
    else if (G.state === "end") {
      // keep balls flying through the slow-mo celebration, no rings left to hit
      for (const b of G.balls) { b.vy += GRAV * sdt; b.x += b.vx * sdt; b.y += b.vy * sdt; }
    }
    if (G.state === "end" && G.endT > 1.6 && !G.shown) { G.shown = true; showResult(); }
  }
  for (const b of G.balls) {
    b.flash = Math.max(0, b.flash - dt);
    b.trail.push([b.x, b.y]); if (b.trail.length > 12) b.trail.shift();
  }
  const sdt = G.state === "end" && G.endT < 1.2 ? dt * 0.4 : dt;
  for (const f of G.frags) { f.vy += GRAV * 0.8 * sdt; f.x += f.vx * sdt; f.y += f.vy * sdt; f.ang += f.spin * sdt; f.life -= sdt; }
  G.frags = G.frags.filter(f => f.life > 0);
  for (const p of G.sparks) { p.vy += (p.confetti ? 260 : 380) * sdt; p.vx *= p.confetti ? 0.985 : 1; p.x += p.vx * sdt; p.y += p.vy * sdt; p.life -= sdt; }
  G.sparks = G.sparks.filter(p => p.life > 0);
  for (const t of G.texts) { t.y -= 40 * dt; t.life -= dt; }
  G.texts = G.texts.filter(t => t.life > 0);
  G.shake = Math.max(0, G.shake - dt * 30);
  updateCamera(dt);
}

function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // background
  const bg = ctx.createRadialGradient(W / 2, arenaCY(), 10, W / 2, arenaCY(), Math.max(W, H) * 0.8);
  bg.addColorStop(0, G && G.P.final ? "#2a1d05" : "#16204a"); bg.addColorStop(1, "#070a18");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  if (!G) return;
  const c = G.cam;
  const sx = (Math.random() - 0.5) * G.shake, sy = (Math.random() - 0.5) * G.shake;
  ctx.setTransform(DPR * c.s, 0, 0, DPR * c.s, DPR * (W / 2 + sx - c.x * c.s), DPR * (arenaCY() + sy - c.y * c.s));
  const px = 1 / c.s;   // one screen pixel in world units

  // rings (outer first so the live ring sits on top)
  for (let i = G.rings.length - 1; i >= G.current; i--) {
    const ring = G.rings[i];
    const eff = ring.angle + G.rot;
    const isCur = i === G.current;
    const col = ringColor(i);
    const a0 = eff + ring.gapHalf, a1 = eff + TAU - ring.gapHalf;
    ctx.lineCap = "round";
    ctx.globalAlpha = isCur ? 0.28 : 0.1;
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(THICK * 2.6, 7 * px);
    ctx.beginPath(); ctx.arc(0, 0, ring.r, a0, a1); ctx.stroke();
    ctx.globalAlpha = isCur ? 1 : Math.max(0.35, 0.8 - (i - G.current) * 0.06);
    ctx.lineWidth = Math.max(THICK, 2.5 * px);
    ctx.beginPath(); ctx.arc(0, 0, ring.r, a0, a1); ctx.stroke();
    // hazards: pulsing red bands
    for (const hz of ring.hazards) {
      const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 140);
      ctx.globalAlpha = (isCur ? 1 : 0.6) * pulse;
      ctx.strokeStyle = "#ff3b5c"; ctx.lineWidth = Math.max(THICK * 1.9, 4 * px);
      ctx.beginPath(); ctx.arc(0, 0, ring.r, eff + hz.off - hz.half, eff + hz.off + hz.half); ctx.stroke();
      if (isCur) {
        ctx.globalAlpha = 0.25 * pulse; ctx.lineWidth = THICK * 4.5;
        ctx.beginPath(); ctx.arc(0, 0, ring.r, eff + hz.off - hz.half, eff + hz.off + hz.half); ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;

  // shards
  ctx.lineCap = "round";
  for (const f of G.frags) {
    ctx.globalAlpha = Math.min(1, f.life / f.max * 1.6);
    ctx.strokeStyle = f.col; ctx.lineWidth = Math.max(THICK, 2.5 * px);
    const dx = Math.cos(f.ang) * f.len / 2, dy = Math.sin(f.ang) * f.len / 2;
    ctx.beginPath(); ctx.moveTo(f.x - dx, f.y - dy); ctx.lineTo(f.x + dx, f.y + dy); ctx.stroke();
  }
  // sparks / confetti
  for (const p of G.sparks) {
    ctx.globalAlpha = Math.min(1, p.life / p.max * 2);
    ctx.fillStyle = p.col;
    if (p.confetti) { ctx.fillRect(p.x - p.r, p.y - p.r * 0.6, p.r * 2 * px * c.s, p.r * 1.2 * px * c.s); }
    else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r * px * 1.2, 0, TAU); ctx.fill(); }
  }
  ctx.globalAlpha = 1;

  // balls: trails, sprites, your marker and kick-recharge ring
  G.balls.forEach((b, i) => {
    const team = TEAM[b.team];
    for (let k = 0; k < b.trail.length; k++) {
      const [x, y] = b.trail[k], t = k / b.trail.length;
      ctx.globalAlpha = t * 0.35; ctx.fillStyle = team.color;
      ctx.beginPath(); ctx.arc(x, y, BALL_R * (0.35 + 0.6 * t), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const sp = sprite(b.team);
    ctx.save();
    if (b.flash > 0 && Math.floor(b.flash * 16) % 2 === 0) ctx.globalAlpha = 0.45;
    ctx.drawImage(sp, b.x - BALL_R, b.y - BALL_R, BALL_R * 2, BALL_R * 2);
    ctx.restore();
    if (b.stun > 0) {
      ctx.strokeStyle = "#ff4d6d"; ctx.lineWidth = 2 * px;
      ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R + 3 * px, 0, TAU); ctx.stroke();
    }
    if (b.isPlayer && G.state !== "end") {
      // gold pointer above your ball
      const y = b.y - BALL_R - 9 * px, s = 6 * px;
      ctx.fillStyle = "#ffcf3f";
      ctx.beginPath(); ctx.moveTo(b.x - s, y - s * 1.2); ctx.lineTo(b.x + s, y - s * 1.2); ctx.lineTo(b.x, y); ctx.closePath(); ctx.fill();
      // kick recharge arc
      const frac = 1 - b.kickCd / kickCooldown();
      ctx.lineWidth = 2.5 * px; ctx.strokeStyle = frac >= 1 ? "rgba(255,207,63,.95)" : "rgba(255,255,255,.35)";
      ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R + 4.5 * px, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(frac, 0, 1)); ctx.stroke();
    }
  });

  // floating text (screen-space size)
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const t of G.texts) {
    ctx.globalAlpha = Math.min(1, t.life / t.max * 2);
    ctx.font = `900 ${16 * px}px system-ui, sans-serif`;
    ctx.lineWidth = 4 * px; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.col; ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- UI
const $ = (id) => document.getElementById(id);
function show(id) { $(id).classList.remove("hidden"); }
function hide(id) { $(id).classList.add("hidden"); }
function updateCoins() { document.querySelectorAll(".coins").forEach(e => (e.textContent = save.coins)); }
function updateHud() {
  if (!G) return;
  $("round").textContent = `Cup ${save.cup} · ${ROUND_NAMES[save.round]}`;
  $("hudFlagA").src = flagImg(G.balls[0].team);
  $("hudFlagB").src = flagImg(G.balls[1].team);
  $("rivalName").textContent = TEAM[G.balls[1].team].name.toUpperCase();
  $("scoreA").textContent = G.balls[0].breaks;
  $("scoreB").textContent = G.balls[1].breaks;
  $("ringFill").style.width = `${(G.current / G.rings.length) * 100}%`;
  $("titleSub").textContent = `Cup ${save.cup} · ${ROUND_NAMES[save.round]} vs ${TEAM[save.opponents[save.round]].name}`;
  updateCoins();
}
$("muteBtn").addEventListener("click", (e) => { e.stopPropagation(); Audio.ensure(); Audio.setMuted(!save.muted); syncMute(); });
function syncMute() { $("muteBtn").textContent = save.muted ? "🔇" : "🔊"; }
syncMute();

function bracketHtml(roundReached, justWon) {
  return `<div class="bracket">${ROUND_SHORT.map((r, i) => {
    const cls = i < roundReached ? "done" : i === roundReached ? "now" : "";
    const opp = save.opponents[i];
    return `<div class="step ${cls}">${r}<img src="${flagImg(opp)}" alt=""></div>`;
  }).join("")}</div>`;
}
const coinIcon = `<span class="coin"></span>`;
const vid = `<span class="vid"></span>`;

function showResult() {
  const won = G.winner === 0;
  const [a, b] = [G.balls[0].breaks, G.balls[1].breaks];
  const rival = TEAM[G.balls[1].team];
  save.played++;
  let bonus = 0, html = "";
  if (won) {
    bonus = 40 + save.round * 15;
    const champion = save.round === 4;
    if (champion) bonus += 150;
    G.earned += bonus;
    save.coins += G.earned;
    if (champion) {
      save.trophies++;
      html = `<div class="trophy">🏆</div><h2>CHAMPIONS!</h2>
        <div class="muted">You won Escape Cup ${save.cup} · beat ${rival.name} ${a}–${b}</div>`;
      save.cup++; save.round = 0; save.opponents = null;
    } else {
      html = `<h2 style="color:var(--gold)">YOU WIN!</h2>
        <div class="muted">${TEAM[save.flag].name} ${a}–${b} ${rival.name}</div>`;
      save.round++;
      html += bracketHtml(save.round);
    }
    html += `<div class="earn">${coinIcon}+<span id="earnNum">${G.earned}</span></div>
      <div class="stack">
        <button class="btn ad" id="dblBtn">${vid} Double coins</button>
        <button class="btn" id="nextBtn">${champion ? "Next cup" : "Next match"}</button>
        <button class="btn ghost" id="shopBtn">Shop</button>
      </div>`;
  } else {
    save.coins += G.earned;
    html = `<h2 style="color:var(--danger)">KNOCKED OUT</h2>
      <div class="muted">${TEAM[save.flag].name} ${a}–${b} ${rival.name}</div>
      ${bracketHtml(save.round)}
      ${G.earned ? `<div class="earn">${coinIcon}+${G.earned}</div>` : ""}
      <div class="stack">
        <button class="btn ad" id="headBtn">${vid} Rematch with head start</button>
        <button class="btn" id="retryBtn">Rematch</button>
        <button class="btn ghost" id="shopBtn">Shop</button>
      </div>`;
  }
  persist();
  $("resultCard").innerHTML = html;
  show("result"); hide("hud"); updateCoins();

  const dbl = $("dblBtn");
  if (dbl) dbl.onclick = () => {
    dbl.disabled = true;
    rewarded().then(ok => {
      if (ok) { save.coins += G.earned; persist(); $("earnNum").textContent = G.earned * 2; updateCoins(); dbl.textContent = "Doubled!"; }
      else dbl.disabled = false;
    });
  };
  if ($("nextBtn")) $("nextBtn").onclick = () => nextMatch();
  if ($("retryBtn")) $("retryBtn").onclick = () => nextMatch();
  if ($("headBtn")) $("headBtn").onclick = () => rewarded().then(ok => nextMatch({ headStart: ok, skipBreak: true }));
  $("shopBtn").onclick = () => openShop();
}

function nextMatch(opts = {}) {
  Audio.click();
  hide("result");
  const go = () => { newMatch(opts); G.state = "ready"; show("title"); $("title").querySelector("h1").classList.add("hidden"); updateHud(); };
  if (opts.skipBreak) return go();
  commercial().then(go);
}

function commercial() {
  return PokiSDK.commercialBreak(() => Audio.pauseForAd()).then(() => Audio.resumeAfterAd()).catch(() => Audio.resumeAfterAd());
}
function rewarded() {
  return PokiSDK.rewardedBreak(() => Audio.pauseForAd())
    .then((ok) => { Audio.resumeAfterAd(); return !!ok; })
    .catch(() => { Audio.resumeAfterAd(); return false; });
}

// ---------------------------------------------------------------- shop
let shopTab = "flags";
function openShop() { Audio.click(); renderShop(); show("shop"); }
function renderShop() {
  let body = "";
  if (shopTab === "flags") {
    body = `<div class="grid">${TEAMS.map(([code, name]) => {
      const own = save.owned.includes(code), sel = save.flag === code;
      return `<div class="cell ${own ? "" : "locked"} ${sel ? "sel" : ""}" data-code="${code}">
        <img src="${spriteUrl(code)}" alt="">${own ? name : `${FLAG_PRICE}`}</div>`;
    }).join("")}</div>`;
  } else {
    body = Object.entries(UPGRADES).map(([key, u]) => {
      const lvl = save[key], maxed = lvl >= u.max, cost = upgradeCost(lvl);
      return `<div class="upg"><div><b>${u.name}</b><small>${u.desc}</small>
        <div class="pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < lvl ? "on" : ""}"></i>`).join("")}</div></div>
        <button data-up="${key}" ${maxed || save.coins < cost ? "disabled" : ""}>${maxed ? "MAX" : `${coinIcon}${cost}`}</button></div>`;
    }).join("");
  }
  $("shopCard").innerHTML = `<h2 style="font-size:28px">Shop</h2>
    <div class="chip" style="display:inline-flex;margin-top:6px">${coinIcon}<span class="coins">${save.coins}</span></div>
    <div class="tabs"><button data-tab="flags" class="${shopTab === "flags" ? "on" : ""}">Balls</button>
      <button data-tab="upgrades" class="${shopTab === "upgrades" ? "on" : ""}">Upgrades</button></div>
    ${body}
    <div class="stack"><button class="btn" id="shopClose">Done</button></div>`;
  $("shopCard").querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { shopTab = b.dataset.tab; renderShop(); });
  $("shopCard").querySelectorAll("[data-code]").forEach(el => el.onclick = () => {
    const code = el.dataset.code;
    if (save.owned.includes(code)) { save.flag = code; }
    else if (save.coins >= FLAG_PRICE) { save.coins -= FLAG_PRICE; save.owned.push(code); save.flag = code; Audio.brk(3); }
    else return;
    if (save.opponents && save.opponents.includes(code)) save.opponents = null;   // never face yourself
    persist(); renderShop(); refreshAfterShop();
  });
  $("shopCard").querySelectorAll("[data-up]").forEach(b => b.onclick = () => {
    const key = b.dataset.up, cost = upgradeCost(save[key]);
    if (save.coins < cost || save[key] >= UPGRADES[key].max) return;
    save.coins -= cost; save[key]++; persist(); Audio.brk(5); renderShop(); updateCoins();
  });
  $("shopClose").onclick = () => { Audio.click(); hide("shop"); };
}
function refreshAfterShop() {
  updateCoins();
  if (G && G.state === "ready") { newMatch({ headStart: G.headStart }); updateHud(); }
}
const spriteCache = {};
function spriteUrl(code) {
  if (spriteCache[code]) return spriteCache[code];
  const s = sprite(code);
  try { return (spriteCache[code] = s.toDataURL()); } catch (e) { return flagImg(code); }
}
$("titleShop").addEventListener("click", (e) => { e.stopPropagation(); openShop(); });

// ---------------------------------------------------------------- pause on tab hide
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { if (Audio.ctx) Audio.ctx.suspend(); }
  else if (Audio.ctx && !Audio.adMuted) Audio.ctx.resume();
});

// ---------------------------------------------------------------- boot
TEAMS.forEach(([c]) => buildSprite(c));
PokiSDK.init().catch(() => {}).then(() => {
  newMatch();
  updateHud();
  PokiSDK.gameLoadingFinished();
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
});
// Shop preview sprites need the flag images to have loaded once.
setTimeout(() => { for (const k in spriteCache) delete spriteCache[k]; }, 600);
