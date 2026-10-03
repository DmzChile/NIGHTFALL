import * as THREE from 'three';
import { SEA_LEVEL, WATER_DEPTH_EPSILON, terrainWaterVertexLevel, type TerrainWorld } from './terrain';

type WaterVertex = { x: number; y: number; z: number; depth: number };

/** Clip the ground's own triangles at the shoreline so dry banks stay uncovered. */
export function inlandWaterGeometry(ground: THREE.BufferGeometry, world: TerrainWorld) {
    const position = ground.getAttribute('position'), index = ground.getIndex(), vertices: (WaterVertex | null)[] = [];
    const positions: number[] = [];
    for (let i = 0; i < position.count; i++) {
        const x = position.getX(i), z = position.getZ(i), y = terrainWaterVertexLevel(x, z, world);
        vertices.push(y === null ? null : { x, y, z, depth: y - position.getY(i) - WATER_DEPTH_EPSILON });
    }
    const intersection = (a: WaterVertex, b: WaterVertex): WaterVertex => {
        const t = a.depth / (a.depth - b.depth);
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, depth: 0 };
    };
    const count = index?.count ?? position.count;
    for (let i = 0; i < count; i += 3) {
        const triangle = [0, 1, 2].map(offset => vertices[index ? index.getX(i + offset) : i + offset]);
        if (triangle.some(vertex => vertex === null)) continue;
        const source = triangle as WaterVertex[], polygon: WaterVertex[] = [];
        for (let j = 0; j < 3; j++) {
            const a = source[j], b = source[(j + 1) % 3], inside = a.depth > 0, nextInside = b.depth > 0;
            if (inside) polygon.push(a);
            if (inside !== nextInside) polygon.push(intersection(a, b));
        }
        // The large ocean mesh already covers surfaces at or below sea level.
        if (polygon.length < 3 || polygon.every(vertex => vertex.y <= SEA_LEVEL)) continue;
        for (let j = 1; j < polygon.length - 1; j++) {
            for (const vertex of [polygon[0], polygon[j], polygon[j + 1]]) positions.push(vertex.x, vertex.y, vertex.z);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return geometry;
}

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
