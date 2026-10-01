import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TREE_SIZES, treeColor, type TreeSpecies, type TreeTraits } from './woodland';

export const TREE_MODEL_URLS: Record<TreeSpecies, string> = {
    pine: '/models/trees/pine.glb',
    oak: '/models/trees/oak.glb',
    birch: '/models/trees/birch.glb',
    maple: '/models/trees/maple.glb',
};
export const MAX_TREE_MODEL_TRIANGLES = 3000;

/** GLB assets carry baked vertex colors and a foliage mask, without texture downloads. */
export function extractTreeTemplate(scene: THREE.Object3D) {
    const parts: THREE.BufferGeometry[] = [];
    scene.updateMatrixWorld(true);
    try {
        scene.traverse(object => {
            if (!(object instanceof THREE.Mesh)) return;
            const raw = object.geometry.clone();
            const geometry = raw.index ? raw.toNonIndexed() : raw;
            if (raw !== geometry) raw.dispose();
            parts.push(geometry);
            geometry.applyMatrix4(object.matrixWorld);
            const foliage = geometry.getAttribute('_foliage') || geometry.getAttribute('foliage');
            if (!foliage || !geometry.getAttribute('color')) throw new Error('나무 모델의 색상 또는 잎 마스크가 없습니다.');
            const count = geometry.getAttribute('position').count;
            if (foliage.count !== count || geometry.getAttribute('color').count !== count || count % 3)
                throw new Error('나무 모델의 정점 속성이 일치하지 않습니다.');
            geometry.setAttribute('foliage', foliage);
            for (const name of Object.keys(geometry.attributes))
                if (!['position', 'normal', 'color', 'foliage'].includes(name)) geometry.deleteAttribute(name);
            if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
        });
        const triangles = parts.reduce((sum, part) => sum + part.getAttribute('position').count / 3, 0);
        if (!triangles || triangles > MAX_TREE_MODEL_TRIANGLES) throw new Error('나무 모델의 삼각형 예산을 초과했습니다.');
        const geometry = mergeGeometries(parts);
        if (!geometry) throw new Error('나무 모델을 결합하지 못했습니다.');
        for (const attribute of Object.values(geometry.attributes)) if (!Array.from(attribute.array).every(Number.isFinite)) {
            geometry.dispose(); throw new Error('나무 모델에 유효하지 않은 정점이 있습니다.');
        }
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!, size = box.getSize(new THREE.Vector3());
        if (![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite) || size.y <= 0 || size.x <= 0 || size.z <= 0) {
            geometry.dispose(); throw new Error('나무 모델의 크기가 올바르지 않습니다.');
        }
        geometry.translate(0, -box.min.y, 0);
        geometry.scale(1 / size.y, 1 / size.y, 1 / size.y);
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        return geometry;
    } finally {
        for (const part of parts) part.dispose();
    }
}

export async function loadTreeTemplate(species: TreeSpecies) {
    const gltf = await new GLTFLoader().loadAsync(TREE_MODEL_URLS[species]);
    try { return extractTreeTemplate(gltf.scene); }
    finally {
        const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
        gltf.scene.traverse(object => {
            if (!(object instanceof THREE.Mesh)) return;
            geometries.add(object.geometry);
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
                materials.add(material);
                for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
            }
        });
        for (const resource of [...geometries, ...materials, ...textures]) resource.dispose();
    }
}

/** Keep authored bark colors; recolor leaves for the saved season, size and variant. */
export function treeModelGeometry(template: THREE.BufferGeometry, traits: TreeTraits, hard = false) {
    const geometry = template.clone(), profile = TREE_SIZES[traits.size];
    const box = template.boundingBox!, radius = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z));
    geometry.scale(profile.crown / radius, profile.height, profile.crown / radius);
    const colors = geometry.getAttribute('color'), leaves = geometry.getAttribute('foliage');
    const leaf = new THREE.Color(treeColor(traits)), source = new THREE.Color();
    for (let i = 0; i < colors.count; i++) {
        source.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i));
        if (leaves.getX(i) > .5) {
            const shade = THREE.MathUtils.clamp((source.r * .2126 + source.g * .7152 + source.b * .0722) / .28, .68, 1.12);
            source.copy(leaf).multiplyScalar(shade);
        } else if (hard) source.multiplyScalar(.82);
        colors.setXYZ(i, source.r, source.g, source.b);
    }
    geometry.deleteAttribute('foliage');
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return geometry;
}
