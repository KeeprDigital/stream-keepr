import type { BackgroundLayerType } from '~~/shared/types/screenConfig';

/** What each Background Layer type is called wherever a stack is listed. */
export const BACKGROUND_LAYER_TYPE_LABELS: Record<BackgroundLayerType, string> = {
	color: 'Colour',
	gradient: 'Gradient',
	image: 'Image',
	video: 'Video',
	animation: 'Animation',
};
