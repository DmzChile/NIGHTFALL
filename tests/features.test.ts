import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { Engine } from '../lib/game/engine';
import { ITEMS, RECIPES } from '../lib/game/data';
import { addItem, count, craft, createWorld, makeEnemy, validateState } from '../lib/game/model';
import { SaveManager, pack, unpack, importFile } from '../lib/game/storage';
import { recipeUnlocked } from '../lib/game/progression';
const recipe = (id: string) => RECIPES.find(r => r.id === id)!;
function fixture() {
    const s = createWorld('features', 'features');
    s.nodes = [];
    s.buildings = [];
    s.enemies = [];
    const storage = new SaveManager();
    storage.save = async () => Date.now();
    const engine = new Engine(s, storage);
    return { s, engine };
}
function advance(engine: Engine, seconds: number) {
    for (let i = 0; i < Math.round(seconds * 30); i++)
        engine.step(1 / 30);
}
function bench(s: ReturnType<typeof createWorld>) {
    s.buildings.push({ id: crypto.randomUUID(), kind: 'workbench', x: s.player.x, z: s.player.z, yaw: 0, hp: 100, fuel: 0, items: [], jobs: [] });
}
function startFishing(s: ReturnType<typeof createWorld>, engine: Engine) {
    s.player.x = 430;
    s.player.z = 0;
    addItem(s, 'fishing_rod', 1);
    const rod = s.player.items.find(i => i.id === 'fishing_rod')!;
    s.player.hotbar[0] = rod.uid;
    s.player.selected = 0;
    engine.resume();
    engine.attack();
    s.player.fishing!.success = true;
}
describe('Alpha 0.2 progression and survival', () => {
    it('starter recipes are available and discoveries permanently unlock advanced recipes', async () => {
        const { s, engine } = fixture();
        assert.ok(recipeUnlocked(s, recipe('stone_pick')));
        assert.equal(recipeUnlocked(s, recipe('iron_sword')), false);
        addItem(s, 'iron', 6);
        addItem(s, 'wood', 2);
        addItem(s, 'leather', 1);
        assert.ok(recipeUnlocked(s, recipe('iron_sword')));
        s.player.items = [];
        s.player.hotbar.fill(null);
        const loaded = await unpack(await pack(s));
        assert.ok(recipeUnlocked(loaded, recipe('iron_sword')));
        assert.ok(loaded.knownItems!.includes('iron'));
        engine.dispose();
    });
    it('a locked recipe leaves materials untouched', () => {
        const { s, engine } = fixture();
        bench(s);
        const before = structuredClone(s.player.items);
        assert.match(craft(s, recipe('bow'))!, /발견/);
        assert.deepEqual(s.player.items, before);
        engine.dispose();
    });
    it('legacy saves retain their prior recipe access without modifying the input', () => {
        const s = createWorld('legacy', 'legacy');
        delete s.knownItems;
        delete s.unlockedRecipes;
        delete s.regionNext;
        const loaded = validateState(s);
        assert.equal(loaded.unlockedRecipes!.length, RECIPES.length);
        assert.equal(s.unlockedRecipes, undefined);
    });
    it('shield defense covers the front, excludes sides and rear, and consumes durability once', () => {
        for (const [x, z, hp, stamina] of [[0, 6, 97, 88], [2, 8, 90, 100], [0, 10, 90, 100]]) {
            const { s, engine } = fixture();
            addItem(s, 'shield', 1);
            engine.blocking = true;
            engine.hurt(10, true, { x, z });
            assert.equal(s.player.hp, hp);
            assert.equal(s.player.stamina, stamina);
            assert.equal(s.player.items[0].dur, stamina === 88 ? 119 : 120);
            engine.dispose();
        }
    });
    it('two-handed equipment cannot block and insufficient stamina causes stagger', () => {
        const { s, engine } = fixture();
        addItem(s, 'shield', 1);
        addItem(s, 'bow', 1);
        s.player.hotbar[0] = s.player.items.find(i => i.id === 'bow')!.uid;
        engine.blocking = true;
        engine.hurt(10, true, { x: 0, z: 6 });
        assert.equal(s.player.hp, 90);
        s.time = 1;
        s.player.hotbar[0] = null;
        s.player.stamina = 5;
        engine.hurt(10, true, { x: 0, z: 6 });
        assert.equal(s.player.stamina, 0);
        assert.equal(s.player.stagger, .6);
        engine.resume();
        engine.keys.add('KeyW');
        engine.step(1 / 30);
        assert.equal(s.player.z, 8);
        engine.dispose();
    });
    it('blocking restarts the stamina recovery delay and persists it', async () => {
        const { s, engine } = fixture(); addItem(s, 'shield', 1); s.time = 10;
        engine.blocking = true; engine.hurt(10, true, { x: 0, z: 6 });
        const loaded=await unpack(await pack(s));engine.dispose();
        const restored=new Engine(loaded,new SaveManager());restored.resume();advance(restored,.5);assert.equal(loaded.player.stamina,88);
        advance(restored,.6);assert.ok(loaded.player.stamina>88);restored.dispose();
    });
    it('poison is periodic, refreshes duration, and survives reload without stacking', async () => {
        const { s, engine } = fixture();
        const target = makeEnemy(s, 'zombie', 1, 0, 30);
        s.enemies.push(target);
        engine.hitEnemy(target, 0, 'poison_arrow');
        engine.hitEnemy(target, 0, 'poison_arrow');
        engine.resume();
        advance(engine, .5);
        assert.equal(target.hp, target.maxhp);
        const loaded = await unpack(await pack(s));
        engine.dispose();
        const restored = new Engine(loaded, new SaveManager());
        restored.resume();
        advance(restored, 4.5);
        assert.equal(loaded.enemies[0].hp, target.maxhp - 10);
        restored.dispose();
    });
    it('burn damage is periodic and bosses have reduced status damage and slow', () => {
        const { s, engine } = fixture();
        const normal = makeEnemy(s, 'zombie', 1, 0, 30), boss = makeEnemy(s, 'forest_boss', 1, 0, 40);
        s.enemies.push(normal, boss);
        engine.hitEnemy(normal, 0, 'fire_staff');
        engine.hitEnemy(boss, 0, 'fire_staff');
        engine.resume();
        advance(engine, 4);
        assert.equal(normal.hp, normal.maxhp - 12);
        assert.equal(boss.hp, boss.maxhp - 8);
        engine.dispose();
    });
    it('antidote clears poison and prevents reinfection for ten simulation seconds', () => {
        const { s, engine } = fixture();
        s.player.poison = 5;
        addItem(s, 'antidote', 1);
        engine.useItem(s.player.items[0].uid);
        assert.equal(s.player.poison, 0);
        assert.equal(s.player.poisonResist, 10);
        const spider = makeEnemy(s, 'spider', 3, 0, 9);
        spider.state = 'windup';
        spider.timer = 0;
        s.enemies.push(spider);
        engine.resume();
        engine.step(1 / 30);
        assert.equal(s.player.poison, 0);
        engine.pause();
        advance(engine, 100);
        assert.ok(s.player.poisonResist! > 9);
        engine.dispose();
    });
    it('fishing waits seven seconds, pauses, restores its outcome, and awards once', async () => {
        const { s, engine } = fixture();
        startFishing(s, engine);
        assert.equal(count(s.player.items, 'fish'), 0);
        advance(engine, 3);
        engine.pause();
        advance(engine, 100);
        assert.ok(s.player.fishing!.remaining > 3.9);
        const loaded = await unpack(await pack(s));
        engine.dispose();
        const restored = new Engine(loaded, new SaveManager());
        restored.resume();
        advance(restored, 4);
        assert.equal(count(loaded.player.items, 'fish'), 1);
        assert.equal(loaded.player.fishing, undefined);
        advance(restored, 1);
        assert.equal(count(loaded.player.items, 'fish'), 1);
        restored.dispose();
    });
    it('movement, equipment changes and hits cancel fishing without rewards', () => {
        for (const action of ['move', 'equip', 'hit']) {
            const { s, engine } = fixture();
            startFishing(s, engine);
            if (action === 'move')
                s.player.x += 2;
            if (action === 'equip')
                s.player.hotbar[0] = null;
            if (action === 'hit')
                engine.hurt(1);
            engine.step(1 / 30);
            assert.equal(s.player.fishing, undefined);
            assert.equal(count(s.player.items, 'fish'), 0);
            engine.dispose();
        }
    });
    it('a full fishing inventory leaves the reward as a recoverable ground drop', () => {
        const { s, engine } = fixture();
        startFishing(s, engine);
        while (s.player.items.length < 24)
            addItem(s, 'stone_axe', 1);
        advance(engine, 7);
        assert.equal(s.drops.length, 1);
        assert.equal(s.drops[0].items[0].id, 'fish');
        engine.dispose();
    });
    it('depositing the rod while paused cancels fishing before the next save', async () => {
        const { s, engine } = fixture();
        startFishing(s, engine);
        engine.pause('facility');
        const chest = { id: crypto.randomUUID(), kind: 'chest', x: 430, z: 0, yaw: 0, hp: 100, fuel: 0, jobs: [], items: [] };
        s.buildings.push(chest);
        engine.facility = chest.id;
        engine.transfer(s.player.fishing!.uid, true);
        assert.equal(s.player.fishing, undefined);
        assert.doesNotThrow(() => validateState(s));
        assert.equal((await unpack(await pack(s))).player.fishing, undefined);
        engine.dispose();
    });
    it('imported fishing jobs refer to the newly copied rod instance', async () => {
        const { s, engine } = fixture();
        startFishing(s, engine);
        const imported = await importFile(new File([JSON.stringify(await pack(s))], 'save.json'));
        assert.notEqual(imported.player.fishing!.uid, s.player.fishing!.uid);
        assert.equal(imported.player.fishing!.uid, imported.player.items.find(i => i.id === 'fishing_rod')!.uid);
        engine.dispose();
    });
    it('archer loot is pre-rolled and damaged bow durability survives death and saving', async () => {
        const { s, engine } = fixture();
        let broken = 0, damaged = 0;
        for (let i = 0; i < 200; i++) {
            const enemy = makeEnemy(s, 'archer', 2, 0, 30);
            if (enemy.loot.broken_bow)
                broken++;
            if (enemy.lootGear)
                damaged++;
        }
        assert.ok(broken > 120 && broken < 190);
        assert.equal(broken + damaged, 200);
        let enemy = makeEnemy(s, 'archer', 2, 0, 30);
        while (!enemy.lootGear)
            enemy = makeEnemy(s, 'archer', 2, 0, 30);
        s.enemies.push(enemy);
        const loaded = await unpack(await pack(s));
        const restored = new Engine(loaded, new SaveManager());
        restored.hitEnemy(loaded.enemies[0], 100, 'iron_sword');
        assert.equal(loaded.drops[0].items.find(i => i.id === 'bow')!.dur, 45);
        restored.dispose();
        engine.dispose();
    });
    it('broken bows can be restored or salvaged and damaged bows require both repair materials', () => {
        const { s, engine } = fixture();
        bench(s);
        addItem(s, 'broken_bow', 2);
        addItem(s, 'wood', 3);
        addItem(s, 'rope', 2);
        assert.equal(craft(s, recipe('restore_bow')), null);
        assert.equal(count(s.player.items, 'bow'), 1);
        assert.equal(craft(s, recipe('salvage_bow')), null);
        assert.equal(count(s.player.items, 'wood'), 1);
        const bow = s.player.items.find(i => i.id === 'bow')!;
        bow.dur = 45;
        engine.repair(bow.uid);
        assert.equal(bow.dur, 45);
        assert.equal(count(s.player.items, 'wood'), 1);
        addItem(s, 'wood', 1);
        addItem(s, 'rope', 1);
        engine.repair(bow.uid);
        assert.equal(s.player.items.find(i => i.uid === bow.uid)!.dur, 90);
        assert.equal(count(s.player.items, 'rope'), 0);
        engine.dispose();
    });
    it('regional enemies spawn outside the safe start, with separate tiers, distances and caps', () => {
        const { s, engine } = fixture();
        engine.resume();
        advance(engine, 15);
        assert.equal(s.enemies.length, 0);
        s.player.x = 150;
        s.player.z = 0;
        advance(engine, 14);
        const enemy = s.enemies.find(e => e.region === '숲')!;
        assert.ok(enemy);
        assert.ok(enemy.tier >= 2);
        assert.equal(enemy.night, 0);
        assert.equal(s.regionNext!['숲']! > s.time, true);
        // Saved cooldown prevents re-entering from forcing a new encounter.
        // Saved cooldown prevents re-entering from forcing a new encounter.
        s.enemies = [];
        advance(engine, 1);
        assert.equal(s.enemies.length, 0);
        s.regionNext!['숲'] = 0;
        const guarded = makeEnemy(s, 'wolf', 2, 180, 0);
        guarded.region = '숲';
        guarded.night = 0;
        const guarded2 = structuredClone(guarded);
        guarded2.id = crypto.randomUUID();
        s.enemies = [guarded, guarded2];
        advance(engine, 1);
        assert.equal(s.enemies.filter(e => e.region).length, 2);
        engine.dispose();
    });
    it('regional cooldowns survive round trip and malformed new fields are rejected', async () => {
        const { s, engine } = fixture();
        s.regionNext = { '유적': 120 };
        const loaded = await unpack(await pack(s));
        assert.deepEqual(loaded.regionNext, s.regionNext);
        loaded.unlockedRecipes!.push('invalid_recipe');
        assert.throws(() => validateState(loaded), /해금/);
        const bad = structuredClone(s);
        bad.player.fishing = { uid: 'missing', x: 0, z: 0, remaining: 7, success: true };
        assert.throws(() => validateState(bad), /낚시/);
        const mob = makeEnemy(s, 'archer', 2, 0, 30);
        mob.lootGear = [{ id: 'bow', dur: ITEMS.bow.durability! + 1 }];
        s.enemies.push(mob);
        assert.throws(() => validateState(s), /장비 전리품/);
        engine.dispose();
    });
});
