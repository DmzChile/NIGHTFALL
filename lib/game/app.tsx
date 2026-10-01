"use client";
import { recipeUnlocked, missingDiscoveries } from './progression';
import { regionWarning } from './regions';
import { detectionRadius } from './awareness';
import { isTree, nodeDefinition } from './woodland';
import { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { GameScene } from './scene';
import { Engine } from './engine';
import { SaveManager, importFile, type WorldInfo } from './storage';
import { createWorld, selected, count, capacity, stationFor, type State, type Stack } from './model';
import { ITEMS, MONSTERS, RECIPES, phase, day } from './data';
function Choice({ value, set, values }: {
    value: string;
    set: (s: string) => void;
    values: [
        string,
        string
    ][];
}) {
    return <Select value={value} onValueChange={set}><SelectTrigger className="w-full min-h-11 mb-4"><SelectValue /></SelectTrigger><SelectContent>{values.map(([v, n]) => <SelectItem value={v} key={v}>{n}</SelectItem>)}</SelectContent></Select>;
}
function App() {
    const canvas = useRef<HTMLDivElement>(null), scene = useRef<GameScene | null>(null), storage = useRef<SaveManager | null>(null), engine = useRef<Engine | null>(null), file = useRef<HTMLInputElement>(null);
    const [, refresh] = useState(0), [activeEngine, setActiveEngine] = useState<Engine | null>(null), [now, setNow] = useState(() => Date.now()), [flash, setFlash] = useState(0), [menu, setMenu] = useState('home'), [worlds, setWorlds] = useState<WorldInfo[]>([]), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [name, setName] = useState('첫 번째 섬'), [seed, setSeed] = useState(''), [difficulty, setDifficulty] = useState('normal'), [mode, setMode] = useState('normal'), [deleteId, setDeleteId] = useState<string | null>(null), [recovery, setRecovery] = useState<State | null>(null), [inspected, setInspected] = useState<string | null>(null), [tab, setTab] = useState('items');
    const rerender = useCallback(() => {
        refresh(v => v + 1);
        setFlash(scene.current?.flash || 0);
    }, []);
    const list = useCallback(async () => {
        try {
            const w = await storage.current!.list();
            setWorlds(w);
        }
        catch (e) {
            setErr(message(e));
        }
    }, []);
    useEffect(() => {
        let mounted = true;
        const saves = new SaveManager();
        storage.current = saves;
        try {
            scene.current = new GameScene(canvas.current!, () => engine.current?.pause());
            void list();
        }
        catch (e) {
            queueMicrotask(() => {
                if (mounted)
                    setErr('3D 화면을 시작할 수 없습니다. WebGL2를 지원하는 PC 브라우저에서 열어 주세요. ' + message(e));
            });
        }
        return () => {
            mounted = false;
            engine.current?.dispose();
            scene.current?.dispose();
            saves.close();
        };
    }, [list]);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    function attach(s: State) {
        const e = new Engine(s, storage.current!);
        e.onChange = rerender;
        engine.current?.dispose();
        engine.current = e;
        setActiveEngine(e);
        scene.current?.setEngine(e);
        setMenu('play');
        setErr('');
        setRecovery(null);
        rerender();
    }
    async function start() {
        if (!scene.current) {
            setErr('3D 화면을 사용할 수 없습니다.');
            return;
        }
        if (worlds.length >= 5) {
            setErr('월드는 최대 5개입니다. 기존 월드를 관리하세요.');
            return;
        }
        setBusy(true);
        setErr('');
        try {
            const s = createWorld(name, seed, difficulty as State['difficulty'], mode as State['mode']);
            await storage.current!.acquire(s.id);
            await storage.current!.save(s);
            attach(s);
            engine.current!.notify('떨어진 가지와 작은 돌을 E로 모아 제작대를 만드세요.');
        }
        catch (e) {
            setErr(message(e));
            await storage.current!.release();
        }
        finally {
            setBusy(false);
        }
    }
    async function load(id: string) {
        setBusy(true);
        setErr('');
        try {
            const r = await storage.current!.load(id);
            if (r.recovered) {
                setRecovery(r.state);
            }
            else
                attach(r.state);
        }
        catch (e) {
            setErr(message(e));
            await storage.current!.release();
        }
        finally {
            setBusy(false);
        }
    }
    async function importSave(f: File) {
        setBusy(true);
        setErr('');
        try {
            if (worlds.length >= 5)
                throw new Error('기존 월드를 정리한 뒤 가져오세요.');
            const s = await importFile(f);
            await storage.current!.acquire(s.id);
            await storage.current!.save(s);
            await storage.current!.release();
            await list();
            setMenu('worlds');
        }
        catch (e) {
            setErr(message(e));
            await storage.current!.release();
        }
        finally {
            setBusy(false);
            if (file.current)
                file.current.value = '';
        }
    }
    async function quit() {
        const e = engine.current;
        if (!e)
            return;
        e.pause();
        setBusy(true);
        await e.save();
        if (e.error) {
            setBusy(false);
            return;
        }
        e.dispose();
        await storage.current!.release();
        engine.current = null;
        setActiveEngine(null);
        scene.current!.setEngine(null);
        setMenu('home');
        await list();
        setBusy(false);
    }
    useEffect(() => {
        const context = (document as Document & {
            modelContext?: {
                registerTool: (t: unknown, o: unknown) => unknown;
            };
        }).modelContext;
        if (!context?.registerTool)
            return;
        const life = new AbortController();
        for (const tool of [{ name: 'read_survival_status', description: '현재 생존일, 상태, 소지품과 저장 상태를 읽습니다.', annotations: { readOnlyHint: true }, execute: () => {
                    const e = engine.current;
                    if (!e)
                        return { status: 'menu' };
                    return { day: day(e.state.time), phase: phase(e.state.time), health: Math.round(e.state.player.hp), inventory: e.state.player.items.map(i => ({ item: ITEMS[i.id].name, quantity: i.qty })), save: e.saveLabel };
                } }, { name: 'save_current_world', description: '현재 실행 중인 월드를 브라우저에 저장합니다.', annotations: { readOnlyHint: false }, execute: async (input: unknown) => {
                    if (input && typeof input === 'object' && Object.keys(input).length)
                        throw new Error('추가 입력을 받지 않습니다.');
                    if (!engine.current)
                        throw new Error('실행 중인 월드가 없습니다.');
                    await engine.current.save();
                    if (engine.current.error)
                        throw new Error(engine.current.error);
                    return { status: 'saved', generation: engine.current.state.generation };
                } }]) {
            try {
                void Promise.resolve(context.registerTool({ ...tool, title: tool.name === 'save_current_world' ? '월드 저장' : '생존 상태', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }, { signal: life.signal })).catch(() => {
                });
            }
            catch {
            }
        }
        return () => life.abort();
    }, []);
    const e = activeEngine, s = e?.state, p = s?.player, it = s ? selected(s) : undefined;
    const target = e?.target;
    let targetName = '', targetHelp = '';
    if (s && target) {
        if (target.kind === 'node') {
            const n = s.nodes.find(n => n.id === target.id);
            if (n) {
                const def = nodeDefinition(n);
                targetName = def.name;
                targetHelp = `${target.distance <= 3.8 ? 'E / 좌클릭 · 채집' : '가까이 이동'}${def.level ? ' · 도구 단계 ' + def.level : ''}${isTree(n) ? ` · 내구도 ${Math.ceil(n.hp)} / ${def.hp}` : ''}`;
            }
        }
        if (target.kind === 'enemy') {
            const n = s.enemies.find(n => n.id === target.id);
            if (n) {
                targetName = `${MONSTERS[n.kind].name}${n.animal || MONSTERS[n.kind].boss ? '' : ' · Tier ' + n.tier}`;
                targetHelp = `체력 ${Math.ceil(n.hp)} / ${n.maxhp}${n.region ? ' · 지역 적' : ''}${n.animal ? '' : ` · ${n.alerted ? '추적 중' : '미발견'} · 식별 ${detectionRadius(n)}m`}${(n.poison || 0) > 0 ? ' · 독' : ''}${(n.burn || 0) > 0 ? ' · 화상' : ''}`;
            }
        }
        if (target.kind === 'building') {
            const b = s.buildings.find(b => b.id === target.id);
            if (b) {
                targetName = ITEMS[b.kind]?.name || ({ heal_totem: '치유 토템', challenge_totem: '도전 토템', forest_altar: '숲의 제단', rock_altar: '암석 제단', ruin_altar: '유적의 제단', final_altar: '최종 제단' } as Record<string, string>)[b.kind];
                targetHelp = target.distance <= 3.5 ? 'E · 상호작용' : '가까이 이동';
            }
        }
        if (target.kind === 'drop') {
            const d = s.drops.find(d => d.id === target.id);
            targetName = d?.bag ? '사망 가방 / 잔해' : '전리품';
            targetHelp = target.distance <= 3.5 ? 'E · 회수' : '가까이 이동';
        }
    }
    const b = s?.buildings.find(b => b.id === e?.facility);
    const chosen = p?.items.find(i => i.uid === inspected);
    function stackGrid(items: Stack[], onClick: (i: Stack) => void) {
        return <div className="grid-inventory">{items.map(i => <button key={i.uid} className="invitem" onClick={() => onClick(i)} aria-label={`${ITEMS[i.id].name} ${i.qty}개`}><span className="itemicon">{ITEMS[i.id].icon}</span><span className="count">{i.qty}</span><span className="name">{ITEMS[i.id].name}</span>{i.dur !== undefined && <small>내구도 {Math.floor(i.dur)} / {ITEMS[i.id].durability}</small>}{i.charge !== undefined && <small> 충전 {i.charge}</small>}</button>)}{!items.length && <p className="muted">비어 있습니다.</p>}</div>;
    }
    function recipes() {
        if (!s)
            return null;
        const available = RECIPES.filter(r => r.station === 'hand' || !!stationFor(s, r.station, e?.panel === 'facility' ? e.facility || undefined : undefined));
        return <><p className="help-line">근처 제작 시설: 손 제작{['workbench', 'campfire', 'furnace', 'anvil', 'advanced_furnace', 'alchemy', 'magicbench'].filter(st => stationFor(s, st)).map(st => ' · ' + ITEMS[st].name).join('')}<br />재료를 처음 얻으면 제작법이 해금됩니다. 해당 시설에서 3m 안으로 이동해 제작하세요.</p><div className="recipe-list">{available.map(r => <div className="recipe" key={r.id}><span className="itemicon">{ITEMS[r.output].icon}</span><div style={{ flex: 1 }}><strong>{ITEMS[r.output].name}{r.qty > 1 ? ' ×' + r.qty : ''}</strong><small>{Object.entries(r.inputs).map(([id, n]) => `${ITEMS[id].name} ${count(s.player.items, id)}/${n}`).join(' · ')}</small>{!recipeUnlocked(s, r) && <small>미발견 재료: {missingDiscoveries(s, r).join(" · ")}</small>}{r.seconds > 0 && <small>{r.seconds}초 · 연료 필요</small>}</div><button className="btn" disabled={!recipeUnlocked(s, r) || Object.entries(r.inputs).some(([id, n]) => count(s.player.items, id) < n)} onClick={() => e?.craftRecipe(r)}>{recipeUnlocked(s, r) ? "제작" : "잠김"}</button></div>)}</div></>;
    }
    return <><div className="render-host" ref={canvas} style={{ position: 'absolute', inset: 0 }}/><input hidden type="file" accept=".json,application/json" ref={file} onChange={ev => {
        const f = ev.target.files?.[0];
        if (f)
            void importSave(f);
    }}/>
    {menu !== 'play' && <div className="screen"><div className="menu"><span className="eyebrow">SANDBOX SURVIVAL / ALPHA 0.51</span>{menu === 'home' ? <><h1 className="wordmark">NIGHT<br />FALL</h1><p className="subtitle">낮을 준비하고, 밤을 견디다.</p><div className="rule"/>{worlds.length > 0 && <button className="btn primary wide" disabled={busy} onClick={() => load(worlds[0].id)}>이어하기 <span>DAY {worlds[0].day}</span></button>}<button className={`btn wide ${worlds.length ? '' : 'primary'}`} disabled={busy} onClick={() => setMenu('new')}>새로운 섬</button><button className="btn wide" onClick={() => {
        void list();
        setMenu('worlds');
    }}>월드 관리 <span>{worlds.length} / 5</span></button><button className="btn wide" onClick={() => setMenu('help')}>조작법</button><p className="muted" style={{ marginTop: 24 }}>이 브라우저에 진행이 저장됩니다.<br />다른 기기로 옮길 때는 파일 백업을 이용하세요.</p></> : menu === 'new' ? <><h2>새로운 섬</h2><p className="muted" style={{ marginBottom: 24 }}>빈손으로 시작하는 생존.</p><label>월드 이름<input value={name} onChange={ev => setName(ev.target.value)} maxLength={40}/></label><label>월드 시드 · 선택<input placeholder="비워 두면 무작위 생성" value={seed} maxLength={64} onChange={ev => setSeed(ev.target.value)}/></label><label>난이도<Choice value={difficulty} set={setDifficulty} values={[['easy', '쉬움'], ['normal', '기본'], ['hard', '어려움']]}/></label><label>사망 규칙<Choice value={mode} set={setMode} values={[['normal', '일반 생존 · 가방 회수'], ['permadeath', '영구 사망 · 부활 불가']]}/></label><button className="btn primary wide" disabled={busy} onClick={() => void start()}>{busy ? '섬을 생성하는 중…' : '섬에 들어가기'}</button><button className="smallbutton" onClick={() => setMenu('home')}>뒤로</button></> : menu === 'worlds' ? <><h2>나의 월드</h2><p className="muted" style={{ marginBottom: 20 }}>저장된 섬 {worlds.length} / 5</p><div style={{ maxHeight: '50vh', overflowY: 'auto' }}>{worlds.map(w => <div className="world-row" key={w.id}><strong>{w.name}</strong><small>Day {w.day} · {w.difficulty === 'easy' ? '쉬움' : w.difficulty === 'hard' ? '어려움' : '기본'} · {w.mode === 'permadeath' ? '영구 사망' : '일반 생존'}<br />{new Date(w.saved).toLocaleString('ko-KR')}</small><div className="button-row"><button className="btn" disabled={busy} onClick={() => load(w.id)}>열기</button><button className="btn" disabled={busy} onClick={() => setDeleteId(w.id)}>삭제</button></div></div>)}</div>{!worlds.length && <p className="empty">저장된 월드가 없습니다.</p>}<button className="btn wide" disabled={busy} onClick={() => file.current?.click()}>백업 파일 가져오기</button><button className="smallbutton" onClick={() => setMenu('home')}>뒤로</button></> : <><h2>조작법</h2><Controls /><button className="btn wide" onClick={() => setMenu('home')}>메뉴로 돌아가기</button></>}{err && <p className="error" role="alert">{err}</p>}<p className="mobile-note">PC 키보드와 마우스가 필요한 게임입니다.</p></div><div className="menu-footer"><span>낮에는 채집. 밤에는 생존.</span><span>LOCAL SAVE / v0.51.0</span></div></div>}
        {menu === 'play' && s && p && e && <><div className="hud"><div className="topline"><div className="daypill"><strong>DAY {day(s.time).toString().padStart(2, '0')}</strong><small>{phase(s.time)} · {Math.floor((s.time % 720) / 720 * 100)}%{s.blood ? ' · 핏빛 달' : ''}</small></div><div className="compass">{['N', 'NW', 'W', 'SW', 'S', 'SE', 'E', 'NE'][Math.round(((p.yaw % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8]} ─ ◇ ─ {biomeLabel(p.x, p.z)}<small> · {regionWarning(biomeLabel(p.x, p.z))}</small></div><div className="save-label">{e.saveLabel}{e.dirty ? ' · 변경됨' : ''}<div className="controls-tip">TAB 가방 · M 지도 · ESC 메뉴</div></div></div>{!e.paused && <><div className="crosshair"/>{targetName && <div className="target">{targetName}<small>{targetHelp}</small></div>}</>}<div className="vitals">{[['체력', p.hp, ''], ['허기', p.hunger, 'hunger'], ['스태미나', p.stamina, 'stamina']].map(([n, v, c]) => <div key={String(n)}><div className="vital-label"><span>{n}</span><span>{Math.ceil(Number(v))} / 100</span></div><div className="track"><div className={`fill ${c}`} style={{ width: `${v}%` }}/></div></div>)}</div><div className="status-line">{p.poison > 0 ? '독 · ' : ''}{p.curse > 0 ? '저주 · ' : ''}{p.slow > 0 ? '둔화 · ' : ''}{(p.poisonResist || 0) > 0 ? '독 저항 · ' : ''}{(p.stagger || 0) > 0 ? '경직 · ' : ''}{p.fishing ? `낚시 ${Math.ceil(p.fishing.remaining)}초` : ''}</div><div className="hotbar">{p.hotbar.map((uid, i) => {
        const v = p.items.find(it => it.uid === uid);
        return <button key={i} className={`slot ${p.selected === i ? 'selected' : ''}`} title={v ? ITEMS[v.id].name : `빈 슬롯 ${i + 1}`} onClick={() => {
            p.selected = i;
            rerender();
        }}><span className="num">{i + 1}</span>{v && <><span className="itemicon">{ITEMS[v.id].icon}</span><span className="short">{ITEMS[v.id].name}</span><span className="quantity">{v.qty > 1 ? v.qty : ''}</span></>}</button>;
    })}</div><div className="selected-name">{it ? ITEMS[it.id].name : '맨손'}{it?.dur !== undefined ? ` · ${Math.floor(it.dur)}/${ITEMS[it.id].durability}` : ''}</div><div className="objective"><span>생존 기록</span><p>{s.quests.includes('night') ? '밤의 군주 처치 완료' : s.quests.length ? `봉인 조각 ${s.quests.length} / 3` : p.items.some(i => i.id === 'stone_pick') ? '철광석을 찾아 장비를 만들기' : s.buildings.some(b => b.kind === 'workbench') ? '돌 곡괭이와 창 만들기' : '가지와 돌을 모아 제작대 만들기'}</p></div></div><div className="damage-flash" style={{ opacity: flash }}/>
        <Dialog open={e.paused && e.panel !== null} onOpenChange={open => {
        if (!open && s.status === 'alive')
            void scene.current?.play();
    }}><DialogContent className={`game-dialog ${['pause', 'death', 'help'].includes(e.panel || '') ? 'compact' : ''}`} showCloseButton={false} onEscapeKeyDown={ev => {
        ev.preventDefault();
        if (s.status === 'alive')
            void scene.current?.play();
    }} onPointerDownOutside={ev => ev.preventDefault()}><div className="panel-head"><DialogTitle>{e.panel === 'death' ? (s.status === 'ended' ? '생존 종료' : '쓰러졌습니다') : e.panel === 'map' ? '섬의 기록' : e.panel === 'pause' ? '잠시 숨을 고르다' : e.panel === 'help' ? '조작법' : e.panel === 'facility' ? (ITEMS[b?.kind || 'workbench']?.name || '시설') : '배낭과 제작'}</DialogTitle>{s.status === 'alive' && <button className="btn" onClick={() => void scene.current?.play()}>계속하기</button>}</div><DialogDescription className="sr-only">게임 시간이 멈췄습니다. 메뉴에서 작업 후 계속하기를 누르세요.</DialogDescription>
        {e.panel === 'pause' ? <><p className="muted">{s.name} · Day {day(s.time)} · {phase(s.time)}</p><div className="button-row"><button className="btn" disabled={busy} onClick={() => void e.save()}>지금 저장</button><button className="btn" onClick={() => void e.export()}>파일 백업</button><button className="btn" onClick={() => {
        e.pause('help');
    }}>조작법</button></div><button className="btn wide" onClick={() => {
        e.pause('inventory');
    }}>가방 / 제작</button><button className="btn wide" disabled={busy} onClick={() => void quit()}>{busy ? '저장 중…' : '저장 후 메뉴로'}</button><button className="smallbutton" onClick={() => navigator.storage?.persist?.().then(ok => e.notify(ok ? '저장 보호를 설정했습니다.' : '보호가 허용되지 않았습니다. 파일 백업을 이용하세요.'))}>브라우저 저장 보호 요청</button>{e.error && <p className="muted" style={{ color: '#f2a28a' }}>{e.error}</p>}<p className="help-line">백업 파일은 브라우저 데이터를 지워도 남겨둘 수 있습니다.</p></> : e.panel === 'death' ? <><p className="muted">Day {day(s.time)} · {s.mode === 'normal' ? '소지품은 사망 지점의 가방에 남습니다.' : '이 월드에서는 다시 부활할 수 없습니다.'}</p>{s.mode === 'normal' && <button className="btn primary wide" onClick={() => e.respawn()}>침낭 또는 시작 지점에서 부활</button>}<button className="btn wide" disabled={busy} onClick={() => void quit()}>기록 저장 후 메뉴로</button><button className="smallbutton" onClick={() => void e.export()}>기록 파일 백업</button></> : e.panel === 'help' ? <Controls /> : e.panel === 'map' ? <><p className="muted">발견한 지역: {s.discovered.join(' · ')}</p><div className="map">{['초원', '숲', '바위 언덕', '습지', '화산', '유적'].map((n, i) => <span className="region" key={n} style={{ left: [45, 60, 43, 13, 77, 44][i] + '%', top: [49, 40, 20, 50, 50, 80][i] + '%' }}>{s.discovered.includes(n) ? n : '?'}</span>)}<span className="mark" style={{ left: (p.x + 512) / 1024 * 100 + '%', top: (p.z + 512) / 1024 * 100 + '%', color: '#e7ad64' }}>▲</span>{s.drops.filter(d => d.bag).map(d => <span className="mark" key={d.id} style={{ left: (d.x + 512) / 1024 * 100 + '%', top: (d.z + 512) / 1024 * 100 + '%' }} title="사망 가방">▣</span>)}{s.buildings.filter(b => b.kind.endsWith('_altar')).map(b => <span className="mark" key={b.id} style={{ left: (b.x + 512) / 1024 * 100 + '%', top: (b.z + 512) / 1024 * 100 + '%', color: '#b899d9' }} title="수호자 제단">◇</span>)}</div><p className="help-line">▲ 현재 위치 · ▣ 사망 가방 / 잔해 · ◇ 제단<br />좌표 {p.x.toFixed(0)}, {p.z.toFixed(0)} · 봉인 조각 {s.quests.filter(q => q !== 'night').length}/3</p></> : e.panel === 'facility' && b?.kind === 'chest' ? <><p className="help-line">아이템을 누르면 반대 보관함으로 이동합니다.</p><h3>상자 {b.items.length}/24</h3>{stackGrid(b.items, i => e.transfer(i.uid, false))}<h3 style={{ margin: '24px 0 16px' }}>배낭 {p.items.length}/{capacity(s)}</h3>{stackGrid(p.items, i => e.transfer(i.uid, true))}</> : <Tabs value={tab} onValueChange={setTab}><TabsList className="game-tabs"><TabsTrigger value="items">배낭 {p.items.length}/{capacity(s)}</TabsTrigger><TabsTrigger value="craft">제작</TabsTrigger>{e.panel === 'facility' && b && <TabsTrigger value="jobs">작업과 출력</TabsTrigger>}</TabsList><TabsContent value="items"><p className="help-line">아이템을 선택하고 아래 동작을 사용하세요. 배치 아이템은 슬롯에 넣고 E로 설치합니다.</p>{stackGrid(p.items, i => setInspected(i.uid))}{chosen && <div className="facility-row"><strong>{ITEMS[chosen.id].name}</strong><button className="btn" onClick={() => e.bind(chosen.uid)}>{ITEMS[chosen.id].kind === 'armor' ? '착용' : `${p.selected + 1}번 슬롯에 넣기`}</button>{['food', 'potion'].includes(ITEMS[chosen.id].kind) && <button className="btn" onClick={() => e.useItem(chosen.uid)}>사용</button>}{chosen.dur !== undefined && <button className="btn" onClick={() => e.repair(chosen.uid)}>수리</button>}</div>}</TabsContent><TabsContent value="craft">{recipes()}</TabsContent><TabsContent value="jobs">{b && <><div className="facility-row"><span>남은 연료 {Math.ceil(b.fuel)}초</span>{['wood', 'charcoal', 'coal'].map(id => <button key={id} className="btn" disabled={!count(p.items, id)} onClick={() => e.fuel(id)}>{ITEMS[id].name} 1개 넣기</button>)}</div>{b.jobs.map((j, i) => <div className="recipe" key={j.id}><span>{ITEMS[j.recipe].name} · {i ? '대기' : '가동'} · {Math.ceil(j.remaining)}초</span><button className="btn" onClick={() => e.cancelJob(j.id)}>취소 / 재료 반환</button></div>)}{!b.jobs.length && <p className="muted">대기 중인 작업이 없습니다. 제작 탭에서 작업을 시작하세요.</p>}<h3 style={{ margin: '20px 0' }}>출력 · 누르면 회수</h3>{stackGrid(b.items, i => e.transfer(i.uid, false))}</>}</TabsContent></Tabs>}
        </DialogContent></Dialog></>}
    {e && <div className="toasts" aria-live="polite">{e.notices.filter(n => n.until > now).map(n => <div className="toast" key={n.id}>{n.text}</div>)}</div>}
    <AlertDialog open={deleteId !== null} onOpenChange={open => {
        if (!open)
            setDeleteId(null);
    }}><AlertDialogContent><AlertDialogTitle>이 월드를 삭제할까요?</AlertDialogTitle><AlertDialogDescription>저장된 진행과 자동 복구본이 함께 삭제됩니다. 파일 백업이 없다면 되돌릴 수 없습니다.</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction onClick={() => {
        if (deleteId)
            void storage.current!.remove(deleteId).then(list).catch(e => setErr(message(e)));
        setDeleteId(null);
    }}>삭제</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={recovery !== null}><AlertDialogContent><AlertDialogTitle>이전 저장본을 발견했습니다.</AlertDialogTitle><AlertDialogDescription>최신 저장을 읽을 수 없습니다. Day {recovery ? day(recovery.time) : ''} 복구본으로 이어갈까요? 기존 손상 파일은 지금 덮어쓰지 않습니다.</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel onClick={() => {
        setRecovery(null);
        void storage.current!.release();
    }}>취소</AlertDialogCancel><AlertDialogAction onClick={() => {
        if (recovery)
            attach(recovery);
    }}>복구본 열기</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </>;
}
function biomeLabel(x: number, z: number) {
    return z > 240 ? '유적' : x > 230 ? '화산' : x < -200 ? '습지' : z < -210 ? '바위 언덕' : Math.abs(x) > 85 || Math.abs(z) > 95 ? '숲' : '초원';
}
function message(e: unknown) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError')
        return '브라우저 저장 공간이 부족합니다. 파일 백업 후 월드를 정리하세요.';
    return e instanceof Error ? e.message : String(e);
}
function Controls() {
    return <><div className="controls-grid">{[['W A S D', '이동'], ['마우스', '둘러보기 · 계속하기를 누르면 마우스 잠금'], ['좌클릭', '공격 / 채집 / 음식 사용'], ['우클릭', '방패로 정면 100도 방어 · 활/지팡이는 방어 불가'], ['E', '채집 / 시설 / 전리품 / 건축 배치'], ['Shift / Space', '질주 / 점프'], ['Ctrl', '회피'], ['1–8 / 휠', '퀵슬롯 선택'], ['Tab / M', '가방·제작 / 지도'], ['Esc', '일시정지 / 저장 메뉴']].map(([k, n]) => <div key={k} style={{ display: 'contents' }}><kbd>{k}</kbd><span>{n}</span></div>)}</div><p className="notes">첫날에는 떨어진 가지, 작은 돌, 풀을 모으세요. 가방의 제작 탭에서 제작대를 만들고 슬롯에 넣은 뒤 E로 설치합니다. 제작대 가까이에서 돌 도구를 만들 수 있습니다. 음식은 슬롯에 넣고 좌클릭 또는 가방에서 사용하세요. 낚싯대는 해안에서 좌클릭 후 7초간 들고 기다립니다. 이동·피격·장비 교체로 취소됩니다. 지역 적은 날짜와 별도 Tier로 등장합니다.</p></>;
}
export function mountGame(host: HTMLElement) {
    const root = createRoot(host);
    root.render(<App />);
    return () => root.unmount();
}
