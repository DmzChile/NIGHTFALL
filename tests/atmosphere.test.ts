import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as THREE from 'three';
import { MONSTERS } from '../lib/game/data';
import { createWorld, height, makeEnemy, validateState } from '../lib/game/model';
import { Engine } from '../lib/game/engine';
import { SaveManager, pack, unpack } from '../lib/game/storage';
import { detectionRadius, ensureAwareness } from '../lib/game/awareness';
import { CloudLayer, CLOUD_COUNT, CLOUD_LOBES, fogDensity } from '../lib/game/atmosphere';
import { celestialState, SkyBackdrop } from '../lib/game/sky';

function fixture(kind = 'zombie', x = 70, animal = false) {
    const s = createWorld('awareness', 'awareness');
    s.nodes = []; s.buildings = []; s.enemies = []; s.time = 100;
    Object.assign(s.player, { x: 0, z: 0 });
    const e = makeEnemy(s, kind, MONSTERS[kind].min, x, 0, animal); e.night = 0; s.enemies.push(e);
    const storage = new SaveManager(); storage.save = async () => Date.now();
    const engine = new Engine(s, storage); engine.resume();
    return { s, e, engine };
}
function advance(engine: Engine, seconds: number) {
    for (let i = 0; i < Math.round(seconds * 30); i++) engine.step(1 / 30);
}
const hostiles = Object.entries(MONSTERS).filter(([, d]) => d.damage > 0);

describe('enemy detection, escape and save continuity', () => {
    it('all hostile species wait outside their radius without attacks, movement or loot RNG changes', () => {
        for (const [kind, d] of hostiles.filter(([, d]) => !d.boss)) {
            const { s, e, engine } = fixture(kind, d.detectRadius + .01), rng = s.rng, loot = structuredClone(e.loot);
            advance(engine, 1);
            assert.equal(e.alerted, false, kind); assert.equal(e.x, d.detectRadius + .01);
            assert.equal(s.player.hp, 100); assert.equal(s.projectiles.length, 0);
            assert.equal(s.rng, rng); assert.deepEqual(e.loot, loot); engine.dispose();
        }
    });
    it('the exact boundary acquires every hostile species, including bosses', () => {
        for (const [kind, d] of hostiles) {
            const { e, engine } = fixture(kind, d.detectRadius);
            engine.step(1 / 30); assert.equal(e.alerted, true, kind); assert.ok(e.x < d.detectRadius, kind); engine.dispose();
        }
    });
    it('night waves detect the entire spawn ring while regional and challenge foes retain species radii', () => {
        for (const [kind, d] of hostiles.filter(([, d]) => !d.boss)) {
            const { e, engine } = fixture(kind, 45); e.night = 1;
            assert.equal(detectionRadius(e), 46); engine.step(1 / 30); assert.equal(e.alerted, true);
            e.region = '숲'; assert.equal(detectionRadius(e), d.detectRadius);
            delete e.region; e.owner = 'challenge'; assert.equal(detectionRadius(e), d.detectRadius); engine.dispose();
        }
    });
    it('an acquired melee enemy still winds up, damages the player and recovers', () => {
        const { s, e, engine } = fixture('zombie', 1.9);
        engine.step(1 / 30); assert.equal(e.state, 'windup'); advance(engine, .7);
        assert.ok(s.player.hp < 100); assert.equal(e.state, 'recover'); engine.dispose();
    });
    it('a wizard cannot cast or summon before detection and resumes its existing skills after acquisition', () => {
        const { s, e, engine } = fixture('wizard', 39);
        advance(engine, 2); assert.equal(s.enemies.length, 1); assert.equal(s.projectiles.length, 0);
        e.x = 18; engine.step(1 / 30);
        assert.ok(e.alerted); assert.equal(s.enemies.filter(x => x.owner === e.id).length, 1);
        e.x = 13; advance(engine, 1);
        assert.ok(s.projectiles.some(p => p.enemy)); engine.dispose();
    });
    it('uses a wider pursuit boundary, resets escape time on return, and reacquires after disengagement', () => {
        const { e, engine } = fixture('zombie', 28);
        engine.step(1 / 30); e.x = 38; advance(engine, 1); assert.equal(e.lostFor, 0); assert.ok(e.alerted);
        e.x = 80; advance(engine, 1); assert.ok(e.lostFor! > .9);
        e.x = 35; engine.step(1 / 30); assert.equal(e.lostFor, 0); assert.ok(e.alerted);
        e.x = 80; advance(engine, 3); assert.equal(e.alerted, false); assert.equal(e.lostFor, 0);
        const stopped = e.x; advance(engine, .5); assert.equal(e.x, stopped); assert.equal(e.timer, 0);
        e.x = 28; engine.step(1 / 30); assert.ok(e.alerted); engine.dispose();
    });
    it('forgets beyond the simulation range and cancels a pending attack instead of freezing aggro', () => {
        const { s, e, engine } = fixture('archer', 200);
        Object.assign(e, { alerted: true, state: 'windup', timer: .01 });
        advance(engine, 3); assert.equal(e.alerted, false); assert.equal(e.state, 'chase');
        assert.equal(e.timer, 0); assert.equal(s.projectiles.length, 0); engine.dispose();
    });
    it('retaliates against direct damage or debuffs outside detection, but zero hits and DoT do not renew aggro', () => {
        const { e, engine } = fixture('zombie', 70);
        engine.hitEnemy(e, 0, 'hand'); assert.equal(e.alerted, false);
        engine.hitEnemy(e, 1, 'arrow'); assert.ok(e.alerted); engine.step(1 / 30); assert.ok(e.x < 70);
        e.lostFor = 2; engine.hitEnemy(e, 1, 'dot'); assert.equal(e.lostFor, 2);
        e.alerted = false; e.lostFor = 0; engine.hitEnemy(e, 0, 'poison_arrow'); assert.ok(e.alerted);
        e.lostFor = 2; engine.hitEnemy(e, 0, 'frost_staff'); assert.equal(e.lostFor, 0); engine.dispose();
    });
    it('a pain projectile alerts its target and preserves the vulnerability effect without direct damage', () => {
        const { s, e, engine } = fixture('zombie', 50), hp = e.hp;
        s.projectiles.push({ id: crypto.randomUUID(), x: 48, y: height(50, 0, s) + 1, z: 0, vx: 10, vy: 0, vz: 0, life: 1, damage: 0, enemy: false, type: 'pain' });
        advance(engine, .3); assert.equal(e.hp, hp); assert.ok(e.alerted); assert.ok(e.vulnerable! > s.time); engine.dispose();
    });
    it('animals still wander and flee, without acquiring or attacking the player', () => {
        const { s, e, engine } = fixture('cow', 5, true);
        advance(engine, .1); assert.notEqual(e.x, 5); assert.equal(detectionRadius(e), 0);
        const before = Math.hypot(e.x, e.z); engine.hitEnemy(e, 1, 'hand'); advance(engine, .1);
        assert.ok(Math.hypot(e.x, e.z) > before); assert.equal(e.alerted, false); assert.equal(s.player.hp, 100); engine.dispose();
    });
    it('cleans orphan summons and ends boss encounters even after a teleport beyond 130m', () => {
        const { s, e, engine } = fixture('zombie', 200); e.summon = true; e.owner = 'missing-owner';
        engine.step(1 / 30); assert.equal(s.enemies.length, 0); engine.dispose();
        const boss = fixture('forest_boss', 200); boss.engine.step(1 / 30);
        assert.equal(boss.s.enemies.length, 0); assert.ok(boss.engine.notices.some(n => n.text.includes('벗어'))); boss.engine.dispose();
    });
    it('saving and resuming retains partial escape time and the current attack stage', async () => {
        const { s, e, engine } = fixture('zombie', 80);
        Object.assign(e, { alerted: true, lostFor: 2.5, state: 'recover', timer: .8 });
        const before = structuredClone(s), loaded = await unpack(await pack(s));
        assert.deepEqual(loaded, before); assert.deepEqual(s, before); engine.dispose();
        const restored = new Engine(loaded, new SaveManager()); restored.resume(); advance(restored, .4);
        assert.ok(loaded.enemies[0].alerted); advance(restored, .2);
        assert.equal(loaded.enemies[0].alerted, false); assert.equal(loaded.enemies[0].timer, 0); restored.dispose();
    });
    it('legacy active enemies and planned waves migrate once without altering source, loot, IDs or RNG', async () => {
        const { s, e, engine } = fixture('zombie', 1.9); engine.dispose();
        delete e.alerted; delete e.lostFor; e.state = 'windup'; e.timer = .4;
        const planned = makeEnemy(s, 'archer', 2, 0, 0); delete planned.alerted; delete planned.lostFor; s.nightPlan = [planned];
        const before = structuredClone(s), loaded = await unpack(await pack(s));
        assert.deepEqual(s, before); assert.equal(loaded.rng, before.rng); assert.equal(loaded.enemies[0].id, e.id);
        assert.equal(loaded.enemies[0].state, 'windup'); assert.equal(loaded.enemies[0].timer, .4);
        assert.ok(loaded.enemies[0].alerted && loaded.nightPlan[0].alerted);
        assert.deepEqual(loaded.enemies[0].loot, e.loot);
        const once = structuredClone(loaded); ensureAwareness(loaded); assert.deepEqual(loaded, once);
    });
    it('rejects malformed detection state in active enemies and pending waves', () => {
        const { s, e, engine } = fixture(); engine.dispose();
        for (const field of ['enemies', 'nightPlan']) for (const invalid of [{ alerted: 1 }, { lostFor: -1 }, { lostFor: 4 }, { lostFor: NaN }, { alerted: false, lostFor: 1 }, { animal: true, alerted: true }])
            assert.throws(() => validateState({ ...s, enemies: [], nightPlan: [], [field]: [{ ...e, ...invalid }] }), /식별/);
    });
    it('IndexedDB checkpoints preserve inactive foes and pending wave awareness', async () => {
        const { s, e, engine } = fixture(); engine.dispose();
        s.nightPlan = [makeEnemy(s, 'zombie', 1, 0, 0)]; const storage = new SaveManager();
        try {
            await storage.acquire(s.id); await storage.save(s);
            const loaded = await storage.load(s.id);
            assert.equal(loaded.state.enemies[0].alerted, false); assert.equal(loaded.state.nightPlan[0].alerted, false);
            assert.equal(loaded.state.enemies[0].id, e.id); assert.equal(loaded.state.rng, s.rng);
        } finally { await storage.release(); storage.close(); }
    });
    it('pausing freezes both escape time and hostile movement', () => {
        const { s, e, engine } = fixture(); e.alerted = true; e.lostFor = 1;
        engine.paused = true; const before = structuredClone(s); advance(engine, 4);
        assert.deepEqual(s, before); engine.dispose();
    });
});

describe('fog and bounded cloud background', () => {
    it('fog thickens at dawn/night and in swamps, thins on highlands, and keeps nearby combat readable', () => {
        const density = (t: number, region = '초원', altitude = 0) => fogDensity(t, celestialState(t).daylight, region, altitude);
        assert.ok(density(0) > density(200)); assert.ok(density(600) > density(200));
        assert.ok(density(200, '습지') > density(200)); assert.ok(density(200, '초원', 100) < density(200));
        for (let t = 0; t <= 720; t += 5) for (const region of ['초원', '습지']) {
            const d = density(t, region); assert.ok(1 - Math.exp(-Math.pow(d * 30, 2)) < .2);
            assert.ok(1 - Math.exp(-Math.pow(d * 180, 2)) > .6);
        }
        assert.ok(Math.abs(density(719.999) - density(720)) < .00001);
        assert.ok(Math.abs(density(509.999) - density(510)) < .00001);
    });
    it('cloud instances remain finite above the horizon and nearer than celestial bodies at all sampled times', () => {
        const clouds = new CloudLayer(), matrix = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), scale = new THREE.Vector3();
        assert.equal(clouds.mesh.count, CLOUD_COUNT * CLOUD_LOBES); assert.ok(clouds.geometry.attributes.position.count < 100);
        for (const t of [0, 160, 510, 720, 1440, 100000]) {
            clouds.update(t, celestialState(t).daylight);
            for (let i = 0; i < clouds.mesh.count; i++) {
                clouds.mesh.getMatrixAt(i, matrix); assert.ok(matrix.elements.every(Number.isFinite));
                matrix.decompose(p, q, scale); assert.ok(p.y - scale.y > 20); assert.ok(p.length() + Math.max(scale.x, scale.y, scale.z) < 180);
            }
        }
        clouds.dispose();
    });
    it('clouds move with simulation time, freeze on pause, and continue across the day boundary', () => {
        const clouds = new CloudLayer(); clouds.update(719.999, 1);
        const before = Array.from(clouds.mesh.instanceMatrix.array), version = clouds.mesh.instanceMatrix.version;
        clouds.update(719.999, 1); assert.deepEqual(Array.from(clouds.mesh.instanceMatrix.array), before);
        assert.equal(clouds.mesh.instanceMatrix.version, version);
        clouds.update(720, 1);
        assert.ok(Array.from(clouds.mesh.instanceMatrix.array).every((v, i) => Math.abs(v - before[i]) < .001));
        clouds.update(900, .1); assert.notDeepEqual(Array.from(clouds.mesh.instanceMatrix.array), before);
        const night = clouds.material.color.clone(); clouds.update(900, 1); assert.ok(clouds.material.color.r > night.r); clouds.dispose();
    });
    it('restored time reconstructs the same sky without mutating saved state or using gameplay RNG', async () => {
        const s = createWorld('sky', 'sky'); s.time = 900;
        const camera = new THREE.PerspectiveCamera(), sky = new SkyBackdrop(), before = structuredClone(s);
        sky.update(camera, s.time, s.blood); const matrices = Array.from(sky.clouds.mesh.instanceMatrix.array);
        camera.position.set(300, 90, -200); sky.update(camera, s.time, s.blood);
        assert.deepEqual(Array.from(sky.clouds.mesh.instanceMatrix.array), matrices);
        assert.deepEqual(s, before); const restored = await unpack(await pack(s)), other = new SkyBackdrop();
        other.update(camera, restored.time, restored.blood); assert.deepEqual(Array.from(other.clouds.mesh.instanceMatrix.array), matrices);
        sky.dispose(); other.dispose();
    });
    it('sky disposal releases instance buffers, cloud geometry and material', () => {
        const sky = new SkyBackdrop(); let released = 0;
        sky.clouds.mesh.addEventListener('dispose', () => released++);
        sky.clouds.geometry.addEventListener('dispose', () => released++);
        sky.clouds.material.addEventListener('dispose', () => released++);
        sky.dispose(); assert.equal(released, 3); assert.equal(sky.scene.children.length, 0);
    });
});
