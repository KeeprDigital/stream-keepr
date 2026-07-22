import type * as THREE from 'three';

export interface AnimationInstance {
	destroy: () => void;
	resize?: () => void;
	setOptions?: (options: AnimationOptions) => void;
	triggerMouseMove?: (x: number, y: number) => void;
	setInteractionPoint?: (x: number, y: number) => void;
	setInteractionPixels?: (x: number, y: number) => void;
	scene?: THREE.Scene;
	plane?: THREE.Mesh;
}

export type AnimationFactory = (options: AnimationOptions) => AnimationInstance;

export type AnimationOptions = Record<string, unknown> & {
	el?: HTMLElement | string;
	THREE?: typeof THREE;
};
