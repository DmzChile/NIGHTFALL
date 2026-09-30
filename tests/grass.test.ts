import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { grassAt, GrassField, terrainSurfaceHeight, TERRAIN_SIZE, TERRAIN_SEGMENTS } from '../lib/game/grass';
import { createWorld, hash, height, type Building, type NodeState } from '../lib/game/model';

describe('decorative grass', () => {
    it('world seed determines vegetation without changing gameplay state or randomness', () => {
        const s = createWorld('grass', 'grass'), before = structuredClone(s), field = new GrassField();
        field.update(s.seed, 0, 8, s.buildings, s.nodes, 0);
        assert.deepEqual(s, before);
        assert.deepEqual(grassAt(hash('grass'), 0, 0, 3), grassAt(hash('grass'), 0, 0, 3));
        assert.notDeepEqual(grassAt(hash('grass'), 0, 0, 3), grassAt(hash('other'), 0, 0, 3));
        assert.ok(field.mesh.count > 1000 && field.mesh.count <= field.capacity); field.dispose();
    });
    it('grass grows in vegetated regions and excludes cliffs, volcanic terrain, ruins and the beach', () => {
        for (const [x, z] of [[0, 0], [20, 0], [-32, 0]]) assert.ok(grassAt(7, x, z, 0));
        for (const [x, z] of [[35, 0], [0, -34], [0, 35], [56, 0]])
            for (let i = 0; i < 48; i++) assert.equal(grassAt(7, x, z, i), null);
    });
    it('grass roots match ray intersections with the rendered terrain triangles', () => {
        const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
        geometry.rotateX(-Math.PI / 2);
        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) positions.setY(i, height(positions.getX(i), positions.getZ(i)));
        const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), ground = new THREE.Mesh(geometry, material);
        ground.updateMatrixWorld();
        const ray = new THREE.Raycaster();
        for (const [x, z] of [[.5, 1], [4.3, 5.2], [10, 10], [-23.3, 12.5], [140.2, -139.4]]) {
            ray.set(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0));
            const hit = ray.intersectObject(ground)[0]; assert.ok(hit);
            assert.ok(Math.abs(hit.point.y - terrainSurfaceHeight(x, z)) < 1e-5);
        }
        geometry.dispose(); material.dispose();
    });
    it('streaming reuses buffers until the viewer changes cells and returns to the same vegetation', () => {
        const field = new GrassField(), matrix = new THREE.Matrix4();
        field.update('grass', 0, 0, [], [], 0);
        const version = field.mesh.instanceMatrix.version, count = field.mesh.count;
        field.mesh.getMatrixAt(0, matrix); const original = [...matrix.elements];
        field.update('grass', 1, 1, [], [], .1);
        assert.equal(field.mesh.instanceMatrix.version, version);
        field.update('grass', 16, 0, [], [], .2);
        assert.ok(field.mesh.instanceMatrix.version > version);
        field.update('grass', 0, 0, [], [], .3);
        field.mesh.getMatrixAt(0, matrix);
        assert.deepEqual(matrix.elements, original); assert.equal(field.mesh.count, count);
        field.update('grass', 0, 0, [], [], .3); assert.equal(field.windTime.value, .3); field.dispose();
    });
    it('new structures and active rocks clear the grass beneath their footprints', () => {
        const field = new GrassField(), matrix = new THREE.Matrix4(); field.update('grass', 0, 0, [], [], 0);
        let x = 0, z = 0;
        for (let i = 0; i < field.mesh.count; i++) {
            field.mesh.getMatrixAt(i, matrix);
            if (Math.hypot(matrix.elements[12], matrix.elements[14]) < 8) { x = matrix.elements[12]; z = matrix.elements[14]; break; }
        }
        const building: Building = { id: 'test', kind: 'workbench', x, z, yaw: 0, hp: 100, items: [], jobs: [], fuel: 0 };
        field.update('grass', 0, 0, [building], [], .1);
        for (let i = 0; i < field.mesh.count; i++) {
            field.mesh.getMatrixAt(i, matrix); assert.ok(Math.hypot(matrix.elements[12] - x, matrix.elements[14] - z) >= 1.3 - 1e-5);
        }
        const rock: NodeState = { id: 'rock', kind: 'rock', x, z, hp: 4, depleted: false, readyAt: 0 };
        field.update('grass', 0, 0, [], [rock], .5);
        for (let i = 0; i < field.mesh.count; i++) {
            field.mesh.getMatrixAt(i, matrix); assert.ok(Math.hypot(matrix.elements[12] - x, matrix.elements[14] - z) >= 1.35 - 1e-5);
        }
        field.dispose();
    });
    it('capacity remains bounded and clearing or disposal releases vegetation resources', () => {
        const field = new GrassField(20); field.update('grass', 0, 0, [], [], 0); assert.equal(field.mesh.count, 20);
        field.clear(); assert.equal(field.mesh.count, 0);
        field.update('grass', 0, 0, [], [], 0); assert.equal(field.mesh.count, 20);
        let disposed = 0; field.geometry.addEventListener('dispose', () => disposed++); field.material.addEventListener('dispose', () => disposed++);
        field.dispose(); assert.equal(disposed, 2); assert.equal(field.mesh.count, 0);
    });
});
