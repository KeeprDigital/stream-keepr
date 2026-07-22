import { describe, expect, it } from 'vitest';
import { buildFeatureMatchOverlayExportFilename } from '~/utils/exportElementPng';

describe('buildFeatureMatchOverlayExportFilename', () => {
	it('includes screen slug, mode, output, size, and timestamp', () => {
		const filename = buildFeatureMatchOverlayExportFilename({
			screenSlug: 'main-screen',
			output: 'key',
			width: 1920,
			height: 1080,
			timestamp: new Date('2026-05-20T12:34:56.000Z'),
		});

		expect(filename).toBe('main-screen-feature-match-overlay-key-1920x1080-2026-05-20T12-34-56-000Z.png');
	});
});
