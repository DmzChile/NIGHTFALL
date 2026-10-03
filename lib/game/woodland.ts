import { NODES } from './data';
import type { NodeState, State } from './model';
import { isDryLand } from './ground';
import { terrainSlope, getTerrain } from './terrain';

export type TreeSize = 'small' | 'normal' | 'large' | 'world';
export type TreeSpecies = 'pine' | 'oak' | 'birch' | 'maple';
export type TreeTraits = { size: TreeSize; species: TreeSpecies; autumn: boolean; variant: 0 | 1 };
export const FOREST_VERSION = 1;
export const TREE_SIZES = {
    small: { name: '작은 나무', hp: 12, qty: 4, level: 0, height: 3.6, crown: 1.2, radius: .22, regen: 2880 },
    normal: { name: '보통 나무', hp: 24, qty: 8, level: 0, height: 6.5, crown: 2.2, radius: .4, regen: 2880 },
    large: { name: '대형 나무', hp: 54, qty: 16, level: 1, height: 11, crown: 3.8, radius: .7, regen: 3600 },
    world: { name: '세계수', hp: 180, qty: 48, level: 3, height: 30, crown: 9, radius: 1.8, regen: 7200 }
} as const;
export const TREE_SPECIES: Record<TreeSpecies, string> = { pine: '소나무', oak: '참나무', birch: '자작나무', maple: '단풍나무' };
export const isTree = (n: Pick<NodeState, 'kind'>) => n.kind === 'tree' || n.kind === 'hardtree';
function seedHash(value: string) {
    let h = 2166136261;
    for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
}
function randomStream(seed: string) {
    let value = seedHash(seed);
    return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}
export function treeTraits(seed: string, n: Pick<NodeState, 'id' | 'kind' | 'x' | 'z'>): TreeTraits {
    const rand = randomStream(`${seed}/tree/1/${n.id}/${n.x}/${n.z}`), sizeRoll = rand();
    const species = (['pine', 'oak', 'birch', 'maple'] as const)[Math.floor(rand() * 4)];
    return { size: sizeRoll < .28 ? 'small' : sizeRoll < .82 ? 'normal' : 'large', species,
        autumn: species !== 'pine' && rand() < (species === 'maple' ? .75 : .35), variant: rand() < .5 ? 0 : 1 };
}
export function treeColor(traits: TreeTraits) {
    const greens = { pine: 0x346b52, oak: 0x638348, birch: 0x91aa58, maple: 0x507c4c };
    const autumn = { pine: greens.pine, oak: 0xbc7b38, birch: 0xd4ae49, maple: 0xbb4e32 };
    if (traits.size === 'world') return traits.autumn ? (traits.variant ? 0xc6a965 : 0xd3bc78) : (traits.variant ? 0x6eae88 : 0x81b77b);
    return (traits.autumn ? autumn : greens)[traits.species] + (traits.variant ? 0x090803 : 0);
}
export function nodeDefinition(n: Pick<NodeState, 'kind' | 'tree'>) {
    const d = NODES[n.kind];
    if (!isTree(n) || !n.tree) return d;
    const t = n.tree, profile = TREE_SIZES[t.size], hard = n.kind === 'hardtree';
    return { ...d, name: `${profile.name} · ${TREE_SPECIES[t.species]}${t.autumn ? ' · 단풍' : ''}${hard ? ' · 단단한 목재' : ''}`,
        hp: Math.round(profile.hp * (hard ? 1.5 : 1)), qty: hard ? Math.ceil(profile.qty * .65) : profile.qty,
        level: Math.max(d.level, profile.level), regen: profile.regen, color: treeColor(t) };
}
export function nodeRadius(n: Pick<NodeState, 'kind' | 'tree'>) {
    if (isTree(n)) return TREE_SIZES[n.tree?.size || 'normal'].radius;
    return ['rock', 'iron'].includes(n.kind) ? .55 : 0;
}
export function treeYaw(n: Pick<NodeState, 'id'>) { return seedHash(n.id) / 4294967296 * Math.PI * 2; }

/** Add the forest once using its own RNG; retain existing resource IDs and harvest progress. */
export function ensureForest(s: State, regionAt: (x: number, z: number) => string) {
    for (const n of s.nodes) if (isTree(n) && !n.tree) {
        n.tree = treeTraits(s.seed, n);
        const fraction = Math.max(0, Math.min(1, n.hp / (n.kind === 'hardtree' ? 7 : 6)));
        n.hp = n.depleted ? 0 : Math.max(1, nodeDefinition(n).hp * fraction);
    }
    if (s.forestVersion === FOREST_VERSION) return;
    const terrain = getTerrain(s);
    const rand = randomStream(s.seed + '/forest/1'), ids = new Set(s.nodes.map(n => n.id));
    // Nearby blockers are indexed so increasing density does not require all-pairs searches.
    const cells = new Map<string, { x: number; z: number; radius: number }[]>();
    const key = (x: number, z: number) => `${Math.floor(x / 8)},${Math.floor(z / 8)}`;
    const index = (x: number, z: number, radius: number) => {
        const k = key(x, z), list = cells.get(k) || []; list.push({ x, z, radius }); cells.set(k, list);
    };
    for (const n of s.nodes) index(n.x, n.z, isTree(n) ? nodeRadius(n) + .7 : .7);
    for (const b of s.buildings) index(b.x, b.z, 4);
    for (const d of s.drops) index(d.x, d.z, 2);
    const clear = (x: number, z: number, radius: number) => {
        if (Math.hypot(x - s.player.x, z - s.player.z) < radius + 6) return false;
        const cx = Math.floor(x / 8), cz = Math.floor(z / 8), reach = Math.ceil((radius + 9) / 8);
        for (let ix = cx - reach; ix <= cx + reach; ix++) for (let iz = cz - reach; iz <= cz + reach; iz++)
            for (const b of cells.get(`${ix},${iz}`) || []) if (Math.hypot(x - b.x, z - b.z) < radius + b.radius) return false;
        return true;
    };
    const add = (id: string, kind: string, x: number, z: number, traits?: TreeTraits) => {
        if (ids.has(id)) return;
        const n: NodeState = { id, kind, x, z, hp: 0, depleted: false, readyAt: 0 };
        n.tree = traits || treeTraits(s.seed, n);
        if (!clear(x, z, nodeRadius(n) + .7) || !isDryLand(x, z, s, nodeRadius(n) + .7)) return;
        n.hp = nodeDefinition(n).hp; s.nodes.push(n); ids.add(id); index(x, z, nodeRadius(n) + .7);
    };
    // Three ancient trees have spacious clearings and are kept away from the starter supply ring.
    for (const [i, x, z] of [[0, -140, -120], [1, 150, 140], [2, -120, 215]]) {
        for (let attempt = 0; attempt < 20; attempt++) {
            const px = x + (rand() - .5) * 30, pz = z + (rand() - .5) * 30;
            if (clear(px, pz, 10) && terrainSlope(px, pz, s) < .35 && isDryLand(px, pz, s, 3) && terrain.canSpawnResource('hardtree', px, pz)) {
                add(`forest-world-${i}`, 'hardtree', px, pz, { size: 'world', species: 'oak', autumn: false, variant: i % 2 as 0 | 1 });
                index(px, pz, 9); break;
            }
        }
    }
    for (let ix = -38; ix <= 38; ix++) for (let iz = -38; iz <= 38; iz++) {
        const x = ix * 12 + (rand() - .5) * 7, z = iz * 12 + (rand() - .5) * 7;
        const region = regionAt(x, z), density = region === '숲' ? .86 : region === '습지' ? .3 : region === '초원' ? .24 : 0;
        if (rand() > density || Math.hypot(x, z) > 420 || Math.hypot(x, z) < 38 || terrainSlope(x, z, s) > .55 || !terrain.canSpawnResource('tree', x, z)) continue;
        add(`forest-${ix}-${iz}`, region === '숲' && rand() < .2 ? 'hardtree' : 'tree', x, z);
    }
    s.forestVersion = FOREST_VERSION;
}
