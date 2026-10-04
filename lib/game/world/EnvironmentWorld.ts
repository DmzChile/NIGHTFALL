import { Vector2 } from 'three';
import type { State } from '../model';
import { getTerrain } from '../terrain';
import { isDryLand } from '../ground';
import { isTree,nodeRadius } from '../woodland';
import { ASSETS,assetHash,type AssetId } from '../assets/AssetRegistry';
import type { AssetPlacement } from '../assets/InstanceField';
export type EnvironmentObject=AssetPlacement&{radius:number;range:number;group:'ground'|'rock'|'dead'|'camp'|'ruin'};
type Circle={x:number;z:number;radius:number;object?:EnvironmentObject};
class CircleGrid {
    private cells=new Map<string,Circle[]>();
    add(c:Circle){const key=`${Math.floor(c.x/12)},${Math.floor(c.z/12)}`,list=this.cells.get(key)??[];list.push(c);this.cells.set(key,list);}
    nearby(x:number,z:number,radius:number,visit:(c:Circle)=>boolean){const cx=Math.floor(x/12),cz=Math.floor(z/12),reach=Math.ceil((radius+7)/12);for(let ix=cx-reach;ix<=cx+reach;ix++)for(let iz=cz-reach;iz<=cz+reach;iz++)for(const c of this.cells.get(`${ix},${iz}`)??[])if(visit(c))return true;return false;}
}
/** Cosmetic seed stream independent of gameplay RNG. No new persistence schema or terrain regeneration. */
export class EnvironmentWorld {
    readonly objects:EnvironmentObject[]=[];readonly colliders:Circle[]=[];readonly camps:Vector2[]=[];readonly ruins:Vector2[]=[];
    private collisions=new CircleGrid();private blockers=new CircleGrid();private value:number;private terrain;
    constructor(readonly state:State){
        this.value=assetHash(`${state.seed}/environment/1/${state.terrainVersion??2}`)||1;this.terrain=getTerrain(state);
        for(const n of state.nodes)this.blockers.add({x:n.x,z:n.z,radius:isTree(n)?nodeRadius(n)+.9:1});
        for(const b of state.buildings)if(b.kind.endsWith('_totem')||b.kind.endsWith('_altar'))this.blockers.add({x:b.x,z:b.z,radius:6});
        this.generate();
    }
    private random(){this.value=(Math.imul(this.value,1664525)+1013904223)>>>0;return this.value/4294967296;}
    private clear(x:number,z:number,radius:number){return !this.blockers.nearby(x,z,radius,c=>Math.hypot(c.x-x,c.z-z)<c.radius+radius);}
    private dry(x:number,z:number,radius=0){return this.terrain.getHeightAt(x,z)>-.4&&isDryLand(x,z,this.state,radius);}
    private add(asset:AssetId,x:number,z:number,group:EnvironmentObject['group'],scale=1,yaw=this.random()*Math.PI*2,radius=0,range=80){
        const o:EnvironmentObject={id:'environment-'+this.objects.length,asset,x,z,y:this.terrain.getHeightAt(x,z),yaw,scale,radius,range,group,shadow:group!=='ground'};
        // Rocks settle into a hillside; only constructed pieces need a level, highest-point foundation.
        if(group==='rock')o.y-=Math.min(.4,this.terrain.getFoundationAt(x,z,Math.min(radius,2.5)).relief*.25);
        if(group==='camp'||group==='ruin'){
            const b=ASSETS.get(asset)!.bounds,width=b.max[0]-b.min[0],depth=b.max[2]-b.min[2],f=this.terrain.getFoundationAt(x,z,Math.hypot(width,depth)/2);
            o.y=f.height-.02;o.foundation={width:width+.08,depth:depth+.08,thickness:Math.max(.12,f.relief+.12)};
        }
        this.objects.push(o);
        const collider=(cx:number,cz:number,r:number)=>{const c={x:cx,z:cz,radius:r,object:o};this.colliders.push(c);this.collisions.add(c);this.blockers.add(c);};
        if(asset==='ruin_arch'){
            const b=ASSETS.get(asset)!.bounds,offset=(b.max[0]-b.min[0])/2-.28;
            for(const side of [-1,1])collider(x+Math.cos(yaw)*offset*side,z-Math.sin(yaw)*offset*side,.28*scale);
        }else if(radius)collider(x,z,radius);
    }
    private prefab(cx:number,cz:number,group:'camp'|'ruin',variant:number){
        const angle=this.random()*Math.PI*2,cos=Math.cos(angle),sin=Math.sin(angle);
        const pieces:[AssetId,number,number,number,number][]=group==='camp'?[
            ['tent',0,-3.5,0,1.5],['campfire',0,1.1,0,.6],['wood_crate',-2.9,-.8,.2,.65],['barrel',3,-.5,0,.55],['sack',2.5,-2.7,0,0],['broken_cart',-4,3.2,.4,1],['broken_fence',3.5,3.5,.15,1],['torch_post',-2,-4.8,0,.2],['signpost',3.5,-4.4,-.2,.2],
        ]:variant%2?[
            ['ruin_arch',0,0,0,.3],['ruin_column',-3,3,0,.55],['ruin_column',3,3,0,.55],['ruin_wall_broken',-4,0,Math.PI/2,1],['ruin_corner',4,3,Math.PI,1.1],['ruin_floor',0,3,0,0],['ruin_wall',0,5,0,1.1],
        ]:[
            ['ruin_column',-3,-2.5,0,.55],['ruin_column',3,-2.5,0,.55],['ruin_arch',0,3.5,0,.3],['ruin_wall_broken',-4,2,Math.PI/2,1],['ruin_corner',4,1,Math.PI,1.1],['ruin_floor',0,0,0,0],['stone_floor',0,2,0,0],
        ];
        const sites=pieces.map(([asset,dx,dz,localYaw,radius])=>({asset,x:cx+cos*dx+sin*dz,z:cz-sin*dx+cos*dz,yaw:angle+localYaw,radius}));
        const heights=sites.map(p=>this.terrain.getHeightAt(p.x,p.z));
        if(Math.max(...heights)-Math.min(...heights)>1.1||sites.some(p=>this.terrain.getSlopeAt(p.x,p.z)>.3||!this.dry(p.x,p.z,p.radius)||!this.clear(p.x,p.z,p.radius+.8)))return false;
        sites.forEach(p=>this.add(p.asset,p.x,p.z,group,1,p.yaw,p.radius,group==='ruin'?230:170));(group==='camp'?this.camps:this.ruins).push(new Vector2(cx,cz));return true;
    }
    private generate(){
        for(const [index,x,z,group]of [[0,70,40,'camp'],[1,-80,-55,'camp'],[2,-155,120,'camp'],[3,170,135,'camp'],[4,0,290,'ruin'],[5,115,310,'ruin'],[6,-150,-105,'ruin']] as const){
            for(let attempt=0;attempt<80;attempt++){const px=x+(this.random()-.5)*75,pz=z+(this.random()-.5)*75;if(Math.hypot(px,pz)<50||Math.hypot(px,pz)>400)continue;
                const spot=this.terrain.findFlatArea(new Vector2(px,pz),8,.3);if(spot&&this.prefab(spot.x,spot.z,group,index))break;
            }
        }
        for(let ix=-10;ix<=10;ix++)for(let iz=-10;iz<=10;iz++){
            const x=ix*40+(this.random()-.5)*24,z=iz*40+(this.random()-.5)*24;if(Math.hypot(x,z)<55||Math.hypot(x,z)>420||this.terrain.getSlopeAt(x,z)>.72)continue;
            const type=this.terrain.getTerrainTypeAt(x,z),region=this.terrain.getRegionAt(x,z);
            if(['mountains','hills','highlands','cliffs'].includes(type)&&this.random()<.62&&this.clear(x,z,3.8)&&this.dry(x,z,2.5)){
                const asset=(['rock_large_a','rock_large_b','rock_cliff_a','rock_medium_b','rock_medium_c'] as const)[Math.floor(this.random()*5)],scale=.9+this.random()*.2,b=ASSETS.get(asset)!.bounds;
                this.add(asset,x,z,'rock',scale,undefined,Math.min(5,Math.max(b.max[0]-b.min[0],b.max[2]-b.min[2])/2*scale),200);
            }else if(['바위 언덕','화산','유적'].includes(region)&&this.random()<.48&&this.clear(x,z,1.6)&&this.dry(x,z,.5))this.add(this.random()<.5?'dead_tree_a':'dead_tree_b',x,z,'dead',.9+this.random()*.2,undefined,.28,165);
        }
        for(let ix=-48;ix<=48;ix++)for(let iz=-48;iz<=48;iz++){
            const x=ix*9+(this.random()-.5)*6,z=iz*9+(this.random()-.5)*6;if(Math.hypot(x,z)<6||Math.hypot(x,z)>425||this.terrain.getSlopeAt(x,z)>.55||!this.dry(x,z)||!this.clear(x,z,1))continue;
            const region=this.terrain.getRegionAt(x,z),type=this.terrain.getTerrainTypeAt(x,z),roll=this.random();let asset:AssetId|null=null,range=70;
            if(region==='숲'||region==='습지')asset=roll<.18?'fern_a':roll<.30?'mushroom_a':roll<.36?'mushroom_b':roll<.49?'bush_a':roll<.62?'grass_tuft_c':roll<.70?'fallen_log_small':roll<.73?'fallen_log_large':roll<.80?'fallen_log_a':roll<.91?'fallen_branch_a':'small_stones_b';
            else if(['plains','hills','valley','lowlands'].includes(type)&&!['유적','화산'].includes(region))asset=roll<.28?'grass_tuft_a':roll<.56?'grass_tuft_b':roll<.78?'grass_tuft_c':roll<.89?'bush_b':'rock_small_a';
            else if(roll<.45){asset=roll<.15?'rock_small_b':roll<.3?'small_stones_a':'small_stones_b';range=95;}
            if(asset)this.add(asset,x,z,'ground',.9+this.random()*.25,undefined,0,range);
        }
    }
    visible(o:EnvironmentObject){return !this.state.buildings.some(b=>!b.kind.endsWith('_totem')&&!b.kind.endsWith('_altar')&&Math.hypot(b.x-o.x,b.z-o.z)<o.radius+2.1);}
    collidesAt(x:number,z:number,radius=.35,fromX=x,fromZ=z,swept=false){
        if(![x,z,fromX,fromZ].every(Number.isFinite))return true;const dx=x-fromX,dz=z-fromZ,length=dx*dx+dz*dz;
        return this.collisions.nearby((x+fromX)/2,(z+fromZ)/2,radius+Math.sqrt(length)/2,c=>{
            if(c.object&&!this.visible(c.object))return false;const reach=c.radius+radius,before=Math.hypot(fromX-c.x,fromZ-c.z),after=Math.hypot(x-c.x,z-c.z);
            if(before<reach&&after>=before&&length>0)return false;if(after<reach)return true;if(!swept||!length||before<reach)return false;
            const t=Math.max(0,Math.min(1,((c.x-fromX)*dx+(c.z-fromZ)*dz)/length));return Math.hypot(fromX+t*dx-c.x,fromZ+t*dz-c.z)<reach;
        });
    }
}
