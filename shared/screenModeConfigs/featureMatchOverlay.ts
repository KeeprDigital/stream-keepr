import type { FeatureMatchLayoutConfig } from '../types/screenConfig';
import { z } from 'zod';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '../builtInFeatureMatchLayoutTemplates';
import { defineScreenModeConfigContract, serverValidatedField } from './contract';
import { editorField } from './fields';

/** The built-in Feature Match Layout Templates, by the id each has always had. */
export type BuiltInFeatureMatchLayoutTemplateId = 'full-table' | 'left-stacked-player-cams' | 'neon-feature-match' | 'commander-table';

/**
 * The Feature Match Overlay's fields: one Feature Match Layout and the Feature
 * Match Slot it renders.
 *
 * The layout's schema is large and reaches server-only Graphic Asset ids and the
 * Graphic Item caps, so the server supplies it, the same schema a Feature Match
 * Layout Template's document is proven against. It is not an authored stack: a
 * display reset restores the default layout, and `null` reads as it again.
 */
const featureMatchOverlayModeConfigShape = {
	featureMatchId: editorField(z.number().int().positive().nullable(), {
		label: 'Feature Match Slot',
		card: 'source',
		reference: 'featureMatchSlot',
	}),
	/** Edited by the graphics editor, whose inspector sections hold the overlay's Looks (ADR-0072). */
	layout: serverValidatedField<FeatureMatchLayoutConfig>({
		label: 'Layout',
		card: 'content',
		slot: 'feature-match-layout',
	}),
};

/**
 * Inferred from the contract's shape rather than from the contract, because the
 * defaults below come from the built-in Feature Match Layout Templates, which are
 * typed by it: naming the contract here would make its type depend on itself.
 */
export type FeatureMatchOverlayModeConfig = z.input<z.ZodObject<typeof featureMatchOverlayModeConfigShape, z.core.$strict>>;

/**
 * The Feature Match Overlay Screen Mode's config contract. Its defaults are the
 * `left-stacked-player-cams` built-in layout with no Feature Match Slot selected,
 * which the built-in templates module owns.
 * Nothing records which built-in a layout came from.
 */
export const featureMatchOverlayModeConfigContract = defineScreenModeConfigContract(
	featureMatchOverlayModeConfigShape,
	DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG,
	{
		groups: {
			'frame-surface': { title: 'Frame surface', card: 'content' },
			'frame-video': { title: 'Frame video', card: 'content' },
			'frame-animation': { title: 'Frame animation', card: 'content' },
			'source-appearance': { title: 'Source appearance', card: 'content' },
		},
	},
);
