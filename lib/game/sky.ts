import * as THREE from 'three';

/** The orbit follows simulation time, including the existing unequal day/night lengths. */
export function celestialState(seconds: number) {
    const time = ((seconds % 720) + 720) % 720;
    const daylight = time < 450 ? 1 : time < 510 ? 1 - (time - 450) / 60 * .9 : time < 690 ? .1 : .1 + (time - 690) / 30 * .9;
    const orbit = time < 510 ? time / 510 * Math.PI : Math.PI + (time - 510) / 210 * Math.PI;
    const sun = new THREE.Vector3(Math.cos(orbit), Math.sin(orbit) * .85, -.35).normalize();
    const moon = new THREE.Vector3(-sun.x, -sun.y, -sun.z);
    return { daylight, sun, moon, sunVisible: sun.y >= -.04, moonVisible: moon.y >= -.04,
        color: new THREE.Color().lerpColors(new THREE.Color(0x10202f), new THREE.Color(time > 420 && time < 510 ? 0xc3aaa0 : 0xaac3bb), daylight) };
}
export class SkyBackdrop {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(72, 1, .1, 400);
    sun = new THREE.Mesh(new THREE.SphereGeometry(6.5, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffdc8c, fog: false, toneMapped: false }));
    moon = new THREE.Mesh(new THREE.SphereGeometry(5.3, 24, 16), new THREE.MeshBasicMaterial({ color: 0xdbe7ed, fog: false, toneMapped: false }));
    glow = new THREE.Mesh(new THREE.PlaneGeometry(32, 32), new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, toneMapped: false,
        uniforms: { color: { value: new THREE.Color(0xffd494) } },
        vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform vec3 color;
varying vec2 vUv;
void main() {
    float a=pow(1.0-smoothstep(0.0,0.5,length(vUv-0.5)),2.0)*0.45;
    gl_FragColor=vec4(color,a);
    #include <colorspace_fragment>
}`
    }));
    constructor() { this.scene.add(this.sun, this.moon, this.glow); }
    update(camera: THREE.PerspectiveCamera, seconds: number, blood: boolean) {
        const sky = celestialState(seconds);
        this.camera.aspect = camera.aspect; this.camera.fov = camera.fov; this.camera.quaternion.copy(camera.quaternion); this.camera.updateProjectionMatrix();
        this.scene.background = sky.color;
        this.sun.position.copy(sky.sun).multiplyScalar(180); this.moon.position.copy(sky.moon).multiplyScalar(180);
        this.sun.visible = sky.sunVisible; this.moon.visible = sky.moonVisible;
        this.moon.material.color.set(blood ? 0xdf897c : 0xdbe7ed);
        this.glow.position.copy(this.sun.position); this.glow.quaternion.copy(this.camera.quaternion); this.glow.visible = this.sun.visible;
        return sky;
    }
    /** Render before terrain so hills and foliage naturally hide the celestial discs. */
    render(renderer: THREE.WebGLRenderer, world: THREE.Scene, camera: THREE.PerspectiveCamera) {
        const autoClear = renderer.autoClear;
        try {
            renderer.autoClear = true; renderer.render(this.scene, this.camera);
            renderer.autoClear = false; renderer.clearDepth(); renderer.render(world, camera);
        } finally { renderer.autoClear = autoClear; }
    }
    dispose() {
        for (const object of [this.sun, this.moon, this.glow]) { object.geometry.dispose(); object.material.dispose(); }
        this.scene.clear();
    }
}
