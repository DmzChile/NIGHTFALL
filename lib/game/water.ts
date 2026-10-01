import * as THREE from 'three';

/** Analytic surface normals provide moving sun highlights without a reflection pass. */
export class WaterSurface {
    time = { value: 0 };
    ripples = { value: 1 };
    material = new THREE.MeshStandardMaterial({ color: 0x3b8293, roughness: .26, metalness: .18 });
    constructor() {
        this.material.onBeforeCompile = shader => {
            shader.uniforms.waterTime = this.time; shader.uniforms.waterRipples = this.ripples;
            shader.vertexShader = 'varying vec3 vWaterWorld;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            shader.fragmentShader = 'uniform float waterTime;\nuniform float waterRipples;\nvarying vec3 vWaterWorld;\n' + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
                float a = vWaterWorld.x * .55 + vWaterWorld.z * .18 + waterTime * .65;
                float b = vWaterWorld.z * .72 - vWaterWorld.x * .12 - waterTime * .43;
                float c = (vWaterWorld.x + vWaterWorld.z) * 1.9 + waterTime * 1.1;
                float dx = (.10 * .55 * cos(a) - .06 * .12 * cos(b) + .018 * 1.9 * cos(c)) * waterRipples;
                float dz = (.10 * .18 * cos(a) + .06 * .72 * cos(b) + .018 * 1.9 * cos(c)) * waterRipples;
                normal = normalize(mat3(viewMatrix) * vec3(-dx, 1.0, -dz));
            `);
        };
        this.material.customProgramCacheKey = () => 'nightfall-water-ripples-v1';
    }
    update(seconds: number, ripples: number) { this.time.value = seconds; this.ripples.value = ripples; }
    dispose() { this.material.dispose(); }
}
