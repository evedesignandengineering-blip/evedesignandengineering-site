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

### Workspace

The page fills the window: a toolbar, a resizable side panel (inputs), the map / 3D / profile stage, a bottom dock
(poles, conductor schedule, heights, register, issues, log) and an inspector for the selected pole or section. Drag
the gutters or use the arrow keys on them to resize; the toolbar hides or shows each panel and the layout is
remembered in the browser. Construction and conductor fields are searchable lists grouped by source (neighbouring
poles, this project, your PNW projects, the PNW library, GIS feeder) and filtered by circuit voltage, arrangement and
conductor material. Each form shows its checks (errors block the change, warnings and notes do not) before it applies.

3D camera: drag to orbit, right-drag to pan, wheel zooms toward the cursor. Fit (F) frames every pole and wire,
Reset (R) returns to the default view, Focus (Z or double-click) centres the selected pole, and Iso / Side / Front /
Top set standard views. Clicking a wire selects its strain section. The view renders only when something changes.

With no saved project, "Start a design from this ground profile" (in the pole panel) uses the generated `.pnwx` as the design.
In the design you can:

- edit a pole's length, setting depth and "new" flag, or pick a PNW library pole type. Constructions move with the tip so they keep their distance below it.
- add a pole on the ground line at a distance from another pole. A ground point is added at its chainage, interpolated from the profile. Remove a pole that is not in a strain section.
- add, recode or remove constructions and type their attachment points. Typed points are logged as manual and stay under engineering review.
- string conductors in the Conductor schedule tab. Choose the end poles and the circuit (construction code prefix); every pole in between is included. The conductor is copied from the PNW library into Table4, MES is set to the ruling span (it matches the saved projects), and load conditions are copied from an existing section or default to the saved projects' set. Change the conductor, tension or DCSH sag table, or remove a section.

GIS "Distribution HV / LV Overhead" exports are read as conductor runs ("3X7/3.75 AAC" = 3 wires of 7/3.75 AAC). The Geocortex export has no line coordinates, so a run is tied to poles by feeder only: HV runs through the pole's HV feeder, LV runs through its LV feeder. The run is matched to the library conductor of the same name and pre-fills the strain section conductor when the feeder has only one conductor type. The source is logged as GIS.

New rows carry every field PNW 7 writes, in PNW's order. A private copy can set `window.PNW_BUILTIN` (library,
DCSH register, Part 10 text, known layouts) so nothing needs uploading. That data stays outside this repo.

Every edit writes into the project XML through `pnw-model.js`, which keeps every other byte unchanged (the four
saved projects round-trip byte for byte). Edits are undoable, logged with original, proposed and approved value,
source (manual, calculated, AI suggestion) and reference, and exported as the updated `.pnwx` plus a CSV change log.
Save / Open writes everything to a `.pwproj.json` file.

Pole photo suggestions call the `pnw-pole-photo-ai` Supabase function (Gemini, `GEMINI_API_KEY`). The photo is
resized to 1600 px in the browser, sent once and not stored; only codes from the user's library are returned,
and nothing changes until the designer approves a suggestion.

### Tipload

The Tipload button calculates every design pole the way the PNW 7 manual describes it (§3.4.4–3.4.7, §6, §26).
Wind comes from every direction in steps. Conductor tension is found by change of state from the stringing tension at
the ruling span. Conductor, pole, plant and stay loads are added as moment vectors and the worst direction is reported.
Tipload is the ground moment divided by (tip height − load point below tip). Results follow the PNW tipload report:
resultant, direction, wind direction, ØR, % loaded, stay loads, vertical load, B&C check and kingbolt loadings. A polar
diagram and a load-against-wind-direction chart are drawn.

Circuits come from the design's wires at the pole, including intersecting lines at a common pole (PNW's Merge). Stays
and plant come from the pole's Constructions tab, or from the tipload PNW saved for that pole. A dropped PNW tipload
project (`<tipload_project>`) is calculated as saved, so it can be compared with PNW's own report. Load combinations
are entered in the window or pasted from the Options page of a PNW tipload report. The site holds no utility values.
`tests/tipload.test.js` checks the engine against a real PNW report; that report stays outside this repo.

Not modelled: ice loading, span reduction factors other than 1, rectangular poles, foundations and direction
multipliers other than 1.

## Known limitations

- The `.pnwx` export has not yet been reopened in PNW. Only the edited fields change, but PNW's own checks are not reproduced.
- Pole strength, sag-tension tables and clearance calculations stay in PNW. The clearance line in the profile is the project's Clearance 1, for reference only.
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

Browser tests (Playwright) drive the page through the camera, the 12 design scenarios and five desktop sizes, and
fail on console errors, failed requests or horizontal overflow. Serve the page and point `PNW_E2E_URL` at it:

```
PNW_E2E_URL=http://localhost:8000/poles-wires/ PNW_FIXTURES=/path/to/files npm run e2e
```
