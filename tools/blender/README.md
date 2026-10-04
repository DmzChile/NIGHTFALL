# NIGHTFALL original low-poly pack

These scripts author original geometry for NIGHTFALL. They do not read any Muck model, texture, UV or reference mesh. Blender 4.3.2 was actually used to produce the checked-in GLBs; Node/Three.js does not fabricate replacement GLB files.

## Reproduce

Run from the repository root with Blender 4.3.2 or a compatible Blender version:

```bash
blender --background --python tools/blender/export_assets.py -- --output public/models/nightfall
blender --background --python tools/blender/render_gallery.py -- --assets public/models/nightfall
pnpm typecheck
pnpm test
node --import tsx tools/inspect-assets.ts
pnpm build
```

For a single pack, add `--category trees` (or rocks, ores, ground, crafting, props, ruins, building). The exporter preserves other catalog entries. Geometry is seeded locally in each generator, so generation does not change gameplay RNG. GLB exporter metadata may differ between Blender versions; pin 4.3.2 for reproducible geometry and catalog measurements.

When Blender is absent, install it from Blender's official distribution and run the commands above. The checked-in real GLBs can be used without Blender. The runtime's existing resource/building/tree primitives and temporary scenery primitives handle loading failures; they are not final asset files.

## Pipeline and conventions

`generate_*.py` → common palette and mesh helpers → applied rotation/scale → merged vertices and checked outward normals → unused material removal → bottom-centered origin → triangle/finite-vertex validation → Blender GLB export → measured catalog → Three.js cache and instancing.

Blender models use Z up while authored; `export_yup=True` exports Three.js Y up. One unit equals one metre. The existing player eye is 1.65m above ground. Small / medium / large / world trees are 3.6 / 6.5 / 11 / 30m high and have different geometry, not just scaling. Building grid is 2m; posts/beam connectors fit that grid. Rock and ore scale is readable within the existing 3.8m harvesting reach. Every origin sits at the bottom center.

Shared palette roles cover forest foliage, bark/cut wood, stone, dark metal, copper, iron, gold, crystal and muted cloth. There are no texture dependencies. Flat faces and 1–4 materials per object preserve a chunky silhouette; runtime materials are baked into vertex colors. Foliage and mineral emission masks remain separate so autumn recoloring never changes bark, and crystal emission never makes the whole base rock glow.

## Files

| Script | Assets |
| --- | --- |
| common.py | Palette, geometry, transforms, normals, cleanup and floor origin |
| generate_trees.py | Seven living trees, two dead trees, three stumps |
| generate_rocks.py | Eight angular rocks, including a cliff shelf |
| generate_resources.py | Ten embedded ore nodes; copper is gallery-only until a gameplay resource exists |
| generate_ground.py | Fourteen grass, bush, fern, mushroom, stone and fallen-wood props |
| generate_crafting.py | Workbench, campfire, furnace, anvil and chest |
| generate_props.py | Eleven survival props, including tent, broken cart and totem |
| generate_ruins.py | Six modular ruin pieces |
| generate_structures.py | Ten grid-aligned building pieces |
| export_assets.py | GLB export and actual triangle/material/bounds catalog |
| render_gallery.py | CPU render of the exported GLBs into gallery.jpg |

See [the asset inventory](../../docs/asset-inventory.md) for every filename, actual triangle count and dimensions. `node --import tsx tools/inspect-assets.ts` recreates that inventory and the CPU preparation measurements in `docs/asset-performance.json`. Timings vary by machine; prepared batch counts exclude GPU frustum culling and shadow passes.

The game menu opens `/assets`; `/debug-assets` prints the current cache and batch counts. Gallery loading is isolated from the saved world.
