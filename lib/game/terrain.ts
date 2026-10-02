import type { State } from './model';
import { getTerrain } from './world/TerrainManager';
import { legacyMeshHeight, legacySlope, legacyTerrainHeight, legacyColor } from './world/LegacyTerrain';
export { TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_VERSION, LEGACY_TERRAIN_VERSION } from './world/types';
export { legacyTerrainHeight, terrainVertexHeight } from './world/LegacyTerrain';
export { getTerrain } from './world/TerrainManager';

/** Pass the world explicitly. The omitted-world path is only the immutable version-2 compatibility API. */
export function terrainHeight(x: number, z: number, world?: State) { return world ? getTerrain(world).getHeightAt(x, z) : legacyMeshHeight(x, z); }
export function terrainSlope(x: number, z: number, world?: State) { return world ? getTerrain(world).getSlopeAt(x, z) : legacySlope(x, z); }
export const terrainColor = legacyColor;

/** Preserve existing islands; migrate only the original version-1 projectile coordinates to version 2. */
export function migrateTerrain(s: State) {
    if (s.terrainVersion === 2 || s.terrainVersion === 3) return;
    for (const q of s.projectiles) q.y += legacyMeshHeight(q.x, q.z) - legacyTerrainHeight(q.x, q.z);
    s.terrainVersion = 2;
}
