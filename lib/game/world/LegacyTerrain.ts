// Version 2 is immutable: old saves keep their exact terrain and projectile migration.
export const LEGACY_TERRAIN_SEGMENTS = 200;
const SIZE = 1100, STEP = SIZE / LEGACY_TERRAIN_SEGMENTS, HALF = SIZE / 2;
const smooth = (a: number, b: number, value: number) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
};
const mound = (x: number, z: number, cx: number, cz: number, radius: number, amplitude: number) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (radius * radius)) * amplitude;
export function legacyTerrainHeight(x: number, z: number) {
    return .7 * Math.sin(x * .025) * Math.cos(z * .018) + .3 * Math.sin(z * .052 + x * .023) + Math.max(0, Math.hypot(x, z) - 80) * .012;
}
export function terrainVertexHeight(x: number, z: number) {
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
export function legacyMeshHeight(x: number, z: number) {
    const gx = (x + HALF) / STEP, gz = (z + HALF) / STEP;
    const x0 = Math.floor(gx) * STEP - HALF, z0 = Math.floor(gz) * STEP - HALF;
    const u = gx - Math.floor(gx), v = gz - Math.floor(gz);
    const a = terrainVertexHeight(x0, z0), b = terrainVertexHeight(x0 + STEP, z0), c = terrainVertexHeight(x0, z0 + STEP), d = terrainVertexHeight(x0 + STEP, z0 + STEP);
    return u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d);
}
export function legacySlope(x: number, z: number) {
    return Math.hypot((legacyMeshHeight(x + 1, z) - legacyMeshHeight(x - 1, z)) / 2, (legacyMeshHeight(x, z + 1) - legacyMeshHeight(x, z - 1)) / 2);
}
export function legacyColor(x: number, z: number, region: string) {
    const r = Math.hypot(x, z), elevation = terrainVertexHeight(x, z);
    if (r > 430) return 0xb8ad87;
    if (region === '화산') return elevation > 28 ? 0x514a46 : 0x74665a;
    if (region === '바위 언덕') return elevation > 17 ? 0x90988a : 0x7c8975;
    if (region === '유적') return elevation > 9 ? 0x888a70 : 0x758365;
    if (region === '습지') return 0x567369;
    return region === '숲' ? 0x6a895e : elevation > 6 ? 0x8b9d6b : 0x899c70;
}
