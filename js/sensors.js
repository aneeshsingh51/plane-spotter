// sensors.js — GPS and compass. Emits plain numbers; no geometry decisions here.
import { pointingFromOrientation, circularLowPass, norm360, dAz } from "./geo.js?v=14";

// ---------------- GPS ----------------
export function getGPS(timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(Object.assign(new Error("No GPS in this browser"), { code: "unsupported" }));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: p.timestamp }),
      e => reject(Object.assign(new Error(e.message || "Location error"), { code: e.code === 1 ? "denied" : e.code === 3 ? "timeout" : "unavailable" })),
      { enableHighAccuracy: true, timeout, maximumAge: 30000 });
  });
}

// ---------------- Compass ----------------
// Pointing vector: the phone's top edge (or rear camera), from the full W3C
// alpha/beta/gamma rotation matrix, corrected for screen orientation.
// Heading reference:
//   iPhone: webkitCompassHeading (magnetic). alpha is relative, so we learn
//           offset = compassHeading - topEdgeAz(alpha) while the phone is near flat,
//           then apply it at any tilt (a rotation about vertical adds a constant to azimuth).
//   Android: 'deviceorientationabsolute' alpha is referenced to magnetic north.
// Magnetic -> true: true = magnetic + declination (west is negative).
export class Compass {
  constructor() {
    this.state = "off";          // off | needs-permission | waiting | live | unsupported | denied
    this.kind = null;            // ios | absolute
    this.declination = -4.2;
    this.offset = 0;             // user calibration (deg, added last)
    this.axis = "top";           // top | camera
    this.iosOffset = null;
    this.lpAz = circularLowPass(0.18);
    this.el = null; this.az = null; this.accuracy = null; this.last = 0;
    this.listeners = new Set();
    this.sim = null;
    this._onAbs = e => this._handle(e, "absolute");
    this._onRel = e => this._handle(e, "ios");
  }
  get needsPermission() {
    return typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function";
  }
  get supported() { return typeof DeviceOrientationEvent !== "undefined"; }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) fn(this); }

  /** Must be called from a user tap on iPhone. */
  async start() {
    if (this.sim) return true;
    if (!this.supported) { this.state = "unsupported"; this._emit(); return false; }
    if (this.needsPermission) {
      try {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== "granted") { this.state = "denied"; this._emit(); return false; }
      } catch { this.state = "needs-permission"; this._emit(); return false; }
    }
    this.state = "waiting"; this._emit();
    window.addEventListener("deviceorientationabsolute", this._onAbs, true);
    window.addEventListener("deviceorientation", this._onRel, true);
    // No events within 2 s (desktop) -> unsupported
    setTimeout(() => { if (this.state === "waiting") { this.state = "unsupported"; this._emit(); } }, 2000);
    return true;
  }
  stop() {
    window.removeEventListener("deviceorientationabsolute", this._onAbs, true);
    window.removeEventListener("deviceorientation", this._onRel, true);
    this.state = "off"; this._emit();
  }
  _screenAngle() {
    return (screen.orientation && Number.isFinite(screen.orientation.angle)) ? screen.orientation.angle : (window.orientation || 0);
  }
  _handle(e, src) {
    if (this.sim) return;
    if (e.alpha === null || e.beta === null) return;
    const p = pointingFromOrientation(e.alpha, e.beta, e.gamma, this._screenAngle(), this.axis);
    let mag;
    if (src === "ios" && Number.isFinite(e.webkitCompassHeading)) {
      this.kind = "ios";
      // Learn iOS offset while the phone is near flat, where webkitCompassHeading is the top-edge heading.
      const flatP = pointingFromOrientation(e.alpha, e.beta, e.gamma, this._screenAngle(), "top");
      if (Math.abs(e.beta) < 45 && Math.abs(e.gamma) < 45 || this.iosOffset === null) {
        const o = dAz(flatP.az, e.webkitCompassHeading);
        this.iosOffset = this.iosOffset === null ? o : this.iosOffset + 0.1 * dAz(this.iosOffset, o);
      }
      mag = p.az + this.iosOffset;
      this.accuracy = e.webkitCompassAccuracy;
    } else if (src === "absolute" || e.absolute === true) {
      this.kind = "absolute";
      mag = p.az;
    } else {
      return; // relative-only event with no heading: useless for us
    }
    this.az = this.lpAz(norm360(mag + this.declination + this.offset));
    this.el = this.el === null ? p.el : this.el + 0.25 * (p.el - this.el);
    this.state = "live"; this.last = performance.now();
    this._emit();
  }
  /** Debug simulator: feed true az/el directly. */
  simulate(az, el) {
    this.sim = { az, el }; this.az = norm360(az); this.el = el; this.state = "live"; this.kind = "sim"; this.last = performance.now();
    this._emit();
    // keep emitting like a real sensor (~10 Hz) so steadiness / auto-lock can be tested
    if (!this._simTimer) this._simTimer = setInterval(() => { if (this.sim && !document.hidden) this._emit(); }, 100);
  }
}

/** Steadiness detector for auto-lock: true when held within ±tol for `ms`. */
export function steadyDetector(tol = 1, ms = 800) {
  let anchor = null, since = 0;
  return (az, el, t = performance.now()) => {
    if (!anchor || Math.abs(dAz(anchor.az, az)) > tol || Math.abs(el - anchor.el) > tol) { anchor = { az, el }; since = t; return false; }
    return t - since >= ms;
  };
}
