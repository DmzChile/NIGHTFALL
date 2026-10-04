import type { State,NodeState } from '../model';
import { isTree } from '../woodland';
import { getTerrain } from '../terrain';
import { assetHash,resourceAsset } from './AssetRegistry';
import { InstanceField,type AssetPlacement } from './InstanceField';
import type { ModelCache } from './ModelCache';
/** Entity identity/HP/drop tables stay in State; only their visible mesh is batched. */
export class ResourceField extends InstanceField {
    private dirty=true;private key='';private unsubscribe:()=>void;
    constructor(cache:ModelCache){super(cache);this.unsubscribe=cache.subscribe(()=>{this.dirty=true;});}
    handles(n:NodeState){const id=resourceAsset(n);return !!id&&!!this.cache.get(id);}
    sync(s:State,x:number,z:number){
        const alive=s.nodes.reduce((h,n,i)=>!n.depleted?Math.imul(h^(i+1),16777619):h,2166136261);
        const key=`${s.id}/${s.seed}/${s.terrainVersion}/${Math.floor(x/6)}/${Math.floor(z/6)}/${s.nodes.length}/${alive}`;
        if(!this.dirty&&this.key===key)return;const t=getTerrain(s),placements:AssetPlacement[]=[];
        for(const n of s.nodes){if(n.depleted||isTree(n)||Math.hypot(n.x-x,n.z-z)>140)continue;const asset=resourceAsset(n);if(!asset)continue;
            this.cache.request(asset);const hash=assetHash(n.id);
            placements.push({id:n.id,asset,x:n.x,y:t.getHeightAt(n.x,n.z),z:n.z,yaw:(hash%10000)/10000*Math.PI*2,scale:n.kind==='rock'?.88+(hash%13)*.01:1,shadow:!['fiber','herb','antidote','mushroom','toxic','pebble','branch'].includes(n.kind)});
        }
        this.update(placements);this.key=key;this.dirty=false;
    }
    override clear(){super.clear();this.key='';this.dirty=true;}
    override dispose(){this.unsubscribe();super.dispose();}
}
