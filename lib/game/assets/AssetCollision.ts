/** Simple gameplay bodies; mesh detail never becomes a physics mesh collider. */
export function buildingRadius(kind:string,swept=false) {
    if(['wall','chest','furnace','advanced_furnace','anvil'].includes(kind))return swept?1.2:1;
    if(kind==='door')return swept?1.2:0;
    if(kind.endsWith('_totem')||kind.endsWith('_altar'))return 1.2;
    if(['workbench','alchemy','magicbench'].includes(kind))return 1.1;
    if(kind==='campfire')return .85;
    return 0;
}
