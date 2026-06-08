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
  canvas-renderer.js
  component-dimensions.js
  placement-logic.js
  component-selection.js
  component-resize.js
  undo-redo.js
  drag-preview.js
  placement-controller.js
  component-modal.js
  floor-selector.js
data/               # Sample CSV ship designs
tests/              # Manual test HTML pages and JS test scripts
  unit/             # Jest unit tests (csv-parser, floor-utils, component-dimensions, placement-logic)
  jest-setup.js     # Global stubs for shipData / uiState / constants
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
- Testable modules (`csv-parser.js`, `floor-utils.js`, `component-dimensions.js`, `placement-logic.js`) export via `if (typeof module !== 'undefined') { module.exports = {...}; }` so they load in both browsers (via `<script>`) and Jest (via `require()`)
- Undo/redo history entries carry `type: 'place'` or `type: 'delete'` so the handler knows whether to re-enter placement mode or simply restore/remove a placement
- Armor boundary: `shipData.armorThickness` meters on all sides of each floor canvas; components must stay within the inner usable area
