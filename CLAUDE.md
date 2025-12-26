# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Traveller Starship Architect tool that takes .csv ship designs and helps the user architect the ship by setting up the sizes of the floors and sections of the ship, then laying pout the components of the ship on the floors and sections. Engines, fuel, cabins, cargo bays, a bridge or control room, perhaps weapons armor, and shields for military designs as called for in the starships design.

## Build and Optimization Commands

```bash
# Minify HTML
npx html-minifier --collapse-whitespace --remove-comments index.html -o mini/index.html

# Minify JavaScript
terser -c toplevel --mangle -- sysgen.js > sysgen-terser.js
```

## Architecture

### Core Structure

- **index.html** - Single-page application with canvas-based 2D ship floors laid out, the user places components onto this to architect the ship.


## Code Characteristics

- Pure vanilla JavaScript, no frameworks or build system required
- Direct DOM manipulation via `document.getElementById()`
- Imperative procedural style throughout
