import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ASSETS,type AssetId } from './AssetRegistry';
import { ModelCache } from './ModelCache';
/** Separate debug page; no saved world, gameplay RNG or engine is created. */
export class AssetGallery {
    readonly cache=new ModelCache();
    private renderer:THREE.WebGLRenderer;private scene=new THREE.Scene();private root=new THREE.Group();private camera=new THREE.PerspectiveCamera(45,1,.05,300);
    private controls:OrbitControls;private resize:ResizeObserver;private frame=0;private ids:AssetId[]=[];private unsubscribe:()=>void;
    private groundGeometry=new THREE.PlaneGeometry(100,100);private groundMaterial=new THREE.MeshStandardMaterial({color:0x26312b,roughness:1});
    private grid=new THREE.GridHelper(100,50,0x53664e,0x354137);private sun=new THREE.DirectionalLight(0xffe2b4,3.2);
    constructor(host:HTMLElement,private onStats:(stats:ReturnType<ModelCache['stats']>)=>void){
        this.renderer=new THREE.WebGLRenderer({antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
        this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.25;
        this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.shadowMap.autoUpdate=false;
        host.appendChild(this.renderer.domElement);this.renderer.domElement.setAttribute('aria-label','드래그 회전과 스크롤 확대를 지원하는 3D 모델 미리보기');
        this.scene.background=new THREE.Color(0x17221e);this.scene.add(this.root,new THREE.HemisphereLight(0xe2ecdf,0x4f5042,2));
        this.sun.position.set(-18,35,20);this.sun.castShadow=true;this.sun.shadow.mapSize.set(1024,1024);
        Object.assign(this.sun.shadow.camera,{left:-40,right:40,top:40,bottom:-40,near:1,far:90});this.sun.shadow.normalBias=.05;this.scene.add(this.sun,this.sun.target);
        const ground=new THREE.Mesh(this.groundGeometry,this.groundMaterial);ground.rotation.x=-Math.PI/2;ground.position.y=-.015;ground.receiveShadow=true;this.grid.position.y=-.01;this.scene.add(ground,this.grid);
        this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.maxPolarAngle=Math.PI/2-.04;this.controls.minDistance=2;this.controls.maxDistance=130;
        this.unsubscribe=this.cache.subscribe(()=>this.rebuild());
        const size=()=>{const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);};
        this.resize=new ResizeObserver(size);this.resize.observe(host);size();
        const animate=()=>{this.frame=requestAnimationFrame(animate);this.controls.update();this.renderer.render(this.scene,this.camera);};animate();
    }
    show(ids:AssetId[]){this.ids=ids;const rows=Math.ceil(ids.length/8),center=ids.length>1?(rows-1)*3.2:0;
        this.controls.target.set(0,ids.length>1?0:1.5,center);this.camera.position.set(ids.length>1?24:6,ids.length>1?34:4.5,center+(ids.length>1?40:8));
        this.controls.update();this.rebuild();ids.forEach(id=>this.cache.request(id));
    }
    private rebuild(){this.root.clear();this.ids.forEach((id,i)=>{const t=this.cache.get(id);if(!t)return;const b=ASSETS.get(id)!.bounds,span=Math.max(...b.max.map((v,a)=>v-b.min[a]));
        const mesh=new THREE.Mesh(t.geometry,this.cache.material);mesh.name=id;mesh.scale.setScalar((this.ids.length>1?4:5)/Math.max(.01,span));
        mesh.position.set(this.ids.length>1?(i%8-3.5)*6.4:0,0,this.ids.length>1?Math.floor(i/8)*6.4:0);mesh.castShadow=this.ids.length===1;mesh.receiveShadow=true;this.root.add(mesh);
    });this.renderer.shadowMap.needsUpdate=true;this.onStats(this.cache.stats());}
    dispose(){cancelAnimationFrame(this.frame);this.resize.disconnect();this.unsubscribe();this.controls.dispose();this.root.clear();this.cache.dispose();
        this.groundGeometry.dispose();this.groundMaterial.dispose();this.grid.geometry.dispose();(this.grid.material as THREE.Material).dispose();this.sun.shadow.dispose();this.renderer.dispose();this.renderer.domElement.remove();}
}
