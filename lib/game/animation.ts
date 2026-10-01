export type CreatureProfile = 'humanoid' | 'quadruped' | 'bird' | 'spider' | 'slime';
export type HandAction = 'melee' | 'gather' | 'bow' | 'staff' | 'consume' | 'place';
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const damp = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * Math.max(0, dt)));
/** All animation inputs are renderer-owned; no world data is mutated. */
export function creaturePose(profile: CreatureProfile, time: number, speed: number, state: 'chase' | 'windup' | 'recover', progress: number, hit = 0, dead = 0) {
    const moving = clamp01(speed / 2), stride = time * (profile === 'spider' ? 13 : profile === 'quadruped' ? 11 : 8);
    const cycle = Math.sin(stride), breathe = Math.sin(time * 2.5) * .018;
    const windup = state === 'windup' ? clamp01(progress) : 0;
    const strike = state === 'recover' ? Math.pow(1 - clamp01(progress), 2) : 0;
    const impact = clamp01(hit), collapse = clamp01(dead);
    const stretch = profile === 'slime' ? 1 + Math.sin(time * 6) * (.035 + moving * .17) : 1;
    return {
        bob: breathe + (profile === 'slime' ? Math.max(0, cycle) * moving * .2 : Math.abs(cycle) * moving * .035),
        bodyPitch: windup * .14 - strike * .28 + impact * .18 - collapse * 1.25,
        bodyRoll: cycle * moving * .035 + impact * .12,
        headPitch: windup * .12 - strike * .15,
        limbs: [cycle, -cycle, -cycle, cycle].map(v => v * moving * .5),
        arm: windup * 1.4 - strike * 1.15,
        wings: (Math.sin(time * 15) * (.12 + moving * .58) + .25) * (1 - collapse),
        stretch,
        wide: 1 / Math.sqrt(stretch),
        sink: collapse * .35,
        shrink: 1 - collapse * .55,
    };
}
export function handPose(action: HandAction, elapsed: number, time: number, speed: number, guarding: number, fishing: boolean) {
    const duration = action === 'consume' ? .65 : action === 'place' ? .4 : .38;
    const t = clamp01(elapsed / duration), pulse = Math.sin(Math.PI * t), moving = clamp01(speed / 6.5);
    const bob = Math.sin(time * 10) * .018 * moving;
    const result = { x: Math.sin(time * 5) * .014 * moving, y: bob, z: 0, pitch: 0, yaw: 0, roll: 0, bowPull: 0 };
    if (action === 'melee' || action === 'gather') {
        result.x -= pulse * .18;
        result.y -= pulse * .04;
        result.pitch = -pulse * (action === 'gather' ? .9 : .72);
        result.yaw = pulse * .4;
        result.roll = pulse * .35;
        result.z = -pulse * .1;
    }
    else if (action === 'bow') {
        result.z = pulse * .12;
        result.pitch = -pulse * .1;
        result.bowPull = (1 - t) * .12;
    }
    else if (action === 'staff') {
        result.z = -pulse * .14;
        result.pitch = pulse * .18;
    }
    else if (action === 'consume') {
        result.x -= pulse * .16;
        result.y += pulse * .24;
        result.z += pulse * .25;
        result.roll = -pulse * .42;
    }
    else {
        result.z = -pulse * .2;
        result.pitch = pulse * .15;
    }
    result.y -= guarding * .08;
    if (fishing) {
        result.y += Math.sin(time * 3) * .015;
        result.pitch -= .1;
    }
    return result;
}
/** Motion estimates are based on simulation samples, not rendering frequency. */
export class MotionSample {
    speed = 0;
    heading = 0;
    constructor(public x: number, public z: number, public time: number) {
    }
    update(x: number, z: number, time: number) {
        if (time < this.time) {
            this.x = x; this.z = z; this.time = time; this.speed = 0;
            return;
        }
        if (time === this.time)
            return;
        const dx = x - this.x, dz = z - this.z, distance = Math.hypot(dx, dz);
        this.speed = distance > 8 ? 0 : Math.min(12, distance / (time - this.time));
        if (distance > .0001 && distance <= 8)
            this.heading = Math.atan2(-dx, -dz);
        this.x = x;
        this.z = z;
        this.time = time;
    }
}
