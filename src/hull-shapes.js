/**
 * Starship Architect - Hull Shapes Module
 *
 * Works out the outline of every floor for each hull shape. Floor area is shared
 * between floors by the shape's profile, so floor areas always add up to
 * tons x 14 / ceiling height, whatever the shape.
 *
 * All floors share one coordinate frame: (0, 0) is the top left corner of the
 * smallest box that holds every floor, x runs along the frame's length and y
 * along its width. The same x, y is directly above or below on every floor, so
 * components spanning several floors still line up. Outlines are convex polygons
 * (circles have 96 sides and are sized so their area is exact), which keeps the
 * armor inset and fit checks simple. Floors are numbered from the bottom: floor 1
 * is the bottom deck.
 *
 * Each shape's `bow` says which way it points on a floor plan: 'top' is toward
 * y = 0 and 'left' is toward x = 0, so the wedge's rear edges line up at
 * x = length. Round shapes and plain rectangles have no bow.
 *
 * Dependencies (globals in the browser, required in Jest via jest-setup):
 * - floor-utils.js (calculateTotalFloorArea, calculateDefaultFloorLength, calculateArmorThickness)
 */

// ========================================
// Constants
// ========================================

/** Sides used to draw circles and the corners of rounded rectangles */
const HULL_POLYGON_SIDES = 96;

/**
 * Band height (meters) for treating space outside a curved hull as occupied.
 * Must not be below MIN_PASSAGE in placement-geometry.js: free cells have to
 * share an edge that long to connect, so thinner bands split an open floor into
 * many separate regions.
 */
const HULL_BAND_STEP = 0.5;

/** Tolerance (meters) when testing whether a point lies inside a hull */
const HULL_FIT_EPS = 1e-6;

/**
 * Slack (meters) when working out where a rectangle fits, well inside HULL_FIT_EPS.
 * It keeps an exact fit from collapsing to a region with no area.
 */
const RECT_FIT_SLACK = 1e-9;

/** Lifting body proportions: length per unit of width, corner radius per unit of width */
const LIFTING_BODY_ASPECT = 2;
const LIFTING_BODY_CORNER = 0.25;

/** Wing shape: leading edge sweep, and how far the top floor's point sits behind the bottom floor's */
const WING_SWEEP_DEGREES = 30;
const WING_STAGGER_OF_CHORD = 0.25;

/** Sweep depth is limited to this many mean chords so every floor keeps its side walls */
const WING_MAX_SWEEP_CHORDS = 1.5;

/** Default proportions of the largest floor: length per unit of width */
const WEDGE_DEFAULT_ASPECT = 2;
const CYLINDER_DEFAULT_ASPECT = 3;
const WING_DEFAULT_ASPECT = 2.5;

// ========================================
// Floor Position
// ========================================

/**
 * Where a floor sits in the stack, for a stack of numFloors
 * @param {number} index - Floor position, 0 at the bottom
 * @param {number} numFloors - Number of floors
 * @returns {{t: number, h: number, u: number}}
 *   t: 0 at the middle, 1 at the top and bottom floors
 *   h: 0 at the bottom, 1 at the top
 *   u: the floor's center height, from -1 to 1
 */
function getFloorPosition(index, numFloors) {
    if (numFloors <= 1) return { t: 0, h: 0, u: 0 };
    const middle = (numFloors - 1) / 2;
    return {
        t: Math.abs(index - middle) / middle,
        h: index / (numFloors - 1),
        u: (2 * index + 1 - numFloors) / numFloors
    };
}

// ========================================
// Polygon Helpers
// ========================================

/**
 * Signed polygon area; positive when vertices run in the direction this module
 * uses for all its polygons
 */
function signedPolygonArea(polygon) {
    let sum = 0;
    for (let i = 0; i < polygon.length; i++) {
        const [x0, y0] = polygon[i];
        const [x1, y1] = polygon[(i + 1) % polygon.length];
        sum += x0 * y1 - x1 * y0;
    }
    return sum / 2;
}

/**
 * Polygon area
 * @param {Array<[number, number]>} polygon - Vertices
 * @returns {number} Area in m²
 */
function polygonArea(polygon) {
    return Math.abs(signedPolygonArea(polygon));
}

/**
 * Polygon perimeter
 * @param {Array<[number, number]>} polygon - Vertices
 * @returns {number} Perimeter in meters
 */
function polygonPerimeter(polygon) {
    let sum = 0;
    for (let i = 0; i < polygon.length; i++) {
        const [x0, y0] = polygon[i];
        const [x1, y1] = polygon[(i + 1) % polygon.length];
        sum += Math.hypot(x1 - x0, y1 - y0);
    }
    return sum;
}

/**
 * Same polygon with its vertices in this module's standard direction
 */
function orientPolygon(polygon) {
    return signedPolygonArea(polygon) < 0 ? polygon.slice().reverse() : polygon;
}

/**
 * Bounding box of a polygon
 * @returns {{x, y, length, width}|null} Null for an empty polygon
 */
function getPolygonBounds(polygon) {
    if (polygon.length === 0) return null;
    const xs = polygon.map(p => p[0]);
    const ys = polygon.map(p => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, length: Math.max(...xs) - x, width: Math.max(...ys) - y };
}

/**
 * Rectangle as a polygon
 */
function rectanglePolygon(x, y, length, width) {
    return orientPolygon([[x, y], [x + length, y], [x + length, y + width], [x, y + width]]);
}

/**
 * Circle as a polygon. Sides come in multiples of four, so the extreme vertices
 * lie exactly one radius from the center along both axes.
 */
function circlePolygon(cx, cy, radius) {
    const points = [];
    for (let i = 0; i < HULL_POLYGON_SIDES; i++) {
        const angle = (i * 2 * Math.PI) / HULL_POLYGON_SIDES;
        points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
    }
    return orientPolygon(points);
}

/**
 * Rounded rectangle as a polygon, centered on (cx, cy)
 */
function roundedRectanglePolygon(cx, cy, length, width, radius) {
    const segments = HULL_POLYGON_SIDES / 4;
    const halfX = length / 2 - radius;
    const halfY = width / 2 - radius;
    const corners = [[halfX, halfY], [-halfX, halfY], [-halfX, -halfY], [halfX, -halfY]];
    const points = [];
    corners.forEach(([ox, oy], corner) => {
        for (let i = 0; i <= segments; i++) {
            const angle = ((corner + i / segments) * Math.PI) / 2;
            points.push([cx + ox + radius * Math.cos(angle), cy + oy + radius * Math.sin(angle)]);
        }
    });
    return orientPolygon(points);
}

/**
 * Move every wall of a convex polygon inward. Done by cutting the polygon with
 * each moved wall in turn, which handles walls that vanish completely.
 * @param {Array<[number, number]>} polygon - Convex polygon in standard direction
 * @param {number} distance - Inset in meters
 * @returns {Array<[number, number]>} Inset polygon, empty if nothing is left
 */
function insetConvexPolygon(polygon, distance) {
    if (!(distance > 0)) return polygon.slice();

    let result = polygon;
    for (const wall of getPolygonWalls(polygon)) {
        result = clipPolygonToHalfPlane(result, wall.nx, wall.ny, wall.offset + distance);
    }
    return result.length >= 3 ? result : [];
}

/**
 * Walls of a convex polygon as half-planes: a point is on the inner side of a
 * wall when x * nx + y * ny >= offset, and that sum minus the offset is its
 * distance from the wall
 * @param {Array<[number, number]>} polygon - Convex polygon in standard direction
 * @returns {Array<{nx, ny, offset}>}
 */
function getPolygonWalls(polygon) {
    const walls = [];
    for (let i = 0; i < polygon.length; i++) {
        const [ax, ay] = polygon[i];
        const [bx, by] = polygon[(i + 1) % polygon.length];
        const size = Math.hypot(bx - ax, by - ay);
        if (size <= HULL_FIT_EPS) continue;
        const nx = -(by - ay) / size;
        const ny = (bx - ax) / size;
        walls.push({ nx, ny, offset: ax * nx + ay * ny });
    }
    return walls;
}

/**
 * Cut away the part of a convex polygon where x * nx + y * ny < offset
 * @returns {Array<[number, number]>} What is left, which can be empty
 */
function clipPolygonToHalfPlane(polygon, nx, ny, offset) {
    const depth = ([x, y]) => x * nx + y * ny - offset;
    const kept = [];
    for (let i = 0; i < polygon.length; i++) {
        const p = polygon[i];
        const q = polygon[(i + 1) % polygon.length];
        const dp = depth(p);
        const dq = depth(q);
        if (dp >= 0) kept.push(p);
        if ((dp >= 0) !== (dq >= 0)) {
            const s = dp / (dp - dq);
            kept.push([p[0] + s * (q[0] - p[0]), p[1] + s * (q[1] - p[1])]);
        }
    }
    return kept;
}

/**
 * Space shared by two convex polygons
 * @returns {Array<[number, number]>} Convex polygon, empty if they don't meet
 */
function intersectConvexPolygons(a, b) {
    let result = a;
    for (const wall of getPolygonWalls(b)) {
        result = clipPolygonToHalfPlane(result, wall.nx, wall.ny, wall.offset);
        if (result.length < 3) return [];
    }
    return result;
}

/**
 * Whether two convex polygons overlap. Two convex shapes are apart exactly when a
 * wall of one of them has the whole of the other on its outer side.
 * @param {Array<[number, number]>} a - Convex polygon in standard direction
 * @param {Array<[number, number]>} b - Convex polygon in standard direction
 * @param {number} eps - Overlap smaller than this doesn't count, so shapes can touch
 * @returns {boolean}
 */
function doConvexPolygonsOverlap(a, b, eps = HULL_FIT_EPS) {
    if (a.length < 3 || b.length < 3) return false;
    const isApart = (walls, points) => walls.some(wall =>
        points.every(([x, y]) => x * wall.nx + y * wall.ny - wall.offset <= eps));
    return !isApart(getPolygonWalls(a), b) && !isApart(getPolygonWalls(b), a);
}

/**
 * Center of area of a polygon
 * @returns {{x, y}}
 */
function getPolygonCentroid(polygon) {
    const twiceArea = signedPolygonArea(polygon) * 2;
    if (Math.abs(twiceArea) <= HULL_FIT_EPS) {
        const box = getPolygonBounds(polygon);
        return { x: box.x + box.length / 2, y: box.y + box.width / 2 };
    }
    let x = 0;
    let y = 0;
    polygon.forEach(([ax, ay], i) => {
        const [bx, by] = polygon[(i + 1) % polygon.length];
        const cross = ax * by - bx * ay;
        x += (ax + bx) * cross;
        y += (ay + by) * cross;
    });
    return { x: x / (3 * twiceArea), y: y / (3 * twiceArea) };
}

/**
 * Whether a point lies inside a convex polygon or on its boundary
 * @param {Array<[number, number]>} polygon - Convex polygon in standard direction
 * @returns {boolean}
 */
function isPointInConvexPolygon(polygon, x, y, eps = HULL_FIT_EPS) {
    if (polygon.length < 3) return false;
    for (let i = 0; i < polygon.length; i++) {
        const [ax, ay] = polygon[i];
        const [bx, by] = polygon[(i + 1) % polygon.length];
        const size = Math.hypot(bx - ax, by - ay);
        if (size <= HULL_FIT_EPS) continue;
        if (((x - ax) * -(by - ay) + (y - ay) * (bx - ax)) / size < -eps) return false;
    }
    return true;
}

/**
 * Whether a rectangle lies fully inside a convex polygon. In a convex shape that
 * is true exactly when all four corners are inside.
 * @returns {boolean}
 */
function isRectInConvexPolygon(polygon, x, y, length, width, eps = HULL_FIT_EPS) {
    return isPointInConvexPolygon(polygon, x, y, eps) &&
        isPointInConvexPolygon(polygon, x + length, y, eps) &&
        isPointInConvexPolygon(polygon, x + length, y + width, eps) &&
        isPointInConvexPolygon(polygon, x, y + width, eps);
}

/**
 * Every position of a rectangle's top left corner that keeps the whole rectangle
 * inside a convex polygon. The result is itself convex, and a position on its
 * boundary is one where a corner of the rectangle touches a wall.
 * @param {Array<[number, number]>} polygon - Convex polygon in standard direction
 * @param {number} length - Rectangle size along x
 * @param {number} width - Rectangle size along y
 * @returns {Array<[number, number]>} Convex polygon, empty if the rectangle can't fit
 */
function getRectFitRegion(polygon, length, width) {
    if (polygon.length < 3) return [];
    const box = getPolygonBounds(polygon);
    let region = rectanglePolygon(box.x - 1, box.y - 1, box.length + 2, box.width + 2);
    for (const { nx, ny, offset } of getPolygonWalls(polygon)) {
        // The corner furthest behind this wall is the one that limits the position
        const reach = Math.min(0, length * nx) + Math.min(0, width * ny);
        region = clipPolygonToHalfPlane(region, nx, ny, offset - reach - RECT_FIT_SLACK);
        if (region.length < 3) return [];
    }
    return region;
}

/**
 * Point on a polygon's boundary closest to a given point
 * @returns {{x, y}|null} Null for an empty polygon
 */
function closestPointOnPolygonBoundary(polygon, x, y) {
    let best = null;
    let bestDistance = Infinity;
    for (let i = 0; i < polygon.length; i++) {
        const [ax, ay] = polygon[i];
        const [bx, by] = polygon[(i + 1) % polygon.length];
        const dx = bx - ax;
        const dy = by - ay;
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared > 0
            ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared))
            : 0;
        const px = ax + t * dx;
        const py = ay + t * dy;
        const distance = (px - x) * (px - x) + (py - y) * (py - y);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = { x: px, y: py };
        }
    }
    return best;
}

/**
 * Point inside a convex polygon closest to a given point (the point itself if
 * it is already inside)
 * @returns {{x, y}|null} Null for an empty polygon
 */
function closestPointInConvexPolygon(polygon, x, y) {
    if (polygon.length === 0) return null;
    // Not isPointInConvexPolygon, which skips very short sides: when a rectangle
    // exactly fits, every side of its fit region can be that short
    const inside = polygon.every(([ax, ay], i) => {
        const [bx, by] = polygon[(i + 1) % polygon.length];
        return (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0;
    });
    return inside ? { x, y } : closestPointOnPolygonBoundary(polygon, x, y);
}

/**
 * Whether a rectangle inside a convex polygon touches one of its walls. On a
 * curved or sloping wall only a corner can touch, so that is the test.
 * @returns {boolean}
 */
function isRectOnConvexPolygonWall(polygon, x, y, length, width, eps = HULL_FIT_EPS) {
    const walls = getPolygonWalls(polygon);
    const corners = [[x, y], [x + length, y], [x + length, y + width], [x, y + width]];
    return corners.some(([cx, cy]) =>
        walls.some(w => Math.abs(cx * w.nx + cy * w.ny - w.offset) <= eps) &&
        isPointInConvexPolygon(polygon, cx, cy, eps));
}

/**
 * Points where a vertical or horizontal line crosses a polygon's boundary
 * @param {string} axis - 'x' for the line x = value, 'y' for the line y = value
 * @returns {Array<{x, y}>}
 */
function getPolygonCrossings(polygon, axis, value) {
    const c = axis === 'x' ? 0 : 1;
    const crossings = [];
    for (let i = 0; i < polygon.length; i++) {
        const p = polygon[i];
        const q = polygon[(i + 1) % polygon.length];
        if (Math.min(p[c], q[c]) > value || Math.max(p[c], q[c]) < value || p[c] === q[c]) continue;
        const t = (value - p[c]) / (q[c] - p[c]);
        crossings.push({ x: p[0] + t * (q[0] - p[0]), y: p[1] + t * (q[1] - p[1]) });
    }
    return crossings;
}

// ========================================
// Hull Bands
// ========================================

/**
 * Horizontal extent of a convex polygon at one height
 * @returns {[number, number]|null} [left, right], or null if the height misses it
 */
function getPolygonSpan(polygon, y) {
    let left = Infinity;
    let right = -Infinity;
    for (let i = 0; i < polygon.length; i++) {
        const [ax, ay] = polygon[i];
        const [bx, by] = polygon[(i + 1) % polygon.length];
        if (Math.min(ay, by) > y || Math.max(ay, by) < y) continue;
        if (ay === by) {
            left = Math.min(left, ax, bx);
            right = Math.max(right, ax, bx);
        } else {
            const x = ax + ((y - ay) / (by - ay)) * (bx - ax);
            left = Math.min(left, x);
            right = Math.max(right, x);
        }
    }
    return left <= right ? [left, right] : null;
}

/**
 * Slice a convex polygon into horizontal bands, each as wide as the polygon is
 * at the band's middle. Using the middle keeps the bands' total area within a
 * fraction of a percent of the true area, where bands kept fully inside the hull
 * lose enough to stop a full design from fitting. Band edges can poke slightly
 * past a sloping wall, so anything drawn from them should be clipped to the hull.
 * @param {Array<[number, number]>} polygon - Convex polygon
 * @param {number} step - Target band height; bands are never thinner than this
 *   unless the polygon itself is
 * @returns {Array<{y, height, x0, x1}>}
 */
function getHullBands(polygon, step = HULL_BAND_STEP) {
    const bounds = getPolygonBounds(polygon);
    if (!bounds || bounds.width <= 0) return [];
    const count = Math.max(1, Math.floor(bounds.width / step + HULL_FIT_EPS));
    const height = bounds.width / count;
    const bands = [];
    for (let i = 0; i < count; i++) {
        const y = bounds.y + i * height;
        const span = getPolygonSpan(polygon, y + height / 2);
        if (span) bands.push({ y, height, x0: span[0], x1: span[1] });
    }
    return bands;
}

/**
 * Rectangles covering everything in an area that lies outside a convex polygon.
 * Passing these to the free-space analysis as occupied space makes it work on
 * any hull shape.
 * @param {Array<[number, number]>} polygon - Convex polygon
 * @param {{x0, y0, x1, y1}} area - Area to cover
 * @param {number} step - Band height
 * @returns {Array<{x, y, length, width}>}
 */
function getOutsideHullRects(polygon, area, step = HULL_BAND_STEP) {
    const { x0, y0, x1, y1 } = area;
    const bands = getHullBands(polygon, step);
    if (bands.length === 0) return [{ x: x0, y: y0, length: x1 - x0, width: y1 - y0 }];

    const rects = [];
    const add = (x, y, length, width) => {
        if (length > HULL_FIT_EPS && width > HULL_FIT_EPS) rects.push({ x, y, length, width });
    };
    const last = bands[bands.length - 1];
    add(x0, y0, x1 - x0, bands[0].y - y0);
    for (const band of bands) {
        add(x0, band.y, band.x0 - x0, band.height);
        add(band.x1, band.y, x1 - band.x1, band.height);
    }
    add(x0, last.y + last.height, x1 - x0, y1 - (last.y + last.height));
    return rects;
}

// ========================================
// Shape Definitions
// ========================================

/**
 * Size of each floor relative to the largest, for a profile function
 * @param {function} profile - Takes a floor position and returns its relative size
 * @returns {number[]} Sizes from the bottom floor up; the largest is exactly 1
 */
function getRelativeSizes(profile, numFloors) {
    const sizes = Array.from({ length: numFloors }, (_, i) => profile(getFloorPosition(i, numFloors)));
    const largest = Math.max(...sizes);
    return sizes.map(size => size / largest);
}

/**
 * Share total area between floors
 * @param {number[]} sizes - Relative sizes
 * @param {number} power - 1 when one dimension scales, 2 when both do
 * @returns {number[]} Area of each floor
 */
function shareArea(sizes, power, totalArea) {
    const sum = sizes.reduce((total, size) => total + size ** power, 0);
    return sizes.map(size => (totalArea * size ** power) / sum);
}

/** Round a default length to something readable, respecting the 5 m minimum of the length control */
function roundDefaultLength(length) {
    return Math.max(5, Math.round(length * 10) / 10);
}

/**
 * Circular floors, centered on each other
 */
function buildRoundFloors(profile, numFloors, totalArea) {
    const unitArea = polygonArea(circlePolygon(0, 0, 1));
    const areas = shareArea(getRelativeSizes(profile, numFloors), 2, totalArea);
    const radii = areas.map(area => Math.sqrt(area / unitArea));
    const largest = Math.max(...radii);
    return {
        length: largest * 2,
        width: largest * 2,
        outlines: radii.map(radius => circlePolygon(largest, largest, radius))
    };
}

const liftingBodyProfile = ({ h }) => 1 - 0.4 * h * h;
const wedgeProfile = ({ t }) => 1 - 0.25 * t;
const coneProfile = ({ h }) => 1 - 0.75 * h;
const sphereProfile = ({ u }) => Math.sqrt(1 - u * u);

/**
 * Hull shapes. Each `build` returns the frame size and one outline per floor,
 * from the bottom floor up.
 * - freeLength: the user chooses the length; without it the shape sets its own
 * - isRectangle: every floor is an axis-aligned rectangle
 * - isRound: every floor is a circle
 * - bow: which way the shape points on a floor plan, if it has a front
 * - defaultLength: length to use when the user hasn't chosen one
 */
const HULL_SHAPES = {
    rectangular: {
        general: 'standard',
        label: 'Rectangular',
        freeLength: true,
        isRectangle: true,
        defaultLength: (totalArea, numFloors) => calculateDefaultFloorLength(totalArea / numFloors),
        build(numFloors, totalArea, length) {
            const width = totalArea / numFloors / length;
            return {
                length,
                width,
                outlines: Array.from({ length: numFloors }, () => rectanglePolygon(0, 0, length, width))
            };
        }
    },
    wedge: {
        general: 'standard',
        label: 'Wedge',
        freeLength: true,
        isRectangle: true,
        bow: 'left',
        defaultLength(totalArea, numFloors) {
            const largest = Math.max(...shareArea(getRelativeSizes(wedgeProfile, numFloors), 1, totalArea));
            return roundDefaultLength(Math.sqrt(largest * WEDGE_DEFAULT_ASPECT));
        },
        build(numFloors, totalArea, length) {
            const sizes = getRelativeSizes(wedgeProfile, numFloors);
            const width = totalArea / (length * sizes.reduce((sum, size) => sum + size, 0));
            return {
                length,
                width,
                outlines: sizes.map(size => rectanglePolygon(length * (1 - size), 0, length * size, width))
            };
        }
    },
    cone: {
        general: 'standard',
        label: 'Cone',
        freeLength: false,
        isRound: true,
        build: (numFloors, totalArea) => buildRoundFloors(coneProfile, numFloors, totalArea)
    },
    sphere: {
        general: 'standard',
        label: 'Sphere',
        freeLength: false,
        isRound: true,
        build: (numFloors, totalArea) => buildRoundFloors(sphereProfile, numFloors, totalArea)
    },
    cylinder: {
        general: 'standard',
        label: 'Cylinder',
        freeLength: true,
        isRectangle: true,
        bow: 'left',
        defaultLength(totalArea, numFloors) {
            const largest = Math.max(...shareArea(getRelativeSizes(sphereProfile, numFloors), 1, totalArea));
            return roundDefaultLength(Math.sqrt(largest * CYLINDER_DEFAULT_ASPECT));
        },
        build(numFloors, totalArea, length) {
            const sizes = getRelativeSizes(sphereProfile, numFloors);
            const width = totalArea / (length * sizes.reduce((sum, size) => sum + size, 0));
            return {
                length,
                width,
                outlines: sizes.map(size => rectanglePolygon(0, (width * (1 - size)) / 2, length, width * size))
            };
        }
    },
    wing: {
        general: 'streamlined',
        label: 'Wing',
        freeLength: true,
        bow: 'top',
        defaultLength: (totalArea, numFloors) =>
            roundDefaultLength(Math.sqrt((totalArea / numFloors) * WING_DEFAULT_ASPECT)),
        build(numFloors, totalArea, span) {
            const meanChord = totalArea / numFloors / span;
            const sweep = Math.min(
                (span / 2) * Math.tan((WING_SWEEP_DEGREES * Math.PI) / 180),
                meanChord * WING_MAX_SWEEP_CHORDS
            );
            const stagger = numFloors > 1 ? (meanChord * WING_STAGGER_OF_CHORD) / (numFloors - 1) : 0;
            // A floor's area is span * (rear - point) - span * sweep / 2; rear is set so they total correctly
            const meanSetback = (stagger * (numFloors - 1)) / 2;
            const rear = meanChord + meanSetback + sweep / 2;
            const outlines = Array.from({ length: numFloors }, (_, i) => {
                const point = i * stagger;
                return orientPolygon([
                    [span / 2, point],
                    [span, point + sweep],
                    [span, rear],
                    [0, rear],
                    [0, point + sweep]
                ]);
            });
            return { length: span, width: rear, outlines };
        }
    },
    disk: {
        general: 'streamlined',
        label: 'Disk',
        freeLength: false,
        isRound: true,
        build: (numFloors, totalArea) => buildRoundFloors(() => 1, numFloors, totalArea)
    },
    'lifting-body': {
        general: 'streamlined',
        label: 'Lifting Body',
        freeLength: false,
        bow: 'left',
        build(numFloors, totalArea) {
            const unitArea = polygonArea(roundedRectanglePolygon(
                0, 0, LIFTING_BODY_ASPECT, 1, LIFTING_BODY_CORNER));
            const areas = shareArea(getRelativeSizes(liftingBodyProfile, numFloors), 2, totalArea);
            const widths = areas.map(area => Math.sqrt(area / unitArea));
            const largest = Math.max(...widths);
            const length = largest * LIFTING_BODY_ASPECT;
            return {
                length,
                width: largest,
                outlines: widths.map(width => roundedRectanglePolygon(
                    length / 2, largest / 2, width * LIFTING_BODY_ASPECT, width, width * LIFTING_BODY_CORNER))
            };
        }
    }
};

/**
 * Look up a shape, falling back to rectangular for shapes that have no geometry
 * @param {string} shape - Shape name ('wedge', 'lifting-body', ...)
 * @returns {string} A name found in HULL_SHAPES
 */
function resolveHullShape(shape) {
    return Object.prototype.hasOwnProperty.call(HULL_SHAPES, shape) ? shape : 'rectangular';
}

/**
 * Length a shape uses when the user hasn't chosen one
 * @returns {number|null} Null for shapes whose length is set by their area
 */
function getDefaultHullLength(shape, totalArea, numFloors) {
    const definition = HULL_SHAPES[resolveHullShape(shape)];
    return definition.freeLength ? definition.defaultLength(totalArea, numFloors) : null;
}

/**
 * Floor count that makes a shape true to its proportions, for shapes that have one
 * @returns {number|null} Floors, or null for shapes where any count looks right
 */
function getNaturalFloorCount(shape, totalTons, ceilingHeight) {
    if (shape !== 'sphere') return null;
    const radius = Math.cbrt((3 * totalTons * SQM_PER_TON) / (4 * Math.PI));
    return Math.max(1, Math.round((2 * radius) / ceilingHeight));
}

/**
 * Size of one floor as text, for floor lists and exports
 * @param {object} floor - A floor from buildFloorGeometry
 * @param {string} shape - Hull shape
 * @returns {string} "25.1 m across, 494 m²" or "28.1 × 14.1 m, 395 m²"
 */
function describeFloorSize(floor, shape) {
    const area = `${Math.round(floor.area).toLocaleString()} m²`;
    if (HULL_SHAPES[resolveHullShape(shape)].isRound) {
        return `${floor.bounds.length.toFixed(1)} m across, ${area}`;
    }
    return `${floor.bounds.length.toFixed(1)} × ${floor.bounds.width.toFixed(1)} m, ${area}`;
}

// ========================================
// Floor Geometry
// ========================================

/**
 * Inset of an axis-aligned rectangle, keeping its coordinates exact so a
 * rectangular hull's usable area matches getHullBounds()
 */
function insetRectanglePolygon(polygon, distance) {
    const { x, y, length, width } = getPolygonBounds(polygon);
    if (distance * 2 >= length || distance * 2 >= width) return [];
    return rectanglePolygon(x + distance, y + distance, length - 2 * distance, width - 2 * distance);
}

/**
 * Build the outline of every floor for a ship
 * @param {object} ship
 * @param {string} ship.shape - Hull shape; unknown shapes are rectangular
 * @param {number} ship.totalTons - Ship tonnage
 * @param {number} ship.ceilingHeight - Ceiling height in meters
 * @param {number} ship.numFloors - Number of floors
 * @param {number} ship.length - Chosen length, for shapes with a free length;
 *   the shape's default is used if this is missing
 * @param {number} ship.armorTons - Armor tonnage
 * @returns {object} { shape, length, width, totalArea, armorThickness, floors }, with
 *   each floor { floor, outline, inner, area, usableArea, perimeter, bounds, isRectangle }.
 *   floor numbers run from 1 at the bottom; inner is the outline inside the armor,
 *   and is empty if the armor leaves no usable space; bounds is the outline's box.
 */
function buildFloorGeometry({ shape, totalTons, ceilingHeight, numFloors, length, armorTons = 0 }) {
    const name = resolveHullShape(shape);
    const definition = HULL_SHAPES[name];
    const floorCount = Math.max(1, numFloors);
    const totalArea = calculateTotalFloorArea(totalTons, ceilingHeight);
    const chosenLength = definition.freeLength
        ? (length > 0 ? length : definition.defaultLength(totalArea, floorCount))
        : null;

    const frame = definition.build(floorCount, totalArea, chosenLength);
    const perimeters = frame.outlines.map(polygonPerimeter);
    const totalPerimeter = perimeters.reduce((sum, p) => sum + p, 0);

    // Armor is one even layer on the walls of every floor
    const armorThickness = calculateArmorThickness(armorTons, totalPerimeter, ceilingHeight);
    const inset = definition.isRectangle ? insetRectanglePolygon : insetConvexPolygon;

    const floors = frame.outlines.map((outline, i) => {
        const inner = inset(outline, armorThickness);
        return {
            floor: i + 1,
            outline,
            inner,
            area: polygonArea(outline),
            usableArea: polygonArea(inner),
            perimeter: perimeters[i],
            bounds: getPolygonBounds(outline),
            isRectangle: !!definition.isRectangle
        };
    });

    return { shape: name, length: frame.length, width: frame.width, totalArea, armorThickness, floors };
}

// CommonJS export for Jest (no-op in browsers where `module` is undefined)
if (typeof module !== 'undefined') {
    module.exports = {
        HULL_SHAPES,
        HULL_BAND_STEP,
        getFloorPosition,
        polygonArea,
        polygonPerimeter,
        getPolygonBounds,
        rectanglePolygon,
        circlePolygon,
        roundedRectanglePolygon,
        insetConvexPolygon,
        getPolygonWalls,
        clipPolygonToHalfPlane,
        doConvexPolygonsOverlap,
        getPolygonCentroid,
        getPolygonSpan,
        isPointInConvexPolygon,
        isRectInConvexPolygon,
        intersectConvexPolygons,
        getRectFitRegion,
        closestPointOnPolygonBoundary,
        closestPointInConvexPolygon,
        isRectOnConvexPolygonWall,
        getPolygonCrossings,
        getHullBands,
        getOutsideHullRects,
        resolveHullShape,
        getDefaultHullLength,
        getNaturalFloorCount,
        describeFloorSize,
        buildFloorGeometry
    };
}
