import { ITEMS, MONSTERS, NODES, RECIPES } from './data';
import type { State, Stack } from './model';
import { REGIONS } from './regions';
import { LOST_TARGET_SECONDS } from './awareness';
import { isTree, nodeDefinition, TREE_SIZES, TREE_SPECIES } from './woodland';
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const integer = (v: unknown): v is number => finite(v) && Number.isSafeInteger(v) && v >= 0;
const identity = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128;
const known = (table: object, key: unknown): key is string => typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);
function requireValid(ok: unknown, message: string): asserts ok {
    if (!ok)
        throw new Error(message);
}
/** Validate persisted data before simulation; never mutate the supplied object. */
export function validateWorldState(value: unknown): State {
    requireValid(record(value), '월드 데이터가 없습니다.');
    const s = value as unknown as State;
    requireValid(s.formatVersion === 1 && s.generatorVersion === 1 && s.contentVersion === 1, '지원하지 않는 저장 버전입니다.');
    requireValid(s.terrainVersion === undefined || s.terrainVersion === 1 || s.terrainVersion === 2, '지원하지 않는 지형 버전입니다.');
    requireValid(s.forestVersion === undefined || s.forestVersion === 1, '지원하지 않는 숲 버전입니다.');
    requireValid(identity(s.id) && typeof s.name === 'string' && s.name.length <= 40 && typeof s.seed === 'string' && s.seed.length <= 64 && finite(s.time) && s.time >= 0 && integer(s.tick) && integer(s.generation) && integer(s.rng) && s.rng <= 0xffffffff && finite(s.created), '월드 정보가 손상되었습니다.');
    requireValid(['easy', 'normal', 'hard'].includes(s.difficulty) && ['normal', 'permadeath'].includes(s.mode) && ['alive', 'dead', 'ended'].includes(s.status), '게임 모드가 잘못되었습니다.');
    requireValid(s.gameMode === undefined || s.gameMode === 'survival' || s.gameMode === 'creative', '플레이 모드가 잘못되었습니다.');
    for (const key of ['nodes', 'buildings', 'enemies', 'projectiles', 'drops', 'nightPlan', 'quests', 'discovered'] as const)
        requireValid(Array.isArray(s[key]) && s[key].length <= 10000, '엔티티 수가 잘못되었습니다.');
    const p = s.player;
    requireValid(record(p) && finite(p.x) && finite(p.z) && finite(p.y) && Math.abs(p.x) <= 512 && Math.abs(p.z) <= 512, '플레이어 좌표가 잘못되었습니다.');
    requireValid((p.flying === undefined || typeof p.flying === 'boolean') && (!p.flying || s.gameMode === 'creative'), '비행 상태가 잘못되었습니다.');
    for (const key of ['hp', 'hunger', 'stamina', 'vy', 'yaw', 'pitch', 'hitAt', 'actionAt', 'potionAt',
        'foodAt', 'dodgeUntil', 'poison', 'curse', 'slow', 'healLeft', 'healRate'] as const)
        requireValid(finite(p[key]), '플레이어 상태가 잘못되었습니다.');
    for (const key of ['hp', 'hunger', 'stamina'] as const)
        requireValid(p[key] >= 0 && p[key] <= 100, '플레이어 수치가 범위를 벗어났습니다.');
    if(p.staminaAt!==undefined)requireValid(finite(p.staminaAt)&&p.staminaAt>=0&&p.staminaAt<=s.time,'스태미나 회복 시간이 잘못되었습니다.');
    for (const [key, max] of [['poisonResist', 10], ['stagger', .6]] as const)
        if (p[key] !== undefined)
            requireValid(finite(p[key]) && p[key]! >= 0 && p[key]! <= max, '상태이상 시간이 잘못되었습니다.');
    requireValid(Array.isArray(p.hotbar) && p.hotbar.length === 8 && p.hotbar.every(id => id === null || identity(id)) && integer(p.selected) && p.selected < 8 && (p.armor === null || identity(p.armor)) && (p.bed === null || identity(p.bed)), '퀵슬롯이 잘못되었습니다.');
    const stackIds = new Set<string>();
    const stacks = (items: Stack[], limit: number) => {
        requireValid(Array.isArray(items) && items.length <= limit, '보관함 크기가 잘못되었습니다.');
        for (const it of items) {
            requireValid(record(it) && known(ITEMS, it.id) && identity(it.uid) && integer(it.qty) && it.qty > 0 && it.qty <= ITEMS[it.id].max && !stackIds.has(it.uid), '아이템이 중복되거나 잘못되었습니다.');
            stackIds.add(it.uid);
            const def = ITEMS[it.id];
            if (def.durability)
                requireValid(finite(it.dur) && it.dur >= 0 && it.dur <= def.durability, '내구도가 잘못되었습니다.');
            if (it.charge !== undefined)
                requireValid(integer(it.charge) && it.charge <= 20, '마력 충전이 잘못되었습니다.');
        }
    };
    stacks(p.items, 32);
    if (p.fishing !== undefined) {
        const f = p.fishing;
        requireValid(record(f) && identity(f.uid) && p.items.some(it => it.uid === f.uid && it.id === 'fishing_rod') && finite(f.x) && finite(f.z) && Math.abs(f.x) <= 512 && Math.abs(f.z) <= 512 && finite(f.remaining) && f.remaining >= 0 && f.remaining <= 7 && typeof f.success === 'boolean', '낚시 작업이 잘못되었습니다.');
    }
    if (s.knownItems !== undefined)
        requireValid(Array.isArray(s.knownItems) && s.knownItems.length <= Object.keys(ITEMS).length && new Set(s.knownItems).size === s.knownItems.length && s.knownItems.every(id => known(ITEMS, id)), '재료 발견 기록이 잘못되었습니다.');
    if (s.unlockedRecipes !== undefined)
        requireValid(Array.isArray(s.unlockedRecipes) && s.unlockedRecipes.length <= RECIPES.length && new Set(s.unlockedRecipes).size === s.unlockedRecipes.length && s.unlockedRecipes.every(id => RECIPES.some(r => r.id === id)), '제작법 해금 기록이 잘못되었습니다.');
    if (s.regionNext !== undefined)
        requireValid(record(s.regionNext) && Object.entries(s.regionNext).every(([region, at]) => REGIONS.includes(region) && finite(at) && at >= 0), '지역 스폰 시간이 잘못되었습니다.');
    const entityIds = new Set<string>();
    for (const entity of [...s.nodes, ...s.buildings, ...s.enemies, ...s.projectiles, ...s.drops, ...s.nightPlan]) {
        requireValid(record(entity) && identity(entity.id) && !entityIds.has(entity.id) && finite(entity.x) && finite(entity.z) && Math.abs(entity.x) <= 600 && Math.abs(entity.z) <= 600, '엔티티 참조가 잘못되었습니다.');
        entityIds.add(entity.id);
    }
    for (const n of s.nodes) {
        requireValid(known(NODES, n.kind) && finite(n.hp) && finite(n.readyAt) && typeof n.depleted === 'boolean', '자원 정보가 손상되었습니다.');
        if (n.tree !== undefined) {
            const t = n.tree;
            requireValid(isTree(n) && record(t) && known(TREE_SIZES, t.size) && known(TREE_SPECIES, t.species) && typeof t.autumn === 'boolean' && (t.variant === 0 || t.variant === 1) && !(t.species === 'pine' && t.autumn), '나무 상태가 잘못되었습니다.');
            requireValid(n.hp >= 0 && n.hp <= nodeDefinition(n).hp && (!n.depleted || n.hp === 0), '나무 내구도가 잘못되었습니다.');
        }
    }
    const jobIds = new Set<string>();
    for (const b of s.buildings) {
        requireValid((known(ITEMS, b.kind) && ITEMS[b.kind].kind === 'building') || ['heal_totem', 'challenge_totem', 'forest_altar', 'rock_altar', 'ruin_altar', 'final_altar'].includes(b.kind), '구조물 종류가 없습니다.');
        requireValid(finite(b.hp) && finite(b.yaw) && finite(b.fuel) && b.fuel >= 0 && Array.isArray(b.jobs) && b.jobs.length <= 10, '시설 상태가 잘못되었습니다.');
        for (const key of ['grownAt', 'cooldown'] as const)
            if (b[key] !== undefined)
                requireValid(finite(b[key]), '시설 시간이 잘못되었습니다.');
        if (b.crop !== undefined)
            requireValid(b.kind === 'plot' && ['wheat', 'herb'].includes(b.crop), '작물이 잘못되었습니다.');
        if (b.claimed !== undefined)
            requireValid(typeof b.claimed === 'boolean', '토템 상태가 잘못되었습니다.');
        stacks(b.items, 100);
        for (const j of b.jobs) {
            requireValid(record(j) && identity(j.id) && !jobIds.has(j.id), '제작 작업이 중복되거나 잘못되었습니다.');
            jobIds.add(j.id);
            const recipe = RECIPES.find(r => r.id === j.recipe);
            requireValid(recipe && recipe.seconds > 0 && (recipe.station === b.kind || (recipe.station === 'furnace' && b.kind === 'advanced_furnace')) && finite(j.remaining) && j.remaining >= 0 && j.remaining <= recipe.seconds && record(j.reserved) && Object.keys(j.reserved).length === Object.keys(recipe.inputs).length && Object.entries(recipe.inputs).every(([id, qty]) => Object.prototype.hasOwnProperty.call(j.reserved, id) && j.reserved[id] === qty), '제작 예약 재료가 잘못되었습니다.');
        }
    }
    for (const e of [...s.enemies, ...s.nightPlan]) {
        requireValid(known(MONSTERS, e.kind), '적 종류가 잘못되었습니다.');
        const def = MONSTERS[e.kind];
        requireValid((e.alerted === undefined || typeof e.alerted === 'boolean') && (e.lostFor === undefined || (finite(e.lostFor) && e.lostFor >= 0 && e.lostFor <= LOST_TARGET_SECONDS)) && (e.alerted !== false || !e.lostFor) && (!e.animal || (!e.alerted && !e.lostFor)), '적 식별 상태가 잘못되었습니다.');
        requireValid(integer(e.tier) && e.tier >= def.min && e.tier <= def.max && finite(e.hp) && finite(e.maxhp) && e.maxhp > 0 && e.hp <= e.maxhp && finite(e.timer) && finite(e.skill) && finite(e.slow) && ['chase', 'windup', 'recover'].includes(e.state) && typeof e.animal === 'boolean' && typeof e.summon === 'boolean' && integer(e.night) && (e.owner === undefined || identity(e.owner)) && (e.vulnerable === undefined || finite(e.vulnerable)), '적 상태가 잘못되었습니다.');
        requireValid(record(e.loot) && Object.entries(e.loot).every(([id, qty]) => known(ITEMS, id) && integer(qty) && qty > 0 && qty <= 100), '전리품이 잘못되었습니다.');
        for (const [key, max] of [['poison', 5], ['burn', 4], ['dotTick', 1]] as const)
            if (e[key] !== undefined)
                requireValid(finite(e[key]) && e[key]! >= 0 && e[key]! <= max, '적 상태이상이 잘못되었습니다.');
        if (e.region !== undefined)
            requireValid(REGIONS.includes(e.region) && !e.animal && !def.boss && e.night === 0, '지역 몬스터가 잘못되었습니다.');
        if (e.lootGear !== undefined)
            requireValid(Array.isArray(e.lootGear) && e.lootGear.length <= 4 && e.lootGear.every(it => record(it) && known(ITEMS, it.id) && ITEMS[it.id].durability && finite(it.dur) && it.dur >= 0 && it.dur <= ITEMS[it.id].durability!), '장비 전리품이 잘못되었습니다.');
    }
    for (const d of s.drops) {
        stacks(d.items, 100);
        requireValid(finite(d.expires) && typeof d.bag === 'boolean', '드랍 상태가 잘못되었습니다.');
    }
    for (const q of s.projectiles) {
        for (const key of ['y', 'vx', 'vy', 'vz', 'life', 'damage'] as const)
            requireValid(finite(q[key]), '투사체가 잘못되었습니다.');
        requireValid(typeof q.enemy === 'boolean' && q.damage >= 0 && (q.enemy ? known(MONSTERS, q.type) : ['pain', 'arrow', 'silver_arrow', 'poison_arrow', 'blast_arrow', 'fire_staff', 'frost_staff'].includes(q.type)), '투사체 종류가 잘못되었습니다.');
    }
    requireValid(integer(s.previousKills) && record(s.kills) && Object.entries(s.kills).every(([id, qty]) => known(MONSTERS, id) && integer(qty) && qty <= 8) && integer(s.nightWave) && s.nightWave <= 3 && typeof s.blood === 'boolean' && integer(s.lastBlood), '처치 집계가 잘못되었습니다.');
    requireValid(s.quests.every(q => ['forest', 'rock', 'ruin', 'night'].includes(q)) && s.discovered.every(region => ['초원', '숲', '습지', '바위 언덕', '화산', '유적'].includes(region)), '진행 정보가 잘못되었습니다.');
    return structuredClone(s);
}
