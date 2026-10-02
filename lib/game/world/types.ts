export const TERRAIN_SIZE = 1100;
export const TERRAIN_SEGMENTS = 128;
export const TERRAIN_VERSION = 3;
export const LEGACY_TERRAIN_VERSION = 2;
export const SEA_LEVEL = -1.2;
export const WALKABLE_GRADE = .85; // rise / run, about 40 degrees
export type TerrainVersion = 2 | 3;
export type TerrainType = 'plains' | 'hills' | 'mountains' | 'valley' | 'cliffs' | 'highlands' | 'lowlands' | 'beach' | 'water';
export type TerrainDebugMode = 'off' | 'wireframe' | 'height' | 'slope' | 'type' | 'spawn';
export const TERRAIN_DEBUG_MODES: readonly TerrainDebugMode[] = ['off', 'wireframe', 'height', 'slope', 'type', 'spawn'];
export type HeightArray = Float32Array | Float64Array;
export type TerrainData = {
    seed: string;
    version: TerrainVersion;
    size: number;
    segments: number;
    heights: HeightArray;
    plains: Float32Array;
    mountains: Float32Array;
    valleys: Float32Array;
    cliffs: Float32Array;
};
export type TerrainWorld = { seed: string; terrainVersion?: 1 | 2 | 3 };
export const smoothstep = (a: number, b: number, value: number) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
};
export function terrainSeed(value: string) {
    let h = 2166136261;
    for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0 || 1;
}
