# Poles & Wires Ground Profile

Browser tool at `/poles-wires/`. It turns the LiDAR survey, GIS, inspection and defect exports into the
`Ground Profile - <name>.xlsx` workbook that Poles 'n' Wires 7 imports (Profiler → Import easting/northing/elevation,
manual §10.1). PNW then builds the tipload from that profile. Everything runs in the browser and nothing is uploaded.

Files: `index.html` (layout and styles), `app.js` (map, panels, table, review, exports, design editor),
`pnw-core.js` (ground-profile parsing, validation and rules), `pnw-model.js` (.pnwx read/write, PNW library,
DCSH register, stringing tables and attachment geometry; no UI), `view3d.js` (Three.js 3D view, rendering only),
`worker.js` (parses spreadsheets off the main thread). `pnw-core.js` and `pnw-model.js` are shared with the tests.
Libraries: Leaflet 1.9.4, proj4 2.12.1, SheetJS xlsx 0.18.5, JSZip 3.10.1 and three.js 0.160.0 (jsdelivr import map).

## Overhead design (plan, 3D and profile)

Drop a saved PNW project (`.pnwx`) with the survey files. The tool links it as the design and reads its poles,
ground line, constructions (Table8), strain sections (Table3) and conductor attachments (Table6). Optional inputs,
all kept outside this repo: the PNW library tables pasted from PNW (`.txt`), the DCSH standards register
(`.json`, `kind: "dcsh-register"`) and the text of DCSH Part 10 (stringing tables).

| Value | Where it comes from |
| --- | --- |
| Pole position and ground level | Project Table2 easting/northing; Table1 level at the pole chainage |
| Embedment and height above ground | Project `Sunk` and `HeightAG` |
| Pole diameter | PNW library pole type: the tipload's pole type, else matched from the GIS stock description ("11M;6KN"); unknown poles are drawn at 300 mm |
| King bolt height | Project `attht` (imported). "Use default" applies the library default distance below the tip, or below the construction above it (checked against all four saved projects) |
| Attachment point | King bolt + attachment (x, y) from the project. +x is drawn to the right looking along chainage (an assumption, shown in the view) |
| Conductors | One per phase between matching attachment points of consecutive poles in each strain section |
| Sag | Off by default. "DCSH Part 10": sag at the ruling span (√(ΣL³/ΣL)) from the matched or chosen table, existing/final row, scaled by (L/RS)². "Illustrative": w·L²/8T at the stringing tension |
| Construction status | Approved only when an engineer sets it in the register. Otherwise compared with the DCSH register (5 mm tolerance) and marked for engineering review |

Every edit writes into the project XML through `pnw-model.js`, which keeps every other byte unchanged (the four
saved projects round-trip byte for byte). Edits are undoable, logged with original, proposed and approved value,
source (manual, calculated, AI suggestion) and reference, and exported as the updated `.pnwx` plus a CSV change log.
Save / Open writes everything to a `.pwproj.json` file.

Pole photo suggestions call the `pnw-pole-photo-ai` Supabase function (Gemini, `GEMINI_API_KEY`). The photo is
resized to 1600 px in the browser, sent once and not stored; only codes from the user's library are returned,
and nothing changes until the designer approves a suggestion.

## Known limitations

- The `.pnwx` export has not yet been reopened in PNW. Only the edited fields change, but PNW's own checks are not reproduced.
- Strength, tipload and clearance calculations stay in PNW. The clearance line in the profile is the project's Clearance 1, for reference only.
- Attachment offsets exist only for codes found in the user's projects or the DCSH register. LV3, LV5 and HV5 match DCSH L03, L05 and H04-1. HV1, HV1_AS and HV45 drawings dimension the king bolt and phase spacing but not insulator heights, so heights stay unverified. HV9 has no matching Part 4 drawing. A register entry can give `y: null` for a height the drawing does not dimension; only x is then checked.
- New constructions are not attached to a strain section; that is still done in PNW.
- DCSH Part 10 tables whose text extraction is scrambled (HDBC tables, some rural tables) are skipped and listed.
- Crossarm side (+x) follows one convention for the whole line, as PNW does.

## Mapping rules (derived from the reference files)

| Output | Rule |
| --- | --- |
| Sheets | `Groundline` and `Segments`, same headers as the existing workbooks (including "Eleveation") |
| Easting, Northing, Eleveation | `X_COORD_BASE`, `Y_COORD_BASE`, `Z_COORD_BASE` from the QLINK LiDAR export, copied unchanged (MGA) |
| Pole Number | `PICK_ID`, matched to GIS `Pick ID`, inspection `DFIS ID` and defect `DFIS ID` (defects drop the "S") |
| Pole Length | Existing length from the GIS export, else the latest inspection; the user edits it for proposed poles |
| Setting Depth | 10% of pole length + 0.6 m, rounded to 0.01 m |
| Height above Ground | Pole length − setting depth |
| Row order | Along the line: shortest nearest-neighbour chain, starting from the end listed first in the survey; editable |
| Segments | Header only, unless the user enters circuit segments (manual §10.1.3 layout) |
| `.pnwx` (beta) | Ground line and pole tables in PNW 7.18 project XML; chainage = sum of spans each rounded to 0.01 m |

GIS export coordinates are only used to place poles that have no survey row on the map; they differ from LiDAR by up to ~6 m.

## Tests

The regression tests compare output with Ishan's real workbooks and PNW projects. That data is not committed
(this repo is public), so point `PNW_FIXTURES` at the folder that holds it:

```
cd poles-wires/tests && npm install && PNW_FIXTURES=/path/to/files npm test
```
