/**
 * Starship Architect - Corner Rooms Module
 *
 * Rooms that fill a rounded corner of a floor, on hulls whose floors have them (lifting
 * bodies). An entry is the usual { floor, x, y, length, width }, with x/y/length/width
 * as the bounding box, plus:
 *   { roomShape: 'corner', cornerAt, cornerAxis, cornerArea, cornerFloor }
 *
 * cornerAt is the corner it fills, and cornerAxis the way it continues from there:
 * 'x' along the wall running across the floor plan, 'y' along the one running up it.
 * The room is the part of the floor inside a rectangle set into that corner, so it is a
 * rectangle with the floor's own curve for one corner. It grows in three steps, only
 * going on to the next when its area needs that:
 *
 *   1. a square within the corner, until it fills the corner (as deep as the curve)
 *   2. along the wall, at that depth, until it has taken the whole wall
 *   3. deeper, still taking the whole wall
 *
 * cornerFloor is the floor whose wall shapes it. A room spanning floors has to be the
 * same on each, so that is the smallest of them, and the room sits inside the corners
 * of the larger ones. It is always convex, so its outline can be used for exact fit and
 * overlap checks like a circle's or an arc's.
 *
 * Dependencies (globals in the browser, required in Jest via jest-setup):
 * - curved-rooms.js (getFloorInnerPolygon, isRoomClear)
 * - hull-shapes.js (polygons, HULL_SHAPES)
 * - floor-utils.js (getFloorGeometry)
 */

/** Direction of each corner from the middle of the floor, in x and y */
const CORNER_DIRECTIONS = {
    'top-left': [-1, -1],
    'top-right': [1, -1],
    'bottom-right': [1, 1],
    'bottom-left': [-1, 1]
};

/** A curve smaller than this (meters) isn't worth a room: thick armor can all but remove it */
const CORNER_MIN_RADIUS = 0.5;

/** Tolerance (meters) for telling which points are on a wall, and for area and fit (m² and meters) */
const CORNER_EPS = 1e-6;

/** Halvings when working out a room's size, which is far more than a drawing can show */
const CORNER_SEARCH_STEPS = 50;

// ========================================
// Floors
// ========================================

/**
 * Whether the current ship's floors have rounded corners
 * @returns {boolean}
 */
function hasRoundedHullCorners() {
    return !!HULL_SHAPES[resolveHullShape(shipData.hullShape)].hasRoundedCorners;
}

/**
 * How far a floor's rounded corners reach along its walls
 * @param {Array<[number, number]>} inner - Usable space of the floor
 * @returns {number} Radius in meters, 0 if its corners are sharp
 */
function getCornerRadius(inner) {
    const box = getPolygonBounds(inner);
    if (!box) return 0;
    const onTopWall = inner.filter(([, y]) => y - box.y <= CORNER_EPS);
    return Math.min(...onTopWall.map(([x]) => x)) - box.x;
}

/**
 * The floor that shapes a room spanning some floors: the smallest of them
 * @param {number[]} floors - Floor numbers
 * @returns {number} Floor number
 */
function getCornerFloor(floors) {
    const usable = f => {
        const floor = getFloorGeometry(f);
        return floor ? floor.usableArea : 0;
    };
    return floors.reduce((smallest, f) => (usable(f) < usable(smallest) ? f : smallest));
}

// ========================================
// Outlines
// ========================================

/**
 * The part of a floor inside a rectangle set into one of its corners
 * @param {Array<[number, number]>} inner - Usable space of the floor
 * @param {string} cornerAt - Corner name
 * @param {number} sizeX - Size of the rectangle along x
 * @param {number} sizeY - Size of the rectangle along y
 * @returns {Array<[number, number]>} Convex polygon, which can be empty
 */
function cutFloorCorner(inner, cornerAt, sizeX, sizeY) {
    const [dx, dy] = CORNER_DIRECTIONS[cornerAt];
    const box = getPolygonBounds(inner);
    const wallX = dx < 0 ? box.x : box.x + box.length;
    const wallY = dy < 0 ? box.y : box.y + box.width;
    const cut = clipPolygonToHalfPlane(inner, dx, 0, dx * wallX - sizeX);
    return clipPolygonToHalfPlane(cut, 0, dy, dy * wallY - sizeY);
}

/**
 * Area of a floor's rounded corner when it is filled
 * @param {Array<[number, number]>} inner - Usable space of the floor
 * @returns {number} Area in m²
 */
function getFilledCornerArea(inner) {
    const radius = getCornerRadius(inner);
    return polygonArea(cutFloorCorner(inner, 'top-left', radius, radius));
}

/**
 * Outline of a corner room with a given area: see the top of this file for how it grows
 * @param {Array<[number, number]>} inner - Usable space of the floor
 * @param {string} cornerAt - Corner name
 * @param {string} axis - 'x' or 'y', the way it continues along the wall
 * @param {number} area - Area in m²
 * @returns {Array<[number, number]>} Convex polygon, empty if the floor has no space
 */
function cornerRoomPolygon(inner, cornerAt, axis, area) {
    if (inner.length < 3) return [];
    if (area >= polygonArea(inner)) return inner.slice();

    const box = getPolygonBounds(inner);
    const radius = getCornerRadius(inner);
    const fullRun = axis === 'x' ? box.length : box.width;
    const fullDepth = axis === 'x' ? box.width : box.length;
    const cut = (run, depth) => (axis === 'x'
        ? cutFloorCorner(inner, cornerAt, run, depth)
        : cutFloorCorner(inner, cornerAt, depth, run));

    let shape = size => cut(fullRun, size);
    let low = radius;
    let high = fullDepth;
    if (area <= polygonArea(cut(radius, radius))) {
        shape = size => cut(size, size);
        low = 0;
        high = radius;
    } else if (area <= polygonArea(cut(fullRun, radius))) {
        shape = size => cut(size, radius);
        high = fullRun;
    }

    for (let i = 0; i < CORNER_SEARCH_STEPS; i++) {
        const middle = (low + high) / 2;
        if (polygonArea(shape(middle)) < area) low = middle;
        else high = middle;
    }
    return shape((low + high) / 2);
}

/**
 * Outline of a placed corner room
 * @param {object} room - Corner room entry
 * @returns {Array<[number, number]>} Convex polygon
 */
function getCornerRoomOutline(room) {
    return cornerRoomPolygon(getFloorInnerPolygon(room.cornerFloor), room.cornerAt, room.cornerAxis, room.cornerArea);
}

// ========================================
// Fit and Position
// ========================================

/**
 * Whether a corner room fits inside the floors it spans
 * @param {object} room - Corner room entry
 * @param {number[]} floors - Floors it spans
 * @returns {boolean}
 */
function isCornerRoomFitting(room, floors) {
    if (!hasRoundedHullCorners() || !getFloorGeometry(room.cornerFloor)) return false;
    if (room.cornerArea > getFloorGeometry(room.cornerFloor).usableArea + CORNER_EPS) return false;
    const outline = getCornerRoomOutline(room);
    return outline.length >= 3 && floors.every(f =>
        outline.every(([x, y]) => isPointInConvexPolygon(getFloorInnerPolygon(f), x, y, CORNER_EPS)));
}

/**
 * Corner room in a given corner, with its bounding box
 * @param {object} room - Room or placement data ({cornerAxis, cornerArea})
 * @param {number[]} floors - Floors it spans
 * @param {string} cornerAt - Corner name
 * @returns {object|null} Room entry, or null if it can't go on these floors
 */
function buildCornerRoom(room, floors, cornerAt) {
    if (!hasRoundedHullCorners()) return null;
    const { cornerAxis, cornerArea } = room;
    const cornerFloor = getCornerFloor(floors);
    const inner = getFloorInnerPolygon(cornerFloor);
    if (cornerArea > polygonArea(inner) + CORNER_EPS) return null;
    const outline = cornerRoomPolygon(inner, cornerAt, cornerAxis, cornerArea);
    if (outline.length < 3) return null;
    const box = getPolygonBounds(outline);
    return {
        floor: floors[0], x: box.x, y: box.y, length: box.length, width: box.width,
        roomShape: 'corner', cornerAt, cornerAxis, cornerArea, cornerFloor
    };
}

/**
 * A floor's corners, nearest a point first
 * @param {number[]} floors - Floors a room spans
 * @param {number} x - Point in meters
 * @param {number} y - Point in meters
 * @returns {string[]} Corner names, none if the floors have no usable space
 */
function getCornersByDistance(floors, x, y) {
    const box = getPolygonBounds(getFloorInnerPolygon(getCornerFloor(floors)));
    if (!box) return [];
    const middleX = box.x + box.length / 2;
    const middleY = box.y + box.width / 2;
    const distance = name => {
        const [dx, dy] = CORNER_DIRECTIONS[name];
        return Math.hypot(middleX + (dx * box.length) / 2 - x, middleY + (dy * box.width) / 2 - y);
    };
    return Object.keys(CORNER_DIRECTIONS).sort((a, b) => distance(a) - distance(b));
}

/**
 * Put a corner room in the corner nearest the pointer, without looking at what else is there
 * @param {object} room - Room or placement data
 * @param {number[]} floors - Floors it spans
 * @param {number} pointerX - Pointer position in meters
 * @param {number} pointerY - Pointer position in meters
 * @returns {object|null} Room entry, or null if it can't go on these floors
 */
function positionCornerRoom(room, floors, pointerX, pointerY) {
    const [nearest] = getCornersByDistance(floors, pointerX, pointerY);
    return nearest ? buildCornerRoom(room, floors, nearest) : null;
}

/**
 * Find the free corner nearest the pointer
 * @param {object} room - Room or placement data
 * @param {number[]} floors - Floors it spans
 * @param {number} pointerX - Pointer position in meters
 * @param {number} pointerY - Pointer position in meters
 * @param {number} excludeComponentIndex - Component to ignore, or -1
 * @returns {object|null} Room entry, or null if there is no room for it
 */
function findCornerSpot(room, floors, pointerX, pointerY, excludeComponentIndex = -1) {
    for (const cornerAt of getCornersByDistance(floors, pointerX, pointerY)) {
        const spot = buildCornerRoom(room, floors, cornerAt);
        if (spot && isRoomClear(spot, floors, excludeComponentIndex)) return spot;
    }
    return null;
}

/**
 * Have a corner room continue along the other wall, keeping its corner and size
 * @param {object} room - Corner room entry
 * @param {number[]} floors - Floors it spans
 * @returns {object|null} Room entry
 */
function switchCornerRoomWall(room, floors) {
    const cornerAxis = room.cornerAxis === 'x' ? 'y' : 'x';
    return buildCornerRoom({ ...room, cornerAxis }, floors, room.cornerAt);
}

// ========================================
// Size Options
// ========================================

/**
 * Corner room options for the chosen floors. A room that needs no more than the corner
 * is the same whichever wall it would continue along, so it gets one option.
 * @param {number[]} floors - Floors chosen
 * @param {number} area - Area of the room on each floor
 * @param {string} perFloorText - Added to the label when it spans floors
 * @returns {Array<{roomShape, value, label}>}
 */
function getCornerOptions(floors, area, perFloorText = '') {
    if (!hasRoundedHullCorners() || !(area > 0)) return [];
    const inner = getFloorInnerPolygon(getCornerFloor(floors));
    if (inner.length < 3 || getCornerRadius(inner) < CORNER_MIN_RADIUS || area > polygonArea(inner)) return [];

    const sizeOf = axis => getPolygonBounds(cornerRoomPolygon(inner, 'top-left', axis, area));
    const option = (axis, label) => ({
        roomShape: 'corner',
        value: `corner:${axis}:${area}`,
        label: `${label}${perFloorText}`
    });

    if (area <= getFilledCornerArea(inner)) {
        const { length, width } = sizeOf('x');
        return [option('x', `Rounded corner, ${length.toFixed(1)} × ${width.toFixed(1)} m`)];
    }

    const box = getPolygonBounds(inner);
    const axes = box.length >= box.width ? ['x', 'y'] : ['y', 'x'];
    return axes.map((axis, i) => {
        const { length, width } = sizeOf(axis);
        const run = axis === 'x' ? length : width;
        const depth = axis === 'x' ? width : length;
        const wall = i === 0 ? 'long' : 'short';
        return option(axis, `Rounded corner and along the ${wall} wall, ${run.toFixed(1)} m along, ${depth.toFixed(1)} m deep`);
    });
}

/**
 * Read a corner room from the size dropdown
 * @param {string} axis - 'x' or 'y'
 * @param {string} areaText - Area
 * @returns {object|null} Placement data. length and width are only a stand-in, as its
 *   real size depends on the floor it goes on.
 */
function parseCornerChoice(axis, areaText) {
    const cornerArea = parseFloat(areaText);
    if ((axis !== 'x' && axis !== 'y') || !(cornerArea > 0)) return null;
    const side = Math.sqrt(cornerArea);
    return { roomShape: 'corner', cornerAxis: axis, cornerArea, length: side, width: side };
}

// CommonJS export for Jest (no-op in browsers where `module` is undefined)
if (typeof module !== 'undefined') {
    module.exports = {
        CORNER_DIRECTIONS,
        hasRoundedHullCorners,
        getCornerRadius,
        getCornerFloor,
        getFilledCornerArea,
        cornerRoomPolygon,
        getCornerRoomOutline,
        isCornerRoomFitting,
        buildCornerRoom,
        positionCornerRoom,
        findCornerSpot,
        switchCornerRoomWall,
        getCornerOptions,
        parseCornerChoice
    };
}
