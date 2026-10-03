import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { NodeState, State } from './model';
import { getTerrain } from './terrain';
import type { TerrainManager } from './world/TerrainManager';
import { isTree, TREE_SIZES, treeColor, treeYaw, type TreeTraits } from './woodland';
import { loadTreeTemplate, treeModelGeometry, TREE_MODEL_URLS } from './tree-models';
import type { TreeSpecies } from './woodland';

/** Merge trunk, branches and foliage into one vertex-colored template per appearance. */
export function treeGeometry(traits: TreeTraits, hard = false) {
    const profile = TREE_SIZES[traits.size], h = profile.height, r = profile.crown, parts: THREE.BufferGeometry[] = [];
    const leaf = treeColor(traits), bark = traits.species === 'birch' ? 0xd2cec0 : hard ? 0x584632 : 0x755839;
    const add = (shape: 'trunk' | 'cone' | 'leaf', color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, pitch = 0, roll = 0) => {
        const raw = shape === 'trunk' ? new THREE.CylinderGeometry(.8, 1, 1, 7) : shape === 'cone' ? new THREE.ConeGeometry(1, 1, 7) : new THREE.IcosahedronGeometry(1, 1);
        const geometry = raw.index ? raw.toNonIndexed() : raw;
        if (geometry !== raw) raw.dispose();
        geometry.deleteAttribute('uv');
        const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, 0, roll)), new THREE.Vector3(sx, sy, sz));
        geometry.applyMatrix4(matrix);
        const c = new THREE.Color(color), colors = new Float32Array(geometry.attributes.position.count * 3);
        for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); parts.push(geometry);
    };
    const trunkHeight = h * (traits.species === 'pine' ? .58 : .64);
    add('trunk', bark, 0, trunkHeight / 2, 0, profile.radius, trunkHeight, profile.radius);
    if (traits.species === 'pine') {
        for (let i = 0; i < 3; i++) add('cone', leaf + i * 0x030300, 0, h * (.46 + i * .19), 0, r * (1 - i * .2), h * .4, r * (1 - i * .2));
    } else {
        for (let i = 0; i < 3; i++) {
            const a = i * Math.PI * 2 / 3 + traits.variant * .45, x = Math.cos(a), z = Math.sin(a);
            add('trunk', bark, x * r * .35, h * .59, z * r * .35, profile.radius * .38, h * .22, profile.radius * .38, x * .65, -z * .65);
            add('leaf', leaf + (i % 2) * 0x060400, x * r * .5, h * (.7 + i * .035), z * r * .5, r * .78, h * .19, r * .78);
        }
        add('leaf', leaf, 0, h * .83, 0, r * .85, h * .17, r * .85);
    }
    if (traits.size === 'world') {
        for (let i = 0; i < 5; i++) {
            const a = i * Math.PI * 2 / 5;
            add('trunk', bark, Math.cos(a) * 1.9, .5, Math.sin(a) * 1.9, .65, 4.8, .65, Math.cos(a) * 1.25, -Math.sin(a) * 1.25);
        }
        add('leaf', 0xc7b86d, 0, h * .77, 0, r * .65, h * .17, r * .65);
    }
    const merged = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    if (!merged) throw new Error('나무 도형을 결합하지 못했습니다.');
    merged.computeBoundingBox(); merged.computeBoundingSphere();
    return merged;
}
type Batch = { mesh: THREE.InstancedMesh; nodes: NodeState[]; capacity: number };
export class TreeField {
    root = new THREE.Group();
    material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, flatShading: true });
    geometries = new Map<string, THREE.BufferGeometry>();
    batches = new Map<string, Batch>();
    hits = new WeakMap<THREE.Object3D, Batch>();
    instances = new Map<string, { batch: Batch; index: number; node: NodeState }>();
    shakes = new Map<string, number>();
    private layout = '';
    private dirty = true;
    private count = -1;
    private alive = 0;
    private matrix = new THREE.Matrix4();
    private position = new THREE.Vector3();
    private rotation = new THREE.Quaternion();
    private euler = new THREE.Euler();
    private scale = new THREE.Vector3(1, 1, 1);
    private templates = new Map<TreeSpecies, THREE.BufferGeometry>();
    private modelLoad: Promise<void> | null = null;
    private disposed = false;
    /** Loading never blocks play. Procedural trees remain until each model is ready. */
    loadModels(loader = loadTreeTemplate) {
        if (this.disposed) return Promise.resolve();
        if (this.modelLoad) return this.modelLoad;
        this.modelLoad = Promise.all((Object.keys(TREE_MODEL_URLS) as TreeSpecies[]).map(async species => {
            try {
                const template = await loader(species);
                if (this.disposed) { template.dispose(); return; }
                this.templates.set(species, template);
                this.clear();
                for (const [key, geometry] of this.geometries) if (key.split('/')[2] === species) {
                    geometry.dispose(); this.geometries.delete(key);
                }
            } catch (error) {
                if (!this.disposed) console.warn(`나무 모델 로딩 실패 (${species}): 기본 나무를 사용합니다.`, error);
            }
        })).then(() => undefined);
        return this.modelLoad;
    }
    invalidate() { this.dirty = true; }
    shake(id: string, time: number) { this.shakes.set(id, time); this.invalidate(); }
    private write(batch: Batch, index: number, n: NodeState, terrain: TerrainManager, angle = 0) {
        this.position.set(n.x, terrain.getHeightAt(n.x, n.z), n.z);
        this.rotation.setFromEuler(this.euler.set(0, treeYaw(n), angle));
        batch.mesh.setMatrixAt(index, this.matrix.compose(this.position, this.rotation, this.scale));
        batch.mesh.instanceMatrix.needsUpdate = true;
    }
    update(s: State, x: number, z: number, time: number) {
        const terrain = getTerrain(s);
        const layout = `${s.id}/${s.seed}/${s.terrainVersion ?? 1}/${Math.floor(x / 8)}/${Math.floor(z / 8)}`;
        const alive = s.nodes.reduce((signature, n, i) => isTree(n) && !n.depleted ? Math.imul(signature ^ (i + 1), 16777619) : signature, 2166136261);
        if (this.dirty || layout !== this.layout || s.nodes.length !== this.count || alive !== this.alive) {
            const groups = new Map<string, NodeState[]>(); this.instances.clear();
            for (const n of s.nodes) if (isTree(n) && n.tree && !n.depleted && Math.hypot(n.x - x, n.z - z) < 150) {
                const t = n.tree, key = `${n.kind}/${t.size}/${t.species}/${t.autumn}/${t.variant}`, group = groups.get(key) || [];
                group.push(n); groups.set(key, group);
            }
            for (const batch of this.batches.values()) { batch.mesh.count = 0; batch.nodes = []; }
            for (const [key, nodes] of groups) {
                let batch = this.batches.get(key);
                if (!batch || batch.capacity < nodes.length) {
                    if (batch) { this.root.remove(batch.mesh); batch.mesh.dispose(); }
                    let geometry = this.geometries.get(key);
                    if (!geometry) {
                        const traits = nodes[0].tree!, template = this.templates.get(traits.species);
                        geometry = template ? treeModelGeometry(template, traits, nodes[0].kind === 'hardtree') : treeGeometry(traits, nodes[0].kind === 'hardtree');
                        this.geometries.set(key, geometry);
                    }
                    const capacity = Math.max(8, 2 ** Math.ceil(Math.log2(nodes.length))), mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
                    mesh.castShadow = true; mesh.receiveShadow = true;
                    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.name = `trees/${key}`;
                    batch = { mesh, nodes, capacity }; this.batches.set(key, batch); this.hits.set(mesh, batch); this.root.add(mesh);
                }
                batch.nodes = nodes; batch.mesh.count = nodes.length;
                nodes.forEach((n, i) => { this.write(batch!, i, n, terrain); this.instances.set(n.id, { batch: batch!, index: i, node: n }); });
                batch.mesh.computeBoundingSphere();
            }
            this.layout = layout; this.count = s.nodes.length; this.alive = alive; this.dirty = false;
        }
        for (const [id, start] of this.shakes) {
            const instance = this.instances.get(id), age = Math.max(0, time - start);
            if (instance) this.write(instance.batch, instance.index, instance.node, terrain, Math.sin(age * 45) * Math.max(0, 1 - age / .22) * .02);
            if (age >= .22 || !instance) this.shakes.delete(id);
        }
    }
    target(hit: THREE.Intersection) {
        const n = hit.instanceId === undefined ? undefined : this.hits.get(hit.object)?.nodes[hit.instanceId];
        return n && !n.depleted ? { kind: 'node' as const, id: n.id, distance: hit.distance } : null;
    }
    clear() {
        for (const batch of this.batches.values()) batch.mesh.dispose();
        this.root.clear(); this.batches.clear(); this.instances.clear(); this.shakes.clear(); this.hits = new WeakMap();
        this.layout = ''; this.count = -1; this.dirty = true;
    }
    dispose() {
        this.disposed = true; this.clear();
        for (const geometry of this.geometries.values()) geometry.dispose(); this.geometries.clear();
        for (const template of this.templates.values()) template.dispose(); this.templates.clear();
        this.material.dispose();
    }
}
