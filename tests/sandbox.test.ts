import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { Engine } from '../lib/game/engine';
import { commandSuggestions, parseGameCommand } from '../lib/game/commands';
import { ITEMS, RECIPES } from '../lib/game/data';
import { capacity, count, craft, createWorld, give, height, makeEnemy, validateState, type GameMode, type State } from '../lib/game/model';
import { SaveManager, pack, unpack } from '../lib/game/storage';
function fixture(gameMode: GameMode = 'creative', deathMode: State['mode'] = 'normal') {
    const s = createWorld('sandbox test', 'sandbox-test', 'normal', deathMode, gameMode);
    s.nodes = []; s.buildings = []; s.enemies = []; s.time = 10;
    s.player.items = []; s.player.hotbar.fill(null); s.player.armor = null;
    const storage = new SaveManager();
    storage.save = async () => Date.now();
    const engine = new Engine(s, storage);
    return { s, engine, storage };
}
function advance(engine: Engine, seconds: number) {
    for (let i = 0; i < Math.round(seconds * 30); i++) engine.step(1 / 30);
}
describe('Creative mode and literal game commands', () => {
    it('preserves the backup state when inventory and facility actions follow lock loss', () => {
        for (const mode of ['survival', 'creative'] as const) {
            const { s, engine, storage } = fixture(mode);
            give(s.player.items, 'wood', 20); give(s.player.items, 'heal', 1); give(s.player.items, 'stone_axe', 1);
            const axe = s.player.items.find(it => it.id === 'stone_axe')!;
            axe.dur = 10; s.player.hp = 50;
            s.buildings.push({ id: 'furnace', kind: 'furnace', x: 0, z: 8, yaw: 0, hp: 200, items: [], fuel: 0,
                jobs: [{ id: 'job', recipe: 'iron', remaining: 10, reserved: { iron_ore: 2 } }] });
            engine.facility = 'furnace';
            storage.lockLost();
            assert.equal(engine.canModify, false);
            const before = structuredClone(s);
            const actions = [
                () => engine.craftRecipe(RECIPES.find(r => r.id === 'workbench')!),
                () => engine.useItem(s.player.items.find(it => it.id === 'heal')!.uid),
                () => engine.repair(axe.uid),
                () => engine.bind(axe.uid),
                () => engine.selectSlot(1),
                () => engine.transfer(s.player.items.find(it => it.id === 'wood')!.uid, true),
                () => engine.fuel('wood'),
                () => engine.cancelJob('job'),
                () => engine.attack(),
            ];
            try {
                for (const action of actions) { action(); assert.deepEqual(s, before, mode); }
            } finally { engine.dispose(); }
        }
    });
    it('launches pain potions from the current flight altitude along the view direction', () => {
        const { s, engine } = fixture();
        engine.giveItem('pain', 1); s.player.y = 30; engine.toggleFlight(true);
        s.player.yaw = .7; s.player.pitch = .9;
        engine.useItem(s.player.items[0].uid);
        const projectile = s.projectiles[0];
        assert.equal(projectile.y, height(s.player.x, s.player.z, s) + s.player.y + 1.6);
        assert.ok(Math.abs(Math.hypot(projectile.vx, projectile.vy, projectile.vz) - 14) < 1e-10);
        assert.ok(Math.abs(projectile.vx + Math.sin(.7) * Math.cos(.9) * 14) < 1e-10);
        assert.ok(Math.abs(projectile.vz + Math.cos(.7) * Math.cos(.9) * 14) < 1e-10);
        engine.dispose();
    });
    it('creates a usable creative world while legacy saves default to survival without changing their input', async () => {
        const s = createWorld('creative', 'creative', 'hard', 'permadeath', 'creative');
        assert.equal(s.gameMode, 'creative'); assert.equal(s.mode, 'permadeath');
        assert.equal(count(s.player.items, 'wall'), 1); assert.equal(capacity(s), 32);
        const legacy = createWorld('legacy', 'legacy'); delete legacy.gameMode; delete legacy.player.flying;
        const original = structuredClone(legacy), loaded = await unpack(await pack(legacy));
        assert.equal(loaded.gameMode, 'survival'); assert.equal(loaded.player.flying, false);
        assert.deepEqual(legacy, original);
    });
    it('validates mode and flight fields and round-trips a flying creative world through IndexedDB and metadata', async () => {
        const s = createWorld('creative save', 'creative-save', 'normal', 'normal', 'creative');
        s.player.flying = true; s.player.y = 20;
        const saves = new SaveManager();
        try {
            await saves.acquire(s.id); await saves.save(s);
            assert.equal((await saves.list()).find(w => w.id === s.id)!.gameMode, 'creative');
            await saves.release();
            const loaded = (await saves.load(s.id)).state;
            assert.equal(loaded.player.flying, true); assert.equal(loaded.player.y, 20);
            assert.equal(loaded.gameMode, 'creative'); assert.deepEqual(loaded.player.hotbar, s.player.hotbar);
            assert.throws(() => validateState({ ...s, gameMode: 'god' }), /모드/);
            assert.throws(() => validateState({ ...s, gameMode: 'survival' }), /비행/);
            assert.throws(() => validateState({ ...s, player: { ...s.player, flying: 1 } }), /비행/);
        } finally { await saves.release(); await saves.remove(s.id); saves.close(); }
    });
    it('prevents direct, periodic and starvation damage and maintains stamina while running', () => {
        const { s, engine } = fixture('creative', 'permadeath');
        Object.assign(s.player, { hp: 2, hunger: 0, stamina: 3, poison: 5, curse: 8, slow: 3, stagger: .6 });
        assert.equal(engine.hurt(1000), false); assert.equal(engine.hurt(1000, false), false);
        engine.resume(); engine.keys.add('ShiftLeft'); engine.keys.add('KeyW'); advance(engine, 6);
        assert.equal(s.status, 'alive'); assert.equal(s.player.hp, 100); assert.equal(s.player.hunger, 100); assert.equal(s.player.stamina, 100);
        assert.equal(s.player.poison + s.player.curse + s.player.slow + (s.player.stagger || 0), 0);
        engine.dispose();
    });
    it('crafts locked and timed recipes instantly without facilities or inputs, and rejects a full inventory atomically', () => {
        const { s, engine } = fixture();
        engine.giveItem('wood', 3);
        assert.equal(craft(s, RECIPES.find(r => r.id === 'iron')!), null);
        assert.equal(count(s.player.items, 'iron'), 1); assert.equal(count(s.player.items, 'wood'), 3);
        assert.equal(s.buildings.length, 0);
        assert.equal(craft(s, RECIPES.find(r => r.id === 'fire_staff')!), null);
        s.player.items = []; s.player.hotbar.fill(null);
        for (let i = 0; i < 24; i++) assert.equal(give(s.player.items, 'stone_sword', 1), true);
        const before = structuredClone(s);
        assert.match(craft(s, RECIPES.find(r => r.id === 'workbench')!)!, /공간/);
        assert.deepEqual(s, before); engine.dispose();
    });
    it('places repeatedly without consuming a building and restores normal consumption on returning to survival', () => {
        const { s, engine } = fixture(); engine.giveItem('wall', 1);
        const wall = s.player.items[0];
        engine.place(wall); s.player.x = 4; engine.place(wall);
        assert.equal(s.buildings.length, 2); assert.equal(count(s.player.items, 'wall'), 1);
        s.player.x = 8; engine.setGameMode('survival'); engine.place(wall);
        assert.equal(s.buildings.length, 3); assert.equal(count(s.player.items, 'wall'), 0);
        assert.equal(s.player.hotbar[0], null); engine.dispose();
    });
    it('allows instant harvesting and preserves bow, staff and consumable resources', () => {
        const { s, engine } = fixture();
        const node = { id: 'ore', kind: 'mithril', x: 0, z: 6, hp: 6, depleted: false, readyAt: 0 };
        s.nodes.push(node); engine.target = { kind: 'node', id: node.id, distance: 2 }; engine.gather();
        assert.equal(node.depleted, true); assert.equal(count(s.player.items, 'mithril_ore'), 4);
        engine.target = null; engine.giveItem('strong_bow', 1);
        const bow = s.player.items.find(it => it.id === 'strong_bow')!; engine.bind(bow.uid); s.time += 2; engine.attack();
        assert.equal(s.projectiles[0].type, 'arrow'); assert.equal(bow.dur, ITEMS.strong_bow.durability); assert.equal(count(s.player.items, 'arrow'), 0);
        engine.giveItem('fire_staff', 1); const staff = s.player.items.find(it => it.id === 'fire_staff')!; engine.bind(staff.uid);
        s.time += 2; engine.attack(); assert.equal(staff.charge, 5); assert.equal(count(s.player.items, 'magic_stone'), 0);
        engine.giveItem('heal', 2); const heal = s.player.items.find(it => it.id === 'heal')!;
        engine.useItem(heal.uid); engine.useItem(heal.uid);
        assert.equal(count(s.player.items, 'heal'), 2);
        engine.dispose();
    });
    it('flies at a stable world altitude, rises and descends, clamps height and disables flight in survival', () => {
        const { s, engine } = fixture(); s.player.y = 20; engine.toggleFlight(true); engine.resume();
        engine.keys.add('KeyW'); engine.keys.add('Space');
        const altitude = height(s.player.x, s.player.z, s) + s.player.y;
        engine.step(1 / 30);
        assert.ok(Math.abs(height(s.player.x, s.player.z, s) + s.player.y - altitude - 8 / 30) < 1e-8);
        engine.keys.clear(); engine.keys.add('ControlLeft'); const before = s.player.y; engine.step(1 / 30);
        assert.ok(s.player.y < before);
        s.player.y = 119.99; engine.keys.clear(); engine.keys.add('Space'); engine.step(1 / 30); assert.equal(s.player.y, 120);
        engine.setGameMode('survival'); assert.equal(s.player.flying, false); assert.equal(engine.toggleFlight(true), false);
        engine.dispose();
    });
    it('suppresses hostile spawning and aggression including damage to structures', () => {
        const { s, engine } = fixture(); s.time = 509.99; s.player.x = 300;
        const enemy = makeEnemy(s, 'zombie', 1, 300, 10); enemy.state = 'windup'; enemy.timer = 0;
        s.enemies.push(enemy);
        s.buildings.push({ id: 'wall', kind: 'wall', x: 300, z: 9, yaw: 0, hp: 250, items: [], jobs: [], fuel: 0 });
        engine.resume(); advance(engine, 20);
        assert.equal(s.enemies.filter(e => !e.animal).length, 1); assert.equal(s.nightPlan.length, 0);
        assert.equal(s.player.hp, 100); assert.equal(s.buildings[0].hp, 250); assert.equal(s.projectiles.length, 0);
        engine.dispose();
    });
    it('demolishes resources permanently and preserves stored goods in a floor bag', () => {
        const { s, engine } = fixture();
        const chest = { id: 'chest', kind: 'chest', x: 0, z: 5, yaw: 0, hp: 200, items: [], jobs: [], fuel: 0 };
        give(chest.items, 'wood', 8); s.buildings.push(chest);
        engine.target = { kind: 'building', id: chest.id, distance: 3 }; engine.removeTarget();
        assert.equal(s.buildings.length, 0); assert.equal(count(s.drops[0].items, 'wood'), 8);
        const node = { id: 'tree', kind: 'tree', x: 0, z: 5, hp: 24, depleted: false, readyAt: 0 };
        s.nodes.push(node); engine.target = { kind: 'node', id: node.id, distance: 3 }; engine.removeTarget();
        assert.equal(node.depleted, true); assert.equal(node.readyAt, 0);
        engine.dispose();
    });
    it('parses quoted names literally, offers IDs and gives an entire quantity or none', async () => {
        const { s, engine } = fixture('survival');
        assert.deepEqual(parseGameCommand('/give "철 주괴" 5'), { name: 'give', args: ['철 주괴', '5'] });
        assert.equal(parseGameCommand('/give "iron'), null);
        assert.equal((await engine.command('/give "철 주괴" 5')).ok, true); assert.equal(count(s.player.items, 'iron'), 5);
        assert.ok(commandSuggestions('/give 철').some(suggestion => suggestion.value === '/give iron '));
        assert.ok(commandSuggestions('/time ').some(suggestion => suggestion.value === '/time set '));
        s.player.items = []; s.player.hotbar.fill(null);
        for (let i = 0; i < 23; i++) give(s.player.items, 'stone_sword', 1);
        const before = structuredClone(s);
        assert.equal((await engine.command('/give wood 198')).ok, false); assert.deepEqual(s, before);
        engine.dispose();
    });
    it('rejects malformed, prototype, non-finite, out-of-bounds and unsupported input without changing the world', async () => {
        const { s, engine } = fixture('survival'); engine.dirty = false;
        const before = structuredClone(s);
        for (const command of ['/give constructor 1', '/give __proto__ 1', '/give wood -1', '/give wood 1.5', '/give wood Infinity', '/give wood 1000', '/give wood 1; alert(1)', '/time set 720', '/time set NaN', '/tp Infinity 0', '/tp 500 0', '/tp ~NaN ~', '/gamemode constructor', '/gamemode god', '/fly on', '/spawn zombie 100 1', '/spawn constructor', '/spawn zombie 1 11', '/heal extra', '/save extra', '/clear toString']) {
            assert.equal((await engine.command(command)).ok, false, command); assert.deepEqual(s, before, command);
        }
        assert.equal(engine.dirty, false); engine.dispose();
    });
    it('switches modes without changing the death policy or possessions and cannot revive an ended world', async () => {
        const { s, engine } = fixture('survival', 'permadeath'); engine.giveItem('iron_sword', 1);
        const items = structuredClone(s.player.items), seed = s.seed, time = s.time;
        assert.equal((await engine.command('/gamemode 1')).ok, true); await engine.command('/fly on');
        assert.equal((await engine.command('/gamemode 0')).ok, true);
        assert.deepEqual(s.player.items, items); assert.equal(s.player.flying, false); assert.equal(s.mode, 'permadeath');
        assert.equal(s.seed, seed); assert.equal(s.time, time);
        engine.hurt(1000, false); assert.equal(s.status, 'ended');
        assert.equal((await engine.command('/gamemode creative')).ok, false); assert.equal(s.status, 'ended');
        engine.dispose();
    });
    it('changes clock phase while preserving cooldowns, regeneration, crops and regional spawn delay on forward and backward changes', async () => {
        const { s, engine } = fixture('survival'); s.time = 600;
        Object.assign(s.player, { potionAt: 590, foodAt: 599, hitAt: 598, staminaAt: 599 });
        s.nodes.push({ id: 'branch', kind: 'branch', x: 0, z: 5, hp: 0, depleted: true, readyAt: 900 });
        s.buildings.push({ id: 'plot', kind: 'plot', x: 5, z: 5, yaw: 0, hp: 200, items: [], jobs: [], fuel: 0, crop: 'wheat', grownAt: 1000 });
        s.regionNext = { '숲': 720 }; s.drops.push({ id: 'drop', x: 0, z: 5, items: [], expires: 800, bag: false });
        assert.equal((await engine.command('/time set day')).ok, true);
        assert.equal(s.time, 0); assert.equal(s.time - s.player.potionAt, 10); assert.equal(s.time - s.player.foodAt, 1);
        assert.equal(s.nodes[0].readyAt - s.time, 300); assert.equal(s.buildings[0].grownAt! - s.time, 400);
        assert.equal(s.regionNext['숲'] - s.time, 120); assert.equal(s.drops[0].expires - s.time, 200);
        validateState(s);
        assert.equal((await engine.command('/time set night')).ok, true);
        assert.equal(s.time, 540); assert.equal(s.time - s.player.potionAt, 10);
        assert.equal(s.nodes[0].readyAt - s.time, 300); assert.ok(s.nightPlan.length > 0);
        validateState(s); engine.dispose();
    });
    it('teleports relatively, validates obstacles, spawns valid animals, clears bindings and respects lost access', async () => {
        const { s, engine } = fixture();
        assert.equal((await engine.command('/tp ~10 ~')).ok, true); assert.equal(s.player.x, 10); assert.equal(s.player.z, 8);
        s.buildings.push({ id: 'chest', kind: 'chest', x: 12, z: 8, yaw: 0, hp: 200, items: [], jobs: [], fuel: 0 });
        assert.equal((await engine.command('/tp 12 8')).ok, false); assert.equal(s.player.x, 10);
        assert.equal((await engine.command('/spawn cow 1 2')).ok, true); assert.ok(s.enemies.every(e => e.animal && e.night === 0));
        engine.giveItem('iron_armor', 1); engine.bind(s.player.items[0].uid);
        assert.equal((await engine.command('/clear')).ok, true); assert.equal(s.player.armor, null); assert.ok(s.player.hotbar.every(slot => slot === null));
        engine.saveAccessLost = true; const before = structuredClone(s);
        assert.equal((await engine.command('/give wood')).ok, false); assert.deepEqual(s, before);
        assert.equal((await engine.command('/help')).ok, true); engine.dispose();
    });
    it('reports save failures and retains bounded console history across openings', async () => {
        const { engine, storage } = fixture();
        storage.save = async () => { throw new Error('save unavailable'); };
        const result = await engine.command('/save'); assert.equal(result.ok, false); assert.match(result.lines[0], /save unavailable/);
        storage.save = async () => Date.now(); assert.equal((await engine.command('/save')).ok, true);
        for (let i = 0; i < 45; i++) await engine.command('/help fly');
        engine.pause('inventory'); engine.pause('console');
        assert.equal(engine.commandHistory.length, 40); assert.equal(engine.commandLog.length, 30);
        assert.equal(engine.commandLog.at(-1)!.input, '/help fly'); engine.dispose();
    });
});
