import { simplexLayer, smoothLayer } from './ThreeTerrainAdapter';
import { terrainVertexHeight, LEGACY_TERRAIN_SEGMENTS } from './LegacyTerrain';
import { TERRAIN_SIZE, TERRAIN_SEGMENTS, smoothstep, terrainSeed, type TerrainData } from './types';

/** Five independently seeded scales, followed by geographic shaping and selective smoothing. */
export function generateTerrain(seed: string, segments = TERRAIN_SEGMENTS): TerrainData {
    if (![64, 128, 256].includes(segments)) throw new Error('Unsupported terrain resolution');
    const size = TERRAIN_SIZE, width = segments + 1, count = width * width, step = size / segments;
    const layer = (name: string, frequency: number) => simplexLayer(`${seed}/terrain/3/${name}`, segments, frequency);
    const continental = layer('continental', 2.4), hills = layer('hills', 7), ridges = layer('ridges', 15), local = layer('local', 29), detail = layer('detail', 65);
    const heights = new Float32Array(count), plains = new Float32Array(count), mountains = new Float32Array(count), valleys = new Float32Array(count), cliffs = new Float32Array(count);
    const offset = (terrainSeed(seed + '/range') / 4294967296 - .5) * 36;
    for (let iz = 0; iz < width; iz++) for (let ix = 0; ix < width; ix++) {
        const i = iz * width + ix, x = ix * step - size / 2, z = iz * step - size / 2;
        const plain = 1 - smoothstep(.4, 1.15, Math.hypot(x / 205, (z + 5) / 145));
        const ridgeLine = -230 + offset + Math.sin(x * .009) * 27 + continental[i] * 15;
        const along = smoothstep(-320, -220, x) * (1 - smoothstep(170, 280, x));
        const first = Math.exp(-(((z - ridgeLine) / 50) ** 2)), second = Math.exp(-(((z - ridgeLine + 120) / 43) ** 2));
        const mountain = Math.max(first, second * .88) * along;
        const valley = Math.exp(-(((z - ridgeLine + 60) / 33) ** 2)) * along;
        const plateauRadius = Math.hypot((x - 302) / 88, (z + 25) / 120);
        const plateau = 1 - smoothstep(.63, 1.15, plateauRadius);
        // A short, eastern escarpment occupies only one plateau edge; the other sides form ramps.
        const cliff = smoothstep(300, 320, x) * (1 - smoothstep(.7, .84, plateauRadius)) * (1 - smoothstep(50, 95, Math.abs(z + 25)));
        const ruinHighland = (1 - smoothstep(.4, 1.25, Math.hypot(x / 145, (z - 295) / 105))) * 19;
        const lowland = (1 - smoothstep(.25, 1.3, Math.hypot((x + 280) / 125, z / 185)));
        const ridgeShape = .58 + .42 * (1 - Math.abs(ridges[i])) ** 2;
        let height = (9 + continental[i] * 12 + hills[i] * 9) * (1 - plain * .94);
        const pass = .3 + .7 * smoothstep(28, 130, Math.abs(x - 45 - offset));
        height += mountain * (20 + 75 * ridgeShape) * pass - valley * 24 + plateau * 24 + cliff * 18 + ruinHighland;
        height = height * (1 - lowland * .75) + lowland * 1.6;
        height += local[i] * (1 - plain) * 1.8 + detail[i] * (.16 + (1 - plain) * .55);
        heights[i] = Math.max(.05, height); plains[i] = plain; mountains[i] = mountain; valleys[i] = valley; cliffs[i] = cliff;
    }
    const filtered = smoothLayer(heights, segments);
    for (let i = 0; i < count; i++) {
        const preserve = Math.max(mountains[i] * .85, cliffs[i]);
        heights[i] += (filtered[i] - heights[i]) * (1 - preserve) * .8;
    }
    // Protect the full starter crafting ring and smoothly connect the island to the original sea level.
    for (let iz = 0; iz < width; iz++) for (let ix = 0; ix < width; ix++) {
        const i = iz * width + ix, x = ix * step - size / 2, z = iz * step - size / 2, r = Math.hypot(x, z);
        const starter = .24 * Math.sin(x * .025) * Math.cos(z * .018) + .1 * Math.sin(z * .052 + x * .023);
        const inner = smoothstep(48, 88, r);
        heights[i] = starter * (1 - inner) + heights[i] * inner;
        const beach = smoothstep(410, 480, r), coast = .15 - smoothstep(450, 485, r) * 2.15;
        heights[i] = r >= 485 ? -2 : heights[i] * (1 - beach) + coast * beach;
    }
    return { seed, version: 3, size, segments, heights, plains, mountains, valleys, cliffs };
}

export function generateLegacyTerrain(): TerrainData {
    const segments = LEGACY_TERRAIN_SEGMENTS, size = TERRAIN_SIZE, width = segments + 1;
    const heights = new Float64Array(width * width), zero = new Float32Array(width * width);
    for (let z = 0; z < width; z++) for (let x = 0; x < width; x++) heights[z * width + x] = terrainVertexHeight(x * size / segments - size / 2, z * size / segments - size / 2);
    return { seed: '', version: 2, size, segments, heights, plains: zero, mountains: zero, valleys: zero, cliffs: zero };
}
