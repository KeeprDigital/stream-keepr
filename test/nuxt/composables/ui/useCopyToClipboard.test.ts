import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const mocks = vi.hoisted(() => ({
	copy: vi.fn(),
	isSupported: { value: true },
	copied: { value: false },
	toast: { add: vi.fn() },
}));

mockNuxtImport('useToast', () => () => mocks.toast);
mockNuxtImport('useClipboard', () => () => ({
	copy: mocks.copy,
	copied: mocks.copied,
	isSupported: mocks.isSupported,
}));

describe('useCopyToClipboard', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isSupported.value = true;
		mocks.copied.value = false;
	});

	it('copies text with useClipboard and shows success feedback', async () => {
		mocks.copy.mockResolvedValue(undefined);
		const { copyToClipboard } = useCopyToClipboard();

		const result = await copyToClipboard('https://example.test/screen', {
			successTitle: 'URL Copied',
			successDescription: 'Screen URL copied to clipboard',
		});

		expect(result).toBe(true);
		expect(mocks.copy).toHaveBeenCalledWith('https://example.test/screen');
		expect(mocks.toast.add).toHaveBeenCalledWith({
			title: 'URL Copied',
			description: 'Screen URL copied to clipboard',
			color: 'success',
		});
	});

	it('accepts refs as copy values', async () => {
		mocks.copy.mockResolvedValue(undefined);
		const { copyToClipboard } = useCopyToClipboard();

		await copyToClipboard(ref('ref-value'));

		expect(mocks.copy).toHaveBeenCalledWith('ref-value');
	});

	it('does not call useClipboard copy when there is no value', async () => {
		const { copyToClipboard } = useCopyToClipboard();

		const result = await copyToClipboard('', { errorDescription: 'Nothing available.' });

		expect(result).toBe(false);
		expect(mocks.copy).not.toHaveBeenCalled();
		expect(mocks.toast.add).toHaveBeenCalledWith({
			title: 'Copy failed',
			description: 'Nothing available.',
			color: 'error',
		});
	});

	it('shows unsupported feedback when clipboard access is unavailable', async () => {
		mocks.isSupported.value = false;
		const { copyToClipboard } = useCopyToClipboard();

		const result = await copyToClipboard('value');

		expect(result).toBe(false);
		expect(mocks.copy).not.toHaveBeenCalled();
		expect(mocks.toast.add).toHaveBeenCalledWith({
			title: 'Copy failed',
			description: 'Clipboard access is not available in this browser.',
			color: 'error',
		});
	});

	it('shows failure feedback when useClipboard copy rejects', async () => {
		mocks.copy.mockRejectedValue(new Error('denied'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { copyToClipboard } = useCopyToClipboard();

		const result = await copyToClipboard('value', { errorDescription: 'Unable to copy URL.' });

		expect(result).toBe(false);
		expect(mocks.toast.add).toHaveBeenCalledWith({
			title: 'Copy failed',
			description: 'Unable to copy URL.',
			color: 'error',
		});

		consoleError.mockRestore();
	});
});
