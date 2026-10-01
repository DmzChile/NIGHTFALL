import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { celestialState, SkyBackdrop } from '../lib/game/sky';
import { GRAPHICS, SceneLighting, lightingState, stableShadowFocus, graphicsQuality } from '../lib/game/lighting';
import { WaterSurface } from '../lib/game/water';
import { createWorld, uuid } from '../lib/game/model';

describe('sunlight, bounded shadows and water', () => {
    it('preview hosts without randomUUID still generate unique valid UUIDv4 identifiers', () => {
        const crypto = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) };
        const ids = new Set(Array.from({ length: 100 }, () => uuid(crypto)));
        assert.equal(ids.size, 100); for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
    it('warm direct sunlight, warmer dusk, and cool moonlight follow the actual visible body', () => {
        const noon = lightingState(celestialState(255)), dusk = lightingState(celestialState(475)), night = lightingState(celestialState(600));
        assert.ok(noon.keyColor.r > noon.keyColor.b); assert.ok(dusk.keyColor.b / dusk.keyColor.r < noon.keyColor.b / noon.keyColor.r);
        assert.ok(night.keyColor.b > night.keyColor.r); assert.ok(night.keyIntensity > 0 && night.keyIntensity < noon.keyIntensity);
        for (let t = 0; t <= 1440; t += 3) {
            const sky = celestialState(t), light = lightingState(sky);
            assert.ok(light.direction.y >= 0); assert.ok(Number.isFinite(light.keyIntensity));
            assert.ok(light.ambientIntensity > .3 && light.ambientIntensity < 1);
        }
        for (const boundary of [510, 720]) {
            const a = lightingState(celestialState(boundary - .001)), b = lightingState(celestialState(boundary + .001));
            assert.ok(Math.abs(a.keyIntensity - b.keyIntensity) < .00001);
            const ca = a.keyColor.clone().multiplyScalar(a.keyIntensity), cb = b.keyColor.clone().multiplyScalar(b.keyIntensity);
            assert.ok(Math.hypot(ca.r - cb.r, ca.g - cb.g, ca.b - cb.b) < .00001);
        }
    });
    it('shadow focus stays on texel boundaries on slopes and at arbitrary world coordinates', () => {
        for (const seconds of [1, 150, 400, 500, 600]) {
            const direction = lightingState(celestialState(seconds)).direction;
            const right = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize();
            const up = new THREE.Vector3().crossVectors(right, direction).normalize();
            for (const quality of ['medium', 'high'] as const) {
                const { shadowExtent: extent, shadowSize: size } = GRAPHICS[quality], texel = extent * 2 / size;
                const input = new THREE.Vector3(182.24, 63.8, -281.05), original = input.clone(), focus = stableShadowFocus(input, direction, extent, size);
                assert.deepEqual(input, original); assert.ok(focus.distanceTo(input) <= texel);
                for (const axis of [right, up]) { const coordinate = focus.dot(axis) / texel; assert.ok(Math.abs(coordinate - Math.round(coordinate)) < 1e-8); }
            }
        }
    });
    it('changing quality releases maps, disables shadows at low, and re-enables a bounded projection', () => {
        const lighting = new SceneLighting(), renderer = { capabilities: { maxTextureSize: 2048 }, shadowMap: { enabled: false, type: THREE.PCFShadowMap, autoUpdate: true, needsUpdate: false } } as unknown as THREE.WebGLRenderer;
        lighting.configure(renderer, 'high'); assert.ok(renderer.shadowMap.enabled); assert.equal(lighting.key.shadow.mapSize.x, 2048);
        const map = new THREE.WebGLRenderTarget(2, 2); let released = 0; map.addEventListener('dispose', () => released++); lighting.key.shadow.map = map;
        lighting.configure(renderer, 'low'); assert.equal(released, 1); assert.equal(lighting.key.shadow.map, null); assert.equal(renderer.shadowMap.enabled, false);
        lighting.configure(renderer, 'medium'); assert.ok(lighting.key.castShadow); assert.equal(lighting.key.shadow.mapSize.x, 1024);
        assert.ok(lighting.key.shadow.camera.right - lighting.key.shadow.camera.left < 150); assert.equal(graphicsQuality('corrupt'), 'medium');
        lighting.dispose();
    });
    it('pausing does not regenerate shadows; moving or changing quality invalidates them', () => {
        const lighting = new SceneLighting(), renderer = { capabilities: { maxTextureSize: 2048 }, shadowMap: { enabled: false, type: THREE.PCFShadowMap, autoUpdate: true, needsUpdate: false } } as unknown as THREE.WebGLRenderer;
        const camera = new THREE.PerspectiveCamera(), sky = celestialState(255); camera.position.set(0, 1.65, 0);
        lighting.configure(renderer, 'medium'); lighting.update(renderer, camera, sky, false, false); assert.ok(renderer.shadowMap.needsUpdate);
        renderer.shadowMap.needsUpdate = false; lighting.update(renderer, camera, sky, false, false); assert.equal(renderer.shadowMap.needsUpdate, false);
        lighting.update(renderer, camera, sky, false, true); assert.ok(renderer.shadowMap.needsUpdate);
        renderer.shadowMap.needsUpdate = false; camera.position.x = 20; lighting.update(renderer, camera, sky, false, false); assert.ok(renderer.shadowMap.needsUpdate);
        lighting.dispose();
    });
    it('sky and water reconstruct from saved time without changing the world, and release materials', () => {
        const s = createWorld('lighting', 'lighting'); s.time = 475; const before = structuredClone(s);
        const a = new SkyBackdrop(), b = new SkyBackdrop(), water = new WaterSurface(), camera = new THREE.PerspectiveCamera();
        a.update(camera, s.time, s.blood); b.update(camera, structuredClone(s).time, s.blood); water.update(s.time, 1);
        assert.deepEqual(a.dome.material.uniforms.horizon.value, b.dome.material.uniforms.horizon.value);
        assert.deepEqual(a.clouds.material.color, b.clouds.material.color); assert.equal(water.time.value, s.time);
        water.update(s.time, 0); assert.equal(water.time.value, s.time); assert.equal(water.ripples.value, 0); assert.deepEqual(s, before);
        let released = 0; water.material.addEventListener('dispose', () => released++); a.dome.geometry.addEventListener('dispose', () => released++); a.dome.material.addEventListener('dispose', () => released++);
        water.dispose(); a.dispose(); b.dispose(); assert.equal(released, 3);
    });
});
