// node --import tsx scripts/export-terrain-preview.mjs > .sites-runtime/terrain-preview.json
import { TerrainManager } from '../lib/game/world/TerrainManager.ts';
const terrain = new TerrainManager('nightfall'), mesh = terrain.createMesh();
console.log(JSON.stringify({ seed: terrain.data.seed, size: terrain.data.size, segments: terrain.data.segments,
    positions: Array.from(mesh.geometry.attributes.position.array), colors: Array.from(mesh.geometry.attributes.color.array),
    indices: Array.from(mesh.geometry.index.array) }));
mesh.geometry.dispose(); mesh.material.dispose();
