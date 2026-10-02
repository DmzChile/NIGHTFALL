// Reproduce CPU measurements: node --import tsx scripts/benchmark-terrain.mjs
import { TerrainManager, getTerrain } from '../lib/game/world/TerrainManager.ts';
import { createWorld } from '../lib/game/model.ts';

const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
new TerrainManager('warmup');
const results = [];
for (const segments of [128, 256]) {
    const generation = [], meshes = [], connectivity = [];
    for (let i = 0; i < 7; i++) {
        const start = performance.now(), t = new TerrainManager(`benchmark-${i}`, 3, segments);
        generation.push(performance.now() - start);
        const searchStart = performance.now(); t.isReachableAt(0, 0); connectivity.push(performance.now() - searchStart);
        const meshStart = performance.now(), mesh = t.createMesh(); meshes.push(performance.now() - meshStart);
        mesh.geometry.dispose(); mesh.material.dispose();
    }
    const t = new TerrainManager('nightfall', 3, segments), mesh = t.createMesh(), queries = [];
    t.isReachableAt(0, 0);
    let checksum = 0;
    for (let r = 0; r < 5; r++) {
        const start = performance.now();
        for (let i = 0; i < 1000000; i++) checksum += t.getHeightAt((i % 901) - 450, (Math.floor(i / 901) % 901) - 450);
        queries.push(performance.now() - start);
    }
    const gpuBytes = Object.values(mesh.geometry.attributes).reduce((n, a) => n + a.array.byteLength, mesh.geometry.index.array.byteLength);
    results.push({ segments, vertices: mesh.geometry.attributes.position.count, triangles: mesh.geometry.index.count / 3,
        generationMedianMs: +median(generation).toFixed(2), connectivityMedianMs: +median(connectivity).toFixed(2), meshMedianMs: +median(meshes).toFixed(2), millionHeightQueriesMedianMs: +median(queries).toFixed(2),
        retainedCpuBytes: t.cpuBytes, geometryBufferBytes: gpuBytes, checksum: +checksum.toFixed(2) });
    mesh.geometry.dispose(); mesh.material.dispose();
}
const distribution = [], worlds = [];
for (const seed of ['nightfall', 'forest-test', 'terrain']) {
    const start = performance.now(), s = createWorld('benchmark', seed), t = getTerrain(s);
    worlds.push({ seed, worldMs: +(performance.now() - start).toFixed(2), trees: s.nodes.filter(n => n.tree).length, resources: s.nodes.length, animals: s.enemies.filter(e => e.animal).length });
    let count = 0, walkable = 0, min = Infinity, max = -Infinity; const types = {};
    for (let z = -450; z <= 450; z += 10) for (let x = -450; x <= 450; x += 10) if (Math.hypot(x, z) <= 450) {
        const h = t.getHeightAt(x, z), type = t.getTerrainTypeAt(x, z); count++; walkable += +t.isWalkable(x, z);
        min = Math.min(min, h); max = Math.max(max, h); types[type] = (types[type] || 0) + 1;
    }
    distribution.push({ seed, count, min: +min.toFixed(2), max: +max.toFixed(2), walkablePercent: +(walkable / count * 100).toFixed(2), types });
}
console.log(JSON.stringify({ node: process.version, measurements: 'CPU only; includes no GPU rendering, shadows, tree models or mobile FPS', results, distribution, worlds }, null, 2));
