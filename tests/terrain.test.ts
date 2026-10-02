import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as THREE from 'three';
import { addItem, count, craft, createWorld, height, makeEnemy, validateState } from '../lib/game/model';
import { RECIPES } from '../lib/game/data';
import { Engine } from '../lib/game/engine';
import { SaveManager, pack, unpack } from '../lib/game/storage';
import { legacyTerrainHeight, terrainHeight, terrainSlope, terrainVertexHeight, TERRAIN_SEGMENTS, TERRAIN_SIZE } from '../lib/game/terrain';

function fixture() {
    const s = createWorld('terrain', 'terrain');
    s.terrainVersion = 2;
    s.nodes = []; s.enemies = []; s.buildings = [];
    const storage = new SaveManager();
    storage.save = async () => Date.now();
    return { s, engine: new Engine(s, storage) };
}

describe('terrain and save compatibility', () => {
    it('starts on gentle ground, rises into hills and ridges, and slopes down to the sea', () => {
        for (let x = -25; x <= 25; x += 5)
            for (let z = -25; z <= 25; z += 5) {
                assert.ok(Math.abs(height(x, z)) < 1);
                assert.ok(terrainSlope(x, z) < .1);
            }
        assert.ok(height(-45, -120) > 12);
        assert.ok(height(-70, -240) > 25);
        assert.ok(height(315, -40) > 30);
        assert.ok(height(15, 315) > 12);
        assert.ok(height(435, 0) > height(465, 0));
        assert.ok(height(465, 0) > -1.2);
        assert.equal(height(500, 0), -2);
    });
    it('gameplay heights match both triangles of the rendered ground, including the coast', () => {
        const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
        geometry.rotateX(-Math.PI / 2);
        const p = geometry.attributes.position;
        for (let i = 0; i < p.count; i++) p.setY(i, terrainVertexHeight(p.getX(i), p.getZ(i)));
        const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), mesh = new THREE.Mesh(geometry, material);
        mesh.updateMatrixWorld();
        for (const [x, z] of [[.7, .8], [4.7, 4.8], [-44.2, -119.1], [-67.7, -242.2], [311.2, -40.7], [465.3, 7.1], [481.1, 2.3]]) {
            const ray = new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
            const hit = ray.intersectObject(mesh)[0];
            assert.ok(hit);
            assert.ok(Math.abs(hit.point.y - terrainHeight(x, z)) < 1e-5);
            assert.equal(height(x, z), terrainHeight(x, z));
        }
        geometry.dispose(); material.dispose();
    });
    it('rejects steep building placement along either axis without consuming the item', () => {
        for (const [x, z] of [[260, -40], [315, 15]]) {
            const { s, engine } = fixture();
            assert.ok(terrainSlope(x, z) > .4);
            Object.assign(s.player, { x, z: z + 3, yaw: 0 });
            addItem(s, 'workbench', 1);
            engine.place(s.player.items.find(i => i.id === 'workbench')!);
            assert.equal(s.buildings.length, 0);
            assert.equal(count(s.player.items, 'workbench'), 1);
            engine.dispose();
        }
        const { s, engine } = fixture();
        addItem(s, 'workbench', 1);
        engine.place(s.player.items.find(i => i.id === 'workbench')!);
        assert.equal(s.buildings.length, 1);
        assert.equal(count(s.player.items, 'workbench'), 0);
        engine.dispose();
    });
    it('migrates old saves once, preserving entity identity, inventory, jobs and relative projectile height', () => {
        for (const version of [undefined, 1] as const) {
            const s = createWorld('legacy', 'legacy');
            if (version === undefined) delete s.terrainVersion; else s.terrainVersion = version;
            addItem(s, 'iron_ore', 4);
            s.buildings.push({ id: crypto.randomUUID(), kind: 'furnace', x: -70, z: -240, yaw: 0, hp: 200, items: [], jobs: [], fuel: 20 });
            Object.assign(s.player, { x: -70, z: -238 });
            assert.equal(craft(s, RECIPES.find(r => r.id === 'iron')!), null);
            s.player.y = .9; s.player.vy = -2;
            s.projectiles.push({ id: crypto.randomUUID(), x: -70, z: -240, y: legacyTerrainHeight(-70, -240) + 1.6, vx: 0, vy: 2, vz: 10, life: 3, damage: 8, enemy: false, type: 'arrow' });
            const before = structuredClone(s), restored = validateState(s);
            assert.deepEqual(s, before);
            assert.equal(restored.terrainVersion, 2);
            assert.ok(Math.abs(restored.projectiles[0].y - height(-70, -240) - 1.6) < 1e-10);
            const expected = structuredClone(before);
            expected.terrainVersion = 2;
            expected.projectiles[0].y = restored.projectiles[0].y;
            assert.deepEqual(restored, expected);
            assert.deepEqual(validateState(restored), restored);
        }
    });
    it('old backup checksum is verified before migration, then current backups round trip unchanged', async () => {
        const s = createWorld('backup', 'terrain-backup');
        delete s.terrainVersion;
        s.projectiles.push({ id: crypto.randomUUID(), x: 315, z: -40, y: legacyTerrainHeight(315, -40) + 2, vx: 1, vy: 0, vz: 0, life: 2, damage: 1, enemy: false, type: 'arrow' });
        const envelope = await pack(s), loaded = await unpack(envelope);
        assert.equal(envelope.state.terrainVersion, undefined);
        assert.equal(loaded.terrainVersion, 2);
        assert.ok(Math.abs(loaded.projectiles[0].y - height(315, -40) - 2) < 1e-10);
        assert.deepEqual(await unpack(await pack(loaded)), loaded);
        envelope.state.projectiles[0].y++;
        await assert.rejects(() => unpack(envelope), /체크섬/);
    });
    it('engine entry migrates directly supplied legacy states and leaves current states unchanged', () => {
        const s = createWorld('direct', 'direct'); delete s.terrainVersion;
        const e = new Engine(s, new SaveManager());
        assert.equal(s.terrainVersion, 2);
        const before = structuredClone(s), second = new Engine(s, new SaveManager());
        assert.deepEqual(s, before);
        e.dispose(); second.dispose();
        for (const value of [4, '2', null]) {
            assert.throws(() => validateState({ ...s, terrainVersion: value }), /지형 버전/);
        }
    });
    it('ranged enemies aim at uphill and downhill player height, including jumping', () => {
        for (const [ex, px] of [[255, 267], [267, 255]]) {
            const { s, engine } = fixture();
            Object.assign(s.player, { x: px, z: -40, y: 1.5 });
            const enemy = makeEnemy(s, 'archer', 2, ex, -40);
            enemy.state = 'windup'; enemy.timer = 0; s.enemies = [enemy];
            engine.resume(); engine.step(1 / 30);
            const q = s.projectiles[0]; assert.ok(q);
            const originY = height(ex, -40) + 1.3;
            const targetY = height(px, -40) + s.player.y + 1;
            const seconds = (px - ex) / q.vx;
            assert.ok(Math.abs(originY + q.vy * seconds - targetY) < 1e-8);
            assert.ok(Math.abs(Math.hypot(q.vx, q.vy, q.vz) - 10) < 1e-8);
            engine.dispose();
        }
    });
    it('walking uphill changes ground height while pause and relative jump height remain consistent', () => {
        const { s, engine } = fixture();
        Object.assign(s.player, { x: 245, z: -40, yaw: -Math.PI / 2 });
        const initial = height(s.player.x, s.player.z);
        engine.keys.add('KeyW'); engine.resume();
        for (let i = 0; i < 60; i++) engine.step(1 / 30);
        assert.ok(height(s.player.x, s.player.z) > initial + 2);
        assert.equal(s.player.y, 0);
        engine.pause(); const before = structuredClone(s);
        engine.step(100);
        assert.deepEqual(s, before);
        engine.dispose();
    });
});
