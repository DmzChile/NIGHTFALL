"use client";
import { Progress } from '@/components/ui/progress';
import { ITEMS } from './data';
import { capacity, isCreative, selected, type Stack, type State } from './model';

const KIND_LABELS = { material: '제작 재료', food: '음식', tool: '도구', weapon: '무기', building: '설치 시설', armor: '방어구', potion: '물약 / 치료' };
const number = (value: number) => Number(value.toFixed(2)).toString();
function kindLabel(item: Stack) {
    return item.id === 'bag' ? '휴대 장비' : item.id.endsWith('arrow') ? '탄약' : KIND_LABELS[ITEMS[item.id].kind];
}
function itemDescription(item: Stack) {
    const d = ITEMS[item.id];
    if (d.description) return d.description;
    if (item.id === 'bag') return '배낭에 가지고 있으면 소지품 공간이 24칸에서 32칸으로 늘어납니다. 별도 착용은 필요하지 않습니다.';
    if (item.id === 'shield') return '배낭에 가지고 있으면 우클릭으로 정면 공격을 방어합니다. 스태미나와 내구도를 사용하며 활이나 지팡이를 들 때는 방어할 수 없습니다.';
    if (item.id === 'fishing_rod') return '해안에서 들고 좌클릭하면 낚시를 시작합니다. 7초 동안 낚싯대를 유지하세요.';
    if (item.id === 'torch') return '퀵슬롯에 등록해 손에 들 수 있는 도구입니다.';
    if (item.id === 'seed' || item.id === 'herb_seed') return '빈 경작지에서 E를 누르면 배낭의 씨앗 1개를 사용해 작물을 심습니다. 밀 씨앗을 먼저 사용합니다.';
    if (item.id === 'magic_stone') return '지팡이의 충전이 없을 때 자동으로 1개를 소비해 5회 충전합니다.';
    if (item.id.endsWith('_staff')) return '충전이 없으면 마력석 1개를 소비해 5회 충전합니다. 퀵슬롯에 등록해 좌클릭으로 발사하세요.';
    if (item.id.includes('bow')) return '퀵슬롯에 등록해 좌클릭으로 발사합니다. 배낭의 화살을 자동으로 사용합니다.';
    if (item.id.endsWith('arrow')) return '활을 발사할 때 배낭에서 자동으로 소비합니다. 별도 장착은 필요하지 않습니다.';
    if (item.id === 'antidote') return '독을 제거하고 10초 동안 독 저항을 얻습니다.';
    if (item.id === 'purify') return '현재 걸린 저주를 제거합니다.';
    if (item.id === 'pain') return '바라보는 방향으로 던져 적을 취약하게 만듭니다.';
    if (item.id === 'bandage') return '마지막 피해 이후 5초가 지나야 사용 가능합니다. 체력을 6초에 걸쳐 회복합니다.';
    if (item.id === 'raw_meat') return '먹으면 허기를 회복하지만, 20% 확률로 10초 동안 둔화됩니다. 모닥불에서 구워 먹을 수 있습니다.';
    if (d.kind === 'building') return '퀵슬롯에 등록해 들고 E 또는 좌클릭으로 설치합니다. 설치할 수 없는 위치에서는 안내가 표시됩니다.';
    if (d.kind === 'armor') return '착용하면 직접 받는 공격 피해를 줄입니다. 내구도가 0이면 방어 효과가 사라집니다.';
    if (d.kind === 'food') return '먹으면 허기를 회복합니다. 체력 회복 효과가 있는 음식은 5초에 걸쳐 회복합니다.';
    if (d.kind === 'potion') return '한 번에 1개를 사용합니다. 물약과 붕대는 15초의 공통 재사용 대기 시간을 가집니다.';
    if (d.kind === 'tool') return `${d.tool === 'axe' ? '나무' : '광물과 바위'}를 채집하는 도구입니다. 도구 단계가 채집 대상의 요구 단계 이상이어야 합니다.`;
    if (d.kind === 'weapon') return '퀵슬롯에 등록해 들고 좌클릭으로 공격합니다. 실제 피해는 적의 특성과 상태에 따라 달라집니다.';
    return '배낭에 보관하면 제작할 때 자동으로 사용합니다. 제작 탭에서 필요한 재료를 확인하세요.';
}

export function StackGrid({ items, state, selectedUid, onSelect }: { items: Stack[]; state: State; selectedUid?: string; onSelect: (item: Stack) => void }) {
    return <div className="grid-inventory">{items.map(item => {
        const d = ITEMS[item.id], equipped = state.player.armor === item.uid;
        const slots = state.player.hotbar.flatMap((uid, i) => uid === item.uid ? [i + 1] : []);
        const durability = item.dur === undefined ? null : Math.max(0, Math.min(100, item.dur / (d.durability || 1) * 100));
        return <button key={item.uid} className={`invitem ${selectedUid === item.uid ? 'inspected' : ''} ${item.dur === 0 ? 'broken' : ''}`} onClick={() => onSelect(item)} aria-pressed={selectedUid === undefined ? undefined : selectedUid === item.uid} aria-label={`${d.name}, ${item.qty}개${equipped ? ', 착용 중' : ''}${item.dur !== undefined ? `, 내구도 ${Math.floor(item.dur)} / ${d.durability}` : ''}`}>
            <span className="invitem-top"><span className="itemicon" aria-hidden="true">{d.icon}</span><span className="count">×{item.qty}</span></span>
            <span className="name">{d.name}</span><span className="item-kind">{kindLabel(item)}</span>
            <span className="item-badges">{equipped && <span className="item-badge equipped">착용 중</span>}{slots.length > 0 && <span className="item-badge">슬롯 {slots.join(', ')}</span>}</span>
            {durability !== null && <span className={`item-condition ${durability <= 25 ? 'low' : ''}`}><span>{item.dur === 0 ? '파손됨' : '내구도'} <b>{Math.floor(item.dur!)} / {d.durability}</b></span><Progress value={durability} aria-label={`${d.name} 내구도`} /></span>}
            {item.charge !== undefined && <span className="item-charge">남은 충전 <b>{item.charge} / 5</b></span>}
        </button>;
    })}{!items.length && <div className="inventory-empty"><strong>보관 중인 아이템이 없습니다.</strong><p>{items === state.player.items ? '주변의 가지와 작은 돌을 E로 주워 보세요.' : '이 보관 공간은 비어 있습니다.'}</p></div>}</div>;
}

export function InventoryView({ state, item, onSelect, onBind, onUse, onRepair, onDiscard }: { state: State; item?: Stack; onSelect: (item: Stack) => void; onBind: (uid: string) => void; onUse: (uid: string) => void; onRepair: (uid: string) => void; onDiscard?: (uid: string) => void }) {
    const p = state.player, max = capacity(state), armor = p.items.find(i => i.uid === p.armor), held = selected(state);
    const defense = armor && armor.dur !== 0 ? ITEMS[armor.id].armor || 0 : 0;
    return <>
        <div className="inventory-summary">
            <div><span>사용 중인 배낭 칸</span><strong>{p.items.length} <small>/ {max}</small></strong><p>{p.items.length > max ? '가방 용량 초과 · 소지품을 정리하면 새 칸을 사용할 수 있습니다.' : `${max - p.items.length}칸 남음 · 같은 아이템은 묶음으로 보관`}</p></div>
            <div><span>착용한 방어구</span><strong className="summary-name">{armor ? ITEMS[armor.id].name : '착용 없음'}</strong><p>{armor?.dur === 0 ? '파손됨 · 방어 효과 없음' : `방어력 ${defense}`}</p></div>
            <div><span>선택한 퀵슬롯 · {p.selected + 1}번</span><strong className="summary-name">{held ? ITEMS[held.id].name : '빈 슬롯 / 맨손'}</strong><p>등록한 아이템은 이 슬롯에 들어갑니다.</p></div>
        </div>
        <div className="inventory-layout"><section className="inventory-list" aria-label="배낭 소지품"><div className="inventory-list-head"><h3>소지품</h3><span>아이템을 선택해 상세 정보 확인</span></div><StackGrid items={p.items} state={state} selectedUid={item?.uid} onSelect={onSelect} /></section>
        <aside className="item-details" aria-label="선택한 아이템 정보">{item ? <ItemDetails state={state} item={item} onBind={onBind} onUse={onUse} onRepair={onRepair} onDiscard={onDiscard} /> : <div className="details-empty"><span aria-hidden="true">◇</span><h3>아이템 상세 정보</h3><p>아이템을 선택하면 능력치와 사용할 수 있는 동작이 표시됩니다.</p></div>}</aside></div>
        <p className="inventory-footnote"><kbd>1–8</kbd> 퀵슬롯 선택 <span>·</span> <kbd>Tab</kbd> 포커스 이동 <span>·</span> <kbd>Esc</kbd> 배낭 닫기</p>
    </>;
}

function ItemDetails({ state, item, onBind, onUse, onRepair, onDiscard }: { state: State; item: Stack; onBind: (uid: string) => void; onUse: (uid: string) => void; onRepair: (uid: string) => void; onDiscard?: (uid: string) => void }) {
    const d = ITEMS[item.id], p = state.player, equipped = p.armor === item.uid, bound = p.hotbar[p.selected] === item.uid;
    const consumable = d.kind === 'food' || d.kind === 'potion';
    const creative = isCreative(state);
    const wait = consumable && !creative ? Math.max(0, (d.kind === 'food' ? 2 - (state.time - p.foodAt) : 15 - (state.time - p.potionAt)), item.id === 'bandage' ? 5 - (state.time - p.hitAt) : 0) : 0;
    const stats: [string, string][] = [['보유 수량', `${item.qty}개`], ['한 칸 최대 수량', `${d.max}개`]];
    if (d.damage !== undefined) stats.push(['기본 공격력', number(d.damage)]);
    if (d.interval !== undefined) stats.push(['공격 간격', `${number(d.interval)}초`]);
    if (d.range !== undefined) stats.push(['근접 사거리', `${number(d.range)}m`]);
    if (d.tool && d.level) stats.push(['채집 도구 단계', `${d.level}단계 · ${d.tool === 'axe' ? '벌목' : '채광'}`]);
    if (d.armor !== undefined) stats.push(['방어력', number(d.armor)]);
    if (d.food !== undefined) stats.push(['허기 회복', `+${d.food}`]);
    if (d.heal !== undefined) stats.push([d.heal < 0 ? '사용 시 피해' : '체력 회복', `${d.heal < 0 ? '' : '+'}${Math.abs(d.heal)}`]);
    if (item.charge !== undefined) stats.push(['남은 충전', creative ? '∞ · 마력석 소모 없음' : `${item.charge} / 5회`]);
    if (item.id === 'bag') stats.push(['배낭 공간', '32칸 · 휴대 시 적용']);
    return <>
        <div className="item-detail-heading"><span className="item-detail-icon" aria-hidden="true">{d.icon}</span><div><span className="item-kind">{kindLabel(item)}</span><h3>{d.name}</h3>{equipped && <span className="item-badge equipped">착용 중</span>}</div></div>
        <p className="item-description">{itemDescription(item)}</p>
        {creative && <p className="creative-item-note">크리에이티브 · 사용 수량·탄약·내구도가 소모되지 않으며, 수리 재료가 필요 없습니다.</p>}
        <dl className="item-stats">{stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {item.dur !== undefined && <div className={`detail-durability ${item.dur / (d.durability || 1) <= .25 ? 'low' : ''}`}><div><span>내구도{item.dur === 0 ? ' · 파손됨' : ''}</span><strong>{Math.floor(item.dur)} / {d.durability}</strong></div><Progress value={Math.max(0, Math.min(100, item.dur / (d.durability || 1) * 100))} aria-label="선택한 아이템 내구도" />{item.dur === 0 && <p>수리 후 다시 사용할 수 있습니다.</p>}</div>}
        <div className="item-actions">{item.id !== 'bag' && <button className="btn primary wide" disabled={d.kind === 'armor' ? equipped : bound} onClick={() => onBind(item.uid)}>{d.kind === 'armor' ? equipped ? '착용 중' : '방어구 착용' : bound ? `${p.selected + 1}번 퀵슬롯에 등록됨` : `${p.selected + 1}번 퀵슬롯에 등록`}</button>}
        {consumable && <button className="btn wide" disabled={wait > 0} onClick={() => onUse(item.uid)}>{wait > 0 ? `사용 대기 · ${Math.ceil(wait)}초` : d.kind === 'food' ? '1개 먹기' : '1개 사용하기'}</button>}
        {wait > 0 && <p className="action-note">게임 시간이 멈춰 있어 대기 시간도 멈춥니다. 계속하기 후 다시 사용하세요.</p>}
        {item.dur !== undefined && <><button className="btn wide" disabled={item.dur >= (d.durability || 0)} onClick={() => onRepair(item.uid)}>{item.dur >= (d.durability || 0) ? '내구도 최대' : creative ? '완전히 수리하기' : `수리 · 내구도 +${number(Math.min((d.durability || 0) - item.dur, Math.ceil((d.durability || 0) * .25)))}`}</button><p className="action-note">{creative ? '시설과 재료 없이 완전히 수리할 수 있습니다.' : `가까운 ${(d.level || 0) > 1 ? '모루' : '제작대'}와 수리 재료가 필요합니다.`}</p></>}
        {d.kind === 'potion' && wait === 0 && !creative && <p className="action-note">물약 / 붕대의 공통 재사용 대기: 15초</p>}
        {creative && onDiscard && <button className="btn danger wide" onClick={() => onDiscard(item.uid)}>소지품에서 삭제</button>}
        </div>
    </>;
}
