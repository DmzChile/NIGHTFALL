"use client";
import { recipeUnlocked, missingDiscoveries } from './progression';
import { detectionRadius } from './awareness';
import { isTree, nodeDefinition } from './woodland';
import { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { GameScene } from './scene';
import { graphicsQuality, type GraphicsQuality } from './lighting';
import { Engine } from './engine';
import { SaveManager, importFile, type WorldInfo } from './storage';
import { createWorld, isCreative, selected, count, capacity, stationFor, type GameMode, type State, type Stack } from './model';
import { ITEMS, MONSTERS, RECIPES, phase, day } from './data';
import { InventoryView, StackGrid } from './inventory-ui';
import { CommandConsole, CreativeCatalog } from './sandbox-ui';
import { GameHud } from './hud';

const difficultyLabel = (value: string) => value === 'easy' ? '쉬움' : value === 'hard' ? '어려움' : '기본';
const modeLabel = (value: string) => value === 'permadeath' ? '영구 사망' : '일반 생존';
function WorldSummary({ world }: { world: WorldInfo }) {
    return <div className="world-summary"><div className="world-summary-heading"><strong>{world.name}</strong><span className="world-day">DAY {world.day}</span></div><div className="world-tags"><span>난이도 · {difficultyLabel(world.difficulty)}</span><span>{world.gameMode === 'creative' ? '크리에이티브' : modeLabel(world.mode)}</span>{world.status === 'ended' && <span className="world-ended">생존 종료</span>}{world.status === 'dead' && <span className="world-ended">부활 대기</span>}</div><p>마지막 저장 <time dateTime={new Date(world.saved).toISOString()}>{new Date(world.saved).toLocaleString('ko-KR')}</time></p></div>;
}
function Choice({ value, set, values, label }: {
    value: string;
    set: (s: string) => void;
    label?: string;
    values: [
        string,
        string
    ][];
}) {
    return <Select value={value} onValueChange={set}><SelectTrigger aria-label={label} className="w-full min-h-11 mb-4"><SelectValue /></SelectTrigger><SelectContent>{values.map(([v, n]) => <SelectItem value={v} key={v}>{n}</SelectItem>)}</SelectContent></Select>;
}
function GraphicsControls({ scene }: { scene: GameScene | null }) {
    const [quality, setQuality] = useState<GraphicsQuality>(scene?.quality || 'medium');
    return <div className="graphics-settings"><label>시각 품질<Choice label="시각 품질" value={quality} set={value => {
        const next = graphicsQuality(value); scene?.setQuality(next); setQuality(next);
    }} values={[[ 'low', '낮음 · 그림자 끄기' ], [ 'medium', '보통 · 그림자' ], [ 'high', '높음 · 선명한 그림자' ]]} /></label><p className="action-note">게임이 느리면 낮음을 선택하세요. 설정은 이 브라우저에 저장됩니다.</p></div>;
}
function App() {
    const canvas = useRef<HTMLDivElement>(null), scene = useRef<GameScene | null>(null), storage = useRef<SaveManager | null>(null), engine = useRef<Engine | null>(null), file = useRef<HTMLInputElement>(null);
    const [, refresh] = useState(0), [activeEngine, setActiveEngine] = useState<Engine | null>(null), [now, setNow] = useState(() => Date.now()), [flash, setFlash] = useState(0), [menu, setMenu] = useState('home'), [worlds, setWorlds] = useState<WorldInfo[]>([]), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [name, setName] = useState('첫 번째 섬'), [seed, setSeed] = useState(''), [difficulty, setDifficulty] = useState('normal'), [mode, setMode] = useState('normal'), [gameMode, setGameMode] = useState<GameMode>('survival'), [deleteId, setDeleteId] = useState<string | null>(null), [discardExit, setDiscardExit] = useState(false), [recovery, setRecovery] = useState<State | null>(null), [inspected, setInspected] = useState<string | null>(null), [tab, setTab] = useState('items');
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
        void list();
        try {
            scene.current = new GameScene(canvas.current!, () => engine.current?.pause());
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
        engine.current?.dispose();
        const e = new Engine(s, storage.current!);
        e.onChange = rerender;
        engine.current = e;
        setActiveEngine(e);
        setTab(isCreative(s) ? 'catalog' : 'items');
        setInspected(null);
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
            const s = createWorld(name, seed, difficulty as State['difficulty'], mode as State['mode'], gameMode);
            await storage.current!.acquire(s.id);
            await storage.current!.save(s);
            attach(s);
            engine.current!.notify(isCreative(s) ? '크리에이티브 · Tab 아이템 목록 / F 비행 / R 철거 / 명령어는 / 키' : '떨어진 가지와 작은 돌을 E로 모아 제작대를 만드세요.');
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
    async function quit(save = true) {
        const e = engine.current;
        if (!e)
            return;
        e.pause();
        setBusy(true);
        if (save) await e.save();
        if (save && e.error) {
            setBusy(false);
            return;
        }
        e.dispose();
        await storage.current!.release();
        engine.current = null;
        setActiveEngine(null);
        scene.current!.setEngine(null);
        setMenu('home');
        setDiscardExit(false);
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
                    return { gameMode: e.state.gameMode ?? 'survival', flying: !!e.state.player.flying, day: day(e.state.time), phase: phase(e.state.time), health: Math.round(e.state.player.hp), inventory: e.state.player.items.map(i => ({ item: ITEMS[i.id].name, quantity: i.qty })), save: e.saveLabel };
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
    const e = activeEngine, s = e?.state, p = s?.player;
    const target = e?.target;
    let targetName = '', targetHelp = '';
    if (s && target) {
        if (target.kind === 'node') {
            const n = s.nodes.find(n => n.id === target.id);
            if (n) {
                const def = nodeDefinition(n);
                targetName = def.name;
                targetHelp = `${target.distance <= 3.8 ? 'E / 좌클릭 · 채집' : '가까이 이동'}${e!.creative ? ' · R 제거' : def.level ? ' · 도구 단계 ' + def.level : ''}${isTree(n) ? ` · 내구도 ${Math.ceil(n.hp)} / ${def.hp}` : ''}`;
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
                targetHelp = target.distance <= 3.5 ? 'E · 상호작용' + (e!.creative && Object.hasOwn(ITEMS, b.kind) ? ' · R 철거' : '') : '가까이 이동';
            }
        }
        if (target.kind === 'drop') {
            const d = s.drops.find(d => d.id === target.id);
            targetName = d?.bag ? '사망 가방 / 잔해' : '전리품';
            targetHelp = target.distance <= 3.5 ? 'E · 회수' : '가까이 이동';
        }
    }
    const b = s?.buildings.find(b => b.id === e?.facility);
    const chosen = p?.items.find(i => i.uid === inspected) || (s ? selected(s) : undefined) || p?.items[0];
    function stackGrid(items: Stack[], onClick: (i: Stack) => void) {
        return s ? <StackGrid items={items} state={s} onSelect={onClick} /> : null;
    }
    function recipes() {
        if (!s)
            return null;
        const available = RECIPES.filter(r => isCreative(s) || r.station === 'hand' || !!stationFor(s, r.station, e?.panel === 'facility' ? e.facility || undefined : undefined));
        return <><div className="craft-guidance"><strong>{isCreative(s) ? '자유 제작' : '사용 가능한 제작 시설'}</strong><p>{isCreative(s) ? '모든 제작법 · 재료와 시설 없이 즉시 제작' : '손 제작'}{['workbench', 'campfire', 'furnace', 'anvil', 'advanced_furnace', 'alchemy', 'magicbench'].filter(st => stationFor(s, st)).map(st => ' · ' + ITEMS[st].name).join('')}</p><span>{isCreative(s) ? '완성품은 가방에 들어갑니다. 가방 공간을 확인하세요.' : '시설 3m 안에서 제작할 수 있습니다. 재료 표시는 보유 / 필요 수량입니다.'}</span></div><div className="recipe-list">{available.map(r => {
            const unlocked = isCreative(s) || recipeUnlocked(s, r), missing = !isCreative(s) && Object.entries(r.inputs).some(([id, n]) => count(p!.items, id) < n);
            return <div className="recipe" key={r.id}><span className="itemicon" aria-hidden="true">{ITEMS[r.output].icon}</span><div className="recipe-info"><strong>{ITEMS[r.output].name}{r.qty > 1 ? ' ×' + r.qty : ''}</strong><span className="recipe-station">{r.station === 'hand' ? '손 제작' : ITEMS[r.station].name} · {isCreative(s) ? '즉시 제작 · 시설 / 연료 필요 없음' : r.seconds > 0 ? `${r.seconds}초 · 연료 필요` : '즉시 제작'}</span><ul className="recipe-materials">{Object.entries(r.inputs).map(([id, n]) => {
                const owned = count(p!.items, id);
                return <li key={id} className={!isCreative(s) && owned < n ? 'missing' : ''}>{ITEMS[id].name} <b>{isCreative(s) ? '소모 없음' : `${owned} / ${n}`}</b>{!isCreative(s) && owned < n && <span>부족</span>}</li>;
            })}</ul>{!unlocked && <p className="recipe-locked">해금 필요 · {missingDiscoveries(s, r).join(' · ')}</p>}</div><button className={`btn ${unlocked && !missing ? 'primary' : ''}`} disabled={!unlocked || missing} onClick={() => e?.craftRecipe(r)}>{!unlocked ? '미해금' : missing ? '재료 부족' : '제작'}</button></div>;
        })}</div></>;
    }
    return <><div className="render-host" ref={canvas} style={{ position: 'absolute', inset: 0 }}/><input hidden type="file" accept=".json,application/json" ref={file} onChange={ev => {
        const f = ev.target.files?.[0];
        if (f)
            void importSave(f);
    }}/>
    {menu !== 'play' && <div className="screen"><div className="menu"><span className="eyebrow">SANDBOX SURVIVAL / ALPHA 0.54</span>
        {menu === 'home' ? <>
            <h1 className="wordmark">NIGHT<br />FALL</h1><p className="subtitle">낮을 준비하고, 밤을 견디다.</p>
            {worlds.length > 0 && <div className="latest-world"><span className="section-label">최근 저장한 섬</span><WorldSummary world={worlds[0]} /><button className="btn primary wide" disabled={busy} onClick={() => load(worlds[0].id)}>이 섬 이어하기</button></div>}
            <div className="menu-actions"><button className={`btn wide ${worlds.length ? '' : 'primary'}`} disabled={busy} onClick={() => setMenu('new')}>새로운 섬 만들기</button><button className="btn wide" disabled={busy} onClick={() => { void list(); setMenu('worlds'); }}>저장된 월드 관리 <span>{worlds.length} / 5개</span></button><button className="btn wide" onClick={() => setMenu('help')}>조작법과 시작 안내</button></div>
            <div className="storage-note"><strong>이 브라우저에 진행이 저장됩니다.</strong><p>다른 기기에서 이어하려면 게임 메뉴의 파일 백업을 이용하세요.</p></div>
        </> : menu === 'new' ? <>
            <h2>새로운 섬 만들기</h2><p className="muted">월드 이름과 플레이 방식을 정하세요.</p>
            <label>월드 이름<input value={name} onChange={ev => setName(ev.target.value)} maxLength={40}/></label>
            <label>월드 시드 · 선택<input placeholder="비워 두면 무작위 생성" value={seed} maxLength={64} onChange={ev => setSeed(ev.target.value)}/></label>
            <p className="muted">같은 시드는 같은 산과 물길을 만듭니다. 강과 연못은 숲·습지에 나타나며 시작 초원은 완만하게 유지됩니다.</p>
            <label>플레이 모드<Choice label="플레이 모드" value={gameMode} set={value => setGameMode(value as GameMode)} values={[["survival", "생존 · 채집과 밤 전투"], ["creative", "크리에이티브 · 자유 건축과 비행"]]} /></label>
            {gameMode === 'creative' && <p className="mode-explanation creative">피해·허기·장비 소모 없이 플레이합니다. 모든 아이템, 즉시 제작, 비행과 철거를 사용할 수 있으며 적은 자연 생성되지 않습니다. 아래 규칙은 생존 모드로 전환할 때 적용됩니다.</p>}
            <label>{gameMode === 'creative' ? '생존 전환 시 난이도' : '난이도'}<Choice label="난이도" value={difficulty} set={setDifficulty} values={[['easy', '쉬움'], ['normal', '기본'], ['hard', '어려움']]}/></label>
            <label>{gameMode === 'creative' ? '생존 전환 시 사망 규칙' : '사망 규칙'}<Choice label="사망 규칙" value={mode} set={setMode} values={[['normal', '일반 생존'], ['permadeath', '영구 사망']]}/></label>
            <p className={`mode-explanation ${mode === 'permadeath' ? 'warning' : ''}`}>{mode === 'permadeath' ? '사망하면 생존이 종료됩니다. 이 월드에서는 다시 부활할 수 없습니다.' : '사망하면 침낭 또는 시작 지점에서 부활하며, 사망 지점의 가방에서 소지품을 회수할 수 있습니다.'}</p>
            <button className="btn primary wide" disabled={busy} onClick={() => void start()}>{busy ? '섬을 생성하는 중…' : '섬에 들어가기'}</button><button className="smallbutton" onClick={() => setMenu('home')}>메인 메뉴로</button>
        </> : menu === 'worlds' ? <>
            <h2>저장된 월드</h2><p className="muted">{worlds.length} / 5개 · 가장 최근 저장 순서</p><div className="world-list">{worlds.map(w => <div className="world-row" key={w.id}><WorldSummary world={w} /><div className="button-row"><button className="btn" disabled={busy} onClick={() => load(w.id)}>월드 열기</button><button className="btn danger" disabled={busy} onClick={() => setDeleteId(w.id)}>삭제</button></div></div>)}</div>{!worlds.length && <p className="empty">저장된 월드가 없습니다. 새로운 섬을 만들거나 백업 파일을 가져오세요.</p>}<button className="btn wide" disabled={busy} onClick={() => file.current?.click()}>백업 파일 가져오기</button><button className="smallbutton" onClick={() => setMenu('home')}>메인 메뉴로</button>
        </> : <><h2>조작법</h2><Controls /><button className="btn wide" onClick={() => setMenu('home')}>메인 메뉴로</button></>}
        {err && <p className="error" role="alert">{err}</p>}<p className="mobile-note">PC 키보드와 마우스가 필요한 게임입니다.</p>
        </div><div className="menu-footer"><span>낮에는 채집. 밤에는 생존.</span><span>LOCAL SAVE / v0.54.0</span></div></div>}
        {menu === 'play' && s && p && e && <><GameHud engine={e} targetName={targetName} targetHelp={targetHelp} onSelectSlot={index => e.selectSlot(index)} /><div className="damage-flash" style={{ opacity: flash }}/>
        <Dialog open={e.paused && e.panel !== null} onOpenChange={open => {
        if (!open && !busy && s.status === 'alive')
            void scene.current?.play();
    }}><DialogContent className={`game-dialog ${['pause', 'death', 'help'].includes(e.panel || '') ? 'compact' : ''} ${e.panel === 'pause' ? 'pause-menu' : e.panel === 'console' ? 'command-dialog' : ''}`} showCloseButton={false} onEscapeKeyDown={ev => {
        ev.preventDefault();
        if (!busy && s.status === 'alive')
            void scene.current?.play();
    }} onPointerDownOutside={ev => ev.preventDefault()}><div className="panel-head"><div><DialogTitle>{e.panel === 'death' ? (s.status === 'ended' ? '생존 종료' : '쓰러졌습니다') : e.panel === 'map' ? '섬의 기록' : e.panel === 'pause' ? '일시정지' : e.panel === 'help' ? '조작법' : e.panel === 'console' ? '명령어 콘솔' : e.panel === 'facility' ? (ITEMS[b?.kind || 'workbench']?.name || '시설') : '배낭과 제작'}</DialogTitle><span className="dialog-state">게임 시간 정지</span></div>{s.status === 'alive' && <button className="btn primary" disabled={busy || e.saveAccessLost} onClick={() => void scene.current?.play()}>계속하기 <kbd>Esc</kbd></button>}</div><DialogDescription className="sr-only">게임 시간이 멈췄습니다. 메뉴에서 작업 후 계속하기를 누르세요.</DialogDescription>
        {e.saveAccessLost && <p className="save-warning" role="alert">저장 권한이 없어 플레이를 계속할 수 없습니다. 파일 백업으로 현재 진행을 보관하세요.</p>}
        {e.panel === 'pause' ? <>
            <div className="pause-world"><strong>{s.name}</strong><span>DAY {day(s.time)} · {phase(s.time)}</span><p>{e.creative ? '크리에이티브 · ' + (p.flying ? '비행 중' : '지상 이동') : difficultyLabel(s.difficulty) + ' · ' + modeLabel(s.mode)} · {biomeLabel(p.x, p.z)}</p></div>
            <div className="pause-vitals">{[['체력', p.hp], ['허기', p.hunger], ['스태미나', p.stamina]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{Math.ceil(Number(value))}<small> / 100</small></strong><Progress value={Number(value)} aria-label={String(label)} /></div>)}</div>
            <section className="pause-section"><h3>플레이</h3><div className="button-row"><button className="btn" onClick={() => e.pause('inventory')}>배낭 / 제작</button><button className="btn" onClick={() => e.pause('help')}>조작법</button><button className="btn" onClick={() => e.pause('console')}>명령어 콘솔</button>{e.creative && <button className="btn" onClick={() => e.toggleFlight()}>{p.flying ? '비행 끄기' : '비행 켜기'}</button>}</div></section>
            <section className="pause-section"><h3>플레이 모드</h3><Choice label="현재 플레이 모드" value={s.gameMode ?? 'survival'} set={value => { e.setGameMode(value as GameMode); setTab(value === 'creative' ? 'catalog' : 'items'); }} values={[["survival", "생존"], ["creative", "크리에이티브"]]} /><p className="action-note">크리에이티브에서는 피해와 소모 없이 건축할 수 있습니다. 생존으로 전환하면 기존 난이도와 사망 규칙이 다시 적용됩니다.</p></section>
            <section className="pause-section"><h3>진행 저장</h3><div className={`save-status ${e.dirty ? 'pending' : ''}`}><strong>{e.saveLabel}</strong><span>{e.dirty ? '아직 저장하지 않은 변경이 있습니다.' : '현재 진행이 저장되어 있습니다.'}</span></div><div className="button-row"><button className="btn" disabled={busy || e.saveAccessLost} onClick={() => void e.save()}>지금 저장</button><button className="btn" onClick={() => void e.export()}>파일 백업 다운로드</button></div><p className="action-note">파일 백업으로 다른 기기에서 이어 하거나 브라우저 데이터 삭제에 대비할 수 있습니다.</p></section>
            <section className="pause-section"><h3>화면 설정</h3><GraphicsControls scene={scene.current} /></section>
            <button className="btn wide" disabled={busy} onClick={() => void quit()}>{busy ? '저장 중…' : '저장 후 메인 메뉴로'}</button><button className="smallbutton" onClick={() => navigator.storage?.persist?.().then(ok => e.notify(ok ? '저장 보호를 설정했습니다.' : '보호가 허용되지 않았습니다. 파일 백업을 이용하세요.'))}>브라우저 저장 보호 요청</button>
        </> : e.panel === 'death' ? <><p className="muted">Day {day(s.time)} · {s.mode === 'normal' ? '소지품은 사망 지점의 가방에 남습니다.' : '이 월드에서는 다시 부활할 수 없습니다.'}</p>{s.mode === 'normal' && <button className="btn primary wide" onClick={() => e.respawn()}>침낭 또는 시작 지점에서 부활</button>}<button className="btn wide" disabled={busy} onClick={() => void quit()}>기록 저장 후 메뉴로</button><button className="smallbutton" onClick={() => void e.export()}>기록 파일 백업</button></> : e.panel === 'help' ? <Controls /> : e.panel === 'console' ? <CommandConsole engine={e} /> : e.panel === 'map' ? <><p className="muted">발견한 지역: {s.discovered.join(' · ')}</p><div className="map">{['초원', '숲', '바위 언덕', '습지', '화산', '유적'].map((n, i) => <span className="region" key={n} style={{ left: [45, 60, 43, 13, 77, 44][i] + '%', top: [49, 40, 20, 50, 50, 80][i] + '%' }}>{s.discovered.includes(n) ? n : '?'}</span>)}<span className="mark" style={{ left: (p.x + 512) / 1024 * 100 + '%', top: (p.z + 512) / 1024 * 100 + '%', color: '#e7ad64' }}>▲</span>{s.drops.filter(d => d.bag).map(d => <span className="mark" key={d.id} style={{ left: (d.x + 512) / 1024 * 100 + '%', top: (d.z + 512) / 1024 * 100 + '%' }} title="사망 가방">▣</span>)}{s.buildings.filter(b => b.kind.endsWith('_altar')).map(b => <span className="mark" key={b.id} style={{ left: (b.x + 512) / 1024 * 100 + '%', top: (b.z + 512) / 1024 * 100 + '%', color: '#b899d9' }} title="수호자 제단">◇</span>)}</div><p className="help-line">▲ 현재 위치 · ▣ 사망 가방 / 잔해 · ◇ 제단<br />좌표 {p.x.toFixed(0)}, {p.z.toFixed(0)} · 봉인 조각 {s.quests.filter(q => q !== 'night').length}/3</p></> : e.panel === 'facility' && b?.kind === 'chest' ? <><p className="help-line">아이템을 누르면 전체 묶음이 반대 보관함으로 이동합니다. 수량과 보관 칸을 확인하세요.</p><h3>상자 · {b.items.length} / 24칸</h3>{stackGrid(b.items, i => e.transfer(i.uid, false))}<h3 style={{ margin: '24px 0 16px' }}>배낭 · {p.items.length} / {capacity(s)}칸</h3>{stackGrid(p.items, i => e.transfer(i.uid, true))}</> : <Tabs value={!e.creative && tab === 'catalog' ? 'items' : tab} onValueChange={setTab}>
            <TabsList className="game-tabs">{e.creative && <TabsTrigger value="catalog">크리에이티브 아이템</TabsTrigger>}<TabsTrigger value="items">소지품</TabsTrigger><TabsTrigger value="craft">제작</TabsTrigger>{e.panel === 'facility' && b && <TabsTrigger value="jobs">작업과 출력</TabsTrigger>}</TabsList>
            {e.creative && <TabsContent value="catalog"><CreativeCatalog state={s} onGive={(id, qty) => e.notify(e.giveItem(id, qty) ? `${ITEMS[id].name} ×${qty} 지급 완료` : '가방 공간이 부족합니다. 소지품을 정리하세요.')} /></TabsContent>}
            <TabsContent value="items"><InventoryView state={s} item={chosen} onSelect={item => setInspected(item.uid)} onBind={uid => e.bind(uid)} onUse={uid => e.useItem(uid)} onRepair={uid => e.repair(uid)} onDiscard={uid => e.discardItem(uid)} /></TabsContent>
            <TabsContent value="craft">{recipes()}</TabsContent><TabsContent value="jobs">{b && <><div className="facility-row"><span>남은 연료 {Math.ceil(b.fuel)}초</span>{['wood', 'charcoal', 'coal'].map(id => <button key={id} className="btn" disabled={!e.creative && !count(p.items, id)} onClick={() => e.fuel(id)}>{ITEMS[id].name} 1개 넣기</button>)}</div>{b.jobs.map((j, i) => <div className="recipe" key={j.id}><span>{ITEMS[j.recipe].name} · {i ? '대기' : '가동'} · {Math.ceil(j.remaining)}초</span><button className="btn" onClick={() => e.cancelJob(j.id)}>취소 / 재료 반환</button></div>)}{!b.jobs.length && <p className="muted">대기 중인 작업이 없습니다. 제작 탭에서 작업을 시작하세요.</p>}<h3 style={{ margin: '20px 0' }}>출력 · 누르면 회수</h3>{stackGrid(b.items, i => e.transfer(i.uid, false))}</>}</TabsContent>
        </Tabs>}
        {e.error && ['pause', 'death'].includes(e.panel || '') && <><p className="error" role="alert">{e.error}</p><button className="smallbutton" disabled={busy} onClick={() => setDiscardExit(true)}>저장 없이 메뉴로</button></>}
        </DialogContent></Dialog></>}
    {e && <div className="toasts" aria-live="polite">{e.notices.filter(n => n.until > now).map(n => <div className="toast" key={n.id}>{n.text}</div>)}</div>}
    <AlertDialog open={discardExit} onOpenChange={setDiscardExit}><AlertDialogContent><AlertDialogTitle>저장 없이 나갈까요?</AlertDialogTitle><AlertDialogDescription>마지막 저장 이후의 진행은 사라집니다. 진행을 보관하려면 취소하고 파일 백업을 먼저 다운로드하세요. 기존 저장본은 유지됩니다.</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={() => void quit(false)}>저장 없이 나가기</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
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
    return <><div className="controls-grid">{[['W A S D', '이동'], ['마우스', '둘러보기 · 계속하기를 누르면 마우스 잠금'], ['좌클릭', '공격 / 채집 / 음식 사용'], ['우클릭', '방패로 정면 100도 방어 · 활/지팡이는 방어 불가'], ['E', '채집 / 시설 / 전리품 / 건축 배치'], ['Shift / Space', '질주 / 점프'], ['Ctrl', '회피'], ['1–8 / 휠', '퀵슬롯 선택'], ['Tab / M', '가방·제작 / 지도'], ['/ 키', '명령어 콘솔 · Enter 실행 / Tab 자동 완성'], ['F', '크리에이티브 비행 전환 · Space 상승 / Ctrl 하강'], ['R', '크리에이티브에서 바라보는 시설 / 자원 철거'], ['Esc', '일시정지 / 저장 메뉴']].map(([k, n]) => <div key={k} style={{ display: 'contents' }}><kbd>{k}</kbd><span>{n}</span></div>)}</div><p className="notes">첫날에는 떨어진 가지, 작은 돌, 풀을 모으세요. 가방의 제작 탭에서 제작대를 만들고 슬롯에 넣은 뒤 E로 설치합니다. 제작대 가까이에서 돌 도구를 만들 수 있습니다. 음식은 슬롯에 넣고 좌클릭 또는 가방에서 사용하세요. 낚싯대는 해안에서 좌클릭 후 7초간 들고 기다립니다. 이동·피격·장비 교체로 취소됩니다. 지역 적은 날짜와 별도 Tier로 등장합니다.</p><p className="notes">새 월드에서 크리에이티브를 선택하거나 /gamemode creative로 전환하세요. Tab의 크리에이티브 아이템 탭에서 자유롭게 꺼낼 수 있습니다. /help에서 아이템 지급·시간 변경·이동·소환 명령어를 확인하세요. 명령어와 모드 변경은 현재 월드에 적용됩니다.</p></>;
}
export function mountGame(host: HTMLElement) {
    const root = createRoot(host);
    root.render(<App />);
    return () => root.unmount();
}
