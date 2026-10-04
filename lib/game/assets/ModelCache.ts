import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ASSETS, type AssetId } from './AssetRegistry';

export type AssetTemplate={geometry:THREE.BufferGeometry;triangles:number;foliageColor:THREE.Color};
export type AssetLoader=(id:AssetId)=>Promise<THREE.Object3D>;
export function disposeAssetSource(scene:THREE.Object3D) {
    const resources=new Set<THREE.BufferGeometry|THREE.Material|THREE.Texture>();
    scene.traverse(o=>{if(!(o instanceof THREE.Mesh))return;resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]) {resources.add(m);for(const v of Object.values(m))if(v instanceof THREE.Texture)resources.add(v);}});
    resources.forEach(r=>r.dispose());
}
/** Bake authored colors into one draw primitive; bark and ore bases keep independent masks. */
export function extractAssetTemplate(scene:THREE.Object3D):AssetTemplate {
    const parts:THREE.BufferGeometry[]=[], leaf=new THREE.Color(0,0,0);let leafCount=0;
    scene.updateMatrixWorld(true);
    try {
        scene.traverse(o=>{
            if(!(o instanceof THREE.Mesh))return;
            const raw=o.geometry.clone(),g=raw.index?raw.toNonIndexed():raw;if(g!==raw)raw.dispose();parts.push(g);g.applyMatrix4(o.matrixWorld);
            const n=g.getAttribute('position').count,original=g.getAttribute('color'),colors=new Float32Array(n*3),foliage=new Float32Array(n),glow=new Float32Array(n);
            const materials=Array.isArray(o.material)?o.material:[o.material],groups=g.groups.length?g.groups:[{start:0,count:n,materialIndex:0}];
            for(const group of groups) {
                const m=materials[group.materialIndex??0] as THREE.MeshStandardMaterial;
                if(Object.values(m).some(v=>v instanceof THREE.Texture))throw new Error('External textures are not allowed in the NIGHTFALL pack');
                const color=m.color??new THREE.Color(0xffffff),leaves=/foliage/i.test(m.name);
                const emission=m.emissive?Math.min(.4,(m.emissiveIntensity??1)*Math.max(m.emissive.r,m.emissive.g,m.emissive.b)/Math.max(.00001,color.r,color.g,color.b)):0;
                for(let i=group.start;i<Math.min(n,group.start+group.count);i++) {
                    colors[i*3]=color.r*(original?.getX(i)??1);colors[i*3+1]=color.g*(original?.getY(i)??1);colors[i*3+2]=color.b*(original?.getZ(i)??1);
                    foliage[i]=+leaves;glow[i]=emission;if(leaves){leaf.add(color);leafCount++;}
                }
            }
            for(const name of Object.keys(g.attributes))if(!['position','normal'].includes(name))g.deleteAttribute(name);
            if(!g.getAttribute('normal'))g.computeVertexNormals();
            g.setAttribute('color',new THREE.BufferAttribute(colors,3));g.setAttribute('foliage',new THREE.BufferAttribute(foliage,1));g.setAttribute('glow',new THREE.BufferAttribute(glow,1));
        });
        const geometry=mergeGeometries(parts);if(!geometry)throw new Error('Empty or incompatible asset');
        const triangles=geometry.getAttribute('position').count/3;
        if(!Number.isInteger(triangles)||triangles<1||triangles>5000){geometry.dispose();throw new Error('Invalid triangle budget');}
        for(const attribute of Object.values(geometry.attributes))for(const value of attribute.array)if(!Number.isFinite(value)){geometry.dispose();throw new Error('Non-finite asset vertex');}
        geometry.computeBoundingBox();geometry.computeBoundingSphere();
        if(geometry.boundingBox!.min.y<-.02){geometry.dispose();throw new Error('Asset pivot must be on the floor');}
        return {geometry,triangles,foliageColor:leafCount?leaf.multiplyScalar(1/leafCount):new THREE.Color(1,1,1)};
    } finally {parts.forEach(g=>g.dispose());}
}
export function assetMaterial(leafTint=false) {
    const m=new THREE.MeshStandardMaterial({vertexColors:true,flatShading:true,roughness:.95,emissive:0xffffff,emissiveIntensity:1});
    m.onBeforeCompile=shader=>{
        shader.vertexShader='attribute float glow; varying float vAssetGlow;\n'+(leafTint?'attribute float foliage;\n':'')+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <color_vertex>','#include <color_vertex>\nvAssetGlow=glow;\n'+(leafTint?'#ifdef USE_INSTANCING_COLOR\nvColor.xyz=color.xyz*mix(vec3(1.0),instanceColor,foliage);\n#endif\n':''));
        shader.fragmentShader='varying float vAssetGlow;\n'+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance*=vAssetGlow*vColor.xyz;');
    };
    m.customProgramCacheKey=()=>`nightfall-assets-v1/${leafTint}`;return m;
}
/** One parse per ID, including in-flight work; bounded startup downloads, borrowed geometry ownership. */
export class ModelCache {
    readonly material=assetMaterial();readonly templates=new Map<AssetId,AssetTemplate>();readonly errors=new Map<AssetId,string>();
    private pending=new Map<AssetId,Promise<AssetTemplate>>();private listeners=new Set<()=>void>();private active=0;private queue:(()=>void)[]=[];private disposed=false;
    constructor(private loader:AssetLoader=async id=>(await new GLTFLoader().loadAsync(ASSETS.get(id)!.file)).scene) {}
    get(id:AssetId){return this.templates.get(id);}
    subscribe(f:()=>void){this.listeners.add(f);return()=>this.listeners.delete(f);}
    request(id:AssetId){if(!this.disposed&&ASSETS.has(id)&&!this.errors.has(id))void this.load(id).catch(()=>{});}
    load(id:AssetId):Promise<AssetTemplate> {
        if(this.disposed)return Promise.reject(new Error('Cache disposed'));
        const ready=this.get(id);if(ready)return Promise.resolve(ready);const pending=this.pending.get(id);if(pending)return pending;
        if(!ASSETS.has(id))return Promise.reject(new Error('Unknown asset '+id));
        const promise=(async()=>{
            await new Promise<void>(resolve=>{if(this.active<4){this.active++;resolve();}else this.queue.push(resolve);});
            try {
                if(this.disposed)throw new Error('Cache disposed');
                const source=await this.loader(id);let template:AssetTemplate;
                try{template=extractAssetTemplate(source);}finally{disposeAssetSource(source);}
                if(this.disposed){template.geometry.dispose();throw new Error('Cache disposed');}
                this.templates.set(id,template);this.listeners.forEach(f=>f());return template;
            } catch(e) {this.errors.set(id,e instanceof Error?e.message:String(e));if(!this.disposed){console.warn('에셋 로딩 실패 · 기존 외형 유지:',id,e);this.listeners.forEach(f=>f());}throw e;}
            finally{const next=this.queue.shift();if(next)next();else this.active--;}
        })();
        this.pending.set(id,promise);return promise;
    }
    stats(){let geometryBytes=0;for(const t of this.templates.values())for(const a of Object.values(t.geometry.attributes))geometryBytes+=a.array.byteLength;return{loaded:this.templates.size,failed:this.errors.size,geometryBytes,textureBytes:0};}
    dispose(){this.disposed=true;this.listeners.clear();this.templates.forEach(t=>t.geometry.dispose());this.templates.clear();this.material.dispose();}
}
