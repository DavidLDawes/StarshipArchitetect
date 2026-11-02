# StarshipArchitect

Starship Architect is a tool used to architect Traveler SRD starships. Using this tool you'll layout the floors of your starship as two dimensional plans, splitting your starships tonnage out into floors (and for capital ships, sections) then architecting the floors or sections in detail, putting in engines, fuel, cabins, cargo bays, a bridge or control room, perhaps weapons armor, and shields for military designs as called for in the starships design.

[Traveller Starship Designer](https://srd-tools.com/ShipDesign/index.html), [Traveller Capital Ship Designer](https://srd-tools.com/CapitalShipDesign/index.html), and [Traveller Small Craft Designer](https://srd-tools.com/CapitalShipDesign/index.html) are available to create the designs for your starships and smallcraft and export them as .CSV files for use by StarshipArchitect. Alternatively, any .CSV file with a list of items and their tonnage can be used to create the design for your starship or smallcraft.

## Features

### CSV Import
- **File Upload**: Upload a .CSV file with columns: Category, Item, Tons, Cost
- **URL Parameters**: Load ship designs directly from URL-encoded CSV data (see below)

### Allocating Items That Come in Quantity

Items listed with a quantity (`Staterooms x10` or `Staterooms (x140)`) such as
staterooms on a liner or turrets on a warship can be split across several
rectangles on the same or different floors. Click the component and choose:

- **One at a time**: place each item individually (the original behavior).
- **A block of N items as one rectangle**: choose N and a shape, then click a floor.
- **Fill the rest of the selected floor**: the floor's free space is measured and
  as many items as fit are assigned to it. If the floor has more room than you
  need, the remaining items are packed into part of the free space instead.
- **Fill a free region (pick it on the map)**: hover over any free area, including
  odd-shaped leftovers around other components, to see its area and how many items
  fit, then click to assign them. Keep clicking regions until done; Escape stops.

The component list shows how many are placed per floor (e.g. `Placed 80 of 140 (F1: 60, F2: 20)`)
so the remainder can be accounted for on other floors. Region allocations can be
selected and deleted, and all of these actions support undo/redo (Ctrl+Z / Ctrl+Shift+Z).

### Weapons, Vehicles, and Launch Bays Go on the Hull

Weapons (turrets, barbettes, bays, hard points, and defensive systems such as
point defense, sandcasters, and repulsors), vehicles, and launch bays need access
to space outside the ship, so they must touch the outer hull: the inner face of
the armor at the edge of the floor. These components are marked 🛰️ in the
component list and modal. Clicking to place, moving, rotating, or resizing them
always keeps them on the hull: they snap to the hull side nearest the cursor and
slide along it to the nearest free spot. Ammunition, magazines, and gunners are
not affected.

Hull components that come in quantity offer three allocation options:

- **One at a time**
- **A block of N items as one rectangle**, which snaps to the hull like a single item
- **Fill the rest of the exposed areas for the selected floor**: choose an item
  size (along the hull × depth); the free stretches of hull on that floor are
  lined with blocks of items, top and bottom sides first, then left and right.
  Anything that doesn't fit is left for other floors.

### URL Loading & Sharing

You can load ship designs directly via URL parameters, enabling deep linking, bookmarking, and sharing:

```
index.html?csv=<URL_encoded_CSV_data>
```

**Example:**
```
index.html?csv=Category%2CItem%2CTons%2CCost%0AEngine%2CManeuver%20Drive%2C75%2C1000%0APower%2CPower%20Plant%2C50%2C800
```

**Benefits:**
- **Deep Linking**: Share specific ship designs via URL
- **Bookmarking**: Save ship configurations for later
- **Automation**: Launch the app with predefined data
- **No File Upload**: Skip the upload dialog entirely

**Share Button:**
After loading a CSV file, click the "Share Design" button in the Ship Statistics section to automatically generate a shareable URL and copy it to your clipboard.

**Note:** Very large ship designs may exceed browser URL length limits (~2000 characters). The app will warn you if the generated URL is too long.

## Testing & CI

The project has unit tests and ESLint configured, with GitHub Actions running both on every push and pull request.

### Run tests locally

```bash
npm run lint           # ESLint — zero warnings expected
npm run test           # Jest unit tests
npm run test:coverage  # Jest with Istanbul coverage report
```

Coverage thresholds (enforced by `jest.config.js`): **70% lines, 70% functions, 55% branches** across the pure-logic modules (`csv-parser.js`, `floor-utils.js`, `component-dimensions.js`, `placement-logic.js`, `placement-geometry.js`). Current coverage significantly exceeds those thresholds (~90% lines).

DOM-dependent functions (`finishPlacement`, `cancelPlacement`, all canvas rendering) are intentionally excluded from coverage collection.

## Development & Build

### Development Setup

1. Clone this repository
2. Open `index.html` directly in a browser, or use a local server:
   ```bash
   python -m http.server 8000
   # or
   npm run serve
   ```

### Building for Production

This project includes a build system to minify HTML, JavaScript, and CSS for production deployment.

1. Install build dependencies:
   ```bash
   npm install
   ```

2. Build the project:
   ```bash
   npm run build
   ```

3. The minified files will be in the `dist/` directory, ready for deployment.

For detailed build documentation, see [BUILD.md](BUILD.md).

**Build Results:**
- 40-45% reduction in total file size
- All HTML, JS, and CSS minified
- CSV data files preserved
- Production-ready static site in `dist/`