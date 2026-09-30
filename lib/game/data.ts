export type Kind = 'material' | 'food' | 'tool' | 'weapon' | 'building' | 'armor' | 'potion';
export type ItemDef = {
    name: string;
    icon: string;
    kind: Kind;
    max: number;
    tool?: 'axe' | 'pick';
    level?: number;
    damage?: number;
    interval?: number;
    range?: number;
    durability?: number;
    food?: number;
    heal?: number;
    armor?: number;
    facility?: string;
    description?: string;
};
export const ITEMS: Record<string, ItemDef> = {};
const add = (id: string, name: string, icon: string, kind: Kind = 'material', opts: Partial<ItemDef> = {}) => ITEMS[id] = { name, icon, kind, max: kind === 'material' ? 99 : kind === 'food' ? 20 : kind === 'potion' ? 10 : 1, ...opts };
[['wood', '통나무', '🪵'], ['hardwood', '단단한 목재', '🪵'], ['stone', '돌', '🪨'], ['fiber', '섬유', '🌿'], ['rope', '밧줄', '🧶'], ['resin', '수지', '💧'], ['leather', '가죽', '◈'], ['wool', '양털', '☁'], ['bone', '뼈', '🦴'], ['feather', '깃털', '🪶'], ['iron_ore', '철광석', '🪨'], ['coal', '석탄', '⬟'], ['charcoal', '숯', '⬟'], ['silver_ore', '은광석', '◇'], ['gold_ore', '금광석', '◆'], ['mithril_ore', '미스릴 광석', '🔷'], ['obsidian', '흑요석', '⬢'], ['sulfur', '유황', '🟡'], ['crystal', '마력 결정', '💎'], ['herb', '약초', '🌱'], ['antidote_herb', '해독 약초', '☘'], ['mushroom', '식용 버섯', '🍄'], ['toxic', '독성 버섯', '🍄'], ['slime', '점액', '●'], ['fang', '송곳니', '◭'], ['golem_core', '골렘 핵', '🔶'], ['ember_core', '불씨 핵', '🔥'], ['frost_shard', '서리 파편', '❄'], ['purify_shard', '정화 파편', '✧'], ['iron', '철 주괴', '▬'], ['steel', '강철 주괴', '▬'], ['silver', '은 주괴', '▬'], ['gold', '금 주괴', '▬'], ['mithril', '미스릴 주괴', '▬'], ['seed', '밀 씨앗', '🌾'], ['herb_seed', '약초 씨앗', '🌱'], ['wheat', '밀', '🌾'], ['arrow', '돌 화살', '➶'], ['silver_arrow', '은촉 화살', '➶'], ['poison_arrow', '독 화살', '➶'], ['blast_arrow', '폭발 화살', '➶'], ['magic_stone', '마력석', '🔹'], ['powder', '폭발 혼합물', '✴']].forEach(a => add(a[0], a[1], a[2]));
add('berry', '열매', '🫐', 'food', { food: 8 });
add('raw_meat', '생고기', '🥩', 'food', { food: 15 });
add('rotten', '썩은 고기', '🥩', 'food', { food: 5, heal: -10 });
add('meat', '구운 고기', '🍖', 'food', { food: 30, heal: 5 });
add('fish', '생선', '🐟', 'food', { food: 15 });
add('cooked_fish', '생선 구이', '🐟', 'food', { food: 25 });
add('soup', '버섯 수프', '🥣', 'food', { food: 20, heal: 3 });
add('bread', '빵', '🍞', 'food', { food: 25 });
for (const [material, level, durability, damage] of [['stone', 1, 80, 12], ['iron', 2, 180, 20], ['steel', 3, 260, 28], ['mithril', 4, 360, 36]] as [
    string,
    number,
    number,
    number
][]) {
    const label = { stone: '돌', iron: '철', steel: '강철', mithril: '미스릴' }[material];
    for (const [tool, n, icon] of [['axe', '도끼', '🪓'], ['pick', '곡괭이', '⛏']] as const)
        add(`${material}_${tool}`, `${label} ${n}`, icon, 'tool', { tool, level, durability, damage: tool === 'axe' ? damage * .65 : 8, interval: .9, range: 2.5 });
    add(`${material}_sword`, `${label} ${material === 'stone' ? '창' : '검'}`, '⚔', 'weapon', { level, durability, damage, interval: material === 'stone' ? .9 : .65, range: material === 'stone' ? 2.7 : 2 });
    add(`${material}_armor`, `${label} 갑옷`, '🛡', 'armor', { armor: level * 8, durability });
}
add('broken_bow', '부서진 활', '🏹', 'material', { max: 10, description: '제작대에서 복원하거나 통나무로 분해할 수 있습니다.' });
add('club', '철 둔기', '🔨', 'weapon', { damage: 28, interval: 1.1, range: 2, durability: 180 });
add('obsidian_knife', '흑요석 칼', '🗡', 'weapon', { damage: 24, interval: .45, range: 1.6, durability: 70 });
add('bow', '기본 활', '🏹', 'weapon', { damage: 14, interval: .8, durability: 180 });
add('strong_bow', '강화 활', '🏹', 'weapon', { damage: 23, interval: .8, durability: 260 });
add('fire_staff', '불꽃 지팡이', '🔥', 'weapon', { damage: 26, interval: 1, durability: 180 });
add('frost_staff', '서리 지팡이', '❄', 'weapon', { damage: 16, interval: 1.2, durability: 180 });
add('shield', '목제 방패', '🛡', 'weapon', { durability: 120 });
add('bag', '가방', '🎒', 'armor');
add('fishing_rod', '낚싯대', '🎣', 'tool');
add('torch', '횃불', '🔥', 'tool');
for (const [id, name, icon, facility] of [['workbench', '제작대', '⚒', 'workbench'], ['campfire', '모닥불', '🔥', 'campfire'], ['furnace', '화로', '♨', 'furnace'], ['anvil', '모루', '⚒', 'anvil'], ['advanced_furnace', '고급 화로', '♨', 'advanced_furnace'], ['alchemy', '연금 작업대', '⚗', 'alchemy'], ['magicbench', '마력 작업대', '✧', 'magicbench'], ['chest', '상자', '▣', 'chest'], ['wall', '목제 벽', '▤', 'wall'], ['door', '문', '▥', 'door'], ['bedroll', '침낭', '▰', 'bedroll'], ['plot', '경작지', '🌾', 'plot'], ['trap', '동물 덫', '♧', 'trap']])
    add(id, name, icon, 'building', { facility });
add('bandage', '붕대', '✚', 'potion', { heal: 20 });
add('heal', '치유 물약', '🧪', 'potion', { heal: 35 });
add('antidote', '해독제', '🧪', 'potion');
add('purify', '정화 물약', '🧪', 'potion');
add('pain', '고통의 물약', '🧪', 'potion');
export type Recipe = {
    id: string;
    output: string;
    qty: number;
    inputs: Record<string, number>;
    station: string;
    seconds: number;
    category: string;
};
export const RECIPES: Recipe[] = [];
const recipe = (output: string, inputs: Record<string, number>, station = 'workbench', qty = 1, seconds = 0) => RECIPES.push({ id: output, output, qty, inputs, station, seconds, category: ITEMS[output].kind });
recipe('workbench', { wood: 10 }, 'hand');
recipe('rope', { fiber: 3 }, 'hand');
recipe('torch', { wood: 1, resin: 1 }, 'hand');
recipe('stone_axe', { wood: 3, stone: 5, rope: 1 });
recipe('stone_pick', { wood: 3, stone: 5, rope: 1 });
recipe('stone_sword', { wood: 4, stone: 3, rope: 1 });
recipe('shield', { wood: 6, leather: 2 });
recipe('bow', { wood: 5, rope: 2 });
recipe('arrow', { wood: 2, stone: 2, feather: 2 }, 'workbench', 10);
recipe('bag', { leather: 6, rope: 3 });
recipe('chest', { wood: 8 });
recipe('wall', { wood: 5 });
recipe('door', { wood: 4, rope: 1 });
recipe('campfire', { stone: 8, wood: 4 });
recipe('furnace', { stone: 15, wood: 5 });
recipe('anvil', { iron: 5, wood: 4 });
recipe('advanced_furnace', { stone: 20, iron: 8 });
recipe('alchemy', { wood: 8, iron: 4 });
recipe('magicbench', { hardwood: 8, iron: 4, crystal: 3 });
recipe('bedroll', { wool: 4, fiber: 4 });
recipe('plot', { wood: 4, fiber: 2 });
recipe('trap', { wood: 4, rope: 2, rotten: 1 });
recipe('fishing_rod', { wood: 4, rope: 2 });
recipe('bandage', { fiber: 6, herb: 1 }, 'workbench', 2);
recipe('meat', { raw_meat: 1 }, 'campfire', 1, 10);
recipe('cooked_fish', { fish: 1 }, 'campfire', 1, 10);
recipe('soup', { mushroom: 2, berry: 1 }, 'campfire', 1, 15);
recipe('bread', { wheat: 3 }, 'campfire', 1, 15);
recipe('charcoal', { wood: 1 }, 'campfire', 1, 10);
for (const metal of ['iron', 'silver', 'gold'])
    recipe(metal, { [`${metal}_ore`]: 2 }, 'furnace', 1, 10);
recipe('steel', { iron: 2, coal: 1 }, 'advanced_furnace', 1, 15);
recipe('mithril', { mithril_ore: 2 }, 'advanced_furnace', 1, 20);
for (const metal of ['iron', 'steel', 'mithril']) {
    for (const tool of ['axe', 'pick'])
        recipe(`${metal}_${tool}`, { [metal]: 5, [metal === 'iron' ? 'wood' : 'hardwood']: 3, rope: 1 }, 'anvil');
    recipe(`${metal}_sword`, { [metal]: 6, [metal === 'iron' ? 'wood' : 'hardwood']: 2, leather: 1 }, 'anvil');
    recipe(`${metal}_armor`, { [metal]: 6, leather: 2 }, 'anvil');
}
recipe('club', { iron: 7, wood: 3 }, 'anvil');
recipe('obsidian_knife', { obsidian: 5, hardwood: 2, leather: 1 }, 'anvil');
recipe('strong_bow', { hardwood: 6, rope: 3, iron: 2 });
recipe('silver_arrow', { wood: 2, silver: 1, feather: 2 }, 'anvil', 10);
recipe('poison_arrow', { arrow: 10, toxic: 2, slime: 1 }, 'alchemy', 10);
recipe('powder', { sulfur: 2, charcoal: 1 }, 'alchemy');
recipe('blast_arrow', { arrow: 3, powder: 1 }, 'alchemy', 3);
recipe('heal', { herb: 3, berry: 2 }, 'alchemy');
recipe('antidote', { antidote_herb: 2, berry: 1 }, 'alchemy');
recipe('purify', { herb: 2, silver: 1 }, 'alchemy');
recipe('magic_stone', { crystal: 1, coal: 1 }, 'alchemy', 3);
recipe('fire_staff', { hardwood: 5, crystal: 4, ember_core: 1 }, 'magicbench');
recipe('frost_staff', { hardwood: 5, crystal: 4, frost_shard: 1 }, 'magicbench');
RECIPES.push({ id: 'restore_bow', output: 'bow', qty: 1, inputs: { broken_bow: 1, wood: 3, rope: 2 }, station: 'workbench', seconds: 0, category: 'weapon' }, { id: 'salvage_bow', output: 'wood', qty: 1, inputs: { broken_bow: 1 }, station: 'hand', seconds: 0, category: 'material' });
export type MonsterDef = {
    name: string;
    min: number;
    max: number;
    hp: number;
    damage: number;
    speed: number;
    color: number;
    role: 'melee' | 'ranged' | 'magic';
    loot: Record<string, number>;
    boss?: boolean;
};
export const MONSTERS: Record<string, MonsterDef> = {
    zombie: { name: 'Zombie', min: 1, max: 5, hp: 35, damage: 8, speed: 1.8, color: 0x65926a, role: 'melee', loot: { rotten: 1 } },
    archer: { name: 'Infected Archer', min: 2, max: 7, hp: 30, damage: 8, speed: 2.2, color: 0xab9580, role: 'ranged', loot: { wood: 1, rope: 1 } },
    slime: { name: 'Slime', min: 1, max: 4, hp: 25, damage: 6, speed: 1.5, color: 0x82c17a, role: 'melee', loot: { slime: 2 } },
    wolf: { name: 'Night Wolf', min: 2, max: 6, hp: 45, damage: 10, speed: 3.8, color: 0x4e5863, role: 'melee', loot: { leather: 2, fang: 1 } },
    guard: { name: 'Bone Guard', min: 3, max: 7, hp: 60, damage: 12, speed: 1.7, color: 0xbac2bc, role: 'melee', loot: { bone: 3 } },
    spider: { name: 'Venom Spider', min: 3, max: 8, hp: 35, damage: 7, speed: 3, color: 0x8c609b, role: 'melee', loot: { toxic: 2, fiber: 2 } },
    golem: { name: 'Stone Golem', min: 4, max: 9, hp: 130, damage: 20, speed: 1.3, color: 0x7a8582, role: 'melee', loot: { stone: 6 } },
    ember: { name: 'Ember Spirit', min: 4, max: 8, hp: 45, damage: 12, speed: 2.5, color: 0xe69554, role: 'magic', loot: { ember_core: 1 } },
    frost: { name: 'Frost Wraith', min: 5, max: 9, hp: 45, damage: 10, speed: 2.5, color: 0x75bec7, role: 'magic', loot: { frost_shard: 1 } },
    wizard: { name: 'Wizard', min: 4, max: 10, hp: 70, damage: 10, speed: 2, color: 0x9883c0, role: 'magic', loot: { heal: 1 } },
    priest: { name: 'Hex Priest', min: 6, max: 10, hp: 80, damage: 8, speed: 2, color: 0xa576b5, role: 'magic', loot: { purify_shard: 2 } },
    brute: { name: 'Siege Brute', min: 6, max: 10, hp: 150, damage: 18, speed: 1.4, color: 0x8a765f, role: 'melee', loot: { iron: 2, leather: 2 } },
    cow: { name: '소', min: 1, max: 1, hp: 25, damage: 0, speed: 1.2, color: 0xa88970, role: 'melee', loot: { raw_meat: 2, leather: 2 } },
    sheep: { name: '양', min: 1, max: 1, hp: 20, damage: 0, speed: 1.4, color: 0xe3dfcb, role: 'melee', loot: { raw_meat: 2, wool: 2 } },
    bird: { name: '새', min: 1, max: 1, hp: 8, damage: 0, speed: 2, color: 0xb38b67, role: 'melee', loot: { feather: 3 } },
    forest_boss: { name: '숲의 수호자', min: 1, max: 1, hp: 700, damage: 18, speed: 2.8, color: 0x785a3e, role: 'melee', loot: { leather: 10, fang: 4 }, boss: true },
    rock_boss: { name: '암석 수호자', min: 1, max: 1, hp: 1000, damage: 24, speed: 1.3, color: 0x788785, role: 'melee', loot: { golem_core: 1 }, boss: true },
    ruin_boss: { name: '유적 수호자', min: 1, max: 1, hp: 800, damage: 18, speed: 2, color: 0xa191c7, role: 'magic', loot: { purify_shard: 3 }, boss: true },
    night_boss: { name: '밤의 군주', min: 1, max: 1, hp: 1800, damage: 25, speed: 2.4, color: 0xa65163, role: 'magic', loot: { crystal: 10, mithril: 5 }, boss: true }
};
export const NODES: Record<string, {
    name: string;
    item: string;
    qty: number;
    hp: number;
    tool?: 'axe' | 'pick';
    level: number;
    regen: number;
    color: number;
}> = { tree: { name: '나무', item: 'wood', qty: 6, hp: 6, tool: 'axe', level: 0, regen: 2880, color: 0x3f7158 }, hardtree: { name: '단단한 나무', item: 'hardwood', qty: 6, hp: 7, tool: 'axe', level: 2, regen: 2880, color: 0x2d594f }, branch: { name: '떨어진 가지', item: 'wood', qty: 2, hp: 1, level: 0, regen: 1440, color: 0x6b4f36 }, pebble: { name: '작은 돌', item: 'stone', qty: 2, hp: 1, level: 0, regen: 1440, color: 0x8e9c95 }, rock: { name: '바위', item: 'stone', qty: 8, hp: 4, tool: 'pick', level: 1, regen: 0, color: 0x8a9493 }, iron: { name: '철 광맥', item: 'iron_ore', qty: 6, hp: 5, tool: 'pick', level: 1, regen: 0, color: 0xbb8163 }, coal: { name: '석탄 광맥', item: 'coal', qty: 6, hp: 5, tool: 'pick', level: 1, regen: 0, color: 0x303c40 }, silver: { name: '은 광맥', item: 'silver_ore', qty: 4, hp: 6, tool: 'pick', level: 2, regen: 0, color: 0xc1cfda }, gold: { name: '금 광맥', item: 'gold_ore', qty: 4, hp: 6, tool: 'pick', level: 2, regen: 0, color: 0xcab660 }, mithril: { name: '미스릴 광맥', item: 'mithril_ore', qty: 4, hp: 7, tool: 'pick', level: 3, regen: 0, color: 0x76c8d9 }, obsidian: { name: '흑요석', item: 'obsidian', qty: 5, hp: 7, tool: 'pick', level: 3, regen: 0, color: 0x403646 }, sulfur: { name: '유황 광맥', item: 'sulfur', qty: 5, hp: 6, tool: 'pick', level: 2, regen: 0, color: 0xd6c269 }, crystal: { name: '마력 결정', item: 'crystal', qty: 3, hp: 6, tool: 'pick', level: 2, regen: 0, color: 0x9878d1 }, berry: { name: '열매 덤불', item: 'berry', qty: 4, hp: 1, level: 0, regen: 1440, color: 0x604985 }, fiber: { name: '풀', item: 'fiber', qty: 3, hp: 1, level: 0, regen: 1440, color: 0x789b50 }, herb: { name: '약초', item: 'herb', qty: 2, hp: 1, level: 0, regen: 1440, color: 0x80b778 }, mushroom: { name: '식용 버섯', item: 'mushroom', qty: 2, hp: 1, level: 0, regen: 1440, color: 0xbe8e6d }, toxic: { name: '독성 버섯', item: 'toxic', qty: 2, hp: 1, level: 0, regen: 1440, color: 0x9e71a3 }, antidote: { name: '해독 약초', item: 'antidote_herb', qty: 2, hp: 1, level: 0, regen: 1440, color: 0x92ba71 }, wheat: { name: '야생 밀', item: 'wheat', qty: 2, hp: 1, level: 0, regen: 1440, color: 0xc7b377 } };
export const phase = (time: number) => {
    const t = time % 720;
    return t < 450 ? '낮' : t < 510 ? '해질녘' : t < 690 ? '밤' : '새벽';
};
export const day = (time: number) => Math.floor(time / 720) + 1;
export const tierCap = (d: number) => d === 1 ? 1 : d <= 3 ? 3 : Math.min(10, 4 + Math.floor((d - 4) / 3));
