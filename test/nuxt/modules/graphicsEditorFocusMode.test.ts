import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';

const STORAGE_KEY = 'editor-focusMode';

/**
 * The module holds one setting per document, so each test imports it fresh
 * rather than reaching for a reset only tests would ever call.
 */
async function freshModule() {
	vi.resetModules();
	return import('~/modules/graphics/editorFocusMode');
}

/** An editor where Editor Focus Mode applies, open until the returned scope stops. */
function openEditor(module: Awaited<ReturnType<typeof freshModule>>) {
	const scope = effectScope();
	const focusMode = scope.run(() => module.useEditorFocusModeHost())!;
	return { focusMode, close: () => scope.stop() };
}

describe('editor Focus Mode', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		localStorage.clear();
	});

	it('is off in a browser that never chose it', async () => {
		const module = await freshModule();
		const { focusMode } = openEditor(module);

		expect(focusMode.enabled.value).toBe(false);
		expect(focusMode.active.value).toBe(false);
	});

	it('enters and exits through its toggle, and remembers the choice in this browser', async () => {
		const module = await freshModule();
		const { focusMode } = openEditor(module);

		focusMode.toggle();
		expect(focusMode.active.value).toBe(true);
		expect(localStorage.getItem(STORAGE_KEY)).toBe('on');

		focusMode.toggle();
		expect(focusMode.active.value).toBe(false);
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it('reopens in Focus Mode after a reload when it was left on', async () => {
		localStorage.setItem(STORAGE_KEY, 'on');
		const module = await freshModule();

		expect(openEditor(module).focusMode.active.value).toBe(true);
	});

	it('is one setting shared by every editor and by the page around them', async () => {
		const module = await freshModule();
		const featureMatchOverlay = openEditor(module);
		const page = module.useEditorFocusMode();

		featureMatchOverlay.focusMode.toggle();
		featureMatchOverlay.close();
		expect(page.active.value).toBe(false);

		const broadcastGraphics = openEditor(module);
		expect(broadcastGraphics.focusMode.active.value).toBe(true);
		expect(page.active.value).toBe(true);
	});

	it('applies only while an editor is open, keeping the choice for the next one', async () => {
		localStorage.setItem(STORAGE_KEY, 'on');
		const module = await freshModule();
		const page = module.useEditorFocusMode();

		expect(page.enabled.value).toBe(true);
		expect(page.active.value).toBe(false);

		const editor = openEditor(module);
		expect(page.active.value).toBe(true);

		editor.close();
		expect(page.active.value).toBe(false);
		expect(page.enabled.value).toBe(true);
	});

	it('still toggles for this visit in a browser that refuses storage', async () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new DOMException('denied', 'SecurityError');
		});
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('denied', 'SecurityError');
		});
		vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
			throw new DOMException('denied', 'SecurityError');
		});
		const module = await freshModule();
		const { focusMode } = openEditor(module);

		expect(focusMode.active.value).toBe(false);
		focusMode.toggle();
		expect(focusMode.active.value).toBe(true);
		expect(module.useEditorFocusMode().active.value).toBe(true);
		focusMode.toggle();
		expect(focusMode.active.value).toBe(false);
	});
});
