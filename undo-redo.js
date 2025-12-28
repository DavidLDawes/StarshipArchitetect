/**
 * Starship Architect - Undo/Redo Module
 * Handles placement history management for undo and redo operations
 */

// ========================================
// Undo Placement
// ========================================

/**
 * Undo the last component placement
 */
function undoLastPlacement() {
    if (uiState.placementHistory.length === 0) {
        return;
    }

    // Get the last placement and move to redo stack
    const lastPlacement = uiState.placementHistory.pop();
    uiState.redoHistory.push(lastPlacement);
    const { componentIndex, floor, x, y, length, width } = lastPlacement;

    // Find and remove this placement from componentPlacements
    const placement = shipData.componentPlacements[componentIndex];
    if (placement && placement.floors) {
        // Find the matching floor placement
        const idx = placement.floors.findIndex(f =>
            f.floor === floor && f.x === x && f.y === y
        );

        if (idx !== -1) {
            placement.floors.splice(idx, 1);

            // If no more placements for this component, remove the entry
            if (placement.floors.length === 0) {
                delete shipData.componentPlacements[componentIndex];
            }
        }
    }

    // Redraw the affected floor
    const totalArea = calculateTotalFloorArea(shipData.totalTons, shipData.ceilingHeight);
    const floorArea = calculateFloorArea(totalArea, shipData.numFloors);
    const floorWidth = calculateFloorWidth(floorArea, shipData.floorLength);

    const canvas = document.getElementById(`floor-canvas-${floor}`);
    if (canvas) {
        drawFloorWithComponents(canvas, floor, shipData.floorLength, floorWidth);
    }

    // Update components list to reflect the change
    renderComponents();

    // Re-enter placement mode for this component so user can reposition it
    // Allow placement on ALL floors, not just the one that was undone
    const allFloors = [];
    for (let i = 1; i <= shipData.numFloors; i++) {
        allFloors.push(i);
    }

    uiState.isPlacingComponent = true;
    uiState.placementData = {
        componentIndex,
        length,
        width,
        floors: allFloors,
        currentFloorIndex: 0
    };

    // Add placement-mode class to all canvases and redraw
    for (const f of allFloors) {
        const c = document.getElementById(`floor-canvas-${f}`);
        if (c) {
            drawFloorWithComponents(c, f, shipData.floorLength, floorWidth);
            c.classList.add('placement-mode');
        }
    }

    // Show correct placement instructions with updated count
    const component = shipData.components[componentIndex];
    const totalQuantity = component.quantity || 1;
    const currentPlacement = shipData.componentPlacements[componentIndex];
    const placedCount = currentPlacement ? currentPlacement.floors.length : 0;

    if (totalQuantity > 1) {
        const remaining = totalQuantity - placedCount;
        showPlacementInstructionsMulti(allFloors, component.itemName || component.item, remaining, totalQuantity);
    } else {
        showPlacementInstructions(allFloors);
    }
}

// ========================================
// Redo Placement
// ========================================

/**
 * Redo the last undone placement
 */
function redoLastPlacement() {
    if (uiState.redoHistory.length === 0) {
        return;
    }

    // Get the last undone placement
    const redoPlacement = uiState.redoHistory.pop();
    const { componentIndex, floor, x, y, length, width } = redoPlacement;

    // Re-add to componentPlacements
    if (!shipData.componentPlacements[componentIndex]) {
        shipData.componentPlacements[componentIndex] = {
            floors: []
        };
    }

    shipData.componentPlacements[componentIndex].floors.push({
        floor: floor,
        x: x,
        y: y,
        length: length,
        width: width
    });

    // Add back to undo history
    uiState.placementHistory.push(redoPlacement);

    // Redraw the affected floor
    const totalArea = calculateTotalFloorArea(shipData.totalTons, shipData.ceilingHeight);
    const floorArea = calculateFloorArea(totalArea, shipData.numFloors);
    const floorWidth = calculateFloorWidth(floorArea, shipData.floorLength);

    const canvas = document.getElementById(`floor-canvas-${floor}`);
    if (canvas) {
        drawFloorWithComponents(canvas, floor, shipData.floorLength, floorWidth);
    }

    // Update components list
    renderComponents();
}
