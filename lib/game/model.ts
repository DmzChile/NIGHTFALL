import { starterRecipes, discoverItems, ensureProgression, recipeUnlocked } from './progression';
import { terrainHeight, migrateTerrain, DEFAULT_TERRAIN_VERSION, getTerrain, type TerrainWorld, type NewTerrainVersion } from './terrain';
import { biomeManager } from './world/BiomeManager';
import { Vector2 } from 'three';
import { ensureForest, isTree, nodeDefinition, treeTraits, type TreeTraits } from './woodland';
import { validateWorldState } from './validation';
import { ensureAwareness } from './awareness';
import { ITEMS, MONSTERS, NODES, day, tierCap, type Recipe } from './data';
export type Stack = {
    uid: string;
    id: string;
    qty: number;
    dur?: number;
    charge?: number;
};
export type NodeState = {
    id: string;
    kind: string;
    x: number;
    z: number;
    hp: number;
    depleted: boolean;
    readyAt: number;
    tree?: TreeTraits;
};
export type Job = {
    id: string;
    recipe: string;
    remaining: number;
    reserved: Record<string, number>;
};
export type Building = {
    id: string;
    kind: string;
    x: number;
    z: number;
    yaw: number;
    hp: number;
    items: Stack[];
    jobs: Job[];
    fuel: number;
    crop?: string;
    grownAt?: number;
    cooldown?: number;
    claimed?: boolean;
};
export type Enemy = {
    id: string;
    kind: string;
    tier: number;
    x: number;
    z: number;
    hp: number;
    maxhp: number;
    state: 'chase' | 'windup' | 'recover';
    alerted?: boolean;
    lostFor?: number;
    timer: number;
    loot: Record<string, number>;
    animal: boolean;
    summon: boolean;
    owner?: string;
    night: number;
    skill: number;
    slow: number;
    vulnerable?: number;
    poison?: number;
    burn?: number;
    dotTick?: number;
    region?: string;
    lootGear?: {
        id: string;
        dur: number;
    }[];
};
export type Projectile = {
    id: string;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    life: number;
    damage: number;
    enemy: boolean;
    type: string;
};
export type Drop = {
    id: string;
    x: number;
    z: number;
    items: Stack[];
    expires: number;
    bag: boolean;
};
export type GameMode = 'survival' | 'creative';
export type State = {
    formatVersion: 1;
    contentVersion: 1;
    generatorVersion: 1;
    terrainVersion?: 1 | 2 | 3 | 4;
    forestVersion?: 1;
    id: string;
    name: string;
    seed: string;
    difficulty: 'easy' | 'normal' | 'hard';
    mode: 'normal' | 'permadeath';
    gameMode?: GameMode;
    status: 'alive' | 'dead' | 'ended';
    time: number;
    tick: number;
    rng: number;
    created: number;
    generation: number;
    player: {
        x: number;
        z: number;
        y: number;
        vy: number;
        flying?: boolean;
        yaw: number;
        pitch: number;
        hp: number;
        hunger: number;
        stamina: number;
        items: Stack[];
        hotbar: (string | null)[];
        selected: number;
        armor: string | null;
        hitAt: number;
        actionAt: number;
        potionAt: number;
        foodAt: number;
        dodgeUntil: number;
        poison: number;
        curse: number;
        slow: number;
        healLeft: number;
        healRate: number;
        bed: string | null;
        poisonResist?: number;
        staminaAt?: number;
        stagger?: number;
        fishing?: {
            uid: string;
            x: number;
            z: number;
            remaining: number;
            success: boolean;
        };
    };
    nodes: NodeState[];
    buildings: Building[];
    enemies: Enemy[];
    projectiles: Projectile[];
    drops: Drop[];
    previousKills: number;
    kills: Record<string, number>;
    nightPlan: Enemy[];
    nightWave: number;
    blood: boolean;
    lastBlood: number;
    quests: string[];
    discovered: string[];
    knownItems?: string[];
    unlockedRecipes?: string[];
    regionNext?: Record<string, number>;
};
export function uuid(source: Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>> = globalThis.crypto) {
    if (source.randomUUID) return source.randomUUID();
    const bytes = source.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function hash(seed: string) {
    let h = 2166136261;
    for (const c of seed) {
        h ^= c.charCodeAt(0);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0 || 1;
}
export function random(s: {
    rng: number;
}) {
    s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
    return s.rng / 4294967296;
}
export const distance = (a: {
    x: number;
    z: number;
}, b: {
    x: number;
    z: number;
}) => Math.hypot(a.x - b.x, a.z - b.z);
export function height(x: number, z: number, world?: TerrainWorld) {
    return terrainHeight(x, z, world);
}
export function biome(x: number, z: number) {
    return biomeManager.getRegionAt(x, z);
}
export const capacity = (s: State) => s.player.items.some(i => i.id === 'bag') ? 32 : 24;
export const count = (items: Stack[], id: string) => items.filter(i => i.id === id).reduce((n, i) => n + i.qty, 0);
export function give(items: Stack[], id: string, qty: number, cap = 24): boolean {
    if (!Object.prototype.hasOwnProperty.call(ITEMS, id) || !Number.isSafeInteger(qty) || qty <= 0)
        return false;
    const d = ITEMS[id], copy = structuredClone(items);
    for (const i of copy) {
        if (i.id === id && d.max > 1) {
            const n = Math.min(qty, d.max - i.qty);
            i.qty += n;
            qty -= n;
        }
    }
    while (qty > 0) {
        if (copy.length >= cap)
            return false;
        const n = Math.min(qty, d.max);
        copy.push({ uid: uuid(), id, qty: n, ...(d.durability ? { dur: d.durability } : {}), ...(id.endsWith('_staff') ? { charge: 0 } : {}) });
        qty -= n;
    }
    items.splice(0, items.length, ...copy);
    return true;
}
export function take(items: Stack[], id: string, qty: number) {
    if (count(items, id) < qty)
        return false;
    for (let j = items.length - 1; j >= 0 && qty > 0; j--) {
        if (items[j].id === id) {
            const n = Math.min(qty, items[j].qty);
            items[j].qty -= n;
            qty -= n;
            if (items[j].qty === 0)
                items.splice(j, 1);
        }
    }
    return true;
}
export function selected(s: State) {
    return s.player.items.find(i => i.uid === s.player.hotbar[s.player.selected]);
}
export function normalizeSlots(s: State) {
    for (let i = 0; i < 8; i++)
        if (!s.player.items.some(it => it.uid === s.player.hotbar[i]))
            s.player.hotbar[i] = null;
    if (!s.player.items.some(it => it.uid === s.player.armor))
        s.player.armor = null;
    if (s.player.fishing && !s.player.items.some(it => it.uid === s.player.fishing!.uid && it.id === 'fishing_rod'))
        s.player.fishing = undefined;
}
export function addItem(s: State, id: string, qty: number) {
    const ok = give(s.player.items, id, qty, capacity(s));
    if (ok) {
        discoverItems(s);
        const i = s.player.items.find(i => i.id === id);
        if (i && !s.player.hotbar.includes(i.uid) && ['tool', 'weapon', 'food', 'building', 'potion'].includes(ITEMS[id].kind)) {
            const n = s.player.hotbar.indexOf(null);
            if (n >= 0)
                s.player.hotbar[n] = i.uid;
        }
    }
    return ok;
}
export const isCreative = (s: State) => s.gameMode === 'creative';
export function createWorld(name: string, seed: string, difficulty: State['difficulty'] = 'normal', mode: State['mode'] = 'normal', gameMode: GameMode = 'survival', terrainVersion: NewTerrainVersion = DEFAULT_TERRAIN_VERSION): State {
    if (terrainVersion !== 3 && terrainVersion !== 4) throw new Error('새 월드의 지형 버전을 확인하세요.');
    const s: State = { formatVersion: 1, contentVersion: 1, generatorVersion: 1, terrainVersion, id: uuid(), name: name.slice(0, 40) || '새로운 섬', seed: seed.slice(0, 64) || uuid().slice(0, 8), difficulty, mode, status: 'alive', time: 0, tick: 0, rng: 1, created: Date.now(), generation: 0, player: { x: 0, z: 8, y: 0, vy: 0, yaw: 0, pitch: 0, hp: 100, hunger: 100, stamina: 100, items: [], hotbar: Array(8).fill(null), selected: 0, armor: null, hitAt: -10, actionAt: -10, potionAt: -20, foodAt: -3, dodgeUntil: 0, poison: 0, curse: 0, slow: 0, healLeft: 0, healRate: 0, bed: null }, nodes: [], buildings: [], enemies: [], projectiles: [], drops: [], previousKills: 0, kills: {}, nightPlan: [], nightWave: 0, blood: false, lastBlood: 0, quests: [], discovered: ['초원'], knownItems: [], unlockedRecipes: starterRecipes(), regionNext: {} };
    s.gameMode = gameMode;
    s.player.flying = false;
    s.rng = hash(s.seed);
    const gen = { rng: hash(s.seed + 'world') };
    const terrain = getTerrain(s);
    const node = (kind: string, x: number, z: number) => {
        const n: NodeState = { id: `node-${s.nodes.length}`, kind, x, z, hp: NODES[kind].hp, depleted: false, readyAt: 0 };
        if (isTree(n)) {
            n.tree = treeTraits(s.seed, n);
            if (Math.hypot(x, z) < 38) n.tree.size = x < 0 ? 'small' : 'normal';
            n.hp = nodeDefinition(n).hp;
        }
        s.nodes.push(n);
    };
    // A reachable supply ring supplies the complete first crafting chain.
    for (let i = 0; i < 14; i++) {
        const angle = i * .9;
        const r = 10 + i * 1.8;
        node(i % 3 === 0 ? 'berry' : i % 3 === 1 ? 'branch' : 'pebble', Math.cos(angle) * r, Math.sin(angle) * r);
        node('fiber', Math.cos(angle + .3) * (r + 3), Math.sin(angle + .3) * (r + 3));
    }
    node('tree', -5, -5);
    node('tree', 8, -8);
    node('iron', 18, -22);
    node('iron', 28, -28);
    node('iron', -25, -22);
    node('iron', -35, -20);
    node('coal', 40, -25);
    for (let i = 0; i < 950; i++) {
        const x = (random(gen) - .5) * 940, z = (random(gen) - .5) * 940;
        if (Math.hypot(x, z) > 465 || Math.hypot(x, z) < 38)
            continue;
        const b = biome(x, z);
        const pools: Record<string, string[]> = { '초원': ['tree', 'berry', 'branch', 'fiber', 'pebble', 'iron', 'wheat'], '숲': ['tree', 'tree', 'hardtree', 'herb', 'mushroom', 'fiber', 'bird', 'crystal'], '습지': ['tree', 'toxic', 'antidote', 'herb', 'mushroom', 'silver'], '바위 언덕': ['rock', 'iron', 'coal', 'silver', 'gold', 'mithril'], '화산': ['rock', 'obsidian', 'sulfur', 'coal', 'crystal'], '유적': ['rock', 'crystal', 'gold', 'mithril', 'herb'] };
        let kind = pools[b][Math.floor(random(gen) * pools[b].length)];
        if (kind === 'bird')
            kind = 'herb';
        const spot = terrain.findResourceSpot(kind, x, z);
        if (spot) node(kind, spot.x, spot.z);
    }
    for (let i = 0; i < 7; i++) {
        const a = i * .95;
        const spot = terrain.findSpawnPoint(Math.cos(a) * 30, Math.sin(a) * 30, 16, true);
        if (spot) s.enemies.push(makeEnemy(s, i % 3 === 0 ? 'sheep' : i % 3 === 1 ? 'cow' : 'bird', 1, spot.x, spot.z, true));
    }
    for (const [kind, x, z] of [['heal_totem', 28, 28], ['challenge_totem', -65, 70], ['forest_altar', 120, 130], ['rock_altar', -20, -260], ['ruin_altar', 0, 300], ['final_altar', 60, 370]] as [
        string,
        number,
        number
    ][]) {
        const spot = terrain.findFlatArea(new Vector2(x, z), 80, .32);
        if (!spot) throw new Error('제단을 배치할 완만한 지형이 없습니다.');
        s.buildings.push({ id: uuid(), kind, x: spot.x, z: spot.z, yaw: 0, hp: 10000, items: [], jobs: [], fuel: 0, cooldown: 0, claimed: false });
    }
    ensureForest(s, biome);
    if (isCreative(s))
        for (const id of ['workbench', 'wall', 'chest', 'mithril_axe', 'mithril_pick', 'mithril_sword', 'strong_bow', 'bag'])
            addItem(s, id, 1);
    return s;
}
export function makeEnemy(s: State, kind: string, tier: number, x: number, z: number, animal = false, summon = false): Enemy {
    const d = MONSTERS[kind], k = tier - d.min;
    const hp = Math.round(d.hp * (1 + .18 * k) * (s.difficulty === 'easy' ? .9 : s.difficulty === 'hard' ? 1.1 : 1));
    const loot = { ...d.loot };
    let lootGear: Enemy["lootGear"];
    if (kind === "archer") {
        delete loot.wood;
        delete loot.rope;
        if (random(s) < .8)
            loot.broken_bow = 1;
        else
            lootGear = [{ id: "bow", dur: 45 }];
    }
    if (kind === 'golem' && random(s) < .15)
        loot.golem_core = 1;
    if (kind === 'wizard') {
        delete loot.heal;
        loot[random(s) < .5 ? 'heal' : 'pain'] = 1;
    }
    if (!animal && !summon && !d.boss) {
        const pools = tier <= 2 ? ['stone', 'fiber', 'bone'] : tier <= 4 ? ['iron_ore', 'coal', 'fiber'] : tier <= 6 ? ['iron_ore', 'silver_ore', 'herb', 'leather'] : tier <= 8 ? ['iron', 'coal', 'gold_ore', 'crystal'] : ['iron', 'coal', 'crystal', 'mithril_ore'];
        const choice = pools[Math.floor(random(s) * pools.length)];
        loot[choice] = (loot[choice] || 0) + (choice.includes('crystal') || choice.includes('mithril') ? 1 : 2);
    }
    return { id: uuid(), kind, tier, x, z, hp, maxhp: hp, state: 'chase', alerted: false, lostFor: 0, timer: 0, loot, animal, summon, night: day(s.time), skill: 0, slow: 0, ...(lootGear ? { lootGear } : {}) };
}
export function stationFor(s: State, station: string, chosen?: string) {
    if (station === 'hand')
        return null;
    return s.buildings.find(b => (b.kind === station || (station === 'furnace' && b.kind === 'advanced_furnace')) && distance(b, s.player) <= 3.5 && (!chosen || b.id === chosen));
}
export function craft(s: State, r: Recipe, chosen?: string): string | null {
    if (isCreative(s))
        return addItem(s, r.output, r.qty) ? null : '인벤토리 공간이 부족합니다.';
    discoverItems(s);
    if (!recipeUnlocked(s, r))
        return "아직 발견하지 않은 재료가 있는 제작법입니다.";
    const b = stationFor(s, r.station, chosen);
    if (r.station !== 'hand' && !b)
        return '해당 제작 시설에서 3m 안으로 이동하세요.';
    if (Object.entries(r.inputs).some(([id, n]) => count(s.player.items, id) < n))
        return '재료가 부족합니다.';
    if (r.seconds && b && b.jobs.length >= 10)
        return '작업 대기열이 가득 찼습니다.';
    const copy = structuredClone(s.player.items);
    for (const [id, n] of Object.entries(r.inputs))
        take(copy, id, n);
    if (r.seconds && b) {
        b.jobs.push({ id: uuid(), recipe: r.id, remaining: r.seconds, reserved: { ...r.inputs } });
    }
    else if (!give(copy, r.output, r.qty, capacity(s)))
        return '인벤토리 공간이 부족합니다.';
    s.player.items = copy;
    discoverItems(s);
    normalizeSlots(s);
    if (!r.seconds) {
        const it = s.player.items.find(i => i.id === r.output);
        const slot = s.player.hotbar.indexOf(null);
        if (it && slot >= 0 && !s.player.hotbar.includes(it.uid))
            s.player.hotbar[slot] = it.uid;
    }
    return null;
}
export function planNight(s: State) {
    const d = day(s.time), c = tierCap(d), extra = Math.min(s.difficulty === 'easy' ? .5 : 1, s.previousKills / 20);
    const mu = Math.min(c, d === 1 ? 1 : Math.max(1, c - 1.5) + extra);
    s.blood = d >= 7 && s.lastBlood !== d - 1 && random(s) < .15;
    if (s.blood)
        s.lastBlood = d;
    let budget = Math.min(60, 8 + 2 * (d - 1)) * (s.blood ? 1.25 : 1) * (s.difficulty === 'easy' ? .85 : s.difficulty === 'hard' ? 1.15 : 1);
    const pickTier = () => {
        const weights = Array.from({ length: c }, (_, i) => Math.exp(-((i + 1 - mu) ** 2) / 2));
        let n = random(s) * weights.reduce((a, b) => a + b, 0);
        return weights.findIndex(w => (n -= w) <= 0) + 1 || c;
    };
    const list: Enemy[] = [makeEnemy(s, 'zombie', Math.min(c, 5), 0, 0)];
    budget -= 1 + .5 * (list[0].tier - 1);
    while (budget >= 1 && list.length < 20) {
        let t = pickTier();
        if (1 + .5 * (t - 1) > budget)
            t = 1;
        let eligible = Object.entries(MONSTERS).filter(([id, m]) => !m.boss && !['cow', 'sheep', 'bird'].includes(id) && m.min <= t && m.max >= t);
        if (list.filter(e => MONSTERS[e.kind].role === 'magic').length >= Math.floor(20 * .2))
            eligible = eligible.filter(([, m]) => m.role !== 'magic');
        if (d < 4)
            eligible = eligible.filter(([, m]) => m.role !== 'magic');
        if (list.filter(e => MONSTERS[e.kind].role === 'ranged').length >= 1 && d <= 3)
            eligible = eligible.filter(([, m]) => m.role !== 'ranged');
        if (list.some(e => e.kind === 'brute'))
            eligible = eligible.filter(([id]) => id !== 'brute');
        if (!eligible.length) {
            t = 1;
            eligible = [['zombie', MONSTERS.zombie]];
        }
        const kind = eligible[Math.floor(random(s) * eligible.length)][0];
        list.push(makeEnemy(s, kind, t, 0, 0));
        budget -= 1 + .5 * (t - 1);
    }
    const maxMagic = Math.floor(list.length * .2), maxRanged = d <= 3 ? 1 : Math.floor(list.length * .25);
    let m = 0, r = 0;
    s.nightPlan = list.filter(e => {
        if (MONSTERS[e.kind].role === 'magic' && ++m > maxMagic)
            return false;
        if (MONSTERS[e.kind].role === 'ranged' && ++r > maxRanged)
            return false;
        return true;
    });
    s.nightWave = 0;
}
export function transactTransfer(from: Stack[], to: Stack[], uid: string, cap: number) {
    const i = from.find(x => x.uid === uid);
    if (!i)
        return false;
    const copy = structuredClone(to);
    if (ITEMS[i.id].max === 1) {
        if (copy.length >= cap)
            return false;
        copy.push(structuredClone(i));
    }
    else if (!give(copy, i.id, i.qty, cap))
        return false;
    to.splice(0, to.length, ...copy);
    from.splice(from.indexOf(i), 1);
    return true;
}
export function validateState(v: unknown): State {
    const s = validateWorldState(v);
    s.gameMode ??= 'survival';
    s.player.flying ??= false;
    migrateTerrain(s);
    ensureForest(s, biome);
    ensureProgression(s);
    ensureAwareness(s);
    normalizeSlots(s);
    return s;
}
