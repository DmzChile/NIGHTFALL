# NIGHTFALL asset system analysis (before visual migration)

Source base: GitHub `3afe0f86d65084977ae617bf0db992fbfee627c1`; hosted source `2b4b7d0b26bf3966c398ebeb7024844a246817b9`. Identical game content. Muck is used only as the requested broad low-poly/readability direction; no Muck files or designs are imported.

| System | Existing implementation | Integration boundary |
|---|---|---|
| Scene | `lib/game/scene.ts`; entity groups in `objects`, separate terrain/sky/water/TreeField | Replace visuals and add separate scenery field |
| GLTFLoader/cache | `tree-models.ts`, four species GLBs; TreeField caches geometry | Central cache extends loading to all authored assets |
| Trees | `woodland.ts`: small 3.6m, normal 6.5m, large 11m, world 30m; radius .22/.4/.7/1.8 | Keep saved size/species/variant/autumn, HP and drops |
| Rock/ore | `makeNode` primitives; ore resource IDs in `data.ts` | Map entity ID to instanced visual; copper stays an asset only |
| Crafting/totem | `makeBuilding`; effect/PointLight children, independent saved facility state | Shared visual mesh with original jobs/items/cooldowns |
| Generation | `createWorld` resources and `ensureForest` (~1,300 trees); seeded terrain versions 2/3/4 | Separate deterministic scenery stream |
| Terrain | `TerrainManager`, v3 THREE.Terrain default, selectable v4 rivers, legacy v2 | Height/slope/type/foundation APIs; no heightmap regeneration |
| Coordinates | Y up, world x/z = sampler x/z, eye height 1.65m | GLB floor-centered origin and scale matched to current trees |
| Interaction | Harvest reach 3.8m; facility/item reach 3.5m; ray targets entity IDs | Instance ID maps to existing resource IDs |
| Collision | Trunk circles, selected building circles, terrain grade, swept dodge | Simple additional scenery colliders, never visual mesh colliders |
| Drops/save | Mutable nodes, buildings, inventory, drops saved; terrain seed/version retained | No visual objects in save schema |
| Instancing | Trees already instanced, non-tree resources are groups | Extend instancing to rocks, ores and ground props |
| Lighting | Warm sun/cool moon, bounded shadow projection; quality low/medium/high | Big objects cast; tiny props omit shadows |
| Performance | Pixel ratios 1/1.25/1.5; shadow maps disabled/1024/2048; PC controls | Distance-limited decoration and shared materials; mobile FPS requires device measurement |

Original models and primitive resource/building geometry remain as loading-failure fallbacks. Gameplay resource generation, inventory, recipes, terrain version selection and persistence schema are not rewritten.
