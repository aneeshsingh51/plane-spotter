// app.js — wiring: state, flow, rendering. Geometry lives in geo.js, ranking in score.js.
import { haversine, bearing, lookAngles, selfTest, norm360, dAz, MI, FT } from "./geo.js?v=12";
import { store, fetchPositions, normalizeResponse, lookupRoute, lookupAircraft, lookupPhoto, lookupElevation, fetchMetar, linkState, failing, pruneCache, WORKER } from "./data.js?v=12";
import { rank, incoming, skyState, airportContext, badges, observerHeights } from "./score.js?v=12";
import { Compass, getGPS, steadyDetector } from "./sensors.js?v=12";
import { Radar, SkyView } from "./radar.js?v=12";
import { TYPES, AIRLINES, airportLabel, PILOT_JOKES, WILLIS } from "./tables.js?v=12";

// ---------------------------------------------------------------- constants
const VERSION = 12;
const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");
const CHICAGO = { lat: 41.90, lon: -87.63, groundM: 181 };
const DEFAULTS = {
  home: { ...CHICAGO }, eyeM: 30, geoidN: -34, window: null, skyline: [{ az: 0, el: 3 }], top: 90,
  declination: -4.2, headingOffset: 0, radiusKm: 40, rangeMi: 12,
  autoRefresh: false, wake: false, ping: false, custom: false,
};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n, d = 0) => Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }) : "—";
const pad3 = n => String(Math.max(0, Math.round(n))).padStart(3, "0");

if (params.get("frame") === "phone") document.documentElement.classList.add("phone");

// ---------------------------------------------------------------- state
const S = {
  settings: { ...DEFAULTS, ...(store.get("ps.settings") || {}) },
  obs: null, locSource: "default", gps: { state: "off", acc: null }, away: false,
  snap: null, fetching: null, error: null, wx: null,
  chips: new Set(), chipsTouched: false,
  aim: null, aimMode: false, result: null, inc: [], selected: null, tapAt: 0, rankMs: 0,
  details: {}, view: "scope", demo: null, jokeI: Math.floor(Math.random() * PILOT_JOKES.length),
  log: store.get("ps.log") || [],
};
const saveSettings = () => store.set("ps.settings", S.settings);
const compass = new Compass();
compass.declination = S.settings.declination;
compass.offset = S.settings.headingOffset;

// ---------------------------------------------------------------- private setup link
// #setup=<base64url JSON>. Read once, save, then removed from the address bar.
const b64u = { enc: s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: s => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)))) };
function readSetupHash() {
  const m = location.hash.match(/setup=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  let ok = false;
  try {
    const j = JSON.parse(b64u.dec(m[1]));
    const st = S.settings;
    if (Number.isFinite(j.lat) && Number.isFinite(j.lon)) st.home = { lat: j.lat, lon: j.lon, groundM: Number.isFinite(j.ground) ? j.ground : st.home.groundM };
    if (Number.isFinite(j.eye)) st.eyeM = j.eye;
    if (Number.isFinite(j.geoid)) st.geoidN = j.geoid;
    if (Array.isArray(j.win) && j.win.length === 2) st.window = { azFrom: +j.win[0], azTo: +j.win[1] };
    if (Number.isFinite(j.sky)) st.skyline = [{ az: 0, el: j.sky }];
    else if (Array.isArray(j.sky)) st.skyline = j.sky.map(([az, el]) => ({ az, el }));
    if (Number.isFinite(j.top)) st.top = j.top;
    if (Number.isFinite(j.decl)) st.declination = j.decl;
    if (Number.isFinite(j.off)) st.headingOffset = j.off;
    st.custom = true;
    saveSettings(); ok = true;
  } catch { ok = false; }
  history.replaceState(null, "", location.pathname + location.search);
  return ok;
}
function makeSetupLink() {
  const st = S.settings;
  const j = { lat: st.home.lat, lon: st.home.lon, ground: st.home.groundM, eye: st.eyeM, geoid: st.geoidN,
    win: st.window ? [st.window.azFrom, st.window.azTo] : undefined,
    sky: st.skyline.length === 1 ? st.skyline[0].el : st.skyline.map(p => [Math.round(p.az), +p.el.toFixed(1)]),
    top: st.top, decl: st.declination, off: st.headingOffset };
  return location.origin + location.pathname + "#setup=" + b64u.enc(JSON.stringify(j));
}

// ---------------------------------------------------------------- observer & mask
function setObserver(lat, lon, groundM, source) {
  S.obs = { lat, lon, groundM, eyeM: S.settings.eyeM, geoidN: S.settings.geoidN };
  S.locSource = source;
  S.away = haversine(lat, lon, S.settings.home.lat, S.settings.home.lon) > 1000;
}
function mask() {
  const st = S.settings;
  if (!st.window || S.away) return { azFrom: 0, azTo: 360, skyline: S.away ? [{ az: 0, el: 3 }] : st.skyline, top: S.away ? 90 : st.top };
  return { azFrom: st.window.azFrom, azTo: st.window.azTo, skyline: st.skyline, top: st.top };
}
function facing() {
  if (S.aim) return S.aim.az;
  const w = S.settings.window;
  if (w && !S.away) return norm360(w.azFrom + (norm360(w.azTo - w.azFrom)) / 2);
  return compass.state === "live" ? compass.az : 180;
}

// ---------------------------------------------------------------- data link
async function refresh(reason = "tick") {
  if (S.fetching) return S.fetching;
  S.fetching = (async () => {
    try {
      S.snap = S.demo ? normalizeResponse(S.demo, Date.now(), "demo recording", 0, true)
        : await fetchPositions(S.obs.lat, S.obs.lon, S.settings.radiusKm, null);
      S.error = null;
    } catch (e) { S.error = e; }
    finally { S.fetching = null; }
    updateRadar(); renderLamps(); renderAlert(); renderFooter();
    if (S.result && (S.settings.autoRefresh || reason === "after-tap")) runMatch({ quiet: true });
  })();
  return S.fetching;
}

// ---------------------------------------------------------------- radar & sky
const radar = new Radar($("#radar"), { onTapBlip: hex => { S.selected = hex; if (!S.result) runMatch(); else renderResults(true); } });
radar.rangeMi = S.settings.rangeMi;
radar.onRange = r => { S.settings.rangeMi = r; saveSettings(); $("#btnRange").textContent = r + " mi"; };
$("#btnRange").textContent = radar.rangeMi + " mi";
$("#btnRange").onclick = () => radar.cycleRange();
const sky = new SkyView($("#sky"), { onTap: p => lockAim(p.az, p.el, "tap") });

function provider(hex) {
  const a = S.snap?.ac.find(x => x.hex === hex); if (!a || !S.obs) return null;
  const s = skyState(a, S.obs, mask(), Date.now());
  const altFt = a.baro ?? a.geom ?? s.altFt;
  return { az: s.az, groundMi: s.ground / MI, label: (a.flight || a.reg || a.hex).toUpperCase(),
    altH: pad3((altFt + (s.altFt - (a.geom ?? a.baro ?? s.altFt))) / 100),
    trend: (a.vrate ?? 0) > 300 ? "↑" : (a.vrate ?? 0) < -300 ? "↓" : " ", gs: Number.isFinite(a.gs) ? pad3(a.gs) : "---",
    hidden: s.state === "hidden" };
}
function updateRadar() {
  const st = S.settings;
  radar.window = st.window && !S.away ? st.window : null;
  if (!S.snap || !S.obs) { radar.setTargets([], provider); return; }
  const ids = S.snap.ac.filter(a => !a.onGround && haversine(S.obs.lat, S.obs.lon, a.lat, a.lon) <= st.radiusKm * 1000).map(a => a.hex);
  radar.setTargets(ids, provider);
  drawSky();
}
function drawSky() {
  sky.mask = mask(); sky.facing = facing(); sky.aim = S.aim; sky.lockId = S.result?.ranked[0]?.a.hex;
  sky.reticle = S.aimMode && compass.state === "live" ? { az: compass.az, el: compass.el } : null;
  sky.points = S.snap && S.obs ? S.snap.ac.filter(a => !a.onGround).map(a => {
    const s = skyState(a, S.obs, mask(), Date.now());
    return { id: a.hex, az: s.az, el: s.el, state: s.state, label: (a.flight || a.reg || a.hex).toUpperCase() };
  }).filter(p => p.el > -2) : [];
  if (S.view === "sky") sky.draw();
}
setInterval(() => { if (S.view === "sky" && !document.hidden) drawSky(); }, 500);

function setView(v) {
  S.view = v;
  $("#vScope").setAttribute("aria-pressed", v === "scope"); $("#vSky").setAttribute("aria-pressed", v === "sky");
  $("#radar").hidden = v !== "scope"; $("#sky").hidden = v !== "sky";
  $("#bezel").classList.toggle("sky", v === "sky");
  if (v === "scope") radar.start(); else { radar.stop(); requestAnimationFrame(drawSky); }
}

// ---------------------------------------------------------------- matching
async function runMatch({ quiet = false } = {}) {
  const t0 = performance.now();
  if (!S.snap) {
    $("#results").innerHTML = `<div class="empty"><p class="big">Contacting the data link…</p></div>`;
    await (S.fetching || refresh("first"));
    if (!S.snap) { renderAlert(); $("#results").innerHTML = ""; return; }
  }
  const now = Date.now();
  const opts = { obs: S.obs, mask: mask(), facingAz: facing(), aim: S.aim, chips: S.chips, wx: S.wx, now };
  S.result = rank(S.snap.ac, opts);
  S.inc = incoming(S.snap.ac, opts);
  S.tapAt = now;
  if (!quiet) S.selected = null;
  S.rankMs = performance.now() - t0;
  radar.setLock(S.result.ranked[0]?.a.hex || null);
  radar.aimAz = S.aim ? S.aim.az : null;
  renderResults(!quiet);
  drawSky();
  // details for the top 5, in parallel; each fills in as it returns
  for (const c of S.result.ranked.slice(0, 5)) fetchDetails(c.a, S.result.ranked.indexOf(c) < 3);
  if (DEBUG) renderDebug();
}
function fetchDetails(a, withPhoto) {
  const d = S.details[a.hex] || (S.details[a.hex] = { err: {} });
  const done = () => { if (shownHex() === a.hex || S.result?.ranked.slice(0, 4).some(c => c.a.hex === a.hex)) renderResults(false); };
  if (d.ac === undefined) lookupAircraft(a.hex).then(v => (d.ac = v), () => { d.ac = null; d.err.ac = true; }).finally(done);
  if (d.route === undefined && a.flight) lookupRoute(a.flight).then(v => (d.route = v), () => { d.route = null; d.err.route = true; }).finally(done);
  if (withPhoto && d.photo === undefined) lookupPhoto(a.hex).then(v => (d.photo = v), () => (d.photo = null)).finally(done);
}
const shownHex = () => S.selected || S.result?.ranked[0]?.a.hex;

// ---------------------------------------------------------------- rendering: results
function airlineName(a, d) {
  if (d?.route?.airline) return d.route.airline;
  const p = (a.flight || "").match(/^([A-Z]{3})\d/);
  if (p && AIRLINES[p[1]]) return AIRLINES[p[1]];
  return null;
}
function typeName(a, d) {
  const t = a.type || d?.ac?.icaoType;
  const friendly = (t && TYPES[t]?.[0]) || a.desc || (d?.ac ? [d.ac.maker, d.ac.type].filter(Boolean).join(" ") : null);
  return { code: t, friendly };
}
function apText(p) {
  if (!p) return "?";
  const known = airportLabel(p.code);
  const code = p.iata || (p.code?.length === 4 && p.code.startsWith("K") ? p.code.slice(1) : p.code);
  const name = p.name || known?.name; const city = p.city || known?.city;
  return `<b>${esc(code)}</b> ${esc([name, city && city !== name ? city : null].filter(Boolean).join(", "))}`;
}
function trendWord(v) { return !Number.isFinite(v) ? "level" : v > 300 ? "climbing" : v < -300 ? "descending" : "level"; }

function renderResults(arrive) {
  const el = $("#results");
  const r = S.result; if (!r) { el.innerHTML = ""; return; }
  const list = r.all.slice().sort((x, y) => y.score - x.score);
  const top = S.selected ? r.all.find(c => c.a.hex === S.selected) : r.ranked[0];
  if (!top) { el.innerHTML = renderEmpty(r); renderIncoming(); return; }
  const a = top.a, s = top.s, d = S.details[a.hex] || {};
  const tn = typeName(a, d), air = airlineName(a, d);
  const reg = a.reg || d.ac?.reg;
  const route = d.route;
  const isTop = top === r.ranked[0];
  const ctx = airportContext(a, s, route);
  const tags = badges(a, d.ac, new Set(S.log.map(e => e.type)));
  const photo = d.photo?.src ? `<figure class="photo"><a href="${esc(d.photo.link)}" target="_blank">
      <img src="${esc(d.photo.src)}" alt="Photo of ${esc(reg || a.hex)}" loading="lazy"></a>
      <figcaption><a href="${esc(d.photo.link)}" target="_blank">Photo © ${esc(d.photo.photographer)} / Planespotters.net</a></figcaption></figure>`
    : d.ac?.photo ? `<figure class="photo"><img src="${esc(d.ac.photo)}" alt="Photo of ${esc(reg || a.hex)}" loading="lazy"><figcaption>Photo: airport-data.com via adsbdb</figcaption></figure>` : "";
  const routeLine = route?.origin ? `<span>${apText(route.origin)} → ${apText(route.destination)}<em>Scheduled route (may be stale) · ${esc(route.src)}</em></span>`
    : !a.flight ? `<span class="missing">No callsign broadcast, so no route lookup.</span>`
    : d.err?.route ? `<span class="missing">Route sources down (adsbdb, hexdb). Try again later.</span>`
    : route === null ? `<span class="missing">Route not in adsbdb or hexdb.</span>` : `<span class="missing">Looking up route…</span>`;
  const altShown = a.baro ?? a.geom;
  const altNote = a.baro !== null ? "baro" : "geom";
  const operator = air || d.ac?.owner || a.ownOp;
  const conf = isTop ? r.confidence : "low";
  el.innerHTML = `
  <article class="match${arrive ? " arrive" : ""}">
    <div class="mhead"><span class="cs">${esc((a.flight || reg || a.hex).toUpperCase())}</span>
      ${isTop ? `<span class="conf ${conf}">${conf}</span>` : `<span class="conf low">picked</span>`}</div>
    <p class="reason">${isTop ? esc(r.reason) : "You picked this one from the list."}${s.approx ? " · altitude from barometer, approximate" : ""}${s.soundDelay ? ` · matched where it was ${fmt(s.soundDelay)} s ago` : ""}</p>
    <div class="kv">
      <div><small>Airline</small><span>${air ? esc(air) : `<span class="missing">${a.flight ? "Airline not in data" : "No callsign"}</span>`}</span></div>
      <div><small>Type</small><span>${tn.code ? esc(tn.code) + " " : ""}${tn.friendly ? `<em>${esc(tn.friendly)}</em>` : (tn.code ? "" : `<span class="missing">Type not in data</span>`)}</span></div>
      <div><small>Reg</small><span>${reg ? esc(reg) : `<span class="missing">Registration not in data</span>`}</span></div>
      <div><small>Route</small>${routeLine}</div>
    </div>
    <div class="grid">
      <div><small>Alt</small><b>${fmt(altShown)}<i>ft</i></b></div>
      <div><small>Speed</small><b>${fmt(a.gs)}<i>kt</i></b></div>
      <div><small>Dist</small><b>${fmt(s.slant / MI, 1)}<i>mi</i></b></div>
      <div><small>Elev</small><b>${fmt(s.el)}<i>°</i></b></div>
    </div>
    <p class="ctx">${esc(trendWord(a.vrate))[0].toUpperCase() + esc(trendWord(a.vrate)).slice(1)}${Number.isFinite(a.vrate) && Math.abs(a.vrate) > 300 ? ` at ${fmt(Math.abs(a.vrate))} ft/min` : ""}, moving ${top.motion.dAz < -0.3 ? "left" : top.motion.dAz > 0.3 ? "right" : "straight at or away from you"}, ${top.motion.rangeRate < -20 ? "coming toward you" : top.motion.rangeRate > 20 ? "going away" : "holding distance"}. Bearing ${pad3(s.az)}°${s.state === "marginal" ? ", may be hidden by the skyline" : ""}.</p>
    ${ctx ? `<p class="ctx">${esc(ctx.text)}.</p>` : ""}
    ${tags.length ? `<div class="tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
    ${photo}
    <p class="crew">Who's flying it: ${operator ? esc(operator) + ". " : ""}${esc(PILOT_JOKES[S.jokeI % PILOT_JOKES.length])}</p>
    <div class="actions"><button class="key" id="btnLog">Log sighting</button></div>
  </article>
  <div class="runners">${list.filter(c => c !== top && (r.ranked.includes(c))).slice(0, 3).map(c => strip(c, r.ranked[0])).join("")}</div>`;
  $("#btnLog").onclick = () => logSighting(top);
  el.querySelectorAll(".strip").forEach(b => (b.onclick = () => { S.selected = b.dataset.hex; renderResults(true); radar.setLock(b.dataset.hex); }));
  renderIncoming();
  if (arrive) document.querySelector(".match")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
}
function strip(c, best) {
  const a = c.a, rel = best ? c.score / best.score : 0;
  return `<button class="strip" data-hex="${esc(a.hex)}"><span class="s1"><b>${esc((a.flight || a.reg || a.hex).toUpperCase())}</b><i>${esc(a.type || "type ?")}</i></span>
    <span>${fmt(a.baro ?? a.geom)} ft · ${fmt(c.s.slant / MI, 1)} mi</span><span class="sc">${rel.toFixed(2)}</span></button>`;
}
function renderEmpty(r) {
  const hidden = r.all.filter(c => c.s.state === "hidden" && c.s.el > -5).sort((x, y) => y.s.margin - x.s.margin)[0];
  const next = S.inc[0];
  return `<div class="empty"><p class="big">Nothing in view. Bird? Superman? Check again.</p>
    ${hidden ? `<p>Nearest hidden: <b>${esc((hidden.a.flight || hidden.a.hex).toUpperCase())}</b>, ${fmt(-hidden.s.margin)}° outside your sky (bearing ${pad3(hidden.s.az)}°, elevation ${fmt(hidden.s.el)}°).</p>` : ""}
    ${next ? `<p>Next in: <b>${esc((next.a.flight || next.a.hex).toUpperCase())}</b> enters from the ${next.side} in ${next.t} s, ${next.high ? "high" : "low"}.</p>` : `<p>Nothing is due in the next 2 minutes.</p>`}</div>`;
}
function renderIncoming() {
  const sec = $("#incomingSec"), ul = $("#incoming");
  sec.hidden = !S.inc.length || !S.result;
  ul.innerHTML = S.inc.slice(0, 5).map(i => `<li><b>${esc((i.a.flight || i.a.reg || i.a.hex).toUpperCase())}</b> enters from the ${i.side} in ${i.t} s, ${i.high ? "high" : "low"} (${fmt(i.altFt)} ft).</li>`).join("");
}

// ---------------------------------------------------------------- lamps, alerts, banner, footer
function lampStates() {
  const gps = S.locSource === "url" ? ["green", "Location set by the address (?lat=&lon=)."]
    : S.gps.state === "denied" ? ["red", "Location is blocked. Allow it for this site in your browser settings, or set your location in Settings."]
    : S.gps.state === "ok" && S.locSource === "gps" ? ["green", `GPS fix, ±${fmt(S.gps.acc)} m.`]
    : S.gps.state === "ok" && S.locSource === "home" ? ["green", `Using your saved home. GPS agrees within 1 km${S.gps.acc > 50 ? ` (±${fmt(S.gps.acc)} m, less precise than home)` : ""}.`]
    : S.locSource === "home" ? ["amber", S.gps.state === "pending" ? "Using saved home while GPS gets a fix." : "Using your saved home. GPS gave no fix; that is fine indoors."]
    : S.locSource === "manual" ? ["amber", "Using the location you entered."]
    : ["amber", "Using default location (central Chicago). Allow location or set your home in Settings."];
  const c = compass.state;
  const head = compass.az !== null ? `heading ${fmt(compass.az, 1)}° true (declination ${fmt(S.settings.declination, 1)}°, offset ${S.settings.headingOffset >= 0 ? "+" : ""}${fmt(S.settings.headingOffset, 1)}°)` : "";
  const cmp = c === "live" ? ["green", `Compass live, ${head}.${compass.kind === "sim" ? " Simulated." : ""}`]
    : c === "unsupported" ? ["red", "No compass on this device. In Aim mode, tap the sky view where you see the plane."]
    : c === "denied" ? ["red", "Compass permission was denied. Reload the page, tap Aim, then allow Motion & Orientation."]
    : c === "waiting" ? ["amber", "Waiting for compass data. Move the phone in a figure 8 if it stays amber."]
    : ["amber", compass.needsPermission ? "Compass is off. Tap Aim, then Turn on compass." : "Compass is off. Tap Aim to start it."];
  const age = S.snap ? (Date.now() - S.snap.receivedAt) / 1000 : null;
  const lnk = S.demo ? ["amber", "Demo mode: a recorded response, not live data."]
    : S.error ? ["red", errorText(S.error)]
    : !S.snap ? ["amber", "Connecting to the data link…"]
    : age > 30 ? ["amber", `Data is ${fmt(age)} s old. Retrying.`]
    : ["green", `Live data from ${S.snap.source} via proxy, ${fmt(age)} s old.`];
  return { gps, cmp, lnk };
}
function errorText(e) {
  if (e.kind === "rate") return `Rate limited by the data source. Wait; I retry in ${Math.max(0, Math.ceil((e.retryAt - Date.now()) / 1000))} s.`;
  if (e.kind === "down") return "Positions are missing: adsb.lol and adsb.fi are both down. Nothing to fix on your side; I retry every 10 s.";
  return "Can't reach the position proxy. Check Wi-Fi or mobile data; I retry every 10 s.";
}
let lampOpen = null;
function renderLamps() {
  const L = lampStates();
  for (const [id, k] of [["#lampGps", "gps"], ["#lampCmp", "cmp"], ["#lampLnk", "lnk"]]) $(id).dataset.s = L[k][0];
  if (lampOpen) $("#lampMsg").textContent = L[lampOpen][1];
}
for (const [id, k] of [["#lampGps", "gps"], ["#lampCmp", "cmp"], ["#lampLnk", "lnk"]]) {
  $(id).onclick = () => {
    const m = $("#lampMsg");
    if (lampOpen === k) { lampOpen = null; m.hidden = true; return; }
    lampOpen = k; m.hidden = false; m.className = "msg" + ($(id).dataset.s === "red" ? " red" : ""); m.textContent = lampStates()[k][1];
  };
}
let alertTimer = null;
function renderAlert() {
  const el = $("#alert");
  clearTimeout(alertTimer);
  let html = "";
  if (S.gps.state === "denied" && S.locSource === "default") {
    html = `<div class="msg red">Location is blocked, so I'm using central Chicago.<div class="acts">
      <button class="key small" data-act="manual">Enter location</button><button class="key small" data-act="chicago">Use Chicago</button></div></div>`;
  }
  if (S.error) {
    const stale = S.snap ? ` Last good data is ${fmt((Date.now() - S.snap.receivedAt) / 1000)} s old.` : "";
    html += `<div class="msg red">${esc(errorText(S.error))}${stale}</div>`;
    if (S.error.kind === "rate") alertTimer = setTimeout(renderAlert, 1000);
  }
  el.innerHTML = html; el.hidden = !html;
  el.querySelectorAll("[data-act]").forEach(b => (b.onclick = () => {
    if (b.dataset.act === "chicago") { S.locSource = "default"; S.gps.state = "dismissed"; renderAlert(); renderLamps(); }
    else openSettings("loc");
  }));
}
function renderBanner() {
  const st = S.settings, b = $("#banner");
  if (S.away) b.innerHTML = `Away from home: using full sky here. Your window applies at home.`;
  else if (!st.custom && !st.window) b.innerHTML = `Using defaults: full sky, ${fmt(st.eyeM)} m height. <button data-open>Calibrate</button> for better matches.`;
  else if (st.window) b.innerHTML = `Window <b>${pad3(st.window.azFrom)}°–${pad3(st.window.azTo)}°</b>, sky from ${fmt(Math.min(...st.skyline.map(p => p.el)))}° to ${fmt(st.top)}°, eye ${fmt(st.eyeM)} m.`;
  else b.innerHTML = `Full sky, eye ${fmt(st.eyeM)} m.`;
  b.querySelector("[data-open]")?.addEventListener("click", () => openSettings());
}
function renderFooter() {
  const sn = S.snap;
  const t = sn ? new Date(sn.receivedAt).toLocaleTimeString() : "—";
  const age = sn ? fmt((Date.now() - sn.receivedAt) / 1000) : "—";
  $("#foot").innerHTML = `
    <p>Fetched ${t}, data ${age} s old${sn ? `, ${sn.ac.length} aircraft from ${esc(sn.source)}` : ""}${S.tapAt ? `. Ranked in ${fmt(S.rankMs)} ms` : ""}.</p>
    <p>Positions: <a href="https://adsb.lol" target="_blank">adsb.lol</a> (ODbL 1.0), fallback <a href="https://adsb.fi" target="_blank">adsb.fi</a> open data, via a small proxy.
    Aircraft &amp; routes: <a href="https://www.adsbdb.com" target="_blank">adsbdb</a> (routes © David Taylor &amp; Jim Mason), <a href="https://hexdb.io" target="_blank">hexdb.io</a>.
    Photos: <a href="https://www.planespotters.net" target="_blank">Planespotters.net</a>, credited per photo. Elevation: <a href="https://open-meteo.com" target="_blank">Open-Meteo</a> (CC BY 4.0).
    Weather: <a href="https://aviationweather.gov" target="_blank">aviationweather.gov</a>. Moon: SunCalc (BSD).</p>
    <p>Routes are scheduled routes and may be stale. Never use this for navigation.</p>
    <div class="btns"><button class="key small" id="btnOpenLog">Spotter log</button></div>`;
  $("#btnOpenLog").onclick = openLog;
}
setInterval(() => { if (!document.hidden) { renderFooter(); renderLamps(); } }, 2000);

// ---------------------------------------------------------------- chips
document.querySelectorAll(".chip").forEach(b => (b.onclick = () => {
  const c = b.dataset.chip; S.chipsTouched = true;
  if (S.chips.has(c)) S.chips.delete(c); else {
    S.chips.add(c);
    const ex = { high: "low", low: "high", left: "right", right: "left", toward: "away", away: "toward" }[c];
    if (ex) S.chips.delete(ex);
  }
  syncChips();
  if (S.result) runMatch({ quiet: true }); // re-rank instantly, no fetch
}));
function syncChips() { document.querySelectorAll(".chip").forEach(b => b.setAttribute("aria-pressed", S.chips.has(b.dataset.chip))); }
function nightCheck() {
  if (!window.SunCalc || !S.obs) return;
  const alt = SunCalc.getPosition(new Date(), S.obs.lat, S.obs.lon).altitude * 180 / Math.PI;
  const night = alt < -6;
  document.querySelector('[data-chip="lights"]').classList.toggle("sugg", night);
  if (night && !S.chipsTouched) { S.chips.add("lights"); syncChips(); }
}

// ---------------------------------------------------------------- aim mode
const steady = steadyDetector(1, 800);
let lastLock = 0;
compass.on(() => {
  renderLamps();
  if (S.aimMode && compass.state === "live") {
    $("#aimAz").textContent = fmt(compass.az, 1).padStart(5, "0");
    $("#aimEl").textContent = fmt(compass.el, 1);
    const st = steady(compass.az, compass.el);
    $("#aimSteady").textContent = st ? "YES" : "…";
    radar.aimAz = compass.az;
    if (S.view === "sky") drawSky();
    if (st && performance.now() - lastLock > 2500) lockAim(compass.az, compass.el, "steady");
  }
  if (skyTrace.on) skyTrace.samples.push({ az: compass.az, el: compass.el });
  if (compass.state === "unsupported" && S.aimMode) {
    $("#aimHint").textContent = "No compass here. Tap the sky view where you see the plane.";
    setView("sky");
  }
});
async function setAimMode(on) {
  S.aimMode = on;
  $("#btnAim").setAttribute("aria-pressed", on);
  $("#aimPanel").hidden = !on;
  if (!on) { stopCamera(); return; }
  setView("sky");
  if (compass.state === "live") return;
  if (compass.needsPermission && compass.state !== "denied") { $("#btnCompass").hidden = false; $("#aimHint").textContent = "Tap Turn on compass, then point the top edge of your phone at the plane."; }
  else await compass.start();
}
$("#btnAim").onclick = () => setAimMode(!S.aimMode);
$("#vScope").onclick = () => setView("scope");
$("#vSky").onclick = () => setView("sky");
$("#btnCompass").onclick = async () => { const ok = await compass.start(); $("#btnCompass").hidden = ok; renderLamps(); };
$("#btnLock").onclick = () => {
  if (compass.state === "live") lockAim(compass.az, compass.el, "button");
  else $("#aimHint").textContent = "No compass reading yet. Tap the sky view where you see the plane.";
};
$("#btnAimOff").onclick = () => { S.aim = null; radar.aimAz = null; if (S.result) runMatch({ quiet: true }); setAimMode(false); };
function lockAim(az, el, how) {
  lastLock = performance.now();
  S.aim = { az, el };
  feedback();
  setAimMode(false);
  runMatch();
}
// Viewfinder: rear camera with a crosshair; pointing switches to the camera axis.
let camStream = null;
$("#btnCam").onclick = async () => {
  if (camStream) return stopCamera();
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    const v = $("#video"); v.srcObject = camStream; await v.play();
    $("#vf").hidden = false; compass.axis = "camera"; $("#btnCam").setAttribute("aria-pressed", "true");
    $("#aimHint").textContent = "Center the plane in the circle and hold still.";
  } catch { $("#aimHint").textContent = "Camera not available. Use the top edge of the phone instead."; }
};
function stopCamera() {
  if (camStream) camStream.getTracks().forEach(t => t.stop());
  camStream = null; $("#vf").hidden = true; compass.axis = "top"; $("#btnCam").setAttribute("aria-pressed", "false");
}

// ---------------------------------------------------------------- feedback: ping + vibrate
let actx = null;
function feedback() {
  if (navigator.vibrate) try { navigator.vibrate(30); } catch {}
  if (!S.settings.ping) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = 1180; o.type = "sine";
    g.gain.setValueAtTime(0.0001, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.25, actx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.9);
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.95);
  } catch {}
}

// ---------------------------------------------------------------- main button
$("#btnSee").onclick = async () => {
  S.jokeI++;
  if (S.aimMode && compass.state === "live") return lockAim(compass.az, compass.el, "button");
  await runMatch();
  refresh("after-tap");
};

// ---------------------------------------------------------------- spotter log
function logSighting(c) {
  const a = c.a, d = S.details[a.hex] || {};
  const r = d.route;
  let farMi = null;
  if (r?.origin?.lat && S.obs) farMi = haversine(S.obs.lat, S.obs.lon, r.origin.lat, r.origin.lon) / MI;
  S.log.push({ t: new Date().toISOString(), flight: a.flight || "", hex: a.hex, reg: a.reg || d.ac?.reg || "", type: a.type || d.ac?.icaoType || "",
    airline: airlineName(a, d) || "", route: r?.origin ? `${r.origin.iata || r.origin.code}-${r.destination?.iata || r.destination?.code}` : "",
    origin: r?.origin ? (r.origin.city || r.origin.code) : "", farMi });
  store.set("ps.log", S.log);
  const b = $("#btnLog"); if (b) { b.textContent = "Logged"; b.disabled = true; }
}
function openLog() {
  const L = S.log, body = $("#logBody");
  const count = k => { const m = {}; L.forEach(e => e[k] && (m[e[k]] = (m[e[k]] || 0) + 1)); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const airlines = count("airline").slice(0, 3), types = count("type");
  const rarest = types.length ? types[types.length - 1] : null;
  const far = L.filter(e => Number.isFinite(e.farMi)).sort((a, b) => b.farMi - a.farMi)[0];
  body.innerHTML = `
    <fieldset><legend class="placard">Stats</legend>
      <p>Total sightings: <span class="val">${L.length}</span></p>
      <p>Top airlines: ${airlines.length ? airlines.map(([n, c]) => `${esc(n)} (${c})`).join(", ") : "none yet"}</p>
      <p>Rarest type: ${rarest ? `${esc(rarest[0])} (${rarest[1]})` : "none yet"}</p>
      <p>Farthest origin: ${far ? `${esc(far.origin)}, ${fmt(far.farMi)} mi` : "none yet"}</p>
      <div class="btns"><button class="key small" id="btnCsv" ${L.length ? "" : "disabled"}>Export CSV</button></div></fieldset>
    <table><tr><th>Time</th><th>Flight</th><th>Type</th><th>Route</th></tr>
    ${L.slice().reverse().map(e => `<tr><td>${esc(new Date(e.t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))}</td><td>${esc(e.flight || e.reg || e.hex)}</td><td>${esc(e.type)}</td><td>${esc(e.route)}</td></tr>`).join("") || `<tr><td colspan="4">No sightings yet. Tap Log sighting on a match.</td></tr>`}</table>`;
  const csv = $("#btnCsv");
  if (csv) csv.onclick = () => {
    const rows = [["time", "flight", "type", "route", "airline", "registration", "hex"], ...L.map(e => [e.t, e.flight, e.type, e.route, e.airline, e.reg, e.hex])];
    const blob = new Blob([rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const u = URL.createObjectURL(blob), aEl = document.createElement("a"); aEl.href = u; aEl.download = "spotter-log.csv"; aEl.click(); setTimeout(() => URL.revokeObjectURL(u), 1000);
  };
  $("#dlgLog").showModal();
}

// ---------------------------------------------------------------- settings
const skyTrace = { on: false, samples: [] };
function openSettings(focus) {
  const st = S.settings, body = $("#settingsBody");
  const floor = Math.round((st.eyeM - 1.5) / 3) + 1;
  const moon = window.SunCalc && S.obs ? SunCalc.getMoonPosition(new Date(), S.obs.lat, S.obs.lon) : null;
  const moonAz = moon ? norm360(moon.azimuth * 180 / Math.PI + 180) : null, moonEl = moon ? moon.altitude * 180 / Math.PI : null;
  const w = st.home ? lookAngles(st.home.lat, st.home.lon, st.home.groundM + st.eyeM, WILLIS.lat, WILLIS.lon, WILLIS.topM) : null;
  body.innerHTML = `
  <fieldset id="fsLoc"><legend class="placard">Location</legend>
    <p>Now: <span class="val">${fmt(S.obs.lat, 4)}, ${fmt(S.obs.lon, 4)}</span> (${esc(S.locSource)}), ground ${fmt(S.obs.groundM)} m.</p>
    <div class="pair"><input type="number" step="0.0001" id="inLat" placeholder="Latitude" aria-label="Latitude"><input type="number" step="0.0001" id="inLon" placeholder="Longitude" aria-label="Longitude"></div>
    <div class="btns"><button class="key small" id="btnSetLoc">Set as home</button><button class="key small" id="btnGps">Use GPS as home</button><button class="key small" id="btnChi">Use Chicago</button></div>
  </fieldset>
  <fieldset><legend class="placard">Height</legend>
    <label class="row">Floor <span class="val" id="floorV">${floor} (${fmt(st.eyeM)} m eye)</span></label>
    <input type="range" min="1" max="100" value="${floor}" id="inFloor" aria-label="Floor">
    <label class="row">Search radius <span class="val" id="radV">${st.radiusKm} km</span></label>
    <input type="range" min="10" max="90" step="5" value="${st.radiusKm}" id="inRad" aria-label="Search radius">
  </fieldset>
  <fieldset><legend class="placard">Window</legend>
    <p>${st.window ? `Open from <span class="val">${pad3(st.window.azFrom)}°</span> to <span class="val">${pad3(st.window.azTo)}°</span>.` : "Full sky (no window set)."} Point the phone's top edge at each edge of the window.</p>
    <div class="btns"><button class="key small" id="btnWinL">Mark left edge</button><button class="key small" id="btnWinR">Mark right edge</button><button class="key small" id="btnWinFull">Use full sky</button></div>
    <div class="pair"><input type="number" id="inWinA" placeholder="Left az°" value="${st.window ? st.window.azFrom : ""}" aria-label="Left edge azimuth"><input type="number" id="inWinB" placeholder="Right az°" value="${st.window ? st.window.azTo : ""}" aria-label="Right edge azimuth"></div>
    <p id="winMsg"></p>
  </fieldset>
  <fieldset><legend class="placard">Skyline</legend>
    <p>${st.skyline.length > 1 ? `Traced: ${st.skyline.length} points, ${fmt(Math.min(...st.skyline.map(p => p.el)))}°–${fmt(Math.max(...st.skyline.map(p => p.el)))}°.` : `Flat at ${fmt(st.skyline[0].el)}°.`} Window top ${fmt(st.top)}°.</p>
    <button class="key wide hold" id="btnTrace">Hold and sweep the rooftops</button>
    <div class="btns"><button class="key small" id="btnTop">Mark window top</button></div>
    <div class="pair"><input type="number" id="inSky" placeholder="Skyline el°" aria-label="Flat skyline elevation"><input type="number" id="inTop" placeholder="Top el°" value="${st.top}" aria-label="Window top elevation"></div>
    <p id="skyMsg"></p>
  </fieldset>
  <fieldset><legend class="placard">Compass</legend>
    <p>Declination <span class="val">${fmt(st.declination, 1)}°</span> (WMM2025 for Chicago, late 2026). Offset <span class="val">${st.headingOffset >= 0 ? "+" : ""}${fmt(st.headingOffset, 1)}°</span>.</p>
    <div class="pair"><input type="number" step="0.1" id="inDecl" value="${st.declination}" aria-label="Declination"><button class="key small" id="btnResetOff">Reset offset</button></div>
    <p>${moonEl > 3 ? `Moon is up at ${pad3(moonAz)}°, ${fmt(moonEl)}° high.` : "Moon is below the horizon now."} Willis Tower top is at ${w ? pad3(w.az) + "°" : "—"} from home.</p>
    <div class="btns"><button class="key small" id="btnMoon" ${moonEl > 3 ? "" : "disabled"}>Point at the Moon, save</button><button class="key small" id="btnWillis">Point at Willis Tower, save</button></div>
    <p id="cmpMsg"></p>
  </fieldset>
  <fieldset><legend class="placard">Behavior</legend>
    <label class="row">Auto-refresh results every 10 s <input type="checkbox" id="inAuto" ${st.autoRefresh ? "checked" : ""}></label>
    <label class="row">Keep screen on <input type="checkbox" id="inWake" ${st.wake ? "checked" : ""}></label>
    <label class="row">Radar ping on lock <input type="checkbox" id="inPing" ${st.ping ? "checked" : ""}></label>
  </fieldset>
  <fieldset><legend class="placard">Private setup link</legend>
    <p>Holds your home, height and window. Bookmark it; don't share it.</p>
    <div class="btns"><button class="key small" id="btnLink">Copy setup link</button><button class="key small" id="btnClear">Clear saved data</button></div>
    <p id="linkMsg"></p>
  </fieldset>`;
  const need = (fn, msgEl) => () => { if (compass.state !== "live") { $(msgEl).textContent = "Turn on the compass first: tap Aim, then Turn on compass."; return; } fn(); };
  const done = () => { saveSettings(); setObserver(S.obs.lat, S.obs.lon, S.obs.groundM, S.locSource); renderBanner(); updateRadar(); if (S.result) runMatch({ quiet: true }); };
  $("#btnSetLoc").onclick = async () => {
    const lat = +$("#inLat").value, lon = +$("#inLon").value;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !$("#inLat").value) return;
    const g = await lookupElevation(lat, lon);
    st.home = { lat, lon, groundM: g ?? st.home.groundM }; st.custom = true; setObserver(lat, lon, st.home.groundM, "manual"); done(); openSettings();
  };
  $("#btnGps").onclick = async () => { try { const p = await getGPS(); const g = await lookupElevation(p.lat, p.lon); st.home = { lat: p.lat, lon: p.lon, groundM: g ?? 181 }; S.gps = { state: "ok", acc: p.acc }; setObserver(p.lat, p.lon, st.home.groundM, "gps"); done(); openSettings(); } catch (e) { S.gps.state = e.code === "denied" ? "denied" : "error"; renderLamps(); } };
  $("#btnChi").onclick = () => { st.home = { ...CHICAGO }; setObserver(CHICAGO.lat, CHICAGO.lon, CHICAGO.groundM, "default"); done(); openSettings(); };
  $("#inFloor").oninput = e => { st.eyeM = (e.target.value - 1) * 3 + 1.5; $("#floorV").textContent = `${e.target.value} (${fmt(st.eyeM)} m eye)`; };
  $("#inFloor").onchange = () => { st.custom = true; done(); };
  $("#inRad").oninput = e => { st.radiusKm = +e.target.value; $("#radV").textContent = st.radiusKm + " km"; };
  $("#inRad").onchange = () => { done(); refresh("settings"); };
  let winL = null;
  $("#btnWinL").onclick = need(() => { winL = compass.az; $("#winMsg").textContent = `Left edge ${pad3(winL)}°. Now mark the right edge.`; }, "#winMsg");
  $("#btnWinR").onclick = need(() => {
    if (winL === null) { $("#winMsg").textContent = "Mark the left edge first."; return; }
    st.window = { azFrom: Math.round(winL), azTo: Math.round(compass.az) }; st.custom = true; done(); openSettings();
  }, "#winMsg");
  $("#btnWinFull").onclick = () => { st.window = null; done(); openSettings(); };
  for (const id of ["#inWinA", "#inWinB"]) $(id).onchange = () => {
    const a = +$("#inWinA").value, b = +$("#inWinB").value;
    if ($("#inWinA").value && $("#inWinB").value && Number.isFinite(a) && Number.isFinite(b)) { st.window = { azFrom: norm360(a), azTo: norm360(b) }; st.custom = true; done(); }
  };
  const tr = $("#btnTrace");
  tr.onpointerdown = e => {
    if (compass.state !== "live") { $("#skyMsg").textContent = "Turn on the compass first: tap Aim, then Turn on compass."; return; }
    tr.setPointerCapture(e.pointerId); skyTrace.on = true; skyTrace.samples = []; tr.classList.add("active"); tr.textContent = "Tracing… sweep along the rooftops";
  };
  tr.onpointerup = tr.onpointercancel = () => {
    if (!skyTrace.on) return; skyTrace.on = false; tr.classList.remove("active"); tr.textContent = "Hold and sweep the rooftops";
    const bins = new Map();
    for (const s of skyTrace.samples) { const k = Math.round(s.az / 2) * 2; (bins.get(k) || bins.set(k, []).get(k)).push(s.el); }
    const pts = [...bins.entries()].map(([az, els]) => ({ az, el: els.sort((a, b) => a - b)[Math.floor(els.length / 2)] })).sort((a, b) => a.az - b.az);
    if (pts.length < 3) { $("#skyMsg").textContent = "Too few readings. Hold the button and sweep slowly from one edge to the other."; return; }
    st.skyline = pts; st.custom = true; done(); $("#skyMsg").textContent = `Saved ${pts.length} skyline points. Now tap Mark window top.`;
  };
  $("#btnTop").onclick = need(() => { st.top = Math.round(compass.el); done(); openSettings(); }, "#skyMsg");
  $("#inSky").onchange = e => { const v = +e.target.value; if (e.target.value && Number.isFinite(v)) { st.skyline = [{ az: 0, el: v }]; st.custom = true; done(); } };
  $("#inTop").onchange = e => { const v = +e.target.value; if (Number.isFinite(v)) { st.top = v; done(); } };
  $("#inDecl").onchange = e => { const v = +e.target.value; if (Number.isFinite(v)) { st.declination = v; compass.declination = v; done(); } };
  $("#btnResetOff").onclick = () => { st.headingOffset = 0; compass.offset = 0; done(); openSettings(); };
  const calib = (trueAz, label) => need(() => {
    const raw = norm360(compass.az - st.headingOffset);
    st.headingOffset = +dAz(raw, trueAz).toFixed(1); compass.offset = st.headingOffset; done();
    $("#cmpMsg").textContent = `${label} is at ${pad3(trueAz)}°. Saved offset ${st.headingOffset >= 0 ? "+" : ""}${st.headingOffset}°.`;
  }, "#cmpMsg");
  $("#btnMoon").onclick = () => calib(moonAz, "The Moon")();
  $("#btnWillis").onclick = () => calib(w.az, "Willis Tower")();
  $("#inAuto").onchange = e => { st.autoRefresh = e.target.checked; saveSettings(); };
  $("#inWake").onchange = e => { st.wake = e.target.checked; saveSettings(); wake(); };
  $("#inPing").onchange = e => { st.ping = e.target.checked; saveSettings(); if (st.ping) feedback(); };
  $("#btnLink").onclick = async () => {
    const link = makeSetupLink();
    try { await navigator.clipboard.writeText(link); $("#linkMsg").textContent = "Copied. Keep it private."; }
    catch { $("#linkMsg").innerHTML = `Copy this link: <input type="text" readonly value="${esc(link)}">`; }
  };
  $("#btnClear").onclick = () => { try { localStorage.clear(); } catch {} location.reload(); };
  const dlg = $("#dlgSettings"); if (!dlg.open) dlg.showModal();
  if (focus === "loc") $("#inLat").focus();
}
$("#btnSettings").onclick = () => openSettings();
document.querySelectorAll("[data-close]").forEach(b => (b.onclick = () => b.closest("dialog").close()));

// ---------------------------------------------------------------- wake lock
let wakeLock = null;
async function wake() {
  try {
    if (S.settings.wake && "wakeLock" in navigator && !document.hidden) wakeLock = await navigator.wakeLock.request("screen");
    else if (!S.settings.wake && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) { wake(); refresh("visible"); } });

// ---------------------------------------------------------------- debug panel
function renderDebug() {
  const el = $("#debug"); el.hidden = false;
  const t = selfTest(), pass = t.every(r => r.pass);
  el.innerHTML = `<h2 class="placard">Debug</h2>
    <p class="note">Self-test: <b class="${pass ? "pass" : "fail"}">${pass ? "PASS" : "FAIL"}</b> (${t.filter(r => r.pass).length}/${t.length}, ±0.5°)</p>
    <table><tr><th>Case</th><th>Got</th><th>Want</th><th></th></tr>${t.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.got)}</td><td>${esc(r.want)}</td><td class="${r.pass ? "pass" : "fail"}">${r.pass ? "pass" : "FAIL"}</td></tr>`).join("")}</table>
    <fieldset><legend class="placard">Sensor simulator</legend>
      <label class="row">Heading <span class="val" id="simHV">${fmt(compass.az ?? 195)}°</span></label><input type="range" min="0" max="359" value="${Math.round(compass.az ?? 195)}" id="simH">
      <label class="row">Tilt <span class="val" id="simTV">${fmt(compass.el ?? 40)}°</span></label><input type="range" min="0" max="90" value="${Math.round(compass.el ?? 40)}" id="simT">
    </fieldset>
    <p class="note" id="dbgInfo">Observer ${fmt(S.obs.lat, 4)}, ${fmt(S.obs.lon, 4)} · MSL ${fmt(observerHeights(S.obs).msl)} m · ellipsoid ${fmt(observerHeights(S.obs).ellip)} m · ${S.snap ? S.snap.ac.length : 0} aircraft · latency ${S.snap ? fmt(S.snap.latencyMs) : "—"} ms · ranked ${fmt(S.rankMs, 1)} ms</p>`;
  const sim = () => { compass.simulate(+$("#simH").value, +$("#simT").value); $("#simHV").textContent = $("#simH").value + "°"; $("#simTV").textContent = $("#simT").value + "°"; };
  $("#simH").oninput = sim; $("#simT").oninput = sim;
  window.__selfTest = t;
}

// ---------------------------------------------------------------- boot
async function boot() {
  const fromLink = readSetupHash();
  pruneCache();
  const st = S.settings;
  const qLat = parseFloat(params.get("lat")), qLon = parseFloat(params.get("lon"));
  if (Number.isFinite(qLat) && Number.isFinite(qLon)) setObserver(qLat, qLon, st.home.groundM, "url");
  else setObserver(st.home.lat, st.home.lon, st.home.groundM,
    st.custom || haversine(st.home.lat, st.home.lon, CHICAGO.lat, CHICAGO.lon) > 1000 ? "home" : "default");
  if (params.has("demo")) {
    try { S.demo = await (await fetch(`demo.json?v=${VERSION}`)).json(); setObserver(41.90, -87.63, 181, "url"); } catch {}
  }
  renderBanner(); renderLamps(); renderFooter(); setView("scope"); syncChips();
  if (fromLink !== null) {
    $("#alert").hidden = false;
    $("#alert").innerHTML = fromLink ? `<div class="msg">Setup saved: home, height and window. The link was removed from the address bar.</div>` : `<div class="msg red">That setup link is damaged. Ask for a fresh one or set things up in Settings.</div>`;
    setTimeout(() => { if (!S.error) $("#alert").hidden = true; }, 6000);
  }
  if (DEBUG) { renderDebug(); compass.simulate(195, 40); }
  refresh("open");
  setInterval(() => { if (!document.hidden) refresh("tick"); }, 10000);
  setTimeout(nightCheck, 600);
  fetchMetar().then(w => { S.wx = w; });
  wake();
  // Refine location: saved home instantly, then GPS (5 s). Keep home if GPS is within 1 km but worse than 50 m.
  if (S.locSource === "url" || S.demo) return;
  S.gps.state = "pending"; renderLamps();
  try {
    const p = await getGPS(5000);
    S.gps = { state: "ok", acc: p.acc };
    const d = haversine(p.lat, p.lon, st.home.lat, st.home.lon);
    if (st.custom && d < 1000 && p.acc > 50) { /* keep home */ }
    else if (st.custom && d < 1000) setObserver(p.lat, p.lon, st.home.groundM, "gps");
    else {
      const g = await lookupElevation(p.lat, p.lon);
      setObserver(p.lat, p.lon, g ?? 181, "gps");
      if (!st.custom) { st.home = { lat: p.lat, lon: p.lon, groundM: g ?? 181 }; saveSettings(); setObserver(p.lat, p.lon, st.home.groundM, "gps"); }
    }
    renderBanner(); updateRadar(); refresh("gps");
  } catch (e) {
    S.gps.state = e.code === "denied" ? "denied" : "error";
  }
  renderLamps(); renderAlert();
}
boot();
