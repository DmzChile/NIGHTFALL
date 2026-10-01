"use client";
import { Progress } from '@/components/ui/progress';
import { ITEMS, day, phase } from './data';
import { biome, selected } from './model';
import { regionWarning } from './regions';
import type { Engine } from './engine';

export function GameHud({ engine, targetName = '', targetHelp = '', onSelectSlot }: {
    engine: Engine;
    targetName?: string;
    targetHelp?: string;
    onSelectSlot: (index: number) => void;
}) {
    const s = engine.state, p = s.player, item = selected(s), region = biome(p.x, p.z);
    const bearing = ['N', 'NW', 'W', 'SW', 'S', 'SE', 'E', 'NE'][Math.round(((p.yaw % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8];
    const statuses = [p.poison > 0 && '독', p.curse > 0 && '저주', p.slow > 0 && '둔화', (p.poisonResist || 0) > 0 && '독 저항', (p.stagger || 0) > 0 && '경직', p.fishing && `낚시 ${Math.ceil(p.fishing.remaining)}초`].filter(Boolean);
    const objective = engine.creative ? 'Tab 아이템 · F 비행 · R 철거' : s.quests.includes('night') ? '밤의 군주 처치 완료' : s.quests.length ? `봉인 조각 ${s.quests.length} / 3` : p.items.some(i => i.id === 'stone_pick') ? '철광석을 찾아 장비를 만들기' : s.buildings.some(b => b.kind === 'workbench') ? '돌 곡괭이와 창 만들기' : '가지와 돌을 모아 제작대 만들기';
    const vitals = [{ name: '체력', value: p.hp, kind: 'health' }, { name: '허기', value: p.hunger, kind: 'hunger' }, { name: '스태미나', value: p.stamina, kind: 'stamina' }];
    return <div className="hud" aria-label="게임 상태">
        <div className="topline">
            <section className="daypill hud-panel" aria-label="날짜와 시간대">
                {engine.creative && <span className="sandbox-tag">CREATIVE{p.flying ? ' / FLY' : ''}</span>}
                <strong>DAY {day(s.time).toString().padStart(2, '0')}</strong>
                <small>{phase(s.time)} · 하루 {Math.floor((s.time % 720) / 720 * 100)}%{s.blood ? ' · 핏빛 달' : ''}</small>
            </section>
            <section className="compass hud-panel" aria-label={`방향 ${bearing} · ${region}`}>
                <div className="compass-heading"><strong>{bearing}</strong><span aria-hidden="true">◇</span><span>{region}</span></div>
                <small>{regionWarning(region)}</small>
            </section>
            <section className="save-label hud-panel" aria-label="저장 상태와 조작키">
                <span>{engine.saveLabel}</span>{engine.dirty && <span className="hud-unsaved">저장할 변경 있음</span>}
                <div className="controls-tip"><kbd>Tab</kbd> 가방 · <kbd>M</kbd> 지도<br /><kbd>/</kbd> 명령어 · <kbd>Esc</kbd> 메뉴</div>
            </section>
        </div>
        {!engine.paused && <><div className="crosshair" />{targetName && <div className="target"><strong>{targetName}</strong><small>{targetHelp}</small></div>}</>}
        <div className="hud-bottom">
            <section className="vitals hud-panel" aria-label="체력, 허기, 스태미나">
                {vitals.map(({ name, value, kind }) => <div className={`vital ${kind}`} key={kind}>
                    <div className="vital-label"><span>{name}</span><span>{Math.ceil(value)} <small>/ 100</small></span></div>
                    <Progress className="vital-track" value={Math.max(0, Math.min(100, value))} max={100} aria-label={name} aria-valuetext={`${Math.ceil(value)} / 100`} />
                </div>)}
                {statuses.length > 0 && <p className="status-line">{statuses.join(' · ')}</p>}
            </section>
            <section className="hotbar-dock" aria-label="인벤토리 퀵슬롯">
                <div className="selected-name">{item ? ITEMS[item.id].name : '맨손'}{item?.dur !== undefined && <span> · {Math.floor(item.dur)} / {ITEMS[item.id].durability}</span>}</div>
                <div className="hotbar">{p.hotbar.map((uid, index) => {
                    const stack = p.items.find(i => i.uid === uid), definition = stack && ITEMS[stack.id];
                    const name = definition?.name || '빈 슬롯';
                    return <button key={index} className={`slot ${p.selected === index ? 'selected' : ''} ${stack ? '' : 'is-empty'}`} title={`${index + 1} · ${name}`} aria-label={`퀵슬롯 ${index + 1} · ${name}${stack ? engine.creative ? ' · 무제한' : ` · ${stack.qty}개` : ''}`} aria-pressed={p.selected === index} onClick={() => onSelectSlot(index)}>
                        <span className="num" aria-hidden="true">{index + 1}</span>{stack && definition ? <><span className="itemicon" aria-hidden="true">{definition.icon}</span><span className="short">{name}</span><span className="quantity">{engine.creative ? '∞' : stack.qty > 1 ? stack.qty : ''}</span></> : <span className="slot-empty-mark" aria-hidden="true">·</span>}
                    </button>;
                })}</div>
                <p className="hotbar-help"><kbd>1–8</kbd> / 휠 선택 · <kbd>E</kbd> 상호작용 · 좌클릭 사용</p>
            </section>
            <aside className="objective hud-panel" aria-label={engine.creative ? '자유 건축 안내' : '생존 기록'}><span>{engine.creative ? '자유 건축' : '생존 기록'}</span><p>{objective}</p></aside>
        </div>
    </div>;
}
