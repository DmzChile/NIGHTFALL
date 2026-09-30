import * as THREE from 'three';
import { MONSTERS } from './data';
import { creaturePose, type CreatureProfile } from './animation';
export type MeshFactory = (g: THREE.Group, shape: string, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) => THREE.Mesh;
export type CreatureRig = {
    root: THREE.Group;
    body: THREE.Group;
    head: THREE.Group;
    limbs: THREE.Group[];
    arms: THREE.Group[];
    wings: THREE.Group[];
    profile: CreatureProfile;
    baseScale: number;
    bodyY: number;
};
export function createCreatureRig(kind: string, mesh: MeshFactory): CreatureRig {
    const def = MONSTERS[kind], root = new THREE.Group(), body = new THREE.Group(), head = new THREE.Group();
    root.name = kind;
    body.name = 'body';
    head.name = 'head';
    root.add(body);
    body.add(head);
    const profile: CreatureProfile = kind === 'bird' ? 'bird' : kind === 'slime' ? 'slime' : kind === 'spider' ? 'spider' : ['wolf', 'cow', 'sheep', 'forest_boss'].includes(kind) ? 'quadruped' : 'humanoid';
    const rig: CreatureRig = { root, body, head, limbs: [], arms: [], wings: [], profile, baseScale: 1, bodyY: 0 };
    const joint = (parent: THREE.Group, name: string, x: number, y: number, z: number) => {
        const group = new THREE.Group();
        group.name = name;
        group.position.set(x, y, z);
        parent.add(group);
        return group;
    };
    if (profile === 'slime') {
        body.position.y = .55;
        mesh(body, 'rock', def.color, 0, 0, 0, .9, .65, .9);
        head.position.set(0, .05, -.58);
        for (const x of [-.2, .2])
            mesh(head, 'box', 0x28392d, x, 0, 0, .12, .12, .04);
    }
    else if (profile === 'quadruped') {
        body.position.y = .85;
        mesh(body, 'box', def.color, 0, 0, 0, .85, .75, 1.6);
        head.position.set(0, .32, -.8);
        mesh(head, 'box', kind === 'sheep' ? 0x6a685a : def.color, 0, 0, 0, .5, .5, .6);
        for (const x of [-.28, .28])
            for (const z of [-.55, .55]) {
                const limb = joint(root, 'leg', x, .67, z);
                mesh(limb, 'box', 0x4d4b42, 0, -.32, 0, .14, .65, .14);
                rig.limbs.push(limb);
            }
        for (const x of [-.18, .18])
            mesh(head, 'cone', def.color, x, .35, 0, .15, .3, .14);
    }
    else if (profile === 'bird') {
        body.position.y = .5;
        mesh(body, 'rock', def.color, 0, 0, 0, .38, .3, .55);
        head.position.set(0, .18, -.38);
        mesh(head, 'rock', def.color, 0, 0, 0, .23, .23, .23);
        mesh(head, 'box', 0xe3b468, 0, -.03, -.23, .12, .1, .22);
        for (const side of [-1, 1]) {
            const wing = joint(body, 'wing', side * .22, .08, 0);
            mesh(wing, 'box', def.color, side * .3, 0, 0, .6, .08, .45);
            rig.wings.push(wing);
            const leg = joint(root, 'leg', side * .12, .26, 0);
            mesh(leg, 'box', 0xbb985d, 0, -.12, 0, .05, .25, .06);
            rig.limbs.push(leg);
        }
    }
    else if (profile === 'spider') {
        body.position.y = .4;
        mesh(body, 'rock', def.color, 0, 0, 0, .75, .4, .75);
        head.position.set(0, 0, -.5);
        mesh(head, 'rock', def.color, 0, 0, 0, .3, .25, .3);
        for (let i = 0; i < 8; i++) {
            const a = i * Math.PI / 4, limb = joint(root, 'leg', Math.cos(a) * .45, .3, Math.sin(a) * .45);
            limb.rotation.y = -a;
            mesh(limb, 'box', def.color, .4, -.08, 0, .85, .1, .1);
            rig.limbs.push(limb);
        }
    }
    else {
        body.position.y = 1;
        mesh(body, ['golem', 'rock_boss'].includes(kind) ? 'rock' : 'box', def.color, 0, 0, 0, .65, 1.05, .4);
        head.position.y = .9;
        mesh(head, 'box', def.color, 0, 0, 0, .5, .5, .5);
        for (const x of [-.13, .13])
            mesh(head, 'box', 0xedd3a0, x, .06, -.26, .08, .06, .025);
        for (const x of [-.21, .21]) {
            const leg = joint(root, 'leg', x, .8, 0);
            mesh(leg, 'box', 0x384946, 0, -.4, 0, .23, .8, .3);
            rig.limbs.push(leg);
        }
        for (const x of [-.52, .52]) {
            const arm = joint(body, 'arm', x, .35, 0);
            mesh(arm, 'box', def.color, 0, -.4, 0, .2, .8, .2);
            rig.arms.push(arm);
        }
        if (def.role === 'magic')
            mesh(head, 'cone', def.color, 0, .55, 0, .47, .8, .47);
        if (['golem', 'rock_boss', 'brute'].includes(kind))
            rig.baseScale = 1.3;
        if (kind === 'archer')
            mesh(rig.arms[0], 'cylinder', 0x816340, 0, -.45, -.12, .035, .85, .035);
        if (def.role === 'magic') {
            mesh(rig.arms[0], 'cylinder', 0x796444, 0, -.45, -.12, .035, 1.1, .035);
            mesh(rig.arms[0], 'rock', 0xb9a6e2, 0, .12, -.12, .12, .15, .12);
        }
    }
    if (def.boss)
        rig.baseScale *= 2;
    rig.bodyY = body.position.y;
    root.scale.setScalar(rig.baseScale);
    return rig;
}
export function poseCreature(rig: CreatureRig, pose: ReturnType<typeof creaturePose>) {
    rig.root.scale.setScalar(rig.baseScale * pose.shrink);
    rig.body.position.y = rig.bodyY + pose.bob - pose.sink;
    rig.body.rotation.set(pose.bodyPitch, 0, pose.bodyRoll);
    rig.body.scale.set(pose.wide, pose.stretch, pose.wide);
    rig.head.rotation.x = pose.headPitch;
    rig.limbs.forEach((limb, i) => {
        if (rig.profile === 'spider') {
            limb.rotation.z = pose.limbs[i % 4] * .55;
            limb.rotation.x = pose.limbs[(i + 1) % 4] * .2;
        }
        else
            limb.rotation.x = pose.limbs[i % 4];
    });
    rig.arms.forEach((arm, i) => {
        arm.rotation.x = -pose.limbs[i % 2] * .6 - pose.arm;
    });
    rig.wings.forEach((wing, i) => {
        wing.rotation.z = pose.wings * (i ? 1 : -1);
    });
}
