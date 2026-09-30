import * as THREE from 'three';
import { ITEMS } from './data';
import type { handPose } from './animation';
import type { MeshFactory } from './rig';

/** Models use a local wrist origin so swings rotate around the hand, not the camera. */
export function createViewModel(id: string, mesh: MeshFactory) {
    const group = new THREE.Group(); group.name = `held-${id}`;
    if (id === 'hand') {
        mesh(group, 'box', 0xbd9376, 0, .03, -.02, .23, .25, .24);
        mesh(group, 'box', 0xb78b6f, 0, -.17, .01, .23, .18, .24);
        mesh(group, 'box', 0x466454, 0, -.43, .04, .25, .37, .26);
    } else if (id.includes('bow')) {
        const upper = mesh(group, 'cylinder', 0x816340, 0, .23, -.03, .035, .48, .035); upper.rotation.x = -.28;
        const lower = mesh(group, 'cylinder', 0x816340, 0, -.19, -.03, .035, .48, .035); lower.rotation.x = .28;
        const string = new THREE.Group(); string.name = 'bow-string'; string.position.set(0, .02, -.096);
        for (const side of [1, -1]) mesh(string, 'cylinder', 0xcfc5a8, 0, side * .218, 0, .009, .436, .009);
        group.add(string);
    } else if (id === 'fishing_rod') {
        mesh(group, 'cylinder', 0x967147, 0, .27, 0, .025, 1.25, .025);
        const line = mesh(group, 'cylinder', 0xc7d4d1, 0, .17, -.29, .006, .9, .006); line.rotation.x = .5;
    } else if (id.includes('staff')) {
        mesh(group, 'cylinder', 0x796444, 0, .16, 0, .04, .9, .04);
        mesh(group, 'rock', id.startsWith('fire') ? 0xdd9b62 : 0x9eced2, 0, .66, 0, .14, .16, .14);
    } else if (id === 'torch') {
        mesh(group, 'cylinder', 0x94734d, 0, .08, 0, .05, .55, .05);
        mesh(group, 'rock', 0xffbf64, 0, .41, 0, .1, .16, .1);
    } else if (ITEMS[id].kind === 'weapon' || ITEMS[id].tool) {
        mesh(group, 'cylinder', 0x9a7754, 0, .02, 0, .04, .6, .04);
        if (id.includes('axe')) mesh(group, 'box', 0xa1ada6, .055, .34, -.02, .35, .2, .08);
        else if (id.includes('pick')) mesh(group, 'box', 0xa1ada6, 0, .34, -.02, .55, .1, .08);
        else mesh(group, 'box', 0xbac7c2, 0, .43, 0, .1, .64, .06);
    } else {
        mesh(group, ITEMS[id].kind === 'building' ? 'box' : 'rock', 0xd0b47a, 0, .07, 0, .25, .25, .25);
    }
    return group;
}

export function viewModelTransform(id: string, aspect: number, fov: number, pose: ReturnType<typeof handPose>) {
    const bare = id === 'hand', bow = id.includes('bow'), depth = bare ? .86 : .94;
    const halfHeight = Math.tan(fov * Math.PI / 360) * depth;
    return { x: halfHeight * aspect * (bare ? .61 : .58) + pose.x,
        y: -halfHeight * (bare ? .58 : .82) + pose.y, z: -depth + pose.z,
        pitch: (bare ? -.22 : .05) + pose.pitch, yaw: (bare ? -.28 : -.15) + pose.yaw,
        roll: (bow ? -.12 : bare ? .32 : .3) + pose.roll };
}
