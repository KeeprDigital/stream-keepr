import { describe, expect, it } from 'vitest';
import { processSilentVideo } from '~~/server/modules/graphics-asset-library/silent-video';
import { silentVideoFixtures } from '~~/test/helpers/graphicsFixtures';

describe('silent-video validator acceptance fixtures', () => {
	it.each(Object.entries(silentVideoFixtures))('embeds exactly the facts the bounded inspector derives for %s', async (name, { bytes, facts }) => {
		const processed = await processSilentVideo(bytes, {
			sourceFileName: facts.canonicalMime === 'video/mp4'
				? `${name}.mp4`
				: `${name}.webm`,
			declaredMime: facts.canonicalMime,
		});

		expect(processed.report.outcome).toBe('accepted');
		expect(processed.report.facts).toEqual(facts);
	});

	// The acceptance harness proves both compatibility targets, so the set must hold one of each.
	it('covers both compatibility targets, VP9 alpha included', () => {
		expect(silentVideoFixtures.vp9AlphaWebm.facts).toMatchObject({ hasAlpha: true, targetCompatibility: 'chromium-transparency' });
		expect(silentVideoFixtures.h264Mp4.facts).toMatchObject({ hasAlpha: false, targetCompatibility: 'all-supported', fastStart: true });
	});
});
