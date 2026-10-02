import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as THREE from 'three';
import { Engine } from '../lib/game/engine';
import { addItem, count, createWorld, height, makeEnemy, validateState } from '../lib/game/model';
import { SaveManager, pack, unpack } from '../lib/game/storage';
import { getTerrain, TerrainManager } from '../lib/game/world/TerrainManager';
import { WALKABLE_GRADE } from '../lib/game/world/types';
import { TreeField } from '../lib/game/trees';

function fixture() {
    const s = createWorld('terrain v3', 'nightfall');
    s.nodes = []; s.enemies = []; s.buildings = []; s.time = 10;
    const storage = new SaveManager(); storage.save = async () => Date.now();
    return { s, engine: new Engine(s, storage) };
}
function steep(t: TerrainManager) {
    for (let z = -380; z < 100; z += t.step) for (let x = -300; x < 390; x += t.step)
        if (Math.hypot(x, z) < 430 && t.getSlopeAt(x, z) > 1.3) return { x, z };
    throw new Error('No steep face found');
}

describe('seeded terrain and gameplay integration', () => {
    it('reproduces heightmaps without using Math.random or advancing world randomness', () => {
        const random = Math.random;
        let a: TerrainManager;
        try { Math.random = () => { throw new Error('unseeded generation'); }; a = new TerrainManager('deterministic'); }
        finally { Math.random = random; }
        const other = new TerrainManager('other'), b = new TerrainManager('deterministic');
        assert.deepEqual(a!.data.heights, b.data.heights);
        assert.notDeepEqual(a!.data.heights, other.data.heights);
        const s = createWorld('seed', 'deterministic'), before = structuredClone(s);
        getTerrain(s).getHeightAt(100, -200); getTerrain(s).findFlatArea(new THREE.Vector2(100, -200), 40, .3);
        assert.deepEqual(s, before);
    });
    it('keeps different worlds and legacy terrain isolated when alternating queries', () => {
        const a = { seed: 'nightfall', terrainVersion: 3 as const }, b = { seed: 'forest-test', terrainVersion: 3 as const };
        const first = getTerrain(a), y = first.getHeightAt(-140, -225);
        assert.notEqual(y, getTerrain(b).getHeightAt(-140, -225));
        assert.equal(getTerrain(a), first); assert.equal(getTerrain(a).getHeightAt(-140, -225), y);
        assert.equal(getTerrain({ seed: 'A', terrainVersion: 2 }).getHeightAt(100, -200), getTerrain({ seed: 'B', terrainVersion: 2 }).getHeightAt(100, -200));
    });
    it('matches rendered triangles, their normals and the coastline at the chosen resolution', () => {
        const t = new TerrainManager('nightfall'), mesh = t.createMesh(); mesh.material.side = THREE.DoubleSide; mesh.updateMatrixWorld();
        assert.equal(mesh.geometry.attributes.position.count, 129 * 129);
        assert.equal(mesh.geometry.index!.count / 3, 32768);
        const out = new THREE.Vector3();
        for (const [x, z] of [[.8, .9], [7, 7], [-142.3, -235.8], [315.3, -37.1], [468.2, 4.9], [-479.3, 2.1]]) {
            const hit = new THREE.Raycaster(new THREE.Vector3(x, 150, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh)[0];
            assert.ok(hit); assert.ok(Math.abs(hit.point.y - t.getHeightAt(x, z)) < 1e-5);
            assert.equal(t.getNormalAt(x, z, out), out);
            const normal = hit.face!.normal;
            assert.ok(normal.dot(out) > .999999);
            assert.ok(Math.abs(Math.hypot(out.x, out.z) / out.y - t.getSlopeAt(x, z)) < 1e-6);
        }
        assert.equal(t.getHeightAt(551, 0), -2); assert.equal(t.isWalkable(NaN, 0), false);
        mesh.geometry.dispose(); mesh.material.dispose();
    });
    it('provides broad plains, ridges, valleys and limited cliffs for multiple seeds', () => {
        for (const seed of ['nightfall', 'forest-test', 'terrain']) {
            const t = new TerrainManager(seed), types = new Map<string, number>(); let samples = 0, walkable = 0, max = 0;
            for (let z = -450; z <= 450; z += 10) for (let x = -450; x <= 450; x += 10) if (Math.hypot(x, z) <= 450) {
                const kind = t.getTerrainTypeAt(x, z); types.set(kind, (types.get(kind) || 0) + 1); samples++;
                walkable += +t.isWalkable(x, z); max = Math.max(max, t.getHeightAt(x, z));
            }
            for (const kind of ['plains', 'hills', 'mountains', 'valley', 'cliffs', 'highlands', 'lowlands']) assert.ok(types.get(kind)! > 30, `${seed}/${kind}`);
            assert.ok(types.get('cliffs')! / samples < .05); assert.ok(walkable / samples > .8); assert.ok(max > 80);
            for (let x = -50; x <= 50; x += 10) for (let z = -30; z <= 30; z += 10) assert.ok(t.getSlopeAt(x, z) < .12);
            assert.equal(t.getHeightAt(500, 0), -2);
        }
    });
    it('retains reachable starter supplies, animal habitats, ancient trees and altar foundations', () => {
        for (const seed of ['nightfall', 'forest-test', 'terrain', 'terrain-seed-17', 'terrain-seed-39']) {
            const s = createWorld('spawn', seed), t = getTerrain(s);
            assert.equal(s.terrainVersion, 3); assert.ok(t.isWalkable(s.player.x, s.player.z));
            for (const n of s.nodes.slice(0, 35)) assert.ok(t.isWalkable(n.x, n.z), n.kind);
            for (const n of s.nodes.slice(35)) assert.ok(t.canSpawnResource(n.kind, n.x, n.z), n.id);
            assert.equal(s.nodes.filter(n => n.tree?.size === 'world').length, 3);
            assert.equal(s.enemies.filter(e => e.animal).length, 7);
            assert.ok(s.enemies.every(e => t.isWalkable(e.x, e.z)));
            assert.equal(s.buildings.length, 6);
            for (const b of s.buildings) { const f = t.getFoundationAt(b.x, b.z); assert.ok(t.canBuildAt(b.x, b.z)); assert.ok(f.maxSlope <= .32); assert.ok(t.isReachableAt(b.x, b.z), `${seed}/${b.kind}`); }
            for (const ore of ['iron', 'coal', 'gold', 'mithril', 'obsidian']) assert.ok(s.nodes.some(n => n.kind === ore), `${seed}/${ore}`);
        }
    });
    it('finds supported foundations and rejects steep placement without consuming inventory', () => {
        const { s, engine } = fixture(), t = engine.terrain;
        const point = t.findFlatArea(new THREE.Vector2(-20, -260), 80, .32); assert.ok(point);
        const f = t.getFoundationAt(point.x, point.z);
        assert.equal(point.y, f.height);
        for (const dx of [-1.1, 0, 1.1]) for (const dz of [-1.1, 0, 1.1]) assert.ok(point.y >= t.getHeightAt(point.x + dx, point.z + dz) - 1e-8);
        assert.equal(t.findFlatArea(new THREE.Vector2(500, 500), 10, .3), null);
        const cliff = steep(t); Object.assign(s.player, { x: cliff.x, z: cliff.z + 3, yaw: 0 });
        addItem(s, 'workbench', 1); const item = s.player.items.find(i => i.id === 'workbench')!;
        engine.place(item); assert.equal(s.buildings.length, 0); assert.equal(count(s.player.items, 'workbench'), 1);
        Object.assign(s.player, { x: 0, z: 8 }); engine.place(item);
        assert.equal(s.buildings.length, 1); assert.equal(count(s.player.items, 'workbench'), 0); engine.dispose();
    });
    it('blocks uphill wall climbing and dodge, while allowing downhill escape', () => {
        const { s, engine } = fixture(), t = engine.terrain, point = steep(t), normal = t.getNormalAt(point.x, point.z);
        const uphill = new THREE.Vector2(-normal.x, -normal.z).normalize();
        assert.equal(t.canTraverse(point.x, point.z, point.x + uphill.x * .13, point.z + uphill.y * .13), false);
        assert.equal(t.canTraverse(point.x, point.z, point.x - uphill.x * .13, point.z - uphill.y * .13), true);
        Object.assign(s.player, { x: point.x, z: point.z, yaw: Math.atan2(-uphill.x, -uphill.y) });
        engine.keys.add('KeyW'); engine.resume(); engine.step(1 / 30);
        assert.equal(s.player.x, point.x); assert.equal(s.player.z, point.z);
        engine.keys.clear(); engine.keys.add('ControlLeft'); engine.step(1 / 30);
        assert.equal(s.player.x, point.x); assert.equal(s.player.z, point.z); engine.dispose();
    });
    it('keeps jump altitude physical across changing ground and lands through existing gravity', () => {
        const { s, engine } = fixture(), p = s.player;
        Object.assign(p, { x: 105, z: 75, yaw: -Math.PI / 2, y: 1, vy: 2 });
        assert.ok(engine.terrain.getSlopeAt(p.x, p.z) < WALKABLE_GRADE);
        const initial = height(p.x, p.z, s) + p.y;
        engine.keys.add('KeyW'); engine.resume(); engine.step(1 / 30);
        assert.ok(Math.abs(height(p.x, p.z, s) + p.y - initial - 2 / 30) < 1e-8);
        engine.keys.clear(); for (let i = 0; i < 60; i++) engine.step(1 / 30);
        assert.equal(p.y, 0); assert.equal(p.vy, 0);
        engine.keys.add('Space'); engine.step(1 / 30); assert.ok(p.y > 0); assert.ok(p.vy > 0);
        engine.pause(); const before = structuredClone(s); engine.step(10); assert.deepEqual(s, before); engine.dispose();
    });
    it('matches exact ground segment contacts to mesh raycasts, including horizontal ridge crossings', () => {
        const t = new TerrainManager('nightfall'), mesh = t.createMesh(); mesh.material.side = THREE.DoubleSide; mesh.updateMatrixWorld();
        const cases: [THREE.Vector3, THREE.Vector3][] = [
            [new THREE.Vector3(-140, 30, -140), new THREE.Vector3(-140, 30, -375)],
            [new THREE.Vector3(0, 100, 0), new THREE.Vector3(0, -10, 0)],
            [new THREE.Vector3(0, 100, 0), new THREE.Vector3(100, 100, 100)],
        ];
        for (let i = 0; i < 40; i++) {
            const x = Math.sin(i * 17.4) * 380, z = Math.cos(i * 8.7) * 380;
            cases.push([new THREE.Vector3(x, t.getHeightAt(x, z) + 10 + i % 50, z), new THREE.Vector3(x + Math.sin(i * 2) * 60, -10, z + Math.cos(i * 3) * 60)]);
        }
        for (const [a, b] of cases) {
            const delta = b.clone().sub(a), hit = new THREE.Raycaster(a, delta.clone().normalize(), 0, delta.length()).intersectObject(mesh)[0];
            const contact = t.segmentHit(a, b);
            if (hit) { assert.notEqual(contact, null); assert.ok(Math.abs(contact! - hit.distance / delta.length()) < 1e-5); }
            else assert.equal(contact, null);
        }
        assert.equal(t.segmentHit(new THREE.Vector3(0, -10, 0), new THREE.Vector3(0, 10, 0)), 0);
        mesh.geometry.dispose(); mesh.material.dispose();
    });
    it('lets a ridge intercept a projectile before an actor beyond it, even when its endpoint is above ground', () => {
        const { s, engine } = fixture(), t = engine.terrain;
        const y = t.getHeightAt(-140, -420) + 1;
        const a = { x: -140, y, z: -140 }, b = { x: -140, y, z: -420 };
        assert.ok(t.getHeightAt(a.x, a.z) < a.y); assert.ok(t.getHeightAt(b.x, b.z) < b.y); assert.notEqual(t.segmentHit(a, b), null);
        const e = makeEnemy(s, 'zombie', 1, b.x, b.z); s.enemies = [e]; const hp = e.hp;
        s.projectiles.push({ id: crypto.randomUUID(), ...a, vx: 0, vy: 0, vz: (b.z - a.z) * 30, life: 2, damage: 20, enemy: false, type: 'arrow' });
        engine.resume(); engine.step(1 / 30);
        assert.equal(s.projectiles.length, 0); assert.equal(e.hp, hp); engine.dispose();
    });
    it('places instanced trees on the same seeded ground used by gameplay', () => {
        const s = createWorld('trees', 'nightfall'), tree = s.nodes.find(n => n.kind === 'tree' && n.x > 90)!; assert.ok(tree);
        s.nodes = [tree]; Object.assign(s.player, { x: tree.x, z: tree.z });
        const field = new TreeField(); field.update(s, tree.x, tree.z, s.time);
        const matrix = new THREE.Matrix4(); let checked = 0;
        field.root.traverse(o => { if (o instanceof THREE.InstancedMesh && o.count) { o.getMatrixAt(0, matrix); assert.ok(Math.abs(matrix.elements[13] - height(tree.x, tree.z, s)) < 1e-5); checked++; } });
        assert.ok(checked > 0); field.dispose();
    });
    it('keeps debug views cosmetic, preserves the heightmap and round trips only seed and terrain version', async () => {
        const { s, engine } = fixture(), t = engine.terrain, before = structuredClone(s), heights = t.data.heights.slice(), mesh = t.createMesh();
        for (const mode of ['wireframe', 'height', 'slope', 'type', 'spawn', 'off'] as const) {
            assert.equal((await engine.command('/terrain debug ' + mode)).ok, true); t.setDebugMode(mesh, mode);
            assert.equal(mesh.material.wireframe, mode === 'wireframe');
        }
        assert.equal((await engine.command('/terrain debug invalid')).ok, false);
        assert.deepEqual(s, before); assert.deepEqual(t.data.heights, heights);
        const restored = await unpack(await pack(s)); assert.deepEqual(restored, validateState(s));
        assert.equal(restored.terrainVersion, 3); assert.equal(getTerrain(restored).getHeightAt(-142, -225), t.getHeightAt(-142, -225));
        assert.equal('heights' in restored, false); assert.equal('terrainDebugMode' in restored, false);
        engine.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
    });
});
