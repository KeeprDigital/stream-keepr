import { describe, expect, it } from 'vitest';
import {
	ANIMATION_EFFECT_PRESET_DOCUMENT_KIND,
	ANIMATION_EFFECT_PRESET_FORMAT_VERSION,
	decodeAnimationEffectPresetDocument,
	encodeAnimationEffectPresetDocument,
	MAX_ANIMATION_EFFECT_PRESET_DOCUMENT_BYTES,
} from '../../../shared/animationEffectPresets';

function document(overrides: Record<string, unknown> = {}) {
	return JSON.stringify({
		kind: ANIMATION_EFFECT_PRESET_DOCUMENT_KIND,
		formatVersion: ANIMATION_EFFECT_PRESET_FORMAT_VERSION,
		name: 'Slow cyan fog',
		selection: { effect: 'fog', params: { speed: 0.4 } },
		...overrides,
	});
}

describe('the portable Animation Effect Preset document', () => {
	it('encodes the versioned document that a second installation can decode', () => {
		const encoded = encodeAnimationEffectPresetDocument({
			name: 'Slow cyan fog',
			selection: { effect: 'fog', params: { speed: 0.4 } },
		});

		expect(JSON.parse(encoded)).toMatchObject({
			kind: ANIMATION_EFFECT_PRESET_DOCUMENT_KIND,
			formatVersion: ANIMATION_EFFECT_PRESET_FORMAT_VERSION,
			name: 'Slow cyan fog',
			selection: { effect: 'fog', params: expect.objectContaining({ speed: 0.4 }) },
		});
		expect(decodeAnimationEffectPresetDocument(encoded)).toMatchObject({ success: true });
	});

	it('decodes one named host-neutral selection', () => {
		const decoded = decodeAnimationEffectPresetDocument(document());

		expect(decoded).toMatchObject({
			success: true,
			data: {
				name: 'Slow cyan fog',
				selection: { effect: 'fog', params: expect.objectContaining({ speed: 0.4 }) },
			},
		});
	});

	it.each([
		['another format version', { formatVersion: 2 }],
		['a host field', { selection: { effect: 'fog', enabled: true } }],
		['an unshipped effect', { selection: { effect: 'aurora' } }],
		['an invalid effect parameter', { selection: { effect: 'fog', params: { speed: 99 } } }],
	])('refuses %s', (_case, overrides) => {
		expect(decodeAnimationEffectPresetDocument(document(overrides))).toMatchObject({
			success: false,
			reason: 'invalid-document',
		});
	});

	it('distinguishes malformed JSON from a valid JSON document with invalid fields', () => {
		expect(decodeAnimationEffectPresetDocument('{')).toEqual({
			success: false,
			reason: 'malformed-json',
		});
	});

	it('refuses bytes beyond the standalone preset limit before parsing', () => {
		const oversized = ' '.repeat(MAX_ANIMATION_EFFECT_PRESET_DOCUMENT_BYTES + 1);

		expect(decodeAnimationEffectPresetDocument(oversized)).toEqual({
			success: false,
			reason: 'document-too-large',
		});
	});
});
