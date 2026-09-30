import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as THREE from 'three';
import { creaturePose, damp, handPose, MotionSample, type CreatureProfile, type HandAction } from '../lib/game/animation';
import { createCreatureRig, poseCreature, type MeshFactory } from '../lib/game/rig';
import { EffectPool } from '../lib/game/effects';
import { Engine } from '../lib/game/engine';
import { MONSTERS, NODES } from '../lib/game/data';
import { addItem, count, createWorld, makeEnemy } from '../lib/game/model';
import { SaveManager, pack, unpack } from '../lib/game/storage';
import type { VisualEvent } from '../lib/game/visual-events';
const profiles: CreatureProfile[] = ['humanoid', 'quadruped', 'bird', 'spider', 'slime'];
function fixture() {
    const s = createWorld('animation', 'animation');
    s.nodes = [];
    s.enemies = [];
    s.buildings = [];
    const storage = new SaveManager();
    storage.save = async () => Date.now();
    const engine = new Engine(s, storage), events: VisualEvent[] = [];
    engine.onVisual = event => events.push(event);
    return { s, engine, events };
}
describe('renderer animation', () => {
    it('smoothing freezes while paused and composes across frame rates', () => {
        assert.equal(damp(2, 8, 12, 0), 2);
        assert.equal(damp(2, 8, 12, -1), 2);
        let value = 2;
        for (let i = 0; i < 60; i++)
            value = damp(value, 8, 12, 1 / 60);
        assert.ok(Math.abs(value - damp(2, 8, 12, 1)) < 1e-12);
    });
    it('movement uses simulation samples and does not animate a teleport as running', () => {
        const sparse = new MotionSample(0, 0, 0), frequent = new MotionSample(0, 0, 0);
        for (let tick = 1; tick <= 30; tick++) {
            sparse.update(0, -tick / 10, tick / 30);
            for (let frame = 0; frame < 4; frame++)
                frequent.update(0, -tick / 10, tick / 30);
            assert.equal(sparse.speed, frequent.speed);
            assert.ok(Math.abs(sparse.heading) < 1e-12);
        }
        frequent.update(0, -3, 2);
        assert.equal(frequent.speed, 0);
        frequent.update(100, 100, 3);
        assert.equal(frequent.speed, 0);
        frequent.update(0, 0, 2);
        assert.equal(frequent.x, 100);
    });
    it('limbs alternate, wings flap and slime stretching preserves volume', () => {
        for (const profile of profiles) {
            const idle = creaturePose(profile, .13, 0, 'chase', 0), walk = creaturePose(profile, .13, 3, 'chase', 0);
            assert.ok(idle.limbs.every(v => v === 0));
            assert.notEqual(walk.limbs[0], 0);
            assert.equal(walk.limbs[0], -walk.limbs[1]);
            assert.equal(walk.limbs[0], walk.limbs[3]);
        }
        assert.notEqual(creaturePose('bird', .1, 2, 'chase', 0).wings, creaturePose('bird', .2, 2, 'chase', 0).wings);
        for (let time = 0; time < 3; time += .05) {
            const pose = creaturePose('slime', time, 6, 'chase', 0);
            assert.ok(Math.abs(pose.stretch * pose.wide ** 2 - 1) < 1e-12);
        }
    });
    it('attack preparation, strike and death remain distinct and bounded', () => {
        const ready = creaturePose('humanoid', 0, 0, 'windup', 1), strike = creaturePose('humanoid', 0, 0, 'recover', 0);
        assert.ok(ready.arm > 0 && ready.bodyPitch > 0);
        assert.ok(strike.arm < 0 && strike.bodyPitch < 0);
        assert.equal(creaturePose('humanoid', 0, 0, 'recover', 1).arm, 0);
        for (const profile of profiles) {
            const pose = creaturePose(profile, 100, 100, 'windup', 3, 2, 2);
            assert.ok(Object.values(pose).flat().every(Number.isFinite));
            assert.ok(Math.abs(pose.shrink - .45) < 1e-12);
            assert.ok(Math.abs(pose.wings) < 1e-12);
        }
    });
    it('hand actions return to rest, with bounded bow pull and shield/fishing offsets', () => {
        const actions: HandAction[] = ['melee', 'gather', 'bow', 'staff', 'consume', 'place'];
        for (const action of actions) {
            const active = handPose(action, .15, 0, 0, 0, false), rest = handPose(action, 10, 0, 0, 0, false);
            assert.ok(Object.values(active).some(v => Math.abs(v) > .01));
            assert.ok(Object.values(rest).every(v => Math.abs(v) < 1e-12));
        }
        assert.equal(handPose('bow', 0, 0, 0, 0, false).bowPull, .12);
        assert.equal(handPose('bow', 10, 0, 0, 0, false).bowPull, 0);
        assert.ok(handPose('melee', 10, 0, 0, 1, false).y < 0);
        assert.ok(handPose('melee', 10, 0, 0, 0, true).pitch < 0);
    });
    it('every creature has valid joint transforms and bosses retain their size', () => {
        const geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
        const mesh: MeshFactory = (parent, _shape, _color, x, y, z, sx, sy, sz) => {
            const object = new THREE.Mesh(geometry, material);
            object.position.set(x, y, z);
            object.scale.set(sx, sy, sz);
            parent.add(object);
            return object;
        };
        const before = Array.from(geometry.attributes.position.array);
        for (const [kind, def] of Object.entries(MONSTERS)) {
            const rig = createCreatureRig(kind, mesh);
            if (def.boss)
                assert.ok(rig.baseScale >= 2);
            if (kind === 'spider')
                assert.equal(rig.limbs.length, 8);
            if (kind === 'bird')
                assert.equal(rig.wings.length, 2);
            for (const state of ['chase', 'windup', 'recover'] as const) {
                poseCreature(rig, creaturePose(rig.profile, .17, def.speed, state, .5, .3));
                rig.root.updateMatrixWorld(true);
                rig.root.traverse(object => assert.ok(object.matrixWorld.elements.every(Number.isFinite)));
                assert.equal(rig.root.scale.x, rig.baseScale);
            }
        }
        assert.deepEqual(Array.from(geometry.attributes.position.array), before);
        geometry.dispose();
        material.dispose();
    });
    it('particle capacity is bounded, pausing freezes it, and resources are released', () => {
        const effects = new EffectPool(12), before = new THREE.Matrix4(), after = new THREE.Matrix4();
        effects.emit(1, 2, 3, 0xffaa55, 50);
        effects.step(0);
        assert.equal(effects.mesh.count, 12);
        effects.mesh.getMatrixAt(0, before);
        effects.step(0);
        effects.mesh.getMatrixAt(0, after);
        assert.deepEqual(before.elements, after.elements);
        effects.step(.1);
        effects.mesh.getMatrixAt(0, after);
        assert.notDeepEqual(before.elements, after.elements);
        assert.ok(after.elements.every(Number.isFinite));
        effects.step(1);
        assert.equal(effects.mesh.count, 0);
        let disposed = 0;
        effects.geometry.addEventListener('dispose', () => disposed++);
        effects.material.addEventListener('dispose', () => disposed++);
        effects.emit(0, 0, 0, 0xffffff);
        effects.dispose();
        assert.equal(disposed, 2);
        assert.equal(effects.mesh.count, 0);
    });
});
describe('visual events and game transactions', () => {
    it('successful gathering emits once and cooldown retries have no visual reward', () => {
        const { s, engine, events } = fixture(), node = { id: crypto.randomUUID(), kind: 'branch', x: 0, z: 7, hp: 1, depleted: false, readyAt: 0 };
        s.nodes.push(node);
        engine.target = { kind: 'node', id: node.id, distance: 1 };
        engine.gather();
        engine.gather();
        assert.deepEqual(events.map(e => e.type), ['action', 'gather']);
        assert.equal(count(s.player.items, 'wood'), NODES.branch.qty);
        assert.equal(node.depleted, true);
        engine.dispose();
    });
    it('an unavailable tool or full inventory does not animate a successful gathering hit', () => {
        for (const kind of ['iron', 'branch']) {
            const { s, engine, events } = fixture(), node = { id: crypto.randomUUID(), kind, x: 0, z: 7, hp: NODES[kind].hp, depleted: false, readyAt: 0 };
            if (kind === 'branch')
                for (let i = 0; i < 24; i++)
                    addItem(s, 'stone_axe', 1);
            s.nodes.push(node);
            engine.target = { kind: 'node', id: node.id, distance: 1 };
            engine.gather();
            assert.equal(events.length, 0);
            assert.equal(node.hp, NODES[kind].hp);
            engine.dispose();
        }
    });
    it('bow and staff animate only after ammunition or charge is accepted', () => {
        for (const id of ['bow', 'fire_staff']) {
            const { s, engine, events } = fixture();
            addItem(s, id, 1);
            const held = s.player.items[0];
            s.player.hotbar[0] = held.uid;
            engine.attack();
            assert.equal(events.length, 0);
            assert.equal(s.projectiles.length, 0);
            s.time = 2;
            addItem(s, id === 'bow' ? 'arrow' : 'magic_stone', 1);
            engine.attack();
            assert.deepEqual(events, [{ type: 'action', action: id === 'bow' ? 'bow' : 'staff', item: id }]);
            assert.equal(s.projectiles.length, 1);
            engine.dispose();
        }
    });
    it('positive hits emit impact feedback and lethal retries do not duplicate death', () => {
        const { s, engine, events } = fixture(), enemy = makeEnemy(s, 'zombie', 1, 0, 10);
        s.enemies.push(enemy);
        engine.hitEnemy(enemy, 0, 'hand');
        assert.equal(events.length, 0);
        engine.hitEnemy(enemy, 1, 'hand');
        engine.hitEnemy(enemy, 1000, 'hand');
        engine.hitEnemy(enemy, 1000, 'hand');
        assert.deepEqual(events.map(e => e.type === 'enemy-hit' && e.dead), [false, true]);
        assert.equal(s.enemies.length, 0);
        assert.equal(s.drops.length, 1);
        engine.dispose();
    });
    it('consumption and placement animate accepted commands without cooldown duplicates', () => {
        const { s, engine, events } = fixture();
        addItem(s, 'berry', 2);
        const berry = s.player.items[0];
        engine.useItem(berry.uid);
        engine.useItem(berry.uid);
        assert.equal(count(s.player.items, 'berry'), 1);
        addItem(s, 'workbench', 1);
        const bench = s.player.items.find(i => i.id === 'workbench')!;
        engine.place(bench);
        engine.place(bench);
        assert.deepEqual(events, [{ type: 'action', action: 'consume', item: 'berry' }, { type: 'action', action: 'place', item: 'workbench' }]);
        assert.equal(s.buildings.length, 1);
        assert.equal(count(s.player.items, 'workbench'), 0);
        engine.dispose();
    });
    it('renderer callback failures cannot interrupt damage, gathering or placement', () => {
        const { s, engine } = fixture();
        engine.onVisual = () => {
            throw new Error('renderer unavailable');
        };
        const node = { id: crypto.randomUUID(), kind: 'branch', x: 0, z: 7, hp: 1, depleted: false, readyAt: 0 };
        s.nodes.push(node);
        engine.target = { kind: 'node', id: node.id, distance: 1 };
        assert.doesNotThrow(() => engine.gather());
        assert.equal(count(s.player.items, 'wood'), 2);
        const enemy = makeEnemy(s, 'zombie', 1, 0, 10);
        s.enemies.push(enemy);
        assert.doesNotThrow(() => engine.hitEnemy(enemy, 1000, 'hand'));
        assert.equal(s.drops.length, 1);
        s.nodes = [];
        addItem(s, 'workbench', 1);
        assert.doesNotThrow(() => engine.place(s.player.items.find(i => i.id === 'workbench')!));
        assert.equal(s.buildings.length, 1);
        assert.equal(count(s.player.items, 'workbench'), 0);
        engine.dispose();
    });
    it('animation callbacks and particles do not enter saves or consume seeded world randomness', async () => {
        const { s, engine, events } = fixture(), rng = s.rng;
        engine.attack();
        assert.equal(events.length, 1);
        const effects = new EffectPool();
        effects.emit(0, 0, 0, 0xffffff);
        effects.step(.1);
        const envelope = await pack(s), loaded = await unpack(envelope);
        assert.deepEqual(loaded, s);
        assert.equal(s.rng, rng);
        assert.equal('onVisual' in envelope.state, false);
        assert.equal('visualTime' in envelope.state, false);
        effects.dispose();
        engine.dispose();
        engine.visual({ type: 'action', action: 'melee', item: 'hand' });
        assert.equal(events.length, 1);
    });
});
