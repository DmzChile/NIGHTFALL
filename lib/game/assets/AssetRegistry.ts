import catalog from '../../../public/models/nightfall/catalog.json';
import type { NodeState } from '../model';
import type { TreeTraits } from '../woodland';

/** Visual IDs are deliberately independent of gameplay item IDs and save schemas. */
export const AssetRegistry = {
    tree: { smallA:'tree_small_a', smallB:'tree_small_b', mediumA:'tree_medium_a', mediumB:'tree_medium_b', largeA:'tree_large_a', largeB:'tree_large_b', worldA:'tree_world_a', deadA:'dead_tree_a', deadB:'dead_tree_b', stumpSmall:'tree_stump_small', stumpMedium:'tree_stump_medium', stumpLarge:'tree_stump_large' },
    rock: { smallA:'rock_small_a',smallB:'rock_small_b',mediumA:'rock_medium_a',mediumB:'rock_medium_b',mediumC:'rock_medium_c',largeA:'rock_large_a',largeB:'rock_large_b',cliffA:'rock_cliff_a' },
    ore: { stone:'stone_node',coal:'coal_node',copper:'copper_node',iron:'iron_node',gold:'gold_node',crystal:'rare_crystal_node',silver:'silver_node',mithril:'mithril_node',obsidian:'obsidian_node',sulfur:'sulfur_node' },
    ground: { grassA:'grass_tuft_a',grassB:'grass_tuft_b',grassC:'grass_tuft_c',bushA:'bush_a',bushB:'bush_b',fern:'fern_a',mushroomA:'mushroom_a',mushroomB:'mushroom_b',branch:'fallen_branch_a',logA:'fallen_log_a',stonesA:'small_stones_a',stonesB:'small_stones_b',logSmall:'fallen_log_small',logLarge:'fallen_log_large' },
    crafting: { workbench:'workbench',campfire:'campfire',furnace:'furnace',anvil:'anvil',chest:'storage_chest' },
    props: { crate:'wood_crate',barrel:'barrel',sack:'sack',cart:'wood_cart',fence:'wood_fence',brokenFence:'broken_fence',sign:'signpost',torch:'torch_post',tent:'tent',brokenCart:'broken_cart',totem:'totem' },
    ruin: { wall:'ruin_wall',brokenWall:'ruin_wall_broken',corner:'ruin_corner',column:'ruin_column',arch:'ruin_arch',floor:'ruin_floor' },
    building: { wall:'wood_wall',window:'wood_wall_window',door:'wood_wall_door',floor:'wood_floor',roof:'wood_roof',roofCorner:'wood_roof_corner',beam:'wood_beam',pillar:'wood_pillar',stoneWall:'stone_wall',stoneFloor:'stone_floor' },
} as const;
type Groups=typeof AssetRegistry;
export type AssetId={ [K in keyof Groups]:Groups[K][keyof Groups[K]] }[keyof Groups];
export type AssetSpec={id:AssetId;category:string;file:string;triangles:number;materials:number;bounds:{min:number[];max:number[]};source:string};
export const ASSET_IDS=Object.values(AssetRegistry).flatMap(group=>Object.values(group)) as AssetId[];
export const ASSETS=new Map<AssetId,AssetSpec>((catalog.assets as AssetSpec[]).map(a=>[a.id,a]));
export function assetHash(value:string) { let h=2166136261;for(const c of value) h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0; }
export function treeAsset(t:TreeTraits):AssetId {
    if(t.size==='world') return 'tree_world_a';
    return (t.size==='small'?['tree_small_a','tree_small_b']:t.size==='large'?['tree_large_a','tree_large_b']:['tree_medium_a','tree_medium_b'])[t.variant] as AssetId;
}
const resources:Record<string,AssetId>={coal:'coal_node',iron:'iron_node',gold:'gold_node',silver:'silver_node',mithril:'mithril_node',obsidian:'obsidian_node',sulfur:'sulfur_node',crystal:'rare_crystal_node',pebble:'small_stones_a',branch:'fallen_branch_a',mushroom:'mushroom_a',toxic:'mushroom_b',fiber:'grass_tuft_b',herb:'fern_a',antidote:'fern_a'};
export function resourceAsset(n:Pick<NodeState,'id'|'kind'>):AssetId|null {
    if(n.kind==='rock') return (['stone_node','rock_medium_a','rock_medium_b','rock_medium_c'] as const)[assetHash(n.id)%4];
    return resources[n.kind]??null;
}
export function buildingAsset(kind:string):AssetId|null {
    if(kind.endsWith('_totem')||kind.endsWith('_altar')) return 'totem';
    return ({workbench:'workbench',campfire:'campfire',furnace:'furnace',advanced_furnace:'furnace',anvil:'anvil',chest:'storage_chest',wall:'wood_wall',door:'wood_wall_door'} as Record<string,AssetId>)[kind]??null;
}
