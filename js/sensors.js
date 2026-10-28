// sensors.js — GPS and compass. Emits plain numbers; no geometry decisions here.
import { pointingFromOrientation, circularLowPass, norm360, dAz } from "./geo.js?v=15";

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

/** Rough platform, only to pick the right fix-it text. */
export function platform() {
  const ua = navigator.userAgent || "";
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const browser = /CriOS|Chrome/.test(ua) && !/EdgA|Edg\//.test(ua) ? "Chrome" : /FxiOS|Firefox/.test(ua) ? "Firefox" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Safari/.test(ua) ? "Safari" : "this browser";
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  return { ios, android, browser, standalone, mobile: ios || android };
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
//
// States: off | asking | waiting | live | denied | no-heading | unsupported
export class Compass {
  constructor() {
    this.state = "off";
    this.kind = null;            // ios | absolute | sim
    this.declination = -4.2;
    this.offset = 0;             // user calibration (deg, added last)
    this.axis = "top";           // top | camera
    this.iosOffset = null;
    this.lpAz = circularLowPass(0.18);
    this.el = null; this.az = null; this.accuracy = null; this.last = 0;
    this.listeners = new Set();
    this.sim = null;
    this.listening = false;
    this.diag = { perm: null, events: 0, withHeading: 0, absolute: 0, empty: 0, error: null };
    this._onAbs = e => this._handle(e, "absolute");
    this._onRel = e => this._handle(e, "ios");
  }
  get needsPermission() {
    return typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function";
  }
  get supported() { return typeof DeviceOrientationEvent !== "undefined"; }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) fn(this); }
  _set(s) { if (this.state !== s) { this.state = s; this._emit(); } }

  /**
   * Turn the compass on. On iPhone this MUST be called synchronously from a tap:
   * requestPermission() is the first await, so the tap's user activation is still valid.
   */
  async start() {
    if (this.sim || this.state === "live") return true;
    if (!this.supported) { this._set("unsupported"); return false; }
    if (this.needsPermission) {
      this._set("asking");
      try {
        const r = await DeviceOrientationEvent.requestPermission();
        this.diag.perm = r;
        if (r !== "granted") { this._set("denied"); return false; }
      } catch (e) {
        // Thrown when not called from a tap. Treat as "not yet asked".
        this.diag.perm = "error"; this.diag.error = String(e && e.message || e);
        this._set("off"); return false;
      }
    } else this.diag.perm = "not required";
    if (!this.listening) {
      window.addEventListener("deviceorientationabsolute", this._onAbs, true);
      window.addEventListener("deviceorientation", this._onRel, true);
      this.listening = true;
    }
    this._set("waiting");
    // No usable reading in 4 s: say exactly why.
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      if (this.state !== "waiting") return;
      const d = this.diag;
      this._set(d.events > d.empty ? "no-heading" : "unsupported");
    }, 4000);
    return true;
  }
  stop() {
    window.removeEventListener("deviceorientationabsolute", this._onAbs, true);
    window.removeEventListener("deviceorientation", this._onRel, true);
    this.listening = false; this._set("off");
  }
  _screenAngle() {
    return (screen.orientation && Number.isFinite(screen.orientation.angle)) ? screen.orientation.angle : (window.orientation || 0);
  }
  _handle(e, src) {
    if (this.sim) return;
    this.diag.events++;
    if (e.alpha === null || e.beta === null) { this.diag.empty++; return; }
    const p = pointingFromOrientation(e.alpha, e.beta, e.gamma, this._screenAngle(), this.axis);
    let mag;
    if (src === "ios" && Number.isFinite(e.webkitCompassHeading) && e.webkitCompassHeading >= 0) {
      this.diag.withHeading++;
      this.kind = "ios";
      // Learn the iOS offset while the phone is not steep, where webkitCompassHeading is the top-edge heading.
      const flatP = pointingFromOrientation(e.alpha, e.beta, e.gamma, this._screenAngle(), "top");
      if (Math.abs(e.beta) < 45 && Math.abs(e.gamma) < 45 || this.iosOffset === null) {
        const o = dAz(flatP.az, e.webkitCompassHeading);
        this.iosOffset = this.iosOffset === null ? o : this.iosOffset + 0.1 * dAz(this.iosOffset, o);
      }
      mag = p.az + this.iosOffset;
      this.accuracy = e.webkitCompassAccuracy;
    } else if (src === "absolute" || e.absolute === true) {
      this.diag.absolute++;
      this.kind = "absolute";
      mag = p.az;
    } else {
      return; // relative-only event with no heading: not usable as a compass
    }
    this.az = this.lpAz(norm360(mag + this.declination + this.offset));
    this.el = this.el === null ? p.el : this.el + 0.25 * (p.el - this.el);
    this.last = performance.now();
    if (this.state !== "live") { this.state = "live"; clearTimeout(this._timer); }
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
