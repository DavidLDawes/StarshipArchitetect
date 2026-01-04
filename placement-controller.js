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

    // Component dimensions
    const compLength = data.length;
    const compWidth = data.width;

    // Calculate initial position (center component on click)
    let x = clickX - compLength / 2;
    let y = clickY - compWidth / 2;

    // Snap to edges
    if (clickX <= compLength) {
        x = 0;
    } else if (clickX >= floorLength - compLength) {
        x = floorLength - compLength;
    }

    if (clickY <= compWidth) {
        y = 0;
    } else if (clickY >= floorWidth - compWidth) {
        y = floorWidth - compWidth;
    }

    // Ensure component fits within floor bounds
    x = Math.max(0, Math.min(x, floorLength - compLength));
    y = Math.max(0, Math.min(y, floorWidth - compWidth));

    // Round to nearest meter for clean grid alignment
    x = Math.round(x);
    y = Math.round(y);

    // Try to find a valid position, adjusting if there's overlap
    const position = findValidPosition(
        floorIndex, x, y, compLength, compWidth,
        floorLength, floorWidth, -1
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
        placeMultiFloorComponent(data, x, y, compLength, compWidth, floorLength, floorWidth, canvas);
        return;
    }

    // Place single-floor component
    placeSingleFloorComponent(data, floorIndex, x, y, compLength, compWidth, floorLength, floorWidth, canvas);
}

// ========================================
// Multi-Floor Component Placement
// ========================================

/**
 * Place a component across multiple floors
 */
function placeMultiFloorComponent(data, x, y, compLength, compWidth, floorLength, floorWidth, canvas) {
    // Check overlap on ALL selected floors first
    let allValid = true;
    for (const f of data.floors) {
        if (!findValidPosition(f, x, y, compLength, compWidth, floorLength, floorWidth, -1)) {
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

    for (const f of data.floors) {
        shipData.componentPlacements[data.componentIndex].floors.push({
            floor: f, x: x, y: y, length: compLength, width: compWidth
        });

        // Record in history for undo
        uiState.placementHistory.push({
            componentIndex: data.componentIndex, floor: f,
            x: x, y: y, length: compLength, width: compWidth
        });

        // Redraw each floor
        const c = document.getElementById(`floor-canvas-${f}`);
        if (c) {
            drawFloorWithComponents(c, f, floorLength, floorWidth, shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
            c.classList.remove('placement-mode');
        }
    }

    uiState.redoHistory = [];
    finishPlacement();
}

// ========================================
// Single-Floor Component Placement
// ========================================

/**
 * Place a component on a single floor (handles multi-quantity components)
 */
function placeSingleFloorComponent(data, floorIndex, x, y, compLength, compWidth, floorLength, floorWidth, canvas) {
    // Store placement with individual dimensions
    if (!shipData.componentPlacements[data.componentIndex]) {
        shipData.componentPlacements[data.componentIndex] = { floors: [] };
    }

    shipData.componentPlacements[data.componentIndex].floors.push({
        floor: floorIndex, x: x, y: y, length: compLength, width: compWidth
    });

    // Record in history for undo
    uiState.placementHistory.push({
        componentIndex: data.componentIndex, floor: floorIndex,
        x: x, y: y, length: compLength, width: compWidth
    });
    uiState.redoHistory = [];

    // Check if more items to place (multi-quantity single-floor components)
    const component = shipData.components[data.componentIndex];
    const totalQuantity = component.quantity || 1;
    const placement = shipData.componentPlacements[data.componentIndex];
    const placedCount = placement ? placement.floors.length : 0;

    if (placedCount < totalQuantity) {
        // More items to place - continue placement mode
        renderComponents();
        data.floors = [];
        for (let i = 1; i <= shipData.numFloors; i++) {
            data.floors.push(i);
        }
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
