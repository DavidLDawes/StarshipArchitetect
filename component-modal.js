/**
 * Starship Architect - Component Modal Module
 * Handles component dimension selection and floor placement
 */

// ========================================
// Component Dimension Options
// ========================================

/**
 * Calculate component area in square meters (for a single item)
 * @param {object} component - Component object with tons/tonsPerItem property
 * @returns {number} Area in square meters for one item
 */
function calculateComponentArea(component) {
    // Use per-item tonnage if available (for multi-quantity items)
    const tons = component.tonsPerItem || component.tons;
    return (tons * SQM_PER_TON) / shipData.ceilingHeight;
}

/**
 * Generate dimension options for a component
 * @param {object} component - The component
 * @param {number} floorArea - Area of one floor in m²
 * @param {number} floorLength - Floor length in meters
 * @param {number} floorWidth - Floor width in meters
 * @returns {object} Options and metadata
 */
function generateComponentDimensionOptions(component, floorArea, floorLength, floorWidth) {
    const componentArea = calculateComponentArea(component);
    const options = [];
    const seen = new Set();

    // Determine component size category
    // Use 1m step for anything under 40 sqm
    const isSmall = componentArea < 40;
    const isLarge = componentArea >= floorArea * 0.5;
    const isMultiFloor = componentArea > floorArea;
    const floorsNeeded = Math.ceil(componentArea / floorArea);

    // Minimum dimension - use 1m for small/medium components, 5m for large
    const minDim = isSmall ? 1 : 5;

    // Helper to add option if valid and unique
    function addOption(length, width, label) {
        // Round to reasonable precision
        length = Math.round(length * 10) / 10;
        width = Math.round(width * 10) / 10;

        const key = `${length}x${width}`;
        if (seen.has(key)) return;
        if (length < minDim || width < minDim) return;
        if (length > floorLength || width > floorWidth) return;
        if (length * width < componentArea * 0.95) return; // Must fit the component

        seen.add(key);
        options.push({ length, width, label });
    }

    // Calculate area per floor for multi-floor components
    const areaPerFloor = isMultiFloor ? componentArea / floorsNeeded : componentArea;

    // 1. Floor width-based options (component spans floor width)
    for (let divisor = 1; divisor <= 4; divisor++) {
        const width = floorWidth / divisor;
        if (width >= minDim) {
            const length = areaPerFloor / width;
            if (length <= floorLength && length >= minDim) {
                addOption(length, width, `${length.toFixed(1)} × ${width.toFixed(1)} m`);
            }
        }
    }

    // 2. Floor length-based options (component spans floor length)
    for (let divisor = 1; divisor <= 4; divisor++) {
        const length = floorLength / divisor;
        if (length >= minDim) {
            const width = areaPerFloor / length;
            if (width <= floorWidth && width >= minDim) {
                addOption(length, width, `${length.toFixed(1)} × ${width.toFixed(1)} m`);
            }
        }
    }

    // 3. Square-ish option (close to square)
    const sqSide = Math.sqrt(areaPerFloor);
    if (sqSide >= minDim && sqSide <= Math.min(floorLength, floorWidth)) {
        addOption(sqSide, sqSide, `${sqSide.toFixed(1)} × ${sqSide.toFixed(1)} m`);
    }

    // 4. Multiples of 5m (or 1m for small components)
    const step = isSmall ? 1 : 5;
    const maxLengthOpt = Math.min(floorLength, Math.ceil(areaPerFloor / step));

    for (let l = step; l <= maxLengthOpt; l += step) {
        const w = areaPerFloor / l;
        const roundedW = Math.round(w / step) * step;
        if (roundedW >= step && roundedW <= floorWidth) {
            const actualArea = l * roundedW;
            // Allow slight over-sizing (up to 10% more)
            if (actualArea >= areaPerFloor && actualArea <= areaPerFloor * 1.1) {
                addOption(l, roundedW, `${l} × ${roundedW} m`);
            }
        }
    }

    // Sort options by how close to square they are
    options.sort((a, b) => {
        const ratioA = Math.abs(1 - a.length / a.width);
        const ratioB = Math.abs(1 - b.length / b.width);
        return ratioA - ratioB;
    });

    return {
        options,
        componentArea,
        isSmall,
        isLarge,
        isMultiFloor,
        floorsNeeded,
        areaPerFloor
    };
}

// ========================================
// Modal Management
// ========================================

/**
 * Open the component dimension modal
 * @param {number} componentIndex - Index of the component in shipData.components
 */
function openComponentModal(componentIndex) {
    const component = shipData.components[componentIndex];
    if (!component) return;

    uiState.selectedComponent = componentIndex;

    const totalArea = calculateTotalFloorArea(shipData.totalTons, shipData.ceilingHeight);
    const floorArea = calculateFloorArea(totalArea, shipData.numFloors);
    const floorWidth = calculateFloorWidth(floorArea, shipData.floorLength);

    const dimInfo = generateComponentDimensionOptions(
        component, floorArea, shipData.floorLength, floorWidth
    );

    // Debug: log dimension generation info
    console.log('Component:', component.item, 'tonsPerItem:', component.tonsPerItem, 'tons:', component.tons);
    console.log('Floor area:', floorArea, 'length:', shipData.floorLength, 'width:', floorWidth);
    console.log('Component area:', dimInfo.componentArea);
    console.log('Dimension options generated:', dimInfo.options.length, dimInfo.options);

    // Populate modal
    const modal = document.getElementById('component-modal');
    const modalTitle = document.getElementById('modal-component-name');
    const modalStats = document.getElementById('modal-component-stats');
    const dimSelect = document.getElementById('component-dimensions');
    const floorSelect = document.getElementById('component-floor-select');
    const multiFloorSection = document.getElementById('multi-floor-section');
    const placeBtn = document.getElementById('modal-place-btn');

    modalTitle.textContent = component.item;
    modalStats.innerHTML = `
        <span>📦 ${component.tons} tons</span>
        <span>📐 ${dimInfo.componentArea.toFixed(1)} m²</span>
        <span>💰 ${component.cost.toLocaleString()} MCr</span>
    `;

    // Populate dimension dropdown
    dimSelect.innerHTML = '';
    for (const opt of dimInfo.options) {
        const option = document.createElement('option');
        option.value = `${opt.length},${opt.width}`;
        option.textContent = opt.label;
        dimSelect.appendChild(option);
    }

    // Handle multi-floor components
    if (dimInfo.isMultiFloor) {
        multiFloorSection.classList.remove('hidden');
        document.getElementById('floors-needed').textContent = dimInfo.floorsNeeded;

        // Create floor checkboxes
        const floorCheckboxes = document.getElementById('floor-checkboxes');
        floorCheckboxes.innerHTML = '';
        for (let i = 1; i <= shipData.numFloors; i++) {
            const label = document.createElement('label');
            label.className = 'floor-checkbox-label';
            label.innerHTML = `
                <input type="checkbox" name="component-floors" value="${i}">
                Floor ${i}
            `;
            floorCheckboxes.appendChild(label);
        }

        floorSelect.classList.add('hidden');
    } else {
        multiFloorSection.classList.add('hidden');
        floorSelect.classList.remove('hidden');

        // Populate single floor select
        floorSelect.innerHTML = '';
        for (let i = 1; i <= shipData.numFloors; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `Floor ${i}`;
            floorSelect.appendChild(option);
        }
    }

    // Store metadata for placement
    modal.dataset.isMultiFloor = dimInfo.isMultiFloor;
    modal.dataset.floorsNeeded = dimInfo.floorsNeeded;
    modal.dataset.componentIndex = componentIndex;

    // Show modal
    modal.classList.remove('hidden');
}

/**
 * Close the component modal (without canceling placement mode)
 */
function closeComponentModal() {
    const modal = document.getElementById('component-modal');
    modal.classList.add('hidden');
    uiState.selectedComponent = null;
    // Don't reset isPlacingComponent here - it's managed by startPlacement/finishPlacement
}

/**
 * Start placement mode
 */
function startPlacement() {
    const modal = document.getElementById('component-modal');
    const componentIndex = parseInt(modal.dataset.componentIndex);
    const dimSelect = document.getElementById('component-dimensions');
    const dimValue = dimSelect.value;
    console.log('Dimension dropdown value:', dimValue);

    const parts = dimValue.split(',');
    const length = parseFloat(parts[0]);
    const width = parseFloat(parts[1]);

    console.log('Parsed dimensions:', { length, width });

    if (isNaN(length) || isNaN(width) || length <= 0 || width <= 0) {
        alert('Invalid dimensions selected. Please select valid dimensions.');
        return;
    }

    // Determine which floors
    let selectedFloors = [];
    if (modal.dataset.isMultiFloor === 'true') {
        const checkboxes = document.querySelectorAll('input[name="component-floors"]:checked');
        selectedFloors = Array.from(checkboxes).map(cb => parseInt(cb.value));

        const floorsNeeded = parseInt(modal.dataset.floorsNeeded);
        if (selectedFloors.length < floorsNeeded) {
            alert(`Please select at least ${floorsNeeded} floors for this component.`);
            return;
        }
    } else {
        const floorSelect = document.getElementById('component-floor-select');
        selectedFloors = [parseInt(floorSelect.value)];
    }

    // Store placement info
    uiState.isPlacingComponent = true;
    uiState.placementData = {
        componentIndex,
        length,
        width,
        floors: selectedFloors,
        currentFloorIndex: 0
    };

    console.log('Placement data set:', uiState.placementData);

    // Close modal and enable canvas clicks
    closeComponentModal();

    // Add placement-mode class to relevant canvases
    for (const floor of selectedFloors) {
        const canvas = document.getElementById(`floor-canvas-${floor}`);
        if (canvas) {
            canvas.classList.add('placement-mode');
        }
    }

    // Show placement instructions
    showPlacementInstructions(selectedFloors);

    // Scroll to the first floor canvas
    const firstFloorCanvas = document.getElementById(`floor-canvas-${selectedFloors[0]}`);
    if (firstFloorCanvas) {
        firstFloorCanvas.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

/**
 * Show placement instructions
 */
function showPlacementInstructions(floors) {
    let instructions = document.getElementById('placement-instructions');
    if (!instructions) {
        instructions = document.createElement('div');
        instructions.id = 'placement-instructions';
        instructions.className = 'placement-instructions';
        document.body.appendChild(instructions);
    }

    if (floors.length === 1) {
        instructions.textContent = `Click on Floor ${floors[0]} to place the component. Press Escape to cancel.`;
    } else {
        instructions.textContent = `Click on Floors ${floors.join(', ')} to place the component. Press Escape to cancel.`;
    }
    instructions.classList.remove('hidden');
}

/**
 * Show placement instructions for multi-quantity components
 */
function showPlacementInstructionsMulti(floors, itemName, remaining, total) {
    let instructions = document.getElementById('placement-instructions');
    if (!instructions) {
        instructions = document.createElement('div');
        instructions.id = 'placement-instructions';
        instructions.className = 'placement-instructions';
        document.body.appendChild(instructions);
    }

    const placed = total - remaining;
    instructions.textContent = `Placing ${itemName} (${placed + 1} of ${total}). Click on any floor. Press Escape to finish early.`;
    instructions.classList.remove('hidden');
}

/**
 * Handle canvas click during placement or selection
 */
function handleCanvasPlacement(event, floorIndex) {
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

    const data = uiState.placementData;
    if (!data.floors.includes(floorIndex)) return;

    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Calculate floor dimensions
    const totalArea = calculateTotalFloorArea(shipData.totalTons, shipData.ceilingHeight);
    const floorArea = calculateFloorArea(totalArea, shipData.numFloors);
    const floorWidth = calculateFloorWidth(floorArea, shipData.floorLength);
    const floorLength = shipData.floorLength;
    const pixelsPerMeter = canvas.width / floorLength;

    // Get click position in pixels
    const clickPxX = (event.clientX - rect.left) * scaleX;
    const clickPxY = (event.clientY - rect.top) * scaleY;

    // Convert to meters
    const clickX = clickPxX / pixelsPerMeter;
    const clickY = clickPxY / pixelsPerMeter;

    // Component dimensions
    const compLength = data.length;  // X dimension
    const compWidth = data.width;    // Y dimension

    // Calculate initial position (center component on click)
    let x = clickX - compLength / 2;
    let y = clickY - compWidth / 2;

    // Snap to edges - if within component dimension of an edge, snap to it
    // Left edge snap
    if (clickX <= compLength) {
        x = 0;
    }
    // Right edge snap
    else if (clickX >= floorLength - compLength) {
        x = floorLength - compLength;
    }

    // Top edge snap
    if (clickY <= compWidth) {
        y = 0;
    }
    // Bottom edge snap
    else if (clickY >= floorWidth - compWidth) {
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
        floorLength, floorWidth, -1  // Check against ALL placements, no exclusions
    );

    if (!position) {
        // No valid position found - show error feedback
        canvas.style.boxShadow = '0 0 20px red';
        setTimeout(() => {
            canvas.style.boxShadow = '';
        }, 300);
        return;
    }

    // Use the adjusted position
    x = position.x;
    y = position.y;

    // Store placement
    if (!shipData.componentPlacements[data.componentIndex]) {
        shipData.componentPlacements[data.componentIndex] = {
            length: compLength,
            width: compWidth,
            floors: []
        };
    }

    shipData.componentPlacements[data.componentIndex].floors.push({
        floor: floorIndex,
        x: x,
        y: y
    });

    // Record in history for undo
    uiState.placementHistory.push({
        componentIndex: data.componentIndex,
        floor: floorIndex,
        x: x,
        y: y,
        length: compLength,
        width: compWidth
    });

    // Clear redo history since we made a new action
    uiState.redoHistory = [];

    // Check if this is a multi-quantity component that has more items to place
    const component = shipData.components[data.componentIndex];
    const totalQuantity = component.quantity || 1;
    const placement = shipData.componentPlacements[data.componentIndex];
    const placedCount = placement ? placement.floors.length : 0;

    if (placedCount < totalQuantity) {
        // More items of this type to place - stay in placement mode with ALL floors available
        renderComponents(); // Update the count display

        // Reset floors list - allow placement on any floor (including the one just placed on)
        data.floors = [];
        for (let i = 1; i <= shipData.numFloors; i++) {
            data.floors.push(i);
        }

        // Redraw all floors and add placement-mode class
        for (const floor of data.floors) {
            const canvas = document.getElementById(`floor-canvas-${floor}`);
            if (canvas) {
                drawFloorWithComponents(canvas, floor, shipData.floorLength, floorWidth);
                canvas.classList.add('placement-mode');
            }
        }

        // Show instructions for next item placement
        const remaining = totalQuantity - placedCount;
        showPlacementInstructionsMulti(data.floors, component.itemName || component.item, remaining, totalQuantity);

        console.log(`Placed ${placedCount} of ${totalQuantity} ${component.itemName || component.item}. ${remaining} remaining.`);
    } else {
        // All items of this type placed - finish
        // First redraw the floor to show the final placed component
        const canvasEl = document.getElementById(`floor-canvas-${floorIndex}`);
        if (canvasEl) {
            drawFloorWithComponents(canvasEl, floorIndex, shipData.floorLength, floorWidth);
            canvasEl.classList.remove('placement-mode');
        }
        finishPlacement();
    }
}

/**
 * Check if a placement overlaps with existing components
 * @param {number} excludeComponentIndex - Set to -1 to check all, or a specific index to exclude that component
 */
function checkOverlap(floorIndex, x, y, length, width, excludeComponentIndex = -1) {
    for (const [compIdxStr, placement] of Object.entries(shipData.componentPlacements)) {
        const compIdx = parseInt(compIdxStr);
        // Only skip if explicitly excluding this specific component (used for repositioning)
        if (excludeComponentIndex >= 0 && compIdx === excludeComponentIndex) continue;

        if (!placement.floors) continue;

        for (const pos of placement.floors) {
            if (pos.floor !== floorIndex) continue;

            // Check rectangle overlap
            const overlap = !(x + length <= pos.x ||
                pos.x + placement.length <= x ||
                y + width <= pos.y ||
                pos.y + placement.width <= y);

            if (overlap) return true;
        }
    }
    return false;
}

/**
 * Find a valid position for a component, adjusting if there's overlap
 * @returns {object|null} {x, y} if valid position found, null otherwise
 */
function findValidPosition(floorIndex, origX, origY, compLength, compWidth, floorLength, floorWidth, excludeComponentIndex) {
    // First, check if original position works
    if (!checkOverlap(floorIndex, origX, origY, compLength, compWidth, excludeComponentIndex)) {
        return { x: origX, y: origY };
    }

    // Get all components on this floor that might overlap
    const overlappingComponents = [];
    for (const [compIdxStr, placement] of Object.entries(shipData.componentPlacements)) {
        const compIdx = parseInt(compIdxStr);
        if (compIdx === excludeComponentIndex) continue;
        if (!placement.floors) continue;

        for (const pos of placement.floors) {
            if (pos.floor === floorIndex) {
                overlappingComponents.push({
                    x: pos.x,
                    y: pos.y,
                    length: placement.length,
                    width: placement.width
                });
            }
        }
    }

    // Generate candidate positions by aligning to edges of overlapping components
    const candidates = [];

    for (const comp of overlappingComponents) {
        // Try placing to the right of this component
        candidates.push({ x: comp.x + comp.length, y: origY });

        // Try placing to the left of this component
        candidates.push({ x: comp.x - compLength, y: origY });

        // Try placing below this component
        candidates.push({ x: origX, y: comp.y + comp.width });

        // Try placing above this component
        candidates.push({ x: origX, y: comp.y - compWidth });

        // Try corner positions
        candidates.push({ x: comp.x + comp.length, y: comp.y + comp.width });
        candidates.push({ x: comp.x + comp.length, y: comp.y - compWidth });
        candidates.push({ x: comp.x - compLength, y: comp.y + comp.width });
        candidates.push({ x: comp.x - compLength, y: comp.y - compWidth });
    }

    // Also try floor edges
    candidates.push({ x: 0, y: origY });
    candidates.push({ x: floorLength - compLength, y: origY });
    candidates.push({ x: origX, y: 0 });
    candidates.push({ x: origX, y: floorWidth - compWidth });

    // Filter and sort candidates
    const validCandidates = candidates
        .map(pos => ({
            x: Math.round(Math.max(0, Math.min(pos.x, floorLength - compLength))),
            y: Math.round(Math.max(0, Math.min(pos.y, floorWidth - compWidth)))
        }))
        .filter(pos => !checkOverlap(floorIndex, pos.x, pos.y, compLength, compWidth, excludeComponentIndex))
        .map(pos => ({
            ...pos,
            distance: Math.sqrt(Math.pow(pos.x - origX, 2) + Math.pow(pos.y - origY, 2))
        }))
        .sort((a, b) => a.distance - b.distance);

    // Remove duplicates
    const seen = new Set();
    const uniqueCandidates = validCandidates.filter(pos => {
        const key = `${pos.x},${pos.y}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // Return the closest valid position, or null if none found
    if (uniqueCandidates.length > 0) {
        return { x: uniqueCandidates[0].x, y: uniqueCandidates[0].y };
    }

    return null;
}

/**
 * Finish placement mode
 */
function finishPlacement() {
    uiState.isPlacingComponent = false;
    uiState.placementData = null;

    // Remove placement-mode class from all canvases
    document.querySelectorAll('.floor-canvas.placement-mode').forEach(c => {
        c.classList.remove('placement-mode');
    });

    // Hide instructions
    const instructions = document.getElementById('placement-instructions');
    if (instructions) {
        instructions.classList.add('hidden');
    }

    // Update component list to show placed status
    renderComponents();
}

/**
 * Cancel placement mode
 */
function cancelPlacement() {
    if (!uiState.isPlacingComponent) return;

    // Remove any partial placements for this component
    const data = uiState.placementData;
    if (data && shipData.componentPlacements[data.componentIndex]) {
        // Keep existing placements, just cancel the current session
    }

    finishPlacement();
}

// ========================================
// Event Listeners Setup
// ========================================

/**
 * Set up modal event listeners
 */
function setupComponentModalEvents() {
    // Close button
    document.getElementById('modal-close-btn').addEventListener('click', closeComponentModal);

    // Cancel button
    document.getElementById('modal-cancel-btn').addEventListener('click', closeComponentModal);

    // Place button
    document.getElementById('modal-place-btn').addEventListener('click', startPlacement);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Escape to cancel selection, placement, or close modal
        if (e.key === 'Escape') {
            if (uiState.selectedPlacement) {
                cancelSelection();
            } else if (uiState.isPlacingComponent) {
                cancelPlacement();
            } else {
                closeComponentModal();
            }
        }

        // Ctrl+Shift+Z to redo
        if (e.ctrlKey && e.shiftKey && e.key === 'Z') {
            e.preventDefault();
            redoLastPlacement();
            return;
        }

        // Ctrl+Z to undo last placement
        if (e.ctrlKey && e.key === 'z') {
            e.preventDefault(); // Prevent browser's default undo
            undoLastPlacement();
        }
    });

    // Click outside modal to close
    document.getElementById('component-modal').addEventListener('click', (e) => {
        if (e.target.id === 'component-modal') {
            closeComponentModal();
        }
    });
}

/**
 * Undo the last component placement
 */
function undoLastPlacement() {
    if (uiState.placementHistory.length === 0) {
        console.log('Nothing to undo');
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

    // Show feedback
    const component = shipData.components[componentIndex];
    console.log(`Undid placement of "${component.item}" from Floor ${floor}`);

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

/**
 * Redo the last undone placement
 */
function redoLastPlacement() {
    if (uiState.redoHistory.length === 0) {
        console.log('Nothing to redo');
        return;
    }

    // Get the last undone placement
    const redoPlacement = uiState.redoHistory.pop();
    const { componentIndex, floor, x, y, length, width } = redoPlacement;

    // Re-add to componentPlacements
    if (!shipData.componentPlacements[componentIndex]) {
        shipData.componentPlacements[componentIndex] = {
            length: length,
            width: width,
            floors: []
        };
    }

    shipData.componentPlacements[componentIndex].floors.push({
        floor: floor,
        x: x,
        y: y
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

    // Show feedback
    const component = shipData.components[componentIndex];
    console.log(`Redid placement of "${component.item}" on Floor ${floor}`);
}

/**
 * Handle clicking on the canvas to select a component
 */
function handleComponentSelection(event, floorIndex) {
    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Calculate click position in meters
    const totalArea = calculateTotalFloorArea(shipData.totalTons, shipData.ceilingHeight);
    const floorArea = calculateFloorArea(totalArea, shipData.numFloors);
    const floorWidth = calculateFloorWidth(floorArea, shipData.floorLength);
    const floorLength = shipData.floorLength;
    const pixelsPerMeter = canvas.width / floorLength;

    const clickPxX = (event.clientX - rect.left) * scaleX;
    const clickPxY = (event.clientY - rect.top) * scaleY;
    const clickX = clickPxX / pixelsPerMeter;
    const clickY = clickPxY / pixelsPerMeter;

    // Find component at click position
    for (const [compIdxStr, placement] of Object.entries(shipData.componentPlacements)) {
        const compIdx = parseInt(compIdxStr);
        if (!placement.floors) continue;

        for (let i = 0; i < placement.floors.length; i++) {
            const pos = placement.floors[i];
            if (pos.floor !== floorIndex) continue;

            // Check if click is inside this component
            if (clickX >= pos.x && clickX <= pos.x + placement.length &&
                clickY >= pos.y && clickY <= pos.y + placement.width) {

                // Select this component
                uiState.selectedPlacement = {
                    componentIndex: compIdx,
                    floorIndex: floorIndex,
                    placementIndex: i,
                    length: placement.length,
                    width: placement.width,
                    originalX: pos.x,
                    originalY: pos.y
                };

                // Add visual feedback
                canvas.classList.add('selection-mode');

                // Redraw with selection highlight
                drawFloorWithComponents(canvas, floorIndex, floorLength, floorWidth);
                drawSelectionHighlight(canvas, pos.x, pos.y, placement.length, placement.width, pixelsPerMeter);

                // Show instructions
                showSelectionInstructions();

                console.log(`Selected ${shipData.components[compIdx].item} at (${pos.x}, ${pos.y})`);
                return;
            }
        }
    }
}

/**
 * Handle moving a selected component to a new position
 */
function handleComponentMove(event, floorIndex) {
    const sel = uiState.selectedPlacement;
    if (!sel) return;

    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Calculate click position
    const totalArea = calculateTotalFloorArea(shipData.totalTons, shipData.ceilingHeight);
    const floorArea = calculateFloorArea(totalArea, shipData.numFloors);
    const floorWidth = calculateFloorWidth(floorArea, shipData.floorLength);
    const floorLength = shipData.floorLength;
    const pixelsPerMeter = canvas.width / floorLength;

    const clickPxX = (event.clientX - rect.left) * scaleX;
    const clickPxY = (event.clientY - rect.top) * scaleY;
    let clickX = clickPxX / pixelsPerMeter;
    let clickY = clickPxY / pixelsPerMeter;

    // Center component on click
    let newX = clickX - sel.length / 2;
    let newY = clickY - sel.width / 2;

    // Clamp to floor bounds
    newX = Math.max(0, Math.min(newX, floorLength - sel.length));
    newY = Math.max(0, Math.min(newY, floorWidth - sel.width));

    // Round to nearest meter
    newX = Math.round(newX);
    newY = Math.round(newY);

    // Remove the old placement temporarily to check overlap
    const placement = shipData.componentPlacements[sel.componentIndex];
    const oldPlacement = placement.floors[sel.placementIndex];
    placement.floors.splice(sel.placementIndex, 1);

    // Check for overlap at new position
    const hasOverlap = checkOverlap(floorIndex, newX, newY, sel.length, sel.width, -1);

    if (hasOverlap) {
        // Restore old position and show error
        placement.floors.splice(sel.placementIndex, 0, oldPlacement);
        canvas.style.boxShadow = '0 0 20px red';
        setTimeout(() => {
            canvas.style.boxShadow = '';
        }, 300);
        return;
    }

    // Add at new position
    placement.floors.push({
        floor: floorIndex,
        x: newX,
        y: newY
    });

    // Clear selection
    uiState.selectedPlacement = null;
    canvas.classList.remove('selection-mode');
    hideSelectionInstructions();

    // Redraw affected floors
    const oldCanvas = document.getElementById(`floor-canvas-${sel.floorIndex}`);
    if (oldCanvas && sel.floorIndex !== floorIndex) {
        drawFloorWithComponents(oldCanvas, sel.floorIndex, floorLength, floorWidth);
    }
    drawFloorWithComponents(canvas, floorIndex, floorLength, floorWidth);

    console.log(`Moved component to (${newX}, ${newY}) on Floor ${floorIndex}`);
}

/**
 * Draw selection highlight on a component
 */
function drawSelectionHighlight(canvas, x, y, length, width, pixelsPerMeter) {
    const ctx = canvas.getContext('2d');
    const px = x * pixelsPerMeter;
    const py = y * pixelsPerMeter;
    const pw = length * pixelsPerMeter;
    const ph = width * pixelsPerMeter;

    // Draw dashed selection border
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 4]);
    ctx.strokeRect(px - 2, py - 2, pw + 4, ph + 4);
    ctx.setLineDash([]);
}

/**
 * Show selection mode instructions
 */
function showSelectionInstructions() {
    let instructions = document.getElementById('placement-instructions');
    if (!instructions) {
        instructions = document.createElement('div');
        instructions.id = 'placement-instructions';
        instructions.className = 'placement-instructions';
        document.body.appendChild(instructions);
    }
    instructions.textContent = 'Click on a floor to move the selected component. Press Escape to cancel.';
    instructions.classList.remove('hidden');
}

/**
 * Hide selection instructions
 */
function hideSelectionInstructions() {
    const instructions = document.getElementById('placement-instructions');
    if (instructions) {
        instructions.classList.add('hidden');
    }
}

/**
 * Cancel component selection
 */
function cancelSelection() {
    if (!uiState.selectedPlacement) return;

    const sel = uiState.selectedPlacement;
    uiState.selectedPlacement = null;

    // Remove visual feedback and redraw
    const canvas = document.getElementById(`floor-canvas-${sel.floorIndex}`);
    if (canvas) {
        canvas.classList.remove('selection-mode');
        const totalArea = calculateTotalFloorArea(shipData.totalTons, shipData.ceilingHeight);
        const floorArea = calculateFloorArea(totalArea, shipData.numFloors);
        const floorWidth = calculateFloorWidth(floorArea, shipData.floorLength);
        drawFloorWithComponents(canvas, sel.floorIndex, shipData.floorLength, floorWidth);
    }

    hideSelectionInstructions();
    console.log('Selection cancelled');
}
