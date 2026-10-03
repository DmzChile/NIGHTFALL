import * as THREE from 'three';
import { terrainGeometry } from './ThreeTerrainAdapter';
import { biomeManager } from './BiomeManager';
import { generateTerrain, generateLegacyTerrain } from './TerrainGenerator';
import { legacyColor, legacyMeshHeight, legacySlope } from './LegacyTerrain';
import { generateNaturalTerrain, terrainColor as naturalColor, terrainWaterLevel } from './NaturalTerrain';
import { TerrainSampler } from './TerrainSampler';
import { TERRAIN_SEGMENTS, type TerrainDebugMode, type TerrainType, type TerrainVersion, type TerrainWorld } from './types';

export type Foundation = { height: number; minHeight: number; maxSlope: number; relief: number };
const TYPE_COLORS: Record<TerrainType, number> = { plains: 0x79bd55, hills: 0xa5a151, mountains: 0x8796ad, valley: 0x4ba693, cliffs: 0xc15857, highlands: 0xb9b29a, lowlands: 0x496d3d, beach: 0xddca90, water: 0x426e9b };
const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Owns a finite island today. Chunk lookup can replace this sampler without leaking into gameplay. */
export class TerrainManager extends TerrainSampler {
    private readonly foundations = new Map<string, Foundation>();
    private reachable: Uint8Array | null = null;
    constructor(seed: string, version: TerrainVersion = 3, segments = TERRAIN_SEGMENTS) {
        super(version === 2 ? generateLegacyTerrain() : version === 4 ? generateNaturalTerrain(seed) : generateTerrain(seed, segments));
    }
    override getHeightAt(x: number, z: number) { return this.data.version === 2 ? legacyMeshHeight(x, z) : super.getHeightAt(x, z); }
    override getSlopeAt(x: number, z: number) { return this.data.version === 2 ? legacySlope(x, z) : super.getSlopeAt(x, z); }
    getRegionAt(x: number, z: number) { return biomeManager.getRegionAt(x, z); }
    getFoundationAt(x: number, z: number, radius = 1.1): Foundation {
        const key = `${x}/${z}/${radius}`, cached = this.foundations.get(key);
        if (cached) return cached;
        let min = this.getHeightAt(x, z), max = min, slope = this.getSlopeAt(x, z);
        for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
            const h = this.getHeightAt(x + ix * radius, z + iz * radius);
            min = Math.min(min, h); max = Math.max(max, h); slope = Math.max(slope, this.getSlopeAt(x + ix * radius, z + iz * radius));
        }
        const foundation = { height: this.data.version === 2 ? this.getHeightAt(x, z) : max, minHeight: min, maxSlope: slope, relief: max - min };
        // Building positions are reused every frame. Search-only candidates have a bounded cache.
        if (this.foundations.size >= 512) this.foundations.delete(this.foundations.keys().next().value!);
        this.foundations.set(key, foundation); return foundation;
    }
    isDryAt(x: number, z: number, radius = 0) {
        if (this.data.version !== 4) return true;
        const world = { seed: this.data.seed, terrainVersion: 4 as const };
        const dry = (px: number, pz: number) => terrainWaterLevel(px, pz, world) === null && this.getHeightAt(px, pz) > -1.15;
        if (!dry(x, z)) return false;
        for (let i = 0; radius > 0 && i < 8; i++) {
            const a = i * Math.PI / 4;
            if (!dry(x + Math.cos(a) * radius, z + Math.sin(a) * radius)) return false;
        }
        return true;
    }
    canBuildAt(x: number, z: number) {
        if (!this.isDryAt(x, z, 1.2)) return false;
        if (this.data.version === 2) return this.getSlopeAt(x, z) <= .4;
        const f = this.getFoundationAt(x, z);
        return this.isWalkable(x, z) && f.minHeight > -.7 && f.maxSlope <= .4 && f.relief <= .8;
    }
    /** Conservative walking connectivity from the starter plain, computed once per heightmap. */
    isReachableAt(x: number, z: number) {
        if (!this.isWalkable(x, z)) return false;
        if (this.data.version === 2) return true;
        const n = this.data.segments, width = n + 1, half = this.data.size / 2;
        if (!this.reachable) {
            const seen = new Uint8Array(width * width), walkable = new Uint8Array(seen.length), queue = new Uint32Array(seen.length);
            for (let iz = 0; iz < width; iz++) for (let ix = 0; ix < width; ix++) walkable[iz * width + ix] = +this.isWalkable(ix * this.step - half, iz * this.step - half);
            const origin = (n / 2) * width + n / 2; seen[origin] = 1; queue[0] = origin;
            for (let head = 0, tail = 1; head < tail; head++) {
                const id = queue[head], ix = id % width, iz = Math.floor(id / width), px = ix * this.step - half, pz = iz * this.step - half;
                for (const [dx, dz] of NEIGHBORS) {
                    const jx = ix + dx, jz = iz + dz, next = jz * width + jx;
                    if (jx < 0 || jz < 0 || jx > n || jz > n || seen[next] || !walkable[next]) continue;
                    const nx = jx * this.step - half, nz = jz * this.step - half;
                    if (!this.canTraverse(px, pz, nx, nz)) continue;
                    seen[next] = 1; queue[tail++] = next;
                }
            }
            this.reachable = seen;
        }
        const gx = (x + half) / this.step, gz = (z + half) / this.step;
        for (let iz = Math.floor(gz); iz <= Math.ceil(gz); iz++) for (let ix = Math.floor(gx); ix <= Math.ceil(gx); ix++)
            if (this.reachable[iz * width + ix] && this.canTraverse(ix * this.step - half, iz * this.step - half, x, z)) return true;
        return false;
    }
    /** Search radius is in metres; evaluate a 2.2m-wide foundation at each candidate. */
    findFlatArea(center: THREE.Vector2, radius: number, maxSlope: number): THREE.Vector3 | null {
        if (!Number.isFinite(center.x) || !Number.isFinite(center.y) || !Number.isFinite(radius) || radius < 0 || radius > 550 || !Number.isFinite(maxSlope) || maxSlope < 0) return null;
        const inspect = (x: number, z: number) => {
            const f = this.getFoundationAt(x, z);
            return this.isDryAt(x, z, 3) && this.isWalkable(x, z) && f.maxSlope <= maxSlope && f.relief <= .8 && f.minHeight > -.7 && this.isReachableAt(x, z) ? new THREE.Vector3(x, f.height, z) : null;
        };
        const atCenter = inspect(center.x, center.y); if (atCenter) return atCenter;
        for (let r = 4; r <= radius; r += 4) for (let a = 0, count = Math.ceil(2 * Math.PI * r / 4); a < count; a++) {
            const point = inspect(center.x + Math.cos(a * Math.PI * 2 / count) * r, center.y + Math.sin(a * Math.PI * 2 / count) * r);
            if (point) return point;
        }
        return null;
    }
    canSpawnResource(kind: string, x: number, z: number) {
        if (this.data.version === 2) return true;
        if (this.data.version === 4) return Math.hypot(x, z) <= 465 && this.isDryAt(x, z, kind === 'tree' || kind === 'hardtree' ? 1.5 : .7) && this.getSlopeAt(x, z) < (kind === 'tree' || kind === 'hardtree' ? .55 : 1.1);
        const height = this.getHeightAt(x, z), slope = this.getSlopeAt(x, z), type = this.getTerrainTypeAt(x, z);
        if (height < -.5 || Math.hypot(x, z) > 465) return false;
        if (kind === 'tree' || kind === 'hardtree') return height < 45 && slope < .5 && ['plains', 'hills', 'valley', 'lowlands'].includes(type);
        if (['rock', 'iron', 'coal', 'silver', 'gold', 'mithril', 'obsidian', 'sulfur', 'crystal'].includes(kind))
            return height > 5 && slope < 1.1 && ['mountains', 'hills', 'highlands', 'cliffs'].includes(type);
        return this.isWalkable(x, z) && !['cliffs', 'mountains', 'water'].includes(type);
    }
    findResourceSpot(kind: string, x: number, z: number, radius = 24) {
        const region = this.getRegionAt(x, z);
        if (this.canSpawnResource(kind, x, z)) return { x, z };
        for (let r = 6; r <= radius; r += 6) for (let a = 0; a < 8; a++) {
            const px = x + Math.cos(a * Math.PI / 4) * r, pz = z + Math.sin(a * Math.PI / 4) * r;
            if (Math.hypot(px, pz) >= 38 && this.getRegionAt(px, pz) === region && this.canSpawnResource(kind, px, pz)) return { x: px, z: pz };
        }
        return null;
    }
    findSpawnPoint(x: number, z: number, radius = 16, animal = false) {
        const valid = (px: number, pz: number) => this.data.version === 2 || this.isDryAt(px, pz, .8) && this.isWalkable(px, pz) && (!animal || ['plains', 'lowlands', 'valley', 'hills'].includes(this.getTerrainTypeAt(px, pz)));
        if (valid(x, z)) return { x, z };
        for (let r = 4; r <= radius; r += 4) for (let a = 0; a < 12; a++) {
            const px = x + Math.cos(a * Math.PI / 6) * r, pz = z + Math.sin(a * Math.PI / 6) * r;
            if (valid(px, pz)) return { x: px, z: pz };
        }
        return null;
    }
    createMesh() {
        const geometry = terrainGeometry(this.data.heights, this.data.size, this.data.segments);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
        mesh.name = `terrain/${this.data.version}/${this.data.seed}`;
        mesh.castShadow = true; mesh.receiveShadow = true;
        this.setDebugMode(mesh, 'off'); return mesh;
    }
    setDebugMode(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>, mode: TerrainDebugMode) {
        const p = mesh.geometry.getAttribute('position'), colors = new Float32Array(p.count * 3), color = new THREE.Color(), rock = new THREE.Color(), dirt = new THREE.Color();
        for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), z = p.getZ(i), h = p.getY(i), slope = this.getSlopeAt(x, z), region = this.getRegionAt(x, z);
            if (mode === 'height') color.setHSL(.62 * (1 - Math.min(1, Math.max(0, h / 110))), .7, .48);
            else if (mode === 'slope') color.setRGB(Math.min(1, slope / 1.2), Math.max(.05, 1 - slope / 1.2), .1);
            else if (mode === 'type') color.setHex(TYPE_COLORS[this.getTerrainTypeAt(x, z)]);
            else if (this.data.version === 4) color.setHex(naturalColor(x, z, region, { seed: this.data.seed, terrainVersion: 4 })).multiplyScalar(.94 + .05 * Math.sin(x * .4 + z * .35));
            else if (this.data.version === 2) color.setHex(legacyColor(x, z, region)).multiplyScalar(.94 + .05 * Math.sin(x * .4 + z * .35));
            else {
                const grass = region === '습지' ? 0x567369 : region === '숲' ? 0x6a895e : 0x899c70;
                color.setHex(grass); dirt.setHex(region === '화산' ? 0x74665a : 0x8d7b61); rock.setHex(region === '화산' ? 0x514a46 : 0x858c82);
                const weights = biomeManager.materialWeights(h, slope);
                color.multiplyScalar(weights.grass).add(dirt.multiplyScalar(weights.dirt)).add(rock.multiplyScalar(weights.rock));
                if (Math.hypot(x, z) > 420) color.lerp(dirt.setHex(0xb8ad87), Math.min(1, (Math.hypot(x, z) - 420) / 35));
                color.multiplyScalar(.94 + .04 * Math.sin(x * .09 + z * .12));
            }
            colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
        }
        mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        mesh.material.wireframe = mode === 'wireframe';
    }
    get cpuBytes() {
        const arrays = new Set([this.data.heights, this.data.plains, this.data.mountains, this.data.valleys, this.data.cliffs]);
        return [...arrays].reduce((n, a) => n + a.byteLength, 0) + this.bytes + (this.reachable?.byteLength || 0);
    }
}

const states = new WeakMap<TerrainWorld, { key: string; terrain: TerrainManager }>(), cache = new Map<string, TerrainManager>();
/** Cache CPU heightmaps, never GPU meshes. World identity and version are explicit in every lookup. */
export function getTerrain(world: TerrainWorld) {
    const version = world.terrainVersion === 4 ? 4 : world.terrainVersion === 3 ? 3 : 2, key = version === 2 ? 'legacy/2' : `${version}/${world.seed}`;
    const existing = states.get(world); if (existing?.key === key) return existing.terrain;
    let terrain = cache.get(key);
    if (!terrain) {
        terrain = new TerrainManager(world.seed, version);
        if (cache.size >= 4) cache.delete(cache.keys().next().value!);
        cache.set(key, terrain);
    }
    states.set(world, { key, terrain }); return terrain;
}
