"use client";
import { useEffect,useMemo,useRef,useState } from 'react';
import { ASSETS,type AssetId } from '@/lib/game/assets/AssetRegistry';
import type { AssetGallery } from '@/lib/game/assets/AssetGallery';
import './gallery.css';
const names:Record<string,string>={trees:'나무',rocks:'바위',ores:'광물',ground:'지면 장식',crafting:'제작 시설',props:'생존 소품',ruins:'폐허',building:'건축 모듈'};
export default function AssetGalleryPage(){
    const host=useRef<HTMLDivElement>(null),viewer=useRef<AssetGallery|null>(null);
    const [selected,setSelected]=useState<AssetId>('tree_medium_a'),[category,setCategory]=useState('all'),[all,setAll]=useState(false),[error,setError]=useState('');
    const [stats,setStats]=useState({loaded:0,failed:0,geometryBytes:0,textureBytes:0});
    const assets=useMemo(()=>[...ASSETS.values()],[]),categories=useMemo(()=>[...new Set(assets.map(a=>a.category))],[assets]);
    const filtered=useMemo(()=>assets.filter(a=>category==='all'||a.category===category),[assets,category]);
    const ids=useMemo(()=>all?filtered.map(a=>a.id):[selected],[filtered,selected,all]);const selection=useRef(ids);selection.current=ids;
    useEffect(()=>{let disposed=false;
        import('@/lib/game/assets/AssetGallery').then(({AssetGallery})=>{if(disposed||!host.current)return;try{viewer.current=new AssetGallery(host.current,setStats);viewer.current.show(selection.current);}catch(e){setError(e instanceof Error?e.message:String(e));}}).catch(e=>{if(!disposed)setError(String(e));});
        return()=>{disposed=true;viewer.current?.dispose();viewer.current=null;};
    },[]);
    useEffect(()=>{viewer.current?.show(ids);},[ids]);const a=ASSETS.get(selected);
    return <main className="asset-gallery-page">
        <header><a href="/" className="gallery-back">← 게임으로</a><span className="gallery-eyebrow">NIGHTFALL / ORIGINAL ASSET PACK</span><h1>섬을 이루는 것들</h1><p>크기별 나무부터 오래된 관문까지. 오리지널 low-poly 모델을 한곳에서 확인하세요.</p></header>
        <div className="gallery-summary"><span><strong>{assets.length}</strong> GLB 모델</span><span><strong>{assets.reduce((n,a)=>n+a.triangles,0).toLocaleString()}</strong> 총 삼각형</span><span><strong>2m</strong> 건축 기준 격자</span><span><strong>0</strong> 텍스처</span></div>
        <section className="gallery-viewer" aria-label="모델 미리보기"><div className="gallery-toolbar"><button aria-pressed={!all} onClick={()=>setAll(false)}>선택 모델</button><button aria-pressed={all} onClick={()=>setAll(true)}>전체 배치</button><span>드래그 회전 · 스크롤 확대</span></div>
            <div ref={host} className="gallery-canvas" />
            {error&&<div className="gallery-error" role="status"><strong>이 환경에서는 WebGL 미리보기를 실행할 수 없습니다.</strong><p>{error}</p><a href="/models/nightfall/gallery.jpg">Blender로 렌더한 전체 에셋 보기</a><span>아래 목록에서 GLB와 실제 모델 정보를 확인할 수 있습니다.</span></div>}
            <div className="gallery-caption"><strong>{all?`${filtered.length}개 모델 · 비교를 위해 최대 길이를 4m로 정규화`:selected+' · 미리보기 크기 정규화'}</strong><span>로드 {stats.loaded}/{assets.length} · 실패 {stats.failed} · geometry {(stats.geometryBytes/1048576).toFixed(2)} MiB</span></div>
        </section>
        {a&&!all&&<section className="gallery-detail"><span>{a.id}</span><span>{a.triangles} triangles</span><span>{a.materials} authored materials → 1 runtime material</span><span>실제 크기 {a.bounds.max.map((v,i)=>(v-a.bounds.min[i]).toFixed(2)).join(' × ')} m (X/Y/Z)</span><a href={a.file} download>GLB 다운로드</a></section>}
        <nav className="gallery-filters" aria-label="에셋 종류"><button aria-pressed={category==='all'} onClick={()=>setCategory('all')}>전체 {assets.length}</button>{categories.map(c=><button key={c} aria-pressed={category===c} onClick={()=>setCategory(c)}>{names[c]??c} {assets.filter(a=>a.category===c).length}</button>)}</nav>
        <div className="gallery-table-wrap"><table><thead><tr><th>모델</th><th>종류</th><th>삼각형</th><th>재질</th><th>높이 (m)</th><th>GLB</th></tr></thead><tbody>{filtered.map(a=><tr key={a.id} className={a.id===selected?'selected':''}><td><button onClick={()=>{setSelected(a.id);setAll(false);}}>{a.id}</button></td><td>{names[a.category]??a.category}</td><td>{a.triangles}</td><td>{a.materials}</td><td>{(a.bounds.max[1]-a.bounds.min[1]).toFixed(2)}</td><td><a href={a.file} download aria-label={`${a.id} GLB 다운로드`}>↓</a></td></tr>)}</tbody></table></div>
        <footer><a href="/models/nightfall/gallery.jpg">Blender 전체 렌더 이미지</a> · 갤러리는 저장된 월드를 변경하지 않습니다.</footer>
    </main>;
}
