/**
 * Starship Architect - Placement Controller Module
 * Orchestrates component placement on canvas, handling click events and placement logic
 *
 * Dependencies:
 * - component-selection.js (handleComponentSelection, handleComponentMove)
 * - placement-logic.js (findValidPosition, finishPlacement, checkOverlap)
 * - canvas-renderer.js (drawFloorWithComponents)
 * - floor-utils.js (getCurrentFloorDimensions)
 */

// ========================================
// Canvas Click Handler
// ========================================

/**
 * Handle canvas click during placement or selection
 * Routes clicks to appropriate handlers based on current state
 */
function handleCanvasPlacement(event, floorIndex) {
    // Don't handle click if we just completed a resize
    if (resizeState && resizeState.isResizing) {
        return;
    }

    // Picking a free region to fill with a multi-quantity component
    if (uiState.regionFill) {
        handleRegionFillClick(event, floorIndex);
        return;
    }

    // If we're moving a selected component
    if (uiState.selectedPlacement) {
        handleComponentMove(event, floorIndex);
        return;
    }

    // If not in placement mode, try to select a component
    if (!uiState.isPlacingComponent) {
        handleComponentSelection(event, floorIndex);
        return;
    }

    // Handle placement mode
    placeComponentOnCanvas(event, floorIndex);
}

// ========================================
// Component Placement on Canvas
// ========================================

/**
 * Place a component on the canvas at the clicked position
 */
function placeComponentOnCanvas(event, floorIndex) {
    const data = uiState.placementData;
    if (!data.floors.includes(floorIndex)) return;

    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Calculate floor dimensions
    const { floorWidth, floorLength } = getCurrentFloorDimensions();
    const pixelsPerMeter = canvas.width / floorLength;

    // Get click position in pixels
    const clickPxX = (event.clientX - rect.left) * scaleX;
    const clickPxY = (event.clientY - rect.top) * scaleY;

    // Convert to meters
    const clickX = clickPxX / pixelsPerMeter;
    const clickY = clickPxY / pixelsPerMeter;

    // Circles and arcs find their spot from their own shape
    if (data.roomShape) {
        placeRoomOnCanvas(data, floorIndex, clickX, clickY, floorLength, floorWidth, canvas);
        return;
    }

    // Component dimensions
    const compLength = data.length;
    const compWidth = data.width;

    // Armor boundary
    const armorThickness = shipData.armorThickness || 0;

    // A component spanning several floors has to fit all of them at the same spot
    const fitFloors = data.isMultiFloor ? data.floors : floorIndex;

    // Center the component on the click, keeping it inside the hull. This also
    // puts it flush against a wall when the click is close to one.
    // Do not round here — allow placement at sub-meter precision
    let { x, y } = clampToFloor(fitFloors, clickX - compLength / 2, clickY - compWidth / 2,
        compLength, compWidth, floorLength, floorWidth, armorThickness);

    // Weapons, vehicles, and launch bays must sit against the outer hull:
    // push the component onto the part of the hull nearest the click
    const requireHull = requiresHullAccess(shipData.components[data.componentIndex]);
    if (requireHull) {
        ({ x, y } = snapToFloorHull(fitFloors, x, y, compLength, compWidth, floorLength, floorWidth, armorThickness));
    }

    // Try to find a valid position, adjusting if there's overlap
    const position = findValidPosition(
        floorIndex, x, y, compLength, compWidth,
        floorLength, floorWidth, -1, requireHull, fitFloors
    );

    if (!position) {
        canvas.style.boxShadow = '0 0 20px red';
        setTimeout(() => { canvas.style.boxShadow = ''; }, 300);
        return;
    }

    x = position.x;
    y = position.y;

    // For multi-floor components, place on ALL selected floors at once
    if (data.isMultiFloor) {
        placeMultiFloorComponent(data, x, y, compLength, compWidth, floorLength, floorWidth, canvas, requireHull);
        return;
    }

    // Place single-floor component
    placeSingleFloorComponent(data, floorIndex, x, y, compLength, compWidth, floorLength, floorWidth, canvas);
}

/**
 * Place a circle or arc at the clicked position
 */
function placeRoomOnCanvas(data, floorIndex, clickX, clickY, floorLength, floorWidth, canvas) {
    const requireHull = requiresHullAccess(shipData.components[data.componentIndex]);
    const fitFloors = data.isMultiFloor ? data.floors : [floorIndex];
    const spot = findRoomSpot(data, fitFloors, clickX, clickY, -1, requireHull);

    if (!spot) {
        canvas.style.boxShadow = '0 0 20px red';
        setTimeout(() => { canvas.style.boxShadow = ''; }, 300);
        return;
    }

    const roomFields = getRoomFields(spot);
    if (data.isMultiFloor) {
        placeMultiFloorComponent(data, spot.x, spot.y, spot.length, spot.width, floorLength, floorWidth, canvas, requireHull, roomFields);
    } else {
        placeSingleFloorComponent(data, floorIndex, spot.x, spot.y, spot.length, spot.width, floorLength, floorWidth, canvas, roomFields);
    }
}

// ========================================
// Multi-Floor Component Placement
// ========================================

/**
 * Place a component across multiple floors
 */
function placeMultiFloorComponent(data, x, y, compLength, compWidth, floorLength, floorWidth, canvas, requireHull = false, roomFields = null) {
    // Check the exact position is free on ALL selected floors first
    // (a circle or arc has already been checked on all of them)
    let allValid = true;
    for (const f of roomFields ? [] : data.floors) {
        const pos = findValidPosition(f, x, y, compLength, compWidth, floorLength, floorWidth, -1, requireHull, data.floors);
        if (!pos || Math.abs(pos.x - x) > 1e-6 || Math.abs(pos.y - y) > 1e-6) {
            allValid = false;
            break;
        }
    }

    if (!allValid) {
        canvas.style.boxShadow = '0 0 20px red';
        setTimeout(() => { canvas.style.boxShadow = ''; }, 300);
        return;
    }

    // Place on all selected floors at the same position
    if (!shipData.componentPlacements[data.componentIndex]) {
        shipData.componentPlacements[data.componentIndex] = { floors: [] };
    }

    // A component placed by tonnage shares what's left of it between the floors
    const component = shipData.components[data.componentIndex];
    const tonsPerFloor = canTakeIrregularSpace(component)
        ? getRemainingTons(component, shipData.componentPlacements[data.componentIndex]) / data.floors.length
        : 0;

    const entries = [];
    for (const f of data.floors) {
        const entry = { floor: f, x: x, y: y, length: compLength, width: compWidth, ...roomFields };
        if (tonsPerFloor > 0) entry.tons = tonsPerFloor;
        shipData.componentPlacements[data.componentIndex].floors.push(entry);
        entries.push(entry);

        // Redraw each floor
        const c = document.getElementById(`floor-canvas-${f}`);
        if (c) {
            drawFloorWithComponents(c, f, floorLength, floorWidth, shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
            c.classList.remove('placement-mode');
        }
    }

    // One step to undo: taking away one floor at a time would leave it out of line
    uiState.placementHistory.push({ type: 'fill', componentIndex: data.componentIndex, entries });
    uiState.redoHistory = [];
    finishPlacement();
}

// ========================================
// Single-Floor Component Placement
// ========================================

/**
 * Place a component on a single floor (handles multi-quantity components).
 * When data.count > 1 the rectangle is a block holding that many items and
 * placement mode ends after it is placed.
 */
function placeSingleFloorComponent(data, floorIndex, x, y, compLength, compWidth, floorLength, floorWidth, canvas, roomFields = null) {
    // Store placement with individual dimensions
    if (!shipData.componentPlacements[data.componentIndex]) {
        shipData.componentPlacements[data.componentIndex] = { floors: [] };
    }

    const count = data.count > 1 ? data.count : 1;
    const entry = { floor: floorIndex, x: x, y: y, length: compLength, width: compWidth, ...roomFields };
    if (count > 1) entry.count = count;
    const placedByTons = canTakeIrregularSpace(shipData.components[data.componentIndex]);
    if (placedByTons) {
        entry.tons = getRemainingTons(shipData.components[data.componentIndex], shipData.componentPlacements[data.componentIndex]);
    }
    shipData.componentPlacements[data.componentIndex].floors.push(entry);

    // Record in history for undo
    uiState.placementHistory.push({
        type: 'place',
        componentIndex: data.componentIndex, floor: floorIndex,
        x: x, y: y, length: compLength, width: compWidth,
        count: count,
        entry: entry
    });
    uiState.redoHistory = [];

    // Check if more items to place (multi-quantity single-floor components)
    const component = shipData.components[data.componentIndex];
    const totalQuantity = component.quantity || 1;
    const placement = shipData.componentPlacements[data.componentIndex];
    const placedCount = getPlacedCount(placement);

    if (count === 1 && placedCount < totalQuantity && !placedByTons) {
        // More items to place - continue placement mode
        renderComponents();
        // An arc is cut to its floor's radius, so it can only go on floors the same size
        data.floors = data.roomShape
            ? getFloorsForRoom(data, floorIndex)
            : Array.from({ length: shipData.numFloors }, (_, i) => i + 1);
        for (const floor of data.floors) {
            const c = document.getElementById(`floor-canvas-${floor}`);
            if (c) {
                drawFloorWithComponents(c, floor, floorLength, floorWidth, shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
                c.classList.add('placement-mode');
            }
        }
        const remaining = totalQuantity - placedCount;
        showPlacementInstructionsMulti(data.floors, component.itemName || component.item, remaining, totalQuantity);
    } else {
        // All items placed - finish placement mode
        const canvasEl = document.getElementById(`floor-canvas-${floorIndex}`);
        if (canvasEl) {
            drawFloorWithComponents(canvasEl, floorIndex, floorLength, floorWidth, shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
            canvasEl.classList.remove('placement-mode');
        }
        finishPlacement();
    }
}
