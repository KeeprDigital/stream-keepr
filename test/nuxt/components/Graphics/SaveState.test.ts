import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import SaveState from '~/components/Graphics/SaveState.vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';

// The one save-state display of both graphics editors: what each answer of the
// authored save reads as, and who sees it.

enableAutoUnmount(afterEach);

type SaveStateValue = 'idle' | 'saving' | 'committed' | 'failed';

function mountSaveState(props: { saveState: SaveStateValue; saveError?: string | null; writable: boolean }) {
	return mount(SaveState, { props, global: { stubs: nuxtUiStubs } });
}

const display = '[data-testid="graphics-save-state"]';
const retry = '[data-testid="graphics-save-retry"]';

describe('graphicsSaveState', () => {
	it.each<{ saveState: SaveStateValue; saveError: string | null; text: string; retry: boolean }>([
		{ saveState: 'saving', saveError: null, text: 'Saving…', retry: false },
		{ saveState: 'committed', saveError: null, text: 'Saved', retry: false },
		// The authority's own sentence: a refusal names the path it refused.
		{ saveState: 'failed', saveError: 'Graphic Asset Reference at layout.frame.asset is not selectable', text: 'Graphic Asset Reference at layout.frame.asset is not selectable', retry: true },
		{ saveState: 'failed', saveError: null, text: 'The last save failed.', retry: true },
	])('tells the lease holder a $saveState save as "$text"', ({ saveState, saveError, text, retry: offersRetry }) => {
		const wrapper = mountSaveState({ saveState, saveError, writable: true });

		const state = wrapper.get(display);
		expect(state.attributes('role')).toBe('status');
		expect(state.attributes('data-save-state')).toBe(saveState);
		expect(state.text()).toContain(text);
		expect(wrapper.find(retry).exists()).toBe(offersRetry);
	});

	// Idle has no answer yet; an observer has no save of their own to hear about.
	it.each<{ saveState: SaveStateValue; writable: boolean }>([
		{ saveState: 'idle', writable: true },
		{ saveState: 'idle', writable: false },
		{ saveState: 'saving', writable: false },
		{ saveState: 'committed', writable: false },
		{ saveState: 'failed', writable: false },
	])('shows nothing for a $saveState save when writable is $writable', ({ saveState, writable }) => {
		const wrapper = mountSaveState({ saveState, saveError: 'refused', writable });

		expect(wrapper.find(display).exists()).toBe(false);
	});

	it('asks for the failed save again on Retry', async () => {
		const wrapper = mountSaveState({ saveState: 'failed', saveError: 'refused', writable: true });

		await wrapper.get(retry).trigger('click');

		expect(wrapper.emitted('retry')).toHaveLength(1);
	});
});
