/**
 * Starship Architect - Bulk Allocation Module
 * Allocation options for components that come in quantity (staterooms, turrets...):
 *
 *   single      — place items one at a time (the original behavior)
 *   block       — place N items as one rectangle
 *   fill-floor  — use the free space on a chosen floor for as many items as fit
 *   fill-region — pick an odd-shaped free region on the map; it is measured and
 *                 assigned however many items fit
 *   fill-exposed — line the free stretches of outer hull on a chosen floor with
 *                 items (weapons, vehicles, launch bays: see hull-access.js)
 *
 * Components that need hull access get single / block / fill-exposed; all
 * others get single / block / fill-floor / fill-region.
 *
 * Components that can take irregular space (fuel, cargo...: see component-dimensions.js)
 * are placed by tonnage whatever their quantity. They get single / fill-floor /
 * fill-region, where single is one rectangle holding all that's left, and the fill
 * modes use any free space down to small gaps, splitting across regions and floors.
 *
 * Dependencies:
 * - placement-geometry.js (free-space analysis and allocation planning)
 * - hull-access.js (requiresHullAccess, planExposedFill)
 * - component-dimensions.js (calculateComponentArea, generateComponentDimensionOptions)
 * - component-modal.js (modal elements, updateDimensionOptions, closeComponentModal)
 * - canvas-renderer.js (drawFloorWithComponents)
 */

// ========================================
// Shared Helpers
// ========================================

/**
 * Items of a component not yet placed, or tons for one placed by tonnage
 */
function getRemainingCount(componentIndex) {
    const component = shipData.components[componentIndex];
    if (!component) return 0;
    if (canTakeIrregularSpace(component)) {
        return getRemainingTons(component, shipData.componentPlacements[componentIndex]);
    }
    const total = component.quantity || 1;
    return Math.max(0, total - getPlacedCount(shipData.componentPlacements[componentIndex]));
}

/**
 * Display name for a component's items
 */
function getItemDisplayName(component) {
    return (component.itemName || component.item).replace(/\s*x\d+$/, '');
}

/**
 * Usable area of a floor inside the armor (m²)
 */
function getUsableFloorArea(floorIndex) {
    const inner = getShapedInner(floorIndex);
    if (inner) return polygonArea(inner);

    const { floorLength, floorWidth } = getCurrentFloorDimensions();
    const armor = shipData.armorThickness || 0;
    return Math.max(0, floorLength - 2 * armor) * Math.max(0, floorWidth - 2 * armor);
}

/**
 * Floor area of a tonnage
 */
function tonsToArea(tons) {
    return tons * SQM_PER_TON / shipData.ceilingHeight;
}

/**
 * Show how much floor is free on one floor and across the ship.
 * Runs on every redraw, so a move or resize is reflected straight away.
 */
function updateFloorSpaceReadout(floorIndex) {
    const label = document.getElementById(`floor-free-${floorIndex}`);
    if (label) {
        const usable = getUsableFloorArea(floorIndex);
        const free = Math.max(0, usable - getFloorUsedArea(floorIndex));
        const text = `Free: ${free.toFixed(0)} of ${usable.toFixed(0)} m²`;
        if (label.textContent !== text) label.textContent = text;
    }

    const summary = document.getElementById('ship-space-summary');
    if (!summary) return;
    let free = 0;
    for (let f = 1; f <= shipData.numFloors; f++) {
        free += Math.max(0, getUsableFloorArea(f) - getFloorUsedArea(f));
    }
    const needed = getStillToPlaceArea(shipData.components, shipData.componentPlacements);
    const asTons = area => (area * shipData.ceilingHeight / SQM_PER_TON).toFixed(1);
    const text = `Free floor: ${free.toFixed(0)} m² (${asTons(free)} t) · Still to place: ${needed.toFixed(0)} m² (${asTons(needed)} t)`;
    if (summary.textContent !== text) summary.textContent = text;
    summary.classList.toggle('warning', needed > free + 0.5);
}

/**
 * Free-space analysis for a floor using current ship state
 */
function analyzeFloorNow(floorIndex) {
    const { floorLength, floorWidth } = getCurrentFloorDimensions();
    return analyzeFloorFreeSpace(floorIndex, floorLength, floorWidth, shipData.armorThickness || 0);
}

/**
 * Commit planned allocations for a component on a floor as a single undoable action
 * @returns {Array<object>} The placement entries created
 */
function applyAllocations(componentIndex, floorIndex, allocations) {
    if (!shipData.componentPlacements[componentIndex]) {
        shipData.componentPlacements[componentIndex] = { floors: [] };
    }

    const { floorLength, floorWidth } = getCurrentFloorDimensions();
    const armor = shipData.armorThickness || 0;

    const entries = allocations.map(a => {
        const entry = {
            floor: floorIndex,
            x: a.bbox.x,
            y: a.bbox.y,
            length: a.bbox.length,
            width: a.bbox.width
        };
        if (a.count) entry.count = a.count;
        if (canTakeIrregularSpace(shipData.components[componentIndex])) {
            entry.tons = a.area * shipData.ceilingHeight / SQM_PER_TON;
        }
        // A region that came out as a single rectangle stays a plain block, so it
        // can still be moved, rotated, and resized like any other placement. Unless
        // it pokes slightly past a curved wall, when it stays clipped to the hull.
        if (a.rects.length > 1 || !fitsFloor(floorIndex, a.bbox.x, a.bbox.y, a.bbox.length, a.bbox.width, floorLength, floorWidth, armor)) {
            entry.rects = a.rects;
        }
        return entry;
    });

    shipData.componentPlacements[componentIndex].floors.push(...entries);
    uiState.placementHistory.push({ type: 'fill', componentIndex, entries });
    uiState.redoHistory = [];

    const canvas = document.getElementById(`floor-canvas-${floorIndex}`);
    if (canvas) {
        drawFloorWithComponents(canvas, floorIndex, floorLength, floorWidth,
            shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
    }
    renderComponents();
    return entries;
}

/**
 * Format square meters for display
 */
function formatArea(m2) {
    return `${m2.toFixed(1)} m²`;
}

// ========================================
// Modal: Allocation Section
// ========================================

/**
 * Currently selected allocation mode ('single' when the section is hidden)
 */
function getAllocationMode() {
    const section = document.getElementById('allocation-section');
    if (!section || section.classList.contains('hidden')) return 'single';
    const checked = document.querySelector('input[name="allocation-mode"]:checked');
    return checked ? checked.value : 'single';
}

/**
 * Block size entered by the user, clamped to what is left to place
 */
function getBlockCount(componentIndex) {
    const input = document.getElementById('block-count');
    const remaining = getRemainingCount(componentIndex);
    const value = parseInt(input.value, 10);
    if (isNaN(value) || value < 1) return 1;
    return Math.min(value, remaining);
}

/**
 * Prepare the allocation section when the component modal opens.
 * Shown only for components with quantity > 1.
 */
function setupAllocationSection(componentIndex) {
    const modal = document.getElementById('component-modal');
    const section = document.getElementById('allocation-section');
    const component = shipData.components[componentIndex];
    const multiFloorSection = document.getElementById('multi-floor-section');
    const floorSelect = document.getElementById('component-floor-select');

    // Remember the single-item layout openComponentModal chose, to restore it
    modal.dataset.singleUsesMultiFloor = String(!multiFloorSection.classList.contains('hidden'));

    modal.dataset.hullAccess = String(requiresHullAccess(component));

    const total = component ? component.quantity || 1 : 1;
    const byTons = canTakeIrregularSpace(component);
    modal.dataset.placedByTons = String(byTons);
    if (total <= 1 && !byTons) {
        section.classList.add('hidden');
        setRowVisible('dimensions-row', true);
        setRowVisible('floor-select-row', true);
        setPlaceButton('Place Component', true);
        updateDimensionOptions();
        return;
    }

    section.classList.remove('hidden');
    document.getElementById('allocation-block-option').classList.toggle('hidden', byTons);
    document.getElementById('allocation-single-text').textContent = byTons ? 'All that is left as one rectangle' : 'One at a time';
    document.getElementById('allocation-fill-floor-text').textContent = byTons
        ? 'Fill free space on the selected floor, any shape'
        : 'Fill the rest of the selected floor';
    document.getElementById('allocation-fill-region-text').textContent = byTons
        ? 'Fill free regions, any shape (pick them on the map)'
        : 'Fill a free region (pick it on the map)';

    // Hull components (weapons, vehicles, launch bays) fill exposed hull instead
    // of free floor space; show only the modes that apply
    const hull = modal.dataset.hullAccess === 'true';
    section.querySelectorAll('.allocation-mode[data-scope]').forEach(label => {
        label.classList.toggle('hidden', (label.dataset.scope === 'hull') !== hull);
    });

    // Ensure the single-floor dropdown is populated (large items skip it)
    if (floorSelect.options.length !== shipData.numFloors) {
        floorSelect.innerHTML = '';
        for (let i = 1; i <= shipData.numFloors; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = getFloorOptionLabel(i);
            floorSelect.appendChild(option);
        }
    }
    // Start from the best floor, not whatever this dropdown last showed
    floorSelect.value = getSuggestedFloors(1)[0];

    // Default block size: everything left, capped at what fits on one floor
    const remaining = getRemainingCount(componentIndex);
    const itemArea = calculateComponentArea(component);
    const usableArea = getUsableFloorArea(parseInt(floorSelect.value, 10));
    const maxPerFloor = itemArea > 0 ? Math.max(1, Math.floor(usableArea / itemArea)) : 1;
    const blockInput = document.getElementById('block-count');
    blockInput.max = remaining;
    blockInput.value = byTons ? 1 : Math.min(remaining, maxPerFloor);

    document.querySelector('input[name="allocation-mode"][value="single"]').checked = true;
    updateAllocationUI();
}

/**
 * Show or hide a modal row by id
 */
function setRowVisible(id, visible) {
    const row = document.getElementById(id);
    if (row) row.classList.toggle('hidden', !visible);
}

/**
 * Update the modal's primary button label and enabled state
 */
function setPlaceButton(label, enabled) {
    const btn = document.getElementById('modal-place-btn');
    btn.textContent = label;
    btn.disabled = !enabled;
}

/**
 * Refresh the modal for the selected allocation mode
 */
function updateAllocationUI() {
    const modal = document.getElementById('component-modal');
    const componentIndex = parseInt(modal.dataset.componentIndex, 10);
    const component = shipData.components[componentIndex];
    if (!component) return;

    const mode = getAllocationMode();
    const remaining = getRemainingCount(componentIndex);
    const total = component.quantity || 1;
    const itemArea = calculateComponentArea(component);
    const multiFloorSection = document.getElementById('multi-floor-section');
    const floorSelect = document.getElementById('component-floor-select');
    const preview = document.getElementById('allocation-preview');

    const hull = modal.dataset.hullAccess === 'true';
    const byTons = modal.dataset.placedByTons === 'true';
    document.getElementById('allocation-status').textContent = byTons
        ? `${(component.tons - remaining).toFixed(1)} of ${component.tons} tons placed · ` +
          `${remaining.toFixed(1)} tons left (${formatArea(tonsToArea(remaining))}) · can take any shape`
        : `${total - remaining} of ${total} placed · ${remaining} remaining · ${formatArea(itemArea)} each` +
          (hull ? ' · must touch the outer hull' : '');

    // Single mode restores the layout openComponentModal chose; the bulk modes
    // always work on one floor at a time
    const singleUsesMultiFloor = modal.dataset.singleUsesMultiFloor === 'true';
    multiFloorSection.classList.toggle('hidden', !(mode === 'single' && singleUsesMultiFloor));
    floorSelect.classList.toggle('hidden', mode === 'single' && singleUsesMultiFloor);
    setRowVisible('dimensions-row', mode === 'single' || mode === 'block' || mode === 'fill-exposed');
    setRowVisible('floor-select-row', mode !== 'fill-region');
    document.getElementById('dimensions-label').textContent =
        mode === 'fill-exposed' ? 'Item size (along hull × depth):' : 'Dimensions:';

    if (mode === 'single') {
        preview.textContent = '';
        preview.classList.remove('warning');
        setPlaceButton('Place Component', true);
        updateDimensionOptions();
    } else if (mode === 'block') {
        updateBlockOptions(componentIndex, component, itemArea, preview);
    } else if (mode === 'fill-floor') {
        document.getElementById('modal-area-display').classList.add('hidden');
        if (byTons) updateTonnageFillPreview(remaining, preview);
        else updateFillFloorPreview(componentIndex, component, itemArea, remaining, preview);
    } else if (mode === 'fill-exposed') {
        document.getElementById('modal-area-display').classList.add('hidden');
        populateItemSizeOptions(component);
        updateFillExposedPreview();
    } else {
        document.getElementById('modal-area-display').classList.add('hidden');
        preview.classList.remove('warning');
        preview.textContent = remaining > 0
            ? (byTons
                ? `Hover over free space on any floor to see how many tons of ${getItemDisplayName(component)} it holds, `
                : `Hover over free space on any floor to see its area and how many ${getItemDisplayName(component)} fit, `) +
              'then click to assign them. Keep clicking regions until done; press Escape to stop.'
            : 'All items are already placed.';
        setPlaceButton('Pick Region on Map', remaining > 0);
    }
}

/**
 * Block mode: dimension options for a rectangle holding N items
 */
function updateBlockOptions(componentIndex, component, itemArea, preview) {
    const count = getBlockCount(componentIndex);
    const blockArea = count * itemArea;
    const floorIndex = parseInt(document.getElementById('component-floor-select').value, 10);
    const usableArea = getUsableFloorArea(floorIndex);
    const dimSelect = document.getElementById('component-dimensions');
    dimSelect.innerHTML = '';
    document.getElementById('modal-area-display').classList.add('hidden');

    if (blockArea > usableArea) {
        const maxPerFloor = Math.floor(usableArea / itemArea);
        preview.classList.add('warning');
        preview.textContent = `A block of ${count} needs ${formatArea(blockArea)}, but Floor ${floorIndex} only has ` +
            `${formatArea(usableArea)} usable. At most ${maxPerFloor} fit on that floor.`;
        setPlaceButton('Place Block', false);
        return;
    }

    const blockTons = count * getEffectiveTonsPerItem(component);
    const dimInfo = getDeckDimensionOptions(
        { ...component, tons: blockTons, tonsPerItem: blockTons, overheadPerItem: 0 },
        floorIndex, 1
    );
    for (const opt of dimInfo.options) {
        const option = document.createElement('option');
        option.value = `${opt.length},${opt.width}`;
        option.textContent = opt.label;
        dimSelect.appendChild(option);
    }

    if (dimInfo.options.length === 0) {
        preview.classList.add('warning');
        preview.textContent = `No rectangle shape for ${count} items fits this floor layout. Try a different block size.`;
        setPlaceButton('Place Block', false);
        return;
    }

    preview.classList.remove('warning');
    preview.textContent = `Block of ${count} × ${formatArea(itemArea)} = ${formatArea(blockArea)}. ` +
        (requiresHullAccess(component)
            ? 'Click the chosen floor; the block snaps to the nearest stretch of outer hull.'
            : 'Click the chosen floor to place it.');
    setPlaceButton(`Place Block of ${count}`, true);
}

/**
 * Fill-floor mode: show what filling the selected floor would do
 */
function updateFillFloorPreview(componentIndex, component, itemArea, remaining, preview) {
    const floorIndex = parseInt(document.getElementById('component-floor-select').value, 10);
    const name = getItemDisplayName(component);
    if (!floorIndex || remaining <= 0) {
        preview.textContent = remaining <= 0 ? 'All items are already placed.' : '';
        setPlaceButton('Fill Floor', false);
        return;
    }

    const analysis = analyzeFloorNow(floorIndex);
    const summary = summarizeFreeSpace(analysis.regions, itemArea);
    const plan = planFloorFill(analysis.regions, itemArea, remaining);
    const assigned = plan.reduce((sum, a) => sum + a.count, 0);
    const usedArea = plan.reduce((sum, a) => sum + a.area, 0);

    if (assigned === 0) {
        preview.classList.add('warning');
        preview.textContent = `Floor ${floorIndex} has ${formatArea(summary.freeArea)} free, but no open area ` +
            `large enough for one ${name} (${formatArea(itemArea)}).`;
        setPlaceButton('Fill Floor', false);
        return;
    }

    preview.classList.remove('warning');
    const regionText = summary.regionCount === 1 ? '1 region' : `${summary.regionCount} regions`;
    let text = `Floor ${floorIndex}: ${formatArea(summary.freeArea)} free in ${regionText}, room for ${summary.fits}. `;
    if (assigned >= remaining) {
        text += `All ${remaining} remaining will be packed into ${formatArea(usedArea)}.`;
    } else {
        text += `Assigns ${assigned} of ${remaining}, leaving ${remaining - assigned} for other floors.`;
    }
    preview.textContent = text;
    setPlaceButton(`Fill Floor ${floorIndex} with ${assigned}`, true);
}

/**
 * Fill-floor mode for a component placed by tonnage
 */
function updateTonnageFillPreview(remaining, preview) {
    const floorIndex = parseInt(document.getElementById('component-floor-select').value, 10);
    if (!floorIndex || remaining <= 0) {
        preview.textContent = remaining <= 0 ? 'All of it is already placed.' : '';
        setPlaceButton('Fill Floor', false);
        return;
    }

    const plan = planAreaFill(analyzeFloorNow(floorIndex).regions, tonsToArea(remaining));
    const area = plan.reduce((sum, a) => sum + a.area, 0);
    if (plan.length === 0) {
        preview.classList.add('warning');
        preview.textContent = `Floor ${floorIndex} has no free space left to fill.`;
        setPlaceButton('Fill Floor', false);
        return;
    }

    const tons = area * shipData.ceilingHeight / SQM_PER_TON;
    const areas = plan.length === 1 ? '1 area' : `${plan.length} areas`;
    preview.classList.remove('warning');
    preview.textContent = tons >= remaining - 0.01
        ? `All ${remaining.toFixed(1)} tons left fit on Floor ${floorIndex}, in ${areas}.`
        : `Floor ${floorIndex} holds ${tons.toFixed(1)} of the ${remaining.toFixed(1)} tons left, in ${areas}. ` +
          'The rest can go on other floors.';
    setPlaceButton(`Fill Floor ${floorIndex} with ${tons.toFixed(1)} tons`, true);
}

/**
 * Execute fill-floor from the modal
 */
function executeFloorFill() {
    const modal = document.getElementById('component-modal');
    const componentIndex = parseInt(modal.dataset.componentIndex, 10);
    const component = shipData.components[componentIndex];
    const floorIndex = parseInt(document.getElementById('component-floor-select').value, 10);
    if (!component || !floorIndex) return;

    const analysis = analyzeFloorNow(floorIndex);
    const plan = canTakeIrregularSpace(component)
        ? planAreaFill(analysis.regions, tonsToArea(getRemainingCount(componentIndex)))
        : planFloorFill(analysis.regions, calculateComponentArea(component), getRemainingCount(componentIndex));
    if (plan.length === 0) return;

    closeComponentModal();
    applyAllocations(componentIndex, floorIndex, plan);

    // If the user is viewing a single floor, switch to the one just filled
    const selector = document.getElementById('floor-selector');
    if (selector && selector.value !== 'all') {
        setFloorSelector(floorIndex);
    }
}

// ========================================
// Fill Exposed Areas (hull components)
// ========================================

/**
 * Fill the item-size dropdown with shapes for ONE item; in fill-exposed mode the
 * first number is the size along the hull and the second the depth inboard
 */
function populateItemSizeOptions(component) {
    const floorIndex = parseInt(document.getElementById('component-floor-select').value, 10);
    const single = { ...component, tons: component.tonsPerItem || component.tons };
    const dimInfo = getDeckDimensionOptions(single, floorIndex, 1);
    const options = dimInfo.options.slice();

    // Very small items fall under the generator's 1 m minimum: offer a square
    if (options.length === 0 && dimInfo.componentArea > 0) {
        const side = Math.sqrt(dimInfo.componentArea);
        options.push({ length: side, width: side, label: `${side.toFixed(1)} × ${side.toFixed(1)} m` });
    }

    const dimSelect = document.getElementById('component-dimensions');
    dimSelect.innerHTML = '';
    for (const opt of options) {
        const option = document.createElement('option');
        option.value = `${opt.length},${opt.width}`;
        option.textContent = opt.label;
        dimSelect.appendChild(option);
    }
}

/**
 * Selected item size for fill-exposed: { along, depth } or null
 */
function getItemSize() {
    const [along, depth] = document.getElementById('component-dimensions').value.split(',').map(parseFloat);
    return along > 0 && depth > 0 ? { along, depth } : null;
}

/**
 * Plan lining the free hull of a floor with a component's remaining items
 * @returns {Array<object>} Allocations from planExposedFill
 */
function planExposedFillForFloor(componentIndex, floorIndex, size, remaining = getRemainingCount(componentIndex)) {
    const { floorLength, floorWidth } = getCurrentFloorDimensions();
    return planFloorExposedFill(floorIndex, getOccupiedRects(floorIndex), size.along, size.depth, remaining,
        floorLength, floorWidth, shipData.armorThickness || 0);
}

/**
 * Fill-exposed mode: show what lining the selected floor's hull would do
 */
function updateFillExposedPreview() {
    const modal = document.getElementById('component-modal');
    const componentIndex = parseInt(modal.dataset.componentIndex, 10);
    const component = shipData.components[componentIndex];
    if (!component) return;

    const preview = document.getElementById('allocation-preview');
    const floorIndex = parseInt(document.getElementById('component-floor-select').value, 10);
    const remaining = getRemainingCount(componentIndex);
    const size = getItemSize();

    if (remaining <= 0 || !floorIndex || !size) {
        preview.classList.toggle('warning', remaining > 0);
        preview.textContent = remaining <= 0 ? 'All items are already placed.' : 'Choose an item size.';
        setPlaceButton('Fill Exposed Areas', false);
        return;
    }

    const name = getItemDisplayName(component);
    const capacity = planExposedFillForFloor(componentIndex, floorIndex, size, Infinity)
        .reduce((sum, a) => sum + a.count, 0);
    const plan = planExposedFillForFloor(componentIndex, floorIndex, size, remaining);
    const assigned = plan.reduce((sum, a) => sum + a.count, 0);

    if (assigned === 0) {
        preview.classList.add('warning');
        preview.textContent = `Floor ${floorIndex} has no free stretch of outer hull ${size.along.toFixed(1)} m long ` +
            `and ${size.depth.toFixed(1)} m deep for one ${name}. Try another floor or item size.`;
        setPlaceButton('Fill Exposed Areas', false);
        return;
    }

    preview.classList.remove('warning');
    const blocks = plan.length === 1 ? '1 block' : `${plan.length} blocks`;
    let text = `Floor ${floorIndex}: the free outer hull has room for ${capacity}. `;
    text += assigned >= remaining
        ? `All ${remaining} remaining go in ${blocks} along the hull.`
        : `Assigns ${assigned} of ${remaining} in ${blocks}, leaving ${remaining - assigned} for other floors.`;
    preview.textContent = text;
    setPlaceButton(`Fill Floor ${floorIndex} Hull with ${assigned}`, true);
}

/**
 * Execute fill-exposed from the modal
 */
function executeExposedFill() {
    const modal = document.getElementById('component-modal');
    const componentIndex = parseInt(modal.dataset.componentIndex, 10);
    const floorIndex = parseInt(document.getElementById('component-floor-select').value, 10);
    const size = getItemSize();
    if (!shipData.components[componentIndex] || !floorIndex || !size) return;

    const plan = planExposedFillForFloor(componentIndex, floorIndex, size);
    if (plan.length === 0) return;

    closeComponentModal();
    applyAllocations(componentIndex, floorIndex, plan);

    // If the user is viewing a single floor, switch to the one just filled
    const selector = document.getElementById('floor-selector');
    if (selector && selector.value !== 'all') {
        setFloorSelector(floorIndex);
    }
}

// ========================================
// Region Fill Mode (pick free regions on the map)
// ========================================

/**
 * Enter region-picking mode from the modal
 */
function startRegionFillFromModal() {
    const modal = document.getElementById('component-modal');
    const componentIndex = parseInt(modal.dataset.componentIndex, 10);
    closeComponentModal();
    startRegionFill(componentIndex);
}

/**
 * Enter region-picking mode for a component
 */
function startRegionFill(componentIndex) {
    if (getRemainingCount(componentIndex) <= 0) return;

    if (uiState.selectedPlacement) cancelSelection();
    if (uiState.isPlacingComponent) cancelPlacement();

    uiState.regionFill = {
        componentIndex,
        analyses: {},     // floorIndex -> free-space analysis (invalidated after each fill)
        plans: {},        // "floor:region:direction" -> allocation plan
        animationFrameId: null
    };

    for (let i = 1; i <= shipData.numFloors; i++) {
        const canvas = document.getElementById(`floor-canvas-${i}`);
        if (canvas) canvas.classList.add('placement-mode', 'region-fill-mode');
    }
    showRegionFillInstructions();
}

/**
 * Leave region-picking mode
 */
function cancelRegionFill() {
    const state = uiState.regionFill;
    if (!state) return;
    if (state.animationFrameId !== null) cancelAnimationFrame(state.animationFrameId);
    uiState.regionFill = null;

    const { floorLength, floorWidth } = getCurrentFloorDimensions();
    for (let i = 1; i <= shipData.numFloors; i++) {
        const canvas = document.getElementById(`floor-canvas-${i}`);
        if (!canvas) continue;
        canvas.classList.remove('placement-mode', 'region-fill-mode');
        drawFloorWithComponents(canvas, i, floorLength, floorWidth,
            shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
    }

    const instructions = document.getElementById('placement-instructions');
    if (instructions) instructions.classList.add('hidden');
}

/**
 * Cached free-space analysis for a floor during region mode
 */
function getRegionAnalysis(floorIndex) {
    const state = uiState.regionFill;
    if (!state.analyses[floorIndex]) {
        state.analyses[floorIndex] = analyzeFloorNow(floorIndex);
    }
    return state.analyses[floorIndex];
}

/**
 * Find the region and allocation plan under the mouse
 * @returns {{region, plan, x, y, px, py}} Region/plan may be null
 */
function getRegionUnderMouse(event, floorIndex) {
    const state = uiState.regionFill;
    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const px = (event.clientX - rect.left) * (canvas.width / rect.width);
    const py = (event.clientY - rect.top) * (canvas.height / rect.height);
    const { floorLength } = getCurrentFloorDimensions();
    const pixelsPerMeter = canvas.width / floorLength;
    const x = px / pixelsPerMeter;
    const y = py / pixelsPerMeter;

    const region = findRegionAtPoint(getRegionAnalysis(floorIndex), x, y);
    let plan = null;
    if (region) {
        // When only part of the region is needed, pack it against the edge
        // nearest the cursor so it lands where the user is pointing
        const direction = nearestSweepDirection(region.bbox, x, y);
        const key = `${floorIndex}:${region.index}:${direction}`;
        if (!(key in state.plans)) {
            const component = shipData.components[state.componentIndex];
            state.plans[key] = canTakeIrregularSpace(component)
                ? planRegionArea(region, tonsToArea(getRemainingCount(state.componentIndex)), direction)
                : planRegionAllocation(region, calculateComponentArea(component),
                    getRemainingCount(state.componentIndex), direction);
        }
        plan = state.plans[key];
    }
    return { region, plan, x, y, px, py };
}

/**
 * Mouse move over a canvas in region mode: highlight the region under the cursor
 */
function handleRegionHover(event, floorIndex) {
    const state = uiState.regionFill;
    const canvas = event.target;
    const hover = getRegionUnderMouse(event, floorIndex);

    if (state.animationFrameId === null) {
        state.animationFrameId = requestAnimationFrame(() => {
            state.animationFrameId = null;
            if (uiState.regionFill !== state) return;
            const { floorLength, floorWidth } = getCurrentFloorDimensions();
            drawFloorWithComponents(canvas, floorIndex, floorLength, floorWidth,
                shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
            if (hover.region) {
                drawRegionHover(canvas, hover, floorLength, floorIndex);
            }
        });
    }
}

/**
 * Mouse leaves a canvas in region mode: remove the highlight
 */
function handleRegionLeave(event, floorIndex) {
    const { floorLength, floorWidth } = getCurrentFloorDimensions();
    drawFloorWithComponents(event.target, floorIndex, floorLength, floorWidth,
        shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
}

/**
 * Click in region mode: assign items to the region under the cursor
 */
function handleRegionFillClick(event, floorIndex) {
    const state = uiState.regionFill;
    const canvas = event.target;
    const { plan } = getRegionUnderMouse(event, floorIndex);

    if (!plan) {
        canvas.style.boxShadow = '0 0 20px red';
        setTimeout(() => { canvas.style.boxShadow = ''; }, 300);
        return;
    }

    applyAllocations(state.componentIndex, floorIndex, [plan]);

    // Free space and remaining count changed: drop cached results
    state.analyses = {};
    state.plans = {};

    if (getRemainingCount(state.componentIndex) <= 0) {
        cancelRegionFill();
    } else {
        showRegionFillInstructions();
    }
}

/**
 * Draw the hovered region, the part that would be used, and an info label
 */
function drawRegionHover(canvas, hover, floorLength, floorIndex) {
    const { region, plan, px, py } = hover;
    const state = uiState.regionFill;
    const component = shipData.components[state.componentIndex];
    const name = getItemDisplayName(component);
    const itemArea = calculateComponentArea(component);
    const remaining = getRemainingCount(state.componentIndex);
    const ctx = canvas.getContext('2d');
    const ppm = canvas.width / floorLength;
    const toPx = r => [r.x * ppm, r.y * ppm, r.length * ppm, r.width * ppm];

    // Whole free region
    ctx.save();
    clipToFloorHull(ctx, floorIndex, ppm);
    ctx.fillStyle = plan ? 'rgba(0, 212, 255, 0.18)' : 'rgba(255, 82, 82, 0.25)';
    for (const r of region.rects) ctx.fillRect(...toPx(r));

    // Portion that would be assigned
    if (plan) {
        ctx.fillStyle = 'rgba(0, 230, 118, 0.35)';
        ctx.strokeStyle = 'rgba(0, 230, 118, 0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        for (const r of plan.rects) {
            ctx.fillRect(...toPx(r));
            ctx.strokeRect(...toPx(r));
        }
        ctx.setLineDash([]);
    }
    ctx.restore();

    // Info label near the cursor
    const fits = Math.floor((region.area + 1e-6) / itemArea);
    const lines = [`Free region: ${formatArea(region.area)}`];
    if (canTakeIrregularSpace(component)) {
        if (plan) {
            const tons = plan.area * shipData.ceilingHeight / SQM_PER_TON;
            lines.push(`Click to assign ${tons.toFixed(1)} tons of ${name} (${Math.max(0, remaining - tons).toFixed(1)} left after)`);
        } else {
            lines.push('Too small to be worth filling');
        }
    } else if (!plan) {
        lines.push(`Too small for one ${name} (${formatArea(itemArea)})`);
    } else if (fits > plan.count) {
        lines.push(`Room for ${fits}; click to pack all ${plan.count} remaining`);
    } else {
        lines.push(`Click to assign ${plan.count} ${name} (${remaining - plan.count} left after)`);
    }
    drawInfoLabel(ctx, lines, px, py, canvas.width, canvas.height);
}

/**
 * Draw a small multi-line info box near a point, kept inside the canvas
 */
function drawInfoLabel(ctx, lines, px, py, canvasWidth, canvasHeight) {
    ctx.font = '13px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const lineHeight = 18;
    const padding = 8;
    const boxWidth = Math.max(...lines.map(l => ctx.measureText(l).width)) + padding * 2;
    const boxHeight = lines.length * lineHeight + padding * 2 - 4;

    let bx = px + 16;
    let by = py + 16;
    if (bx + boxWidth > canvasWidth) bx = px - boxWidth - 16;
    if (by + boxHeight > canvasHeight) by = py - boxHeight - 16;
    bx = Math.max(2, bx);
    by = Math.max(2, by);

    ctx.fillStyle = 'rgba(10, 10, 26, 0.92)';
    ctx.fillRect(bx, by, boxWidth, boxHeight);
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, boxWidth, boxHeight);

    ctx.fillStyle = '#e8eaf6';
    lines.forEach((line, i) => ctx.fillText(line, bx + padding, by + padding + i * lineHeight));
}

/**
 * Instruction banner for region mode
 */
function showRegionFillInstructions() {
    const state = uiState.regionFill;
    if (!state) return;
    const component = shipData.components[state.componentIndex];
    let instructions = document.getElementById('placement-instructions');
    if (!instructions) {
        instructions = document.createElement('div');
        instructions.id = 'placement-instructions';
        instructions.className = 'placement-instructions';
        document.body.appendChild(instructions);
    }
    const remaining = getRemainingCount(state.componentIndex);
    instructions.textContent = `Filling regions with ${getItemDisplayName(component)} ` +
        `(${canTakeIrregularSpace(component) ? `${remaining.toFixed(1)} tons` : remaining} remaining). Click a free area to assign; Escape to finish.`;
    instructions.classList.remove('hidden');
}

// ========================================
// Event Setup
// ========================================

/**
 * Wire up allocation controls in the component modal (called once at startup)
 */
function setupAllocationEvents() {
    document.querySelectorAll('input[name="allocation-mode"]').forEach(radio => {
        radio.addEventListener('change', updateAllocationUI);
    });

    const blockInput = document.getElementById('block-count');
    const selectBlockMode = () => {
        document.querySelector('input[name="allocation-mode"][value="block"]').checked = true;
        updateAllocationUI();
    };
    blockInput.addEventListener('input', selectBlockMode);
    blockInput.addEventListener('focus', selectBlockMode);

    document.getElementById('component-floor-select').addEventListener('change', () => {
        const mode = getAllocationMode();
        if (mode === 'fill-floor' || mode === 'block') updateAllocationUI();
        else if (mode === 'fill-exposed') {
            populateItemSizeOptions(shipData.components[parseInt(document.getElementById('component-modal').dataset.componentIndex, 10)]);
            updateFillExposedPreview();
        } else if (mode === 'single') {
            // Sizes depend on the floor on a shaped hull
            setPlaceButton('Place Component', true);
            updateDimensionOptions();
        }
    });

    document.getElementById('component-dimensions').addEventListener('change', () => {
        if (getAllocationMode() === 'fill-exposed') updateFillExposedPreview();
    });
}
