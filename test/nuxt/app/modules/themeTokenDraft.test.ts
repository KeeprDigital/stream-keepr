import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { THEME_TOKEN_DRAFT_COMMIT_MS, useThemeTokenDraft } from '~/modules/theme-editor/draft';

// A composite token's editor commits its draft once edits pause, or when it
// unmounts, and a value landing meanwhile never undoes an edit in progress.

const theme = ref('stored');
const commits: string[] = [];
let editDraft: (value: string) => void;

const Harness = defineComponent({
	setup() {
		const { draft, edit } = useThemeTokenDraft(() => theme.value, value => commits.push(value));
		editDraft = edit;
		return () => h('output', draft.value);
	},
});

beforeEach(() => {
	vi.useFakeTimers();
	theme.value = 'stored';
	commits.length = 0;
});

afterEach(() => {
	vi.useRealTimers();
});

describe('a Theme Token draft', () => {
	it('commits the last of a burst of edits once, after they pause', async () => {
		const wrapper = mount(Harness);

		editDraft('a');
		editDraft('ab');
		await nextTick();
		expect(wrapper.text()).toBe('ab');
		vi.advanceTimersByTime(THEME_TOKEN_DRAFT_COMMIT_MS - 1);
		expect(commits).toEqual([]);

		vi.advanceTimersByTime(1);
		expect(commits).toEqual(['ab']);
		wrapper.unmount();
	});

	it.each([
		['keeps an edit in progress over a value landing', true, 'mine'],
		['takes a landing value while no edit is pending', false, 'landed'],
	])('%s', async (_case, editing, shown) => {
		const wrapper = mount(Harness);
		if (editing)
			editDraft('mine');

		theme.value = 'landed';
		await nextTick();

		expect(wrapper.text()).toBe(shown);
		wrapper.unmount();
	});

	it('commits a pending edit when it unmounts', () => {
		const wrapper = mount(Harness);

		editDraft('unsaved');
		wrapper.unmount();

		expect(commits).toEqual(['unsaved']);
	});
});
