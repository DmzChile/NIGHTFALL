import * as THREE from 'three';
import { biome, hash, height, type Building, type NodeState } from './model';

export const TERRAIN_SIZE = 1100;
export const TERRAIN_SEGMENTS = 100;
export const GRASS_CAPACITY = 6000;
const CELL = 8, FILL_RADIUS = 48, TUFTS_PER_CELL = 48;
const ROCKS = new Set(['rock', 'iron', 'coal', 'silver', 'gold', 'mithril', 'obsidian', 'sulfur', 'crystal']);
type Obstacle = { x: number; z: number; radius: number };
export type GrassTuft = { x: number; y: number; z: number; yaw: number; width: number; size: number; color: number };

/** Match the two triangles in the visible terrain grid instead of floating above it. */
export function terrainSurfaceHeight(x: number, z: number) {
    const step = TERRAIN_SIZE / TERRAIN_SEGMENTS, half = TERRAIN_SIZE / 2;
    const gx = (x + half) / step, gz = (z + half) / step;
    const x0 = Math.floor(gx) * step - half, z0 = Math.floor(gz) * step - half;
    const u = gx - Math.floor(gx), v = gz - Math.floor(gz);
    const sample = (px: number, pz: number) => Math.hypot(px, pz) > 480 ? -2 : height(px, pz);
    const a = sample(x0, z0), b = sample(x0 + step, z0), c = sample(x0, z0 + step), d = sample(x0 + step, z0 + step);
    return u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d);
}

function noise(seed: number, x: number, z: number, i: number, salt: number) {
    let n = seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(z, 0x85ebca77) ^ Math.imul(i + salt, 0xc2b2ae3d);
    n = Math.imul(n ^ n >>> 16, 0x7feb352d);
    n = Math.imul(n ^ n >>> 15, 0x846ca68b);
    return ((n ^ n >>> 16) >>> 0) / 4294967296;
}

export function grassAt(seed: number, cellX: number, cellZ: number, index: number): GrassTuft | null {
    const x = cellX * CELL + noise(seed, cellX, cellZ, index, 1) * CELL;
    const z = cellZ * CELL + noise(seed, cellX, cellZ, index, 2) * CELL, region = biome(x, z);
    if (Math.hypot(x, z) >= 440 || !['초원', '숲', '습지'].includes(region)) return null;
    const palette = region === '숲' ? [0x5f823c, 0x6b9144, 0x547739] : region === '습지' ? [0x648756, 0x769660, 0x597b4c] : [0x7ba24b, 0x8bb055, 0x6f9543];
    return { x, z, y: terrainSurfaceHeight(x, z), yaw: noise(seed, cellX, cellZ, index, 3) * Math.PI * 2,
        width: .75 + noise(seed, cellX, cellZ, index, 4) * .65,
        size: (.6 + noise(seed, cellX, cellZ, index, 5) * .65) * (region === '습지' ? 1.25 : 1),
        color: palette[Math.floor(noise(seed, cellX, cellZ, index, 6) * palette.length)] };
}

function grassGeometry() {
    const geometry = new THREE.BufferGeometry(), positions: number[] = [], colors: number[] = [], indices: number[] = [];
    for (let blade = 0; blade < 3; blade++) {
        const angle = blade * Math.PI / 3, c = Math.cos(angle), s = Math.sin(angle), base = positions.length / 3;
        const points = [[-.08, 0, 0], [.08, 0, 0], [-.07, .22, .025], [.07, .22, .025], [-.018, .44, .07], [.018, .44, .07]];
        for (const [x, y, z] of points) {
            positions.push(x * c + z * s, y, -x * s + z * c);
            const shade = .62 + y / .44 * .38; colors.push(shade, shade, shade);
        }
        for (const i of [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]) indices.push(base + i);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return geometry;
}

/** Cosmetic vegetation owns no gameplay data, colliders or seeded-world random calls. */
export class GrassField {
    readonly geometry = grassGeometry();
    readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1 });
    readonly mesh: THREE.InstancedMesh;
    readonly windTime = { value: 0 };
    private dummy = new THREE.Object3D();
    private color = new THREE.Color();
    private cellX = Infinity;
    private cellZ = Infinity;
    private seed = '';
    private signature = '';
    private lastCheck = -Infinity;
    private dirty = true;
    private buildingCount = -1;
    constructor(readonly capacity = GRASS_CAPACITY) {
        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
        this.mesh.name = 'decorative-grass'; this.mesh.count = 0; this.mesh.frustumCulled = false;
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.material.onBeforeCompile = shader => {
            shader.uniforms.grassTime = this.windTime;
            shader.vertexShader = 'uniform float grassTime;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
                #include <begin_vertex>
                #ifdef USE_INSTANCING
                    vec2 grassWorld = instanceMatrix[3].xz;
                    float tip = clamp(position.y / 0.44, 0.0, 1.0);
                    float breeze = sin(grassTime * 1.7 + grassWorld.x * 0.23 + grassWorld.y * 0.19);
                    transformed.x += breeze * tip * tip * 0.07;
                    transformed.z += cos(grassTime * 1.3 + grassWorld.x * 0.17) * tip * tip * 0.035;
                    float visibility = 1.0 - smoothstep(34.0, 44.0, distance(cameraPosition.xz, grassWorld));
                    transformed *= visibility;
                #endif
            `);
        };
        this.material.customProgramCacheKey = () => 'nightfall-grass-v1';
    }
    invalidate() { this.dirty = true; }
    update(seed: string, x: number, z: number, buildings: Building[], nodes: NodeState[], time: number) {
        this.windTime.value = time;
        const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
        const moved = cx !== this.cellX || cz !== this.cellZ || seed !== this.seed;
        if (!moved && !this.dirty && buildings.length === this.buildingCount && time - this.lastCheck < .25) return;
        this.lastCheck = time;
        const originX = cx * CELL + CELL / 2, originZ = cz * CELL + CELL / 2;
        const nearby = (p: { x: number; z: number }) => Math.hypot(p.x - originX, p.z - originZ) < FILL_RADIUS + CELL;
        const obstacles: Obstacle[] = [];
        for (const b of buildings) if (nearby(b)) obstacles.push({ x: b.x, z: b.z, radius: ['wall', 'door'].includes(b.kind) ? 1.8 : b.kind === 'trap' ? .7 : 1.3 });
        for (const n of nodes) if (!n.depleted && nearby(n) && (n.kind.includes('tree') || ROCKS.has(n.kind)))
            obstacles.push({ x: n.x, z: n.z, radius: n.kind.includes('tree') ? .7 : 1.35 });
        const signature = obstacles.map(p => `${p.x},${p.z},${p.radius}`).join(';');
        this.buildingCount = buildings.length;
        if (!moved && !this.dirty && signature === this.signature) return;
        this.seed = seed; this.cellX = cx; this.cellZ = cz; this.signature = signature; this.dirty = false;
        const bins = new Map<string, Obstacle[]>();
        for (const p of obstacles) {
            const key = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`, bin = bins.get(key) || [];
            bin.push(p); bins.set(key, bin);
        }
        const blocked = (p: GrassTuft, bx: number, bz: number) => {
            for (let ix = bx - 1; ix <= bx + 1; ix++) for (let iz = bz - 1; iz <= bz + 1; iz++)
                for (const o of bins.get(`${ix},${iz}`) || []) if (Math.hypot(p.x - o.x, p.z - o.z) < o.radius) return true;
            return false;
        };
        let count = 0;
        const seedNumber = hash(seed);
        outer: for (let ix = cx - 6; ix <= cx + 6; ix++) for (let iz = cz - 6; iz <= cz + 6; iz++) for (let i = 0; i < TUFTS_PER_CELL; i++) {
            const tuft = grassAt(seedNumber, ix, iz, i);
            if (!tuft || Math.hypot(tuft.x - originX, tuft.z - originZ) > FILL_RADIUS || blocked(tuft, ix, iz)) continue;
            if (count >= this.capacity) break outer;
            this.dummy.position.set(tuft.x, tuft.y, tuft.z); this.dummy.rotation.set(0, tuft.yaw, 0); this.dummy.scale.set(tuft.width, tuft.size, tuft.width);
            this.dummy.updateMatrix(); this.mesh.setMatrixAt(count, this.dummy.matrix); this.mesh.setColorAt(count, this.color.setHex(tuft.color)); count++;
        }
        this.mesh.count = count; this.mesh.instanceMatrix.needsUpdate = true;
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    clear() { this.mesh.count = 0; this.seed = ''; this.cellX = Infinity; this.cellZ = Infinity; this.lastCheck = -Infinity; this.dirty = true; }
    dispose() { this.clear(); this.geometry.dispose(); this.material.dispose(); this.mesh.dispose(); }
}
