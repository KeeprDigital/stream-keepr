import type { CSSProperties } from 'vue';
import type { ScreenOutput } from '~~/shared/types/screenConfig';

export interface BroadcastGraphicsRenderModelInput {
	output: ScreenOutput;
}

export interface BroadcastGraphicsRenderModel {
	output: ScreenOutput;
	canvasStyle: CSSProperties;
}

/**
 * Broadcast Graphics render-model seam.
 *
 * Composition in, one Screen Output render model out. An empty Broadcast
 * Graphics Screen is transparent in its Overlay Output and black in its Fill
 * Output and Key Output.
 *
 * The Key Output renders the final composed opacity as a grayscale alpha
 * matte, not the composed colour over black; that derivation arrives with the
 * compositor, once there is a composed frame to derive it from.
 */
export function resolveBroadcastGraphicsRenderModel(input: BroadcastGraphicsRenderModelInput): BroadcastGraphicsRenderModel {
	return {
		output: input.output,
		canvasStyle: {
			width: '100%',
			height: '100%',
			position: 'relative',
			overflow: 'hidden',
			background: input.output === 'overlay' ? 'transparent' : '#000',
		},
	};
}
