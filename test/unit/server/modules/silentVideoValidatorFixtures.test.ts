import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { processSilentVideo } from '~~/server/modules/graphics-asset-library/silent-video';

interface EmbeddedFixture {
	base64: string;
	facts: Record<string, unknown> & { canonicalMime: string };
}

const fixturesUrl = new URL(
	'../../../../scripts/silent-video-validator-fixtures.json',
	import.meta.url,
);

describe('silent-video validator acceptance fixtures', () => {
	it('embeds exactly the facts the bounded inspector derives', async () => {
		const fixtures = JSON.parse(
			await readFile(fixturesUrl, 'utf8'),
		) as Record<string, EmbeddedFixture>;
		expect(Object.keys(fixtures).toSorted()).toEqual(['h264Mp4', 'vp9AlphaWebm', 'vp9Webm']);
		for (const [name, fixture] of Object.entries(fixtures)) {
			const bytes = Uint8Array.from(atob(fixture.base64), character => character.charCodeAt(0));
			const processed = await processSilentVideo(bytes, {
				sourceFileName: fixture.facts.canonicalMime === 'video/mp4' ? `${name}.mp4` : `${name}.webm`,
				declaredMime: fixture.facts.canonicalMime,
			});
			expect(processed.report.outcome).toBe('accepted');
			expect(processed.report.facts).toEqual(fixture.facts);
		}
	});

	it('covers both compatibility targets including VP9 alpha', async () => {
		const fixtures = JSON.parse(
			await readFile(fixturesUrl, 'utf8'),
		) as Record<string, EmbeddedFixture>;
		expect(fixtures.vp9AlphaWebm!.facts).toMatchObject({
			hasAlpha: true,
			targetCompatibility: 'chromium-transparency',
		});
		expect(fixtures.h264Mp4!.facts).toMatchObject({
			hasAlpha: false,
			targetCompatibility: 'all-supported',
			fastStart: true,
		});
	});
});
