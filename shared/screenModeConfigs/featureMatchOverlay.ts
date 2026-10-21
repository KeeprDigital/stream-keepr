import type { FeatureMatchLayoutConfig } from '../types/screenConfig';
import { z } from 'zod';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '../featureMatchOverlayPresets';
import { defineScreenModeConfigContract, serverValidatedField } from './contract';

export const FEATURE_MATCH_OVERLAY_PRESET_ID_VALUES = ['full-table', 'left-stacked-player-cams', 'neon-feature-match'] as const;

export type FeatureMatchOverlayPresetId = typeof FEATURE_MATCH_OVERLAY_PRESET_ID_VALUES[number];

/**
 * The Feature Match Overlay's fields: one Feature Match Layout, the Feature Match
 * Slot it renders, and the preset it was initialised from.
 *
 * The layout's schema is large and reaches server-only Graphic Asset ids and the
 * Graphic Item caps, so the server supplies it, the same schema a Feature Match
 * Layout Template's document is proven against. It is not an authored stack: a
 * display reset restores a preset, and `null` reads as the default layout again.
 */
const featureMatchOverlayModeConfigShape = {
	featureMatchId: z.number().int().positive().nullable(),
	presetId: z.enum(FEATURE_MATCH_OVERLAY_PRESET_ID_VALUES),
	layout: serverValidatedField<FeatureMatchLayoutConfig>(),
};

/**
 * Inferred from the contract's shape rather than from the contract, because the
 * defaults below come from the Feature Match Overlay Presets, which are typed by
 * it: naming the contract here would make its type depend on itself.
 */
export type FeatureMatchOverlayModeConfig = z.input<z.ZodObject<typeof featureMatchOverlayModeConfigShape, z.core.$strict>>;

/**
 * The Feature Match Overlay Screen Mode's config contract. Its defaults are the
 * `left-stacked-player-cams` preset with no Feature Match Slot selected, which the
 * presets module owns.
 */
export const featureMatchOverlayModeConfigContract = defineScreenModeConfigContract(
	featureMatchOverlayModeConfigShape,
	DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG,
);
