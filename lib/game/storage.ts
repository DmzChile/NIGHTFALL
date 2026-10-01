import { validateState, uuid, type State } from './model';
export type WorldInfo = {
    id: string;
    name: string;
    day: number;
    time: number;
    saved: number;
    generation: number;
    mode: string;
    gameMode?: State['gameMode'];
    status: string;
    seed: string;
    difficulty: string;
    owner?: string;
    lease?: number;
};
type Envelope = {
    formatVersion: 1;
    meta: {
        exportedAt: number;
    };
    state: State;
    checksum: string;
};
type RecordSave = {
    worldId: string;
    generation: number;
    saved: number;
    data: Envelope;
};
export function canonical(v: unknown): string {
    if (v === null || typeof v !== 'object')
        return JSON.stringify(v);
    if (Array.isArray(v))
        return '[' + v.map(canonical).join(',') + ']';
    return '{' + Object.entries(v as object).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, x]) => JSON.stringify(k) + ':' + canonical(x)).join(',') + '}';
}
async function digest(v: unknown) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(v)));
    return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function pack(s: State): Promise<Envelope> {
    const core = { formatVersion: 1 as const, meta: { exportedAt: Date.now() }, state: structuredClone(s) };
    return { ...core, checksum: await digest(core) };
}
export async function unpack(v: unknown): Promise<State> {
    if (!v || typeof v !== 'object')
        throw new Error('저장 파일이 잘못되었습니다.');
    const e = v as Envelope;
    if (e.formatVersion !== 1 || !e.meta || typeof e.checksum !== 'string')
        throw new Error('지원하지 않는 파일 형식입니다.');
    const actual = await digest({ formatVersion: e.formatVersion, meta: e.meta, state: e.state });
    if (actual !== e.checksum)
        throw new Error('저장 파일의 체크섬이 일치하지 않습니다.');
    return validateState(e.state);
}
const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
});
export class SaveManager {
    db: IDBDatabase | null = null;
    token = uuid();
    active: string | null = null;
    heartbeat: ReturnType<typeof setInterval> | null = null;
    lockRelease: (() => void) | null = null;
    lockLost: () => void = () => {
    };
    private session = 0;
    async open() {
        if (this.db)
            return;
        this.db = await new Promise<IDBDatabase>((resolve, reject) => {
            const r = indexedDB.open('sandbox-survival', 1);
            r.onupgradeneeded = () => {
                const db = r.result;
                const worlds = db.createObjectStore('worlds', { keyPath: 'id' });
                worlds.createIndex('saved', 'saved');
                const snapshots = db.createObjectStore('snapshots', { keyPath: ['worldId', 'generation'] });
                snapshots.createIndex('world', 'worldId');
                db.createObjectStore('chunks', { keyPath: ['worldId', 'id', 'revision'] });
                db.createObjectStore('settings', { keyPath: 'key' });
            };
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
            r.onblocked = () => reject(new Error('다른 게임 탭을 닫은 뒤 다시 시도하세요.'));
        });
        this.db.onversionchange = () => {
            this.db?.close();
            this.db = null;
            this.lockLost();
        };
    }
    transaction(stores: string[], mode: IDBTransactionMode) {
        if (!this.db)
            throw new Error('저장 공간을 열 수 없습니다.');
        try {
            return this.db.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
        }
        catch {
            return this.db.transaction(stores, mode);
        }
    }
    async list(): Promise<WorldInfo[]> {
        await this.open();
        return (await request(this.transaction(['worlds'], 'readonly').objectStore('worlds').getAll())).sort((a, b) => b.saved - a.saved);
    }
    async acquire(id: string) {
        await this.open();
        if (this.active === id)
            return;
        await this.release();
        if (typeof navigator !== 'undefined' && navigator.locks) {
            await new Promise<void>((resolve, reject) => {
                let settled = false;
                void navigator.locks.request(`nightfall-${id}`, { ifAvailable: true }, async (lock) => {
                    if (!lock) {
                        settled = true;
                        reject(new Error('이 월드는 다른 탭에서 실행 중입니다.'));
                        return;
                    }
                    settled = true;
                    this.active = id;
                    resolve();
                    await new Promise<void>(done => {
                        this.lockRelease = done;
                    });
                }).catch(e => {
                    if (!settled)
                        reject(e);
                    else
                        this.lockLost();
                });
            });
        }
        else
            this.active = id;
        try {
            await this.lease(true);
        }
        catch (e) {
            await this.release();
            throw e;
        }
        const session = this.session;
        this.heartbeat = setInterval(() => {
            this.lease(false).catch(() => { if (this.active === id && this.session === session) this.lockLost(); });
        }, 5000);
    }
    async lease(initial: boolean) {
        const id = this.active;
        if (!id)
            return;
        await new Promise<void>((resolve, reject) => {
            const tx = this.transaction(['worlds'], 'readwrite'), store = tx.objectStore('worlds'), r = store.get(id);
            let err: Error | null = null;
            r.onsuccess = () => {
                const w = r.result as WorldInfo | undefined;
                if (w?.owner && w.owner !== this.token && (w.lease || 0) > Date.now()) {
                    err = new Error('다른 탭이 월드를 사용 중입니다.');
                    tx.abort();
                    return;
                }
                if (!initial && w?.owner !== this.token) {
                    err = new Error('월드 사용 권한이 바뀌었습니다.');
                    tx.abort();
                    return;
                }
                if (w)
                    store.put({ ...w, owner: this.token, lease: Date.now() + 20000 });
            };
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(err || tx.error || new Error('월드 잠금에 실패했습니다.'));
        });
    }
    async release() {
        this.session++;
        if (this.heartbeat)
            clearInterval(this.heartbeat);
        this.heartbeat = null;
        const id = this.active;
        this.active = null;
        if (id && this.db)
            await new Promise<void>(resolve => {
                try {
                    const tx = this.transaction(['worlds'], 'readwrite'), store = tx.objectStore('worlds'), r = store.get(id);
                    r.onsuccess = () => {
                        const w = r.result;
                        if (w?.owner === this.token) {
                            delete w.owner;
                            delete w.lease;
                            store.put(w);
                        }
                    };
                    tx.oncomplete = () => resolve();
                    tx.onabort = () => resolve();
                }
                catch {
                    resolve();
                }
            });
        this.lockRelease?.();
        this.lockRelease = null;
    }
    async save(s: State) {
        if (this.active !== s.id)
            throw new Error('월드 저장 권한이 없습니다.');
        const expected = s.generation, worldId = s.id, session = this.session, copy = structuredClone(s);
        copy.generation = expected + 1;
        const envelope = await pack(copy);
        if (this.active !== worldId || this.session !== session || s.id !== worldId)
            throw new Error('월드 저장 권한이 변경되었습니다.');
        await new Promise<void>((resolve, reject) => {
            const tx = this.transaction(['worlds', 'snapshots'], 'readwrite'), worlds = tx.objectStore('worlds'), r = worlds.get(worldId);
            let err: Error | null = null;
            r.onsuccess = () => {
                const w = r.result as WorldInfo | undefined;
                if (this.active !== worldId || this.session !== session || s.id !== worldId || (!w && expected !== 0) || (w && (w.generation !== expected || w.owner !== this.token || (w.lease || 0) < Date.now()))) {
                    err = new Error('다른 탭의 저장과 충돌했습니다. 월드를 다시 여세요.');
                    tx.abort();
                    return;
                }
                const info: WorldInfo = { id: worldId, name: copy.name, day: Math.floor(copy.time / 720) + 1, time: copy.time, saved: Date.now(), generation: copy.generation, mode: copy.mode, gameMode: copy.gameMode ?? 'survival', status: copy.status, seed: copy.seed, difficulty: copy.difficulty, owner: this.token, lease: Date.now() + 20000 };
                tx.objectStore('snapshots').put({ worldId, generation: copy.generation, saved: info.saved, data: envelope });
                worlds.put(info);
            };
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(err || tx.error || new Error('저장을 완료하지 못했습니다.'));
            tx.onerror = () => {
            };
        });
        s.generation = copy.generation;
        await this.prune(worldId).catch(() => {
        });
        return Date.now();
    }
    async prune(id: string) {
        await new Promise<void>((resolve, reject) => {
            const tx = this.transaction(['snapshots'], 'readwrite'), store = tx.objectStore('snapshots'), r = store.index('world').getAll(id);
            r.onsuccess = () => {
                const values = (r.result as RecordSave[]).sort((a, b) => b.generation - a.generation);
                values.slice(3).forEach(v => store.delete([id, v.generation]));
            };
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
        });
    }
    async load(id: string) {
        await this.acquire(id);
        try {
            const info = await request(this.transaction(['worlds'], 'readonly').objectStore('worlds').get(id)) as WorldInfo | undefined;
            if (!info)
                throw new Error('월드를 찾을 수 없습니다.');
            const records = (await request(this.transaction(['snapshots'], 'readonly').objectStore('snapshots').index('world').getAll(id)) as RecordSave[]).sort((a, b) => b.generation - a.generation);
            for (const record of records) {
                try {
                    const state = await unpack(record.data);
                    if (state.id !== id || state.generation !== record.generation || record.generation > info.generation)
                        continue;
                    state.generation = info.generation;
                    return { state, recovered: record.generation !== info.generation, restoredDay: Math.floor(state.time / 720) + 1 };
                }
                catch {
                }
            }
            throw new Error('정상 저장본이 없습니다. 원본은 유지됩니다. 파일 백업을 가져오세요.');
        }
        catch (error) {
            await this.release();
            throw error;
        }
    }
    async remove(id: string) {
        if (this.active === id)
            throw new Error('실행 중인 월드는 삭제할 수 없습니다.');
        await this.open();
        await new Promise<void>((resolve, reject) => {
            const tx = this.transaction(['worlds', 'snapshots'], 'readwrite'), w = tx.objectStore('worlds'), r = w.get(id);
            let err: Error | null = null;
            r.onsuccess = () => {
                if (r.result?.owner && (r.result.lease || 0) > Date.now()) {
                    err = new Error('다른 탭에서 실행 중인 월드입니다.');
                    tx.abort();
                    return;
                }
                w.delete(id);
                const snapshots = tx.objectStore('snapshots'), q = snapshots.index('world').getAllKeys(id);
                q.onsuccess = () => q.result.forEach(k => snapshots.delete(k));
            };
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(err || tx.error);
        });
    }
    close() {
        void this.release().finally(() => {
            this.db?.close();
            this.db = null;
        });
    }
}
export async function exportFile(s: State) {
    const packed = await pack(s), blob = new Blob([JSON.stringify(packed)], { type: 'application/json' }), url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${s.name.replace(/[^\p{L}\p{N}_-]/gu, '_')}-Day${Math.floor(s.time / 720) + 1}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function importFile(file: File) {
    if (file.size > 20 * 1024 * 1024)
        throw new Error('20MiB 이하의 JSON 파일을 선택하세요.');
    const raw = JSON.parse(await file.text());
    const depth = (v: unknown, d = 0) => {
        if (d > 32)
            throw new Error('파일 구조가 너무 깊습니다.');
        if (v && typeof v === 'object')
            Object.values(v).forEach(x => depth(x, d + 1));
    };
    depth(raw);
    const s = await unpack(raw);
    const remap = new Map<string, string>();
    const id = (old: string) => {
        if (!remap.has(old))
            remap.set(old, uuid());
        return remap.get(old)!;
    };
    s.id = uuid();
    s.generation = 0;
    s.name = (s.name + ' (가져옴)').slice(0, 40);
    s.created = Date.now();
    for (const b of s.buildings)
        b.id = id(b.id);
    for (const e of [...s.enemies, ...s.nightPlan]) {
        e.id = id(e.id);
        if (e.owner && e.owner !== 'challenge')
            e.owner = id(e.owner);
    }
    for (const p of s.projectiles)
        p.id = id(p.id);
    for (const d of s.drops)
        d.id = id(d.id);
    for (const arr of [s.player.items, ...s.buildings.map(b => b.items), ...s.drops.map(d => d.items)])
        for (const it of arr)
            it.uid = id(it.uid);
    if (s.player.fishing)
        s.player.fishing.uid = id(s.player.fishing.uid);
    s.player.hotbar = s.player.hotbar.map(uid => uid ? id(uid) : null);
    if (s.player.armor)
        s.player.armor = id(s.player.armor);
    if (s.player.bed)
        s.player.bed = id(s.player.bed);
    return validateState(s);
}
