// geo.js — pure geometry. No DOM, no state. Every function is testable.
//
// Conventions
//   lat/lon in degrees (WGS84), heights in metres, angles in degrees,
//   azimuth = true bearing clockwise from north, elevation = above horizon.

export const R_EARTH = 6371008.8;   // mean earth radius (m)
export const K_REFRACTION = 0.13;   // standard atmospheric refraction coefficient
export const FT = 0.3048;
export const KT = 0.514444;         // knots -> m/s
export const MI = 1609.344;
export const NM = 1852;

const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;
export const norm360 = a => ((a % 360) + 360) % 360;
/** Signed smallest difference b - a, in (-180, 180]. */
export const dAz = (a, b) => { const d = norm360(b - a); return d > 180 ? d - 360 : d; };

/** Great-circle distance (m), haversine. */
export function haversine(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2), dp = p2 - p1, dl = rad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Initial great-circle bearing from point 1 to point 2 (deg true). */
export function bearing(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return norm360(deg(Math.atan2(y, x)));
}

/** Point reached by travelling `dist` metres on initial bearing `brg`. */
export function destination(lat, lon, brg, dist) {
  const p1 = rad(lat), l1 = rad(lon), b = rad(brg), d = dist / R_EARTH;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [deg(p2), ((deg(l2) + 540) % 360) - 180];
}

/**
 * Look angles from observer to target.
 * Refraction: spherical earth with effective radius Re = R / (1 - k).
 * Both heights must use the SAME datum (ellipsoid vs ellipsoid, or MSL vs MSL).
 * Returns { az, el, ground (m, along surface), slant (m) }.
 */
export function lookAngles(oLat, oLon, oH, tLat, tLon, tH, k = K_REFRACTION) {
  const ground = haversine(oLat, oLon, tLat, tLon);
  const az = ground < 0.5 ? 0 : bearing(oLat, oLon, tLat, tLon);
  const Re = R_EARTH / (1 - k);
  const phi = ground / Re;                       // central angle on the effective earth
  const x = (Re + tH) * Math.sin(phi);           // horizontal offset in observer's plane
  const y = (Re + tH) * Math.cos(phi) - (Re + oH); // height above observer's horizon plane
  return { az, el: deg(Math.atan2(y, x)), ground, slant: Math.hypot(x, y) };
}

/** True angular separation between two sky directions (deg). Not |dAz| + |dEl|:
 *  azimuth differences shrink toward the zenith. */
export function angSep(az1, el1, az2, el2) {
  const e1 = rad(el1), e2 = rad(el2), da = rad(az2 - az1);
  const c = Math.sin(e1) * Math.sin(e2) + Math.cos(e1) * Math.cos(e2) * Math.cos(da);
  return deg(Math.acos(Math.min(1, Math.max(-1, c))));
}

/**
 * Dead-reckon an aircraft `dt` seconds forward from its last position
 * using track, ground speed and vertical rate. Heights in feet in and out.
 */
export function deadReckon(lat, lon, altFt, trackDeg, gsKt, vrateFpm, dt) {
  if (!Number.isFinite(dt) || dt === 0) return { lat, lon, altFt };
  let la = lat, lo = lon;
  if (Number.isFinite(trackDeg) && Number.isFinite(gsKt) && gsKt > 0) {
    // negative dt = where it was earlier (used for "heard, not seen")
    [la, lo] = destination(lat, lon, dt > 0 ? trackDeg : trackDeg + 180, gsKt * KT * Math.abs(dt));
  }
  const a = Number.isFinite(vrateFpm) ? altFt + vrateFpm * dt / 60 : altFt;
  return { lat: la, lon: lo, altFt: a };
}

/** Linear interpolation of a skyline [{az, el}] sorted by az (wraps at 360). */
export function skylineAt(skyline, az) {
  if (!skyline || !skyline.length) return 0;
  if (skyline.length === 1) return skyline[0].el;
  const pts = skyline.slice().sort((a, b) => a.az - b.az);
  const a = norm360(az);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const span = norm360(q.az - p.az) || 360;
    const off = norm360(a - p.az);
    if (off <= span) return p.el + (q.el - p.el) * (off / span);
  }
  return pts[0].el;
}

/** Is azimuth inside window [from, to] going clockwise? Handles wrap (e.g. 350→20). */
export function inAzRange(az, from, to) {
  const span = norm360(to - from) || 360;
  return norm360(az - from) <= span;
}

/**
 * Visibility of a sky direction through the window.
 * mask = { azFrom, azTo, skyline:[{az,el}] , top }
 * margin (deg) > 0 means inside; negative means how far outside.
 * state: 'visible' | 'marginal' (up to 5° outside: "may be hidden") | 'hidden'.
 */
export function visibility(az, el, mask) {
  const full = mask.azFrom === 0 && mask.azTo === 360;
  let azMargin = Infinity;
  if (!full) {
    const span = norm360(mask.azTo - mask.azFrom) || 360;
    const off = norm360(az - mask.azFrom);
    // distance inside window (+) or outside nearest edge (-), scaled by cos(el)
    // so it is an angular distance on the sky, not a raw azimuth difference
    const inside = off <= span ? Math.min(off, span - off) : -Math.min(off - span, 360 - off);
    azMargin = inside * Math.cos(rad(Math.min(el, 89)));
  }
  const floor = skylineAt(mask.skyline, az);
  const margin = Math.min(azMargin, el - floor, (mask.top ?? 90) - el);
  const state = margin >= 0 ? "visible" : margin >= -5 ? "marginal" : "hidden";
  return { margin, state, floor };
}

/**
 * W3C DeviceOrientation rotation matrix (Z-X'-Y'' intrinsic: alpha, beta, gamma).
 * Maps device frame (x right, y top, z out of screen) to earth frame (E, N, Up).
 */
export function rotationMatrix(alpha, beta, gamma) {
  const a = rad(alpha || 0), b = rad(beta || 0), g = rad(gamma || 0);
  const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
  return [
    [cA * cG - sA * sB * sG, -cB * sA, cA * sG + cG * sA * sB],
    [cG * sA + cA * sB * sG,  cA * cB, sA * sG - cA * cG * sB],
    [-cB * sG,                sB,      cB * cG],
  ];
}

/**
 * Direction the phone's top edge points (or the rear camera, axis 'camera'),
 * corrected for screen orientation. alpha must be relative to (magnetic or true) north.
 * Returns { az, el } in the same north reference as alpha.
 */
export function pointingFromOrientation(alpha, beta, gamma, screenAngle = 0, axis = "top") {
  const M = rotationMatrix(alpha, beta, gamma);
  let u;
  if (axis === "camera") u = [0, 0, -1];
  else { const t = rad(screenAngle || 0); u = [Math.sin(t), Math.cos(t), 0]; }
  const v = [0, 1, 2].map(i => M[i][0] * u[0] + M[i][1] * u[1] + M[i][2] * u[2]);
  const az = norm360(deg(Math.atan2(v[0], v[1])));
  const el = deg(Math.asin(Math.max(-1, Math.min(1, v[2]))));
  return { az, el };
}

/** Circular low-pass filter for angles. Returns a stateful function. */
export function circularLowPass(alpha = 0.2) {
  let x = null, y = null;
  return (a) => {
    const cx = Math.cos(rad(a)), cy = Math.sin(rad(a));
    if (x === null) { x = cx; y = cy; } else { x += alpha * (cx - x); y += alpha * (cy - y); }
    return norm360(deg(Math.atan2(y, x)));
  };
}

/**
 * Self-test cases from the design brief, translated to the public default observer
 * (41.90, -87.63, eye 211 m MSL) by one fixed lat/lon offset so no private location ships.
 * The translation moves every expected angle by < 0.07°. Heights are geometric MSL, k = 0.13.
 */
export function selfTest() {
  const o = [41.90, -87.63, 211];
  const T = (name, got, want, tol = 0.5) => ({ name, got: +got.toFixed(2), want, pass: Math.abs(got - want) <= tol });
  const out = [];
  let r = lookAngles(...o, 41.7803, -87.7502, 3000 * FT);
  out.push(T("1 near Midway 3,000 ft az", r.az, 216.8), T("1 Midway el", r.el, 2.4), T("1 Midway mi", r.ground / MI, 10.3, 0.1));
  out.push({ name: "1 Midway hidden (skyline 30°)", got: r.el < 30 ? "hidden" : "visible", want: "hidden", pass: r.el < 30 });
  r = lookAngles(...o, 41.8550, -87.6300, 10000 * FT);
  out.push(T("2 5 km S 10,000 ft az", r.az, 180.0), T("2 el", r.el, 29.6));
  out.push({ name: "2 hidden just under skyline", got: r.el < 30 ? "hidden" : "visible", want: "hidden", pass: r.el < 30 && r.el > 29 });
  r = lookAngles(...o, 41.7732, -87.6919, 37000 * FT);
  out.push(T("3 cruiser 37,000 ft az", r.az, 200.0), T("3 el", r.el, 36.3), T("3 mi", r.ground / MI, 9.3, 0.1));
  out.push({ name: "3 visible", got: r.el >= 30 ? "visible" : "hidden", want: "visible", pass: r.el >= 30 });
  r = lookAngles(...o, 41.90, -87.63, 10000 * FT);
  out.push(T("4 overhead el", r.el, 90.0));
  out.push(T("5 sep az0/el88 vs az180/el88", angSep(0, 88, 180, 88), 4.0));
  // compass sanity: phone flat->tilted up, alpha=165 means top edge at az 195
  const p = pointingFromOrientation(165, 45, 0, 0);
  out.push(T("6 compass top-edge az (α=165,β=45)", p.az, 195), T("6 compass el", p.el, 45));
  return out;
}
