import * as THREE from 'three';
import { TerrainNS, createSeededRandom } from 'three.terrain.js';
import { terrainSeed, type HeightArray } from './types';

/** The only import boundary for THREE.Terrain. Use its DOM-free ESM helpers in Node and browsers. */
export function simplexLayer(seed: string, segments: number, frequency: number) {
    const heights = new Float32Array((segments + 1) ** 2);
    TerrainNS.Simplex(heights, { xSegments: segments, ySegments: segments, frequency, minHeight: -1, maxHeight: 1, random: createSeededRandom(terrainSeed(seed)) });
    return heights;
}

export function smoothLayer(heights: Float32Array, segments: number) {
    const result = heights.slice();
    TerrainNS.Smooth(result, { xSegments: segments, ySegments: segments }, 1);
    return result;
}

export function terrainGeometry(heights: HeightArray, size: number, segments: number) {
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    // Terrain's heightmap uses local XY + elevation Z; bake the transform once into world X/Z + Y.
    TerrainNS.fromArray1D(geometry.attributes.position.array, heights);
    geometry.rotateX(-Math.PI / 2);
    geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return geometry;
}
