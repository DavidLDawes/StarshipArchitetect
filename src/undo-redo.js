/**
 * Starship Architect - Undo/Redo Module
 * Handles placement history management for undo and redo operations.
 *
 * Each history entry carries a `type` field:
 *   'place'  — a component was placed; undo removes it and re-enters placement mode
 *   'delete' — a component was deleted; undo silently restores it at its original position
 */

// ========================================
// Undo
// ========================================

function undoLastPlacement() {
    if (uiState.placementHistory.length === 0) return;

    const action = uiState.placementHistory.pop();
    uiState.redoHistory.push(action);

    const { componentIndex, floor, x, y, length, width } = action;
    const { floorWidth, floorLength } = getCurrentFloorDimensions();

    if (action.type === 'delete') {
        // Restore the deleted placement at its original position
        if (!shipData.componentPlacements[componentIndex]) {
            shipData.componentPlacements[componentIndex] = { floors: [] };
        }
        shipData.componentPlacements[componentIndex].floors.push({ floor, x, y, length, width });

        const canvas = document.getElementById(`floor-canvas-${floor}`);
        if (canvas) {
            drawFloorWithComponents(canvas, floor, floorLength, floorWidth,
                shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
        }
        renderComponents();
        return;
    }

    // type === 'place': remove it and let the user re-place it
    const placement = shipData.componentPlacements[componentIndex];
    if (placement && placement.floors) {
        const idx = placement.floors.findIndex(f => f.floor === floor && f.x === x && f.y === y);
        if (idx !== -1) {
            placement.floors.splice(idx, 1);
            if (placement.floors.length === 0) {
                delete shipData.componentPlacements[componentIndex];
            }
        }
    }

    const canvas = document.getElementById(`floor-canvas-${floor}`);
    if (canvas) {
        drawFloorWithComponents(canvas, floor, floorLength, floorWidth,
            shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
    }
    renderComponents();

    // Re-enter placement mode so the user can reposition
    const allFloors = Array.from({ length: shipData.numFloors }, (_, i) => i + 1);
    uiState.isPlacingComponent = true;
    uiState.placementData = { componentIndex, length, width, floors: allFloors, currentFloorIndex: 0 };

    for (const f of allFloors) {
        const c = document.getElementById(`floor-canvas-${f}`);
        if (c) {
            drawFloorWithComponents(c, f, floorLength, floorWidth,
                shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
            c.classList.add('placement-mode');
        }
    }

    const component = shipData.components[componentIndex];
    const totalQuantity = component.quantity || 1;
    const currentPlacement = shipData.componentPlacements[componentIndex];
    const placedCount = currentPlacement ? currentPlacement.floors.length : 0;

    if (totalQuantity > 1) {
        showPlacementInstructionsMulti(allFloors, component.itemName || component.item,
            totalQuantity - placedCount, totalQuantity);
    } else {
        showPlacementInstructions(allFloors);
    }
}

// ========================================
// Redo
// ========================================

function redoLastPlacement() {
    if (uiState.redoHistory.length === 0) return;

    const action = uiState.redoHistory.pop();
    const { componentIndex, floor, x, y, length, width } = action;
    const { floorWidth, floorLength } = getCurrentFloorDimensions();

    if (action.type === 'delete') {
        // Redo the deletion: remove it again
        const placement = shipData.componentPlacements[componentIndex];
        if (placement && placement.floors) {
            const idx = placement.floors.findIndex(f => f.floor === floor && f.x === x && f.y === y);
            if (idx !== -1) {
                placement.floors.splice(idx, 1);
                if (placement.floors.length === 0) {
                    delete shipData.componentPlacements[componentIndex];
                }
            }
        }
    } else {
        // Redo the placement: add it back
        if (!shipData.componentPlacements[componentIndex]) {
            shipData.componentPlacements[componentIndex] = { floors: [] };
        }
        shipData.componentPlacements[componentIndex].floors.push({ floor, x, y, length, width });
    }

    uiState.placementHistory.push(action);

    const canvas = document.getElementById(`floor-canvas-${floor}`);
    if (canvas) {
        drawFloorWithComponents(canvas, floor, floorLength, floorWidth,
            shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
    }
    renderComponents();
}
