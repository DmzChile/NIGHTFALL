import { ITEMS, RECIPES, type Recipe } from './data';
import type { State } from './model';
export const starterRecipes = () => RECIPES.filter(r => r.station === 'hand' || ['stone_axe', 'stone_pick', 'stone_sword'].includes(r.id)).map(r => r.id);
/** Legacy worlds retain all previously available recipes. */
export function ensureProgression(s: State) {
    if (!s.knownItems)
        s.knownItems = [];
    if (!s.unlockedRecipes)
        s.unlockedRecipes = RECIPES.map(r => r.id);
    if (!s.regionNext)
        s.regionNext = {};
    discoverItems(s);
}
export function discoverItems(s: State): string[] {
    const known = s.knownItems ??= [];
    const unlocked = s.unlockedRecipes ??= starterRecipes();
    let changed = false;
    for (const item of s.player.items)
        if (!known.includes(item.id)) {
            known.push(item.id);
            changed = true;
        }
    const added: string[] = [];
    if (changed)
        for (const r of RECIPES)
            if (!unlocked.includes(r.id) && Object.keys(r.inputs).every(id => known.includes(id))) {
                unlocked.push(r.id);
                added.push(r.id);
            }
    return added;
}
export function recipeUnlocked(s: State, recipe: Recipe) {
    return s.unlockedRecipes?.includes(recipe.id) ?? true;
}
export function missingDiscoveries(s: State, recipe: Recipe) {
    return Object.keys(recipe.inputs).filter(id => !s.knownItems?.includes(id)).map(id => ITEMS[id].name);
}
