import { afterEach, describe, expect, it, vi } from 'vitest';

function withUserAgent(userAgent: string) {
	vi.stubGlobal('navigator', { userAgent });
}

describe('useGraphicsVideoTarget', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each([
		['a Chromium browser', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'chromium'],
		['desktop Safari', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15', 'safari'],
		['an iOS Chromium build, which still renders with WebKit', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1', 'safari'],
		['an unrecognised engine', 'SomeBroadcastAppliance/1.0', 'other'],
	])('classifies %s', (_name, userAgent, expected) => {
		withUserAgent(userAgent);

		const target = useGraphicsVideoTarget();

		expect(target.value).toBe(expected);
	});
});
