import { describe, expect, it } from 'vitest';
import {
	graphicAssetTargetCompatibility,
	graphicsVideoTargetForUserAgent,
} from '~~/shared/utils/graphicAssetTargetCompatibility';

describe('silent-video target compatibility', () => {
	it('blocks VP9 alpha on Safari and permits it only with recorded Chromium proof', () => {
		const restricted = {
			kind: 'silent-video',
			hasAlpha: true,
			targetCompatibility: 'chromium-transparency',
			chromiumTransparencyPlayback: true,
		} as const;

		expect(graphicAssetTargetCompatibility(restricted, 'safari')).toEqual({
			outcome: 'blocked',
			code: 'vp9-alpha-chromium-required',
		});
		expect(graphicAssetTargetCompatibility(restricted, 'chromium')).toEqual({
			outcome: 'compatible',
		});
		expect(graphicAssetTargetCompatibility({
			...restricted,
			chromiumTransparencyPlayback: undefined,
		}, 'chromium')).toEqual({
			outcome: 'blocked',
			code: 'vp9-alpha-chromium-required',
		});
		expect(graphicAssetTargetCompatibility(restricted, 'other')).toEqual({
			outcome: 'blocked',
			code: 'vp9-alpha-chromium-required',
		});
		expect(graphicAssetTargetCompatibility({
			...restricted,
			targetCompatibility: 'all-supported',
		}, 'chromium')).toEqual({
			outcome: 'blocked',
			code: 'vp9-alpha-chromium-required',
		});
	});

	it('allows ordinary image and opaque silent-video media on both targets', () => {
		expect(graphicAssetTargetCompatibility({ kind: 'image' }, 'safari').outcome).toBe('compatible');
		expect(graphicAssetTargetCompatibility({
			kind: 'silent-video',
			hasAlpha: false,
			targetCompatibility: 'all-supported',
		}, 'safari').outcome).toBe('compatible');
	});

	it('classifies every iOS WebKit browser as Safari-targeted', () => {
		expect(graphicsVideoTargetForUserAgent(
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.119 Mobile/15E148 Safari/604.1',
		)).toBe('safari');
		expect(graphicsVideoTargetForUserAgent(
			'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/138.0 Mobile/15E148 Safari/605.1.15',
		)).toBe('safari');
	});
});
