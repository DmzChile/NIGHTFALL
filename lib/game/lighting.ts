import * as THREE from 'three';

export type GraphicsQuality = 'low' | 'medium' | 'high';
export const GRAPHICS = {
    low: { pixelRatio: 1, shadowSize: 0, shadowExtent: 44, ripples: 0 },
    medium: { pixelRatio: 1.25, shadowSize: 1024, shadowExtent: 44, ripples: 1 },
    high: { pixelRatio: 1.5, shadowSize: 2048, shadowExtent: 64, ripples: 1 },
} as const;
const QUALITY_KEY = 'nightfall.graphics';
export function graphicsQuality(value: unknown): GraphicsQuality {
    return value === 'low' || value === 'high' ? value : 'medium';
}
export function readGraphicsQuality(): GraphicsQuality {
    try { return graphicsQuality(localStorage.getItem(QUALITY_KEY)); } catch { return 'medium'; }
}
export function saveGraphicsQuality(value: GraphicsQuality) {
    try { localStorage.setItem(QUALITY_KEY, value); } catch { /* Preferences need no write access to world saves. */ }
}

type SkySample = { sun: THREE.Vector3; moon: THREE.Vector3; daylight: number };
/** Colors and light power use solar altitude; the active lamp swaps only at zero power. */
export function lightingState(sky: SkySample, blood = false) {
    const solar = THREE.MathUtils.smoothstep(sky.sun.y, 0, .22);
    const lunar = THREE.MathUtils.smoothstep(sky.moon.y, 0, .18);
    const golden = (1 - THREE.MathUtils.smoothstep(Math.abs(sky.sun.y), .06, .42)) * THREE.MathUtils.smoothstep(sky.sun.y, -.16, .025);
    const sunlight = new THREE.Color(0xffe7be).lerp(new THREE.Color(0xffb867), golden);
    const isSun = sky.sun.y >= 0;
    return {
        direction: isSun ? sky.sun : sky.moon,
        keyColor: isSun ? sunlight : new THREE.Color(blood ? 0xe0bac0 : 0xc4d8f4),
        keyIntensity: isSun ? solar * 3.1 : lunar * .36,
        skyColor: new THREE.Color(0x526e91).lerp(new THREE.Color(0xb3d1e8), sky.daylight),
        groundColor: new THREE.Color(0x263040).lerp(new THREE.Color(0x65513c), sky.daylight),
        ambientIntensity: .28 + sky.daylight * .62,
        zenithColor: new THREE.Color(0x081525).lerp(new THREE.Color(0x72a8ce), sky.daylight),
        sunlight, golden,
    };
}

/** Snap in the light's plane, rather than world X/Z, to reduce moving-shadow shimmer. */
export function stableShadowFocus(focus: THREE.Vector3, direction: THREE.Vector3, extent: number, mapSize: number) {
    const right = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize();
    if (right.lengthSq() < .01) right.set(1, 0, 0);
    const up = new THREE.Vector3().crossVectors(right, direction).normalize();
    const texel = extent * 2 / mapSize;
    const r = focus.dot(right), u = focus.dot(up);
    return focus.clone().addScaledVector(right, Math.round(r / texel) * texel - r).addScaledVector(up, Math.round(u / texel) * texel - u);
}

/** A single shadow-casting key light is reused for sun and moon. Point lights stay cheap. */
export class SceneLighting {
    key = new THREE.DirectionalLight(0xffe7be, 3.1);
    ambient = new THREE.HemisphereLight(0xb3d1e8, 0x65513c, .9);
    private focus = new THREE.Vector3();
    private forward = new THREE.Vector3();
    private previousPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
    private previousTarget = new THREE.Vector3(Infinity, Infinity, Infinity);
    private dirty = true;
    private quality: GraphicsQuality = 'medium';
    constructor() {
        this.key.name = 'sun-moon-light';
        this.key.shadow.bias = -.00015;
        this.key.shadow.normalBias = .05;
        this.key.shadow.radius = 2;
        this.key.shadow.intensity = .86;
        this.key.shadow.camera.near = .5;
        this.key.shadow.camera.far = 380;
    }
    invalidate() { this.dirty = true; }
    configure(renderer: THREE.WebGLRenderer, quality: GraphicsQuality) {
        this.quality = quality;
        const profile = GRAPHICS[quality], size = Math.min(profile.shadowSize, renderer.capabilities.maxTextureSize);
        renderer.shadowMap.enabled = size > 0;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.shadowMap.autoUpdate = false;
        this.key.castShadow = size > 0;
        // Quality changes release the old depth texture before allocating a new one.
        if (this.key.shadow.mapSize.x !== size || !size) {
            this.key.shadow.dispose(); this.key.shadow.map = null; this.key.shadow.mapPass = null;
        }
        this.key.shadow.mapSize.set(size || 1, size || 1);
        const camera = this.key.shadow.camera, extent = profile.shadowExtent;
        Object.assign(camera, { left: -extent, right: extent, top: extent, bottom: -extent });
        camera.updateProjectionMatrix();
        this.invalidate();
    }
    update(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, sky: SkySample, blood: boolean, moving: boolean) {
        const light = lightingState(sky, blood), extent = GRAPHICS[this.quality].shadowExtent;
        this.key.color.copy(light.keyColor); this.key.intensity = light.keyIntensity;
        this.ambient.color.copy(light.skyColor); this.ambient.groundColor.copy(light.groundColor); this.ambient.intensity = light.ambientIntensity;
        camera.getWorldDirection(this.forward); this.forward.y = 0;
        if (this.forward.lengthSq() > .001) this.forward.normalize();
        this.focus.copy(camera.position).addScaledVector(this.forward, extent * .22); this.focus.y -= 1.65;
        const snapped = stableShadowFocus(this.focus, light.direction, extent, this.key.shadow.mapSize.x);
        this.key.target.position.copy(snapped); this.key.position.copy(snapped).addScaledVector(light.direction, 170);
        const changed = this.previousPosition.distanceToSquared(this.key.position) > 1e-10 || this.previousTarget.distanceToSquared(snapped) > 1e-10;
        renderer.shadowMap.needsUpdate ||= renderer.shadowMap.enabled && (this.dirty || changed || moving);
        this.previousPosition.copy(this.key.position); this.previousTarget.copy(snapped); this.dirty = false;
    }
    dispose() { this.key.dispose(); this.ambient.dispose(); }
}
