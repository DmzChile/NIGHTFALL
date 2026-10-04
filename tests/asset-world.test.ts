import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as THREE from 'three';
import {createWorld,give,count,height,type State} from '../lib/game/model';
import {Engine} from '../lib/game/engine';
import {SaveManager,pack,unpack} from '../lib/game/storage';
import {isTree,nodeDefinition} from '../lib/game/woodland';
import {getTerrain} from '../lib/game/terrain';
import {EnvironmentWorld} from '../lib/game/world/EnvironmentWorld';
import {EnvironmentField,stumpPlacements} from '../lib/game/assets/EnvironmentField';
import {ResourceField} from '../lib/game/assets/ResourceField';
import {ModelCache} from '../lib/game/assets/ModelCache';
import {ASSET_IDS} from '../lib/game/assets/AssetRegistry';
import {TreeField} from '../lib/game/trees';
import {loadAsset} from './assets.test';
function engineFixture(){const s=createWorld('asset integration','nightfall','normal','normal','creative');s.nodes=[];s.enemies=[];s.buildings=[];s.time=10;
    const storage=new SaveManager();storage.save=async()=>Date.now();return{s,engine:new Engine(s,storage)};}
describe('asset and existing gameplay integration',()=>{
    it('seeded scenery does not mutate world state/RNG and reconstructs around depleted resources',()=>{
        for(const version of [2,3,4] as const){const s=createWorld('scenery','nightfall');s.terrainVersion=version;const before=structuredClone(s),a=new EnvironmentWorld(s),b=new EnvironmentWorld(s);
            assert.deepEqual(s,before);assert.deepEqual(a.objects,b.objects);assert.ok(a.camps.length>0&&a.ruins.length>0);assert.ok(a.objects.some(o=>o.group==='ground')&&a.objects.some(o=>o.group==='rock'));
            s.nodes[40].depleted=true;assert.deepEqual(new EnvironmentWorld(s).objects,a.objects);const t=getTerrain(s);
            for(const o of a.objects){assert.ok(Number.isFinite(o.y));assert.ok(Math.hypot(o.x,o.z)>6);if(o.group==='camp'||o.group==='ruin'){assert.ok(o.foundation);assert.ok(t.getSlopeAt(o.x,o.z)<=.3);}if(o.group==='rock'||o.group==='dead')assert.ok(o.y<=t.getHeightAt(o.x,o.z)+.00001,'natural props should not use a raised construction foundation');}
        }
    });
    it('batches 300 repeated trees by authored shape, preserves autumn leaf tints and tree entity ray targets',async()=>{
        const s=createWorld('trees','nightfall');s.nodes=Array.from({length:300},(_,i)=>({id:'tree-'+i,kind:'tree',x:(i%20)*3-30,z:Math.floor(i/20)*3-20,hp:24,depleted:false,readyAt:0,tree:{size:'normal' as const,species:'oak' as const,variant:0 as const,autumn:!!(i%2)}}));
        const before=structuredClone(s),cache=new ModelCache(loadAsset),field=new TreeField();await field.loadAssetModels(cache);field.update(s,0,0,0);field.root.updateMatrixWorld(true);
        const batches=[...field.batches.values()].filter(b=>b.mesh.count);assert.equal(batches.length,1);assert.equal(batches[0].mesh.count,300);assert.deepEqual(s,before);
        const a=new THREE.Color(),b=new THREE.Color();batches[0].mesh.getColorAt(0,a);batches[0].mesh.getColorAt(1,b);assert.notDeepEqual(a,b);
        const node=s.nodes[0],ray=new THREE.Raycaster(new THREE.Vector3(node.x,height(node.x,node.z,s)+.8,node.z+2),new THREE.Vector3(0,0,-1),0,5),hits=ray.intersectObject(field.root,true);
        assert.ok(hits.some(h=>field.target(h)?.id===node.id));node.depleted=true;field.update(s,0,0,1);assert.equal([...field.batches.values()].reduce((n,b)=>n+b.mesh.count,0),299);
        node.depleted=false;field.update(s,0,0,2);assert.equal([...field.batches.values()].reduce((n,b)=>n+b.mesh.count,0),300);field.dispose();cache.dispose();
    });
    it('resource instances point to existing IDs; mining, drops, inventory and regeneration survive saving',async()=>{
        const {s,engine}=engineFixture();const node={id:'ore-test',kind:'iron',x:0,z:0,hp:20,depleted:false,readyAt:0};s.nodes=[node];
        const cache=new ModelCache(loadAsset),field=new ResourceField(cache);await cache.load('iron_node');field.sync(s,0,0);field.root.updateMatrixWorld(true);
        const ray=new THREE.Raycaster(new THREE.Vector3(0,height(0,0,s)+.7,3),new THREE.Vector3(0,0,-1),0,8),hit=ray.intersectObject(field.root,true)[0];assert.ok(hit);assert.equal(field.target(hit)!.id,node.id);
        engine.target=field.target(hit);engine.gather();assert.equal(node.depleted,true);assert.ok(count(s.player.items,'iron_ore')>0);field.sync(s,0,0);assert.equal(field.stats().instances,0);
        const restored=await unpack(await pack(s));assert.equal(restored.nodes[0].depleted,true);assert.equal(restored.nodes[0].readyAt,node.readyAt);assert.deepEqual(restored.player.items,s.player.items);
        node.depleted=false;node.hp=nodeDefinition(node).hp;field.sync(s,0,0);assert.equal(field.stats().instances,1);field.dispose();cache.dispose();engine.dispose();
    });
    it('fallback scenery stays visible, arches have an open center, swept movement cannot tunnel and old overlaps can escape',()=>{
        const s=createWorld('collision','nightfall'),world=new EnvironmentWorld(s),cache=new ModelCache(async()=>{throw Error('offline');}),field=new EnvironmentField(cache);
        const arch=world.objects.find(o=>o.asset==='ruin_arch')!;assert.ok(arch);assert.equal(world.collidesAt(arch.x,arch.z,.1),false);
        const pillar=world.colliders.find(c=>c.object===arch)!;assert.equal(world.collidesAt(pillar.x,pillar.z,.1),true);
        const rock=world.colliders.find(c=>c.object?.group==='rock')!;assert.ok(rock);assert.equal(world.collidesAt(rock.x+rock.radius+2,rock.z,.35,rock.x-rock.radius-2,rock.z,true),true);
        assert.equal(world.collidesAt(rock.x+rock.radius+2,rock.z,.35,rock.x,rock.z),false);
        // A cache with unresolved requests exercises visible primitive loading geometry without 404 warnings.
        const loading=new ModelCache(()=>new Promise(()=>{})),visible=new EnvironmentField(loading);visible.sync(world,arch.x,arch.z,'high');assert.ok(visible.stats().instances>0);assert.ok(visible.root.children.length>0);
        s.buildings.push({id:'old-build',kind:'wall',x:rock.x,z:rock.z,yaw:0,hp:200,items:[],jobs:[],fuel:0});assert.equal(world.visible(rock.object!),false);assert.equal(world.collidesAt(rock.x,rock.z,.1),false);
        visible.dispose();loading.dispose();field.dispose();cache.dispose();
    });
    it('derives stump lifetime from existing timestamps and lowers nearby decoration at low graphics quality',async()=>{
        const s=createWorld('stumps','nightfall'),node=s.nodes.find(isTree)!;node.x=0;node.z=0;node.depleted=true;node.readyAt=s.time+nodeDefinition(node).regen;
        const before=structuredClone(s);assert.equal(stumpPlacements(s,0,0).length,1);s.time+=240;assert.equal(stumpPlacements(s,0,0).length,0);s.time=before.time;
        const cache=new ModelCache(loadAsset);await Promise.all(ASSET_IDS.map(id=>cache.load(id)));const world=new EnvironmentWorld(s),field=new EnvironmentField(cache);
        field.sync(world,0,0,'low');const low=field.stats();field.sync(world,0,0,'high');const high=field.stats();assert.ok(high.instances>low.instances);assert.deepEqual(s,before);
        field.dispose();cache.dispose();
    });
    it('keeps structures/jobs, inventory/hotbar and debug display independent from save schema; new bodies block walking',async()=>{
        const {s,engine}=engineFixture();give(s.player.items,'wood',12);s.player.hotbar[0]=s.player.items[0].uid;
        s.buildings.push({id:'station',kind:'workbench',x:0,z:-1,yaw:0,hp:200,items:[],jobs:[],fuel:0});Object.assign(s.player,{x:0,z:1,yaw:0});
        engine.keys.add('KeyW');engine.resume();for(let i=0;i<20;i++)engine.step(1/30);assert.ok(s.player.z>0);
        const before=structuredClone(s),result=await engine.command('/debug-assets');assert.equal(result.ok,true);assert.match(result.lines[0],/76/);assert.deepEqual(s,before);
        const restored=await unpack(await pack(s));assert.deepEqual(restored.buildings,s.buildings);assert.deepEqual(restored.player.hotbar,s.player.hotbar);assert.deepEqual(restored.player.items,s.player.items);
        assert.equal(Object.hasOwn(restored,'environment'),false);engine.dispose();
    });
});
