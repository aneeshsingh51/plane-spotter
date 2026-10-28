// Plane Spotter proxy — Cloudflare Worker.
// Why: adsb.lol, adsb.fi and aviationweather.gov send no CORS headers, so a
// GitHub Pages site cannot call them from the browser. This Worker forwards
// two read-only GET routes and adds CORS for the app's origin only.
//
//   GET /pos?lat=41.90&lon=-87.63&dist=25   -> adsb.lol v2 point (fallback: adsb.fi v2)
//   GET /metar?ids=KMDW                      -> aviationweather.gov METAR JSON
//
// Privacy: lat/lon are rounded to 0.01° (~1 km) before they leave the Worker.
// Nothing is logged or stored except a short edge cache.

const ALLOWED_ORIGINS = [
  "https://aneeshsingh51.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];
const UA = "plane-spotter/1.0 (+https://github.com/aneeshsingh51/plane-spotter)";

function corsHeaders(origin) {
  const h = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "X-Source, X-Upstream-Ms",
    "Access-Control-Max-Age": "86400",
  };
  if (ALLOWED_ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(obj, status, origin, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin), ...extra },
  });
}

async function fetchWithTimeout(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA, "Accept": "application/json" } });
  } finally {
    clearTimeout(t);
  }
}

// Edge-cache an upstream GET for `ttl` seconds. Returns {body, source, ms} or throws.
async function cachedUpstream(ctx, cacheKey, url, ttl, source, timeoutMs) {
  const cache = caches.default;
  const key = new Request("https://cache.plane-spotter/" + cacheKey);
  const hit = await cache.match(key);
  if (hit) return { body: await hit.text(), source: source + " (cache)", ms: 0 };
  const t0 = Date.now();
  const r = await fetchWithTimeout(url, timeoutMs);
  if (!r.ok) throw new Error(source + " HTTP " + r.status);
  const body = await r.text();
  const ms = Date.now() - t0;
  ctx.waitUntil(cache.put(key, new Response(body, { headers: { "Cache-Control": "max-age=" + ttl } })));
  return { body, source, ms };
}

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get("Origin") || "";
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (req.method !== "GET") return json({ error: "GET only" }, 405, origin);

    const url = new URL(req.url);

    if (url.pathname === "/pos") {
      const lat = Number(url.searchParams.get("lat"));
      const lon = Number(url.searchParams.get("lon"));
      let dist = Number(url.searchParams.get("dist") || 25);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        return json({ error: "lat/lon required" }, 400, origin);
      }
      dist = Math.min(50, Math.max(1, Math.round(dist)));
      const la = lat.toFixed(2), lo = lon.toFixed(2);
      const sources = [
        ["adsb.lol", `https://api.adsb.lol/v2/point/${la}/${lo}/${dist}`],
        ["adsb.fi", `https://opendata.adsb.fi/api/v2/lat/${la}/lon/${lo}/dist/${dist}`],
      ];
      const errors = [];
      for (const [name, u] of sources) {
        try {
          const r = await cachedUpstream(ctx, `pos/${name}/${la}/${lo}/${dist}`, u, 2, name, 4000);
          return new Response(r.body, {
            status: 200,
            headers: { "Content-Type": "application/json", "X-Source": r.source, "X-Upstream-Ms": String(r.ms), ...corsHeaders(origin) },
          });
        } catch (e) {
          errors.push(String(e.message || e));
        }
      }
      return json({ error: "all position sources failed", detail: errors }, 502, origin);
    }

    if (url.pathname === "/metar") {
      const ids = (url.searchParams.get("ids") || "KMDW").toUpperCase();
      if (!/^[A-Z0-9]{3,4}$/.test(ids)) return json({ error: "bad ids" }, 400, origin);
      try {
        const r = await cachedUpstream(ctx, "metar/" + ids, `https://aviationweather.gov/api/data/metar?ids=${ids}&format=json`, 120, "aviationweather.gov", 4000);
        return new Response(r.body, { status: 200, headers: { "Content-Type": "application/json", "X-Source": r.source, ...corsHeaders(origin) } });
      } catch (e) {
        return json({ error: String(e.message || e) }, 502, origin);
      }
    }

    return json({ ok: true, routes: ["/pos?lat=&lon=&dist=", "/metar?ids=KMDW"] }, 200, origin);
  },
};
