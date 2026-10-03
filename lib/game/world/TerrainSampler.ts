import { Vector3 } from 'three';
import { biomeManager } from './BiomeManager';
import { WALKABLE_GRADE, type TerrainData, type TerrainType } from './types';

/** O(1) triangle interpolation. Its diagonal matches PlaneGeometry, not bilinear interpolation. */
export class TerrainSampler {
    readonly step: number;
    private readonly dx: Float32Array;
    private readonly dz: Float32Array;
    private readonly slopes: Float32Array;
    constructor(readonly data: TerrainData) {
        this.step = data.size / data.segments;
        const count = data.segments ** 2 * 2;
        this.dx = new Float32Array(count); this.dz = new Float32Array(count); this.slopes = new Float32Array(count);
        const n = data.segments, width = n + 1, h = data.heights;
        for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
            const i = z * width + x, t = (z * n + x) * 2;
            this.dx[t] = (h[i + 1] - h[i]) / this.step; this.dz[t] = (h[i + width] - h[i]) / this.step;
            this.dx[t + 1] = (h[i + width + 1] - h[i + width]) / this.step; this.dz[t + 1] = (h[i + width + 1] - h[i + 1]) / this.step;
            this.slopes[t] = Math.hypot(this.dx[t], this.dz[t]); this.slopes[t + 1] = Math.hypot(this.dx[t + 1], this.dz[t + 1]);
        }
    }
    private contains(x: number, z: number) { return Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) <= this.data.size / 2 && Math.abs(z) <= this.data.size / 2; }
    private triangle(x: number, z: number) {
        const n = this.data.segments, gx = (x + this.data.size / 2) / this.step, gz = (z + this.data.size / 2) / this.step;
        const ix = Math.min(n - 1, Math.floor(gx)), iz = Math.min(n - 1, Math.floor(gz));
        return (iz * n + ix) * 2 + (gx - ix + gz - iz > 1 ? 1 : 0);
    }
    getHeightAt(x: number, z: number) {
        if (!this.contains(x, z)) return -2;
        return this.sample(this.data.heights, x, z);
    }
    private sample(values: ArrayLike<number>, x: number, z: number) {
        const n = this.data.segments, gx = (x + this.data.size / 2) / this.step, gz = (z + this.data.size / 2) / this.step;
        const ix = Math.min(n - 1, Math.floor(gx)), iz = Math.min(n - 1, Math.floor(gz)), u = gx - ix, v = gz - iz, i = iz * (n + 1) + ix;
        const a = values[i], b = values[i + 1], c = values[i + n + 1], d = values[i + n + 2];
        return u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d);
    }
    getNormalAt(x: number, z: number, out = new Vector3()) {
        if (!this.contains(x, z)) return out.set(0, 1, 0);
        const i = this.triangle(x, z);
        return out.set(-this.dx[i], 1, -this.dz[i]).normalize();
    }
    /** Slope is rise/run. Use atan(slope) for a slope angle in radians. */
    getSlopeAt(x: number, z: number) { return this.contains(x, z) ? this.slopes[this.triangle(x, z)] : 0; }
    getTerrainTypeAt(x: number, z: number): TerrainType {
        if (!this.contains(x, z)) return 'water';
        return biomeManager.getTerrainTypeAt(x, z, this.getHeightAt(x, z), this.getSlopeAt(x, z), this.sample(this.data.plains, x, z), this.sample(this.data.mountains, x, z), this.sample(this.data.valleys, x, z), this.sample(this.data.cliffs, x, z));
    }
    isWalkable(x: number, z: number) { return Math.hypot(x, z) <= 465 && this.getHeightAt(x, z) >= -.8 && this.getSlopeAt(x, z) < WALKABLE_GRADE; }
    /** Earliest segment/ground contact, traversing only crossed grid triangles (no mesh raycast). */
    segmentHit(start: { x: number; y: number; z: number }, end: { x: number; y: number; z: number }): number | null {
        if (!this.contains(start.x, start.z) || !this.contains(end.x, end.z) || !Number.isFinite(start.y) || !Number.isFinite(end.y)) return null;
        const gx = (start.x + this.data.size / 2) / this.step, gz = (start.z + this.data.size / 2) / this.step;
        const vx = end.x - start.x, vy = end.y - start.y, vz = end.z - start.z, dx = vx / this.step, dz = vz / this.step;
        const nextX = dx > 0 ? Math.floor(gx) + 1 : Math.ceil(gx) - 1, nextZ = dz > 0 ? Math.floor(gz) + 1 : Math.ceil(gz) - 1;
        let tx = dx === 0 ? Infinity : (nextX - gx) / dx, tz = dz === 0 ? Infinity : (nextZ - gz) / dz;
        const stepX = dx === 0 ? Infinity : 1 / Math.abs(dx), stepZ = dz === 0 ? Infinity : 1 / Math.abs(dz);
        let t = 0, clearance = start.y - this.getHeightAt(start.x, start.z);
        if (clearance <= 0) return 0;
        // Within each face, both ray height and ground height are linear in t.
        for (let cells = 0; t < 1 && cells <= this.data.segments * 2 + 2; cells++) {
            const boundary = Math.min(1, tx, tz), middle = (t + boundary) / 2;
            const ix = Math.floor(gx + dx * middle), iz = Math.floor(gz + dz * middle);
            const diagonal = dx + dz === 0 ? Infinity : (ix + iz + 1 - gx - gz) / (dx + dz);
            if (diagonal > t + 1e-10 && diagonal < boundary - 1e-10) {
                const c = start.y + vy * diagonal - this.getHeightAt(start.x + vx * diagonal, start.z + vz * diagonal);
                if (c <= 0) return t + (diagonal - t) * clearance / (clearance - c);
                t = diagonal; clearance = c;
            }
            const c = start.y + vy * boundary - this.getHeightAt(start.x + vx * boundary, start.z + vz * boundary);
            if (c <= 0) return t + (boundary - t) * clearance / (clearance - c);
            t = boundary; clearance = c;
            if (tx <= boundary + 1e-10) tx += stepX;
            if (tz <= boundary + 1e-10) tz += stepZ;
        }
        return null;
    }
    /** Probe the swept path as well as its endpoint, so dodge cannot jump across a cliff cell. */
    canTraverse(x0: number, z0: number, x1: number, z1: number) {
        if (!this.contains(x0, z0) || !this.contains(x1, z1)) return false;
        const distance = Math.hypot(x1 - x0, z1 - z0), steps = Math.max(1, Math.ceil(distance / .4));
        let previous = this.getHeightAt(x0, z0);
        for (let i = 1; i <= steps; i++) {
            const x = x0 + (x1 - x0) * i / steps, z = z0 + (z1 - z0) * i / steps, height = this.getHeightAt(x, z);
            if (height < -.8 || Math.hypot(x, z) > 465) return false;
            // Downhill/tangential movement can escape a steep face; upward wall climbing is blocked.
            if (height > previous + .001 && this.getSlopeAt(x, z) >= WALKABLE_GRADE) return false;
            previous = height;
        }
        return true;
    }
    get bytes() { return this.dx.byteLength + this.dz.byteLength + this.slopes.byteLength; }
}
