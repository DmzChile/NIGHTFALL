import type { Engine } from './engine';
import { ITEMS, MONSTERS, day, phase } from './data';
import { biome, distance, makeEnemy, normalizeSlots, type GameMode } from './model';
import { nodeRadius } from './woodland';

export type CommandResult = { ok: boolean; lines: string[] };
export const COMMANDS = [
    { name: 'help', usage: '/help [command]', description: '명령어 목록과 사용법', example: '/help give' },
    { name: 'gamemode', usage: '/gamemode creative|survival', description: '크리에이티브 / 생존 전환', example: '/gamemode creative' },
    { name: 'give', usage: '/give <item> [amount]', description: '아이템 지급 · 기본 1개', example: '/give wood 99' },
    { name: 'items', usage: '/items [검색어]', description: '아이템 이름과 ID 검색', example: '/items 검' },
    { name: 'time', usage: '/time set day|noon|dusk|night|dawn|0–719', description: '현재 날짜의 시간 변경', example: '/time set day' },
    { name: 'tp', usage: '/tp <x> <z>', description: '지상으로 이동 · ~는 현재 좌표', example: '/tp ~10 ~' },
    { name: 'heal', usage: '/heal', description: '체력·허기·스태미나와 상태 회복', example: '/heal' },
    { name: 'fly', usage: '/fly [on|off]', description: '크리에이티브 비행 전환', example: '/fly on' },
    { name: 'spawn', usage: '/spawn <monster> [tier] [count]', description: '몬스터 / 동물 소환 · 최대 10마리', example: '/spawn zombie 1 3' },
    { name: 'clear', usage: '/clear [item]', description: '소지품 삭제 · 생략하면 가방 전체', example: '/clear wood' },
    { name: 'save', usage: '/save', description: '현재 월드 저장', example: '/save' },
] as const;
const success = (...lines: string[]): CommandResult => ({ ok: true, lines });
const failure = (line: string): CommandResult => ({ ok: false, lines: [line] });
const usage = (name: string) => failure('사용법: ' + COMMANDS.find(c => c.name === name)!.usage);

/** Tokenize literal arguments, including quoted Korean item names. Never evaluate code. */
export function parseGameCommand(input: string): { name: string; args: string[] } | null {
    if (typeof input !== 'string' || input.length > 256) return null;
    let rest = input.trim().replace(/^\//, '').trim();
    const tokens: string[] = [];
    while (rest) {
        const match = /^(?:"([^"]*)"|'([^']*)'|([^\s"']+))(?:\s+|$)/.exec(rest);
        if (!match) return null;
        tokens.push(match[1] ?? match[2] ?? match[3]);
        rest = rest.slice(match[0].length);
    }
    return tokens.length ? { name: tokens[0].toLowerCase(), args: tokens.slice(1) } : null;
}
function resolve(table: Record<string, { name: string }>, token: string) {
    const id = token.toLowerCase();
    return Object.hasOwn(table, id) ? id : Object.keys(table).find(key => table[key].name === token);
}
function positive(token: string | undefined, fallback: number, max: number) {
    const value = token === undefined ? fallback : /^\d+$/.test(token) ? Number(token) : NaN;
    return Number.isSafeInteger(value) && value >= 1 && value <= max ? value : NaN;
}
function coordinate(token: string, base: number) {
    const relative = token.startsWith('~'), number = relative ? token.slice(1) : token;
    if (relative && !number) return base;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(number)) return NaN;
    return (relative ? base : 0) + Number(number);
}
export async function executeGameCommand(engine: Engine, input: string): Promise<CommandResult> {
    const parsed = parseGameCommand(input);
    if (!parsed) return failure('입력을 확인하세요. 명령어는 256자까지이며, 공백이 있는 이름은 따옴표로 감쌉니다.');
    const { name, args } = parsed, s = engine.state, p = s.player;
    if (!COMMANDS.some(c => c.name === name)) return failure('알 수 없는 명령어: /' + name + ' · /help로 목록을 확인하세요.');
    if (name === 'help') {
        if (args.length > 1) return usage(name);
        const found = args[0] ? COMMANDS.find(c => c.name === args[0].replace(/^\//, '').toLowerCase()) : null;
        if (args[0] && !found) return failure('해당 명령어가 없습니다. /help로 목록을 확인하세요.');
        return found ? success(found.usage, found.description, '예시: ' + found.example) : success(...COMMANDS.map(c => c.usage + ' · ' + c.description));
    }
    if (name === 'items') {
        const query = args.join(' ').toLowerCase();
        const matches = Object.entries(ITEMS).filter(([id, item]) => (id + ' ' + item.name).toLowerCase().includes(query));
        return matches.length ? success(...matches.slice(0, 16).map(([id, item]) => id + ' · ' + item.name), ...(matches.length > 16 ? ['전체 ' + matches.length + '종 · /items 검색어로 좁혀 보세요.'] : [])) : failure('일치하는 아이템이 없습니다.');
    }
    if (!engine.canModify) return failure(engine.saveAccessLost ? '월드 사용 권한이 없어 명령을 실행할 수 없습니다.' : '살아 있는 월드에서만 변경 명령을 사용할 수 있습니다.');
    if (name === 'gamemode') {
        if (args.length !== 1) return usage(name);
        const modes: Record<string, GameMode> = { '0': 'survival', '1': 'creative', survival: 'survival', creative: 'creative' };
        const mode = Object.hasOwn(modes, args[0].toLowerCase()) ? modes[args[0].toLowerCase()] : undefined;
        if (!mode) return usage(name);
        engine.setGameMode(mode);
        return success(mode === 'creative' ? '크리에이티브 모드로 전환했습니다. Tab: 아이템 목록 · F: 비행 · R: 철거' : '생존 모드로 전환했습니다. 기존 난이도와 사망 규칙이 적용됩니다.');
    }
    if (name === 'give') {
        if (args.length < 1 || args.length > 2) return usage(name);
        const id = resolve(ITEMS, args[0]), amount = positive(args[1], 1, 999);
        if (!id) return failure('없는 아이템입니다. /items 검색어로 ID를 찾으세요.');
        if (!Number.isFinite(amount)) return failure('수량은 1–999 사이의 정수여야 합니다.');
        return engine.giveItem(id, amount) ? success(ITEMS[id].name + ' ×' + amount + ' 지급 완료') : failure('가방에 전체 수량이 들어갈 공간이 없습니다. 소지품을 정리하세요.');
    }
    if (name === 'time') {
        if (args.length !== 2 || args[0].toLowerCase() !== 'set') return usage(name);
        const times: Record<string, number> = { day: 0, noon: 240, dusk: 450, night: 540, dawn: 690 };
        const value = args[1].toLowerCase();
        const time = Object.hasOwn(times, value) ? times[value] : /^\d+$/.test(value) ? Number(value) : NaN;
        if (!engine.setTime(time)) return usage(name);
        return success('DAY ' + day(s.time) + ' · ' + phase(s.time) + ' · ' + time + '/720', '진행 중인 제작·재생·효과의 남은 시간은 유지됩니다.');
    }
    if (name === 'tp') {
        if (args.length !== 2) return usage(name);
        const x = coordinate(args[0], p.x), z = coordinate(args[1], p.z);
        if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x, z) > 460) return failure('섬 안의 유효한 좌표를 입력하세요. 원점으로부터 460m 이내입니다.');
        if (s.nodes.some(n => !n.depleted && nodeRadius(n) > 0 && distance(n, { x, z }) < nodeRadius(n) + .35)
            || s.buildings.some(b => ['wall', 'chest', 'furnace', 'advanced_furnace', 'anvil'].includes(b.kind) && distance(b, { x, z }) < 1))
            return failure('나무나 구조물과 겹치는 좌표입니다. 다른 위치를 선택하세요.');
        Object.assign(p, { x, z, y: 0, vy: 0, fishing: undefined });
        engine.target = null;
        if (!s.discovered.includes(biome(x, z))) s.discovered.push(biome(x, z));
        engine.dirty = true; engine.onChange();
        return success('이동 완료 · X ' + x.toFixed(1) + ' / Z ' + z.toFixed(1));
    }
    if (name === 'heal') {
        if (args.length) return usage(name);
        engine.restoreVitals();
        return success('체력·허기·스태미나를 회복하고 독·저주·둔화·경직을 제거했습니다.');
    }
    if (name === 'fly') {
        if (args.length > 1 || (args[0] && !['on', 'off'].includes(args[0].toLowerCase()))) return usage(name);
        if (!engine.creative) return failure('비행은 크리에이티브에서만 가능합니다. /gamemode creative로 전환하세요.');
        engine.toggleFlight(args[0] ? args[0].toLowerCase() === 'on' : !p.flying);
        return success(p.flying ? '비행 켜짐 · Space 상승 / Ctrl 하강 / Shift 가속' : '비행 꺼짐');
    }
    if (name === 'spawn') {
        if (args.length < 1 || args.length > 3) return usage(name);
        const kind = resolve(MONSTERS, args[0]);
        if (!kind) return failure('없는 몬스터입니다. /spawn 자동 완성에서 종류를 선택하세요.');
        const def = MONSTERS[kind], tier = positive(args[1], def.min, def.max), amount = positive(args[2], 1, 10);
        if (tier < def.min || !Number.isFinite(tier)) return failure('이 몬스터의 Tier 범위: ' + def.min + '–' + def.max);
        if (!Number.isFinite(amount) || s.enemies.length + amount > 60) return failure('한 번에 1–10마리, 월드 전체에 최대 60마리까지 소환할 수 있습니다.');
        const positions = Array.from({ length: amount }, (_, i) => {
            const angle = Math.atan2(-p.z, -p.x) + (i - (amount - 1) / 2) * .12;
            return { x: p.x + Math.cos(angle) * (10 + i * 1.5), z: p.z + Math.sin(angle) * (10 + i * 1.5) };
        });
        if (positions.some(pos => Math.hypot(pos.x, pos.z) > 462)) return failure('소환할 공간이 없습니다. 섬 안쪽으로 이동하세요.');
        for (const pos of positions) {
            const enemy = makeEnemy(s, kind, tier, pos.x, pos.z, ['cow', 'sheep', 'bird'].includes(kind));
            enemy.night = 0; s.enemies.push(enemy);
        }
        engine.dirty = true; engine.onChange();
        return success(def.name + ' · Tier ' + tier + ' · ' + amount + '마리 소환' + (engine.creative ? ' · 크리에이티브에서는 공격하지 않습니다.' : ''));
    }
    if (name === 'clear') {
        if (args.length > 1) return usage(name);
        const id = args[0] ? resolve(ITEMS, args[0]) : null;
        if (args[0] && !id) return failure('없는 아이템입니다. /items로 ID를 확인하세요.');
        const removed = p.items.filter(it => !id || it.id === id).reduce((sum, it) => sum + it.qty, 0);
        if (!removed) return failure('삭제할 소지품이 없습니다.');
        p.items = id ? p.items.filter(it => it.id !== id) : [];
        normalizeSlots(s); engine.dirty = true; engine.onChange();
        return success((id ? ITEMS[id].name : '전체 소지품') + ' · ' + removed + '개 삭제');
    }
    if (args.length) return usage('save');
    await engine.save();
    return engine.error ? failure('저장 실패 · ' + engine.error) : success('월드 저장 완료');
}

export type CommandSuggestion = { value: string; label: string; detail: string };
export function commandSuggestions(input: string): CommandSuggestion[] {
    const text = input.trimStart().replace(/^\//, ''), parts = text.split(/\s+/);
    if (parts.length === 1)
        return COMMANDS.filter(c => c.name.startsWith(parts[0].toLowerCase())).slice(0, 8).map(c => ({ value: '/' + c.name + ' ', label: '/' + c.name, detail: c.description }));
    const [first, prefix] = parts;
    const name = first.toLowerCase();
    if (name === 'time' && parts.length === 2 && 'set'.startsWith(prefix))
        return [{ value: '/time set ', label: 'set', detail: 'day / night / noon / dusk / dawn / 0–719' }];
    if ((name === 'give' || name === 'spawn') && parts.length === 2) {
        const table = name === 'give' ? ITEMS : MONSTERS;
        return Object.entries(table).filter(([id, item]) => (id + ' ' + item.name).toLowerCase().includes(prefix.toLowerCase())).slice(0, 8).map(([id, item]) => ({ value: '/' + name + ' ' + id + ' ', label: id, detail: item.name }));
    }
    const options = name === 'gamemode' ? ['creative', 'survival'] : name === 'fly' ? ['on', 'off'] : name === 'time' && parts[1] === 'set' ? ['day', 'noon', 'dusk', 'night', 'dawn'] : [];
    const fragment = parts.at(-1)!.toLowerCase();
    return options.filter(option => option.startsWith(fragment)).map(option => ({ value: '/' + name + (name === 'time' ? ' set ' : ' ') + option, label: option, detail: COMMANDS.find(c => c.name === name)!.description }));
}
