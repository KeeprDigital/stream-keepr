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

/**
 * A media Graphic Input's authored default names a Graphic Asset Revision exactly
 * as a Media Graphic Item's content does, so the same discovery walk has to find
 * it: what a Screen publishes is what its Screen Output Asset Capability resolves,
 * and a default nothing indexed is an asset the live output cannot fetch (#96).
 */

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
		graphics: [{
			id: 'lower-third',
			name: 'Lower Third',
			items: [],
			inputs,
		} as unknown as BroadcastGraphicConfig],
	} as BroadcastGraphicsModeConfig;
}

describe('media Graphic Input default references', () => {
	it('publishes an authored default, named by the Graphic Input that pins it', () => {
		expect(broadcastGraphicsGraphicAssetReferences(graphic([mediaInput('logo', { default: sponsor })])))
			.toEqual([{
				reference: sponsor,
				ownerSlot: 'graphics.lower-third.inputs.logo.default',
				kind: 'image',
			}]);
	});

	it('carries a silent-video default’s pinned target compatibility, as an item’s content does', () => {
		// Without the fact the reference-index predicate has nothing to compare, and
		// the write's precondition is lost silently rather than refused.
		const references = broadcastGraphicsGraphicAssetReferences(graphic([mediaInput('sting', {
			mediaKind: 'silent-video',
			default: { ...sting, videoCompatibility: 'chromium-transparency' },
		})]));

		expect(references).toEqual([{
			reference: sting,
			ownerSlot: 'graphics.lower-third.inputs.sting.default',
			kind: 'silent-video',
			videoCompatibility: 'chromium-transparency',
			videoTarget: 'chromium',
		}]);
	});

	it('publishes nothing for a media Graphic Input with no default', () => {
		expect(broadcastGraphicsGraphicAssetReferences(graphic([mediaInput('logo')]))).toEqual([]);
	});

	it('resolves a Broadcast Graphics Screen Output through both of its owner-slot namespaces', () => {
		// Authored configuration and the Live Session publish into separate namespaces
		// so neither write can clear the other's rows — but a Screen Output has to
		// resolve both, because both are on air.
		expect(screenOutputResolvableSlotPrefixes('broadcast-graphics')).toEqual(['graphics.', 'liveSession.']);
		expect(screenOutputResolvableSlotPrefixes('feature-match-overlay')).toEqual(['layout.']);
	});
});
