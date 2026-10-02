import { SEA_LEVEL, terrainHeight, terrainWaterLevel, type TerrainWorld } from './terrain';

/** Check the footprint as well as its center so banks stay free of half-submerged objects. */
export function isDryLand(x: number, z: number, world: TerrainWorld, radius = 0) {
    // Existing worlds retain their placement and spawning rules.
    if (world.terrainVersion !== 3) return true;
    const dry = (px: number, pz: number) => terrainWaterLevel(px, pz, world) === null
        && terrainHeight(px, pz, world) > SEA_LEVEL + .05;
    if (!dry(x, z)) return false;
    if (radius > 0) for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        if (!dry(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius)) return false;
    }
    return true;
}

/** Rivers and ponds use the same wet triangles as the view; the coastal fishing rule is retained. */
export function nearFishingWater(x: number, z: number, world: TerrainWorld) {
    if (Math.hypot(x, z) >= 420) return true;
    if (world.terrainVersion !== 3) return false;
    if (terrainWaterLevel(x, z, world) !== null) return true;
    for (const radius of [3, 6, 9]) for (let i = 0; i < 16; i++) {
        const angle = i * Math.PI / 8;
        if (terrainWaterLevel(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius, world) !== null) return true;
    }
    return false;
}
