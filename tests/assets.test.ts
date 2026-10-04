import { describe,it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSETS,ASSET_IDS,type AssetId } from '../lib/game/assets/AssetRegistry';
import { ModelCache,extractAssetTemplate,disposeAssetSource } from '../lib/game/assets/ModelCache';

export async function loadAsset(id:AssetId) {
    const data=await fs.readFile(new URL('../public'+ASSETS.get(id)!.file,import.meta.url));
    assert.equal(data.toString('ascii',0,4),'glTF');
    return (await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'')).scene;
}
describe('original Blender asset pipeline',()=>{
    it('all 76 genuine GLBs parse without textures and match catalog triangles, floor pivots and Y-up bounds',async()=>{
        assert.equal(ASSETS.size,76);assert.deepEqual([...ASSETS.keys()].sort(),[...ASSET_IDS].sort());
        const shapes=new Set<string>();
        for(const spec of ASSETS.values()) {
            const source=await loadAsset(spec.id);let template;
            try {template=extractAssetTemplate(source);}finally{disposeAssetSource(source);}
            try {
                assert.equal(template.triangles,spec.triangles,spec.id);assert.ok(spec.materials>=1&&spec.materials<=4);assert.ok(template.triangles<=1500);
                const box=template.geometry.boundingBox!;assert.ok(Math.abs(box.min.y)<.00001,spec.id);
                for(let i=0;i<3;i++){assert.ok(Math.abs(box.min.getComponent(i)-spec.bounds.min[i])<.00002,spec.id);assert.ok(Math.abs(box.max.getComponent(i)-spec.bounds.max[i])<.00002,spec.id);}
                shapes.add(createHash('sha256').update(Buffer.from(template.geometry.getAttribute('position').array.buffer)).digest('hex'));
            }finally{template.geometry.dispose();}
        }
        assert.equal(shapes.size,76,'Every authored model needs distinct geometry');
    });
    it('uses size-specific tree geometry and keeps crystal emission off the base rock',async()=>{
        const cache=new ModelCache(loadAsset);
        for(const [id,h] of [['tree_small_a',3.6],['tree_medium_a',6.5],['tree_large_a',11],['tree_world_a',30]] as [AssetId,number][]){const t=await cache.load(id);assert.ok(Math.abs(t.geometry.boundingBox!.max.y-h)<.00001);const mask=Array.from(t.geometry.getAttribute('foliage').array);assert.ok(mask.includes(0)&&mask.includes(1));}
        const crystal=await cache.load('rare_crystal_node'), glow=Array.from(crystal.geometry.getAttribute('glow').array);assert.ok(glow.includes(0)&&glow.some(v=>v>0&&v<=.400001));assert.equal(cache.stats().textureBytes,0);cache.dispose();
    });
    it('deduplicates concurrent requests and limits model work to four loads',async()=>{
        let active=0,max=0,loads=0;
        const cache=new ModelCache(async id=>{loads++;max=Math.max(max,++active);await new Promise(r=>setTimeout(r,2));const scene=await loadAsset(id);active--;return scene;});
        const ids=ASSET_IDS.slice(0,8);const promises=ids.flatMap(id=>[cache.load(id),cache.load(id)]);await Promise.all(promises);
        assert.equal(loads,8);assert.ok(max<=4);assert.equal(cache.stats().loaded,8);cache.dispose();
    });
    it('releases a late model and does not start queued loaders after disposal',async()=>{
        let release!:()=>void,started=0;const pause=new Promise<void>(r=>release=r);
        const cache=new ModelCache(async id=>{started++;await pause;return loadAsset(id);});
        const pending=ASSET_IDS.slice(0,8).map(id=>cache.load(id));await Promise.resolve();cache.dispose();release();
        const results=await Promise.allSettled(pending);assert.ok(results.every(r=>r.status==='rejected'));assert.equal(started,4);assert.equal(cache.stats().loaded,0);
    });
});
