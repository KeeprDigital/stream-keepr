export type GraphicsVideoTarget = 'chromium' | 'safari' | 'other';

interface TargetCompatibilityFacts {
	kind: 'image' | 'silent-video' | 'font';
	hasAlpha?: boolean;
	targetCompatibility?: 'all-supported' | 'chromium-transparency';
	chromiumTransparencyPlayback?: true;
}

export function graphicAssetTargetCompatibility(
	facts: TargetCompatibilityFacts,
	target: GraphicsVideoTarget,
):
	| { outcome: 'compatible' }
	| { outcome: 'blocked'; code: 'vp9-alpha-chromium-required' } {
	if (
		facts.kind === 'silent-video'
		&& facts.hasAlpha
		&& (
			target !== 'chromium'
			|| facts.targetCompatibility !== 'chromium-transparency'
			|| facts.chromiumTransparencyPlayback !== true
		)
	) {
		return {
			outcome: 'blocked',
			code: 'vp9-alpha-chromium-required',
		};
	}
	return { outcome: 'compatible' };
}

export function graphicsVideoTargetForUserAgent(userAgent: string): GraphicsVideoTarget {
	if (/(?:Chrome|Chromium|CriOS|Edg)\//i.test(userAgent))
		return 'chromium';
	if (/AppleWebKit/i.test(userAgent))
		return 'safari';
	return 'other';
}
