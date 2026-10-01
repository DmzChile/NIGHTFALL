"use client";
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { COMMANDS, commandSuggestions } from './commands';
import { ITEMS, type Kind } from './data';
import { capacity, type State } from './model';
import type { Engine } from './engine';

const KINDS: [Kind | 'all', string][] = [['all', '전체'], ['building', '건축 / 시설'], ['tool', '도구'], ['weapon', '무기'], ['armor', '방어구'], ['material', '제작 재료'], ['food', '음식'], ['potion', '물약']];
export function CreativeCatalog({ state, onGive }: { state: State; onGive: (id: string, qty: number) => void }) {
    const [query, setQuery] = useState(''), [kind, setKind] = useState('all'), [amount, setAmount] = useState('stack');
    const items = Object.entries(ITEMS).filter(([id, item]) => (kind === 'all' || item.kind === kind) && (id + ' ' + item.name).toLowerCase().includes(query.toLowerCase()));
    return <section className="creative-catalog" aria-label="크리에이티브 아이템 목록">
        <div className="sandbox-banner"><div><strong>크리에이티브 아이템</strong><p>모든 아이템을 가방에 추가할 수 있습니다. 시설·음식·탄약·장비는 사용할 때 소모되지 않습니다.</p></div><span className="sandbox-tag">배낭 {state.player.items.length} / {capacity(state)}칸</span></div>
        <div className="catalog-toolbar"><label>아이템 검색<input value={query} placeholder="이름 또는 ID 검색" maxLength={64} onChange={event => setQuery(event.target.value)} /></label><label>종류<select value={kind} onChange={event => setKind(event.target.value)}>{KINDS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label><label>지급 수량<select value={amount} onChange={event => setAmount(event.target.value)}><option value="stack">최대 한 묶음</option><option value="one">1개</option></select></label></div>
        <p className="catalog-count">{items.length}종 표시 · 아이템을 누르면 가방에 추가됩니다.</p>
        <div className="catalog-grid">{items.map(([id, item]) => <button className="catalog-item" key={id} onClick={() => onGive(id, amount === 'stack' ? item.max : 1)} aria-label={item.name + ' ' + (amount === 'stack' ? item.max : 1) + '개 지급'}><span className="catalog-item-top"><span className="itemicon" aria-hidden="true">{item.icon}</span><span>+{amount === 'stack' ? item.max : 1}</span></span><strong>{item.name}</strong><code>{id}</code><span className="item-kind">{KINDS.find(([value]) => value === item.kind)?.[1]}</span></button>)}</div>
        {!items.length && <p className="inventory-empty">일치하는 아이템이 없습니다. 검색어나 종류를 바꿔 보세요.</p>}
        <p className="action-note">가방이 가득 차면 소지품 탭에서 아이템을 삭제하거나 /clear 명령어로 정리하세요. F: 비행 · Space / Ctrl: 상승 / 하강 · R: 바라보는 시설이나 자원 철거</p>
    </section>;
}

export function CommandConsole({ engine }: { engine: Engine }) {
    const [input, setInput] = useState('/'), [busy, setBusy] = useState(false), [historyIndex, setHistoryIndex] = useState<number | null>(null);
    const field = useRef<HTMLInputElement>(null), output = useRef<HTMLDivElement>(null), draft = useRef('/');
    const suggestions = commandSuggestions(input);
    useEffect(() => { field.current?.focus(); }, []);
    useEffect(() => { if (output.current) output.current.scrollTop = output.current.scrollHeight; }, [engine.commandLog.length, busy]);
    function choose(value: string) {
        setInput(value); setHistoryIndex(null); draft.current = value;
        field.current?.focus();
    }
    async function submit(event: FormEvent) {
        event.preventDefault();
        if (busy || !input.trim() || input.trim() === '/') return;
        setBusy(true);
        try {
            const result = await engine.command(input);
            if (result.ok) { setInput('/'); draft.current = '/'; }
            setHistoryIndex(null);
        } finally {
            setBusy(false);
            requestAnimationFrame(() => field.current?.focus());
        }
    }
    return <div className="console-shell"><div className="console-layout"><section className="console-main" aria-label="명령어 입력과 결과">
        <p className="console-context">{engine.creative ? '크리에이티브' : '생존'} · X {engine.state.player.x.toFixed(1)} / Z {engine.state.player.z.toFixed(1)} <span>입력 중 게임 시간은 멈춥니다.</span></p>
        <div className="console-output" role="log" aria-live="polite" ref={output}>{!engine.commandLog.length && <div className="console-welcome"><strong>명령어 콘솔</strong><p>/help로 사용법을 확인하거나, 예시를 눌러 입력하세요.</p><p>변경 명령은 현재 월드에 적용됩니다. /save로 저장할 수 있습니다.</p></div>}{engine.commandLog.map((entry, index) => <div className="console-entry" key={index}><code className="console-prompt">{entry.input}</code><div className={entry.result.ok ? 'console-success' : 'console-error'}>{entry.result.lines.map((line, i) => <p key={i}>{line}</p>)}</div></div>)}</div>
        <form onSubmit={submit} className="console-form"><label className="sr-only" htmlFor="game-command">명령어</label><input id="game-command" ref={field} value={input} maxLength={256} autoComplete="off" spellCheck={false} disabled={busy} aria-describedby="command-input-help" onChange={event => { setInput(event.target.value); setHistoryIndex(null); draft.current = event.target.value; }} onKeyDown={event => {
            if (event.key === 'Tab' && suggestions.length) { event.preventDefault(); choose(suggestions[0].value); }
            if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && engine.commandHistory.length) {
                event.preventDefault();
                const next = event.key === 'ArrowUp' ? Math.max(0, (historyIndex ?? engine.commandHistory.length) - 1) : Math.min(engine.commandHistory.length, (historyIndex ?? engine.commandHistory.length) + 1);
                setHistoryIndex(next === engine.commandHistory.length ? null : next);
                setInput(next === engine.commandHistory.length ? draft.current : engine.commandHistory[next]);
            }
        }} /><button type="submit" className="btn primary" disabled={busy || input.trim() === '/' || !input.trim()}>{busy ? '실행 중…' : '실행'}</button></form>
        <p id="command-input-help" className="action-note">Enter 실행 · Tab 첫 제안 완성 · ↑ / ↓ 이전 명령 · Esc 게임으로</p>
        {suggestions.length > 0 && <div className="command-suggestions" aria-label="명령어 자동 완성">{suggestions.map(suggestion => <button key={suggestion.value} type="button" disabled={busy} onClick={() => choose(suggestion.value)}><code>{suggestion.label}</code><span>{suggestion.detail}</span></button>)}</div>}
        </section><aside className="command-guide" aria-label="명령어 사용법"><h3>명령어 사용법</h3><p>예시를 누르면 입력창에 채워집니다.</p>{COMMANDS.map(command => <button key={command.name} type="button" disabled={busy} onClick={() => choose(command.example)}><code>{command.usage}</code><span>{command.description}</span></button>)}</aside></div></div>;
}
