import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const mocks = vi.hoisted(() => ({
	toast: { add: vi.fn() },
}));

mockNuxtImport('useToast', () => () => mocks.toast);

/** What `navigator.clipboard.writeText` does, when there is a clipboard at all. */
const writeText = vi.fn<(text: string) => Promise<void>>();
/** What `document.execCommand('copy')` answers — the value VueUse discarded (#257). */
const execCommand = vi.fn<(command: string) => boolean>();

function stubClipboardApi(present: boolean) {
	Object.defineProperty(navigator, 'clipboard', {
		value: present ? { writeText } : undefined,
		configurable: true,
		writable: true,
	});
}

describe('useCopyToClipboard', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		writeText.mockResolvedValue(undefined);
		execCommand.mockReturnValue(true);
		stubClipboardApi(true);
		Object.defineProperty(document, 'execCommand', {
			value: execCommand,
			configurable: true,
			writable: true,
		});
	});

	afterEach(() => {
		Reflect.deleteProperty(document, 'execCommand');
		Reflect.deleteProperty(navigator, 'clipboard');
	});

	it('writes the text to the clipboard and reports the success the caller named', async () => {
		const { copyToClipboard } = useCopyToClipboard();

		const result = await copyToClipboard('https://example.test/screen', {
			successTitle: 'URL Copied',
			successDescription: 'Screen URL copied to clipboard',
		});

		expect(result).toBe(true);
		expect(writeText).toHaveBeenCalledWith('https://example.test/screen');
		expect(mocks.toast.add).toHaveBeenCalledWith({
			title: 'URL Copied',
			description: 'Screen URL copied to clipboard',
			color: 'success',
		});
	});

	it('accepts refs as copy values', async () => {
		const { copyToClipboard } = useCopyToClipboard();

		await copyToClipboard(ref('ref-value'));

		expect(writeText).toHaveBeenCalledWith('ref-value');
	});

	/**
	 * A page served over plain http has no `navigator.clipboard` at all, which is an
	 * ordinary way for an operator to be reaching this app on a venue LAN. The legacy
	 * write still works there, so it is used rather than reported as a failure.
	 */
	it('falls back to the legacy write when there is no Clipboard API', async () => {
		stubClipboardApi(false);
		const { copyToClipboard } = useCopyToClipboard();

		const result = await copyToClipboard('value');

		expect(result).toBe(true);
		expect(execCommand).toHaveBeenCalledWith('copy');
		expect(mocks.toast.add).toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }));
	});

	/** Same fallback for a Clipboard API that is present and refuses the write. */
	it('falls back to the legacy write when the Clipboard API refuses', async () => {
		writeText.mockRejectedValue(new Error('NotAllowedError'));
		const { copyToClipboard } = useCopyToClipboard();

		const result = await copyToClipboard('value');

		expect(result).toBe(true);
		expect(execCommand).toHaveBeenCalledWith('copy');
	});

	/**
	 * The defect this composable was rebuilt for (#257).
	 *
	 * VueUse's `copy()` swallows a denied Clipboard API write into its `legacyCopy`,
	 * which calls `document.execCommand('copy')` and throws the boolean away — then
	 * sets `copied` true and resolves. Success and failure left the seam looking
	 * byte-for-byte identical, so an operator whose copy failed was told "URL Copied"
	 * and walked away with whatever was on their clipboard before.
	 */
	it('reports a failure when the legacy write answers that it did not copy', async () => {
		writeText.mockRejectedValue(new Error('NotAllowedError'));
		execCommand.mockReturnValue(false);
		const { copyToClipboard } = useCopyToClipboard();

		const result = await copyToClipboard('https://example.test/screen', {
			successTitle: 'URL Copied',
			successDescription: 'Screen URL copied to clipboard',
		});

		expect(result).toBe(false);
		expect(mocks.toast.add).toHaveBeenCalledTimes(1);
		expect(mocks.toast.add).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
		expect(mocks.toast.add).not.toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }));
	});

	it('leaves no textarea behind, whether the legacy write succeeded or failed', async () => {
		stubClipboardApi(false);
		const { copyToClipboard } = useCopyToClipboard();

		await copyToClipboard('value');
		execCommand.mockReturnValue(false);
		await copyToClipboard('value');

		expect(document.querySelectorAll('textarea')).toHaveLength(0);
	});

	it('does not write at all when there is no value', async () => {
		const { copyToClipboard } = useCopyToClipboard();

		const result = await copyToClipboard('', { nothingToCopyDescription: 'Nothing available.' });

		expect(result).toBe(false);
		expect(writeText).not.toHaveBeenCalled();
		expect(execCommand).not.toHaveBeenCalled();
		expect(mocks.toast.add).toHaveBeenCalledWith({
			title: 'Nothing copied',
			description: 'Nothing available.',
			color: 'error',
		});
	});

	/**
	 * The second half of #257: one error pair covered "there was nothing to hand over"
	 * and "the clipboard would not take it", so a caller naming the first necessarily
	 * mis-named the second.
	 *
	 * The split is by who knows the answer. Only the caller knows why it had nothing —
	 * on the Screen surfaces it is an asset access refusal, and telling that operator
	 * "copy failed" sends them to the address in their own browser's bar, which is the
	 * media-losing URL the refusal exists to withhold (#231, #250). Only this composable
	 * knows the clipboard would not take the write, so it owns those words outright and
	 * a caller cannot overwrite them with a reason that does not apply.
	 */
	it('names the two failures differently, and will not let a caller confuse them', async () => {
		const refusal = {
			nothingToCopyTitle: 'Nothing copied',
			nothingToCopyDescription: 'Asset access for this Screen could not be obtained.',
		};
		const { copyToClipboard } = useCopyToClipboard();

		await copyToClipboard('', refusal);
		const refused = mocks.toast.add.mock.calls[0]![0] as { title: string; description: string };

		mocks.toast.add.mockClear();
		writeText.mockRejectedValue(new Error('NotAllowedError'));
		execCommand.mockReturnValue(false);
		await copyToClipboard('https://example.test/screen', refusal);
		const failed = mocks.toast.add.mock.calls[0]![0] as { title: string; description: string };

		expect(refused.description).toBe('Asset access for this Screen could not be obtained.');
		expect(failed.description).not.toBe(refused.description);
		expect(failed.title).not.toBe(refused.title);
		// The mechanical failure says what an operator can do about it, which is the one
		// thing the refusal wording must never say: reach for the text on the page.
		expect(failed.title).toBe('Copy failed');
		expect(failed.description).toContain('clipboard');
	});
});
