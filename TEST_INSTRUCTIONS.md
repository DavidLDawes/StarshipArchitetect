# Drag Preview Feature - Test Instructions

## Prerequisites
1. Open a terminal in the project directory
2. Start a local web server:
   ```bash
   python -m http.server 8000
   ```
   Or use any other local web server
3. Open a web browser and navigate to `http://localhost:8000/index.html`

## Test Scenarios

### Test 1: Component Placement Mode - Valid Position
**Goal**: Verify green preview appears when hovering over valid positions

1. Click "Choose CSV File" and select `sample-ship.csv`
2. Wait for the UI to load (you should see ship statistics and floor layouts)
3. Scroll to the "Ship Components" section
4. Click on "Bridge" component (20 tons)
5. In the modal:
   - Select dimensions (e.g., "20.0m × 1.0m")
   - Select "Floor 1"
   - Click "Place Component"
6. Move mouse slowly over Floor 1 canvas
7. **Expected Result**:
   - A green translucent rectangle (20m × 1m) follows the mouse cursor
   - Rectangle has a dashed green border
   - Rectangle snaps to grid (whole meter positions)
   - Rectangle is centered on mouse cursor

### Test 2: Component Placement Mode - Invalid Position (Overlap)
**Goal**: Verify red preview appears when hovering over occupied positions

1. Continue from Test 1 (Bridge component should be placed)
2. Click on "Cargo Hold" component (550 tons)
3. In the modal:
   - Select dimensions (e.g., "30.0m × 18.3m")
   - Select "Floor 1"
   - Click "Place Component"
4. Move mouse over the already-placed Bridge component
5. **Expected Result**:
   - Rectangle turns red when overlapping the Bridge component
   - Dashed border turns red
   - Rectangle remains green in empty areas

### Test 3: Preview Clears on Mouse Leave
**Goal**: Verify preview disappears when mouse leaves canvas

1. Continue from Test 2 (in placement mode)
2. Move mouse over Floor 1 canvas (preview should appear)
3. Move mouse outside the canvas boundaries
4. **Expected Result**:
   - Preview disappears immediately
   - Canvas redraws without the preview
   - Moving mouse back onto canvas shows preview again

### Test 4: Preview Clears on Escape
**Goal**: Verify preview clears when canceling placement

1. Continue from Test 2 (in placement mode)
2. Move mouse over Floor 1 canvas (preview should appear)
3. Press Escape key
4. **Expected Result**:
   - Preview disappears
   - Placement mode is canceled
   - "Placement instructions" banner disappears
   - Canvas no longer in placement mode

### Test 5: Component Movement Mode - Valid Position
**Goal**: Verify preview works during component movement

1. After placing Bridge component (Test 1)
2. Click on the placed Bridge component on the canvas
3. Component should be selected (green dashed border around it)
4. Move mouse to a different empty area on Floor 1
5. **Expected Result**:
   - Green translucent preview follows mouse
   - Preview shows the same dimensions as the selected component
   - Preview turns red if it would overlap with other components
   - Preview excludes the selected component from overlap detection

### Test 6: Component Movement - Successful Move
**Goal**: Verify preview clears after successful move

1. Continue from Test 5
2. Click on an empty area to move the component
3. **Expected Result**:
   - Component moves to new position
   - Preview disappears
   - Selection is cleared
   - Canvas redraws with component in new position

### Test 7: Component Movement - Canceled Selection
**Goal**: Verify preview clears when canceling selection

1. Click on a placed component to select it
2. Move mouse over canvas (preview should appear)
3. Press Escape key
4. **Expected Result**:
   - Preview disappears
   - Selection is cleared
   - Instructions banner disappears
   - Component remains at original position

### Test 8: Multi-Floor Preview
**Goal**: Verify preview only appears on correct floor

1. Place a component on Floor 1
2. Place a component on Floor 2
3. Click a component in the list to enter placement mode
4. Select Floor 2 in the modal
5. Click "Place Component"
6. Move mouse over Floor 1 canvas
7. **Expected Result**:
   - No preview appears on Floor 1
8. Move mouse over Floor 2 canvas
9. **Expected Result**:
   - Preview appears on Floor 2

### Test 9: Multi-Quantity Components
**Goal**: Verify preview works for components with quantity > 1

1. Click on "Staterooms x10" component (40 tons, quantity 10)
2. In the modal:
   - Select dimensions (e.g., "4.0m × 1.0m")
   - Select "Floor 1"
   - Click "Place Component"
3. Move mouse over canvas
4. **Expected Result**:
   - Preview appears for first stateroom
5. Click to place first stateroom
6. **Expected Result**:
   - Preview remains active for next stateroom
   - Instructions update to show "Placing Stateroom 2 of 10"
7. Move mouse to different position and place second stateroom
8. **Expected Result**:
   - Preview continues for remaining staterooms

### Test 10: Preview Performance
**Goal**: Verify smooth preview updates without lag

1. Enter placement mode with any component
2. Move mouse rapidly in circles over the canvas
3. **Expected Result**:
   - Preview follows mouse smoothly
   - No visible lag or stuttering
   - Preview updates at consistent rate
   - No performance degradation

### Test 11: Component Rotation with Preview
**Goal**: Verify preview updates after rotation

1. Place a rectangular component (e.g., 10m × 2m)
2. Click to select it
3. Press 'R' key to rotate
4. Move mouse over canvas
5. **Expected Result**:
   - Preview shows rotated dimensions (2m × 10m)
   - Preview validation works with new dimensions

## Browser Console Checks

During testing, open the browser console (F12) and verify:
1. No JavaScript errors appear
2. No warnings about undefined functions
3. `setupDragPreview` is called when floors are rendered
4. `clearPreview` is called when placement/selection is canceled

## Visual Quality Checks

Verify the preview appearance:
- **Valid position**: rgba(0, 255, 100, 0.3) - translucent green
- **Invalid position**: rgba(255, 0, 0, 0.3) - translucent red
- **Border**: Dashed line (5px dash, 5px gap), 2px width
- **Centering**: Preview centered on mouse cursor
- **Grid alignment**: Preview snaps to whole meter positions

## Edge Cases to Test

1. **Boundary snapping**: Move component near edges - should snap to floor boundaries
2. **Zero-ton components**: Software components (0 tons) should not show preview
3. **Rapid mode switching**: Enter/exit placement mode rapidly - no ghost previews
4. **Multiple floor navigation**: Switch between floors during placement - preview only on target floor
5. **Window resize**: Resize browser window - preview should scale correctly

## Success Criteria

All tests pass if:
- Preview appears with correct colors (green/red)
- Preview follows mouse smoothly
- Preview clears properly on all cancel actions
- No JavaScript errors in console
- Performance remains smooth (60 FPS)
- Integration with existing features (placement, movement, rotation) works seamlessly
