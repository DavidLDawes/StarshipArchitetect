# Drag Preview Implementation

## Summary
Implemented drag preview with visual feedback for the Starship Architect tool. The preview shows a translucent rectangle that follows the mouse cursor during component placement and movement operations.

## Files Modified/Created

### New File: drag-preview.js (~210 lines)
- **Preview State Management** (~20 lines): Tracks current mouse position, dimensions, and validation state
- **Preview Rendering** (~40 lines): Draws translucent rectangles with green/red validation coloring
- **Mouse Handlers** (~130 lines): Handles mousemove and mouseleave events with requestAnimationFrame throttling
- **Setup Functions** (~20 lines): Attaches event handlers to canvas elements

### Modified Files:

#### index.html
- Added `<script src="drag-preview.js"></script>` before component-modal.js to ensure proper dependency loading

#### app.js
- Updated `renderFloors()` to call `setupDragPreview()` after rendering all floor canvases

#### placement-logic.js
- Updated `finishPlacement()` to call `clearPreview()`
- Updated `cancelPlacement()` to call `clearPreview()`

#### component-selection.js
- Updated `cancelSelection()` to call `clearPreview()`
- Updated `handleComponentMove()` to call `clearPreview()` after successful move

## Features

### 1. Preview State Management
- Tracks preview position, dimensions, and floor index
- Includes `excludeComponentIndex` for move operations (excludes the component being moved from overlap detection)
- Uses `animationFrameId` for throttling redraws

### 2. Visual Feedback
- **Green translucent** (rgba(0, 255, 100, 0.3)) for valid placements (no overlap)
- **Red translucent** (rgba(255, 0, 0, 0.3)) for invalid placements (overlap detected)
- Dashed border (5px dash, 5px gap) for clear visual distinction
- Preview centered on mouse cursor
- Snaps to grid (rounds to nearest meter)

### 3. Integration Points
- Works during component placement mode (`uiState.isPlacingComponent`)
- Works during component move mode (`uiState.selectedPlacement`)
- Uses existing `checkOverlap()` function from placement-logic.js
- Uses existing `drawFloorWithComponents()` from canvas-renderer.js
- Properly excludes the component being moved from overlap detection

### 4. Performance
- Uses `requestAnimationFrame` to throttle redraws (maximum 60 FPS)
- Cancels pending animation frames when preview is cleared
- Only redraws when mouse moves (not continuous)
- Clears preview on mouseleave to prevent ghost previews

## Testing Instructions

1. **Open the application**
   ```
   Open http://localhost:8000/index.html in a browser
   ```

2. **Load a CSV file**
   - Click "Choose CSV File"
   - Select `sample-ship.csv` or `transport.csv`

3. **Test Component Placement**
   - Click on any component in the "Ship Components" section
   - In the modal, select dimensions and click "Place Component"
   - Move mouse over floor canvases
   - **Expected**: Green translucent rectangle follows mouse
   - Move mouse over existing components
   - **Expected**: Rectangle turns red when overlapping

4. **Test Component Movement**
   - Click on an existing placed component to select it
   - Move mouse over floor canvases
   - **Expected**: Green/red preview follows mouse
   - Click to place component at new location
   - **Expected**: Preview clears after placement

5. **Test Preview Clearing**
   - During placement, press Escape
   - **Expected**: Preview clears
   - Move mouse outside canvas
   - **Expected**: Preview clears

## Implementation Details

### Coordinate System
- Uses meters as the base unit (consistent with existing codebase)
- Converts mouse pixels to meters for calculations
- Snaps to grid by rounding to nearest meter

### Overlap Detection
- For placement mode: `excludeComponentIndex = -1` (checks all components)
- For move mode: `excludeComponentIndex = sel.componentIndex` (excludes the component being moved)

### Event Handlers
- `mousemove`: Updates preview position and triggers redraw
- `mouseleave`: Clears preview and redraws canvas
- Handlers are stored on canvas elements as `_mouseMoveHandler` and `_mouseLeaveHandler` for proper cleanup

### requestAnimationFrame Throttling
```javascript
if (previewState.animationFrameId === null) {
    previewState.animationFrameId = requestAnimationFrame(() => {
        drawFloorWithComponents(canvas, floorIndex, floorLength, floorWidth);
        drawPreview(canvas, floorIndex, floorLength, floorWidth);
        previewState.animationFrameId = null;
    });
}
```

This ensures that even if mousemove fires rapidly, we only redraw at most once per frame (60 FPS).

## Total Lines of Code
- **New code**: ~210 lines (drag-preview.js)
- **Modified code**: ~10 lines (integration calls)
- **Total**: ~220 lines

## Code Style
- Follows vanilla JavaScript patterns from existing codebase
- Direct DOM manipulation
- Imperative procedural style
- Detailed comments
- Clear function names
