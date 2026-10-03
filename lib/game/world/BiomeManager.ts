import { smoothstep, type TerrainType } from './types';

/** Existing progression regions stay fixed. Landform/climate rules can grow independently. */
export class BiomeManager {
    getRegionAt(x: number, z: number) {
        if (z > 240) return '유적';
        if (x > 230) return '화산';
        if (x < -200) return '습지';
        if (z < -210) return '바위 언덕';
        return Math.abs(x) > 85 || Math.abs(z) > 95 ? '숲' : '초원';
    }
    getTerrainTypeAt(x: number, z: number, height: number, slope: number, plain: number, mountain: number, valley: number, cliff = 0): TerrainType {
        if (height < -.8 || Math.hypot(x, z) > 480) return 'water';
        if (Math.hypot(x, z) > 430) return 'beach';
        if (cliff > .1 && slope > .85 || slope > 1.8) return 'cliffs';
        if (mountain > .32 && height > 38) return 'mountains';
        if (valley > .45 && slope < .65) return 'valley';
        if (height > 27) return 'highlands';
        if (plain > .4 && slope < .2) return 'plains';
        if (height < 4 && slope < .2) return 'lowlands';
        return 'hills';
    }
    materialWeights(height: number, slope: number) {
        const rock = Math.max(smoothstep(.35, .95, slope), smoothstep(38, 68, height));
        const dirt = (1 - rock) * smoothstep(.1, .4, slope) * .65;
        return { grass: 1 - rock - dirt, dirt, rock };
    }
}
export const biomeManager = new BiomeManager();
