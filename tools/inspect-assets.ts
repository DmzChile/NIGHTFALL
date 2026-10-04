/** CPU-side asset and prepared-instance audit. Run: node --import tsx tools/inspect-assets.ts */
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSETS,ASSET_IDS,type AssetId } from '../lib/game/assets/AssetRegistry';
import { ModelCache } from '../lib/game/assets/ModelCache';
import { EnvironmentWorld } from '../lib/game/world/EnvironmentWorld';
import { EnvironmentField } from '../lib/game/assets/EnvironmentField';
import { ResourceField } from '../lib/game/assets/ResourceField';
import { TreeField } from '../lib/game/trees';
import { createWorld } from '../lib/game/model';
import type { GraphicsQuality } from '../lib/game/lighting';

const root=path.resolve(import.meta.dirname,'..'),loader=new GLTFLoader();
async function load(id:AssetId){
    const bytes=await fs.readFile(path.join(root,'public',ASSETS.get(id)!.file));
    return (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
}
const cache=new ModelCache(load),start=performance.now();
await Promise.all(ASSET_IDS.map(id=>cache.load(id)));
const loadMs=performance.now()-start;
const assets=await Promise.all([...ASSETS.values()].map(async spec=>({...spec,bytes:(await fs.stat(path.join(root,'public',spec.file))).size})));
const rows=[];
for(const version of [3,4] as const){
    const started=performance.now(),state=createWorld('Asset audit','nightfall','normal','normal','survival',version);
    const world=new EnvironmentWorld(state),generationMs=performance.now()-started;
    const trees=new TreeField(),resources=new ResourceField(cache),environment=new EnvironmentField(cache),legacy=new TreeField();
    await trees.loadAssetModels(cache);
    const views=[{name:'spawn',x:state.player.x,z:state.player.z},
        ...(world.camps[0]?[{name:'camp',x:world.camps[0].x,z:world.camps[0].y}]:[]),
        ...(world.ruins[0]?[{name:'ruin',x:world.ruins[0].x,z:world.ruins[0].y}]:[])];
    for(const view of views)for(const quality of ['low','medium','high'] as GraphicsQuality[]){
        const t=performance.now();trees.update(state,view.x,view.z,0);resources.sync(state,view.x,view.z);environment.sync(world,view.x,view.z,quality);
        const updateMs=performance.now()-t;
        const batches=[...trees.batches.values()].filter(b=>b.mesh.count>0);
        const ts={instances:batches.reduce((n,b)=>n+b.mesh.count,0),draws:batches.length,triangles:batches.reduce((n,b)=>n+b.mesh.count*b.mesh.geometry.getAttribute('position').count/3,0)};
        const r=resources.stats(),e=environment.stats();
        legacy.update(state,view.x,view.z,0);
        rows.push({terrainVersion:version,view:view.name,x:view.x,z:view.z,quality,
            worldObjects:world.objects.length,colliders:world.colliders.length,camps:world.camps.length,ruins:world.ruins.length,
            worldAndTerrainGenerationMs:+generationMs.toFixed(2),preparedUpdateMs:+updateMs.toFixed(2),
            trees:ts,resources:r,environment:e,preparedBatches:ts.draws+r.draws+e.draws,
            preparedTriangles:ts.triangles+r.triangles+e.triangles,
            legacyProceduralTreeBatches:[...legacy.batches.values()].filter(b=>b.mesh.count>0).length});
    }
    legacy.dispose();trees.dispose();resources.dispose();environment.dispose();
}
const report={measuredAt:new Date().toISOString(),runtime:process.version,seed:'nightfall',
    measurement:'CPU preparation only; no GPU render, frustum culling or shadow passes. Loaded from local disk, not network.',
    assets:assets.length,totalTriangles:assets.reduce((n,a)=>n+a.triangles,0),
    totalGlbBytes:assets.reduce((n,a)=>n+a.bytes,0),localParseAndBakeMs:+loadMs.toFixed(2),
    modelCache:cache.stats(),rows};
await fs.mkdir(path.join(root,'docs'),{recursive:true});
await fs.writeFile(path.join(root,'docs','asset-performance.json'),JSON.stringify(report,null,2)+'\n');
const lines=['# NIGHTFALL asset inventory','',
    'All files below are genuine Blender 4.3.2 exports. Triangles count every material primitive in the GLB; runtime baking uses one shared vertex-color material (trees use a separate foliage-tint shader). No textures. Dimensions are Three.js X / Y / Z metres; pivots are bottom center.','',
    `76 models · ${report.totalTriangles.toLocaleString()} authored triangles · ${(report.totalGlbBytes/1024).toFixed(1)} KiB GLB payload · ${ASSETS.size} unique geometries.`, '',
    '| Asset | Category | Triangles | Materials | X / Y / Z (m) | GLB file |',
    '| --- | --- | ---: | ---: | --- | --- |',
    ...assets.sort((a,b)=>a.category.localeCompare(b.category)||a.id.localeCompare(b.id)).map(a=>`| ${a.id} | ${a.category} | ${a.triangles} | ${a.materials} | ${a.bounds.max.map((v,i)=>(v-a.bounds.min[i]).toFixed(2)).join(' / ')} | [GLB](../public${a.file}) |`)];
await fs.writeFile(path.join(root,'docs','asset-inventory.md'),lines.join('\n')+'\n');
cache.dispose();
console.log(JSON.stringify(report,null,2));
