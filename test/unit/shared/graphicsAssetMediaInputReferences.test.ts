import type {
	BroadcastGraphicConfig,
	MediaGraphicInputDeclaration,
} from '~~/shared/types/graphics';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { BroadcastGraphicsModeConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import {
	broadcastGraphicsGraphicAssetReferences,
	screenOutputResolvableSlotPrefixes,
} from '~~/shared/utils/graphicsAssetReferences';

// A media Graphic Input's default is found by the same discovery walk as item content,
// or the live output cannot fetch it (#96).

function reference(assetId: string, revisionId: string): GraphicAssetReference {
	return {
		assetId: assetId as GraphicAssetReference['assetId'],
		revisionId: revisionId as GraphicAssetReference['revisionId'],
	};
}

const sponsor = reference('image-asset', 'image-revision-1');
const sting = reference('video-asset', 'video-revision-1');

function mediaInput(
	key: string,
	overrides: Partial<MediaGraphicInputDeclaration> = {},
): MediaGraphicInputDeclaration {
	return {
		type: 'media',
		key,
		label: key,
		required: false,
		updatePolicy: 'staged',
		mediaKind: 'image',
		default: null,
		...overrides,
	};
}

function graphic(inputs: MediaGraphicInputDeclaration[]): BroadcastGraphicsModeConfig {
	return {
		graphics: [
			{
				id: 'lower-third',
				name: 'Lower Third',
				items: [],
				inputs,
			} as unknown as BroadcastGraphicConfig,
		],
	} as BroadcastGraphicsModeConfig;
}

describe('media Graphic Input default references', () => {
	it('publishes an authored default, named by the Graphic Input that pins it', () => {
		expect(broadcastGraphicsGraphicAssetReferences(graphic([
			mediaInput('logo', { default: sponsor }),
		])))
			.toEqual([
				{
					reference: sponsor,
					ownerSlot: 'graphics.lower-third.inputs.logo.default',
					kind: 'image',
				},
			]);
	});

	it('publishes a silent-video default as its exact revision, as an item’s content is', () => {
		const references = broadcastGraphicsGraphicAssetReferences(graphic([
			mediaInput('sting', {
				mediaKind: 'silent-video',
				default: sting,
			}),
		]));

		expect(references).toEqual([
			{
				reference: sting,
				ownerSlot: 'graphics.lower-third.inputs.sting.default',
				kind: 'silent-video',
			},
		]);
	});

	it('publishes nothing for a media Graphic Input with no default', () => {
		expect(broadcastGraphicsGraphicAssetReferences(graphic([
			mediaInput('logo'),
		]))).toEqual([]);
	});

	it('resolves a Broadcast Graphics Screen Output through both of its owner-slot namespaces', () => {
		// Authored configuration and the Live Session publish into separate namespaces
		// so neither write can clear the other's rows — but a Screen Output has to
		// resolve both, because both are on air.
		expect(screenOutputResolvableSlotPrefixes('broadcast-graphics')).toEqual(['graphics.', 'liveSession.']);
		expect(screenOutputResolvableSlotPrefixes('feature-match-overlay')).toEqual(['layout.']);
	});
});
