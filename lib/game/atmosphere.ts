import * as THREE from 'three';

export const CLOUD_COUNT = 12;
export const CLOUD_LOBES = 5;

/** Visual weather is derived from simulation time, never from the loot/spawn RNG. */
export function fogDensity(seconds: number, daylight: number, region: string, altitude: number) {
    const time = ((seconds % 720) + 720) % 720;
    const dawn = Math.exp(-Math.pow(Math.min(time, 720 - time) / 45, 2));
    const dusk = Math.exp(-Math.pow((time - 485) / 38, 2));
    const highland = Math.min(.0015, Math.max(0, altitude - 30) * .00002);
    return .0065 + (1 - daylight) * .0018 + dawn * .0035 + dusk * .0008 + (region === '습지' ? .0025 : 0) - highland;
}

export function cloudPosition(seconds: number, index: number) {
    const angle = index * 2.399963229728653 + seconds * .0006;
    const radius = 108 + (index % 4) * 10;
    return new THREE.Vector3(Math.cos(angle) * radius, 34 + (index % 5) * 9 + Math.sin(seconds / 90 + index) * 1.2, Math.sin(angle) * radius);
}

/** All cloud lobes share one draw call and stay nearer than the sun/moon in the sky scene. */
export class CloudLayer {
    geometry = new THREE.SphereGeometry(1, 10, 6);
    material = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false });
    mesh = new THREE.InstancedMesh(this.geometry, this.material, CLOUD_COUNT * CLOUD_LOBES);
    private transform = new THREE.Object3D();
    private night = new THREE.Color(0x354451);
    private day = new THREE.Color(0xeeeae2);
    private seconds = NaN;
    private daylight = NaN;
    constructor() {
        const colors: number[] = [], normals = this.geometry.attributes.normal;
        for (let i = 0; i < normals.count; i++) {
            const shade = .82 + Math.max(0, normals.getY(i)) * .18;
            colors.push(shade, shade, shade);
        }
        this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.frustumCulled = false;
        this.update(0, 1);
    }
    update(seconds: number, daylight: number) {
        if (seconds === this.seconds && daylight === this.daylight) return;
        this.seconds = seconds; this.daylight = daylight;
        for (let i = 0; i < CLOUD_COUNT; i++) {
            const center = cloudPosition(seconds, i), rotation = i * .8 + seconds * .0006;
            for (let lobe = 0; lobe < CLOUD_LOBES; lobe++) {
                const offset = (lobe - 2) * 6;
                this.transform.position.set(center.x + Math.cos(rotation) * offset, center.y + (lobe % 2) * 2, center.z + Math.sin(rotation) * offset);
                this.transform.rotation.set(0, rotation, 0);
                this.transform.scale.set(9 + ((i + lobe) % 3) * 2, 3.5 + (lobe % 3), 6 + (i % 3));
                this.transform.updateMatrix();
                this.mesh.setMatrixAt(i * CLOUD_LOBES + lobe, this.transform.matrix);
            }
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        this.material.color.lerpColors(this.night, this.day, THREE.MathUtils.clamp((daylight - .1) / .9, 0, 1));
    }
    dispose() { this.mesh.removeFromParent(); this.mesh.dispose(); this.geometry.dispose(); this.material.dispose(); }
}
