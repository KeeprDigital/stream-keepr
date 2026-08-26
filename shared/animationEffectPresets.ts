import type { AnimationEffectSelection } from './animationEffects';
import { z } from 'zod';
import { animationEffectSelectionSchema } from './animationEffects';

export const ANIMATION_EFFECT_PRESET_DOCUMENT_KIND = 'stream-keepr-animation-effect-preset' as const;
export const ANIMATION_EFFECT_PRESET_FORMAT_VERSION = 1 as const;
export const MAX_ANIMATION_EFFECT_PRESET_DOCUMENT_BYTES = 16 * 1024;

export const animationEffectPresetNameSchema = z.string().trim().min(1).max(100);

export const animationEffectPresetDocumentSchema = z.strictObject({
	kind: z.literal(ANIMATION_EFFECT_PRESET_DOCUMENT_KIND),
	formatVersion: z.literal(ANIMATION_EFFECT_PRESET_FORMAT_VERSION),
	name: animationEffectPresetNameSchema,
	selection: animationEffectSelectionSchema,
});

export type AnimationEffectPresetDocument = z.input<typeof animationEffectPresetDocumentSchema>;

export interface PortableAnimationEffectPreset {
	name: string;
	selection: AnimationEffectSelection;
}

export type AnimationEffectPresetDocumentDecodeResult
	= | {
		success: true;
		data: {
			kind: typeof ANIMATION_EFFECT_PRESET_DOCUMENT_KIND;
			formatVersion: typeof ANIMATION_EFFECT_PRESET_FORMAT_VERSION;
			name: string;
			selection: AnimationEffectSelection;
		};
	}
	| {
		success: false;
		reason: 'document-too-large' | 'malformed-json' | 'invalid-document';
	};

/** Encode a library entry without its installation-local identity or revision. */
export function encodeAnimationEffectPresetDocument(preset: PortableAnimationEffectPreset): string {
	const document = animationEffectPresetDocumentSchema.parse({
		kind: ANIMATION_EFFECT_PRESET_DOCUMENT_KIND,
		formatVersion: ANIMATION_EFFECT_PRESET_FORMAT_VERSION,
		name: preset.name,
		selection: preset.selection,
	});
	return JSON.stringify(document, null, 2);
}

/** Decode one standalone preset before it crosses into the installation library. */
export function decodeAnimationEffectPresetDocument(text: string): AnimationEffectPresetDocumentDecodeResult {
	if (new TextEncoder().encode(text).byteLength > MAX_ANIMATION_EFFECT_PRESET_DOCUMENT_BYTES)
		return { success: false, reason: 'document-too-large' };

	let value: unknown;
	try {
		value = JSON.parse(text);
	}
	catch {
		return { success: false, reason: 'malformed-json' };
	}

	const outcome = animationEffectPresetDocumentSchema.safeParse(value);
	if (!outcome.success)
		return { success: false, reason: 'invalid-document' };

	return { success: true, data: outcome.data };
}
