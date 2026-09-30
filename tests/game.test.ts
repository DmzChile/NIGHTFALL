import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { createWorld, validateState, give, count, craft, planNight, transactTransfer, addItem, height, makeEnemy, type Stack } from '../lib/game/model';
import { tierCap, MONSTERS, RECIPES } from '../lib/game/data';
import { SaveManager, pack, unpack } from '../lib/game/storage';
import { Engine } from '../lib/game/engine';
import { SaveQueue } from '../lib/game/save-queue';
describe('world and game transactions', () => {
    it('same seed produces identical resources', () => {
        const a = createWorld('A', 'deterministic'), b = createWorld('B', 'deterministic');
        assert.deepEqual(a.nodes, b.nodes);
        assert.ok(a.nodes.filter(n => n.kind === 'iron' && Math.hypot(n.x, n.z) < 200).length >= 4);
        assert.equal(validateState(a).seed, a.seed);
    });
    it('crafting cannot lose materials when output space is unavailable', () => {
        const s = createWorld('A', '1');
        s.player.items = [];
        give(s.player.items, 'wood', 20);
        for (let i = 0; i < 23; i++)
            give(s.player.items, 'stone_axe', 1);
        const before = structuredClone(s.player.items);
        const r = RECIPES.find(r => r.id === 'workbench')!;
        assert.ok(craft(s, r));
        assert.deepEqual(s.player.items, before);
    });
    it('crafting consumes inputs and creates output once', () => {
        const s = createWorld('A', '1');
        addItem(s, 'wood', 10);
        assert.equal(craft(s, RECIPES.find(r => r.id === 'workbench')!), null);
        assert.equal(count(s.player.items, 'wood'), 0);
        assert.equal(count(s.player.items, 'workbench'), 1);
        assert.ok(craft(s, RECIPES.find(r => r.id === 'workbench')!));
    });
    it('transfer is atomic when the target is full', () => {
        const a: Stack[] = [], b: Stack[] = [];
        give(a, 'stone_pick', 1);
        give(b, 'iron_sword', 1);
        const before = structuredClone(a);
        assert.equal(transactTransfer(a, b, a[0].uid, 1), false);
        assert.deepEqual(a, before);
    });
    it('night plans respect days, species tiers and limits', () => {
        for (let day = 1; day < 30; day++) {
            const s = createWorld('A', 'seed' + day);
            s.time = (day - 1) * 720 + 510;
            s.previousKills = 500;
            planNight(s);
            assert.ok(s.nightPlan.some(e => e.kind === 'zombie'));
            assert.ok(s.nightPlan.length <= 20);
            for (const e of s.nightPlan) {
                assert.ok(e.tier <= tierCap(day));
                assert.ok(e.tier >= MONSTERS[e.kind].min);
                assert.ok(e.tier <= MONSTERS[e.kind].max);
            }
            if (day === 1)
                assert.ok(s.nightPlan.every(e => e.tier === 1));
            if (day < 4)
                assert.ok(s.nightPlan.every(e => MONSTERS[e.kind].role !== 'magic'));
        }
    });
    it('forge reservations survive reload without awarding twice', () => {
        const s = createWorld('A', 'seed');
        addItem(s, 'iron_ore', 4);
        const b = { id: crypto.randomUUID(), kind: 'furnace', x: 0, z: 8, yaw: 0, hp: 200, items: [], jobs: [], fuel: 20 };
        s.buildings.push(b);
        assert.equal(craft(s, RECIPES.find(r => r.id === 'iron')!), null);
        assert.equal(count(s.player.items, 'iron_ore'), 2);
        const restored = validateState(JSON.parse(JSON.stringify(s)));
        const e = new Engine(restored, new SaveManager());
        e.resume();
        for (let i = 0; i < 301; i++)
            e.step(1 / 30);
        assert.equal(count(restored.buildings.at(-1)!.items, 'iron'), 1);
        assert.equal(restored.buildings.at(-1)!.jobs.length, 0);
        e.dispose();
    });
    it('defeating an enemy twice does not duplicate a reward', () => {
        const s = createWorld('A', 'seed');
        const enemy = s.enemies[0];
        const engine = new Engine(s, new SaveManager());
        engine.hitEnemy(enemy, 100, 'iron_sword');
        engine.hitEnemy(enemy, 100, 'iron_sword');
        assert.equal(s.drops.length, 1);
        engine.dispose();
    });
    it('paused simulation never advances offline time', () => {
        const s = createWorld('A', 'seed');
        const engine = new Engine(s, new SaveManager());
        engine.step(1000);
        assert.equal(s.time, 0);
        engine.dispose();
    });
});
describe('save queue and schema regressions', () => {
    it('walls intercept a projectile before actors behind them', () => {
        const s = createWorld('A', 'wall');
        s.enemies = [];
        s.buildings = [{ id: crypto.randomUUID(), kind: 'wall', x: 0, z: 2, yaw: 0, hp: 100, items: [], jobs: [], fuel: 0 }];
        const enemy = makeEnemy(s, 'zombie', 1, 0, 4);
        s.enemies.push(enemy);
        s.projectiles.push({ id: crypto.randomUUID(), x: 0, z: 0, y: height(0, 2) + 1, vx: 0, vy: 0, vz: 180, life: 1, damage: 10, enemy: false, type: 'arrow' });
        const e = new Engine(s, new SaveManager());
        e.resume();
        e.step(1 / 30);
        assert.equal(enemy.hp, enemy.maxhp);
        assert.equal(s.projectiles.length, 0);
        e.dispose();
    });
    it('projectiles hit the nearest actor regardless of entity array order', () => {
        const s = createWorld('A', 'nearest');
        s.buildings = [];
        const far = makeEnemy(s, 'zombie', 1, 0, 4), near = makeEnemy(s, 'zombie', 1, 0, 2);
        s.enemies = [far, near];
        s.projectiles.push({ id: crypto.randomUUID(), x: 0, z: 0, y: height(0, 2) + 1, vx: 0, vy: 0, vz: 180, life: 1, damage: 10, enemy: false, type: 'arrow' });
        const e = new Engine(s, new SaveManager());
        e.resume();
        e.step(1 / 30);
        assert.equal(far.hp, far.maxhp);
        assert.equal(near.hp, near.maxhp - 10);
        e.dispose();
    });
    it('ranged attacks at zero distance retain finite projectile coordinates', () => {
        const s = createWorld('A', 'finite');
        s.buildings = [];
        const enemy = makeEnemy(s, 'archer', 2, s.player.x, s.player.z);
        enemy.state = 'windup';
        enemy.timer = 0;
        s.enemies = [enemy];
        const e = new Engine(s, new SaveManager());
        e.resume();
        e.step(1 / 30);
        assert.doesNotThrow(() => validateState(s));
        e.dispose();
    });
    it('concurrent requests coalesce and wait for the latest checkpoint', async () => {
        const queue = new SaveQueue();
        let writes = 0;
        let finish!: () => void;
        const write = async () => {
            writes++;
            if (writes === 1)
                await new Promise<void>(resolve => finish = resolve);
            return true;
        };
        const first = queue.request(write);
        await Promise.resolve();
        const second = queue.request(write), third = queue.request(write);
        finish();
        await Promise.all([first, second, third]);
        assert.equal(writes, 2);
    });
    it('failure ends a queued batch and permits an explicit retry', async () => {
        const s = createWorld('A', 'failure');
        const storage = new SaveManager();
        let writes = 0;
        let fail!: (reason: Error) => void;
        storage.save = async () => {
            writes++;
            if (writes === 1)
                await new Promise<never>((_, reject) => fail = reject);
            return Date.now();
        };
        const engine = new Engine(s, storage);
        const first = engine.save();
        await Promise.resolve();
        const second = engine.save();
        fail(new Error('disk unavailable'));
        await Promise.all([first, second]);
        assert.equal(writes, 1);
        assert.equal(engine.dirty, true);
        assert.match(engine.error, /disk/);
        await engine.save();
        assert.equal(writes, 2);
        assert.equal(engine.error, '');
        engine.dispose();
    });
    it('validation normalizes only the returned copy', () => {
        const s = createWorld('A', 'copy');
        s.player.hotbar[0] = 'missing-stack';
        const before = structuredClone(s);
        assert.equal(validateState(s).player.hotbar[0], null);
        assert.deepEqual(s, before);
    });
    it('inherited content identifiers and fractional grants are rejected', () => {
        const s = createWorld('A', 'prototype');
        assert.equal(give(s.player.items, 'toString', 1), false);
        assert.equal(give(s.player.items, 'wood', .5), false);
        s.nodes[0].kind = 'constructor';
        assert.throws(() => validateState(s), /자원/);
    });
    it('reserved jobs must match both their recipe and facility', () => {
        const s = createWorld('A', 'jobs');
        addItem(s, 'iron_ore', 2);
        const b = { id: crypto.randomUUID(), kind: 'furnace', x: 0, z: 8, yaw: 0, hp: 200, items: [], jobs: [], fuel: 20 };
        s.buildings.push(b);
        assert.equal(craft(s, RECIPES.find(r => r.id === 'iron')!), null);
        const bad = structuredClone(s);
        bad.buildings.at(-1)!.jobs[0].reserved = { mithril: 999 };
        assert.throws(() => validateState(bad), /예약/);
        b.kind = 'chest';
        assert.throws(() => validateState(s), /예약/);
    });
    it('malformed loot and projectile types cannot enter simulation', () => {
        const s = createWorld('A', 'loot');
        s.enemies[0].loot = { wood: -1 };
        assert.throws(() => validateState(s), /전리품/);
        s.enemies[0].loot = { wood: 1 };
        s.projectiles.push({ id: crypto.randomUUID(), x: 0, z: 0, y: 2, vx: 0, vy: 0, vz: 0, life: 1, damage: 1, enemy: false, type: 42 as unknown as string });
        assert.throws(() => validateState(s), /투사체/);
    });
    it('unrecoverable snapshots release the world lease', async () => {
        const a = new SaveManager(), b = new SaveManager(), s = createWorld('failed load', 'lease');
        await a.acquire(s.id);
        await a.save(s);
        await new Promise<void>((resolve, reject) => {
            const tx = a.db!.transaction('snapshots', 'readwrite'), store = tx.objectStore('snapshots'), r = store.get([s.id, 1]);
            r.onsuccess = () => {
                const v = r.result;
                v.data.state.player.hp = 1;
                store.put(v);
            };
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
        });
        await assert.rejects(() => a.load(s.id), /정상 저장본/);
        assert.equal(a.active, null);
        await b.acquire(s.id);
        await b.release();
        a.close();
        b.close();
    });
    it('a valid checksum cannot restore a snapshot belonging to another world', async () => {
        const a = new SaveManager(), s = createWorld('identity', 'identity');
        await a.acquire(s.id);
        await a.save(s);
        const other = structuredClone(s);
        other.id = crypto.randomUUID();
        const envelope = await pack(other);
        await new Promise<void>((resolve, reject) => {
            const tx = a.db!.transaction('snapshots', 'readwrite');
            tx.objectStore('snapshots').put({ worldId: s.id, generation: s.generation, saved: Date.now(), data: envelope });
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
        });
        await assert.rejects(() => a.load(s.id), /정상 저장본/);
        assert.equal(a.active, null);
        a.close();
    });
});
describe('browser save integrity', () => {
    it('checksum rejects modification', async () => {
        const s = createWorld('A', 'export');
        const p = await pack(s);
        assert.deepEqual(await unpack(p), s);
        p.state.player.hp = 1;
        await assert.rejects(() => unpack(p), /체크섬/);
    });
    it('commit, restore, retain three generations and detect old writes', async () => {
        const a = new SaveManager(), s = createWorld('save test', 'save');
        await a.open();
        await a.acquire(s.id);
        for (let i = 0; i < 4; i++) {
            s.time = i * 30;
            await a.save(s);
        }
        const worlds = await a.list();
        assert.equal(worlds.find(w => w.id === s.id)!.generation, 4);
        const record = await a.load(s.id);
        assert.equal(record.state.time, 90);
        const tx = a.db!.transaction('snapshots', 'readonly');
        const req = tx.objectStore('snapshots').index('world').getAll(s.id);
        const records = await new Promise<{
            generation: number;
        }[]>(r => req.onsuccess = () => r(req.result));
        assert.equal(records.length, 3);
        const old = structuredClone(s);
        old.generation = 1;
        await assert.rejects(() => a.save(old), /충돌/);
        await a.release();
        a.close();
    });
    it('latest corrupted save recovers earlier valid generation', async () => {
        const a = new SaveManager(), s = createWorld('recover', 'r');
        await a.acquire(s.id);
        s.time = 10;
        await a.save(s);
        s.time = 20;
        await a.save(s);
        await new Promise<void>((resolve, reject) => {
            const tx = a.db!.transaction('snapshots', 'readwrite'), store = tx.objectStore('snapshots'), r = store.get([s.id, 2]);
            r.onsuccess = () => {
                const v = r.result;
                v.data.state.time = 999;
                store.put(v);
            };
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
        });
        const loaded = await a.load(s.id);
        assert.equal(loaded.recovered, true);
        assert.equal(loaded.state.time, 10);
        assert.equal(loaded.state.generation, 2);
        await a.release();
        a.close();
    });
    it('another owner cannot acquire a live world', async () => {
        const a = new SaveManager(), b = new SaveManager(), s = createWorld('lock', 'l');
        await a.acquire(s.id);
        await a.save(s);
        await assert.rejects(() => b.acquire(s.id), /다른 탭/);
        await a.release();
        await b.acquire(s.id);
        const loaded = await b.load(s.id);
        assert.equal(loaded.state.id, s.id);
        await b.release();
        a.close();
        b.close();
    });
    it('invalid inventory numbers and duplicate identities are rejected', () => {
        const s = createWorld('A', 'i');
        addItem(s, 'wood', 10);
        s.player.items[0].qty = -1;
        assert.throws(() => validateState(s), /아이템/);
        s.player.items[0].qty = 10;
        s.player.items.push(structuredClone(s.player.items[0]));
        assert.throws(() => validateState(s), /중복/);
    });
});
