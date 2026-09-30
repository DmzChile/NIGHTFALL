import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as THREE from 'three';
import { addItem, biome, count, createWorld, validateState, type NodeState } from '../lib/game/model';
import { Engine } from '../lib/game/engine';
import { SaveManager, pack, unpack } from '../lib/game/storage';
import { ensureForest, isTree, nodeDefinition, nodeRadius, TREE_SIZES, treeColor, type TreeTraits } from '../lib/game/woodland';
import { TreeField, treeGeometry } from '../lib/game/trees';
import { celestialState, SkyBackdrop } from '../lib/game/sky';

const traits: TreeTraits = { size: 'normal', species: 'oak', autumn: false, variant: 0 };
function node(size: TreeTraits['size'] = 'normal', kind = 'tree'): NodeState {
    const n = { id: crypto.randomUUID(), kind, x: 0, z: 0, hp: 0, depleted: false, readyAt: 0, tree: { ...traits, size } };
    n.hp = nodeDefinition(n).hp; return n;
}
function fixture() {
    const s = createWorld('forest', 'forest-test'); s.nodes = []; s.enemies = []; s.buildings = [];
    const storage = new SaveManager(); storage.save = async () => Date.now();
    return { s, engine: new Engine(s, storage) };
}
function legacy() {
    const s = createWorld('legacy forest', 'forest-test');
    s.nodes = s.nodes.filter(n => !n.id.startsWith('forest-')); delete s.forestVersion;
    for (const n of s.nodes) if (isTree(n)) { delete n.tree; n.hp = n.kind === 'tree' ? 6 : 7; }
    return s;
}
describe('woodland generation, harvesting and storage', () => {
    it('creates a reproducible denser forest, all four sizes and colors while retaining the starter supply ring', () => {
        const a = createWorld('A', 'forest-test'), b = createWorld('B', 'forest-test');
        assert.deepEqual(a.nodes, b.nodes);
        const trees = a.nodes.filter(isTree), base = trees.filter(n => !n.id.startsWith('forest-'));
        assert.ok(trees.length > base.length * 8 && trees.length < 2000);
        assert.deepEqual(new Set(trees.map(n => n.tree!.size)), new Set(['small', 'normal', 'large', 'world']));
        assert.equal(trees.filter(n => n.tree!.size === 'world').length, 3);
        assert.equal(new Set(trees.map(n => n.tree!.species)).size, 4);
        assert.ok(trees.some(n => n.tree!.autumn));
        assert.ok(trees.every(n => n.tree!.species !== 'pine' || !n.tree!.autumn));
        assert.ok(trees.filter(n => n.id.startsWith('forest-')).every(n => Math.hypot(n.x, n.z) >= 38));
        assert.equal(a.nodes.slice(0, 28).filter(n => n.kind === 'fiber').length, 14);
        assert.deepEqual(a.nodes.slice(28, 30).map(n => n.tree!.size), ['small', 'normal']);
        assert.notDeepEqual(a.nodes, createWorld('C', 'different forest').nodes);
    });
    it('migrates remaining health proportionally, retains depleted timers, IDs and RNG, and applies density once', async () => {
        const s = legacy(), existing = s.nodes.filter(isTree);
        existing[0].hp = 3; existing[1].depleted = true; existing[1].hp = 0; existing[1].readyAt = 500;
        const before = structuredClone(s), restored = validateState(s);
        assert.deepEqual(s, before); assert.equal(restored.rng, before.rng);
        assert.equal(restored.nodes[28].hp, nodeDefinition(restored.nodes[28]).hp / 2);
        assert.deepEqual({ id: restored.nodes[29].id, hp: restored.nodes[29].hp, depleted: restored.nodes[29].depleted, readyAt: restored.nodes[29].readyAt }, { id: before.nodes[29].id, hp: 0, depleted: true, readyAt: 500 });
        const current = structuredClone(restored); ensureForest(restored, biome); assert.deepEqual(restored, current);
        const loaded = await unpack(await pack(restored)); assert.deepEqual(loaded, restored);
        const oldLoaded = await unpack(await pack(s)); assert.deepEqual(oldLoaded, current);
    });
    it('old IndexedDB checkpoints load and save the forest version without repeating additions', async () => {
        const storage = new SaveManager(), s = legacy();
        try {
            await storage.acquire(s.id); await storage.save(s);
            const loaded = await storage.load(s.id), trees = loaded.state.nodes.filter(isTree).length;
            assert.equal(loaded.state.forestVersion, 1); assert.equal(loaded.state.generation, 1);
            await storage.save(loaded.state);
            const again = await storage.load(s.id); assert.equal(again.state.generation, 2);
            assert.equal(again.state.nodes.filter(isTree).length, trees);
            assert.deepEqual(again.state.nodes, loaded.state.nodes);
        } finally { await storage.release(); storage.close(); }
    });
    it('rejects invalid size/species/flags, unsupported forest versions and impossible tree health', () => {
        const { s, engine } = fixture(); s.nodes = [node()]; engine.dispose();
        for (const invalid of [{ size: 'constructor' }, { species: 'cactus' }, { autumn: 1 }, { variant: 9 }, { species: 'pine', autumn: true }])
            assert.throws(() => validateState({ ...s, nodes: [{ ...s.nodes[0], tree: { ...traits, ...invalid } }] }), /나무/);
        assert.throws(() => validateState({ ...s, forestVersion: 2 }), /숲 버전/);
        assert.throws(() => validateState({ ...s, nodes: [{ ...s.nodes[0], hp: 999 }] }), /내구도/);
        assert.throws(() => validateState({ ...s, nodes: [{ ...s.nodes[0], kind: 'branch' }] }), /나무/);
    });
    it('increases health by size, scales axe damage by tier, and prevents under-tier harvesting', () => {
        assert.deepEqual(['small', 'normal', 'large', 'world'].map(size => nodeDefinition(node(size as TreeTraits['size'])).hp), [12, 24, 54, 180]);
        for (const [tool, damage] of [['stone_axe', 3], ['iron_axe', 5], ['steel_axe', 7], ['mithril_axe', 9]] as const) {
            const { s, engine } = fixture(), n = node(); s.nodes = [n];
            addItem(s, tool, 1); const held = s.player.items[0], durability = held.dur!; s.player.hotbar[0] = held.uid;
            engine.target = { kind: 'node', id: n.id, distance: 1 }; engine.gather();
            assert.equal(n.hp, 24 - damage); assert.equal(s.player.items[0].dur, durability - 1);
            const hp = n.hp; engine.gather(); assert.equal(n.hp, hp); engine.dispose();
        }
        for (const size of ['large', 'world'] as const) {
            const { s, engine } = fixture(), n = node(size); s.nodes = [n];
            engine.target = { kind: 'node', id: n.id, distance: 1 }; engine.gather();
            assert.equal(n.hp, nodeDefinition(n).hp); assert.equal(s.player.items.length, 0); engine.dispose();
        }
    });
    it('rejects a full-inventory felling atomically and awards the size-specific resource exactly once', () => {
        const { s, engine } = fixture(), n = node('large', 'hardtree'); n.hp = 1; s.nodes = [n];
        for (let i = 0; i < 24; i++) addItem(s, 'steel_axe', 1);
        s.player.hotbar[0] = s.player.items[0].uid; engine.target = { kind: 'node', id: n.id, distance: 1 };
        const before = structuredClone(s); engine.gather(); assert.deepEqual(s, before);
        s.player.items.pop(); engine.gather();
        assert.equal(count(s.player.items, 'hardwood'), 11); assert.equal(n.depleted, true); assert.equal(n.hp, 0);
        const after = structuredClone(s); engine.gather(); assert.deepEqual(s, after); engine.dispose();
    });
    it('regenerates full size-specific health, keeps autumn appearance and blocks the wider world-tree trunk', () => {
        const { s, engine } = fixture(), n = node('world'); n.depleted = true; n.hp = 0; n.readyAt = .01; n.tree!.autumn = true; s.nodes = [n];
        engine.resume(); engine.step(1 / 30);
        assert.equal(n.hp, 180); assert.equal(n.depleted, false); assert.equal(n.tree!.autumn, true);
        assert.ok(nodeRadius(n) > nodeRadius(node('small')) * 5);
        Object.assign(s.player, { x: 0, z: 2.2, yaw: 0 }); engine.keys.add('KeyW');
        for (let i = 0; i < 12; i++) engine.step(1 / 30);
        assert.ok(s.player.z >= nodeRadius(n) + .35); engine.dispose();
    });
});
describe('instanced tree rendering and sky background', () => {
    it('all size/species templates have bounded geometry and deciduous autumn colors differ from summer', () => {
        for (const size of ['small', 'normal', 'large', 'world'] as const) for (const species of ['pine', 'oak', 'birch', 'maple'] as const) {
            const geometry = treeGeometry({ size, species, autumn: species !== 'pine', variant: 0 });
            assert.ok(Array.from(geometry.attributes.position.array).every(Number.isFinite));
            const box = geometry.boundingBox!; assert.ok(box.min.y >= -2 && box.max.y > TREE_SIZES[size].height * .9 && box.max.y < TREE_SIZES[size].height * 1.06);
            if (size !== 'world' && species !== 'pine') assert.notEqual(treeColor({ ...traits, size, species }), treeColor({ ...traits, size, species, autumn: true }));
            geometry.dispose();
        }
    });
    it('instanced trunks resolve the correct node, disappear on depletion and reappear on regeneration', () => {
        const { s, engine } = fixture(), a = node(), b = node('small'); b.z = -8; s.nodes = [a, b];
        const field = new TreeField(); field.update(s, 0, 0, 0); field.root.updateMatrixWorld(true);
        const ray = new THREE.Raycaster(new THREE.Vector3(0, 1, 5), new THREE.Vector3(0, 0, -1), 0, 18);
        let hit = ray.intersectObject(field.root, true)[0]; assert.equal(field.target(hit)!.id, a.id);
        a.depleted = true; a.hp = 0; field.update(s, 0, 0, 0); field.root.updateMatrixWorld(true);
        hit = ray.intersectObject(field.root, true)[0]; assert.equal(field.target(hit)!.id, b.id);
        a.depleted = false; a.hp = 24; field.update(s, 0, 0, 0); field.root.updateMatrixWorld(true);
        hit = ray.intersectObject(field.root, true)[0]; assert.equal(field.target(hit)!.id, a.id);
        assert.equal([...field.batches.values()].reduce((n, b) => n + b.mesh.count, 0), 2);
        field.dispose(); engine.dispose();
    });
    it('tree reactions freeze with visual time, reset after shaking and release instance/template resources', () => {
        const { s, engine } = fixture(), n = node(); s.nodes = [n]; const before = structuredClone(s), field = new TreeField();
        field.update(s, 0, 0, 0); const batch = [...field.batches.values()][0], original = new THREE.Matrix4(), current = new THREE.Matrix4();
        batch.mesh.getMatrixAt(0, original); field.shake(n.id, 0); field.update(s, 0, 0, .05); batch.mesh.getMatrixAt(0, current);
        assert.notDeepEqual(current.elements, original.elements); const paused = current.clone();
        field.update(s, 0, 0, .05); batch.mesh.getMatrixAt(0, current); assert.deepEqual(current.elements, paused.elements);
        field.update(s, 0, 0, 1); batch.mesh.getMatrixAt(0, current); assert.deepEqual(current.elements, original.elements);
        assert.deepEqual(s, before);
        let released = 0; batch.mesh.addEventListener('dispose', () => released++); batch.mesh.geometry.addEventListener('dispose', () => released++); field.material.addEventListener('dispose', () => released++);
        field.dispose(); assert.equal(released, 3); assert.equal(field.root.children.length, 0); engine.dispose();
    });
    it('sun and moon rise in opposite directions, keep continuous day boundaries and ignore player translation', () => {
        for (const time of [0, 160, 450, 509.999, 510, 600, 690, 719.999, 720]) {
            const sky = celestialState(time); assert.ok(sky.sun.clone().add(sky.moon).length() < 1e-12);
            assert.ok(sky.daylight >= .1 && sky.daylight <= 1);
        }
        assert.ok(celestialState(160).sunVisible && !celestialState(160).moonVisible);
        assert.ok(celestialState(600).moonVisible && !celestialState(600).sunVisible);
        assert.ok(celestialState(509.999).sun.distanceTo(celestialState(510).sun) < .001);
        assert.ok(celestialState(719.999).sun.distanceTo(celestialState(720).sun) < .001);
        const sky = new SkyBackdrop(), camera = new THREE.PerspectiveCamera(72, 16 / 10); sky.update(camera, 160, false);
        const position = sky.sun.position.clone(); camera.position.set(400, 30, -300); sky.update(camera, 160, false);
        assert.deepEqual(sky.sun.position, position); assert.equal(sky.camera.position.length(), 0); assert.equal(sky.camera.aspect, 16 / 10);
        sky.update(camera, 600, true); assert.equal(sky.moon.material.color.getHex(), 0xdf897c); sky.dispose();
    });
    it('renders the sky before world depth and restores renderer state even if world rendering fails', () => {
        const sky = new SkyBackdrop(), world = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), calls: string[] = [];
        const renderer = { autoClear: false, render: (s: THREE.Scene) => { calls.push(s === sky.scene ? 'sky' : 'world'); }, clearDepth: () => { calls.push('clearDepth'); } };
        sky.render(renderer as unknown as THREE.WebGLRenderer, world, camera);
        assert.deepEqual(calls, ['sky', 'clearDepth', 'world']); assert.equal(renderer.autoClear, false);
        renderer.render = s => { if (s === world) throw new Error('context lost'); };
        assert.throws(() => sky.render(renderer as unknown as THREE.WebGLRenderer, world, camera), /context/); assert.equal(renderer.autoClear, false); sky.dispose();
    });
});
