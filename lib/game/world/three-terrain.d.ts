declare module 'three.terrain.js' {
    type Options = { xSegments: number; ySegments: number; xSize?: number; ySize?: number; minHeight?: number; maxHeight?: number; frequency?: number; random?: () => number };
    export function createSeededRandom(seed: number): () => number;
    export const TerrainNS: {
        Simplex(heights: Float32Array, options: Options): void;
        Smooth(heights: Float32Array, options: Options, weight?: number): void;
        fromArray1D(positions: ArrayLike<number> & { [index: number]: number }, heights: ArrayLike<number>): void;
    };
}
