// score.js — project aircraft to the tap moment, compute sky geometry, rank, explain.
import { lookAngles, deadReckon, visibility, angSep, dAz, haversine, bearing, FT, MI } from "./geo.js?v=14";
import { TYPES, DEFAULT_SPAN, AIRPORTS, WIDEBODY, BIZJET, CARGO_ICAO } from "./tables.js?v=14";

const SOUND = 343; // m/s

/** Observer heights for each datum. ADS-B geometric altitude is ellipsoid height. */
export function observerHeights(obs) {
  const msl = obs.groundM + obs.eyeM;
  return { msl, ellip: msl + obs.geoidN };
}

/**
 * Sky state of one aircraft at local time `t` (ms).
 * Compares geometric altitude with ellipsoid eye height, or baro with MSL eye height (approx).
 */
export function skyState(a, obs, mask, t, offsetS = 0) {
  const h = observerHeights(obs);
  const useGeom = a.geom !== null;
  const alt0 = useGeom ? a.geom : (a.baro ?? 0);
  const age = (t - a.posEpoch) / 1000;
  const p = deadReckon(a.lat, a.lon, alt0, a.track, a.gs, a.vrate, age + offsetS);
  const look = lookAngles(obs.lat, obs.lon, useGeom ? h.ellip : h.msl, p.lat, p.lon, p.altFt * FT);
  const vis = visibility(look.az, look.el, mask);
  return { ...look, ...vis, lat: p.lat, lon: p.lon, altFt: p.altFt, age, approx: !useGeom };
}

const typeInfo = t => TYPES[t] || null;
export const wingspan = t => (TYPES[t] ? TYPES[t][1] : DEFAULT_SPAN);

/** Which hint chips does this aircraft agree with? +1 consistent, -1 inconsistent, 0 neutral. */
export function chipVerdicts(s, motion, a) {
  const alt = s.altFt, size = s.sizeDeg;
  return {
    high: alt > 15000 ? 1 : alt < 8000 ? -1 : 0,
    low: alt < 8000 && size > 0.12 ? 1 : alt > 15000 ? -1 : 0,
    left: Math.abs(motion.dAz) < 0.3 ? 0 : motion.dAz < 0 ? 1 : -1,
    right: Math.abs(motion.dAz) < 0.3 ? 0 : motion.dAz > 0 ? 1 : -1,
    toward: Math.abs(motion.rangeRate) < 20 ? 0 : motion.rangeRate < 0 ? 1 : -1,
    away: Math.abs(motion.rangeRate) < 20 ? 0 : motion.rangeRate > 0 ? 1 : -1,
    contrail: alt > 26000 ? 1 : alt < 20000 ? -1 : 0,
    lights: 0,
    heard: 0,
  };
}

/** Is it above a broken/overcast layer? METAR bases are feet above field (~620 ft MSL at MDW). */
export function aboveCeiling(altFt, wx, fieldFt = 620) {
  if (!wx || !wx.clouds) return null;
  const layer = wx.clouds.filter(c => (c.cover === "BKN" || c.cover === "OVC") && Number.isFinite(c.base)).sort((a, b) => a.base - b.base)[0];
  if (!layer) return null;
  return altFt - fieldFt > layer.base + 500 ? layer : null;
}

/** Airport context for ORD / MDW: likely arriving or departing. */
export function airportContext(a, s, route) {
  for (const code of ["KORD", "KMDW"]) {
    const f = AIRPORTS[code];
    const d = haversine(s.lat, s.lon, f[2], f[3]);
    if (d > 50000) continue;
    const toField = bearing(s.lat, s.lon, f[2], f[3]);
    const head = a.track;
    const tw = Number.isFinite(head) ? Math.abs(dAz(head, toField)) : 90;
    const v = a.vrate ?? 0;
    const short = code === "KORD" ? "O'Hare" : "Midway";
    const iata = code.slice(1);
    if ((route?.destination?.code === code || route?.destination?.iata === iata) || (v < -300 && tw < 60 && s.altFt < 12000)) {
      return { kind: "arr", text: `Likely arriving at ${short}`, code };
    }
    if ((route?.origin?.code === code || route?.origin?.iata === iata) && s.altFt < 15000 || (v > 300 && tw > 120 && s.altFt < 12000)) {
      return { kind: "dep", text: `Likely departing from ${short}`, code };
    }
  }
  return null;
}

/**
 * Does the scheduled route fit where the aircraft actually is?
 * Detour test: origin→aircraft→destination may be at most 25% (+100 km) longer than origin→destination.
 * Returns true / false, or null when airport coordinates are unknown.
 */
export function routeFits(route, lat, lon) {
  const o = route?.origin, d = route?.destination;
  if (!o || !d || !Number.isFinite(o.lat) || !Number.isFinite(d.lat)) return null;
  const direct = haversine(o.lat, o.lon, d.lat, d.lon);
  const via = haversine(o.lat, o.lon, lat, lon) + haversine(lat, lon, d.lat, d.lon);
  return via <= direct * 1.25 + 100000;
}

export function badges(a, details, seenTypes) {
  const out = [];
  const t = a.type || details?.icaoType;
  const op = (a.flight || "").slice(0, 3);
  if (WIDEBODY.has(t)) out.push("Widebody");
  if (CARGO_ICAO.has(op) || /cargo|freight/i.test(details?.owner || "")) out.push("Cargo");
  if (a.military) out.push("Military");
  if (BIZJET.has(t)) out.push("Private jet");
  if (a.category === "A7" || /helicopter/i.test(TYPES[t]?.[0] || "")) out.push("Helicopter");
  if (t && seenTypes && !seenTypes.has(t)) out.push("New type: " + t);
  if (a.emergency) out.push("Emergency " + a.emergency);
  return out;
}

/**
 * Rank candidates.
 * opts = { obs, mask, facingAz, aim:{az,el}|null, chips:Set, wx, now }
 * Returns { all:[...state for every aircraft], ranked:[...], confidence, reason }
 */
export function rank(ac, opts) {
  const { obs, mask, aim, chips = new Set(), wx, now } = opts;
  const all = [];
  for (const a of ac) {
    if (a.onGround) continue;
    let s = skyState(a, obs, mask, now);
    // "Heard, not seen": match where the plane was when its sound left it.
    if (chips.has("heard")) {
      const tau = s.slant / SOUND;
      const s2 = skyState(a, obs, mask, now, -tau);
      s = { ...s2, soundDelay: tau };
    }
    const s5 = skyState(a, obs, mask, now, 5 + (s.soundDelay ? -s.soundDelay : 0));
    const motion = { dAz: dAz(s.az, s5.az), dEl: s5.el - s.el, rangeRate: (s5.slant - s.slant) / 5 };
    s.sizeDeg = (wingspan(a.type) / s.slant) * 180 / Math.PI;
    const v = chipVerdicts(s, motion, a);
    let chipF = 1;
    for (const c of chips) if (v[c] === 1) chipF *= 1.5; else if (v[c] === -1) chipF *= 0.5;
    const aimErr = aim ? angSep(aim.az, aim.el, s.az, s.el) : null;
    const aimF = aim ? Math.exp(-((aimErr / 8) ** 2)) : 1;
    // Visibility: apparent size. At night ("lights only") size matters less: use its square root.
    const visF = chips.has("lights") ? Math.sqrt(s.sizeDeg) : s.sizeDeg;
    const fresh = Math.exp(-Math.max(0, s.age - 15) / 30);
    const maskF = s.state === "visible" ? 1 : s.state === "marginal" ? 0.25 : 0.02;
    const ceil = aboveCeiling(s.altFt, wx);
    const wxF = ceil ? 0.3 : 1;
    const score = aimF * visF * chipF * fresh * maskF * wxF;
    all.push({ a, s, motion, verdicts: v, aimErr, score, ceil, factors: { aimF, visF, chipF, fresh, maskF, wxF } });
  }
  const pool = all.filter(c => aim ? c.aimErr <= 15 : c.s.state !== "hidden");
  pool.sort((x, y) => y.score - x.score);
  const [b, n] = pool;
  let confidence = "low", reason = "Nothing in view.";
  if (b) {
    const ratio = n ? b.score / Math.max(n.score, 1e-12) : Infinity;
    if (aim && b.aimErr < 5 && ratio >= 2) confidence = "high";
    else if (ratio >= 1.4) confidence = "medium";
    if (aim) reason = n ? `Aim error ${b.aimErr.toFixed(0)}°, next closest ${n.aimErr.toFixed(0)}° away` : `Aim error ${b.aimErr.toFixed(0)}°, nothing else within 15°`;
    else reason = n ? `Strongest in your sky: ${ratio === Infinity ? "only" : ratio.toFixed(1) + "×"} the next` : "Only aircraft in your sky";
    if (b.s.state === "marginal") reason += " · may be hidden";
    if (b.ceil) reason += ` · above the ${b.ceil.cover === "OVC" ? "overcast" : "broken layer"} at ${b.ceil.base.toLocaleString()} ft`;
  }
  return { all, ranked: pool, confidence, reason };
}

/** Aircraft predicted to enter the visible sky in the next 2 min. */
export function incoming(ac, opts, horizon = 120) {
  const { obs, mask, facingAz, now } = opts;
  const out = [];
  for (const a of ac) {
    if (a.onGround) continue;
    const s0 = skyState(a, obs, mask, now);
    if (s0.state === "visible") continue;
    for (let t = 5; t <= horizon; t += 5) {
      const s = skyState(a, obs, mask, now, t);
      if (s.state === "visible") {
        out.push({ a, t, az: s.az, el: s.el, side: dAz(facingAz, s.az) < 0 ? "left" : "right", high: s.el > 55, altFt: s.altFt });
        break;
      }
    }
  }
  return out.sort((x, y) => x.t - y.t);
}

export { typeInfo, MI };
