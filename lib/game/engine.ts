import type { VisualEvent } from './visual-events';
import { isDryLand, nearFishingWater } from './ground';
import { migrateTerrain, getTerrain } from './terrain';
import type { TerrainManager } from './world/TerrainManager';
import type { TerrainDebugMode } from './world/types';
import { ensureForest, isTree, nodeDefinition, nodeRadius } from './woodland';
import { discoverItems, ensureProgression } from './progression';
import { REGION_ENEMIES, regionWarning } from './regions';
import { segmentSphere } from './collision';
import { SaveQueue } from './save-queue';
import { alertEnemy, ensureAwareness, updateAwareness } from './awareness';
import { ITEMS, MONSTERS, RECIPES, day, phase, type Recipe } from './data';
import { addItem, capacity, count, craft, distance, height, normalizeSlots, makeEnemy, random, planNight, give, take, selected, stationFor, transactTransfer, uuid, biome, type State, type Building, type Stack, type Enemy } from './model';
import { SaveManager, exportFile } from './storage';
import { isCreative, type GameMode } from './model';
import { executeGameCommand, type CommandResult } from './commands';
export type Target = {
    kind: 'node' | 'enemy' | 'building' | 'drop';
    id: string;
    distance: number;
} | null;
export class Engine {
    state: State;
    readonly terrain: TerrainManager;
    terrainDebugMode: TerrainDebugMode = 'off';
    storage: SaveManager;
    paused = true;
    panel: 'pause' | 'inventory' | 'craft' | 'map' | 'facility' | 'death' | 'help' | 'console' | null = null;
    facility: string | null = null;
    keys = new Set<string>();
    commandHistory: string[] = [];
    commandLog: { input: string; result: CommandResult }[] = [];
    target: Target = null;
    notices: {
        id: number;
        text: string;
        until: number;
    }[] = [];
    saveLabel = '아직 저장하지 않음';
    savedAt = 0;
    dirty = true;
    error = '';
    saveAccessLost = false;
    onChange: () => void = () => {
    };
    onHit: () => void = () => {
    };
    onAttack: () => void = () => {
    };
    onVisual: (event: VisualEvent) => void = () => {
    };
    /** Cosmetic callbacks must not interrupt inventory or damage transactions. */
    visual(event: VisualEvent) {
        try {
            this.onVisual(event);
        }
        catch {
        }
    }
    onSave: () => void = () => {
    };
    blocking = false;
    disposed = false;
    private saveQueue = new SaveQueue();
    private autosave = 0;
    private uiTick = 0;
    private lastStamina = 0;
    private attackPressed = false;
    private handleLockLoss = () => {
        if (this.disposed) return;
        this.saveAccessLost = true;
        this.pause('pause');
        this.error = '월드 사용 권한이 변경되었습니다. 파일 백업 후 메뉴로 돌아가 다시 여세요.';
        this.notify(this.error);
    };
    constructor(s: State, storage: SaveManager) {
        migrateTerrain(s);
        ensureForest(s, biome);
        ensureProgression(s);
        ensureAwareness(s);
        s.gameMode ??= 'survival';
        s.player.flying ??= false;
        this.state = s;
        this.terrain = getTerrain(s);
        this.lastStamina = s.player.staminaAt ?? 0;
        this.storage = storage;
        this.panel = s.status === 'alive' ? 'pause' : 'death';
        if (s.generation > 0)
            this.saveLabel = '저장본 복원 완료';
        this.storage.lockLost = this.handleLockLoss;
    }
    notify(text: string) {
        this.notices.push({ id: Date.now() + Math.random(), text, until: Date.now() + 4200 });
        this.notices = this.notices.slice(-4);
        this.onChange();
    }
    pause(panel: Engine['panel'] = 'pause') {
        this.paused = true;
        this.panel = panel;
        this.keys.clear();
        this.blocking = false;
        if (typeof document !== 'undefined' && document.pointerLockElement)
            document.exitPointerLock();
        this.onChange();
    }
    resume() {
        if (this.disposed || this.saveAccessLost || this.state.status !== 'alive')
            return false;
        this.panel = null;
        this.paused = false;
        this.onChange();
        return true;
    }
    get creative() { return isCreative(this.state); }
    get canModify() { return !this.disposed && !this.saveAccessLost && this.state.status === 'alive'; }
    async command(input: string) {
        const result = await executeGameCommand(this, input);
        this.commandHistory = [...this.commandHistory, input].slice(-40);
        this.commandLog = [...this.commandLog, { input, result }].slice(-30);
        this.onChange();
        return result;
    }
    setGameMode(mode: GameMode) {
        if (!this.canModify || !['survival', 'creative'].includes(mode)) return false;
        const s = this.state;
        s.gameMode = mode;
        s.player.flying = false;
        s.player.vy = 0;
        s.nightPlan = [];
        s.nightWave = 0;
        s.blood = false;
        if (this.creative) {
            this.restoreVitals();
            for (const it of s.player.items) {
                if (ITEMS[it.id].durability) it.dur = ITEMS[it.id].durability;
                if (it.id.endsWith('_staff')) it.charge = 5;
            }
            s.projectiles = s.projectiles.filter(q => !q.enemy);
        }
        else if (phase(s.time) === '밤') planNight(s);
        this.dirty = true;
        this.notify(mode === 'creative' ? '크리에이티브 모드 · Tab에서 모든 아이템을 꺼낼 수 있습니다.' : '생존 모드 · 기존 난이도와 사망 규칙이 적용됩니다.');
        return true;
    }
    toggleFlight(enabled = !this.state.player.flying) {
        if (!this.canModify || !this.creative) return false;
        this.state.player.flying = enabled;
        this.state.player.vy = 0;
        this.state.player.fishing = undefined;
        this.dirty = true;
        this.notify(enabled ? '비행 켜짐 · Space 상승 / Ctrl 하강 / Shift 가속' : '비행 꺼짐');
        return true;
    }
    restoreVitals() {
        if (!this.canModify) return false;
        Object.assign(this.state.player, { hp: 100, hunger: 100, stamina: 100, poison: 0, curse: 0, slow: 0, stagger: 0, healLeft: 0, healRate: 0 });
        this.dirty = true;
        this.onChange();
        return true;
    }
    giveItem(id: string, qty: number) {
        if (!this.canModify || !addItem(this.state, id, qty)) return false;
        if (this.creative && id.endsWith('_staff'))
            for (const item of this.state.player.items.filter(it => it.id === id)) item.charge = 5;
        this.dirty = true;
        this.onChange();
        return true;
    }
    discardItem(uid: string) {
        if (!this.canModify || !this.creative) return;
        this.state.player.items = this.state.player.items.filter(it => it.uid !== uid);
        normalizeSlots(this.state);
        this.dirty = true;
        this.onChange();
    }
    removeTarget() {
        if (!this.canModify || !this.creative || !this.target || this.target.distance > 5) return;
        const s = this.state, target = this.target;
        if (target.kind === 'node') {
            const node = s.nodes.find(n => n.id === target.id);
            if (!node || node.depleted) return;
            node.depleted = true; node.hp = 0; node.readyAt = 0;
        }
        else if (target.kind === 'building') {
            const building = s.buildings.find(b => b.id === target.id);
            if (!building || !Object.hasOwn(ITEMS, building.kind)) return;
            this.breakBuilding(building);
            if (s.player.bed === building.id) s.player.bed = null;
        }
        else return;
        this.target = null;
        this.dirty = true;
        this.notify('철거 완료 · 보관 중이던 물품은 바닥 가방에 남습니다.');
    }
    setTime(withinDay: number) {
        if (!this.canModify || !Number.isInteger(withinDay) || withinDay < 0 || withinDay >= 720) return false;
        const s = this.state, p = s.player, delta = Math.floor(s.time / 720) * 720 + withinDay - s.time;
        const shift = (at: number) => at === 0 ? 0 : Math.max(.001, at + delta);
        for (const key of ['hitAt', 'actionAt', 'foodAt', 'potionAt'] as const) p[key] += delta;
        p.dodgeUntil = shift(p.dodgeUntil);
        if (p.staminaAt !== undefined) p.staminaAt = Math.max(0, p.staminaAt + delta);
        this.lastStamina = Math.max(0, this.lastStamina + delta);
        for (const node of s.nodes) node.readyAt = shift(node.readyAt);
        for (const building of s.buildings)
            for (const key of ['grownAt', 'cooldown'] as const)
                if (building[key] !== undefined) building[key] = shift(building[key]!);
        for (const drop of s.drops) drop.expires = shift(drop.expires);
        for (const enemy of s.enemies) if (enemy.vulnerable !== undefined) enemy.vulnerable = shift(enemy.vulnerable);
        for (const region of Object.keys(s.regionNext || {})) s.regionNext![region] = Math.max(0, s.regionNext![region] + delta);
        s.time += delta;
        s.nightPlan = []; s.nightWave = 0; s.blood = false;
        if (!this.creative && phase(s.time) === '밤') planNight(s);
        else s.enemies = s.enemies.filter(e => e.animal || MONSTERS[e.kind].boss || e.night === 0);
        this.dirty = true;
        this.onChange();
        return true;
    }
    selectSlot(index: number) {
        if (!this.canModify || !Number.isInteger(index) || index < 0 || index >= 8) return;
        this.state.player.selected = index;
        this.dirty = true;
        this.onChange();
    }
    bind(uid: string) {
        if (!this.canModify) return;
        const i = this.state.player.items.find(x => x.uid === uid);
        if (!i)
            return;
        if (ITEMS[i.id].kind === 'armor' && i.id !== 'bag') {
            this.state.player.armor = uid;
            this.notify(`${ITEMS[i.id].name} 착용`);
        }
        else {
            this.state.player.hotbar[this.state.player.selected] = uid;
            this.notify(`${this.state.player.selected + 1}번 슬롯: ${ITEMS[i.id].name}`);
        }
        this.dirty = true;
        this.onChange();
    }
    useItem(uid?: string) {
        const s = this.state, p = s.player, it = uid ? p.items.find(i => i.uid === uid) : selected(s);
        if (!it || !this.canModify)
            return;
        const d = ITEMS[it.id];
        if (!['food', 'potion'].includes(d.kind))
            return;
        if (d.kind === 'food') {
            if (!this.creative && s.time - p.foodAt < 2)
                return;
            p.foodAt = s.time;
            p.hunger = Math.min(100, p.hunger + (d.food || 0));
            // Consume before damage so a lethal meal is not returned in the death bag.
            if (!this.creative) take(p.items, it.id, 1);
            if ((d.heal || 0) < 0)
                this.hurt(-d.heal!);
            else if (d.heal && p.healLeft < 5) {
                p.healLeft = 5;
                p.healRate = d.heal / 5;
            }
            if (!this.creative && it.id === 'raw_meat' && random(s) < .2) {
                p.slow = Math.max(p.slow, 10);
                this.notify('날고기를 먹고 탈이 났습니다.');
            }
            this.notify(`${d.name} 사용`);
        }
        else if (d.kind === 'potion') {
            if (!this.creative && s.time - p.potionAt < 15) {
                this.notify('물약을 다시 사용할 때까지 기다리세요.');
                return;
            }
            if (it.id === 'heal') {
                p.hp = Math.min(100, p.hp + 35);
            }
            if (it.id === 'bandage') {
                if (!this.creative && s.time - p.hitAt < 5) {
                    this.notify('안전한 곳에서 붕대를 사용하세요.');
                    return;
                }
                p.healLeft = 6;
                p.healRate = 20 / 6;
            }
            if (it.id === 'antidote') {
                p.poison = 0;
                p.poisonResist = 10;
            }
            if (it.id === 'purify')
                p.curse = 0;
            if (it.id === 'pain') {
                s.projectiles.push({ id: uuid(), x: p.x, y: height(p.x, p.z, s) + p.y + 1.6, z: p.z, vx: -Math.sin(p.yaw) * Math.cos(p.pitch) * 14, vy: Math.sin(p.pitch) * 14, vz: -Math.cos(p.yaw) * Math.cos(p.pitch) * 14, life: 4, damage: 0, enemy: false, type: 'pain' });
            }
            if (!this.creative) take(p.items, it.id, 1);
            p.potionAt = s.time;
            this.notify(`${d.name} 사용`);
        }
        this.visual({ type: 'action', action: 'consume', item: it.id });
        discoverItems(s);
        normalizeSlots(s);
        this.dirty = true;
        this.onChange();
    }
    interact() {
        if (!this.canModify) return;
        const s = this.state, t = this.target;
        if (!t || t.distance > 3.5) {
            const it = selected(s);
            if (it && ITEMS[it.id].kind === 'building')
                this.place(it);
            return;
        }
        if (t.kind === 'drop') {
            const d = s.drops.find(x => x.id === t.id);
            if (!d)
                return;
            for (const it of [...d.items])
                transactTransfer(d.items, s.player.items, it.uid, capacity(s));
            if (!d.items.length)
                s.drops = s.drops.filter(x => x !== d);
            else
                this.notify('가방이 가득 찼습니다.');
            normalizeSlots(s);
            this.dirty = true;
        }
        else if (t.kind === 'node') {
            this.gather();
        }
        else if (t.kind === 'building') {
            const b = s.buildings.find(x => x.id === t.id)!;
            if (b.kind.endsWith('_altar')) {
                this.summon(b);
                return;
            }
            if (b.kind === 'heal_totem') {
                if (s.time < (b.cooldown || 0)) {
                    this.notify('토템이 아직 회복 중입니다.');
                    return;
                }
                b.cooldown = s.time + 720;
                s.player.healLeft = 20;
                s.player.healRate = 2;
                this.notify('치유 토템을 활성화했습니다.');
                this.dirty = true;
            }
            else if (b.kind === 'challenge_totem') {
                if (b.claimed) {
                    this.notify('이 토템의 보상은 이미 받았습니다.');
                    return;
                }
                if (s.enemies.some(e => e.owner === 'challenge')) {
                    this.notify('도전 중인 적을 처치하세요.');
                    return;
                }
                for (let k = 0; k < 3; k++) {
                    const foe = makeEnemy(s, k === 2 ? 'guard' : 'zombie', 3, b.x + 6 + Math.sin(k) * 2, b.z + Math.cos(k) * 3);
                    foe.owner = 'challenge';
                    s.enemies.push(foe);
                }
                this.notify('토템 도전 시작 · 적 3마리를 처치하세요.');
                this.dirty = true;
            }
            else if (b.kind === 'bedroll') {
                s.player.bed = b.id;
                this.notify('이 침낭을 부활 지점으로 설정했습니다.');
                this.dirty = true;
            }
            else if (b.kind === 'plot') {
                if (b.crop && s.time >= (b.grownAt || 0)) {
                    const harvest = structuredClone(s.player.items);
                    if (!give(harvest, b.crop, 3, capacity(s)) || !give(harvest, b.crop === 'wheat' ? 'seed' : 'herb_seed', 1, capacity(s))) {
                        this.notify('수확 공간을 확보하세요.');
                        return;
                    }
                    s.player.items = harvest;
                    b.crop = undefined;
                    this.notify('작물을 수확했습니다.');
                }
                else if (!b.crop) {
                    const seed = count(s.player.items, 'seed') ? 'seed' : count(s.player.items, 'herb_seed') ? 'herb_seed' : this.creative ? 'seed' : null;
                    if (!seed) {
                        this.notify('밀 또는 약초 씨앗이 필요합니다.');
                        return;
                    }
                    if (!this.creative) take(s.player.items, seed, 1);
                    b.crop = seed === 'seed' ? 'wheat' : 'herb';
                    b.grownAt = s.time + 1440;
                    this.notify('씨앗을 심었습니다.');
                }
                else
                    this.notify(`수확까지 ${Math.ceil(((b.grownAt || 0) - s.time) / 60)}분`);
                this.dirty = true;
            }
            else if (b.kind === 'trap') {
                if (s.time >= (b.grownAt || s.time + 1)) {
                    if (!addItem(s, 'raw_meat', 1)) {
                        this.notify('회수 공간이 필요합니다.');
                        return;
                    }
                    b.grownAt = undefined;
                    this.notify('덫에서 고기를 회수했습니다.');
                }
                else if (!b.grownAt && (this.creative || take(s.player.items, 'rotten', 1))) {
                    b.grownAt = s.time + 120;
                    this.notify('덫에 미끼를 넣었습니다.');
                }
                else
                    this.notify('썩은 고기 미끼가 필요하거나 포획을 기다려야 합니다.');
                this.dirty = true;
            }
            else {
                this.facility = b.id;
                this.pause('facility');
            }
        }
        this.onChange();
    }
    gather() {
        if (!this.canModify) return;
        const s = this.state, t = this.target;
        if (!t || t.kind !== 'node' || t.distance > 3.8 || s.time - s.player.actionAt < .5)
            return;
        const n = s.nodes.find(n => n.id === t.id);
        if (!n || n.depleted)
            return;
        const d = nodeDefinition(n), it = selected(s), tool = it ? ITEMS[it.id] : undefined;
        if (!this.creative && d.level > 0 && (!tool || tool.tool !== d.tool || (tool.level || 0) < d.level)) {
            this.notify(`필요 도구: ${d.tool === 'pick' ? '곡괭이' : '도끼'} 단계 ${d.level}`);
            return;
        }
        if (!this.creative && it && tool?.durability && it.dur === 0) {
            this.notify('도구를 수리하세요.');
            return;
        }
        const damage = this.creative ? n.hp : tool?.tool === d.tool ? (isTree(n) ? 1 + (tool?.level || 1) * 2 : 3) : 1;
        if (n.hp <= damage) {
            const items = structuredClone(s.player.items);
            if (!give(items, d.item, d.qty, capacity(s))) {
                this.notify('인벤토리 공간이 부족합니다.');
                return;
            }
            s.player.items = items;
            n.hp = 0;
            n.depleted = true;
            n.readyAt = d.regen ? s.time + d.regen : 0;
            normalizeSlots(s);
            this.notify(`${ITEMS[d.item].name} +${d.qty}`);
            if (isTree(n) && random(s) < .5)
                addItem(s, 'resin', 1);
            if (n.kind === 'wheat' || n.kind === 'herb') {
                if (random(s) < .25)
                    addItem(s, n.kind === 'wheat' ? 'seed' : 'herb_seed', 1);
            }
        }
        else {
            n.hp -= damage;
        }
        const current = it ? s.player.items.find(x => x.uid === it.uid) : undefined;
        if (!this.creative && current?.dur !== undefined)
            current.dur = Math.max(0, current.dur - 1);
        s.player.actionAt = s.time;
        this.onAttack();
        this.visual({ type: 'action', action: 'gather', item: it?.id || 'hand' });
        this.visual({ type: 'gather', id: n.id, kind: n.kind, x: n.x, z: n.z });
        this.dirty = true;
    }
    place(it: Stack) {
        if (!this.canModify || ITEMS[it.id]?.kind !== 'building' || !this.state.player.items.some(i => i.uid === it.uid)) return;
        const s = this.state, p = s.player, x = p.x - Math.sin(p.yaw) * 3, z = p.z - Math.cos(p.yaw) * 3;
        if (this.creative && s.buildings.length >= 500) { this.notify('구조물은 한 월드에 최대 500개까지 배치할 수 있습니다.'); return; }
        if (Math.hypot(x, z) > 465 || s.buildings.some(b => distance(b, { x, z }) < 2.2) || s.nodes.some(n => !n.depleted && (isTree(n) || n.kind === 'rock') && distance(n, { x, z }) < (isTree(n) ? nodeRadius(n) + 1.1 : 1.5))) {
            this.notify('다른 물체와 겹쳐 배치할 수 없습니다.');
            return;
        }
        if (!isDryLand(x, z, s, 1.2)) { this.notify('물가에서 떨어진 마른 지면에 배치하세요.'); return; }
        if (!this.terrain.canBuildAt(x, z)) {
            this.notify('경사가 완만한 지면에 배치하세요.');
            return;
        }
        const b: Building = { id: uuid(), kind: it.id, x, z, yaw: p.yaw, hp: it.id === 'wall' ? 250 : 200, items: [], jobs: [], fuel: 0 };
        s.buildings.push(b);
        this.visual({ type: 'action', action: 'place', item: it.id });
        if (!this.creative) take(p.items, it.id, 1);
        if (it.id === 'bedroll')
            p.bed = b.id;
        discoverItems(s);
        normalizeSlots(s);
        this.dirty = true;
        this.notify(`${ITEMS[it.id].name} 배치`);
    }
    craftRecipe(r: Recipe) {
        if (!this.canModify) return;
        const err = craft(this.state, r, this.panel === 'facility' ? this.facility || undefined : undefined);
        if (err)
            this.notify(err);
        else {
            this.dirty = true;
            this.notify(r.seconds && !this.creative ? '작업 대기열에 추가했습니다.' : `${ITEMS[r.output].name} 제작 완료`);
        }
        this.onChange();
    }
    transfer(uid: string, deposit: boolean) {
        if (!this.canModify) return;
        const b = this.state.buildings.find(b => b.id === this.facility);
        if (!b)
            return;
        const ok = deposit ? transactTransfer(this.state.player.items, b.items, uid, 24) : transactTransfer(b.items, this.state.player.items, uid, capacity(this.state));
        if (!ok)
            this.notify('보관 공간이 부족합니다.');
        discoverItems(this.state);
        normalizeSlots(this.state);
        this.dirty = true;
        this.onChange();
    }
    fuel(id: string) {
        if (!this.canModify) return;
        const b = this.state.buildings.find(b => b.id === this.facility);
        if (b && ['wood', 'coal', 'charcoal'].includes(id) && (this.creative || take(this.state.player.items, id, 1))) {
            b.fuel += id === 'coal' ? 40 : id === 'charcoal' ? 20 : 10;
            discoverItems(this.state);
            normalizeSlots(this.state);
            this.dirty = true;
            this.onChange();
        }
    }
    cancelJob(jobId: string) {
        if (!this.canModify) return;
        const b = this.state.buildings.find(b => b.id === this.facility), j = b?.jobs.find(j => j.id === jobId);
        if (!b || !j)
            return;
        const arr = structuredClone(this.state.player.items);
        for (const [id, n] of Object.entries(j.reserved))
            if (!give(arr, id, n, capacity(this.state))) {
                this.notify('재료를 반환할 공간이 부족합니다.');
                return;
            }
        this.state.player.items = arr;
        discoverItems(this.state);
        b.jobs = b.jobs.filter(x => x !== j);
        this.dirty = true;
        this.onChange();
    }
    repair(uid: string) {
        if (!this.canModify) return;
        const s = this.state, it = s.player.items.find(i => i.uid === uid);
        if (!it || it.dur === undefined)
            return;
        const d = ITEMS[it.id];
        if (this.creative) {
            it.dur = d.durability;
            this.dirty = true;
            this.notify('장비를 완전히 수리했습니다.');
            return;
        }
        const station = (d.level || 0) > 1 ? 'anvil' : 'workbench';
        if (!stationFor(s, station)) {
            this.notify(`${station === 'anvil' ? '모루' : '제작대'}가 가까이 있어야 합니다.`);
            return;
        }
        if (it.dur >= d.durability!)
            return;
        const inputs: Record<string, number> = it.id === 'bow' && it.dur <= 45 ? { wood: 2, rope: 1 } : { [it.id.startsWith('iron') ? 'iron' : it.id.startsWith('steel') ? 'steel' : it.id.startsWith('mithril') ? 'mithril' : it.id.includes('obsidian') ? 'obsidian' : d.tool ? 'stone' : 'wood']: 1 };
        if (Object.entries(inputs).some(([id, n]) => count(s.player.items, id) < n)) {
            this.notify('수리 재료가 부족합니다.');
            return;
        }
        for (const [id, n] of Object.entries(inputs))
            take(s.player.items, id, n);
        it.dur = Math.min(d.durability!, it.dur + Math.ceil(d.durability! * .25));
        this.dirty = true;
        this.notify('장비를 수리했습니다.');
        this.onChange();
    }
    attack() {
        if (!this.canModify) return;
        const s = this.state, p = s.player, it = selected(s), d = it ? ITEMS[it.id] : null;
        if ((p.stagger || 0) > 0 || p.fishing || s.time - p.actionAt < (d?.interval || .6))
            return;
        if (d?.kind === 'food' || d?.kind === 'potion') {
            this.useItem();
            return;
        }
        if (d?.kind === 'building') {
            this.place(it!);
            return;
        }
        if (it?.id === 'fishing_rod') {
            if (!nearFishingWater(p.x, p.z, s)) {
                this.notify('강·연못 또는 해안 가까이에서 낚싯대를 사용하세요.');
                return;
            }
            p.actionAt = s.time;
            p.fishing = { uid: it.uid, x: p.x, z: p.z, remaining: 7, success: random(s) < .7 };
            this.notify('낚시 시작 · 7초 동안 낚싯대를 들고 기다리세요.');
            this.dirty = true;
            return;
        }
        if (!this.creative && d?.durability && it?.dur === 0) {
            this.notify('파손된 장비는 사용할 수 없습니다.');
            return;
        }
        if (this.target?.kind === 'node') {
            this.gather();
            return;
        }
        p.actionAt = s.time;
        if (it?.id.includes('bow') || it?.id.endsWith('_staff')) {
            let type = 'arrow';
            if (it.id.endsWith('_staff')) {
                if ((it.charge || 0) === 0) {
                    if (!this.creative && !take(p.items, 'magic_stone', 1)) {
                        this.notify('마력석이 필요합니다.');
                        return;
                    }
                    it.charge = 5;
                }
                if (!this.creative) it.charge!--;
                type = it.id;
            }
            else {
                type = ['blast_arrow', 'poison_arrow', 'silver_arrow', 'arrow'].find(id => count(p.items, id) > 0) || (this.creative ? 'arrow' : '');
                if (!type) {
                    this.notify('화살이 필요합니다.');
                    return;
                }
                if (!this.creative) take(p.items, type, 1);
            }
            const y = height(p.x, p.z, s) + p.y + 1.6, sp = type === 'arrow' || type.endsWith('arrow') ? 32 : 18;
            s.projectiles.push({ id: uuid(), x: p.x, y, z: p.z, vx: -Math.sin(p.yaw) * Math.cos(p.pitch) * sp, vy: Math.sin(p.pitch) * sp, vz: -Math.cos(p.yaw) * Math.cos(p.pitch) * sp, life: 6, damage: d?.damage || 14, enemy: false, type });
        }
        else if (this.target?.kind === 'enemy' && this.target.distance <= (d?.range || 2.2) + .4) {
            const e = s.enemies.find(e => e.id === this.target!.id);
            if (e)
                this.hitEnemy(e, d?.damage || 5, it?.id || 'hand');
        }
        this.onAttack();
        this.visual({ type: 'action', action: it?.id.includes('bow') ? 'bow' : it?.id.endsWith('_staff') ? 'staff' : 'melee', item: it?.id || 'hand' });
        if (!this.creative && it?.dur !== undefined)
            it.dur = Math.max(0, it.dur - 1);
        discoverItems(s);
        normalizeSlots(s);
        this.dirty = true;
    }
    hitEnemy(e: Enemy, damage: number, type: string) {
        const s = this.state;
        if (e.hp <= 0)
            return;
        if ((e.vulnerable || 0) > s.time)
            damage *= MONSTERS[e.kind].boss ? 1.1 : 1.2;
        if (type !== 'dot' && (e.kind.includes('golem') || e.kind === 'rock_boss')) {
            damage *= type.includes('pick') || type === 'club' ? .85 : .65;
        }
        if (type !== 'dot' && e.kind === 'guard' && type !== 'club')
            damage *= .75;
        if (type === 'silver_arrow' && ['zombie', 'archer', 'guard', 'wizard'].includes(e.kind))
            damage *= 1.25;
        if (type === 'frost_staff')
            e.slow = 3;
        if (type === 'poison_arrow')
            e.poison = 5;
        if (type === 'fire_staff' && e.kind !== 'ember')
            e.burn = 4;
        if (type === 'fire_staff' && e.kind === 'ember')
            damage *= .5;
        if (type !== 'dot' && (damage > 0 || type === 'poison_arrow' || type === 'frost_staff' || (type === 'fire_staff' && e.kind !== 'ember')))
            alertEnemy(e);
        e.hp -= damage > 0 ? Math.max(1, Math.round(damage)) : 0;
        if (damage > 0)
            this.visual({ type: 'enemy-hit', id: e.id, x: e.x, z: e.z, dead: e.hp <= 0 });
        if (e.animal) {
            e.timer = 3;
            e.state = 'recover';
        }
        if (e.hp > 0)
            return;
        s.enemies = s.enemies.filter(x => x.id !== e.id);
        if (!e.animal && !e.summon && !MONSTERS[e.kind].boss)
            s.kills[e.kind] = Math.min(8, (s.kills[e.kind] || 0) + 1);
        if (!e.summon) {
            const items: Stack[] = [];
            for (const [id, n] of Object.entries(e.loot))
                give(items, id, n, 100);
            for (const gear of e.lootGear || []) {
                const item = { uid: uuid(), id: gear.id, qty: 1, dur: gear.dur };
                items.push(item);
            }
            s.drops.push({ id: `drop-${e.id}`, x: e.x, z: e.z, items, expires: s.time + 600, bag: false });
        }
        if (e.kind.endsWith('_boss')) {
            const q = e.kind.split('_')[0];
            if (!s.quests.includes(q)) {
                s.quests.push(q);
                this.notify(e.kind === 'night_boss' ? '밤의 군주를 물리쳤습니다. 목표 달성!' : '봉인 조각을 획득했습니다.');
                void this.save();
            }
            for (const b of s.buildings)
                if (b.kind === q + '_altar')
                    b.claimed = true;
        }
        if (e.owner === 'challenge' && !s.enemies.some(e => e.owner === 'challenge')) {
            const b = s.buildings.find(b => b.kind === 'challenge_totem');
            if (b) {
                b.claimed = true;
                const items: Stack[] = [];
                give(items, 'iron', 3, 24);
                give(items, 'golem_core', 1, 24);
                s.drops.push({ id: uuid(), x: b.x, z: b.z, items, expires: s.time + 600, bag: false });
                this.notify('도전 완료 · 토템 옆에서 보상을 회수하세요.');
                void this.save();
            }
        }
        this.dirty = true;
        this.notify(`${MONSTERS[e.kind].name} 처치`);
    }
    hurt(damage: number, direct = true, source?: {
        x: number;
        z: number;
    }) {
        const s = this.state, p = s.player;
        if (this.creative || s.status !== 'alive' || damage <= 0 || (direct && (s.time - p.hitAt < .25 || s.time < p.dodgeUntil)))
            return false;
        const armor = p.items.find(i => i.uid === p.armor), def = armor && armor.dur !== 0 ? ITEMS[armor.id].armor || 0 : 0;
        let result = direct ? damage * 100 / (100 + def) * (p.curse > 0 ? 1.2 : 1) : damage;
        const held = selected(s);
        const dx = source ? source.x - p.x : 0, dz = source ? source.z - p.z : 0, l = Math.hypot(dx, dz);
        const facing = l > 0 && (-Math.sin(p.yaw) * dx - Math.cos(p.yaw) * dz) / l >= Math.cos(50 * Math.PI / 180);
        const twoHanded = held?.id.includes('bow') || held?.id.endsWith('_staff');
        const shield = p.items.find(i => i.id === 'shield' && (i.dur || 0) > 0);
        if (direct && this.blocking && facing && !twoHanded && s.time - p.actionAt >= .25 && shield) {
            this.lastStamina = s.time;
            p.staminaAt = s.time;
            if (p.stamina >= 12) {
                p.stamina -= 12;
                result *= .3;
                shield.dur = Math.max(0, (shield.dur || 0) - 1);
            }
            else {
                p.stamina = 0;
                p.stagger = .6;
                this.notify("방어 실패 · 스태미나가 부족합니다.");
            }
        }
        p.hp = Math.max(0, p.hp - (damage > 0 ? Math.max(1, Math.round(result)) : 0));
        if (direct) {
            p.hitAt = s.time;
            p.healLeft = 0;
            this.onHit();
            if (p.fishing) {
                p.fishing = undefined;
                this.notify('피격으로 낚시가 취소되었습니다.');
            }
        }
        if (p.hp <= 0) {
            p.healLeft = 0;
            p.healRate = 0;
            s.status = s.mode === 'permadeath' ? 'ended' : 'dead';
            if (s.mode === 'normal') {
                s.drops.push({ id: uuid(), x: p.x, z: p.z, items: p.items.filter(i => i.uid !== p.armor), expires: 0, bag: true });
                p.items = p.items.filter(i => i.uid === p.armor);
                normalizeSlots(s);
            }
            p.fishing = undefined;
            this.pause('death');
            void this.save();
        }
        this.dirty = true;
        return true;
    }
    respawn() {
        const s = this.state;
        if (this.disposed || this.saveAccessLost || s.mode === 'permadeath' || s.status !== 'dead')
            return;
        const bed = s.buildings.find(b => b.id === s.player.bed);
        const x = bed?.x ?? 0, z = (bed?.z ?? 8) + 2;
        const spot = (s.terrainVersion === 3 || s.terrainVersion === 4) ? this.terrain.findSpawnPoint(x, z, 16) ?? { x: 0, z: 10 } : { x, z };
        Object.assign(s.player, { x: spot.x, z: spot.z, y: 0, vy: 0, hp: 50, hunger: 50, stamina: 100, poison: 0, curse: 0, slow: 0, stagger: 0, poisonResist: 0, fishing: undefined, healLeft: 0, dodgeUntil: s.time + 5 });
        s.enemies = s.enemies.filter(e => !MONSTERS[e.kind].boss);
        s.status = 'alive';
        this.panel = 'pause';
        void this.save();
        this.notify('사망 가방을 지도에서 찾을 수 있습니다.');
    }
    summon(b: Building) {
        if (!this.canModify) return;
        const s = this.state, kind = b.kind === 'forest_altar' ? 'forest_boss' : b.kind === 'rock_altar' ? 'rock_boss' : b.kind === 'ruin_altar' ? 'ruin_boss' : 'night_boss';
        if (s.enemies.some(e => MONSTERS[e.kind].boss)) {
            this.notify('이미 수호자와 전투 중입니다.');
            return;
        }
        if (!this.creative && kind === 'night_boss' && !['forest', 'rock', 'ruin'].every(q => s.quests.includes(q))) {
            this.notify('서로 다른 봉인 조각 3개가 필요합니다.');
            return;
        }
        const spot = this.terrain.findSpawnPoint(b.x + 6, b.z, 24);
        if (!spot) { this.notify('수호자가 등장할 완만한 지면이 없습니다.'); return; }
        s.enemies.push(makeEnemy(s, kind, 1, spot.x, spot.z));
        this.notify(`${MONSTERS[kind].name} 등장!`);
        this.dirty = true;
        void this.save();
    }
    step(dt: number) {
        if (this.paused || !this.canModify)
            return;
        const s = this.state, oldPhase = phase(s.time), oldDay = day(s.time);
        s.time += dt;
        s.tick++;
        this.dirty = true;
        this.stepClock(oldDay, oldPhase);
        this.stepPlayer(dt);
        if (s.status !== 'alive')
            return;
        this.stepFacilities(dt);
        this.stepFishing(dt);
        this.stepRegions();
        this.stepEnemies(dt);
        if (s.status !== 'alive')
            return;
        this.stepProjectiles(dt);
        if (s.status !== 'alive')
            return;
        s.drops = s.drops.filter(d => d.bag || s.time < d.expires);
        if (this.keys.has('MouseLeft'))
            this.attack();
        this.autosave += dt;
        if (this.autosave >= 30) {
            this.autosave = 0;
            void this.save();
        }
        this.uiTick += dt;
        if (this.uiTick > .12) {
            this.uiTick = 0;
            this.onChange();
        }
    }
    private stepClock(oldDay: number, oldPhase: string) {
        const s = this.state, p = s.player;
        if (day(s.time) !== oldDay) {
            s.previousKills = Object.values(s.kills).reduce((a, b) => a + b, 0);
            s.kills = {};
            s.enemies = s.enemies.filter(e => e.animal || MONSTERS[e.kind].boss || e.night === 0);
            s.nightPlan = [];
            this.notify(`Day ${day(s.time)} · 아침이 밝았습니다.`);
            for (let i = 0; i < 3; i++)
                if (s.enemies.filter(e => e.animal).length < 10) {
                    const a = random(s) * Math.PI * 2;
                    const x = p.x + Math.cos(a) * 35, z = p.z + Math.sin(a) * 35;
                    if ((s.terrainVersion !== 3 && s.terrainVersion !== 4) || (Math.hypot(x, z) < 462 && isDryLand(x, z, s, .8)))
                        s.enemies.push(makeEnemy(s, i % 2 ? 'cow' : 'sheep', 1, x, z, true));
                }
        }
        if (phase(s.time) !== oldPhase) {
            if (!this.creative && phase(s.time) === '밤') {
                planNight(s);
                this.notify(s.blood ? '핏빛 달이 떴습니다.' : '밤이 시작되었습니다.');
            }
            void this.save();
        }
        if (!this.creative && phase(s.time) === '밤') {
            const elapsed = s.time % 720 - 510;
            const wave = Math.floor(elapsed / 60) + 1;
            if (wave > s.nightWave && s.enemies.filter(e => !e.animal).length < 20) {
                const amount = Math.ceil(s.nightPlan.length / (4 - wave));
                for (let i = 0; i < amount && s.enemies.length < 40 && s.enemies.filter(e => !e.animal).length < 20; i++) {
                    const e = s.nightPlan.shift();
                    if (!e)
                        break;
                    let placed = false;
                    for (let tries = 0; tries < 12; tries++) {
                        const a = random(s) * Math.PI * 2, r = 25 + random(s) * 20, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
                        if (Math.hypot(x, z) < 462 && isDryLand(x, z, s, .8) && ((s.terrainVersion !== 3 && s.terrainVersion !== 4) || this.terrain.isWalkable(x, z)) && !s.buildings.some(b => distance(b, { x, z }) < 6)) {
                            e.x = x;
                            e.z = z;
                            s.enemies.push(e);
                            placed = true;
                            break;
                        }
                    }
                    if (!placed)
                        s.nightPlan.unshift(e);
                }
                s.nightWave = wave;
            }
        }
    }
    private stepPlayer(dt: number) {
        const s = this.state, p = s.player;
        const creative = this.creative, flying = creative && !!p.flying;
        const initialGround = height(p.x, p.z, s), altitude = initialGround + p.y, initialSlope = (s.terrainVersion === 3 || s.terrainVersion === 4) ? this.terrain.getSlopeAt(p.x, p.z) : 0;
        if (creative) {
            Object.assign(p, { hp: 100, hunger: 100, stamina: 100, poison: 0, curse: 0, slow: 0, stagger: 0 });
        }
        const blocked = (x: number, z: number, swept = false) => {
            const obstacle = (center: { x: number; z: number }, radius: number) =>
                distance(center, { x, z }) < radius || (swept && distance(center, p) > radius && segmentSphere(
                    { x: p.x, y: 0, z: p.z }, { x, y: 0, z }, { x: center.x, y: 0, z: center.z }, radius) !== null);
            return Math.hypot(x, z) > 465
                || ((s.terrainVersion === 3 || s.terrainVersion === 4) && !this.terrain.canTraverse(p.x, p.z, x, z))
                || s.nodes.some(n => !n.depleted && nodeRadius(n) > 0 && obstacle(n, nodeRadius(n) + .35))
                || s.buildings.some(b => (['wall', 'chest', 'furnace', 'advanced_furnace', 'anvil'].includes(b.kind) || (swept && b.kind === 'door')) && obstacle(b, swept ? 1.2 : 1));
        };
        let ix = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0), iz = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
        const norm = Math.hypot(ix, iz);
        if (norm && !(p.stagger || 0)) {
            ix /= norm;
            iz /= norm;
            const run = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && p.stamina > 1;
            let speed = flying ? run ? 16 : 8 : run ? 6.5 : 4;
            if (p.slow > 0)
                speed *= .75;
            if (run && !creative) {
                p.stamina = Math.max(0, p.stamina - 12 * dt);
                this.lastStamina = s.time;
                p.staminaAt = s.time;
            }
            const nx = p.x + (Math.cos(p.yaw) * ix - Math.sin(p.yaw) * iz) * speed * dt, nz = p.z + (-Math.sin(p.yaw) * ix - Math.cos(p.yaw) * iz) * speed * dt;
            if (flying ? Math.hypot(nx, p.z) <= 465 : !blocked(nx, p.z))
                p.x = nx;
            if (flying ? Math.hypot(p.x, nz) <= 465 : !blocked(p.x, nz))
                p.z = nz;
        }
        if (flying) {
            const vertical = (this.keys.has('Space') ? 1 : 0) - (this.keys.has('ControlLeft') || this.keys.has('ControlRight') ? 1 : 0);
            const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 16 : 8;
            p.y = Math.max(0, Math.min(120, altitude + vertical * speed * dt - height(p.x, p.z, s)));
            p.vy = 0;
        }
        else {
            if ((s.terrainVersion === 3 || s.terrainVersion === 4) && (p.y > 0 || initialSlope >= .85 && initialGround > this.terrain.getHeightAt(p.x, p.z)))
                p.y = Math.max(0, altitude - this.terrain.getHeightAt(p.x, p.z));
            if (this.keys.has('Space') && p.y === 0 && !(p.stagger || 0))
                p.vy = 5;
            p.y += p.vy * dt;
            p.vy -= 15 * dt;
            if (p.y < 0) {
                p.y = 0;
                p.vy = 0;
            }
            if (this.keys.has('ControlLeft') && !(p.stagger || 0) && p.stamina >= 25 && s.time > p.dodgeUntil + .8) {
                if (!creative) p.stamina -= 25;
                p.dodgeUntil = s.time + .15;
                this.lastStamina = s.time;
                p.staminaAt = s.time;
                const dx = p.x - Math.sin(p.yaw) * 1.3, dz = p.z - Math.cos(p.yaw) * 1.3;
                const beforeDodge = height(p.x, p.z, s) + p.y, slope = this.terrain.getSlopeAt(p.x, p.z);
                if (!blocked(dx, dz, true)) {
                    p.x = dx;
                    p.z = dz;
                    if ((s.terrainVersion === 3 || s.terrainVersion === 4) && (p.y > 0 || slope >= .85)) p.y = Math.max(0, beforeDodge - height(p.x, p.z, s));
                }
            }
        }
        if (!creative) {
            if (s.time - this.lastStamina > 1)
                p.stamina = Math.min(100, p.stamina + (p.hunger < 20 ? 10 : 20) * dt);
            p.hunger = Math.max(0, p.hunger - dt / 8 * (norm && this.keys.has('ShiftLeft') && p.stamina > 1 ? 1.5 : 1));
            p.stagger = Math.max(0, (p.stagger || 0) - dt);
            p.poisonResist = Math.max(0, (p.poisonResist || 0) - dt);
            if (p.hunger === 0 && s.tick % 150 === 0)
                this.hurt(1, false);
            if (s.status !== 'alive') return;
            if (p.poison > 0) {
                p.poison = Math.max(0, p.poison - dt);
                if (s.tick % 30 === 0)
                    this.hurt(2, false);
            }
            if (s.status !== 'alive') return;
            p.curse = Math.max(0, p.curse - dt);
            p.slow = Math.max(0, p.slow - dt);
        }
        if (p.healLeft > 0) {
            p.healLeft -= dt;
            p.hp = Math.min(100, p.hp + p.healRate * dt);
        }
        for (const id of discoverItems(s))
            this.notify(`${RECIPES.find(r => r.id === id)?.output ? ITEMS[RECIPES.find(r => r.id === id)!.output].name : id} 제작법 해금`);
        const region = biome(p.x, p.z);
        if (!s.discovered.includes(region)) {
            s.discovered.push(region);
            this.notify(`${region} 발견 · ${regionWarning(region)}`);
        }
    }
    private stepFishing(dt: number) {
        const s = this.state, p = s.player, f = p.fishing;
        if (!f)
            return;
        if (selected(s)?.uid !== f.uid || distance(p, f) > 1 || this.keys.has('Space')) {
            p.fishing = undefined;
            this.notify('이동하거나 장비를 바꿔 낚시가 취소되었습니다.');
            return;
        }
        f.remaining = Math.max(0, f.remaining - dt);
        if (f.remaining > 1e-8)
            return;
        p.fishing = undefined;
        if (f.success) {
            if (addItem(s, 'fish', 1))
                this.notify('생선을 낚았습니다.');
            else {
                s.drops.push({ id: uuid(), x: p.x, z: p.z, items: [{ uid: uuid(), id: 'fish', qty: 1 }], expires: s.time + 600, bag: false });
                this.notify('배낭이 가득 차 생선을 바닥에 놓았습니다.');
            }
        }
        else
            this.notify('물고기가 미끼를 피했습니다.');
        p.actionAt = s.time;
    }
    private stepRegions() {
        const s = this.state, p = s.player;
        if (this.creative) return;
        // Replenish at most once per second and retain per-region cooldowns in saves.
        if (s.tick % 30 !== 0)
            return;
        s.enemies = s.enemies.filter(e => !e.region || distance(e, p) < 180);
        const region = biome(p.x, p.z), pool = REGION_ENEMIES[region];
        if (!pool || Math.hypot(p.x, p.z) < 100)
            return;
        const next = s.regionNext ??= {};
        if (next[region] === undefined) {
            next[region] = s.time + 12;
            return;
        }
        if (s.time < next[region] || s.enemies.filter(e => e.region === region).length >= 2 || s.enemies.filter(e => e.region).length >= 6 || s.enemies.filter(e => !e.animal).length >= 20)
            return;
        for (let tries = 0; tries < 12; tries++) {
            const a = random(s) * Math.PI * 2, r = 28 + random(s) * 12, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
            if (Math.hypot(x, z) > 462 || !isDryLand(x, z, s, .8) || biome(x, z) !== region || ((s.terrainVersion === 3 || s.terrainVersion === 4) && !this.terrain.isWalkable(x, z)) || s.buildings.some(b => distance(b, { x, z }) < 8))
                continue;
            const choice = pool[Math.floor(random(s) * pool.length)], enemy = makeEnemy(s, choice.kind, choice.tier, x, z);
            enemy.region = region;
            enemy.night = 0;
            s.enemies.push(enemy);
            next[region] = s.time + 120;
            this.notify(`${region}의 ${MONSTERS[choice.kind].name}이 주변을 배회합니다.`);
            break;
        }
    }
    private stepFacilities(dt: number) {
        const s = this.state;
        for (const n of s.nodes)
            if (n.depleted && n.readyAt > 0 && s.time >= n.readyAt && !s.buildings.some(b => distance(b, n) < 2)) {
                n.depleted = false;
                n.hp = nodeDefinition(n).hp;
            }
        for (const b of s.buildings) {
            const j = b.jobs[0];
            if (!j)
                continue;
            const r = RECIPES.find(r => r.id === j.recipe)!;
            if (j.remaining > 0 && b.fuel > 0) {
                const work = Math.min(dt, b.fuel, j.remaining);
                b.fuel -= work;
                j.remaining -= work;
            }
            if (j.remaining <= 0 && give(b.items, r.output, r.qty, 24))
                b.jobs.shift();
        }
    }
    private stepEnemies(dt: number) {
        const s = this.state, p = s.player;
        for (const e of [...s.enemies]) {
            if (e.hp <= 0)
                continue;
            const d = MONSTERS[e.kind], dist = distance(e, p);
            const poisoned = (e.poison || 0) > 0, burning = (e.burn || 0) > 0;
            if (poisoned || burning) {
                e.dotTick = (e.dotTick || 0) + Math.min(dt, Math.max(e.poison || 0, e.burn || 0));
                e.poison = Math.max(0, (e.poison || 0) - dt);
                e.burn = Math.max(0, (e.burn || 0) - dt);
                if (e.dotTick >= 1 - 1e-8) {
                    e.dotTick = Math.max(0, e.dotTick - 1);
                    this.hitEnemy(e, ((poisoned ? 2 : 0) + (burning ? 3 : 0)) * (d.boss ? .5 : 1), 'dot');
                    if (e.hp <= 0)
                        continue;
                }
            }
            if (e.summon && e.owner && !s.enemies.some(x => x.id === e.owner)) {
                s.enemies = s.enemies.filter(x => x !== e);
                continue;
            }
            if (d.boss && dist > 60) {
                s.enemies = s.enemies.filter(x => x !== e);
                this.notify('수호자 전투 지역을 벗어났습니다.');
                continue;
            }
            e.slow = Math.max(0, e.slow - dt);
            e.skill -= dt;
            if (e.animal || this.creative) {
                if (dist > 130) continue;
                e.timer -= dt;
                const a = e.timer > 0 ? Math.atan2(e.z - p.z, e.x - p.x) : s.time * .12 + parseInt(e.id.slice(0, 2), 16);
                const speed = e.timer > 0 ? d.speed * 1.8 : d.speed * .15;
                const x = e.x + Math.cos(a) * speed * dt, z = e.z + Math.sin(a) * speed * dt;
                if ((s.terrainVersion !== 3 && s.terrainVersion !== 4) || this.terrain.isWalkable(x, z)) { e.x = x; e.z = z; }
                continue;
            }
            if (!updateAwareness(e, dist, dt) || dist > 130)
                continue;
            if (e.state === 'windup') {
                e.timer -= dt;
                if (e.timer <= 0) {
                    if (d.role !== 'melee' && dist < 25) {
                        const y = height(e.x, e.z, s) + 1.3;
                        const dx = p.x - e.x, dy = height(p.x, p.z, s) + p.y + 1 - y, dz = p.z - e.z, l = Math.hypot(dx, dy, dz) || 1;
                        s.projectiles.push({ id: uuid(), x: e.x, y, z: e.z, vx: dx / l * 10, vy: dy / l * 10, vz: dz / l * 10, life: 5, damage: d.damage * (1 + .1 * (e.tier - d.min)), enemy: true, type: e.kind });
                    }
                    else if (dist < 2.8) {
                        const landed = this.hurt(d.damage * (1 + .1 * (e.tier - d.min)) * (s.difficulty === 'easy' ? .8 : s.difficulty === 'hard' ? 1.2 : 1), true, e);
                        if (landed && s.status === 'alive' && e.kind === 'spider' && !(p.poisonResist || 0))
                            p.poison = 5;
                    }
                    e.state = 'recover';
                    e.timer = d.boss ? 1.3 : 1;
                }
            }
            else if (e.state === 'recover') {
                e.timer -= dt;
                if (e.timer <= 0)
                    e.state = 'chase';
            }
            else {
                const reach = d.role === 'melee' ? 2 : 14;
                if (dist > reach) {
                    const speed = d.speed * (e.slow > 0 ? (d.boss ? .9 : .75) : 1);
                    const nx = e.x + (p.x - e.x) / dist * speed * dt, nz = e.z + (p.z - e.z) / dist * speed * dt;
                    const wall = s.buildings.find(b => ['wall', 'door'].includes(b.kind) && distance(b, { x: nx, z: nz }) < 1.1);
                    if (wall) {
                        wall.hp -= d.damage * dt * .3;
                        if (wall.hp <= 0)
                            this.breakBuilding(wall);
                    }
                    else if ((s.terrainVersion !== 3 && s.terrainVersion !== 4) || this.terrain.canTraverse(e.x, e.z, nx, nz)) {
                        e.x = nx;
                        e.z = nz;
                    }
                }
                else {
                    e.state = 'windup';
                    e.timer = d.boss ? 1.1 : d.role === 'melee' ? .6 : .8;
                }
            }
            if (s.status !== 'alive') return;
            if (e.kind === 'wizard' && e.skill <= 0 && dist < 22 && s.enemies.filter(x => x.owner === e.id).length < 3 && s.enemies.length < 40) {
                const spot = this.terrain.findSpawnPoint(e.x + 2, e.z, 12);
                if (!spot) continue;
                const n = makeEnemy(s, 'zombie', Math.min(5, e.tier), spot.x, spot.z, false, true);
                n.owner = e.id;
                s.enemies.push(n);
                e.skill = 15;
            }
        }
    }
    private stepProjectiles(dt: number) {
        const s = this.state, p = s.player;
        for (const q of [...s.projectiles]) {
            const prev = { x: q.x, y: q.y, z: q.z };
            q.life -= dt;
            q.x += q.vx * dt;
            q.y += q.vy * dt;
            q.z += q.vz * dt;
            if (q.type.includes('arrow'))
                q.vy -= 7 * dt;
            let contact: number | null = (s.terrainVersion === 3 || s.terrainVersion === 4) ? this.terrain.segmentHit(prev, q) : null;
            let target: Enemy | 'player' | null = null;
            // Walls participate in the same nearest-contact query as actors.
            for (const b of s.buildings) {
                if (!['wall', 'door'].includes(b.kind))
                    continue;
                const t = segmentSphere(prev, q, { x: b.x, y: this.terrain.getFoundationAt(b.x, b.z).height + 1, z: b.z }, 1);
                if (t !== null && (contact === null || t < contact)) {
                    contact = t;
                    target = null;
                }
            }
            if (q.enemy) {
                const t = segmentSphere(prev, q, { x: p.x, y: height(p.x, p.z, s) + p.y + 1, z: p.z }, .75);
                if (t !== null && (contact === null || t < contact)) {
                    contact = t;
                    target = 'player';
                }
            }
            else
                for (const e of s.enemies) {
                    const t = segmentSphere(prev, q, { x: e.x, y: height(e.x, e.z, s) + 1, z: e.z }, .9);
                    if (t !== null && (contact === null || t < contact)) {
                        contact = t;
                        target = e;
                    }
                }
            if (target === 'player') {
                const landed = this.hurt(q.damage * (s.difficulty === 'easy' ? .8 : s.difficulty === 'hard' ? 1.2 : 1), true, prev);
                if (landed && s.status === 'alive' && q.type === 'frost')
                    p.slow = 3;
                if (landed && s.status === 'alive' && q.type === 'wizard')
                    p.curse = 8;
            }
            else if (target) {
                if (q.type === 'pain') {
                    target.vulnerable = s.time + (MONSTERS[target.kind].boss ? 5 : 8);
                    alertEnemy(target);
                }
                else
                    this.hitEnemy(target, q.damage, q.type);
                if (q.type === 'blast_arrow')
                    for (const e of [...s.enemies])
                        if (e !== target && distance(e, target) < 3)
                            this.hitEnemy(e, q.damage * .7, q.type);
            }
            if (q.y < height(q.x, q.z, s) || q.life <= 0 || Math.hypot(q.x, q.z) > 490 || contact !== null)
                s.projectiles = s.projectiles.filter(p => p !== q);
            if (s.status !== 'alive') return;
        }
    }
    breakBuilding(b: Building) {
        const s = this.state, items = structuredClone(b.items);
        for (const j of b.jobs)
            for (const [id, n] of Object.entries(j.reserved))
                give(items, id, n, 100);
        if (items.length)
            s.drops.push({ id: uuid(), x: b.x, z: b.z, items, expires: 0, bag: true });
        s.buildings = s.buildings.filter(x => x !== b);
        this.dirty = true;
    }
    async save(): Promise<void> {
        return this.saveQueue.request(async () => {
            if (this.disposed)
                return false;
            this.saveLabel = '저장 중…';
            this.onChange();
            this.dirty = false;
            try {
                this.savedAt = await this.storage.save(this.state);
                this.saveLabel = `저장됨 · ${new Date(this.savedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
                this.error = '';
                return true;
            }
            catch (e) {
                this.dirty = true;
                this.error = e instanceof Error ? e.message : '저장 실패';
                this.saveLabel = '저장 실패 · 파일 백업을 이용하세요';
                this.notify(this.error);
                return false;
            }
            finally {
                this.onChange();
            }
        });
    }
    async export() {
        try {
            await exportFile(this.state);
            this.notify('백업 파일 다운로드를 요청했습니다.');
        }
        catch (e) {
            this.notify(String(e));
        }
    }
    dispose() {
        this.disposed = true;
        this.keys.clear();
        this.onVisual = () => {
        };
        if (this.storage.lockLost === this.handleLockLoss)
            this.storage.lockLost = () => {};
    }
}
