import type { State } from './model';

export const TERRAIN_SIZE = 1100;
export const TERRAIN_SEGMENTS = 200;
export const TERRAIN_VERSION = 3;
export const SEA_LEVEL = -1.2;
export const WATER_DEPTH_EPSILON = .02;
export type TerrainWorld = { seed: string; terrainVersion?: 1 | 2 | 3 };
const STEP = TERRAIN_SIZE / TERRAIN_SEGMENTS, HALF = TERRAIN_SIZE / 2;
const smooth = (a: number, b: number, value: number) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
};
const mound = (x: number, z: number, cx: number, cz: number, radius: number, amplitude: number) =>
    Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (radius * radius)) * amplitude;

export function legacyTerrainHeight(x: number, z: number) {
    return .7 * Math.sin(x * .025) * Math.cos(z * .018) + .3 * Math.sin(z * .052 + x * .023) + Math.max(0, Math.hypot(x, z) - 80) * .012;
}

/** Broad hills and ridges, with a calm starting area and a gradual sandy shoreline. */
function previousVertexHeight(x: number, z: number) {
    const r = Math.hypot(x, z);
    if (r >= 485) return -2;
    const detail = .6 * Math.sin(x * .025) * Math.cos(z * .018) + .2 * Math.sin(z * .052 + x * .023);
    const hills = mound(x, z, -45, -120, 65, 13) + mound(x, z, 100, 30, 75, 11) + mound(x, z, -135, 115, 80, 14);
    const ridge = mound(x, z, -70, -240, 85, 28) + mound(x, z, 70, -300, 70, 22);
    const volcano = mound(x, z, 315, -40, 78, 42) - mound(x, z, 315, -40, 20, 9);
    const ruins = mound(x, z, 15, 315, 115, 14), marsh = mound(x, z, -270, 0, 120, 2);
    const inland = detail + smooth(40, 85, r) * (hills + ridge + volcano + ruins + marsh);
    const beach = smooth(415, 480, r);
    return inland * (1 - beach) + (.15 - smooth(452, 485, r) * 2.15) * beach;
}

/** Integer lattice value noise: all octave/feature choices depend only on the world seed. */
function seedHash(seed: string) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
    return h >>> 0;
}

function lattice(x: number, z: number, seed: number) {
    let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 2147483647.5 - 1;
}

function noise(x: number, z: number, seed: number) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    // Quintic interpolation keeps octave joins smooth, including negative coordinates.
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const a = lattice(ix, iz, seed), b = lattice(ix + 1, iz, seed);
    const c = lattice(ix, iz + 1, seed), d = lattice(ix + 1, iz + 1, seed);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

function octave(x: number, z: number, scale: number, seed: number) {
    return (noise(x / scale, z / scale, seed) + .5 * noise(x * 2 / scale, z * 2 / scale, seed + 1013)
        + .25 * noise(x * 4 / scale, z * 4 / scale, seed + 2027)) / 1.75;
}

function envelopes(x: number, z: number) {
    const ruins = smooth(215, 275, z);
    const volcano = smooth(205, 265, x) * (1 - ruins);
    const marsh = (1 - smooth(-235, -175, x)) * (1 - ruins) * (1 - volcano);
    const rock = (1 - smooth(-275, -160, z)) * (1 - ruins) * (1 - volcano) * (1 - marsh);
    const forest = smooth(70, 120, Math.max(Math.abs(x), Math.abs(z) * .9));
    return { ruins, volcano, marsh, rock, forest };
}

const LANDMARKS = [[28, 28], [-65, 70], [120, 130], [-20, -260], [0, 300], [60, 370]] as const;
const WORLD_TREE_CLEARINGS = [[-140, -120], [150, 140], [-120, 215]] as const;
type RiverPoint = { x: number; z: number; level: number; width: number };
type Pond = { x: number; z: number; rx: number; rz: number; level: number };
type NaturalGrid = {
    seed: number;
    heights: Float64Array;
    water: Float64Array;
    landmarks: number[];
    river: RiverPoint[];
    ponds: Pond[];
};
// A few open/recent worlds are retained, without growing with saves or coordinate queries.
const naturalGrids = new Map<string, NaturalGrid>();
const MAX_CACHED_WORLDS = 4;
const GRID_COUNT = (TERRAIN_SEGMENTS + 1) ** 2;

function naturalBase(x: number, z: number, seed: number) {
    const r = Math.hypot(x, z);
    if (r >= 485) return -2;
    const wx = x + noise(x / 180, z / 180, seed + 31) * 19;
    const wz = z + noise(x / 180, z / 180, seed + 79) * 19;
    const b = envelopes(x, z), broad = octave(wx, wz, 155, seed);
    const ridge = 1 - Math.abs(octave(wx, wz, 95, seed + 307));
    const rolling = 2.2 + (broad + 1) * 2.8 + ridge * ridge * 3.5;
    const hills = rolling * (1 - b.marsh * .84 - b.ruins * .35);
    const mountainRidge = 1 - Math.abs(octave(wx, wz, 145, seed + 601));
    const mountain = b.rock * (mound(x, z, -70, -245, 100, 19) + mound(x, z, 75, -315, 85, 16)
        + mountainRidge ** 3 * 10 + broad * 3);
    const volcano = b.volcano * (mound(x, z, 315, -40, 78, 40) - mound(x, z, 315, -40, 20, 8))
        * (1 + octave(wx, wz, 130, seed + 809) * .12);
    const ruins = b.ruins * (mound(x, z, 15, 315, 115, 11) + broad * 1.6);
    const calm = smooth(72, 118, r);
    const generated = .18 + octave(x, z, 85, seed + 211) * .16
        + hills + mountain + volcano + ruins + octave(wx, wz, 40, seed + 409) * .65;
    const inland = previousVertexHeight(x, z) * (1 - calm) + generated * calm;
    const beach = smooth(412, 480, r);
    return inland * (1 - beach) + (.15 - smooth(452, 485, r) * 2.15) * beach;
}

function naturalGrid(world: TerrainWorld): NaturalGrid {
    let grid = naturalGrids.get(world.seed);
    if (grid) return grid;
    const seed = seedHash(world.seed), pick = (i: number) => (lattice(i, 17, seed + 1709) + 1) / 2;
    grid = {
        seed, heights: new Float64Array(GRID_COUNT).fill(NaN), water: new Float64Array(GRID_COUNT).fill(NaN),
        landmarks: LANDMARKS.map(([x, z]) => naturalBase(x, z, seed)), river: [], ponds: [],
    };
    const mouth = -25 + pick(1) * 60, head = -190 + pick(2) * 20, phase = pick(3) * Math.PI * 2;
    const sourceLevel = 3.2 + pick(4) * 1.4, width = 9 + pick(5) * 4;
    for (let i = 0; i <= 48; i++) {
        const t = i / 48, x = -490 + t * 390;
        let z = mouth + (head - mouth) * t + Math.sin(t * Math.PI * 2 + phase) * Math.sin(t * Math.PI) * 22
            + Math.sin(t * Math.PI * 4) * 6;
        // Route south of the ancient-tree clearing instead of breaking the river with a dry mask.
        z -= Math.max(0, z + 180) * (1 - smooth(35, 90, Math.abs(x + 140)));
        grid.river.push({
            x, z,
            level: SEA_LEVEL + smooth(0, .94, t) * (sourceLevel - SEA_LEVEL),
            width: width * (.9 + .12 * Math.sin(t * Math.PI * 3 + phase)),
        });
    }
    // Small wetlands/forest pools leave the volcano, highlands and southern ruins dry.
    for (const [i, x, z] of [[0, -280, 105], [1, -320, -180], [2, -125, 180], [3, 155, -100]]) {
        const px = x + (pick(i * 7 + 10) - .5) * 35, pz = z + (pick(i * 7 + 11) - .5) * 35;
        grid.ponds.push({ x: px, z: pz, rx: 16 + pick(i * 7 + 12) * 10, rz: 13 + pick(i * 7 + 13) * 10,
            level: naturalBase(px, pz, seed) - .35 });
    }
    if (naturalGrids.size >= MAX_CACHED_WORLDS) naturalGrids.delete(naturalGrids.keys().next().value!);
    naturalGrids.set(world.seed, grid);
    return grid;
}

function naturalSample(x: number, z: number, grid: NaturalGrid) {
    const r = Math.hypot(x, z);
    let height = naturalBase(x, z, grid.seed);
    if (r >= 485) return { height, water: height - .08 };
    let protection = smooth(80, 110, r);
    for (let i = 0; i < LANDMARKS.length; i++) {
        const [lx, lz] = LANDMARKS[i], d = Math.hypot(x - lx, z - lz);
        if (Math.hypot(lx, lz) > 72) height += (grid.landmarks[i] - height) * (1 - smooth(10, 42, d)) * smooth(72, 85, r);
        protection *= smooth(22, 38, d);
    }
    for (const [tx, tz] of WORLD_TREE_CLEARINGS) protection *= smooth(20, 34, Math.hypot(x - tx, z - tz));
    const candidates: { level: number; weight: number }[] = [];
    if (protection > 0 && x < -75 && x > -515) {
        let distance = Infinity, level = SEA_LEVEL, width = 10, along = 0;
        for (let i = 1; i < grid.river.length; i++) {
            const a = grid.river[i - 1], b = grid.river[i], dx = b.x - a.x, dz = b.z - a.z;
            const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
            const d = Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
            if (d < distance) {
                distance = d; level = a.level + (b.level - a.level) * t;
                width = a.width + (b.width - a.width) * t; along = (i - 1 + t) / 48;
            }
        }
        const q = distance / width;
        const valley = (1 - smooth(.8, 3.4, q)) * protection;
        // A broad, gentle valley contains a shallow stream rather than a deep cut.
        const bed = level - .88 + smooth(.1, 1.5, q) * 1.5;
        height += (Math.min(height, bed) - height) * valley;
        const weight = (1 - smooth(.83, 1.18, q)) * protection;
        if (weight > 0) candidates.push({ level: along < .03 ? SEA_LEVEL : level, weight });
    }
    if (protection > 0) for (const pond of grid.ponds) {
        const q = Math.hypot((x - pond.x) / pond.rx, (z - pond.z) / pond.rz);
        if (q >= 1.9) continue;
        const valley = (1 - smooth(.7, 1.9, q)) * protection;
        const bed = pond.level - .88 + smooth(.15, 1.25, q) * 1.35;
        height += (bed - height) * valley;
        const weight = (1 - smooth(.8, 1.17, q)) * protection;
        if (weight > 0) candidates.push({ level: pond.level, weight });
    }
    let water = height - .08;
    for (const candidate of candidates) water = Math.max(water, height - .08 + (candidate.level - height + .08) * candidate.weight);
    // Swimming is absent: every rendered wet triangle remains shallow enough to wade.
    height = Math.max(height, water - 1.05);
    return { height, water };
}

function naturalVertex(x: number, z: number, grid: NaturalGrid) {
    const gx = (x + HALF) / STEP, gz = (z + HALF) / STEP, ix = Math.round(gx), iz = Math.round(gz);
    if (ix < 0 || iz < 0 || ix > TERRAIN_SEGMENTS || iz > TERRAIN_SEGMENTS || Math.abs(gx - ix) > 1e-7 || Math.abs(gz - iz) > 1e-7)
        return naturalSample(x, z, grid);
    const index = iz * (TERRAIN_SEGMENTS + 1) + ix;
    if (Number.isNaN(grid.heights[index])) {
        const sample = naturalSample(x, z, grid);
        grid.heights[index] = sample.height; grid.water[index] = sample.water;
    }
    return { height: grid.heights[index], water: grid.water[index] };
}

/** Version 2 remains the default for callers without a world and for existing saves. */
export function terrainVertexHeight(x: number, z: number, world?: TerrainWorld) {
    return world?.terrainVersion === 3 ? naturalVertex(x, z, naturalGrid(world)).height : previousVertexHeight(x, z);
}

function interpolate(x: number, z: number, vertex: (x: number, z: number) => number) {
    const gx = (x + HALF) / STEP, gz = (z + HALF) / STEP;
    const x0 = Math.floor(gx) * STEP - HALF, z0 = Math.floor(gz) * STEP - HALF;
    const u = gx - Math.floor(gx), v = gz - Math.floor(gz);
    const a = vertex(x0, z0), b = vertex(x0 + STEP, z0), c = vertex(x0, z0 + STEP), d = vertex(x0 + STEP, z0 + STEP);
    return u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d);
}

/** Gameplay and object placement use the same triangles that are drawn on screen. */
export function terrainHeight(x: number, z: number, world?: TerrainWorld) {
    const grid = world?.terrainVersion === 3 ? naturalGrid(world) : null;
    return interpolate(x, z, grid ? (vx, vz) => naturalVertex(vx, vz, grid).height : previousVertexHeight);
}

export function terrainSlope(x: number, z: number, world?: TerrainWorld) {
    return Math.hypot((terrainHeight(x + 1, z, world) - terrainHeight(x - 1, z, world)) / 2,
        (terrainHeight(x, z + 1, world) - terrainHeight(x, z - 1, world)) / 2);
}

/** Candidate water surface, including dry banks. Clip rendered triangles at depth > WATER_DEPTH_EPSILON. */
export function terrainWaterVertexLevel(x: number, z: number, world?: TerrainWorld): number | null {
    return world?.terrainVersion === 3 ? naturalVertex(x, z, naturalGrid(world)).water : null;
}

/** Actual inland water uses precisely the renderer's interpolated, clipped triangles. */
export function terrainWaterLevel(x: number, z: number, world?: TerrainWorld): number | null {
    if (world?.terrainVersion !== 3) return null;
    const grid = naturalGrid(world), level = interpolate(x, z, (vx, vz) => naturalVertex(vx, vz, grid).water);
    const ground = interpolate(x, z, (vx, vz) => naturalVertex(vx, vz, grid).height);
    return level - ground > WATER_DEPTH_EPSILON ? level : null;
}

/** Existing entities store X/Z and relative jump height; only projectiles have absolute Y. */
export function migrateTerrain(s: State) {
    if (s.terrainVersion === 2 || s.terrainVersion === 3) return;
    for (const q of s.projectiles) q.y += terrainHeight(q.x, q.z) - legacyTerrainHeight(q.x, q.z);
    s.terrainVersion = 2;
}

export function terrainColor(x: number, z: number, region: string, world?: TerrainWorld) {
    const r = Math.hypot(x, z), elevation = terrainVertexHeight(x, z, world);
    if (r > 430) return 0xb8ad87;
    if (world?.terrainVersion === 3) {
        const b = envelopes(x, z);
        const mix = (a: number, c: number, t: number) => {
            const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((c >> shift) & 255) * t);
            return (channel(16) << 16) | (channel(8) << 8) | channel(0);
        };
        let color = mix(elevation > 6 ? 0x8b9d6b : 0x899c70, 0x6a895e, b.forest);
        color = mix(color, 0x567369, b.marsh);
        color = mix(color, elevation > 17 ? 0x90988a : 0x7c8975, b.rock);
        color = mix(color, elevation > 28 ? 0x514a46 : 0x74665a, b.volcano);
        color = mix(color, elevation > 9 ? 0x888a70 : 0x758365, b.ruins);
        const water = terrainWaterVertexLevel(x, z, world)!;
        return mix(color, b.marsh > .5 ? 0x627568 : 0x899276, smooth(-.12, .3, water - elevation) * .55);
    }
    if (region === '화산') return elevation > 28 ? 0x514a46 : 0x74665a;
    if (region === '바위 언덕') return elevation > 17 ? 0x90988a : 0x7c8975;
    if (region === '유적') return elevation > 9 ? 0x888a70 : 0x758365;
    if (region === '습지') return 0x567369;
    return region === '숲' ? 0x6a895e : elevation > 6 ? 0x8b9d6b : 0x899c70;
}
