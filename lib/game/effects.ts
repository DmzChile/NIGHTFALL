import * as THREE from 'three';
type Spark = {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    age: number;
    life: number;
    color: number;
};
/** A single bounded draw call for transient, non-persistent action feedback. */
export class EffectPool {
    readonly geometry = new THREE.OctahedronGeometry(.055, 0);
    readonly material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    readonly mesh: THREE.InstancedMesh;
    private sparks: Spark[] = [];
    private dummy = new THREE.Object3D();
    private color = new THREE.Color();
    constructor(readonly capacity = 80) {
        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.frustumCulled = false;
        this.mesh.count = 0;
        this.mesh.name = 'action-effects';
    }
    emit(x: number, y: number, z: number, color: number, count = 8) {
        for (let i = 0; i < count; i++) {
            if (this.sparks.length >= this.capacity)
                this.sparks.shift();
            const angle = Math.random() * Math.PI * 2, speed = 1 + Math.random() * 2;
            this.sparks.push({ x, y, z, vx: Math.cos(angle) * speed, vy: 1 + Math.random() * 2, vz: Math.sin(angle) * speed, age: 0, life: .25 + Math.random() * .25, color });
        }
    }
    step(dt: number) {
        const delta = Math.max(0, dt);
        for (const p of this.sparks) {
            p.age += delta;
            p.x += p.vx * delta;
            p.y += p.vy * delta;
            p.z += p.vz * delta;
            p.vy -= 8 * delta;
        }
        this.sparks = this.sparks.filter(p => p.age < p.life);
        this.mesh.count = this.sparks.length;
        this.sparks.forEach((p, i) => {
            this.dummy.position.set(p.x, p.y, p.z);
            this.dummy.scale.setScalar(1 - p.age / p.life);
            this.dummy.updateMatrix();
            this.mesh.setMatrixAt(i, this.dummy.matrix);
            this.mesh.setColorAt(i, this.color.setHex(p.color));
        });
        this.mesh.instanceMatrix.needsUpdate = true;
        if (this.mesh.instanceColor)
            this.mesh.instanceColor.needsUpdate = true;
    }
    clear() {
        this.sparks = [];
        this.mesh.count = 0;
    }
    dispose() {
        this.clear();
        this.geometry.dispose();
        this.material.dispose();
        this.mesh.dispose();
    }
}
