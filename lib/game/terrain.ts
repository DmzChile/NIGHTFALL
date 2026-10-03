import type { State } from './model';
import type { TerrainWorld } from './world/types';
import { getTerrain } from './world/TerrainManager';
import { legacyMeshHeight, legacySlope, legacyTerrainHeight, terrainVertexHeight as legacyVertexHeight } from './world/LegacyTerrain';
import { terrainColor as naturalColor, terrainVertexHeight as naturalVertexHeight } from './world/NaturalTerrain';
export { TERRAIN_SIZE, TERRAIN_VERSION, DEFAULT_TERRAIN_VERSION, LEGACY_TERRAIN_VERSION, SEA_LEVEL } from './world/types';
export { NATURAL_TERRAIN_SEGMENTS as TERRAIN_SEGMENTS, WATER_DEPTH_EPSILON, terrainWaterVertexLevel, terrainWaterLevel } from './world/NaturalTerrain';
export { legacyTerrainHeight } from './world/LegacyTerrain';
export { getTerrain } from './world/TerrainManager';
export type { TerrainWorld, NewTerrainVersion } from './world/types';
/** Omitted world remains the immutable version-2 compatibility API. */
export function terrainHeight(x: number, z: number, world?: TerrainWorld) { return world ? getTerrain(world).getHeightAt(x, z) : legacyMeshHeight(x, z); }
export function terrainSlope(x: number, z: number, world?: TerrainWorld) { return world ? getTerrain(world).getSlopeAt(x, z) : legacySlope(x, z); }
export function terrainVertexHeight(x: number, z: number, world?: TerrainWorld) {
    return world?.terrainVersion === 4 ? naturalVertexHeight(x, z, world) : world?.terrainVersion === 3 ? getTerrain(world).getHeightAt(x, z) : legacyVertexHeight(x, z);
}
export function terrainColor(x: number, z: number, region: string, world?: TerrainWorld) { return naturalColor(x, z, region, world); }
/** Never move released version-2/3 saves onto the new rivers and ponds. */
export function migrateTerrain(s: State) {
    if (s.terrainVersion === 2 || s.terrainVersion === 3 || s.terrainVersion === 4) return;
    for (const q of s.projectiles) q.y += legacyMeshHeight(q.x, q.z) - legacyTerrainHeight(q.x, q.z);
    s.terrainVersion = 2;
}
