# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Traveller Starship Architect tool that takes .csv ship designs and helps the user architect the ship by setting up the sizes of the floors and sections of the ship, then laying out the components of the ship on the floors and sections. Engines, fuel, cabins, cargo bays, a bridge or control room, perhaps weapons armor, and shields for military designs as called for in the starships design.

## Build & Dev

```bash
npm run build          # minifies into dist/
npm run serve          # serve root for development (http://localhost:8000)
npm run lint           # ESLint across src/, build.js, and test files
npm run test           # Jest unit tests
npm run test:coverage  # Jest with Istanbul coverage report
```

## Directory Layout

```
index.html          # Entry point (loads scripts from src/)
styles.css          # Global styles
build.js            # Production build script (outputs to dist/)
src/                # JavaScript source modules
  app.js            # Main state, event wiring, CSV loading
  csv-parser.js     # CSV parsing
  floor-utils.js    # Floor dimension calculations
  placement-geometry.js # Placement shapes/counts, free-space regions, fill planning
  hull-access.js    # Which components must touch the outer hull; hull snapping; exposed-hull fill planning
  hull-shapes.js    # Hull shape definitions and per-floor outlines: profiles, polygons, armor inset, fit checks, bands
  curved-rooms.js   # Circle and arc rooms: outlines, overlap against any placement, positioning, size options
  ring-rooms.js     # Ring sections and slices of pie on round floors: geometry, free stretches, size options, filling from the wall in
  rec-health.js     # Combine rec/health with staterooms: classification, overhead, per-floor distribution
  accommodations-panel.js # Combine toggle, staterooms + rec/health per-floor table, combined list entries
  layout-io.js      # Layout file format: serialize, parse/validate/migrate, tolerant restore by component key
  layout-export.js  # SVG deck-plan export (true scale, layer per floor)
  layout-ui.js      # Save/open layout buttons, design-choice and report modal, autosave + restore banner, SVG download
  canvas-renderer.js
  component-dimensions.js
  placement-logic.js
  component-selection.js
  component-resize.js
  undo-redo.js
  drag-preview.js
  placement-controller.js
  component-modal.js
  bulk-allocation.js # Block / fill-floor / fill-region / fill-exposed / fill-rings modes for multi-quantity items
  floor-selector.js
data/               # Sample CSV ship designs
tests/              # Manual test HTML pages and JS test scripts
  unit/             # Jest unit tests (csv-parser, floor-utils, component-dimensions, placement-logic, placement-geometry, hull-access, hull-shapes, curved-rooms, ring-rooms, rec-health, layout-io)
  jest-setup.js     # Global stubs for shipData / uiState / constants; exposes floor-utils, placement-geometry, hull-access, hull-shapes, curved-rooms, ring-rooms, component-dimensions, rec-health, and layout-io helpers as globals
docs/               # Implementation notes and design docs
.github/workflows/  # CI: lint + test/coverage jobs on every push/PR
jest.config.js      # Jest config (node env, coverage thresholds 70/70/55)
.eslintrc.json      # Two-tier ESLint: browser globals for src/, node+jest for tests/
```

## Code Characteristics

- Pure vanilla JavaScript, no frameworks or build system required for the browser app
- Global state in `shipData` and `uiState` (defined in `src/app.js`)
- Direct DOM manipulation via `document.getElementById()`
- Imperative procedural style throughout
- Testable modules (`csv-parser.js`, `floor-utils.js`, `component-dimensions.js`, `component-resize.js`, `placement-logic.js`, `placement-geometry.js`, `hull-access.js`, `hull-shapes.js`, `curved-rooms.js`, `ring-rooms.js`, `rec-health.js`, `layout-io.js`, `layout-export.js`) export via `if (typeof module !== 'undefined') { module.exports = {...}; }` so they load in both browsers (via `<script>`) and Jest (via `require()`)
- Undo/redo history entries carry `type: 'place'`, `'delete'`, or `'fill'` so the handler knows whether to re-enter placement mode or simply restore/remove placements; `entry`/`entries` hold the placement objects themselves so counts and shapes survive undo/redo
- Placement entries are `{floor, x, y, length, width}` plus optional `count` (items held, default 1) and `rects` (odd-shaped region; x/y/length/width is then its bounding box). Always go through `getPlacementRects()` / `getPlacedCount()` rather than reading `length`/`width` or `floors.length` directly
- A one-off component (quantity 1, not placed by tonnage) is one item even when it has an entry per floor, in the same spot on each; `restorePlacements()` relies on that. Anything that changes one entry must change them all: use `getLinkedEntries()`, `getFloorsAfterMove()`, and `updateLinkedEntries()` (placement-logic.js)
- Region (`rects`) placements can be selected and deleted but not moved, rotated, or resized
- Circles and arcs carry `roomShape` (`circle`, or `arc` with `arcAngle` and `arcArea`); x/y/length/width is their bounding box. An arc is the part of a round floor cut off by a straight line, so its curved side is the wall. Use `getRoomOutline()` for exact fit and overlap, and `placementsOverlap()` to compare any two entries; `getPlacementRects()` gives thin bands that can poke slightly past the outline, so use `getPlacementArea()` for area. They can be moved but not resized, and an arc can't move to a floor of a different radius. `getRoomShapeOptions()` offers them, separately from `getDeckDimensionOptions()`, which stays rectangles only for fill-exposed sizes
- Ring rooms carry `roomShape: 'ring'` with `ringOuter`, `ringInner`, `ringAngle` (center of the room) and `ringSweep`; their position comes from the floor's center, and x/y/length/width is just the bounding box. `ringInner` 0 is a slice of pie, and a sweep of `FULL_TURN` is a whole ring or, with `ringInner` 0, a circle. Ring sections aren't convex and a whole ring has a hole, so never treat `getRoomOutline()` as convex: use `getRoomPieces()` for overlap, `isPointInRoom()` for hit tests, `traceRoom()` with the even-odd rule for drawing. They stay on their ring when moved, and can't move to a floor of a different radius
- Fuel, cargo, spares, vacuum, data storage, and cold storage take irregular space (`canTakeIrregularSpace()`). They are placed by tonnage whatever their quantity: their entries carry `tons` and can be split across regions and floors. Use `getRemainingTons()` / `isComponentFullyPlaced()` for them rather than counts
- Size options: use `getDeckDimensionOptions(component, floors)`, which fits the chosen floors on a shaped hull, rather than `generateComponentDimensionOptions()` directly. Dropdown values are `length,width`, or for curved shapes what `parseRoomChoice()` reads (`circle:<diameter>`, `arc:<radius>:<area>`, `ring:<outer>:<inner>:<area>`)
- Armor boundary: `shipData.armorThickness` meters on all walls of each floor; components must stay within the inner usable area. Floors can be any convex shape, so go through the floor-aware helpers `fitsFloor()` / `clampToFloor()` (placement-logic.js) and `getFloorUsableBounds()` / `getShapedInner()` (hull-access.js) rather than working from `floorLength`, `floorWidth`, and armor. They take a floor number, or an array for a component spanning several floors, which has to fit the space those floors share. On a rectangular ship they behave exactly like the plain functions
- Hull rule: components where `requiresHullAccess(component)` is true (weapons, defenses, vehicles, launch bays/hangars) must touch the inner armor face; on a curved or sloping wall a touching corner counts. Every path that sets a position (click placement, drag preview, move, rotate, resize, fill) must keep `touchesFloorHull()` true; use `snapToFloorHull()` and `findValidPosition(..., requireHull, fitFloors)`. Their bulk modes are single / block / fill-exposed instead of fill-floor / fill-region
- Free regions on a curved or sloping floor are built from bands that can poke slightly past the wall (`getOutsideHullRects()`), so draw them inside `clipToFloorHull()`. A region placement that pokes past the wall keeps `rects` even if it is a single rectangle, so it can't be moved or resized
- Rec/health combination: when `shipData.combineRecHealth` is on, stateroom components carry `overheadPerItem` (tons) and rec/health components carry `combinedWithStaterooms`. Use `getEffectiveTonsPerItem()` / `calculateComponentArea()` for item size, never `tonsPerItem` alone. Rec/health items are never placed; their per-floor assignment is derived from stateroom placements by `summarizeAccommodations()` each time `renderComponents()` runs. The toggle is locked while staterooms or rec/health items are placed
- Layouts: `serializeLayout()` / `restorePlacements()` in layout-io.js define the saved format (`format: 'starship-architect-layout'`, `version`). Placements are stored by component key (`category|item|n`), never by index. Any new placement field or ship option must be added to both, and a format change needs a `version` bump plus a step in `migrateLayout()`. The hull shape is saved as `floors.shape`; version 1 layouts migrate to rectangular because their rooms were laid out on rectangular floors, whatever their design file says. Hull shape, floor length, count, and ceiling height are applied directly when loading (their UI handlers clear placements); `updateDimensionDropdown()` must never change `shipData.floorLength`
