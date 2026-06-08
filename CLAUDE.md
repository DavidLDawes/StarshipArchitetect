# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Traveller Starship Architect tool that takes .csv ship designs and helps the user architect the ship by setting up the sizes of the floors and sections of the ship, then laying pout the components of the ship on the floors and sections. Engines, fuel, cabins, cargo bays, a bridge or control room, perhaps weapons armor, and shields for military designs as called for in the starships design.

## Build

```bash
npm run build   # minifies into dist/
npm run serve   # serve root for development (http://localhost:8000)
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
docs/               # Implementation notes and design docs
```

## Code Characteristics

- Pure vanilla JavaScript, no frameworks or build system required
- Global state in `shipData` and `uiState` (defined in `src/app.js`)
- Direct DOM manipulation via `document.getElementById()`
- Imperative procedural style throughout
