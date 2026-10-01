import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Authored locally: no Meshy-generated content or textures are used in these assets.
const destination = fileURLToPath(new URL('../public/models/trees/', import.meta.url));
const summaries = [];
await fs.mkdir(destination, { recursive: true });

function rng(seed) {
    let state = seed;
    return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

function model(species) {
    const random = rng({ pine: 721, oak: 1997, birch: 389, maple: 881 }[species]);
    const parts = [], colors = {
        pine: { wood: 0x725138, leaf: 0x3f775a },
        oak: { wood: 0x795539, leaf: 0x6b904a },
        birch: { wood: 0xd8d5c7, leaf: 0x97ae5b },
        maple: { wood: 0x806147, leaf: 0x608749 },
    }[species];
    function add(raw, color, leaves = false, transform = new THREE.Matrix4(), jitter = 0) {
        const geometry = raw.index ? raw.toNonIndexed() : raw;
        if (raw !== geometry) raw.dispose();
        const position = geometry.getAttribute('position');
        if (jitter) {
            // One deterministic radial perturbation per shared coordinate keeps faces joined.
            for (let i = 0; i < position.count; i++) {
                const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
                const k = 1 + jitter * Math.sin(x * 7.3 + y * 4.1 + z * 9.7);
                position.setXYZ(i, x * k, y * k, z * k);
            }
        }
        geometry.applyMatrix4(transform);
        geometry.deleteAttribute('uv'); geometry.deleteAttribute('normal');
        geometry.computeVertexNormals();
        const base = new THREE.Color(color), c = new THREE.Color(), vertexColors = new Float32Array(position.count * 3);
        for (let i = 0; i < position.count; i += 3) {
            c.copy(base).multiplyScalar(.88 + random() * .2);
            for (let j = 0; j < 3; j++) vertexColors.set(c.toArray(), (i + j) * 3);
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));
        geometry.setAttribute('_foliage', new THREE.BufferAttribute(new Float32Array(position.count).fill(leaves ? 1 : 0), 1));
        parts.push(geometry);
    }
    function branch(start, end, bottom, top = bottom * .58, bark = colors.wood, segments = 7) {
        const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end), delta = b.clone().sub(a);
        const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
        const matrix = new THREE.Matrix4().compose(a.add(b).multiplyScalar(.5), rotation, new THREE.Vector3(1, 1, 1));
        add(new THREE.CylinderGeometry(top, bottom, delta.length(), segments, 1), bark, false, matrix);
    }
    function foliage(center, scale, twist = 0) {
        const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...center), new THREE.Quaternion().setFromEuler(new THREE.Euler(.1, twist, -.07)), new THREE.Vector3(...scale));
        add(new THREE.IcosahedronGeometry(1, 1), colors.leaf, true, matrix, .105);
    }
    function roots(radius, count) {
        for (let i = 0; i < count; i++) {
            const angle = i * Math.PI * 2 / count + .13;
            branch([Math.cos(angle) * radius, .07, Math.sin(angle) * radius], [0, .48, 0], .1, .2);
        }
    }
    if (species === 'pine') {
        branch([0, 0, 0], [.06, 5.9, -.04], .4, .09);
        roots(.72, 5);
        // Irregular layered needle skirts with a broad lower tier and a tapering tip.
        for (let tier = 0; tier < 5; tier++) {
            const radius = 2.2 - tier * .37, bottom = 2.05 + tier * .84, rings = [
                { y: bottom, r: radius * .65 }, { y: bottom + .2, r: radius },
                { y: bottom + .7, r: radius * .55 }, { y: bottom + 1.2, r: radius * .08 },
            ];
            const vertices = [], segments = 9;
            const point = (ring, i) => {
                const angle = i * Math.PI * 2 / segments + tier * .32;
                const uneven = 1 + .1 * Math.sin(i * 2.7 + tier);
                return [Math.cos(angle) * rings[ring].r * uneven + tier * .025, rings[ring].y + Math.sin(i * 3.1) * .06, Math.sin(angle) * rings[ring].r * uneven];
            };
            for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < segments; i++) {
                vertices.push(...point(r, i), ...point(r + 1, i), ...point(r, (i + 1) % segments));
                vertices.push(...point(r, (i + 1) % segments), ...point(r + 1, i), ...point(r + 1, (i + 1) % segments));
            }
            // Close the lower skirt so it remains visible from below while harvesting.
            for (let i = 0; i < segments; i++) vertices.push(0, bottom, 0, ...point(0, i), ...point(0, (i + 1) % segments));
            for (let i = 0; i < segments; i++) vertices.push(...point(3, i), rings[3].r * .3, rings[3].y + .08, 0, ...point(3, (i + 1) % segments));
            const skirt = new THREE.BufferGeometry(); skirt.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
            add(skirt, colors.leaf, true);
            for (let arm = 0; arm < 3; arm++) {
                const angle = arm * Math.PI * 2 / 3 + tier * .7;
                branch([0, bottom + .15, 0], [Math.cos(angle) * radius * .78, bottom + .12, Math.sin(angle) * radius * .78], .06, .025, colors.wood, 5);
            }
        }
        foliage([.08, 6.1, -.05], [.36, .75, .38]);
    } else if (species === 'oak') {
        branch([0, 0, 0], [.1, 1.95, -.08], .48, .35);
        branch([.1, 1.95, -.08], [-.15, 3.9, .05], .35, .19);
        roots(1.05, 6);
        for (let i = 0; i < 6; i++) {
            const angle = i * Math.PI * 2 / 6 + .18, reach = i % 2 ? 1.45 : 1.7;
            const tip = [Math.cos(angle) * reach, 4.55 + (i % 3) * .24, Math.sin(angle) * reach];
            branch([.02, 2.75 + (i % 2) * .35, 0], tip, .19, .085);
            foliage(tip, [1.2, 1.03 + i % 2 * .1, 1.17], angle);
        }
        foliage([-.18, 5.35, -.15], [1.58, 1.08, 1.42]);
        foliage([.55, 4.05, -.65], [1.12, .83, 1.07]);
    } else if (species === 'birch') {
        const trunk = [[0, 0, 0], [.08, 2.5, -.06], [-.18, 4.6, .04], [.08, 6.3, -.06]];
        for (let i = 0; i < trunk.length - 1; i++) branch(trunk[i], trunk[i + 1], [.3, .2, .12][i], [.2, .12, .045][i]);
        roots(.55, 4);
        // Broken dark bark bands, offset on alternating sides of the pale trunk.
        for (let i = 0; i < 11; i++) {
            const y = .32 + i * .4, x = y < 2.5 ? y * .032 : .08 - (y - 2.5) * .124;
            const side = i % 2 ? -1 : 1, radius = .28 - y * .036;
            const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x + side * radius * .65, y, -.04 + radius * .69), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, side * .48, .1)), new THREE.Vector3(.16 + random() * .14, .035 + random() * .045, .025));
            add(new THREE.BoxGeometry(1, 1, 1), 0x5b5a52, false, matrix);
        }
        for (let i = 0; i < 6; i++) {
            const angle = i * 2.4, y = 3.05 + i * .42, reach = 1.12 + .2 * Math.sin(i);
            const tip = [Math.cos(angle) * reach, y + .77, Math.sin(angle) * reach];
            branch([-.06, y - .7, 0], tip, .075, .032);
            foliage(tip, [.82, .78, .79], angle);
        }
        foliage([.08, 6.35, -.06], [.92, 1.06, .86]);
    } else {
        branch([0, 0, 0], [-.15, 2.55, .08], .4, .24);
        branch([-.15, 2.55, .08], [.06, 4.65, -.12], .24, .07);
        roots(.88, 5);
        for (let i = 0; i < 7; i++) {
            const angle = i * Math.PI * 2 / 7 + .2, reach = 1.4 + .2 * Math.sin(i * 3);
            const tip = [Math.cos(angle) * reach, 4.15 + (i % 3) * .37, Math.sin(angle) * reach];
            branch([-.1, 2.25 + (i % 2) * .7, .03], tip, .13, .05);
            foliage(tip, [1.02, 1.12, .99], angle);
        }
        foliage([.05, 5.27, -.12], [1.13, 1.23, 1.07]);
    }
    const geometry = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    geometry.computeBoundingBox();
    geometry.translate(0, -geometry.boundingBox.min.y, 0);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return geometry;
}

/** A small glTF 2.0 writer keeps the assets self contained, texture free and reproducible. */
function glb(geometry, species) {
    const attributes = {}, accessors = [], bufferViews = [], binary = [];
    let offset = 0;
    for (const [name, semantic, type] of [['position', 'POSITION', 'VEC3'], ['normal', 'NORMAL', 'VEC3'], ['color', 'COLOR_0', 'VEC3'], ['_foliage', '_FOLIAGE', 'SCALAR']]) {
        const attribute = geometry.getAttribute(name), bytes = Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength);
        bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target: 34962 });
        const accessor = { bufferView: bufferViews.length - 1, componentType: 5126, count: attribute.count, type };
        if (name === 'position') { accessor.min = geometry.boundingBox.min.toArray(); accessor.max = geometry.boundingBox.max.toArray(); }
        attributes[semantic] = accessors.length; accessors.push(accessor); binary.push(bytes); offset += bytes.length;
    }
    const document = {
        asset: { version: '2.0', generator: 'NIGHTFALL authored tree generator', extras: { source: 'locally-authored', species } },
        scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: `${species}_tree` }],
        meshes: [{ name: species, primitives: [{ attributes, material: 0, mode: 4 }] }],
        materials: [{ name: 'Bark and foliage vertex colors', pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: .94 }, doubleSided: false }],
        buffers: [{ byteLength: offset }], bufferViews, accessors,
    };
    let json = Buffer.from(JSON.stringify(document));
    json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
    const data = Buffer.concat(binary), header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
    header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + data.length, 8);
    jsonHeader.writeUInt32LE(json.length); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
    binHeader.writeUInt32LE(data.length); binHeader.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, jsonHeader, json, binHeader, data]);
}

for (const species of ['pine', 'oak', 'birch', 'maple']) {
    const geometry = model(species), bytes = glb(geometry, species), triangles = geometry.getAttribute('position').count / 3;
    if (triangles > 1500) throw new Error(`${species}: ${triangles} triangles exceeds the asset budget`);
    await fs.writeFile(path.join(destination, `${species}.glb`), bytes);
    summaries.push({ species, path: `/models/trees/${species}.glb`, triangles, bytes: bytes.length });
    geometry.dispose();
}
await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify({
    source: 'locally-authored', generator: 'scripts/generate-tree-models.mjs',
    reason: 'Meshy API rejected generation for the free plan; user selected locally authored GLB assets.',
    textures: 0, animations: 0, foliageMask: '_FOLIAGE', models: summaries,
}, null, 2) + '\n');
console.log(JSON.stringify(summaries, null, 2));
