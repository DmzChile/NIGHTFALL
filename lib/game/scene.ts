import * as THREE from 'three';
import { Engine } from './engine';
import { biome, height, createWorld, selected, type State } from './model';
import { ITEMS, NODES, MONSTERS } from './data';
export class GameScene {
    renderer: THREE.WebGLRenderer;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(72, 1, .1, 240);
    sun = new THREE.DirectionalLight(0xfff0cb, 2.4);
    ambient = new THREE.HemisphereLight(0xb3d0cc, 0x3b4d3c, 2.1);
    sunOrb: THREE.Mesh;
    moonOrb: THREE.Mesh;
    root = new THREE.Group();
    held = new THREE.Group();
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
    swing = 0;
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
        this.scene.background = new THREE.Color(0xaac3bb);
        this.scene.fog = new THREE.FogExp2(0xaac3bb, .0065);
        this.scene.add(this.ambient, this.sun, this.root, this.camera);
        this.sun.position.set(-30, 60, -20);
        const g = new THREE.PlaneGeometry(1100, 1100, 100, 100);
        g.rotateX(-Math.PI / 2);
        const p = g.attributes.position, colors = [];
        for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
            p.setY(i, r > 480 ? -2 : height(x, z));
            const color = new THREE.Color(r > 450 ? 0xaaa589 : biome(x, z) === '화산' ? 0x655b52 : biome(x, z) === '바위 언덕' ? 0x808577 : biome(x, z) === '습지' ? 0x4a6860 : biome(x, z) === '숲' ? 0x648362 : 0x82926a);
            color.multiplyScalar(.9 + .1 * Math.sin(x + z));
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
        this.sunOrb = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffdc9a }));
        this.moonOrb = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 8), new THREE.MeshBasicMaterial({ color: 0xb7d4e0 }));
        this.scene.add(this.sunOrb, this.moonOrb);
        this.camera.add(this.held);
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
        if (kind.includes('tree')) {
            this.mesh(g, 'cylinder', 0x66513c, 0, 1.5, 0, .27, 3, .27);
            this.mesh(g, 'cone', d.color, 0, 3.4, 0, 1.9, 3.1, 1.9);
            this.mesh(g, 'cone', d.color + 0x040400, 0, 4.7, 0, 1.5, 2.6, 1.5);
        }
        else if (['rock', 'iron', 'coal', 'silver', 'gold', 'mithril', 'obsidian', 'sulfur', 'crystal'].includes(kind)) {
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
        const g = new THREE.Group(), d = MONSTERS[kind];
        if (kind === 'slime') {
            this.mesh(g, 'rock', d.color, 0, .55, 0, .9, .65, .9);
        }
        else if (['wolf', 'cow', 'sheep', 'bird', 'forest_boss'].includes(kind)) {
            this.mesh(g, 'box', d.color, 0, .85, 0, .85, .75, 1.6);
            this.mesh(g, 'box', kind === 'sheep' ? 0x6a685a : d.color, 0, 1.2, -.8, .5, .5, .6);
            for (const x of [-.28, .28])
                for (const z of [-.55, .55])
                    this.mesh(g, 'box', 0x4d4b42, x, .32, z, .14, .65, .14);
            if (kind === 'bird')
                g.scale.setScalar(.38);
        }
        else if (kind === 'spider') {
            this.mesh(g, 'rock', d.color, 0, .4, 0, .75, .4, .75);
            for (let i = 0; i < 8; i++) {
                const m = this.mesh(g, 'box', d.color, Math.cos(i * Math.PI / 4), .2, Math.sin(i * Math.PI / 4), .65, .1, .12);
                m.rotation.y = -i * Math.PI / 4;
            }
        }
        else {
            const large = ['golem', 'rock_boss', 'brute'].includes(kind);
            this.mesh(g, large ? 'rock' : 'box', d.color, 0, 1, 0, .65, 1.05, .4);
            this.mesh(g, 'box', d.color, 0, 1.9, 0, .5, .5, .5);
            this.mesh(g, 'box', 0xedd3a0, -.13, 1.96, -.26, .08, .06, .025);
            this.mesh(g, 'box', 0xedd3a0, .13, 1.96, -.26, .08, .06, .025);
            for (const x of [-.21, .21])
                this.mesh(g, 'box', 0x384946, x, .4, 0, .23, .8, .3);
            for (const x of [-.55, .55])
                this.mesh(g, 'box', d.color, x, 1.05, -.12, .2, .8, .2);
            if (d.role === 'magic')
                this.mesh(g, 'cone', d.color, 0, 2.4, 0, .47, .8, .47);
            if (large)
                g.scale.setScalar(1.3);
        }
        if (d.boss)
            g.scale.multiplyScalar(2);
        return g;
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
        this.engine = engine;
        for (const g of this.objects.values())
            this.root.remove(g);
        this.objects.clear();
        if (engine) {
            engine.onAttack = () => {
                this.swing = 1;
            };
            engine.onHit = () => {
                this.flash = 1;
            };
        }
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
    sync() {
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
                g.userData = { target: { kind: type, id } };
                g.traverse(o => {
                    o.userData.target = { kind: type, id };
                });
                this.objects.set(id, g);
                this.root.add(g);
            }
            g.position.set(x, height(x, z), z);
            g.rotation.y = yaw;
            return g;
        };
        for (const n of s.nodes)
            if (!n.depleted)
                put(n.id, n.kind, n.x, n.z, 'node');
        for (const b of s.buildings) {
            const g = put(b.id, b.kind, b.x, b.z, 'building', b.yaw);
            if (g && b.kind === 'campfire')
                g.children[7]?.scale.setScalar(.9 + .15 * Math.sin(performance.now() * .008));
        }
        for (const e of s.enemies) {
            const g = put(e.id, e.kind, e.x, e.z, 'enemy', Math.atan2(e.x - s.player.x, e.z - s.player.z));
            if (g) {
                g.position.y += e.kind === 'slime' ? Math.max(0, Math.sin(s.time * 4) * .25) : 0;
                if (e.state === 'windup')
                    g.rotation.z = Math.sin(s.time * 15) * .1;
                else
                    g.rotation.z = 0;
            }
        }
        for (const d of s.drops)
            put(d.id, '', d.x, d.z, 'drop');
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
            this.ray.setFromCamera(new THREE.Vector2(), this.camera);
            this.ray.far = 18;
            const hits = this.ray.intersectObjects(this.root.children, true);
            const hit = hits.find(h => h.object.userData.target);
            this.engine.target = hit ? { ...hit.object.userData.target, distance: hit.distance } : null;
            const it = selected(s);
            const id = it?.id || 'hand';
            if (this.held.userData.id !== id) {
                this.held.clear();
                this.held.userData.id = id;
                const group = new THREE.Group();
                if (id === 'hand') {
                    this.mesh(group, 'box', 0xb78e72, .36, -.32, -.62, .18, .35, .25);
                }
                else if (id.includes('bow')) {
                    this.mesh(group, 'cylinder', 0x816340, .32, -.15, -.65, .04, .85, .04);
                }
                else if (id.includes('staff')) {
                    this.mesh(group, 'cylinder', 0x796444, .35, -.2, -.65, .04, .9, .04);
                    this.mesh(group, 'rock', id.startsWith('fire') ? 0xdd9b62 : 0x9eced2, .35, .3, -.65, .14, .16, .14);
                }
                else {
                    this.mesh(group, 'cylinder', 0x9a7754, .32, -.32, -.65, .04, .6, .04);
                    if (id.includes('axe'))
                        this.mesh(group, 'box', 0xa1ada6, .37, .01, -.67, .35, .2, .08);
                    else if (id.includes('pick'))
                        this.mesh(group, 'box', 0xa1ada6, .33, .01, -.67, .55, .1, .08);
                    else if (ITEMS[id].kind === 'weapon')
                        this.mesh(group, 'box', 0xbac7c2, .32, .2, -.65, .1, .55, .06);
                    else
                        this.mesh(group, 'rock', 0xd0b47a, .34, -.1, -.65, .18, .22, .18);
                }
                this.held.add(group);
            }
            this.held.visible = !this.engine.paused;
            this.held.rotation.x = -Math.sin(this.swing * Math.PI) * .7;
            this.held.rotation.z = Math.sin(this.swing * Math.PI) * .3;
        }
        else {
            const t = performance.now() * .000025;
            this.camera.position.set(12 + Math.sin(t) * 3, 5, 35);
            this.camera.lookAt(-5, 3, -10);
            this.held.visible = false;
        }
        const time = this.engine ? s.time % 720 : 430, daylight = time < 450 ? 1 : time < 510 ? 1 - (time - 450) / 60 * .9 : time < 690 ? .1 : .1 + (time - 690) / 30 * .9;
        const sky = new THREE.Color().lerpColors(new THREE.Color(0x10202f), new THREE.Color(time > 420 && time < 510 ? 0xc3aaa0 : 0xaac3bb), daylight);
        this.scene.background = sky;
        (this.scene.fog as THREE.FogExp2).color.copy(sky);
        this.ambient.intensity = .35 + daylight * 1.7;
        this.sun.intensity = .1 + daylight * 2.2;
        const orbit = time < 510 ? time / 510 * Math.PI : Math.PI + (time - 510) / 210 * Math.PI;
        this.sun.position.set(Math.cos(orbit) * 90, Math.sin(orbit) * 70, -50);
        this.sunOrb.position.copy(this.sun.position);
        this.moonOrb.position.set(-Math.cos(orbit) * 90, -Math.sin(orbit) * 70, -70);
        this.sunOrb.visible = daylight > .2;
        this.moonOrb.visible = daylight < .4;
        (this.scene.fog as THREE.FogExp2).density = .0055 + (1 - daylight) * .002;
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
        this.swing = Math.max(0, this.swing - dt * 3);
        this.flash = Math.max(0, this.flash - dt * 3);
        if (!this.contextLost) {
            this.sync();
            this.renderer.render(this.scene, this.camera);
        }
    };
    dispose() {
        this.disposed = true;
        cancelAnimationFrame(this.frame);
        this.events.abort();
        this.renderer.dispose();
        this.ground.geometry.dispose();
        this.water.geometry.dispose();
        for (const m of this.materials.values())
            m.dispose();
        for (const g of this.geometries.values())
            g.dispose();
        this.renderer.domElement.remove();
    }
}
