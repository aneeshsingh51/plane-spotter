// radar.js — P7-phosphor PPI scope and az/el sky view, both on <canvas>.
// Authentic touches: blips repaint only when the sweep passes them (one rotation = 4.8 s),
// a blue-white flash on paint that decays to a slow yellow-green afterglow,
// ARTS-style data blocks (callsign / altitude in hundreds + trend / ground speed).
import { norm360, dAz, skylineAt } from "./geo.js?v=16";

const C = {
  glass: "#0b130e", phosphor: "185,220,74", flash: "217,236,255", grid: "185,220,74",
};
const ROT = 4.8; // s per revolution (ASR-9 is ~4.8 s)

function setupCanvas(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const r = cv.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

export class Radar {
  constructor(canvas, { onTapBlip } = {}) {
    this.cv = canvas; this.onTapBlip = onTapBlip;
    this.rangeMi = 12; this.items = new Map(); this.lockId = null; this.lockT = 0;
    this.window = null; this.aimAz = null; this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.t0 = performance.now(); this.prevSweep = 0; this.running = false; this.hits = [];
    matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", e => (this.reduced = e.matches));
    canvas.addEventListener("click", e => this._tap(e));
    document.addEventListener("visibilitychange", () => (document.hidden ? this.stop() : !this.cv.hidden && this.start()));
  }
  start() { if (this.running) return; this.running = true; const loop = () => { if (!this.running) return; this.draw(); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
  stop() { this.running = false; }
  setLock(id) { if (id !== this.lockId) { this.lockId = id; this.lockT = performance.now(); } }

  /** provider(id) -> {az, groundMi, label, altH, trend, gs, hidden} for "now"; called when the sweep paints a blip. */
  setTargets(ids, provider) {
    this.provider = provider;
    const keep = new Set(ids);
    for (const id of [...this.items.keys()]) if (!keep.has(id)) this.items.delete(id);
    for (const id of ids) if (!this.items.has(id)) { const p = provider(id); if (p) this.items.set(id, { ...p, paintT: -1e9 }); }
  }
  repaintAll() { if (!this.provider) return; const now = performance.now(); for (const [id, it] of this.items) { const p = this.provider(id); if (p) Object.assign(it, p, { paintT: now }); } }

  _tap(e) {
    const r = this.cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 28;
    for (const h of this.hits) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h.id; } }
    if (best && this.onTapBlip) this.onTapBlip(best);
  }
  cycleRange() { const R = [5, 12, 25]; this.rangeMi = R[(R.indexOf(this.rangeMi) + 1) % R.length]; this.onRange?.(this.rangeMi); }

  draw() {
    const { ctx, w, h } = setupCanvas(this.cv);
    const now = performance.now();
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 18;
    const k = R / this.rangeMi;
    const sweep = this.reduced ? null : norm360(((now - this.t0) / 1000 / ROT) * 360);
    ctx.clearRect(0, 0, w, h);
    // glass
    ctx.fillStyle = C.glass; ctx.beginPath(); ctx.arc(cx, cy, R + 14, 0, Math.PI * 2); ctx.fill();
    const toXY = (az, d) => [cx + Math.sin(az * Math.PI / 180) * d * k, cy - Math.cos(az * Math.PI / 180) * d * k];
    const ang = az => (az - 90) * Math.PI / 180;

    // window wedge
    if (this.window) {
      const { azFrom, azTo } = this.window;
      ctx.fillStyle = `rgba(${C.phosphor},0.07)`;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, ang(azFrom), ang(azFrom + (norm360(azTo - azFrom) || 360))); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = `rgba(${C.phosphor},0.35)`; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      for (const a of [azFrom, azTo]) { const [x, y] = toXY(a, this.rangeMi); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    // range rings
    ctx.font = "10px 'B612 Mono', monospace"; ctx.textBaseline = "middle";
    for (const m of [1, 3, 5, 10, 20]) {
      if (m > this.rangeMi) continue;
      ctx.strokeStyle = `rgba(${C.grid},0.22)`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, m * k, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(${C.grid},0.55)`; ctx.fillText(String(m), cx + 3, cy - m * k + 7);
    }
    // bezel azimuth ticks
    for (let a = 0; a < 360; a += 5) {
      const big = a % 30 === 0, r1 = R + (big ? 2 : 6), r2 = R + 11;
      ctx.strokeStyle = `rgba(${C.grid},${big ? 0.6 : 0.3})`;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang(a)) * r1, cy + Math.sin(ang(a)) * r1); ctx.lineTo(cx + Math.cos(ang(a)) * r2, cy + Math.sin(ang(a)) * r2); ctx.stroke();
    }
    // aim bearing
    if (this.aimAz !== null) {
      const [x, y] = toXY(this.aimAz, this.rangeMi);
      ctx.strokeStyle = `rgba(${C.flash},0.55)`; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
    }
    // sweep afterglow wedge + line
    if (sweep !== null) {
      const grad = ctx.createConicGradient ? ctx.createConicGradient(ang(sweep) - 0.62, cx, cy) : null;
      if (grad) {
        grad.addColorStop(0, `rgba(${C.phosphor},0)`); grad.addColorStop(0.098, `rgba(${C.phosphor},0.16)`); grad.addColorStop(0.1, `rgba(${C.phosphor},0)`);
        ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, ang(sweep) - 0.62, ang(sweep)); ctx.closePath(); ctx.fill();
      }
      ctx.save(); ctx.shadowColor = `rgba(${C.flash},0.9)`; ctx.shadowBlur = 8;
      ctx.strokeStyle = `rgba(${C.flash},0.85)`; ctx.lineWidth = 1.5;
      const [x, y] = toXY(sweep, this.rangeMi); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke(); ctx.restore();
      // repaint blips the sweep just crossed
      const prev = this.prevSweep, crossed = az => { const d = norm360(az - prev), span = norm360(sweep - prev); return d <= span && span < 180; };
      for (const [id, it] of this.items) if (crossed(it.az)) { const p = this.provider?.(id); if (p) Object.assign(it, p, { paintT: now }); }
      this.prevSweep = sweep;
    } else if (now - (this._lastStatic || 0) > 1000) { this.repaintAll(); this._lastStatic = now; }

    // blips first, then data blocks placed by priority with simple decluttering:
    // locked target, then visible aircraft, then hidden ones; hidden blocks that
    // cannot find a clear spot are dropped (the blip stays).
    this.hits = [];
    ctx.font = "11px 'B612 Mono', monospace"; ctx.textBaseline = "alphabetic";
    const blocks = [];
    for (const [id, it] of this.items) {
      if (it.groundMi > this.rangeMi * 1.02) continue;
      const [x, y] = toXY(it.az, it.groundMi);
      const dt = (now - it.paintT) / 1000;
      const glow = this.reduced ? 0.85 : 0.28 + 0.72 * Math.exp(-dt / 1.9);
      const dim = it.hidden ? 0.38 : 1;
      const fresh = !this.reduced && dt < 0.14;
      const col = fresh ? C.flash : C.phosphor;
      ctx.save(); ctx.shadowColor = `rgba(${col},${0.8 * dim})`; ctx.shadowBlur = 6 * glow;
      ctx.fillStyle = `rgba(${col},${glow * dim})`;
      ctx.beginPath(); ctx.arc(x, y, it.hidden ? 2 : 2.6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      this.hits.push({ id, x, y });
      blocks.push({ id, it, x, y, pri: id === this.lockId ? 0 : it.hidden ? 2 : 1 });
    }
    blocks.sort((a, b) => a.pri - b.pri);
    const placed = [];
    const clear = r => r.x0 > cx - R && r.x1 < cx + R && r.y0 > cy - R && r.y1 < cy + R &&
      !placed.some(q => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0);
    for (const b of blocks) {
      const { it, x, y } = b;
      const l2 = `${it.altH}  ${it.gs}`;
      const wTxt = Math.max(ctx.measureText(it.label).width, ctx.measureText(l2).width);
      let spot = null;
      for (const [sx, sy] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
        const tx = x + sx * 14, ty = sy < 0 ? y - 12 : y + 14;
        const r = sx > 0 ? { x0: tx - 1, x1: tx + wTxt + 1, y0: ty - 10, y1: ty + 15 } : { x0: tx - wTxt - 1, x1: tx + 1, y0: ty - 10, y1: ty + 15 };
        if (clear(r)) { spot = { sx, sy, tx, ty, r }; break; }
      }
      if (!spot) { if (it.hidden) continue; const tx = x + 14, ty = y - 12; spot = { sx: 1, sy: -1, tx, ty, r: { x0: tx, x1: tx + wTxt, y0: ty - 10, y1: ty + 15 } }; }
      placed.push(spot.r);
      const dim = it.hidden ? 0.38 : 1;
      ctx.strokeStyle = `rgba(${C.phosphor},${0.45 * dim})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + spot.sx * 3, y + spot.sy * 3); ctx.lineTo(x + spot.sx * 11, y + spot.sy * 8); ctx.stroke();
      ctx.fillStyle = `rgba(${C.phosphor},${it.hidden ? 0.42 : 0.92})`;
      // B612 Mono has no ↑/↓ glyphs, so the trend arrow is drawn as a small triangle in a 1-char gap
      const x0 = spot.sx > 0 ? spot.tx : spot.tx - wTxt;
      ctx.textAlign = "left";
      ctx.fillText(it.label, x0, spot.ty);
      ctx.fillText(it.altH, x0, spot.ty + 13);
      const cw = ctx.measureText("0").width, ax = x0 + cw * 3 + cw / 2, ay = spot.ty + 9;
      if (it.trend === "↑") { ctx.beginPath(); ctx.moveTo(ax, ay - 5); ctx.lineTo(ax + 3.5, ay + 1); ctx.lineTo(ax - 3.5, ay + 1); ctx.fill(); }
      else if (it.trend === "↓") { ctx.beginPath(); ctx.moveTo(ax, ay + 2); ctx.lineTo(ax + 3.5, ay - 4); ctx.lineTo(ax - 3.5, ay - 4); ctx.fill(); }
      ctx.fillText(it.gs, x0 + cw * 5, spot.ty + 13);
      if (b.id === this.lockId) this._brackets(ctx, x, y, now);
    }
    ctx.textAlign = "left";
    // own position
    ctx.strokeStyle = `rgba(${C.flash},0.8)`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - 5, cy); ctx.lineTo(cx + 5, cy); ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy + 5); ctx.stroke();
  }
  _brackets(ctx, x, y, now) {
    const t = Math.min(1, (now - this.lockT) / 260);
    const s = this.reduced ? 11 : 11 + (1 - t) * 18, L = 5;
    ctx.save(); ctx.strokeStyle = `rgb(${C.flash})`; ctx.lineWidth = 1.5; ctx.shadowColor = `rgba(${C.flash},0.9)`; ctx.shadowBlur = 6;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.beginPath(); ctx.moveTo(x + sx * s, y + sy * (s - L)); ctx.lineTo(x + sx * s, y + sy * s); ctx.lineTo(x + sx * (s - L), y + sy * s); ctx.stroke();
    }
    ctx.restore();
  }
}

/** Az/el chart of the window: azimuth left→right, elevation 0→90 bottom→top. */
export class SkyView {
  constructor(canvas, { onTap } = {}) {
    this.cv = canvas; this.onTap = onTap; this.points = []; this.mask = null; this.aim = null; this.reticle = null; this.lockId = null;
    canvas.addEventListener("click", e => {
      const r = canvas.getBoundingClientRect(); const p = this._inv(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
      if (p && this.onTap) this.onTap(p);
    });
  }
  _range() {
    if (this.fixedRange) return this.fixedRange;
    const m = this.mask;
    if (m && m.frame) { const span = Math.max(50, norm360(m.azTo - m.azFrom)); const c = m.frame.center; return [c - span / 2 - 15, c + span / 2 + 15]; }
    if (!m || (m.azFrom === 0 && m.azTo === 360)) { const c = this.facing ?? 180; return [c - 180, c + 180]; }
    const span = norm360(m.azTo - m.azFrom) || 360; return [m.azFrom - 12, m.azFrom + span + 12];
  }
  _geom(w, h) { const pad = { l: 34, r: 10, t: 12, b: 24 }; return { pad, W: w - pad.l - pad.r, H: h - pad.t - pad.b }; }
  _xy(az, el, w, h) {
    const [a0, a1] = this._range(), { pad, W, H } = this._geom(w, h);
    const d = norm360(az - a0); const x = pad.l + (d / (a1 - a0)) * W; const y = pad.t + (1 - el / 90) * H; return [x, y, d <= a1 - a0];
  }
  _inv(x, y, w, h) {
    const [a0, a1] = this._range(), { pad, W, H } = this._geom(w, h);
    if (x < pad.l || x > pad.l + W || y < pad.t || y > pad.t + H) return null;
    return { az: norm360(a0 + ((x - pad.l) / W) * (a1 - a0)), el: 90 * (1 - (y - pad.t) / H) };
  }
  draw() {
    const { ctx, w, h } = setupCanvas(this.cv);
    const [a0, a1] = this._range(), { pad, W, H } = this._geom(w, h);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = C.glass; ctx.fillRect(0, 0, w, h);
    // shaded: skyline (below mask), window top, outside window
    const m = this.mask;
    ctx.fillStyle = "rgba(42,46,40,0.92)";
    const polyPath = poly => { ctx.beginPath(); poly.forEach((p, i) => { const [x, y] = this._xy(p.az, p.el, w, h); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); };
    if (m && m.frame && !this.trace) {
      // traced outline: everything is wall except the outline you marked
      ctx.fillRect(pad.l, pad.t, W, H);
      polyPath(m.poly); ctx.fillStyle = C.glass; ctx.fill();
      ctx.strokeStyle = `rgba(${C.phosphor},0.55)`; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
    } else if (m && !this.trace) {
      ctx.beginPath(); ctx.moveTo(pad.l, pad.t + H);
      for (let i = 0; i <= 120; i++) {
        const az = a0 + (i / 120) * (a1 - a0);
        const inWin = m.azFrom === 0 && m.azTo === 360 ? true : norm360(az - m.azFrom) <= (norm360(m.azTo - m.azFrom) || 360);
        const el = inWin ? skylineAt(m.skyline, az) : 90;
        ctx.lineTo(pad.l + (i / 120) * W, pad.t + (1 - el / 90) * H);
      }
      ctx.lineTo(pad.l + W, pad.t + H); ctx.closePath(); ctx.fill();
      if ((m.top ?? 90) < 90) { const yT = pad.t + (1 - m.top / 90) * H; ctx.fillRect(pad.l, pad.t, W, yT - pad.t); }
      // outline the open sky so the window reads at a glance
      if (!(m.azFrom === 0 && m.azTo === 360)) {
        const [xa] = this._xy(m.azFrom, 0, w, h), [xb] = this._xy(m.azTo, 0, w, h);
        const yT = pad.t + (1 - (m.top ?? 90) / 90) * H, yB = pad.t + (1 - skylineAt(m.skyline, (m.azFrom + m.azTo) / 2) / 90) * H;
        ctx.strokeStyle = `rgba(${C.phosphor},0.45)`; ctx.setLineDash([4, 4]); ctx.strokeRect(xa, yT, xb - xa, yB - yT); ctx.setLineDash([]);
      }
    }
    // grid
    ctx.strokeStyle = `rgba(${C.grid},0.18)`; ctx.fillStyle = `rgba(${C.grid},0.6)`; ctx.font = "10px 'B612 Mono', monospace"; ctx.lineWidth = 1;
    for (let el = 0; el <= 90; el += 15) { const y = pad.t + (1 - el / 90) * H; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + W, y); ctx.stroke(); ctx.fillText(el + "°", 4, y + 3); }
    const step = [5, 10, 15, 30, 45, 90].find(st => W * st / (a1 - a0) >= 34) || 90; // labels never collide
    for (let a = Math.ceil(a0 / step) * step; a <= a1; a += step) { const x = pad.l + ((a - a0) / (a1 - a0)) * W; ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + H); ctx.stroke(); ctx.fillText(String(norm360(a)).padStart(3, "0"), x - 10, h - 8); }
    // points
    ctx.font = "11px 'B612 Mono', monospace";
    const labels = [];
    const order = this.points.slice().sort((a, b) => (b.id === this.lockId) - (a.id === this.lockId) || (a.state === "visible" ? -1 : 1));
    for (const p of order) {
      const [x, y, ok] = this._xy(p.az, Math.max(-5, p.el), w, h); if (!ok || p.el < -2) continue;
      const a = p.state === "visible" ? 0.95 : p.state === "marginal" ? 0.6 : 0.3;
      ctx.fillStyle = `rgba(${C.phosphor},${a})`; ctx.beginPath(); ctx.arc(x, y, p.state === "hidden" ? 2 : 3, 0, Math.PI * 2); ctx.fill();
      // label only what you could actually see (plus the lock), and never on top of another label
      if (p.state !== "hidden" || p.id === this.lockId) {
        const wl = ctx.measureText(p.label).width, r = { x0: x + 5, x1: x + 7 + wl, y0: y - 14, y1: y };
        if (!labels.some(q => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) { labels.push(r); ctx.fillText(p.label, x + 6, y - 4); }
      }
      if (p.id === this.lockId) { ctx.strokeStyle = `rgb(${C.flash})`; ctx.lineWidth = 1.5; ctx.strokeRect(x - 9, y - 9, 18, 18); ctx.lineWidth = 1; }
    }
    // trace in progress: numbered corners, edges in order, dashed closing edge
    if (this.trace) {
      const t = this.trace;
      if (t.length) {
        ctx.strokeStyle = `rgba(${C.flash},0.85)`; ctx.lineWidth = 1.5;
        ctx.beginPath(); t.forEach((p, i) => { const [x, y] = this._xy(p.az, p.el, w, h); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
        if (t.length >= 3) {
          const [x0, y0] = this._xy(t[0].az, t[0].el, w, h), [x1, y1] = this._xy(t[t.length - 1].az, t[t.length - 1].el, w, h);
          ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x0, y0); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.font = "11px 'B612 Mono', monospace"; ctx.fillStyle = `rgb(${C.flash})`;
        t.forEach((p, i) => { const [x, y] = this._xy(p.az, p.el, w, h); ctx.fillRect(x - 3, y - 3, 6, 6); ctx.fillText(String(i + 1), x + 6, y - 6); });
        ctx.lineWidth = 1;
      }
      // live line from the last corner to where you're aiming
      if (this.reticle && t.length) {
        const [x0, y0] = this._xy(t[t.length - 1].az, t[t.length - 1].el, w, h), [x1, y1] = this._xy(this.reticle.az, this.reticle.el, w, h);
        ctx.strokeStyle = `rgba(${C.flash},0.35)`; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // aim reticle (live pointing) and locked aim
    for (const [r, live] of [[this.reticle, true], [this.aim, false]]) {
      if (!r) continue; const [x, y, ok] = this._xy(r.az, r.el, w, h); if (!ok) continue;
      ctx.strokeStyle = `rgba(${C.flash},${live ? 0.9 : 0.6})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.moveTo(x - 22, y); ctx.lineTo(x - 8, y); ctx.moveTo(x + 8, y); ctx.lineTo(x + 22, y);
      ctx.moveTo(x, y - 22); ctx.lineTo(x, y - 8); ctx.moveTo(x, y + 8); ctx.lineTo(x, y + 22); ctx.stroke();
    }
  }
}
