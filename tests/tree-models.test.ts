import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { extractTreeTemplate, treeModelGeometry, TREE_MODEL_URLS } from '../lib/game/tree-models';
import { TreeField } from '../lib/game/trees';
import { createWorld } from '../lib/game/model';
import { TREE_SIZES, type TreeSpecies, type TreeTraits } from '../lib/game/woodland';

async function template(species: TreeSpecies) {
    const data = await fs.readFile(new URL(`../public${TREE_MODEL_URLS[species]}`, import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
    try { return extractTreeTemplate(gltf.scene); }
    finally { gltf.scene.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); }
}

describe('external tree assets', () => {
    it('all four GLBs load without textures, stay within 1,500 triangles and match every saved size', async () => {
        for (const species of Object.keys(TREE_MODEL_URLS) as TreeSpecies[]) {
            const source = await template(species);
            assert.ok(source.getAttribute('position').count / 3 <= 1500);
            const mask = Array.from(source.getAttribute('foliage').array);
            assert.ok(mask.includes(0) && mask.includes(1));
            for (const size of Object.keys(TREE_SIZES) as TreeTraits['size'][]) {
                const geometry = treeModelGeometry(source, { species, size, autumn: false, variant: 0 });
                const box = geometry.boundingBox!;
                assert.ok(Math.abs(box.min.y) < 1e-5);
                assert.ok(Math.abs(box.max.y - TREE_SIZES[size].height) < 1e-5);
                assert.ok(Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z)) <= TREE_SIZES[size].crown + 1e-5);
                geometry.dispose();
            }
            source.dispose();
        }
    });
    it('autumn and world-tree colors change leaves while preserving the white birch bark', async () => {
        const source = await template('birch'), traits: TreeTraits = { species: 'birch', size: 'normal', autumn: false, variant: 0 };
        const summer = treeModelGeometry(source, traits), autumn = treeModelGeometry(source, { ...traits, autumn: true });
        const mask = source.getAttribute('foliage'), a = summer.getAttribute('color'), b = autumn.getAttribute('color');
        let leaves = 0, bark = 0;
        for (let i = 0; i < mask.count; i++) {
            const left = [a.getX(i), a.getY(i), a.getZ(i)], right = [b.getX(i), b.getY(i), b.getZ(i)];
            if (mask.getX(i)) { assert.notDeepEqual(left, right); leaves++; }
            else { assert.deepEqual(left, right); bark++; }
        }
        assert.ok(leaves > 100 && bark > 100);
        summer.dispose(); autumn.dispose(); source.dispose();
    });
    it('swaps in GLBs as instanced trees and retains correct targeting, felling and regeneration', async () => {
        const state = createWorld('models', 'tree-model-test');
        state.nodes = [{ id: 'oak-a', kind: 'tree', x: 0, z: 0, hp: 24, depleted: false, readyAt: 0, tree: { species: 'oak', size: 'normal', autumn: false, variant: 0 } }];
        const before = structuredClone(state), field = new TreeField();
        field.update(state, 0, 0, 0);
        const fallback = [...field.batches.values()][0].mesh;
        let released = 0; fallback.addEventListener('dispose', () => released++);
        await field.loadModels(template); assert.equal(released, 1);
        field.update(state, 0, 0, 0); field.root.updateMatrixWorld(true);
        const batch = [...field.batches.values()][0]; assert.ok(batch.mesh.geometry.getAttribute('position').count > fallback.geometry.getAttribute('position').count);
        const ray = new THREE.Raycaster(new THREE.Vector3(0, 1, 5), new THREE.Vector3(0, 0, -1), 0, 10);
        const hits = ray.intersectObject(field.root, true); assert.ok(hits.length); assert.equal(field.target(hits[0])!.id, 'oak-a');
        assert.deepEqual(state, before);
        state.nodes[0].depleted = true; field.update(state, 0, 0, 1);
        assert.equal([...field.batches.values()].reduce((sum, b) => sum + b.mesh.count, 0), 0);
        state.nodes[0].depleted = false; field.update(state, 0, 0, 2);
        assert.equal([...field.batches.values()].reduce((sum, b) => sum + b.mesh.count, 0), 1);
        field.dispose();
    });
    it('keeps playable fallback trees on loader failure and releases models arriving after disposal', async () => {
        const field = new TreeField(), state = createWorld('fallback', 'tree-model-test'); field.update(state, 0, 0, 0);
        const originalWarn = console.warn; console.warn = () => undefined;
        try { await field.loadModels(async () => { throw new Error('404'); }); }
        finally { console.warn = originalWarn; }
        field.update(state, 0, 0, 0); assert.ok(field.root.children.length); field.dispose();
        const closed = new TreeField(), source = await template('pine'); let released = 0;
        source.addEventListener('dispose', () => released++);
        let resolve!: (geometry: THREE.BufferGeometry) => void;
        const pending = new Promise<THREE.BufferGeometry>(r => { resolve = r; });
        const ready = closed.loadModels(() => pending); closed.dispose(); resolve(source); await ready;
        assert.equal(released, 4); assert.equal(closed.root.children.length, 0);
    });
});
