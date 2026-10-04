import * as THREE from 'three';
import type { AssetId } from './AssetRegistry';
import type { ModelCache } from './ModelCache';
export type AssetPlacement={id:string;asset:AssetId;x:number;y:number;z:number;yaw:number;scale:number;shadow:boolean;occluder?:boolean;foundation?:{width:number;depth:number;thickness:number}};
type Batch={mesh:THREE.InstancedMesh;placements:AssetPlacement[];capacity:number};
export class InstanceField {
    readonly root=new THREE.Group();readonly batches=new Map<string,Batch>();
    private hits=new WeakMap<THREE.Object3D,Batch>();private matrix=new THREE.Matrix4();private position=new THREE.Vector3();private rotation=new THREE.Quaternion();private scale=new THREE.Vector3();
    constructor(readonly cache:ModelCache,private allowFallback=false) {}
    private template(id:AssetId){return this.cache.get(id)??(this.allowFallback?this.cache.fallback(id):undefined);}
    update(placements:AssetPlacement[]) {
        const groups=new Map<string,AssetPlacement[]>();
        for(const p of placements){if(!this.cache.get(p.asset))this.cache.request(p.asset);if(!this.template(p.asset))continue;const key=p.asset+'/'+p.shadow,list=groups.get(key)??[];list.push(p);groups.set(key,list);}
        for(const b of this.batches.values()){b.mesh.count=0;b.placements=[];}
        for(const [key,list]of groups){
            let batch=this.batches.get(key);const geometry=this.template(list[0].asset)!.geometry;
            if(!batch||batch.capacity<list.length){
                if(batch){this.root.remove(batch.mesh);batch.mesh.dispose();}
                const capacity=Math.max(8,2**Math.ceil(Math.log2(list.length))),mesh=new THREE.InstancedMesh(geometry,this.cache.material,capacity);
                mesh.name='assets/'+key;mesh.castShadow=list[0].shadow;mesh.receiveShadow=true;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                batch={mesh,placements:list,capacity};this.batches.set(key,batch);this.hits.set(mesh,batch);this.root.add(mesh);
            }
            batch.placements=list;batch.mesh.count=list.length;batch.mesh.geometry=geometry;batch.mesh.userData.environmentOccluder=list.some(p=>p.occluder);
            list.forEach((p,i)=>{this.position.set(p.x,p.y,p.z);this.rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP,p.yaw);this.scale.setScalar(p.scale);batch!.mesh.setMatrixAt(i,this.matrix.compose(this.position,this.rotation,this.scale));});
            batch.mesh.instanceMatrix.needsUpdate=true;batch.mesh.computeBoundingSphere();
        }
    }
    target(hit:THREE.Intersection){const p=hit.instanceId===undefined?null:this.hits.get(hit.object)?.placements[hit.instanceId];return p?{kind:'node' as const,id:p.id,distance:hit.distance}:null;}
    stats(){let instances=0,triangles=0,draws=0;for(const {mesh}of this.batches.values())if(mesh.count){draws++;instances+=mesh.count;triangles+=mesh.count*mesh.geometry.getAttribute('position').count/3;}return{instances,triangles,draws};}
    clear(){this.batches.forEach(b=>b.mesh.dispose());this.batches.clear();this.root.clear();this.hits=new WeakMap();}
    dispose(){this.clear();}
}
