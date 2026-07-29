import type { CSSProperties } from 'vue';
import type { BroadcastGraphicsModeConfig, ScreenOutput } from '~~/shared/types/screenConfig';

export interface BroadcastGraphicsRenderModelInput {
	config: BroadcastGraphicsModeConfig;
	output: ScreenOutput;
}

export interface BroadcastGraphicsRenderModel {
	output: ScreenOutput;
	canvasStyle: CSSProperties;
}

/**
 * Broadcast Graphics render-model seam.
 *
 * Composition in, one Screen Output render model out. The Overlay Output keeps
 * the composed frame over transparency; the Fill Output and Key Output flatten
 * the same frame over black.
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
