import { MONSTERS } from './data';
import type { Enemy, State } from './model';

export const LOST_TARGET_SECONDS = 3;
export const PURSUIT_MARGIN = 12;

/** Night waves must still notice the player at their existing 25–45m spawn distance. */
export function detectionRadius(e: Enemy) {
    const def = MONSTERS[e.kind];
    if (e.animal) return 0;
    return !def.boss && !e.region && e.night > 0 && !e.summon && e.owner !== 'challenge'
        ? Math.max(46, def.detectRadius) : def.detectRadius;
}

export function alertEnemy(e: Enemy) {
    if (!e.animal) { e.alerted = true; e.lostFor = 0; }
}

/** Legacy enemies were already tracking the player; preserve their attack phase on load. */
export function ensureAwareness(s: State) {
    for (const e of [...s.enemies, ...s.nightPlan]) {
        e.alerted ??= !e.animal;
        e.lostFor ??= 0;
    }
}

/** Horizontal distance, with a wider pursuit boundary and a short escape grace period. */
export function updateAwareness(e: Enemy, distance: number, dt: number) {
    if (e.animal) return false;
    const radius = detectionRadius(e);
    if (!e.alerted && distance <= radius) alertEnemy(e);
    if (e.alerted) {
        e.lostFor = distance <= radius + PURSUIT_MARGIN ? 0 : Math.min(LOST_TARGET_SECONDS, (e.lostFor || 0) + dt);
        if (e.lostFor >= LOST_TARGET_SECONDS - 1e-8) {
            e.alerted = false; e.lostFor = 0;
        }
    }
    if (!e.alerted) { e.state = 'chase'; e.timer = 0; }
    return !!e.alerted;
}
