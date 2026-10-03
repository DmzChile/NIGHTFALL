import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as THREE from 'three';
import { addItem, biome, count, createWorld, height, makeEnemy, validateState } from '../lib/game/model';
import { Engine } from '../lib/game/engine';
import { isDryLand, nearFishingWater } from '../lib/game/ground';
import { SaveManager, pack, unpack } from '../lib/game/storage';
import { inlandWaterGeometry } from '../lib/game/water';
import { isTree } from '../lib/game/woodland';
import { TreeField } from '../lib/game/trees';
import { getTerrain, TerrainManager } from '../lib/game/world/TerrainManager';
import { SEA_LEVEL, TERRAIN_SEGMENTS, TERRAIN_SIZE, TERRAIN_VERSION, WATER_DEPTH_EPSILON,
    terrainHeight, terrainSlope, terrainWaterLevel, type TerrainWorld } from '../lib/game/terrain';

const seeds = ['nightfall', 'river-and-hills', '다채로운 섬'];
const world = (seed: string): TerrainWorld => ({ seed, terrainVersion: 4 });
const points: [number, number][] = [];
for (let x = -440; x <= 440; x += 11) for (let z = -440; z <= 440; z += 11)
    if (Math.hypot(x, z) < 420) points.push([x, z]);

function groundGeometry(s: TerrainWorld) {
    const mesh = getTerrain(s).createMesh();
    mesh.material.dispose();
    return mesh.geometry;
}
function fixture(seed = seeds[0]) {
    const s = createWorld('natural terrain', seed);
    s.nodes = []; s.enemies = []; s.buildings = [];
    const storage = new SaveManager(); storage.save = async () => Date.now();
    return { s, engine: new Engine(s, storage) };
}

describe('seeded natural terrain', () => {
    it('keeps released version 3 separate from version 4 waterways for the same seed', () => {
        const oldWorld: TerrainWorld = { seed: seeds[0], terrainVersion: 3 };
        const previous = new TerrainManager(seeds[0], 3), natural = getTerrain(world(seeds[0]));
        assert.equal(getTerrain(oldWorld).data.version, 3);
        assert.equal(natural.data.version, 4);
        assert.equal(natural.data.segments, 200);
        for (const [x, z] of points.filter((_, i) => i % 37 === 0)) {
            assert.equal(terrainHeight(x, z, oldWorld), previous.getHeightAt(x, z));
            assert.equal(terrainWaterLevel(x, z, oldWorld), null);
        }
        assert.notDeepEqual(getTerrain(oldWorld).data.heights, natural.data.heights);
    });
    it('reproduces the same island from its seed, varies other seeds, and retains version 2 geometry', () => {
        assert.equal(TERRAIN_VERSION, 4);
        const a = world(seeds[0]), b = world(seeds[1]);
        const sampled = points.filter((_, i) => i % 37 === 0);
        const profile = (s: TerrainWorld) => sampled.map(([x, z]) => [terrainHeight(x, z, s), terrainWaterLevel(x, z, s)]);
        assert.deepEqual(profile(a), profile({ ...a }));
        assert.notDeepEqual(profile(a), profile(b));
        for (const [x, z] of sampled) {
            assert.equal(terrainHeight(x, z), terrainHeight(x, z, { seed: seeds[0], terrainVersion: 2 }));
            assert.equal(terrainHeight(x, z), terrainHeight(x, z, { seed: seeds[1], terrainVersion: 2 }));
            assert.equal(terrainWaterLevel(x, z, { seed: seeds[0], terrainVersion: 2 }), null);
        }
    });
    it('keeps the starting meadow gentle and landmarks dry across different seeds', () => {
        for (const seed of seeds) {
            const s = createWorld('protected terrain', seed);
            assert.equal(s.terrainVersion, 4);
            for (let x = -25; x <= 25; x += 5) for (let z = -25; z <= 25; z += 5) {
                assert.ok(Math.abs(height(x, z, s)) < 1, `${seed}: starting height ${x},${z}`);
                assert.ok(terrainSlope(x, z, s) < .1, `${seed}: starting slope ${x},${z}`);
                assert.equal(terrainWaterLevel(x, z, s), null);
            }
            for (const b of s.buildings) {
                assert.ok(isDryLand(b.x, b.z, s, 3), `${seed}: wet landmark ${b.kind}`);
                assert.ok(terrainSlope(b.x, b.z, s) < .4, `${seed}: steep landmark ${b.kind}`);
            }
        }
    });
    it('adds restrained waterways to western forest and marsh while retaining mountain and regional character', () => {
        for (const seed of seeds) {
            const s = world(seed), wet: [number, number][] = [], slopes: number[] = [];
            let summit = -Infinity, ridge = -Infinity, ruins = -Infinity;
            for (const [x, z] of points) {
                const y = terrainHeight(x, z, s), slope = terrainSlope(x, z, s), water = terrainWaterLevel(x, z, s);
                assert.ok(Number.isFinite(y) && y >= -3 && y < 70, `${seed}: invalid elevation ${x},${z}: ${y}`);
                assert.ok(Number.isFinite(slope) && slope < 2.5, `${seed}: abrupt slope ${x},${z}: ${slope}`);
                slopes.push(slope);
                if (biome(x, z) === '화산') summit = Math.max(summit, y);
                if (biome(x, z) === '바위 언덕') ridge = Math.max(ridge, y);
                if (biome(x, z) === '유적') ruins = Math.max(ruins, y);
                if (water !== null) {
                    assert.ok(water - y > WATER_DEPTH_EPSILON && water - y <= 1.05 + 1e-5, `${seed}: water depth ${x},${z}`);
                    wet.push([x, z]);
                }
            }
            assert.ok(summit > 30 && ridge > 25, `${seed}: missing mountain peaks`);
            assert.ok(ruins < 27, `${seed}: ruins overwhelmed by mountains`);
            slopes.sort((a, b) => a - b);
            assert.ok(slopes[Math.floor(slopes.length * .95)] < .8, `${seed}: excessive steep ground`);
            assert.ok(wet.length > points.length * .003 && wet.length < points.length * .15, `${seed}: water coverage ${wet.length}/${points.length}`);
            assert.ok(wet.filter(([x, z]) => ['숲', '습지'].includes(biome(x, z))).length > wet.length * .8);
            assert.ok(wet.every(([x, z]) => biome(x, z) !== '화산' && biome(x, z) !== '유적'));
            assert.equal(terrainHeight(500, 0, s), -2);
            assert.equal(terrainWaterLevel(500, 0, s), null);
        }
    });
    it('forms a connected winding watercourse and distinct compact ponds', () => {
        const step = TERRAIN_SIZE / TERRAIN_SEGMENTS;
        for (const seed of seeds) {
            const s = world(seed), wet = new Set<string>(), spans: { x: number; z: number; size: number }[] = [];
            for (let ix = -76; ix <= 76; ix++) for (let iz = -76; iz <= 76; iz++) {
                const x = ix * step, z = iz * step;
                if (Math.hypot(x, z) < 420 && terrainWaterLevel(x, z, s) !== null) wet.add(`${ix},${iz}`);
            }
            while (wet.size) {
                const first = wet.values().next().value!;
                const queue = [first.split(',').map(Number)]; wet.delete(first);
                let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
                for (let i = 0; i < queue.length; i++) {
                    const [x, z] = queue[i];
                    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
                    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
                        const key = `${x + dx},${z + dz}`;
                        if (wet.delete(key)) queue.push([x + dx, z + dz]);
                    }
                }
                spans.push({ x: (maxX - minX) * step, z: (maxZ - minZ) * step, size: queue.length });
            }
            assert.ok(spans.some(p => p.x > 200 && p.z > 40), `${seed}: missing winding river`);
            assert.ok(spans.filter(p => p.size > 8 && p.x >= 20 && p.x < 90 && p.z >= 20 && p.z < 90).length >= 2,
                `${seed}: missing separate ponds`);
        }
    });
    it('matches rendered ground and clipped inland water triangles, leaving dry banks uncovered', () => {
        const s = world(seeds[0]), ground = groundGeometry(s), water = inlandWaterGeometry(ground, s);
        assert.ok(water.getAttribute('position').count > 0);
        const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
        const groundMesh = new THREE.Mesh(ground, material), waterMesh = new THREE.Mesh(water, material);
        groundMesh.updateMatrixWorld(); waterMesh.updateMatrixWorld();
        const samples = points.filter((_, i) => i % 41 === 0).map(([x, z]) => [x + .7, z + 1.3] as [number, number]);
        samples.push(...points.filter(([x, z]) => (terrainWaterLevel(x, z, s) ?? -Infinity) > SEA_LEVEL + .1).slice(0, 35));
        let wetHits = 0;
        try {
            for (const [x, z] of samples) {
                const ray = new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
                const hit = ray.intersectObject(groundMesh)[0], waterHit = ray.intersectObject(waterMesh)[0];
                const y = terrainHeight(x, z, s), level = terrainWaterLevel(x, z, s);
                assert.ok(hit && Math.abs(hit.point.y - y) < 1e-5, `ground mismatch ${x},${z}`);
                assert.equal(height(x, z, s), y);
                if (level !== null && level > SEA_LEVEL + .1) {
                    assert.ok(waterHit, `inland water missing ${x},${z}`);
                    assert.ok(Math.abs(waterHit.point.y - level) < 1e-4, `water mismatch ${x},${z}`);
                    wetHits++;
                } else if (level === null) {
                    assert.equal(waterHit, undefined, `water covering dry bank ${x},${z}`);
                }
            }
            assert.ok(wetHits > 10);
            const oldGround = groundGeometry({ seed: seeds[0], terrainVersion: 2 });
            const oldWater = inlandWaterGeometry(oldGround, { seed: seeds[0], terrainVersion: 2 });
            assert.equal(oldWater.getAttribute('position').count, 0);
            oldGround.dispose(); oldWater.dispose();
        } finally { ground.dispose(); water.dispose(); material.dispose(); }
    });
    it('keeps generated resources and forests out of rivers and ponds without losing the starter supply', () => {
        for (const seed of seeds) {
            const s = createWorld('dry resources', seed);
            assert.ok(s.nodes.filter(isTree).length > 800);
            assert.equal(s.nodes.slice(0, 28).filter(n => n.kind === 'fiber').length, 14);
            for (const n of s.nodes) assert.equal(terrainWaterLevel(n.x, n.z, s), null, `${seed}: submerged ${n.id}`);
            for (const e of s.enemies) assert.ok(isDryLand(e.x, e.z, s, .8), `${seed}: submerged animal ${e.kind}`);
        }
    });
    it('moves instanced tree roots with the world seed and terrain version, including cached and shaken trees', () => {
        const s = createWorld('tree terrain', seeds[0]);
        const n = s.nodes.find(isTree)!; n.x = 100; n.z = -120; s.nodes = [n];
        const field = new TreeField(), matrix = new THREE.Matrix4();
        const rootY = () => {
            field.update(s, n.x, n.z, 0);
            const batch = [...field.batches.values()].find(b => b.mesh.count > 0)!;
            batch.mesh.getMatrixAt(0, matrix);
            assert.ok(Math.abs(matrix.elements[13] - height(n.x, n.z, s)) < 1e-5);
            return matrix.elements[13];
        };
        try {
            const initial = rootY();
            s.seed = seeds[1]; assert.notEqual(rootY(), initial);
            s.terrainVersion = 2; rootY();
            s.terrainVersion = 4; field.shake(n.id, 0); field.update(s, n.x, n.z, .05);
            const batch = [...field.batches.values()].find(b => b.mesh.count > 0)!;
            batch.mesh.getMatrixAt(0, matrix);
            assert.ok(Math.abs(matrix.elements[13] - height(n.x, n.z, s)) < 1e-5);
        } finally { field.dispose(); }
    });
    it('preserves version 2 saves and round trips versions 3 and 4 without moving entities or absolute projectiles', async () => {
        for (const version of [2, 3, 4] as const) {
            const s = createWorld('terrain compatibility', seeds[0]); s.terrainVersion = version;
            s.projectiles.push({ id: crypto.randomUUID(), x: -265, z: -115, y: height(-265, -115, s) + 2,
                vx: 1, vy: 0, vz: 0, life: 2, damage: 1, enemy: false, type: 'arrow' });
            const before = structuredClone(s), loaded = await unpack(await pack(s));
            assert.deepEqual(s, before);
            assert.deepEqual(loaded, before);
            assert.deepEqual(validateState(loaded), before);
            assert.throws(() => validateState({ ...s, terrainVersion: 5 }), /지형 버전/);
        }
    });
    it('aims ranged enemies using the seeded ground height uphill and downhill', () => {
        for (const [enemyX, playerX] of [[255, 267], [267, 255]]) {
            const { s, engine } = fixture(seeds[1]);
            Object.assign(s.player, { x: playerX, z: -40, y: 1.5 });
            const enemy = makeEnemy(s, 'archer', 2, enemyX, -40);
            enemy.state = 'windup'; enemy.timer = 0; s.enemies = [enemy];
            engine.resume(); engine.step(1 / 30);
            const q = s.projectiles[0]; assert.ok(q);
            const origin = height(enemyX, -40, s) + 1.3;
            const target = height(playerX, -40, s) + s.player.y + 1;
            const seconds = (playerX - enemyX) / q.vx;
            assert.ok(Math.abs(origin + q.vy * seconds - target) < 1e-8);
            assert.ok(Math.abs(Math.hypot(q.vx, q.vy, q.vz) - 10) < 1e-8);
            assert.ok(Math.abs(origin - height(enemyX, -40) - 1.3) > 1);
            engine.dispose();
        }
    });
    it('rejects building placement in shallow water atomically and permits inland shore fishing', () => {
        const { s, engine } = fixture();
        const wet = points.find(([x, z]) => terrainWaterLevel(x, z, s) !== null && terrainSlope(x, z, s) < .3);
        assert.ok(wet, 'no gentle water placement sample');
        Object.assign(s.player, { x: wet[0], z: wet[1] + 3, yaw: 0 });
        addItem(s, 'workbench', 1);
        const before = structuredClone(s);
        engine.place(s.player.items.find(i => i.id === 'workbench')!);
        assert.deepEqual(s, before);
        assert.equal(count(s.player.items, 'workbench'), 1);
        const shore = points.find(([x, z]) => Math.hypot(x, z) < 380 && isDryLand(x, z, s) && nearFishingWater(x, z, s));
        assert.ok(shore, 'no dry inland fishing shore');
        Object.assign(s.player, { x: shore[0], z: shore[1] });
        s.gameMode = 'creative';
        addItem(s, 'fishing_rod', 1);
        const rod = s.player.items.find(i => i.id === 'fishing_rod')!;
        s.player.hotbar[0] = rod.uid; s.player.selected = 0;
        engine.resume(); engine.attack();
        assert.ok(s.player.fishing);
        s.player.fishing.success = true;
        for (let i = 0; i < 211; i++) engine.step(1 / 30);
        assert.equal(s.player.fishing, undefined);
        assert.equal(count(s.player.items, 'fish'), 1);
        engine.dispose();
    });
});
