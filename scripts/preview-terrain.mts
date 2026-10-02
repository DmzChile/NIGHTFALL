/**
 * Rebuild the data-derived review map from the same height/water queries as play.
 * Run from the repository root:
 *   node --import tsx scripts/preview-terrain.mts
 *   python scripts/render-terrain-preview.py
 * JSON is disposable output; docs/terrain-preview.png is the review artifact.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { terrainHeight, terrainWaterLevel, TERRAIN_SIZE, TERRAIN_SEGMENTS, SEA_LEVEL, type TerrainWorld } from '../lib/game/terrain';

const resolution = TERRAIN_SEGMENTS * 2 + 1;
const extent = TERRAIN_SIZE / 2;
const spacing = TERRAIN_SIZE / (resolution - 1);
const worlds: (TerrainWorld & { title: string; subtitle: string })[] = [
    { seed: 'nightfall', terrainVersion: 2, title: 'Before / existing worlds', subtitle: 'Version 2: fixed hills and coast' },
    { seed: 'nightfall', terrainVersion: 3, title: 'After / nightfall', subtitle: 'Version 3: seeded hills, river and ponds' },
    { seed: 'river-and-hills', terrainVersion: 3, title: 'After / river-and-hills', subtitle: 'Version 3: same regions, another landscape' },
    { seed: '다채로운 섬', terrainVersion: 3, title: 'After / 다채로운 섬', subtitle: 'Version 3: Korean seed example' },
];
const panels = worlds.map(world => {
    const heights: number[] = [], water: (number | null)[] = [];
    let inlandWetSamples = 0, highestPoint = -Infinity;
    for (let row = 0; row < resolution; row++) {
        const z = -extent + row * spacing;
        for (let col = 0; col < resolution; col++) {
            const x = -extent + col * spacing, ground = terrainHeight(x, z, world);
            const inland = terrainWaterLevel(x, z, world);
            heights.push(ground);
            water.push(ground < SEA_LEVEL ? SEA_LEVEL : inland);
            if (inland !== null && inland > SEA_LEVEL && ground >= SEA_LEVEL) inlandWetSamples++;
            highestPoint = Math.max(highestPoint, ground);
        }
    }
    return { ...world, heights, water, inlandWetSamples, highestPoint };
});
const output = resolve(process.argv[2] ?? 'outputs/terrain-preview.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({
    description: 'Altitude and wet-surface review map from queried terrain triangles; not an in-game screenshot.',
    resolution, extent, spacing, seaLevel: SEA_LEVEL, terrainSegments: TERRAIN_SEGMENTS, panels,
}));
console.log(`Wrote ${output} (${resolution} x ${resolution} samples per panel).`);
