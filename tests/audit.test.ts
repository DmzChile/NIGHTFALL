import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { createWorld, addItem, count, height, makeEnemy, type Building } from '../lib/game/model';
import { Engine } from '../lib/game/engine';
import { SaveManager, pack, unpack } from '../lib/game/storage';
import { celestialState } from '../lib/game/sky';

function fixture() {
    const s = createWorld('audit', 'audit'); s.nodes = []; s.enemies = []; s.buildings = []; s.time = 10;
    const storage = new SaveManager(); storage.save = async () => Date.now();
    return { s, engine: new Engine(s, storage), storage };
}
function building(kind: string, x = 0, z = 0): Building {
    return { id: crypto.randomUUID(), kind, x, z, yaw: 0, hp: 200, fuel: 0, items: [], jobs: [] };
}
function advance(engine: Engine, seconds: number) {
    for (let i = 0; i < Math.round(seconds * 30); i++) engine.step(1 / 30);
}
async function whileHashing(run: (entered: Promise<void>, finish: () => void) => Promise<void>) {
    const original = crypto.subtle.digest.bind(crypto.subtle), descriptor = Object.getOwnPropertyDescriptor(crypto.subtle, 'digest');
    let finish!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => finish = resolve), ready = new Promise<void>(resolve => entered = resolve);
    crypto.subtle.digest = async (algorithm, data) => { entered(); await gate; return original(algorithm, data); };
    try { await run(ready, finish); }
    finally {
        finish();
        if (descriptor) Object.defineProperty(crypto.subtle, 'digest', descriptor);
        else Reflect.deleteProperty(crypto.subtle, 'digest');
    }
}

describe('audit: combat, movement and death regressions', () => {
    it('blocking uses a functional shield when a broken one occurs first in inventory', () => {
        const { s, engine } = fixture(); addItem(s, 'shield', 2);
        s.player.items[0].dur = 0; s.player.items[1].dur = 1; engine.blocking = true;
        engine.hurt(10, true, { x: 0, z: 6 });
        assert.equal(s.player.hp, 97); assert.equal(s.player.items[0].dur, 0); assert.equal(s.player.items[1].dur, 0);
        s.time += 1; engine.hurt(10, true, { x: 0, z: 6 });
        assert.equal(s.player.hp, 87); assert.equal(s.player.stamina, 88); engine.dispose();
    });
    it('dodged and invulnerable spider strikes do not apply poison', () => {
        for (const mode of ['dodge', 'recent-hit']) {
            const { s, engine } = fixture(), e = makeEnemy(s, 'spider', 3, 0, 6.5);
            Object.assign(e, { alerted: true, state: 'windup', timer: .01 }); s.enemies.push(e);
            if (mode === 'dodge') s.player.dodgeUntil = 20; else s.player.hitAt = 10;
            engine.resume(); engine.step(1 / 30);
            assert.equal(s.player.hp, 100); assert.equal(s.player.poison, 0, mode); engine.dispose();
        }
    });
    it('dodged frost and wizard projectiles do not apply slow or curse', () => {
        for (const kind of ['frost', 'wizard']) {
            const { s, engine } = fixture(); s.player.dodgeUntil = 20;
            s.projectiles.push({ id: crypto.randomUUID(), x: 0, z: 7.5, y: height(0, 8) + 1, vx: 0, vy: 0, vz: 10, life: 1, damage: 10, enemy: true, type: kind });
            engine.resume(); engine.step(1 / 30);
            assert.equal(s.player.hp, 100); assert.equal(s.player.slow, 0); assert.equal(s.player.curse, 0);
            assert.equal(s.projectiles.length, 0); engine.dispose();
        }
    });
    it('a landed spider strike and magical projectile still apply their effects', () => {
        const { s, engine } = fixture(), e = makeEnemy(s, 'spider', 3, 0, 6.5);
        Object.assign(e, { alerted: true, state: 'windup', timer: .01 }); s.enemies.push(e);
        engine.resume(); engine.step(1 / 30); assert.equal(s.player.poison, 5); assert.ok(s.player.hp < 100);
        s.enemies = []; s.time += 1;
        s.projectiles.push({ id: crypto.randomUUID(), x: 0, z: 7.5, y: height(0, 8) + 1, vx: 0, vy: 0, vz: 10, life: 1, damage: 10, enemy: true, type: 'frost' });
        engine.step(1 / 30); assert.equal(s.player.slow, 3); engine.dispose();
    });
    it('dodge cannot end inside a trunk or tunnel past an off-center trunk', () => {
        for (const x of [0, .45]) {
            const { s, engine } = fixture();
            s.nodes.push({ id: crypto.randomUUID(), kind: 'tree', x, z: x === 0 ? 6.9 : 7.35, hp: 12, depleted: false, readyAt: 0, tree: { size: 'small', species: 'oak', autumn: false, variant: 0 } });
            engine.resume(); engine.keys.add('ControlLeft'); engine.step(1 / 30);
            assert.equal(s.player.z, 8); engine.dispose();
        }
    });
    it('free-space dodge preserves distance, stamina cost and invulnerability', () => {
        const { s, engine } = fixture(); engine.resume(); engine.keys.add('ControlLeft'); engine.step(1 / 30);
        assert.ok(Math.abs(s.player.z - 6.7) < 1e-10); assert.equal(s.player.stamina, 75);
        assert.ok(s.player.dodgeUntil > s.time); engine.dispose();
    });
    it('fatal food consumption removes exactly one item from the death bag and survives a save round trip', async () => {
        const { s, engine } = fixture(); addItem(s, 'rotten', 2); s.player.hp = 5;
        engine.useItem(s.player.items[0].uid); assert.equal(s.status, 'dead');
        assert.equal(count(s.drops[0].items, 'rotten'), 1); assert.equal(count(s.player.items, 'rotten'), 0);
        const loaded = await unpack(await pack(s)); assert.equal(count(loaded.drops[0].items, 'rotten'), 1); engine.dispose();
    });
    it('periodic fatal damage stops healing and other simulation work immediately', async () => {
        const { s, engine } = fixture(); Object.assign(s.player, { hp: 1, poison: 5, healLeft: 5, healRate: 10 }); s.tick = 29;
        engine.resume(); engine.step(1 / 30);
        assert.equal(s.status, 'dead'); assert.equal(s.player.hp, 0); assert.equal(s.player.healLeft, 0);
        const before = structuredClone(s); advance(engine, 1); assert.deepEqual(s, before);
        assert.equal((await unpack(await pack(s))).player.hp, 0); engine.dispose();
    });
    it('a bed with a zero coordinate is respected, and respawn is unavailable while alive', () => {
        const { s, engine } = fixture(), bed = building('bedroll', 12, 0); s.buildings.push(bed); s.player.bed = bed.id;
        const before = structuredClone(s); engine.respawn(); assert.deepEqual(s, before);
        engine.hurt(1000, false); engine.respawn(); assert.equal(s.status, 'alive');
        assert.equal(s.player.x, 12); assert.equal(s.player.z, 2); engine.dispose();
    });
});

describe('audit: asynchronous save ownership', () => {
    it('releasing the world during checksum calculation cancels its first checkpoint', async () => {
        const storage = new SaveManager(), s = createWorld('release during hash', 'audit-save');
        try {
            await storage.acquire(s.id);
            await whileHashing(async (entered, finish) => {
                const outcome = storage.save(s).then(() => null, e => e);
                await entered; await storage.release(); finish();
                assert.ok((await outcome) instanceof Error);
            });
            assert.equal(s.generation, 0); assert.ok(!(await storage.list()).some(w => w.id === s.id));
        } finally { await storage.release(); await storage.remove(s.id); storage.close(); }
    });
    it('changing worlds during a checksum cannot create a ghost checkpoint for the old world', async () => {
        const storage = new SaveManager(), a = createWorld('A', 'audit-save'), b = createWorld('B', 'audit-save');
        try {
            await storage.acquire(a.id);
            await whileHashing(async (entered, finish) => {
                const outcome = storage.save(a).then(() => null, e => e);
                await entered; await storage.acquire(b.id); finish();
                assert.ok((await outcome) instanceof Error);
            });
            assert.equal(storage.active, b.id); assert.ok(!(await storage.list()).some(w => w.id === a.id));
            await storage.save(b); assert.equal(b.generation, 1);
        } finally { await storage.release(); await storage.remove(a.id); await storage.remove(b.id); storage.close(); }
    });
    it('a deleted existing world cannot be recreated by a stale running session', async () => {
        const storage = new SaveManager(), s = createWorld('deleted', 'audit-save');
        try {
            await storage.acquire(s.id); await storage.save(s);
            await new Promise<void>((resolve, reject) => {
                const tx = storage.db!.transaction('worlds', 'readwrite'); tx.objectStore('worlds').delete(s.id);
                tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
            });
            await assert.rejects(() => storage.save(s), /권한|충돌|삭제/);
            assert.equal(s.generation, 1); assert.ok(!(await storage.list()).some(w => w.id === s.id));
        } finally { await storage.release(); await storage.remove(s.id); storage.close(); }
    });
    it('reacquiring the same world still cancels a checksum from the previous acquisition', async () => {
        const storage = new SaveManager(), s = createWorld('same world', 'audit-save');
        try {
            await storage.acquire(s.id);
            await whileHashing(async (entered, finish) => {
                const outcome = storage.save(s).then(() => null, e => e);
                await entered; await storage.release(); await storage.acquire(s.id); finish();
                assert.ok((await outcome) instanceof Error);
            });
            assert.equal(s.generation, 0); await storage.save(s); assert.equal(s.generation, 1);
        } finally { await storage.release(); await storage.remove(s.id); storage.close(); }
    });
    it('disposing the previous engine cannot erase the current engine lock-loss handler', () => {
        const storage = new SaveManager(), a = new Engine(createWorld('A', 'audit'), storage), b = new Engine(createWorld('B', 'audit'), storage);
        b.resume(); a.dispose(); storage.lockLost();
        assert.equal(b.paused, true); assert.match(b.error, /권한/); b.resume(); assert.equal(b.paused, true); b.dispose();
    });
});

describe('audit: sky color continuity', () => {
    it('sunset and night transitions have no sudden background or fog color jump', () => {
        for (const boundary of [420, 450, 510, 690, 720]) {
            const a = celestialState(boundary - .001).color, b = celestialState(boundary + .001).color;
            assert.ok(Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b) < .0001, String(boundary));
        }
        const a = celestialState(180), b = celestialState(470), c = celestialState(600);
        assert.ok(a.daylight > c.daylight); assert.ok(b.color.r / b.color.g > a.color.r / a.color.g);
    });
});
