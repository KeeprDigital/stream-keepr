import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

mockNuxtImport('$fetch', () => mockApiFetch);

const capability = 'HG7fQ2mS4kLp9xRt0ZbNvCyE1JdWqUoA3hMi5nTgKrs';

const screen = { eventId: 7, screenId: 3, screenSlug: 'main' };

describe('useScreenOutputAccessUrl', () => {
	beforeEach(() => {
		mockApiFetch.mockReset();
		mockApiFetch.mockResolvedValue({ assetCapability: capability });
	});

	it('carries the capability in the fragment, where a navigation never sends it', async () => {
		const { screenOutputAccessUrl } = useScreenOutputAccessUrl();

		expect(await screenOutputAccessUrl(screen)).toBe(
			`${window.location.origin}/event/7/screen/main?output=overlay#asset-capability=${capability}`,
		);
		expect(await screenOutputAccessUrl({ ...screen, output: 'key' })).toBe(
			`${window.location.origin}/event/7/screen/main?output=key#asset-capability=${capability}`,
		);
		expect(mockApiFetch).toHaveBeenCalledWith('/api/events/7/screens/3/asset-capability');
	});

	/**
	 * The property the whole composable exists for.
	 *
	 * A URL built from a capability fetched when the page loaded is the same URL as
	 * one built from no capability at all whenever that fetch had not landed, or had
	 * failed, or has since been rotated — and a Screen Output opened with it renders
	 * everything except media, silently (#231).
	 */
	it('obtains the capability once per hand-out rather than reusing an earlier one', async () => {
		const { screenOutputAccessUrl } = useScreenOutputAccessUrl();

		await screenOutputAccessUrl(screen);
		mockApiFetch.mockResolvedValue({ assetCapability: 'rotated_capability_value_0123456789' });

		expect(await screenOutputAccessUrl(screen)).toBe(
			`${window.location.origin}/event/7/screen/main?output=overlay#asset-capability=rotated_capability_value_0123456789`,
		);
		expect(mockApiFetch).toHaveBeenCalledTimes(2);
	});

	/**
	 * Refused rather than degraded. The caller's copy and open controls both already
	 * report having nothing, which costs an operator a retry — where handing out the
	 * URL without the capability costs them their media on program and says nothing.
	 */
	it('hands out nothing at all when the capability cannot be obtained', async () => {
		mockApiFetch.mockRejectedValue(new Error('unavailable'));
		const { screenOutputAccessUrl } = useScreenOutputAccessUrl();

		expect(await screenOutputAccessUrl(screen)).toBe('');
	});

	it('opens the output in a tab it points only once the capability is in hand', async () => {
		const outputWindow = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
		vi.stubGlobal('open', vi.fn(() => outputWindow));
		const { openScreenOutput } = useScreenOutputAccessUrl();

		await openScreenOutput(screen);

		expect(window.open).toHaveBeenCalledWith('', '_blank');
		expect(outputWindow.opener).toBeNull();
		expect(outputWindow.location.href).toBe(
			`${window.location.origin}/event/7/screen/main?output=overlay#asset-capability=${capability}`,
		);
		expect(outputWindow.close).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	/**
	 * A PNG capture is a hand-out too, and the quietest one: the file arrives, looks
	 * like a rendered output, and is missing every asset the Screen publishes.
	 */
	it('carries the capability into a PNG capture, and answers whether it opened one', async () => {
		const outputWindow = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
		vi.stubGlobal('open', vi.fn(() => outputWindow));
		const { screenOutputAccessUrl, openScreenOutput } = useScreenOutputAccessUrl();

		expect(await screenOutputAccessUrl({ ...screen, output: 'fill', download: true })).toBe(
			`${window.location.origin}/event/7/screen/main?output=fill&download=1#asset-capability=${capability}`,
		);
		expect(await openScreenOutput({ ...screen, download: true })).toBe(true);

		mockApiFetch.mockRejectedValue(new Error('unavailable'));
		expect(await openScreenOutput({ ...screen, download: true })).toBe(false);
		vi.unstubAllGlobals();
	});

	it('closes the tab it opened rather than leaving an output that cannot resolve media', async () => {
		mockApiFetch.mockRejectedValue(new Error('unavailable'));
		const outputWindow = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
		vi.stubGlobal('open', vi.fn(() => outputWindow));
		const { openScreenOutput } = useScreenOutputAccessUrl();

		await openScreenOutput(screen);

		expect(outputWindow.location.href).toBe('');
		expect(outputWindow.close).toHaveBeenCalledOnce();
		vi.unstubAllGlobals();
	});
});
