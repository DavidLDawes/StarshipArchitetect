/**
 * Starship Architect - Rec/Health Combination Module
 *
 * Ships with large crews or many passengers carry a lot of small recreation and
 * health fittings (gyms, spas, kitchens, autodocs...). With "combine rec/health
 * with staterooms" turned on, those items are not placed one by one. Instead
 * their tonnage is shared out over every stateroom: each stateroom gets an
 * `overheadPerItem` (tons) that makes it bigger, so filling floors with
 * staterooms also reserves the rec/health space.
 *
 * The individual rec/health items are then spread over the floors in
 * proportion to the stateroom overhead placed on each floor, balancing tonnage
 * so the different items end up on different floors. Nothing here is drawn on
 * the canvas; the assignment is recomputed from the stateroom placements
 * whenever it is needed, so undo/redo, moves, and deletes need no extra work.
 */

// ========================================
// Constants
// ========================================

/** Tolerance (tons) for comparing tonnage */
const REC_EPS = 1e-6;

/** Categories whose items are rec/health overhead */
const REC_HEALTH_CATEGORY = /\brec\b|recreation|health|medical|amenit|leisure/i;

/** Item names that are rec/health overhead whatever their category */
const REC_HEALTH_ITEM = new RegExp([
    '\\bgym', '\\bspa\\b', '\\bgarden', '\\bkitchens?\\b', '\\bgalley', 'commissary', 'autodoc',
    'medical\\s*bay', 'sick\\s*bay', 'infirmary', 'first\\s*aid', '\\blibrary\\b', '\\bshrine',
    'chapel', 'theat(er|re)', '\\blounge', 'swimming\\s*pool', 'sauna', 'recreation', 'rec\\s*room'
].join('|'), 'i');

/** Accommodation that carries the overhead */
const STATEROOM_ITEM = /stateroom|cabin|bunk|quarters|berth/i;

/** Not staterooms: cold sleep and cockpits */
const STATEROOM_EXCLUDE = /\blow\b|cryo|emergency|control\s*cabin|cockpit|software/i;

// ========================================
// Classification
// ========================================

/**
 * Whether a component is a stateroom (or cabin) that can carry rec/health overhead
 * @param {object} component
 * @returns {boolean}
 */
function isStateroomComponent(component) {
    if (!component) return false;
    const name = `${component.itemName || ''} ${component.item || ''}`;
    return STATEROOM_ITEM.test(name) && !STATEROOM_EXCLUDE.test(name);
}

/**
 * Whether a component is rec/health overhead (gym, spa, kitchens, autodoc...)
 * @param {object} component
 * @returns {boolean}
 */
function isRecHealthComponent(component) {
    if (!component || isStateroomComponent(component)) return false;
    const name = `${component.itemName || ''} ${component.item || ''}`;
    return REC_HEALTH_CATEGORY.test(component.category || '') || REC_HEALTH_ITEM.test(name);
}

/**
 * Indices of the stateroom and rec/health components
 * @param {Array<object>} components
 * @returns {{staterooms: number[], recHealth: number[]}}
 */
function findCombinableComponents(components) {
    const staterooms = [];
    const recHealth = [];
    components.forEach((c, i) => {
        if (isStateroomComponent(c)) staterooms.push(i);
        else if (isRecHealthComponent(c)) recHealth.push(i);
    });
    return { staterooms, recHealth };
}

/**
 * Whether the ship has both staterooms and rec/health items to combine
 * @param {Array<object>} components
 * @returns {boolean}
 */
function canCombineRecHealth(components) {
    const { staterooms, recHealth } = findCombinableComponents(components);
    return staterooms.length > 0 && recHealth.length > 0;
}

// ========================================
// Combining
// ========================================

/**
 * Tons of one item of a component
 */
function tonsPerUnit(component) {
    return component.tonsPerItem || component.tons || 0;
}

/**
 * Number of items of a component
 */
function unitCount(component) {
    return component.quantity || 1;
}

/**
 * Total rec/health tonnage and the share each stateroom carries
 * @param {Array<object>} components
 * @returns {{recTons, stateroomCount, overheadPerItem}}
 */
function computeRecHealthOverhead(components) {
    const { staterooms, recHealth } = findCombinableComponents(components);
    const recTons = recHealth.reduce((sum, i) => sum + (components[i].tons || 0), 0);
    const stateroomCount = staterooms.reduce((sum, i) => sum + unitCount(components[i]), 0);
    return {
        recTons,
        stateroomCount,
        overheadPerItem: stateroomCount > 0 ? recTons / stateroomCount : 0
    };
}

/**
 * Turn the combination on or off by marking the components:
 * staterooms get `overheadPerItem` (tons added to each stateroom) and rec/health
 * items get `combinedWithStaterooms`. Every stateroom carries the same share.
 * @param {Array<object>} components - Mutated in place
 * @param {boolean} enabled
 * @returns {number} Overhead per stateroom in tons (0 when disabled)
 */
function setRecHealthCombined(components, enabled) {
    const { staterooms, recHealth } = findCombinableComponents(components);
    const on = enabled && staterooms.length > 0 && recHealth.length > 0;
    const { overheadPerItem } = computeRecHealthOverhead(components);

    for (const c of components) {
        delete c.overheadPerItem;
        delete c.combinedWithStaterooms;
    }
    if (!on) return 0;

    for (const i of staterooms) components[i].overheadPerItem = overheadPerItem;
    for (const i of recHealth) components[i].combinedWithStaterooms = true;
    return overheadPerItem;
}

// ========================================
// Spreading Rec/Health Items over Floors
// ========================================

/**
 * One entry per rec/health item (a "Spa (x3)" component gives three)
 * @param {Array<object>} components
 * @returns {Array<{componentIndex, tons}>}
 */
function expandRecHealthUnits(components) {
    const units = [];
    components.forEach((c, componentIndex) => {
        if (!c.combinedWithStaterooms) return;
        for (let k = 0; k < unitCount(c); k++) {
            units.push({ componentIndex, tons: tonsPerUnit(c) });
        }
    });
    return units;
}

/**
 * Assign rec/health items to floors so each floor's rec/health tonnage tracks
 * the overhead its staterooms reserved.
 *
 * Items go largest first to the floor with the best score: budget left, minus
 * the tons of that same item already there. The penalty spreads copies of an
 * item (two gyms, three spas) over different floors instead of stacking them
 * where the budget is largest; ties go to the floor holding fewer copies, then
 * the lower floor. While staterooms are still being placed, only floors with at
 * least half the item's tons of budget left can take it; once every stateroom
 * is placed (`complete`) all items are assigned.
 *
 * @param {Array<{componentIndex, tons}>} units
 * @param {Object<number, number>} budgets - floor -> overhead tons reserved there
 * @param {boolean} complete - All staterooms are placed
 * @returns {{byFloor: Object<number, Array>, unassigned: Array}}
 */
function distributeRecHealth(units, budgets, complete) {
    const floors = Object.keys(budgets).map(Number).filter(f => budgets[f] > REC_EPS).sort((a, b) => a - b);
    const remaining = {};
    const byFloor = {};
    for (const f of floors) {
        remaining[f] = budgets[f];
        byFloor[f] = [];
    }

    const countOf = (f, componentIndex) => byFloor[f].filter(u => u.componentIndex === componentIndex).length;
    const sorted = units.slice().sort((a, b) => b.tons - a.tons || a.componentIndex - b.componentIndex);
    const unassigned = [];

    for (const unit of sorted) {
        const score = f => remaining[f] - countOf(f, unit.componentIndex) * unit.tons;
        let best = null;
        for (const f of floors) {
            if (!complete && remaining[f] < unit.tons / 2 - REC_EPS) continue;
            if (best === null) { best = f; continue; }
            const diff = score(f) - score(best);
            if (diff > REC_EPS) best = f;
            else if (Math.abs(diff) <= REC_EPS && countOf(f, unit.componentIndex) < countOf(best, unit.componentIndex)) best = f;
        }
        if (best === null) {
            unassigned.push(unit);
            continue;
        }
        byFloor[best].push(unit);
        remaining[best] -= unit.tons;
    }
    return { byFloor, unassigned };
}

/**
 * Group units by component: [{componentIndex, name, count, tons}]
 */
function groupUnits(units, components) {
    const groups = new Map();
    for (const u of units) {
        if (!groups.has(u.componentIndex)) {
            const c = components[u.componentIndex];
            groups.set(u.componentIndex, {
                componentIndex: u.componentIndex,
                name: (c.itemName || c.item).replace(/\s*x\d+$/, ''),
                count: 0,
                tons: 0
            });
        }
        const g = groups.get(u.componentIndex);
        g.count++;
        g.tons += u.tons;
    }
    return [...groups.values()].sort((a, b) => a.componentIndex - b.componentIndex);
}

/**
 * Per-floor accounting of staterooms and the rec/health items that go with them
 *
 * @param {Array<object>} components - With the combination applied
 * @param {object} placements - shipData.componentPlacements
 * @param {function} placedByFloor - (placement) => { floor: count } (getPlacedCountByFloor)
 * @returns {object|null} null when the combination is off, otherwise
 *   {
 *     floors: [{ floor, staterooms, stateroomTons, recItems: [{componentIndex, name, count, tons}],
 *                recTons, totalTons }],
 *     unassigned: [{componentIndex, name, count, tons}],
 *     recPlaced: { componentIndex: { total, byFloor: {floor: count} } },
 *     totals: { staterooms, stateroomTotal, recTons, recTotal, totalTons }
 *   }
 */
function summarizeAccommodations(components, placements, placedByFloor) {
    const { staterooms } = findCombinableComponents(components);
    const carriers = staterooms.filter(i => components[i].overheadPerItem > 0);
    if (carriers.length === 0) return null;

    // Staterooms and overhead reserved on each floor
    const floorData = {};
    const budgets = {};
    let placedStaterooms = 0;
    let stateroomTotal = 0;
    for (const i of carriers) {
        const c = components[i];
        stateroomTotal += unitCount(c);
        const counts = placedByFloor(placements[i]);
        for (const [f, n] of Object.entries(counts)) {
            const floor = Number(f);
            if (!floorData[floor]) floorData[floor] = { floor, staterooms: 0, stateroomTons: 0 };
            floorData[floor].staterooms += n;
            floorData[floor].stateroomTons += n * tonsPerUnit(c);
            budgets[floor] = (budgets[floor] || 0) + n * c.overheadPerItem;
            placedStaterooms += n;
        }
    }

    const units = expandRecHealthUnits(components);
    const { byFloor, unassigned } = distributeRecHealth(units, budgets, placedStaterooms >= stateroomTotal);

    const recPlaced = {};
    const floors = Object.values(floorData).sort((a, b) => a.floor - b.floor).map(fd => {
        const assigned = byFloor[fd.floor] || [];
        for (const u of assigned) {
            const entry = recPlaced[u.componentIndex] || (recPlaced[u.componentIndex] = { total: 0, byFloor: {} });
            entry.total++;
            entry.byFloor[fd.floor] = (entry.byFloor[fd.floor] || 0) + 1;
        }
        const recTons = assigned.reduce((sum, u) => sum + u.tons, 0);
        return {
            ...fd,
            recItems: groupUnits(assigned, components),
            recTons,
            totalTons: fd.stateroomTons + recTons
        };
    });

    const recTotal = units.reduce((sum, u) => sum + u.tons, 0);
    const recTons = floors.reduce((sum, f) => sum + f.recTons, 0);
    return {
        floors,
        unassigned: groupUnits(unassigned, components),
        recPlaced,
        totals: {
            staterooms: placedStaterooms,
            stateroomTotal,
            recTons,
            recTotal,
            totalTons: floors.reduce((sum, f) => sum + f.totalTons, 0)
        }
    };
}

// CommonJS export for Jest (no-op in browsers where `module` is undefined)
if (typeof module !== 'undefined') {
    module.exports = {
        isStateroomComponent,
        isRecHealthComponent,
        findCombinableComponents,
        canCombineRecHealth,
        computeRecHealthOverhead,
        setRecHealthCombined,
        expandRecHealthUnits,
        distributeRecHealth,
        summarizeAccommodations
    };
}
