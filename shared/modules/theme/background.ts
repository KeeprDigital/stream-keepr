import type { BackgroundLayer, ScreenMediaSource } from '../../types/screenConfig';
import { z } from 'zod';
import { animationEffectSelectionSchema } from '../../animationEffects';
import { MEDIA_FIT_VALUES } from '../../types/graphicItem';
import { MAX_GRAPHIC_MEDIA_PLAYBACK_RATE, MIN_GRAPHIC_MEDIA_PLAYBACK_RATE } from '../../types/graphics';
import { remoteMediaUrlRefusal } from '../../utils/remoteMediaUrl';

/**
 * A Background Layer stack as a Theme Token holds it: the layers a Screen's own
 * stack takes (ADR-0016), painted by the same stack component.
 *
 * An image or video layer takes a Remote Media URL only. A layer referencing a
 * Graphic Asset Revision is refused until a Theme can own a Graphic Asset
 * Reference that protects it from retire and trash (#828).
 */
export type ThemeBackgroundLayer = Exclude<BackgroundLayer, { source: unknown }>
	| (Extract<BackgroundLayer, { source: unknown }> & { source: Extract<ScreenMediaSource, { kind: 'url' }> });

const opacitySchema = z.number().finite().min(0).max(1);

const layerShape = {
	id: z.string().min(1).max(100),
	enabled: z.boolean(),
	opacity: opacitySchema,
};

const remoteMediaSourceSchema = z.object({
	kind: z.literal('url'),
	url: z.string().max(2000).superRefine((value, context) => {
		const refusal = remoteMediaUrlRefusal(value);
		if (refusal !== undefined)
			context.addIssue({ code: 'custom', message: refusal });
	}),
}).strict();

const layerSchema = z.discriminatedUnion('type', [
	z.object({
		...layerShape,
		type: z.literal('color'),
		color: z.string().min(1).max(500),
	}).strict(),
	z.object({
		...layerShape,
		type: z.literal('gradient'),
		gradient: z.string().min(1).max(1000),
	}).strict(),
	z.object({
		...layerShape,
		type: z.literal('image'),
		source: remoteMediaSourceSchema,
		fit: z.enum(MEDIA_FIT_VALUES),
	}).strict(),
	z.object({
		...layerShape,
		type: z.literal('video'),
		source: remoteMediaSourceSchema,
		fit: z.enum(MEDIA_FIT_VALUES),
		playbackRate: z.number().finite().min(MIN_GRAPHIC_MEDIA_PLAYBACK_RATE).max(MAX_GRAPHIC_MEDIA_PLAYBACK_RATE),
		loop: z.boolean(),
	}).strict(),
	z.object({
		...layerShape,
		type: z.literal('animation'),
		animation: animationEffectSelectionSchema,
	}).strict(),
]);

/** As a Screen's own stack: a guardrail on its length, and one WebGL context at most. */
const MAX_THEME_BACKGROUND_LAYERS = 20;

export const themeBackgroundLayerStackSchema: z.ZodType<ThemeBackgroundLayer[]> = z.array(layerSchema)
	.max(MAX_THEME_BACKGROUND_LAYERS)
	.refine(
		layers => layers.filter(layer => layer.type === 'animation').length <= 1,
		'A Background Layer stack carries at most one animation layer',
	) as z.ZodType<ThemeBackgroundLayer[]>;
