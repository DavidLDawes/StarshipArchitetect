/**
 * Starship Architect - Hull Access Module
 *
 * Weapons (turrets, barbettes, bays, defensive systems such as repulsors and
 * point defense), vehicles, and launch bays need access to space outside the
 * ship to work, so they must sit on the outer edge of a floor: at least one side
 * of the placement has to lie against the inner face of the armor (the hull).
 *
 * This module decides which components need hull access, checks and snaps
 * positions to the hull, and plans "fill the exposed areas of a floor", which
 * lines the free stretches of hull with blocks of items.
 */

// ========================================
// Constants
// ========================================

/** Tolerance (meters) when deciding whether an edge lies on the hull */
const HULL_EPS = 1e-6;

/** Categories whose items all need hull access */
const HULL_ACCESS_CATEGORY = /weapon|defen[cs]|screen|vehicle|hangar|launch|small\s*craft|docking/i;

/** Items that need hull access whatever their category */
const HULL_ACCESS_ITEM = new RegExp([
    'turret', 'barbette', 'repulsor', 'point[\\s-]*defen[cs]e', 'sandcaster',
    'launcher', 'launch\\s*(bay|tube|rail|facilit)', 'missile', 'torpedo',
    'hard\\s*point', 'spinal\\s*mount', 'weapon\\s*bay', '\\bguns?\\b', 'cannon',
    'railgun', 'laser', 'particle\\s*beam', 'meson', 'plasma\\s*(gun|bay)', 'fusion\\s*(gun|bay)',
    'nuclear\\s*damper', 'hangar', 'vehicle\\s*bay', 'boat\\s*deck', 'docking\\s*(bay|clamp|space)',
    'air\\s*/?\\s*raft', 'g[\\s-]*carrier', 'all[\\s-]*terrain\\s*vehicle', '\\batv\\b',
    'grav\\s*(bike|vehicle|tank)', 'shuttle', "ship'?s\\s*boat", 'pinnace', 'cutter', 'fighter\\b'
].join('|'), 'i');

/**
 * Items that never need hull access even in a weapons/vehicles category
 * (stores, crew, and fire control live inside the ship)
 */
const HULL_ACCESS_EXCLUDE = /ammunition|\bammo\b|magazine|reload|storage|gunner|crew|fire\s*control|software|spares|workshop|maintenance|fuel/i;

// ========================================
// Classification
// ========================================

/**
 * Whether a component must be placed against the outer hull
 * @param {object} component - Parsed component ({category, item, itemName})
 * @returns {boolean}
 */
function requiresHullAccess(component) {
    if (!component) return false;
    const name = `${component.itemName || ''} ${component.item || ''}`;
    if (HULL_ACCESS_EXCLUDE.test(name)) return false;
    return HULL_ACCESS_CATEGORY.test(component.category || '') || HULL_ACCESS_ITEM.test(name);
}

// ========================================
// Hull Geometry
// ========================================

/**
 * Usable area of a floor (inside the armor), as edge coordinates
 * @returns {{x0, y0, x1, y1}}
 */
function getHullBounds(floorLength, floorWidth, armorThickness = 0) {
    return {
        x0: armorThickness,
        y0: armorThickness,
        x1: Math.max(armorThickness, floorLength - armorThickness),
        y1: Math.max(armorThickness, floorWidth - armorThickness)
    };
}

/**
 * Hull sides a rectangle lies against
 * @returns {string[]} Any of 'top', 'bottom', 'left', 'right'
 */
function getHullSides(x, y, length, width, floorLength, floorWidth, armorThickness = 0) {
    const b = getHullBounds(floorLength, floorWidth, armorThickness);
    const sides = [];
    if (y <= b.y0 + HULL_EPS) sides.push('top');
    if (y + width >= b.y1 - HULL_EPS) sides.push('bottom');
    if (x <= b.x0 + HULL_EPS) sides.push('left');
    if (x + length >= b.x1 - HULL_EPS) sides.push('right');
    return sides;
}

/**
 * Whether a rectangle lies against the hull on at least one side
 * @returns {boolean}
 */
function touchesHull(x, y, length, width, floorLength, floorWidth, armorThickness = 0) {
    return getHullSides(x, y, length, width, floorLength, floorWidth, armorThickness).length > 0;
}

/**
 * Move a rectangle onto the nearest hull side (and keep it inside the usable area)
 * @returns {{x, y, side}} New position and the side it was snapped to
 */
function snapToHullEdge(x, y, length, width, floorLength, floorWidth, armorThickness = 0) {
    const b = getHullBounds(floorLength, floorWidth, armorThickness);
    const clampX = v => Math.max(b.x0, Math.min(v, b.x1 - length));
    const clampY = v => Math.max(b.y0, Math.min(v, b.y1 - width));
    const cx = clampX(x);
    const cy = clampY(y);

    const options = [
        { side: 'top', dist: cy - b.y0, x: cx, y: b.y0 },
        { side: 'bottom', dist: b.y1 - (cy + width), x: cx, y: b.y1 - width },
        { side: 'left', dist: cx - b.x0, x: b.x0, y: cy },
        { side: 'right', dist: b.x1 - (cx + length), x: b.x1 - length, y: cy }
    ];
    options.sort((p, q) => p.dist - q.dist);
    const best = options[0];
    return { x: clampX(best.x), y: clampY(best.y), side: best.side };
}

/**
 * Candidate positions along every hull side for a rectangle, aligned to the
 * ends of obstacles. Used to slide a hull component along the hull to the
 * nearest free spot.
 * @param {{x0, y0, x1, y1}} bounds - Usable area
 * @param {Array<{x, y, length, width}>} obstacles - Occupied rectangles
 * @param {number} origX - Preferred x
 * @param {number} origY - Preferred y
 * @param {number} length - Rectangle length (x)
 * @param {number} width - Rectangle width (y)
 * @returns {Array<{x, y}>}
 */
function getHullCandidates(bounds, obstacles, origX, origY, length, width) {
    const { x0, y0, x1, y1 } = bounds;
    const candidates = [];
    const sides = [
        { horizontal: true, fixed: y0 },
        { horizontal: true, fixed: y1 - width },
        { horizontal: false, fixed: x0 },
        { horizontal: false, fixed: x1 - length }
    ];
    for (const side of sides) {
        const along = side.horizontal ? [origX, x0, x1 - length] : [origY, y0, y1 - width];
        for (const r of obstacles) {
            if (side.horizontal) along.push(r.x + r.length, r.x - length);
            else along.push(r.y + r.width, r.y - width);
        }
        for (const a of along) {
            candidates.push(side.horizontal ? { x: a, y: side.fixed } : { x: side.fixed, y: a });
        }
    }
    return candidates;
}

// ========================================
// Exposed-Area Fill Planning
// ========================================

/**
 * Plan lining the free stretches of hull on a floor with items.
 *
 * Each item is an `along` × `depth` rectangle whose `along` side lies on the
 * hull. Sides are worked top, bottom, left, right; on each side the strip of
 * `depth` next to the hull is split into free stretches between obstacles, and
 * each stretch gets one block holding as many whole items as fit (fewer when
 * items run out). Blocks already planned count as obstacles for later sides, so
 * corners are never used twice.
 *
 * @param {{x0, y0, x1, y1}} bounds - Usable area (inside the armor)
 * @param {Array<{x, y, length, width}>} occupied - Occupied rectangles
 * @param {number} along - Item size along the hull (m)
 * @param {number} depth - Item size away from the hull (m)
 * @param {number} remaining - Items to place (Infinity to measure capacity)
 * @returns {Array<object>} Allocations { count, rects: [rect], area, bbox, side }
 */
function planExposedFill(bounds, occupied, along, depth, remaining) {
    if (!(along > 0) || !(depth > 0) || !(remaining > 0)) return [];
    const { x0, y0, x1, y1 } = bounds;
    const taken = occupied.slice();
    const allocations = [];
    let left = remaining;

    const sides = [
        { side: 'top', horizontal: true, c0: y0 },
        { side: 'bottom', horizontal: true, c0: y1 - depth },
        { side: 'left', horizontal: false, c0: x0 },
        { side: 'right', horizontal: false, c0: x1 - depth }
    ];

    for (const s of sides) {
        if (left <= 0) break;
        const [a0, a1] = s.horizontal ? [x0, x1] : [y0, y1];
        const crossSize = s.horizontal ? y1 - y0 : x1 - x0;
        if (depth > crossSize + HULL_EPS || along > a1 - a0 + HULL_EPS) continue;
        const c0 = s.c0;
        const c1 = c0 + depth;

        // Stretches of this side's strip blocked by obstacles
        const blocked = [];
        for (const r of taken) {
            const rc0 = s.horizontal ? r.y : r.x;
            const rc1 = rc0 + (s.horizontal ? r.width : r.length);
            if (rc1 <= c0 + HULL_EPS || rc0 >= c1 - HULL_EPS) continue;
            const ra0 = s.horizontal ? r.x : r.y;
            const ra1 = ra0 + (s.horizontal ? r.length : r.width);
            if (ra1 <= a0 + HULL_EPS || ra0 >= a1 - HULL_EPS) continue;
            blocked.push([Math.max(a0, ra0), Math.min(a1, ra1)]);
        }
        blocked.sort((p, q) => p[0] - q[0]);

        // Free stretches are the gaps between blocked stretches
        const free = [];
        let cursor = a0;
        for (const [b0, b1] of blocked) {
            if (b0 > cursor + HULL_EPS) free.push([cursor, b0]);
            cursor = Math.max(cursor, b1);
        }
        if (a1 > cursor + HULL_EPS) free.push([cursor, a1]);

        for (const [f0, f1] of free) {
            if (left <= 0) break;
            const n = Math.min(left, Math.floor((f1 - f0 + HULL_EPS) / along));
            if (n <= 0) continue;
            const size = n * along;
            const rect = s.horizontal
                ? { x: f0, y: c0, length: size, width: depth }
                : { x: c0, y: f0, length: depth, width: size };
            allocations.push({ count: n, rects: [rect], area: size * depth, bbox: { ...rect }, side: s.side });
            taken.push(rect);
            left -= n;
        }
    }
    return allocations;
}

/**
 * Number of items that fit along the free hull of a floor
 * @returns {number}
 */
function countExposedCapacity(bounds, occupied, along, depth) {
    return planExposedFill(bounds, occupied, along, depth, Infinity)
        .reduce((sum, a) => sum + a.count, 0);
}

// CommonJS export for Jest (no-op in browsers where `module` is undefined)
if (typeof module !== 'undefined') {
    module.exports = {
        HULL_EPS,
        requiresHullAccess,
        getHullBounds,
        getHullSides,
        touchesHull,
        snapToHullEdge,
        getHullCandidates,
        planExposedFill,
        countExposedCapacity
    };
}
