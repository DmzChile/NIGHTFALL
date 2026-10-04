import * as THREE from 'three';
import type { State } from '../model';
import { isTree,nodeDefinition,treeYaw,TREE_SIZES } from '../woodland';
import { getTerrain } from '../terrain';
import type { GraphicsQuality } from '../lighting';
import type { EnvironmentWorld } from '../world/EnvironmentWorld';
import { InstanceField,type AssetPlacement } from './InstanceField';
import type { ModelCache } from './ModelCache';
export class EnvironmentField extends InstanceField {
    private dirty=true;private key='';private unsubscribe:()=>void;
    private footingGeometry=new THREE.BoxGeometry(1,1,1);private footingMaterial=new THREE.MeshStandardMaterial({color:0x716953,roughness:1,flatShading:true});private footings:THREE.InstancedMesh|null=null;
    constructor(cache:ModelCache){super(cache,true);this.unsubscribe=cache.subscribe(()=>{this.dirty=true;});}
    sync(world:EnvironmentWorld,x:number,z:number,quality:GraphicsQuality){
        const s=world.state,key=`${s.id}/${s.seed}/${s.terrainVersion}/${Math.floor(x/6)}/${Math.floor(z/6)}/${quality}/${s.buildings.length}/${Math.floor(s.time/15)}/${s.nodes.reduce((n,node)=>n+ +node.depleted,0)}`;
        if(!this.dirty&&this.key===key)return;const placements:AssetPlacement[]=[],range=quality==='low'?32:quality==='high'?72:52;
        world.objects.forEach((o,i)=>{if(o.group==='ground'&&quality==='low'&&i%2)return;if(Math.hypot(o.x-x,o.z-z)> (o.group==='ground'?Math.min(range,o.range):o.range)||!world.visible(o))return;placements.push({...o,shadow:o.shadow&&quality!=='low',occluder:o.radius>0});});
        placements.push(...stumpPlacements(s,x,z));this.update(placements);this.updateFootings(placements);this.key=key;this.dirty=false;
    }
    private updateFootings(placements:AssetPlacement[]){
        const supported=placements.filter(p=>p.foundation);
        if(!this.footings||this.footings.instanceMatrix.count<supported.length){if(this.footings){this.root.remove(this.footings);this.footings.dispose();}this.footings=new THREE.InstancedMesh(this.footingGeometry,this.footingMaterial,Math.max(8,2**Math.ceil(Math.log2(supported.length||1))));this.footings.receiveShadow=true;this.footings.name='environment/foundations';this.root.add(this.footings);}
        const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();this.footings.count=supported.length;
        supported.forEach((p,i)=>{const f=p.foundation!;position.set(p.x,p.y-f.thickness/2,p.z);rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP,p.yaw);scale.set(f.width,f.thickness,f.depth);this.footings!.setMatrixAt(i,matrix.compose(position,rotation,scale));});
        this.footings.instanceMatrix.needsUpdate=true;this.footings.computeBoundingSphere();
    }
    override stats(){const s=super.stats(),n=this.footings?.count??0;return{instances:s.instances+n,triangles:s.triangles+n*12,draws:s.draws+ +(n>0)};}
    override clear(){this.footings?.dispose();this.footings=null;super.clear();this.dirty=true;this.key='';}
    override dispose(){this.unsubscribe();super.dispose();this.footingGeometry.dispose();this.footingMaterial.dispose();}
}
/** Harvest stumps use existing regeneration timestamps and disappear after four game minutes. */
export function stumpPlacements(s:State,x:number,z:number):AssetPlacement[]{
    const t=getTerrain(s),result:AssetPlacement[]=[];
    for(const n of s.nodes)if(isTree(n)&&n.tree&&n.depleted&&n.readyAt>0&&Math.hypot(n.x-x,n.z-z)<100){
        const age=s.time-(n.readyAt-nodeDefinition(n).regen);if(age<0||age>=240)continue;
        result.push({id:'stump/'+n.id,asset:n.tree.size==='small'?'tree_stump_small':n.tree.size==='normal'?'tree_stump_medium':'tree_stump_large',x:n.x,y:t.getHeightAt(n.x,n.z),z:n.z,yaw:treeYaw(n),scale:n.tree.size==='world'?TREE_SIZES.world.radius/TREE_SIZES.large.radius:1,shadow:false});
    }return result;
}
