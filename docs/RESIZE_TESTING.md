# Component Resize Testing Guide

## Overview
The component resize feature allows users to resize selected components by dragging their edges while maintaining constant area (X × Y remains unchanged).

## Setup

1. Start local server: `python -m http.server 8080`
2. Open browser to: `http://localhost:8080/index.html`
3. Load a CSV file: `sample-ship.csv` or `transport.csv`
4. Configure floors and dimensions
5. Place some components on the floor plan

## Feature Requirements

### 1. Edge Detection and Cursor Changes

**Test Steps:**
1. Place a component on a floor (e.g., Bridge - 20 tons)
2. Click on the component to select it (green dashed border appears)
3. Move mouse slowly along each edge of the selected component

**Expected Results:**
- Top edge: Cursor changes to `ns-resize` (vertical double arrow)
- Bottom edge: Cursor changes to `ns-resize` (vertical double arrow)
- Left edge: Cursor changes to `ew-resize` (horizontal double arrow)
- Right edge: Cursor changes to `ew-resize` (horizontal double arrow)
- Inside component (not near edge): Cursor remains default
- Edge detection has ~10 pixel threshold

### 2. Vertical Resize (Top/Bottom Edges)

**Test: Bottom Edge Drag**
1. Select a component (e.g., 5m × 4m, 20m² area)
2. Click and drag the bottom edge downward
3. Observe the preview rectangle

**Expected Results:**
- Height (Y dimension) increases as you drag down
- Width (X dimension) decreases inversely to maintain area
- Formula verified: `newX = 20 / newY`
- Preview shows in green if valid position
- Preview shows dimensions text overlay
- Area remains constant at 20m²

**Test: Top Edge Drag**
1. Select a component
2. Click and drag the top edge upward
3. Observe the preview rectangle

**Expected Results:**
- Height (Y dimension) increases as you drag up
- Width (X dimension) decreases inversely
- Component position (Y coordinate) adjusts
- Preview updates in real-time
- Area remains constant

### 3. Horizontal Resize (Left/Right Edges)

**Test: Right Edge Drag**
1. Select a component (e.g., 5m × 4m, 20m² area)
2. Click and drag the right edge to the right
3. Observe the preview rectangle

**Expected Results:**
- Width (X dimension) increases as you drag right
- Height (Y dimension) decreases inversely to maintain area
- Formula verified: `newY = 20 / newX`
- Preview shows in green if valid position
- Area remains constant at 20m²

**Test: Left Edge Drag**
1. Select a component
2. Click and drag the left edge to the left
3. Observe the preview rectangle

**Expected Results:**
- Width (X dimension) increases as you drag left
- Height (Y dimension) decreases inversely
- Component position (X coordinate) adjusts
- Preview updates in real-time
- Area remains constant

### 4. Constraint Testing

**Test: Wall Boundaries**
1. Place a component near the right edge of the floor
2. Select it and try to drag the right edge beyond the floor boundary

**Expected Results:**
- Resize stops at the floor boundary (wall)
- Cannot resize beyond floor length/width
- Preview turns red when hitting constraint
- Dimensions adjust to maximum possible while maintaining area

**Test: Component Overlap**
1. Place two components near each other
2. Select one and try to resize it to overlap the other

**Expected Results:**
- Preview turns red when resize would cause overlap
- Cannot commit resize that would overlap
- Release mouse shows error feedback (red flash)
- Original size is maintained

**Test: Minimum Dimensions**
1. Select a large, thin component (e.g., 20m × 1m)
2. Try to drag an edge to make it even thinner

**Expected Results:**
- Minimum dimension enforced (1 meter)
- Cannot resize smaller than 1m in any dimension
- Other dimension adjusts to maintain area

### 5. Mouse Interaction Flow

**Test: Complete Resize Operation**
1. Select a component
2. Hover over an edge (cursor changes to resize arrow)
3. Mouse down on edge (resize mode starts)
4. Move mouse while holding button (preview updates)
5. Release mouse button (resize commits)

**Expected Results:**
- Each step works smoothly without glitches
- Preview shows constantly during drag
- Final dimensions are applied on mouse up
- Component redraws with new dimensions
- Area remains exactly the same (verify in console log)

**Test: Cancel Resize**
1. Start resizing a component (mouse down on edge)
2. Press Escape key while dragging

**Expected Results:**
- Resize operation cancels
- Component returns to original size
- Preview disappears
- Selection remains active

### 6. Visual Feedback

**Test: Preview Colors**
1. Start resizing a component with clear space around it

**Expected Results:**
- Preview rectangle is translucent green
- Preview has dashed border (green)
- Dimension text shows: "5.0m × 4.0m"
- Area text shows: "(20.0m²)"

**Test: Invalid Preview**
1. Start resizing toward a wall or another component
2. Drag past the limit

**Expected Results:**
- Preview rectangle turns translucent red
- Preview has dashed red border
- Dimensions still show current preview size
- Cannot commit this resize

### 7. Integration with Other Features

**Test: Resize then Move**
1. Resize a component
2. Click elsewhere on the same component
3. Move it to a new location

**Expected Results:**
- Move operation works with new dimensions
- New dimensions are preserved during move

**Test: Resize then Rotate**
1. Resize a component (e.g., from 5×4 to 10×2)
2. Press 'R' or 'L' to rotate

**Expected Results:**
- Rotation works with new dimensions
- Area still maintained (2×10 = 10×2 = 20m²)

**Test: Resize then Delete**
1. Resize a component
2. Press Delete key

**Expected Results:**
- Component is deleted
- No errors occur

### 8. Console Logging

**Test: Check Console Logs**
1. Open browser developer console (F12)
2. Perform resize operations

**Expected Results:**
- Log shows: "Starting resize: edge=right, component=9, area=20m²"
- Log shows: "Resize committed: 5×4 -> 8×2.5 (area: 20.00m² -> 20.00m²)"
- Area values match exactly (within floating point precision)

## Edge Cases to Test

### Corner Cases
1. Component at (0, 0) - resize with left/top edges
2. Component at bottom-right corner - resize with right/bottom edges
3. Very small component (1m × 1m minimum)
4. Very large component (floor size)

### Special Scenarios
1. Floor with many components tightly packed
2. Resizing between two components with narrow gap
3. Rapid resize operations (drag quickly back and forth)
4. Resize during placement of another component
5. Multiple rapid selections and resizes

### Multi-Floor Components
1. Place a multi-floor component (e.g., large cargo bay)
2. Try to resize it
3. Verify it resizes on all floors it occupies

## Known Limitations

1. Cannot resize multi-floor components differently on each floor (they maintain same dimensions across all floors)
2. Minimum dimension is 1 meter (cannot resize smaller)
3. Area is preserved to 0.1m precision due to rounding
4. Resize only works on selected components (must click to select first)

## Success Criteria

All tests pass with:
- Smooth, responsive UI
- Accurate area preservation
- Proper constraint enforcement
- Clear visual feedback
- No JavaScript errors in console
- Cursor changes work correctly
- Integration with existing features works

## Debugging Tips

If resize doesn't work:
1. Check browser console for errors
2. Verify component-resize.js is loaded (check Network tab)
3. Check that setupResizeHandlers() is called (add console.log)
4. Verify resizeState is accessible globally
5. Check that selected component has valid placement data
6. Ensure floor dimensions are calculated correctly

## Test Data

Recommended components to test with:
- Bridge: 20 tons (5m × 5.6m = 28m²)
- Cargo Hold: 550 tons (74m × 74m = 5476m²) - good for testing large sizes
- Stateroom: 4 tons (4m × 2.8m = 11.2m²) - good for testing small sizes
- Maneuver Drive: 41 tons (10.2m × 5.7m = 57.4m²) - good for testing medium sizes
