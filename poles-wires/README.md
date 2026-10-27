# Poles & Wires Ground Profile

Browser tool at `/poles-wires/`. It turns the LiDAR survey, GIS, inspection and defect exports into the
`Ground Profile - <name>.xlsx` workbook that Poles 'n' Wires 7 imports (Profiler → Import easting/northing/elevation,
manual §10.1). PNW then builds the tipload from that profile. Everything runs in the browser and nothing is uploaded.

Files: `index.html` (layout and styles), `app.js` (map, panels, table, review, exports), `pnw-core.js` (all parsing,
validation and engineering rules, shared with the tests), `worker.js` (parses files off the main thread).
Libraries are the ones the site already uses: Leaflet 1.9.4, proj4 2.12.1, SheetJS xlsx 0.18.5 and JSZip 3.10.1.

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
