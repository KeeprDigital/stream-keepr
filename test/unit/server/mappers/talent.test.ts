import { describe, expect, it } from 'vitest';
import { mapTalentToResponse } from '~~/server/mappers/talent';
import { createMockTalent } from '~~/test/helpers/fixtures';

describe('talent mapper', () => {
	it('projects the handle columns into a Social Profile map', () => {
		const result = mapTalentToResponse(createMockTalent({
			twitchHandle: 'Marshall_LR',
			xHandle: 'Marshall_LR',
		}));

		expect(result.socialProfiles).toEqual({
			twitch: 'Marshall_LR',
			x: 'Marshall_LR',
		});
		expect(result).not.toHaveProperty('twitchHandle');
		expect(result).not.toHaveProperty('youtubeHandle');
	});

	it('leaves blank handles out of the Social Profile map', () => {
		const result = mapTalentToResponse(createMockTalent({
			twitchHandle: '',
			blueskyHandle: 'marshall.bsky.social',
		}));

		expect(result.socialProfiles).toEqual({ bluesky: 'marshall.bsky.social' });
	});

	it('always exposes an empty Social Profile map for an existing Talent', () => {
		expect(mapTalentToResponse(createMockTalent()).socialProfiles).toEqual({});
	});

	it.each([
		['no photo', null, null],
		[
			'a photo',
			{ assetId: 'asset-1', revisionId: 'revision-1' },
			{ assetId: 'asset-1', revisionId: 'revision-1' },
		],
	] as const)('exposes %s and keeps its index version internal', (_case, photo, expected) => {
		const result = mapTalentToResponse(createMockTalent({
			photo: photo as never,
			graphicAssetReferenceVersion: 'version-1',
		}));

		expect(result.photo).toEqual(expected);
		expect(result).not.toHaveProperty('graphicAssetReferenceVersion');
	});
});
