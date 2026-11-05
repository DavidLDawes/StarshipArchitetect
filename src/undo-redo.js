/**
 * Starship Architect - Undo/Redo Module
 * Handles placement history management for undo and redo operations.
 *
 * Each history entry carries a `type` field:
 *   'place'  — a component (or block of items) was placed; undo removes it and
 *              re-enters placement mode
 *   'delete' — a placement was deleted; undo silently restores it
 *   'fill'   — one or more region allocations were made ("fill rest of floor" or
 *              "fill region"), or a component was placed across several floors;
 *              undo removes them all, redo restores them
 *
 * 'place' and 'delete' entries keep the affected placement object in `entry`
 * (when available) so item counts and region shapes survive undo/redo; older
 * entries without it fall back to matching on floor/x/y. A 'delete' of a component
 * spanning floors also keeps all its entries in `entries`.
 */

// ========================================
// Helpers
// ========================================

/**
 * Remove a placement entry for a component
 * @returns {boolean} True if an entry was removed
 */
function removePlacementEntry(componentIndex, action, entry = action.entry) {
    const placement = shipData.componentPlacements[componentIndex];
    if (!placement || !placement.floors) return false;

    let idx = entry ? placement.floors.indexOf(entry) : -1;
    if (idx === -1) {
        idx = placement.floors.findIndex(f => f.floor === action.floor && f.x === action.x && f.y === action.y);
    }
    if (idx === -1) return false;

    placement.floors.splice(idx, 1);
    if (placement.floors.length === 0) {
        delete shipData.componentPlacements[componentIndex];
    }
    return true;
}

/**
 * Add a placement entry for a component
 */
function addPlacementEntry(componentIndex, entry) {
    if (!shipData.componentPlacements[componentIndex]) {
        shipData.componentPlacements[componentIndex] = { floors: [] };
    }
    shipData.componentPlacements[componentIndex].floors.push(entry);
}

/**
 * Build the entry recorded by an action (for actions that predate `entry`)
 */
function entryFromAction(action) {
    if (action.entry) return action.entry;
    const { floor, x, y, length, width } = action;
    const entry = { floor, x, y, length, width };
    if (action.count > 1) entry.count = action.count;
    return entry;
}

/**
 * Redraw the given floors
 */
function redrawFloors(floors) {
    const { floorWidth, floorLength } = getCurrentFloorDimensions();
    for (const f of new Set(floors)) {
        const canvas = document.getElementById(`floor-canvas-${f}`);
        if (canvas) {
            drawFloorWithComponents(canvas, f, floorLength, floorWidth,
                shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
        }
    }
}

// ========================================
// Undo
// ========================================

function undoLastPlacement() {
    if (uiState.placementHistory.length === 0) return;

    const action = uiState.placementHistory.pop();
    uiState.redoHistory.push(action);

    const { componentIndex } = action;

    if (action.type === 'fill') {
        for (const entry of action.entries) {
            removePlacementEntry(componentIndex, entry, entry);
        }
        redrawFloors(action.entries.map(e => e.floor));
        renderComponents();
        return;
    }

    if (action.type === 'delete') {
        // Restore the deleted placement
        const entry = entryFromAction(action);
        action.entry = entry;
        const restored = action.entries || [entry];
        restored.forEach(e => addPlacementEntry(componentIndex, e));
        redrawFloors(restored.map(e => e.floor));
        renderComponents();
        return;
    }

    // type === 'place': remove it and let the user re-place it
    const { floor, length, width } = action;
    removePlacementEntry(componentIndex, action);
    redrawFloors([floor]);
    renderComponents();

    // Re-enter placement mode so the user can reposition
    const { floorWidth, floorLength } = getCurrentFloorDimensions();
    const allFloors = Array.from({ length: shipData.numFloors }, (_, i) => i + 1);
    const count = action.count || (action.entry && action.entry.count) || 1;
    uiState.isPlacingComponent = true;
    uiState.placementData = { componentIndex, length, width, count, floors: allFloors, currentFloorIndex: 0 };

    // A circle or arc goes back to being placed as the same shape
    const entry = action.entry;
    if (entry && entry.roomShape) {
        Object.assign(uiState.placementData, getRoomFields(entry));
        if (entry.roomShape === 'arc') {
            uiState.placementData.radius = getArcRadius(floor);
            uiState.placementData.floors = getFloorsForRoom(entry, floor);
        }
    }

    for (const f of allFloors) {
        const c = document.getElementById(`floor-canvas-${f}`);
        if (c) {
            drawFloorWithComponents(c, f, floorLength, floorWidth,
                shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
            if (uiState.placementData.floors.includes(f)) c.classList.add('placement-mode');
        }
    }

    const component = shipData.components[componentIndex];
    const totalQuantity = component.quantity || 1;
    const placedCount = getPlacedCount(shipData.componentPlacements[componentIndex]);

    if (count > 1) {
        showBlockPlacementInstructions(allFloors, component.itemName || component.item, count);
    } else if (totalQuantity > 1) {
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
    const { componentIndex } = action;

    if (action.type === 'fill') {
        for (const entry of action.entries) {
            addPlacementEntry(componentIndex, entry);
        }
        uiState.placementHistory.push(action);
        redrawFloors(action.entries.map(e => e.floor));
        renderComponents();
        return;
    }

    if (action.type === 'delete') {
        // Redo the deletion: remove it again
        const deleted = action.entries || [action.entry];
        deleted.forEach(e => removePlacementEntry(componentIndex, action, e));
        uiState.placementHistory.push(action);
        redrawFloors(deleted.map(e => e ? e.floor : action.floor));
        renderComponents();
        return;
    } else {
        // Redo the placement: add it back
        const entry = entryFromAction(action);
        action.entry = entry;
        addPlacementEntry(componentIndex, entry);
    }

    uiState.placementHistory.push(action);
    redrawFloors([action.floor]);
    renderComponents();
}
