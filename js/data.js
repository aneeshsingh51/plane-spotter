// data.js — network sources, caching, rate limiting, simulated outages.
// Positions go through our Cloudflare Worker (the upstreams send no CORS headers).
// Lookups go direct: adsbdb, hexdb, Planespotters, Open-Meteo all allow browser calls.

import { NM } from "./geo.js?v=18";

export const WORKER = "https://plane-spotter-proxy.aneeshsingh51.workers.dev";
const LOOKUP_TIMEOUT = 2500;
const DAY = 24 * 3600 * 1000;
const params = new URLSearchParams(location.search);
const FAIL = (params.get("fail") || "").split(",");
export const failing = name => FAIL.includes("all") || FAIL.includes(name);

// ---------- storage (never throws; falls back to memory) ----------
const mem = new Map();
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? (mem.has(k) ? mem.get(k) : d) : JSON.parse(v); } catch { return mem.has(k) ? mem.get(k) : d; } },
  set(k, v) { mem.set(k, v); try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { mem.delete(k); try { localStorage.removeItem(k); } catch {} },
};

// ---------- 24 h lookup cache (memory + localStorage) ----------
const cacheMem = new Map();
function cacheGet(key) {
  if (cacheMem.has(key)) return cacheMem.get(key);
  const e = store.get("c:" + key);
  if (e && Date.now() - e.t < DAY) { cacheMem.set(key, e.v); return e.v; }
  return undefined;
}
function cacheSet(key, v) { cacheMem.set(key, v); store.set("c:" + key, { t: Date.now(), v }); }
export function pruneCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("c:")) { const e = JSON.parse(localStorage.getItem(k)); if (!e || Date.now() - e.t > DAY) localStorage.removeItem(k); }
    }
  } catch {}
}

async function getJSON(url, timeout = LOOKUP_TIMEOUT) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (r.status === 404) return { __notFound: true };
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ---------- positions ----------
let lastPosFetch = 0;
let backoffUntil = 0;
let backoffStep = 0;
export const linkState = { ok: false, lastOk: 0, error: null, source: null, retryAt: 0 };

/**
 * Fetch aircraft around (lat, lon) within radiusKm.
 * Returns { ac:[normalized], receivedAt, source, latencyMs, genAgeS } or throws.
 * Enforces ≥2 s between calls and exponential backoff after 429/5xx.
 */
export async function fetchPositions(lat, lon, radiusKm, demo) {
  if (demo) return normalizeResponse(demo, Date.now(), "demo recording", 0, true);
  if (failing("positions")) {
    linkState.ok = false; linkState.error = "Simulated outage: positions";
    throw Object.assign(new Error("Position source down (simulated)"), { kind: "down" });
  }
  const now = Date.now();
  if (now < backoffUntil) throw Object.assign(new Error("Rate limited"), { kind: "rate", retryAt: backoffUntil });
  const wait = lastPosFetch + 2000 - now;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastPosFetch = Date.now();
  const dist = Math.max(1, Math.round(radiusKm * 1000 / NM));
  const url = `${WORKER}/pos?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&dist=${dist}`;
  const t0 = Date.now();
  let r;
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 9000);
    r = await fetch(url, { signal: ctl.signal }); clearTimeout(to);
  } catch (e) {
    linkState.ok = false; linkState.error = "No connection to the position proxy";
    throw Object.assign(new Error("Network error reaching the position proxy"), { kind: "net" });
  }
  if (r.status === 429 || r.status >= 500) {
    backoffStep = Math.min(backoffStep + 1, 5);
    backoffUntil = Date.now() + 2000 * 2 ** backoffStep;
    linkState.ok = false; linkState.retryAt = backoffUntil;
    linkState.error = r.status === 429 ? "Rate limited by the data source" : "Position sources are down";
    throw Object.assign(new Error(linkState.error), { kind: r.status === 429 ? "rate" : "down", retryAt: backoffUntil });
  }
  backoffStep = 0;
  const body = await r.json();
  const receivedAt = Date.now();
  const res = normalizeResponse(body, receivedAt, r.headers.get("X-Source") || "adsb.lol", receivedAt - t0, false);
  Object.assign(linkState, { ok: true, lastOk: receivedAt, error: null, source: res.source, retryAt: 0 });
  return res;
}

/**
 * Normalize a readsb-style response. Computes, for each aircraft, posEpoch:
 * the local-clock time (ms) of its position fix, used for dead reckoning.
 */
export function normalizeResponse(body, receivedAt, source, latencyMs, isDemo) {
  const list = body.ac || body.aircraft || [];
  // Age of the snapshot when it reached us: trust server 'now' if clocks agree, else half the RTT.
  let genAgeS = latencyMs / 2000;
  if (!isDemo && Number.isFinite(body.now)) {
    const d = (receivedAt - body.now) / 1000;
    if (d >= 0 && d < 30) genAgeS = d;
  }
  const ac = [];
  for (const a of list) {
    if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue;
    const onGround = a.alt_baro === "ground";
    const baro = Number.isFinite(a.alt_baro) ? a.alt_baro : null;
    const geom = Number.isFinite(a.alt_geom) ? a.alt_geom : null;
    const seenPos = Number.isFinite(a.seen_pos) ? a.seen_pos : (Number.isFinite(a.seen) ? a.seen : 5);
    ac.push({
      hex: (a.hex || "").replace(/^~/, "").toLowerCase(),
      flight: (a.flight || "").trim() || null,
      reg: a.r || null, type: a.t || null, desc: a.desc || null, ownOp: a.ownOp || null,
      lat: a.lat, lon: a.lon, onGround, baro, geom,
      gs: Number.isFinite(a.gs) ? a.gs : null, track: Number.isFinite(a.track) ? a.track : (Number.isFinite(a.true_heading) ? a.true_heading : null),
      vrate: Number.isFinite(a.geom_rate) ? a.geom_rate : (Number.isFinite(a.baro_rate) ? a.baro_rate : null),
      squawk: a.squawk || null, emergency: a.emergency && a.emergency !== "none" ? a.emergency : null,
      category: a.category || null, military: !!(a.dbFlags & 1),
      posEpoch: receivedAt - (genAgeS + seenPos) * 1000,
    });
  }
  return { ac, receivedAt, source, latencyMs, genAgeS, isDemo };
}

// ---------- lookups ----------
/** Route by callsign: adsbdb, then hexdb. Returns {origin, destination, airline, src} | null. */
export async function lookupRoute(callsign) {
  if (!callsign) return null;
  const key = "route:" + callsign;
  const hit = cacheGet(key); if (hit !== undefined) return hit;
  if (failing("route")) throw new Error("Route source down (simulated)");
  let out = null;
  try {
    const j = await getJSON(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`);
    const fr = j?.response?.flightroute;
    if (fr) {
      const ap = p => p && { code: p.icao_code || p.iata_code, iata: p.iata_code, name: p.name, city: p.municipality, lat: p.latitude, lon: p.longitude };
      out = { origin: ap(fr.origin), destination: ap(fr.destination), airline: fr.airline?.name || null, src: "adsbdb" };
    }
  } catch {}
  if (!out) {
    try {
      const j = await getJSON(`https://hexdb.io/api/v1/route/icao/${encodeURIComponent(callsign)}`);
      if (j && j.route && /-/.test(j.route)) {
        const [o, d] = j.route.split("-");
        out = { origin: { code: o }, destination: { code: d }, airline: null, src: "hexdb", updated: j.updatetime };
      }
    } catch {}
  }
  cacheSet(key, out);
  return out;
}

/** Aircraft details by hex: adsbdb, then hexdb. */
export async function lookupAircraft(hex) {
  if (!hex) return null;
  const key = "ac:" + hex;
  const hit = cacheGet(key); if (hit !== undefined) return hit;
  if (failing("aircraft")) throw new Error("Aircraft source down (simulated)");
  let out = null;
  try {
    const j = await getJSON(`https://api.adsbdb.com/v0/aircraft/${hex}`);
    const a = j?.response?.aircraft;
    if (a) out = { type: a.type, icaoType: a.icao_type, maker: a.manufacturer, reg: a.registration, owner: a.registered_owner,
      photo: a.url_photo_thumbnail || a.url_photo || null, photoFull: a.url_photo || null, src: "adsbdb" };
  } catch {}
  if (!out) {
    try {
      const a = await getJSON(`https://hexdb.io/api/v1/aircraft/${hex}`);
      if (a && a.ModeS) out = { type: a.Type, icaoType: a.ICAOTypeCode, maker: a.Manufacturer, reg: a.Registration, owner: a.RegisteredOwners, photo: null, src: "hexdb" };
    } catch {}
  }
  cacheSet(key, out);
  return out;
}

/** Planespotters photo by hex (JSON cached ≤24 h per their terms; image never stored). */
export async function lookupPhoto(hex) {
  if (!hex) return null;
  const key = "ph:" + hex;
  const hit = cacheGet(key); if (hit !== undefined) return hit;
  if (failing("photo")) return null;
  let out = null;
  try {
    const j = await getJSON(`https://api.planespotters.net/pub/photos/hex/${hex}`);
    const p = j?.photos?.[0];
    if (p) out = { src: p.thumbnail_large?.src || p.thumbnail?.src, link: p.link, photographer: p.photographer };
  } catch {}
  cacheSet(key, out);
  return out;
}

/** Ground elevation (m) from Open-Meteo; null on failure. */
export async function lookupElevation(lat, lon) {
  const key = `elev:${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = cacheGet(key); if (hit !== undefined) return hit;
  try {
    const j = await getJSON(`https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`);
    const v = j?.elevation?.[0];
    if (Number.isFinite(v)) { cacheSet(key, v); return v; }
  } catch {}
  return null;
}

/** KMDW METAR via the Worker (aviationweather.gov sends no CORS headers). */
export async function fetchMetar(ids = "KMDW") {
  const key = "metar:" + ids;
  const m = cacheMem.get(key);
  if (m && Date.now() - m.t < 10 * 60 * 1000) return m.v;
  if (failing("weather")) return null;
  try {
    const j = await getJSON(`${WORKER}/metar?ids=${ids}`, 4000);
    const o = Array.isArray(j) ? j[0] : null;
    const v = o ? { raw: o.rawOb, clouds: o.clouds || [], time: o.reportTime || o.obsTime } : null;
    cacheMem.set(key, { t: Date.now(), v });
    return v;
  } catch { return null; }
}
