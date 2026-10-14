import type { GraphicFocalPosition, MediaFit } from '~~/shared/types/graphicItem';
import { MEDIA_FIT_VALUES } from '~~/shared/types/graphicItem';

const MEDIA_FIT_LABELS: Record<MediaFit, string> = {
	cover: 'Cover',
	contain: 'Contain',
	fill: 'Fill',
};

/** The one Media Fit list every media host offers. */
export const MEDIA_FIT_OPTIONS = MEDIA_FIT_VALUES.map(value => ({ label: MEDIA_FIT_LABELS[value], value }));

/** What the media fields control shows. A host passes only the fields it offers. */
export interface MediaFieldsValue {
	fit: MediaFit;
	opacity?: number;
	focalPosition?: GraphicFocalPosition;
	playbackRate?: number;
	loop?: boolean;
}

/**
 * One edit from the media fields control. A cleared opacity or playback rate is
 * `null`, which `resolveMediaFieldsPatch` turns into its default.
 */
export interface MediaFieldsPatch {
	fit?: MediaFit;
	opacity?: number | null;
	focalPosition?: GraphicFocalPosition;
	playbackRate?: number | null;
	loop?: boolean;
}

export type ResolvedMediaFieldsPatch = Omit<MediaFieldsPatch, 'opacity' | 'playbackRate'> & {
	opacity?: number;
	playbackRate?: number;
};

/**
 * Every host's default for a cleared field: opaque, at normal speed. A Style Set
 * media treatment, a Media Graphic Item, a Background Layer, and the Frame's
 * video all start there.
 */
const MEDIA_FIELD_DEFAULTS = { opacity: 1, playbackRate: 1 } as const;

/** Replace a cleared opacity or playback rate with its default. */
export function resolveMediaFieldsPatch(patch: MediaFieldsPatch): ResolvedMediaFieldsPatch {
	const { opacity, playbackRate, ...rest } = patch;
	return {
		...rest,
		...(opacity === undefined ? {} : { opacity: opacity ?? MEDIA_FIELD_DEFAULTS.opacity }),
		...(playbackRate === undefined ? {} : { playbackRate: playbackRate ?? MEDIA_FIELD_DEFAULTS.playbackRate }),
	};
}
