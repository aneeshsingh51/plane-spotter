# Plane Spotter

A phone web app for window plane-spotting. Tap **I see a plane** and it ranks the aircraft
you are most likely looking at: flight, airline, type, registration, route, altitude, speed,
distance and a confidence score, drawn on a 1970s airport radar scope.

Live: https://aneeshsingh51.github.io/plane-spotter/

## How it works
- Positions: adsb.lol `/v2/point` (fallback adsb.fi). Both block browser calls (no CORS), so a
  ~100-line Cloudflare Worker (`worker/worker.js`) forwards two read-only routes and adds CORS
  for this site only. It rounds your location to 0.01° before it leaves the Worker.
- Every aircraft is dead-reckoned to the moment you tap (track, ground speed, vertical rate,
  position age), then projected to azimuth/elevation with a refraction-corrected spherical earth
  (k = 0.13). Geometric altitude is compared with ellipsoid eye height; barometric with MSL.
- Score = aim match × apparent size × hint chips × freshness × visibility (window/skyline mask).
- Lookups (adsbdb, hexdb, Planespotters, Open-Meteo) run in parallel with 2.5 s timeouts and a 24 h cache.

## URL switches
`?debug=1` self-test + sensor simulator · `?demo=1` recorded response · `?frame=phone` 390×844 frame ·
`?lat=&lon=` location override · `?fail=positions|route|all` simulated outages.

Personal settings (home, height, window, skyline) live only in your browser, loaded once from a
private `#setup=` link that is removed from the address bar after reading.

## Credits and licenses
- Aircraft positions: [adsb.lol](https://adsb.lol), data under ODbL 1.0; [adsb.fi](https://adsb.fi) open data.
- Aircraft and routes: [adsbdb](https://www.adsbdb.com) (route data © David Taylor & Jim Mason), [hexdb.io](https://hexdb.io).
- Photos: [Planespotters.net](https://www.planespotters.net) photo API, credited per photo; images are never stored.
- Elevation: [Open-Meteo](https://open-meteo.com), CC BY 4.0. Weather: [aviationweather.gov](https://aviationweather.gov).
- [SunCalc](https://github.com/mourner/suncalc) (BSD-2-Clause). Fonts: B612 and B612 Mono (SIL OFL).

Not for navigation. Routes are scheduled routes and may be stale.

Code: MIT.
