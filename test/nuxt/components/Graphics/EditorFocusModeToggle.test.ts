import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import EditorFocusModeToggle from '~/components/Graphics/EditorFocusModeToggle.vue';
import { useEditorFocusMode } from '~/modules/graphics/editorFocusMode';

describe('editorFocusModeToggle', () => {
	const page = useEditorFocusMode();

	beforeEach(() => {
		page.enabled.value = false;
	});

	afterEach(() => {
		page.enabled.value = false;
		localStorage.clear();
	});

	it('enters Focus Mode, and exits it from the same visible control', async () => {
		const wrapper = await mountSuspended(EditorFocusModeToggle);
		const toggle = wrapper.get('[data-testid="editor-focus-mode-toggle"]');

		expect(toggle.attributes('aria-pressed')).toBe('false');
		expect(toggle.text()).toContain('Focus');

		await toggle.trigger('click');
		expect(page.active.value).toBe(true);
		expect(toggle.attributes('aria-pressed')).toBe('true');
		expect(toggle.text()).toContain('Exit focus');

		await toggle.trigger('click');
		expect(page.active.value).toBe(false);
		wrapper.unmount();
	});

	it('takes the page out of Focus Mode when the editor offering it closes, keeping the choice', async () => {
		const wrapper = await mountSuspended(EditorFocusModeToggle);
		await wrapper.get('[data-testid="editor-focus-mode-toggle"]').trigger('click');
		expect(page.active.value).toBe(true);

		wrapper.unmount();

		expect(page.active.value).toBe(false);
		expect(page.enabled.value).toBe(true);
	});
});
