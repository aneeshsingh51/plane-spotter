# Plane Spotter — design plan

## Subject
A 1970s–80s airport surveillance console, shrunk to a phone. The scope is the
instrument; everything else is painted sheet metal, engraved placards and lamps.

## Color tokens
| Token     | Hex       | Role |
|-----------|-----------|------|
| glass     | `#0b130e` | Unlit CRT face (scope + sky view only) |
| phosphor  | `#b9dc4a` | P7 yellow-green afterglow: blips, data blocks, data readouts |
| flash     | `#d9ecff` | P7 blue-white fluorescence: sweep line + lock brackets only |
| panel     | `#2a2e28` | Console paint (grey-olive), page background |
| engrave   | `#a9ae9f` | Engraved placard text, secondary text on panel |
| amber     | `#ffb21f` | Indicator lamps, the main push-button, warnings |
| (lamp red)| `#ff5b3a` | Status lamp "fault" only |

Contrast (WCAG, computed): phosphor on glass 12.0:1, phosphor on panel 8.8:1,
engrave on panel 6.1:1, amber on panel 7.7:1, button text #1c1606 on amber 10.0:1 — all ≥ AA.
Lamp red (4.5:1) is a lamp color only, never text.

## Type
- **B612 Mono** — every number, callsign, data block, readout.
- **B612** — interface text and explanations, sentence case.
- Capitals only where a console has them: placards and callsigns.
- Scale (px): 11 placard · 13 secondary · 15 body · 18 data · 28 callsign.

## Layout (390 × 844)
```
┌──────────────────────────────────┐
│ PLANE SPOTTER        ◉GPS ◉CMP ◉LNK│  placard strip, lamps tap→explain
│ Using defaults: full sky…          │  one-line banner
│ ╔════════════════════════════════╗ │
│ ║          RADAR SCOPE           ║ │  square, glass, sweep 4.8 s
│ ║   rings 1/3/5/10/20, wedge     ║ │  (toggle → sky dome)
│ ╚════════════════════════════════╝ │
│ [ SCOPE | SKY ]          [ AIM ◎ ] │  hardware toggles
│ AAL2126 ▲ American · A319 N745VJ   │  top match: callsign hero
│ ORD → MCI  scheduled (may be stale)│
│ 1,700 ft  138 kt  2.1 mi  31°  ↘   │
│ conf HIGH  "Aim error 3°, next 21°"│
│ ─ runner-up strips ─               │
│ ─ incoming list ─                  │
│ ─ footer: sources, ages ─          │
├────────────────────────────────────┤ sticky tray (thumb zone)
│ ‹high&small› ‹low&big› ‹left› …    │  hint chips, h-scroll
│ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃      I SEE A PLANE (lit)        ┃ │  64 px illuminated push-button
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
└────────────────────────────────────┘
```
Left-aligned text. Data readouts on a fixed grid so digits never jump.

## Principles
1. The scope is the only bold thing. Glow, sweep, afterglow live there; the panel is flat paint.
2. Hardware, not app chrome: placards, lamps, a push-button. No cards, no shadows, no gradients outside the glass.
3. Motion answers the user (lock-on, results arriving). The sweep is the one ambient motion; reduced-motion makes it static.
4. Every number names its source and age. Missing data says which field is missing; nothing is invented.

## Review against the brief (changes made)
- First draft used near-black page + green accent — that is the generic "dark + acid accent" look.
  Changed: page is grey-olive console paint; phosphor color is confined to glass and readouts,
  amber belongs to hardware. Two light sources, each with one job.
- First draft put results in rounded cards. Changed: results print onto the panel like a
  readout strip, separated by engraved rules, so the console metaphor holds.
- Dropped the ✈️ emoji from the main button: it clashes with an illuminated console key.
