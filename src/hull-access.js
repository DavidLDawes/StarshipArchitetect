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
 *
 * The plain functions work on a rectangular floor from its size and armor. The
 * floor-aware ones (touchesFloorHull, snapToFloorHull, getFloorUsableBounds,
 * planFloorExposedFill) take a floor number, follow the current ship's hull shape,
 * and are what the placement code should call. On a curved or sloping wall only a
 * corner of a rectangle can touch, so a touching corner counts as being on the hull.
 *
 * Dependencies (globals in the browser, required in Jest via jest-setup):
 * - hull-shapes.js (polygon helpers, resolveHullShape)
 * - floor-utils.js (getShipGeometry)
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

/**
 * Plan lining a curved or sloping hull with items, one rectangle per item.
 *
 * A straight run of a block can't follow a curve, so this walks around the wall
 * and places an item wherever one fits. An item lies along whichever axis the
 * wall is closer to at that point, with a corner touching the wall.
 *
 * @param {Array<[number, number]>} inner - Convex polygon inside the armor
 * @param {Array<{x, y, length, width}>} occupied - Occupied rectangles
 * @param {number} along - Item size along the hull (m)
 * @param {number} depth - Item size away from the hull (m)
 * @param {number} remaining - Items to place (Infinity to measure capacity)
 * @returns {Array<object>} Allocations { count: 1, rects: [rect], area, bbox }
 */
function planCurvedExposedFill(inner, occupied, along, depth, remaining) {
    if (!(along > 0) || !(depth > 0) || !(remaining > 0) || inner.length < 3) return [];
    const alongX = getRectFitRegion(inner, along, depth);
    const alongY = getRectFitRegion(inner, depth, along);
    if (alongX.length === 0 && alongY.length === 0) return [];

    // Fine enough that items end up nearly touching, without getting slow on a huge hull
    const step = Math.max(
        Math.min(0.1, Math.max(0.02, Math.min(along, depth) / 8)),
        polygonPerimeter(inner) / 20000
    );
    const taken = occupied.slice();
    const allocations = [];

    for (let i = 0; i < inner.length && allocations.length < remaining; i++) {
        const [ax, ay] = inner[i];
        const [bx, by] = inner[(i + 1) % inner.length];
        const size = Math.hypot(bx - ax, by - ay);
        if (size <= HULL_EPS) continue;

        let useAlongX = Math.abs(bx - ax) >= Math.abs(by - ay);
        if ((useAlongX ? alongX : alongY).length === 0) useAlongX = !useAlongX;
        const region = useAlongX ? alongX : alongY;
        const length = useAlongX ? along : depth;
        const width = useAlongX ? depth : along;

        for (let d = 0; d < size && allocations.length < remaining; d += step) {
            const t = d / size;
            const p = closestPointOnPolygonBoundary(region,
                ax + t * (bx - ax) - length / 2,
                ay + t * (by - ay) - width / 2);
            const rect = { x: p.x, y: p.y, length, width };
            const blocked = taken.some(r =>
                rect.x + length > r.x + HULL_EPS && r.x + r.length > rect.x + HULL_EPS &&
                rect.y + width > r.y + HULL_EPS && r.y + r.width > rect.y + HULL_EPS);
            if (blocked) continue;
            taken.push(rect);
            allocations.push({ count: 1, rects: [rect], area: length * width, bbox: { ...rect } });
        }
    }
    return allocations;
}

// ========================================
// Floor-Aware Rules
// ========================================

/** Last shared space worked out for a component spanning several floors */
let commonInnerCache = { geometry: null, key: '', polygon: null };

/**
 * Usable space of one or more floors on a ship with a shaped hull.
 * A component spanning several floors has to fit on all of them at the same x, y,
 * so for several floors this is the space they share. Being against a wall of
 * that shared space means being against the hull on at least one of the floors.
 * @param {number|number[]} floors - Floor number, or the floors a component spans
 * @returns {Array<[number, number]>|null} Convex polygon, empty if there is no
 *   usable space, or null on a rectangular ship (use the floor size and armor)
 */
function getShapedInner(floors) {
    if (resolveHullShape(shipData.hullShape) === 'rectangular') return null;
    const geometry = getShipGeometry();
    const list = Array.isArray(floors) ? floors : [floors];
    const innerOf = f => (geometry.floors[f - 1] ? geometry.floors[f - 1].inner : []);
    if (list.length === 1) return innerOf(list[0]);

    const key = list.join(',');
    if (commonInnerCache.geometry !== geometry || commonInnerCache.key !== key) {
        const polygon = list.slice(1).reduce((common, f) => intersectConvexPolygons(common, innerOf(f)), innerOf(list[0]));
        commonInnerCache = { geometry, key, polygon };
    }
    return commonInnerCache.polygon;
}

/**
 * Whether a rectangle lies against the hull of a floor
 * @param {number|number[]} floors - Floor number, or the floors a component spans
 * @returns {boolean}
 */
function touchesFloorHull(floors, x, y, length, width, floorLength, floorWidth, armorThickness = 0) {
    const inner = getShapedInner(floors);
    if (!inner) return touchesHull(x, y, length, width, floorLength, floorWidth, armorThickness);
    return isRectOnConvexPolygonWall(inner, x, y, length, width);
}

/**
 * Move a rectangle to the nearest position against the hull of a floor. A
 * rectangle too big for the floor comes back where it was.
 * @param {number|number[]} floors - Floor number, or the floors a component spans
 * @returns {{x, y}}
 */
function snapToFloorHull(floors, x, y, length, width, floorLength, floorWidth, armorThickness = 0) {
    const inner = getShapedInner(floors);
    if (!inner) return snapToHullEdge(x, y, length, width, floorLength, floorWidth, armorThickness);
    return closestPointOnPolygonBoundary(getRectFitRegion(inner, length, width), x, y) || { x, y };
}

/**
 * Box around the usable space of a floor, as edge coordinates
 * @returns {{x0, y0, x1, y1}}
 */
function getFloorUsableBounds(floorIndex, floorLength, floorWidth, armorThickness = 0) {
    const inner = getShapedInner(floorIndex);
    if (!inner) return getHullBounds(floorLength, floorWidth, armorThickness);
    if (inner.length === 0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
    const box = getPolygonBounds(inner);
    return { x0: box.x, y0: box.y, x1: box.x + box.length, y1: box.y + box.width };
}

/**
 * Plan lining the free hull of a floor with items
 * @param {number} floorIndex - Floor number
 * @param {Array<{x, y, length, width}>} occupied - Occupied rectangles
 * @param {number} along - Item size along the hull (m)
 * @param {number} depth - Item size away from the hull (m)
 * @param {number} remaining - Items to place (Infinity to measure capacity)
 * @returns {Array<object>} Allocations, each with count, rects, area and bbox
 */
function planFloorExposedFill(floorIndex, occupied, along, depth, remaining, floorLength, floorWidth, armorThickness = 0) {
    const inner = getShapedInner(floorIndex);
    if (inner && inner.length === 0) return [];
    if (inner && !getShipGeometry().floors[floorIndex - 1].isRectangle) {
        return planCurvedExposedFill(inner, occupied, along, depth, remaining);
    }
    const bounds = getFloorUsableBounds(floorIndex, floorLength, floorWidth, armorThickness);
    return planExposedFill(bounds, occupied, along, depth, remaining);
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
        countExposedCapacity,
        planCurvedExposedFill,
        getShapedInner,
        touchesFloorHull,
        snapToFloorHull,
        getFloorUsableBounds,
        planFloorExposedFill
    };
}
