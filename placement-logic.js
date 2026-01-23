/**
 * Starship Architect - Placement Logic Module
 * Handles overlap detection, position finding, and placement management
 */

// ========================================
// Armor Boundary Checking
// ========================================

/**
 * Check if a placement is within the usable area (respecting armor boundary)
 * @param {number} x - X position in meters
 * @param {number} y - Y position in meters
 * @param {number} length - Component length in meters
 * @param {number} width - Component width in meters
 * @param {number} floorLength - Floor length in meters
 * @param {number} floorWidth - Floor width in meters
 * @param {number} armorThickness - Armor thickness in meters (defaults to shipData.armorThickness)
 * @returns {boolean} True if placement is within usable area
 */
function isWithinUsableArea(x, y, length, width, floorLength, floorWidth, armorThickness = shipData.armorThickness) {
    // Check if component is fully inside the armor boundary
    return x >= armorThickness &&
           y >= armorThickness &&
           x + length <= floorLength - armorThickness &&
           y + width <= floorWidth - armorThickness;
}

// ========================================
// Overlap Detection
// ========================================

/**
 * Check if a placement overlaps with existing components
 * @param {number} excludeComponentIndex - Set to -1 to check all, or a specific index to exclude
 */
function checkOverlap(floorIndex, x, y, length, width, excludeComponentIndex = -1) {
    for (const [compIdxStr, placement] of Object.entries(shipData.componentPlacements)) {
        const compIdx = parseInt(compIdxStr);
        // Only skip if explicitly excluding this specific component (used for repositioning)
        if (excludeComponentIndex >= 0 && compIdx === excludeComponentIndex) continue;

        if (!placement.floors) continue;

        for (const pos of placement.floors) {
            if (pos.floor !== floorIndex) continue;

            // Use per-placement dimensions (fallback to component-level)
            const pLength = pos.length || placement.length;
            const pWidth = pos.width || placement.width;

            // Check rectangle overlap
            const overlap = !(x + length <= pos.x ||
                pos.x + pLength <= x ||
                y + width <= pos.y ||
                pos.y + pWidth <= y);

            if (overlap) return true;
        }
    }
    return false;
}

// ========================================
// Position Finding
// ========================================

/**
 * Find a valid position for a component, adjusting if there's overlap
 * @returns {object|null} {x, y} if valid position found, null otherwise
 */
function findValidPosition(floorIndex, origX, origY, compLength, compWidth, floorLength, floorWidth, excludeComponentIndex) {
    const armorThickness = shipData.armorThickness || 0;

    // First, check if original position works (both within usable area and no overlap)
    if (isWithinUsableArea(origX, origY, compLength, compWidth, floorLength, floorWidth, armorThickness) &&
        !checkOverlap(floorIndex, origX, origY, compLength, compWidth, excludeComponentIndex)) {
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
                // Use per-placement dimensions
                const pLength = pos.length || placement.length;
                const pWidth = pos.width || placement.width;
                overlappingComponents.push({
                    x: pos.x,
                    y: pos.y,
                    length: pLength,
                    width: pWidth
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

    // Also try floor edges (respecting armor boundary)
    candidates.push({ x: armorThickness, y: origY });
    candidates.push({ x: floorLength - armorThickness - compLength, y: origY });
    candidates.push({ x: origX, y: armorThickness });
    candidates.push({ x: origX, y: floorWidth - armorThickness - compWidth });

    // Filter and sort candidates
    const validCandidates = candidates
        .map(pos => ({
            x: Math.max(armorThickness, Math.min(pos.x, floorLength - armorThickness - compLength)),
            y: Math.max(armorThickness, Math.min(pos.y, floorWidth - armorThickness - compWidth))
        }))
        .filter(pos => isWithinUsableArea(pos.x, pos.y, compLength, compWidth, floorLength, floorWidth, armorThickness) &&
                      !checkOverlap(floorIndex, pos.x, pos.y, compLength, compWidth, excludeComponentIndex))
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

// ========================================
// Placement Mode Management
// ========================================

/**
 * Finish placement mode
 */
function finishPlacement() {
    uiState.isPlacingComponent = false;
    uiState.placementData = null;

    // Clear drag preview
    clearPreview();

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

    // Clear drag preview
    clearPreview();

    finishPlacement();
}
