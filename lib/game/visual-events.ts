import type { HandAction } from './animation';
export type VisualEvent = {
    type: 'action';
    action: HandAction;
    item: string;
} | {
    type: 'gather';
    id: string;
    kind: string;
    x: number;
    z: number;
} | {
    type: 'enemy-hit';
    id: string;
    x: number;
    z: number;
    dead: boolean;
};
