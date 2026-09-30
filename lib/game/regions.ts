export const REGIONS = ['초원', '숲', '습지', '바위 언덕', '화산', '유적'];
export const REGION_ENEMIES: Record<string, {
    kind: string;
    tier: number;
}[]> = {
    '숲': [{ kind: 'wolf', tier: 2 }, { kind: 'spider', tier: 3 }],
    '습지': [{ kind: 'slime', tier: 2 }, { kind: 'spider', tier: 3 }],
    '바위 언덕': [{ kind: 'golem', tier: 4 }, { kind: 'guard', tier: 3 }],
    '화산': [{ kind: 'ember', tier: 4 }, { kind: 'golem', tier: 4 }],
    '유적': [{ kind: 'guard', tier: 3 }, { kind: 'priest', tier: 6 }],
};
export function regionWarning(region: string) {
    const pool = REGION_ENEMIES[region];
    return pool ? `지역 적 Tier ${Math.min(...pool.map(e => e.tier))}~${Math.max(...pool.map(e => e.tier))}` : '시작 지역';
}
