import { creaturePose, handPose, MotionSample, damp, type HandAction } from './animation';
import { createCreatureRig, poseCreature, type CreatureRig } from './rig';
import { EffectPool } from './effects';
import type { VisualEvent } from './visual-events';
import { terrainVertexHeight, terrainColor, TERRAIN_SIZE, TERRAIN_SEGMENTS } from './terrain';
import { createViewModel, viewModelTransform } from './viewmodel';
import { TreeField } from './trees';
import { SkyBackdrop } from './sky';
import { fogDensity } from './atmosphere';
import { isTree } from './woodland';
import * as THREE from 'three';
import { Engine } from './engine';
import { biome, height, createWorld, selected, type State } from './model';
import { NODES, MONSTERS } from './data';
export class GameScene {
    renderer: THREE.WebGLRenderer;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(72, 1, .1, 240);
    sun = new THREE.DirectionalLight(0xfff0cb, 2.4);
    ambient = new THREE.HemisphereLight(0xb3d0cc, 0x3b4d3c, 2.1);
    trees = new TreeField();
    sky = new SkyBackdrop();
    root = new THREE.Group();
    held = new THREE.Group();
    guard = new THREE.Group();
    effects = new EffectPool();
    rigs = new WeakMap<THREE.Group, CreatureRig>();
    ghosts: {
        rig: CreatureRig;
        age: number;
    }[] = [];
    visualTime = 0;
    handAction: HandAction = 'melee';
    actionStart = -100;
    guardBlend = 0;
    playerMotion: MotionSample | null = null;
    aimCenter = new THREE.Vector2();
    ground: THREE.Mesh;
    water: THREE.Mesh;
    objects = new Map<string, THREE.Group>();
    materials = new Map<number, THREE.MeshStandardMaterial>();
    geometries = new Map<string, THREE.BufferGeometry>();
    ray = new THREE.Raycaster();
    engine: Engine | null = null;
    preview: State;
    frame = 0;
    last = 0;
    accum = 0;
    disposed = false;
    flash = 0;
    contextLost = false;
    resize: () => void;
    events: AbortController;
    constructor(public host: HTMLDivElement, public onPause: () => void) {
        this.preview = createWorld('미리보기', 'nightfall');
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;
        this.host.appendChild(this.renderer.domElement);
        this.scene.fog = new THREE.FogExp2(0xaac3bb, .0065);
        this.scene.add(this.ambient, this.sun, this.sun.target, this.root, this.trees.root, this.camera);
        this.sun.position.set(-30, 60, -20);
        const g = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
        g.rotateX(-Math.PI / 2);
        const p = g.attributes.position, colors = [];
        for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), z = p.getZ(i);
            p.setY(i, terrainVertexHeight(x, z));
            const color = new THREE.Color(terrainColor(x, z, biome(x, z)));
            color.multiplyScalar(.94 + .05 * Math.sin(x * .4 + z * .35));
            colors.push(color.r, color.g, color.b);
        }
        g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        g.computeVertexNormals();
        this.ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
        this.scene.add(this.ground);
        this.water = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x4e8492, roughness: .3, metalness: .25 }));
        this.water.rotation.x = -Math.PI / 2;
        this.water.position.y = -1.2;
        this.scene.add(this.water);
        this.camera.add(this.held, this.guard);
        this.scene.add(this.effects.mesh);
        this.mesh(this.guard, 'box', 0x806347, 0, 0, 0, .55, .65, .1);
        this.mesh(this.guard, 'box', 0x4c463c, 0, 0, -.065, .07, .68, .04);
        this.resize = () => {
            const w = this.host.clientWidth, h = this.host.clientHeight;
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(w, h);
        };
        this.resize();
        this.events = new AbortController();
        window.addEventListener('resize', this.resize, { signal: this.events.signal });
        this.renderer.domElement.addEventListener('webglcontextlost', e => {
            e.preventDefault();
            this.contextLost = true;
            this.engine?.pause();
            this.engine?.notify('그래픽 연결이 끊겼습니다. 진행은 유지됩니다.');
            void this.engine?.save();
        }, { signal: this.events.signal });
        this.renderer.domElement.addEventListener('webglcontextrestored', () => {
            this.contextLost = false;
            this.engine?.notify('그래픽을 복구했습니다. 계속하기를 누르세요.');
        }, { signal: this.events.signal });
        this.installInput();
        this.loop(0);
    }
    material(color: number) {
        if (!this.materials.has(color))
            this.materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: .9, flatShading: true }));
        return this.materials.get(color)!;
    }
    geo(kind: string) {
        if (!this.geometries.has(kind)) {
            const g = kind === 'box' ? new THREE.BoxGeometry(1, 1, 1) : kind === 'cone' ? new THREE.ConeGeometry(1, 1, 6) : kind === 'cylinder' ? new THREE.CylinderGeometry(1, 1, 1, 7) : new THREE.IcosahedronGeometry(1, 0);
            this.geometries.set(kind, g);
        }
        return this.geometries.get(kind)!;
    }
    mesh(g: THREE.Group, shape: string, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
        const m = new THREE.Mesh(this.geo(shape), this.material(color));
        m.position.set(x, y, z);
        m.scale.set(sx, sy, sz);
        g.add(m);
        return m;
    }
    makeNode(kind: string) {
        const g = new THREE.Group(), d = NODES[kind];
        if (['rock', 'iron', 'coal', 'silver', 'gold', 'mithril', 'obsidian', 'sulfur', 'crystal'].includes(kind)) {
            this.mesh(g, 'rock', 0x7a837b, 0, .7, 0, 1.15, .9, 1);
            if (kind !== 'rock') {
                for (let i = 0; i < 4; i++) {
                    const a = i * 1.9;
                    this.mesh(g, 'rock', d.color, Math.cos(a) * .7, .8 + i * .1, Math.sin(a) * .6, .28, .35, .28);
                }
            }
        }
        else if (kind === 'branch') {
            const m = this.mesh(g, 'cylinder', 0x765b40, 0, .15, 0, .12, 1.6, .12);
            m.rotation.z = 1.5;
        }
        else if (kind === 'pebble')
            this.mesh(g, 'rock', d.color, 0, .16, 0, .35, .22, .3);
        else if (kind === 'mushroom' || kind === 'toxic') {
            for (let i = 0; i < 3; i++) {
                this.mesh(g, 'cylinder', 0xd4c2ac, i * .2, .2, 0, .07, .4, .07);
                this.mesh(g, 'cone', d.color, i * .2, .4, 0, .28, .25, .28);
            }
        }
        else if (kind === 'fiber' || kind === 'wheat' || kind === 'herb' || kind === 'antidote') {
            for (let i = 0; i < 4; i++) {
                const m = this.mesh(g, 'cone', d.color, (i - 1.5) * .2, .4, Math.sin(i) * .15, .12, .9, .12);
                m.rotation.z = (i - 1.5) * .12;
            }
        }
        else {
            this.mesh(g, 'rock', 0x517857, 0, .55, 0, .9, .65, .8);
            for (let i = 0; i < 5; i++)
                this.mesh(g, 'rock', d.color, Math.sin(i * 2) * .7, .7, Math.cos(i) * .65, .16, .16, .16);
        }
        return g;
    }
    makeEnemy(kind: string) {
        const rig = createCreatureRig(kind, this.mesh.bind(this));
        this.rigs.set(rig.root, rig);
        return rig.root;
    }
    makeBuilding(kind: string) {
        const g = new THREE.Group();
        if (kind === 'campfire') {
            for (let i = 0; i < 7; i++)
                this.mesh(g, 'rock', 0x858676, Math.cos(i) * .6, .15, Math.sin(i) * .6, .22, .15, .22);
            this.mesh(g, 'cone', 0xeaaa5f, 0, .55, 0, .35, .9, .35);
            const light = new THREE.PointLight(0xffac55, 8, 12, 2);
            light.position.y = 1;
            g.add(light);
        }
        else if (kind === 'wall' || kind === 'door') {
            this.mesh(g, 'box', 0x7d654b, 0, 1.2, 0, 2.5, 2.4, .25);
            this.mesh(g, 'box', 0x463e34, -1, 1.2, 0, .15, 2.6, .4);
            this.mesh(g, 'box', 0x463e34, 1, 1.2, 0, .15, 2.6, .4);
        }
        else if (kind === 'chest') {
            this.mesh(g, 'box', 0x9a734b, 0, .5, 0, 1.3, .9, .8);
            this.mesh(g, 'box', 0x4a4c40, 0, .52, -.41, .2, .15, .05);
        }
        else if (kind === 'furnace' || kind === 'advanced_furnace') {
            this.mesh(g, 'box', 0x697474, 0, .7, 0, 1.5, 1.4, 1.3);
            this.mesh(g, 'box', 0x292e2e, 0, .6, -.66, .8, .6, .04);
            this.mesh(g, 'box', 0xc88642, 0, .55, -.69, .45, .2, .03);
            this.mesh(g, 'cylinder', 0x5a676a, 0, 1.8, 0, .2, 1, .2);
        }
        else if (kind === 'bedroll') {
            this.mesh(g, 'box', 0x7c8e84, 0, .13, 0, 1.1, .25, 2);
            this.mesh(g, 'box', 0xb7b3a1, 0, .3, -.7, .8, .2, .4);
        }
        else if (kind === 'plot') {
            this.mesh(g, 'box', 0x695340, 0, .03, 0, 2, .1, 2);
            for (let i = 0; i < 3; i++)
                this.mesh(g, 'box', 0x42372d, (i - 1) * .65, .1, 0, .15, .08, 1.8);
        }
        else if (kind.endsWith('_totem') || kind.endsWith('_altar')) {
            this.mesh(g, 'cylinder', 0x677e76, 0, 1.1, 0, .45, 2.2, .45);
            this.mesh(g, 'rock', kind === 'heal_totem' ? 0x98d4ae : 0xb899d9, 0, 2.45, 0, .45, .55, .45);
            this.mesh(g, 'cylinder', 0x687b72, 0, .1, 0, 1.3, .2, 1.3);
            const light = new THREE.PointLight(kind === 'heal_totem' ? 0x98d4ae : 0xb899d9, 4, 10);
            light.position.y = 2.4;
            g.add(light);
        }
        else {
            this.mesh(g, 'box', 0x836948, 0, .95, 0, 1.6, .2, .9);
            for (const x of [-.6, .6])
                this.mesh(g, 'box', 0x5d5140, x, .45, 0, .16, .9, .65);
            if (kind === 'anvil')
                this.mesh(g, 'box', 0x718080, 0, 1.25, 0, .8, .4, .35);
            if (kind === 'alchemy' || kind === 'magicbench')
                this.mesh(g, 'rock', 0xa296bd, .2, 1.25, 0, .25, .35, .25);
        }
        return g;
    }
    setEngine(engine: Engine | null) {
        this.trees.clear();
        if (this.engine) {
            this.engine.onAttack = () => {
            };
            this.engine.onHit = () => {
            };
            this.engine.onVisual = () => {
            };
        }
        this.engine = engine;
        for (const g of this.objects.values())
            this.root.remove(g);
        this.objects.clear();
        for (const ghost of this.ghosts)
            this.scene.remove(ghost.rig.root);
        this.ghosts = [];
        this.effects.clear();
        this.flash = 0;
        this.visualTime = 0;
        this.actionStart = -100;
        this.guardBlend = 0;
        this.playerMotion = null;
        this.held.clear();
        delete this.held.userData.id;
        if (engine) {
            engine.onHit = () => {
                this.flash = 1;
            };
            engine.onVisual = event => this.onVisual(event);
        }
    }
    onVisual(event: VisualEvent) {
        if (event.type === 'action') {
            this.handAction = event.action;
            this.actionStart = this.visualTime;
            if (event.action === 'staff' && this.engine) {
                const p = this.engine.state.player;
                this.effects.emit(p.x - Math.sin(p.yaw), height(p.x, p.z) + p.y + 1.5, p.z - Math.cos(p.yaw), event.item === 'fire_staff' ? 0xffb36a : 0xa1deeb, 8);
            }
        }
        else if (event.type === 'gather') {
            if (isTree({ kind: event.kind })) this.trees.shake(event.id, this.visualTime);
            const g = this.objects.get(event.id);
            if (g)
                g.userData.shakeAt = this.visualTime;
            this.effects.emit(event.x, height(event.x, event.z) + .7, event.z, NODES[event.kind].color, 10);
        }
        else {
            const g = this.objects.get(event.id);
            if (g)
                g.userData.hitAt = this.visualTime;
            this.effects.emit(event.x, height(event.x, event.z) + 1, event.z, event.dead ? 0xddb474 : 0xe28e79, event.dead ? 16 : 7);
            if (event.dead && g) {
                const rig = this.rigs.get(g);
                if (rig) {
                    this.root.remove(g);
                    this.objects.delete(event.id);
                    this.scene.add(g);
                    this.ghosts.push({ rig, age: 0 });
                    if (this.ghosts.length > 12) {
                        const old = this.ghosts.shift()!;
                        this.scene.remove(old.rig.root);
                    }
                }
            }
        }
    }
    animateGhosts(dt: number) {
        for (const ghost of this.ghosts) {
            ghost.age += dt;
            poseCreature(ghost.rig, creaturePose(ghost.rig.profile, this.visualTime, 0, 'chase', 0, 0, ghost.age / .45));
        }
        this.ghosts = this.ghosts.filter(ghost => {
            if (ghost.age >= .45) {
                this.scene.remove(ghost.rig.root);
                return false;
            }
            return true;
        });
    }
    installInput() {
        const sig = { signal: this.events.signal };
        window.addEventListener('keydown', e => {
            const engine = this.engine;
            if (!engine)
                return;
            if (['Tab', 'Space', 'KeyM', 'ControlLeft'].includes(e.code) && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName))
                e.preventDefault();
            if (e.repeat)
                return;
            if (e.code === 'Tab' && !engine.paused) {
                engine.pause('inventory');
                return;
            }
            if (e.code === 'KeyM' && !engine.paused) {
                engine.pause('map');
                return;
            }
            if (e.code === 'KeyE' && !engine.paused)
                engine.interact();
            if (e.code === 'Escape' && !engine.paused)
                engine.pause();
            if (e.code.startsWith('Digit')) {
                const n = +e.code.slice(5) - 1;
                if (n >= 0 && n < 8) {
                    engine.state.player.selected = n;
                    engine.onChange();
                }
            }
            if (!engine.paused)
                engine.keys.add(e.code);
        }, sig);
        window.addEventListener('keyup', e => this.engine?.keys.delete(e.code), sig);
        window.addEventListener('blur', () => {
            this.engine?.pause();
        }, sig);
        document.addEventListener('pointerlockchange', () => {
            if (!document.pointerLockElement && !this.engine?.paused)
                this.engine?.pause();
        }, sig);
        window.addEventListener('mousemove', e => {
            const engine = this.engine;
            if (!engine || engine.paused || document.pointerLockElement !== this.renderer.domElement)
                return;
            engine.state.player.yaw -= e.movementX * .0023;
            engine.state.player.pitch = Math.max(-1.4, Math.min(1.4, engine.state.player.pitch - e.movementY * .0023));
        }, sig);
        this.renderer.domElement.addEventListener('mousedown', e => {
            if (!this.engine || this.engine.paused)
                return;
            if (e.button === 0) {
                this.engine.keys.add('MouseLeft');
                this.engine.attack();
            }
            if (e.button === 2)
                this.engine.blocking = true;
        }, sig);
        window.addEventListener('mouseup', e => {
            if (e.button === 0)
                this.engine?.keys.delete('MouseLeft');
            if (e.button === 2 && this.engine)
                this.engine.blocking = false;
        }, sig);
        this.renderer.domElement.addEventListener('contextmenu', e => e.preventDefault(), sig);
        this.renderer.domElement.addEventListener('wheel', e => {
            if (this.engine && !this.engine.paused) {
                this.engine.state.player.selected = (this.engine.state.player.selected + (e.deltaY > 0 ? 1 : 7)) % 8;
                this.engine.onChange();
            }
        }, { ...sig, passive: true });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.engine) {
                this.engine.pause();
                void this.engine.save();
            }
        }, sig);
    }
    async play() {
        if (!this.engine || this.contextLost)
            return;
        this.engine.resume();
        try {
            await this.renderer.domElement.requestPointerLock();
        }
        catch {
            this.engine.pause();
            this.engine.notify('마우스 잠금을 허용한 뒤 다시 계속하기를 누르세요.');
        }
    }
    sync(dt: number) {
        const s = this.engine?.state || this.preview, live = new Set<string>();
        const view = this.engine ? s.player : { x: 12, z: 35 };
        const put = (id: string, kind: string, x: number, z: number, type: string, yaw = 0) => {
            if (Math.hypot(x - view.x, z - view.z) > 140)
                return;
            live.add(id);
            let g = this.objects.get(id);
            if (!g) {
                g = type === 'node' ? this.makeNode(kind) : type === 'enemy' ? this.makeEnemy(kind) : type === 'building' ? this.makeBuilding(kind) : new THREE.Group();
                if (type === 'drop')
                    this.mesh(g, 'box', 0xc8ac76, 0, .25, 0, .35, .4, .35);
                if (type === 'projectile')
                    this.mesh(g, 'rock', kind.includes('arrow') ? 0xe0d9b7 : 0xb999df, 0, 0, 0, .09, .09, .3);
                g.userData.target = { kind: type, id };
                g.traverse(o => {
                    o.userData.target = { kind: type, id };
                });
                this.objects.set(id, g);
                this.root.add(g);
            }
            if (type === 'enemy' && g.userData.ready && Math.hypot(g.position.x - x, g.position.z - z) < 8) {
                g.position.x = damp(g.position.x, x, 20, dt);
                g.position.z = damp(g.position.z, z, 20, dt);
                g.position.y = height(g.position.x, g.position.z);
            }
            else
                g.position.set(x, height(x, z), z);
            g.userData.ready = true;
            if (type !== 'enemy')
                g.rotation.y = yaw;
            return g;
        };
        for (const n of s.nodes)
            if (!n.depleted && !isTree(n)) {
                const g = put(n.id, n.kind, n.x, n.z, 'node');
                if (g) {
                    const age = this.visualTime - (g.userData.shakeAt ?? -100), shake = Math.max(0, 1 - age / .22);
                    g.rotation.z = Math.sin(age * 45) * shake * .07;
                }
            }
        this.trees.update(s, view.x, view.z, this.visualTime);
        for (const b of s.buildings) {
            const g = put(b.id, b.kind, b.x, b.z, 'building', b.yaw);
            if (g && b.kind === 'campfire')
                g.children[7]?.scale.setScalar(.9 + .15 * Math.sin(this.visualTime * 8));
        }
        for (const e of s.enemies) {
            const g = put(e.id, e.kind, e.x, e.z, 'enemy');
            if (!g)
                continue;
            const motion: MotionSample = g.userData.motion ??= new MotionSample(e.x, e.z, s.time);
            motion.update(e.x, e.z, s.time);
            const rig = this.rigs.get(g)!;
            const chasing = e.state === 'chase' || e.animal;
            const facing = chasing && motion.speed > .05 ? motion.heading : e.alerted ? Math.atan2(e.x - s.player.x, e.z - s.player.z) : g.rotation.y;
            const difference = Math.atan2(Math.sin(facing - g.rotation.y), Math.cos(facing - g.rotation.y));
            g.rotation.y += damp(0, difference, 12, dt);
            const def = MONSTERS[e.kind], total = e.state === 'windup' ? (def.boss ? 1.1 : def.role === 'melee' ? .6 : .8) : (def.boss ? 1.3 : 1);
            const progress = e.animal ? 0 : 1 - e.timer / total;
            const impact = Math.max(0, 1 - (this.visualTime - (g.userData.hitAt ?? -100)) / .22);
            poseCreature(rig, creaturePose(rig.profile, this.visualTime, motion.speed, e.animal ? 'chase' : e.state, progress, impact));
        }
        for (const d of s.drops) {
            const g = put(d.id, '', d.x, d.z, 'drop');
            if (g) {
                g.rotation.y = this.visualTime * .6;
                g.position.y += .05 + Math.sin(this.visualTime * 3) * .04;
            }
        }
        for (const p of s.projectiles) {
            const g = put(p.id, p.type, p.x, p.z, 'projectile');
            if (g) {
                g.position.y = p.y;
                g.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
            }
        }
        for (const [id, g] of this.objects)
            if (!live.has(id)) {
                this.root.remove(g);
                this.objects.delete(id);
            }
        if (this.engine) {
            const p = s.player;
            this.camera.position.set(p.x, height(p.x, p.z) + 1.65 + p.y, p.z);
            this.camera.rotation.order = 'YXZ';
            this.camera.rotation.set(p.pitch, p.yaw, 0);
            this.camera.updateMatrixWorld();
            this.root.updateMatrixWorld(true);
            this.ray.setFromCamera(this.aimCenter, this.camera);
            this.ray.far = 18;
            const hits = this.ray.intersectObjects([...this.root.children, this.trees.root], true);
            this.engine.target = null;
            for (const hit of hits) {
                const target = this.trees.target(hit) || (hit.object.userData.target ? { ...hit.object.userData.target, distance: hit.distance } : null);
                if (target) { this.engine.target = target; break; }
            }
            const it = selected(s);
            const id = it?.id || 'hand';
            if (this.held.userData.id !== id) {
                this.held.clear();
                this.held.userData.id = id;
                this.held.add(createViewModel(id, (...args) => this.mesh(...args)));
            }
            this.playerMotion ??= new MotionSample(p.x, p.z, s.time);
            this.playerMotion.update(p.x, p.z, s.time);
            const twoHanded = id.includes('bow') || id.endsWith('_staff'), hasShield = p.items.some(i => i.id === 'shield' && (i.dur || 0) > 0);
            this.guardBlend = damp(this.guardBlend, this.engine.blocking && hasShield && !twoHanded && p.stamina > 0 && s.time - p.actionAt >= .25 ? 1 : 0, 14, dt);
            const pose = handPose(this.handAction, this.visualTime - this.actionStart, this.visualTime, this.playerMotion.speed, this.guardBlend, !!p.fishing);
            this.held.visible = !this.engine.paused;
            const viewPose = viewModelTransform(id, this.camera.aspect, this.camera.fov, pose);
            this.held.position.set(viewPose.x, viewPose.y, viewPose.z);
            this.held.rotation.set(viewPose.pitch, viewPose.yaw, viewPose.roll);
            const string = this.held.getObjectByName('bow-string');
            if (string) {
                string.children.forEach((segment, i) => {
                    segment.position.z = pose.bowPull / 2;
                    segment.scale.y = Math.hypot(.436, pose.bowPull);
                    segment.rotation.x = (i ? 1 : -1) * Math.atan2(pose.bowPull, .436);
                });
            }
            this.guard.visible = !this.engine.paused && hasShield && !twoHanded;
            this.guard.position.set(-Math.tan(this.camera.fov * Math.PI / 360) * .82 * this.camera.aspect * .62 + this.guardBlend * .12, -.58 + this.guardBlend * .4, -.82);
            this.guard.rotation.set(-this.guardBlend * .16, .2 + this.guardBlend * .3, this.guardBlend * .08);
        }
        else {
            const t = this.visualTime * .025;
            this.camera.position.set(12 + Math.sin(t) * 3, 5, 35);
            this.camera.lookAt(-5, 3, -10);
            this.held.visible = false;
            this.guard.visible = false;
        }
        const sky = this.sky.update(this.camera, this.engine ? s.time : 430, s.blood), daylight = sky.daylight;
        (this.scene.fog as THREE.FogExp2).color.copy(sky.color);
        this.ambient.intensity = .35 + daylight * 1.7;
        this.sun.intensity = .1 + daylight * 2.2;
        this.sun.target.position.copy(this.camera.position);
        this.sun.position.copy(this.camera.position).addScaledVector(daylight > .2 ? sky.sun : sky.moon, 90);
        (this.scene.fog as THREE.FogExp2).density = fogDensity(this.engine ? s.time : 430, daylight, biome(this.camera.position.x, this.camera.position.z), this.camera.position.y - 1.6);
    }
    loop = (stamp: number) => {
        if (this.disposed)
            return;
        this.frame = requestAnimationFrame(this.loop);
        const dt = Math.min(.25, (stamp - this.last) / 1000 || 0);
        this.last = stamp;
        this.accum += dt;
        let steps = 0;
        while (this.accum >= 1 / 30 && steps < 5) {
            this.engine?.step(1 / 30);
            this.accum -= 1 / 30;
            steps++;
        }
        if (steps === 5)
            this.accum = 0;
        this.flash = Math.max(0, this.flash - dt * 3);
        if (!this.contextLost) {
            const visualDt = this.engine?.paused ? 0 : dt;
            this.visualTime += visualDt;
            this.effects.step(visualDt);
            this.animateGhosts(visualDt);
            this.sync(visualDt);
            this.render();
        }
    };
    render() { this.sky.render(this.renderer, this.scene, this.camera); }
    dispose() {
        this.disposed = true;
        cancelAnimationFrame(this.frame);
        this.events.abort();
        this.setEngine(null);
        this.effects.dispose();
        this.trees.dispose();
        this.sky.dispose();
        this.renderer.dispose();
        this.ground.geometry.dispose();
        this.water.geometry.dispose();
        (this.ground.material as THREE.Material).dispose();
        (this.water.material as THREE.Material).dispose();
        for (const m of this.materials.values())
            m.dispose();
        for (const g of this.geometries.values())
            g.dispose();
        this.renderer.domElement.remove();
    }
}
