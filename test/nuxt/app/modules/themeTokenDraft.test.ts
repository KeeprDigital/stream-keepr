import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { THEME_TOKEN_DRAFT_COMMIT_MS, useThemeTokenDraft } from '~/modules/theme-editor/draft';

// A token's editor commits its draft once edits pause, or when it unmounts, and
// a value landing meanwhile never undoes an edit in progress or a write that is out.

const theme = ref('stored');
const writing = ref(false);
const commits: string[] = [];
let editDraft: (value: string) => void;
let commitDraft: (value: string) => void;
let cancelDraft: () => void;

const Harness = defineComponent({
	setup() {
		const { draft, edit, commitNow, cancel } = useThemeTokenDraft(() => theme.value, value => commits.push(value), () => writing.value);
		editDraft = edit;
		commitDraft = commitNow;
		cancelDraft = cancel;
		return () => h('output', draft.value);
	},
});

beforeEach(() => {
	vi.useFakeTimers();
	theme.value = 'stored';
	writing.value = false;
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

	it('commits a finished edit at once, dropping the pending one it replaces', async () => {
		const wrapper = mount(Harness);

		editDraft('typing');
		commitDraft('picked');
		await nextTick();
		vi.advanceTimersByTime(THEME_TOKEN_DRAFT_COMMIT_MS);

		expect(commits).toEqual(['picked']);
		expect(wrapper.text()).toBe('picked');
		wrapper.unmount();
	});

	// A Reset drops the edit still waiting, so the token is not set again after it.
	it('commits nothing once a pending edit is cancelled, and shows the Theme\'s value', async () => {
		const wrapper = mount(Harness);

		editDraft('unwanted');
		cancelDraft();
		await nextTick();
		vi.advanceTimersByTime(THEME_TOKEN_DRAFT_COMMIT_MS);

		expect(wrapper.text()).toBe('stored');
		wrapper.unmount();
		expect(commits).toEqual([]);
	});

	// Another token's answer may carry this token as it was before its own write landed.
	it('keeps a committed edit over a value landing while its write is out', async () => {
		const wrapper = mount(Harness);
		commitDraft('mine');
		writing.value = true;
		await nextTick();

		theme.value = 'landed';
		await nextTick();

		expect(wrapper.text()).toBe('mine');
		wrapper.unmount();
	});

	it.each([
		['the stored value once its write lands', 'mine', 'mine'],
		['the Theme\'s value once its write is refused', 'stored', 'stored'],
	])('shows %s', async (_case, answered, shown) => {
		const wrapper = mount(Harness);
		commitDraft('mine');
		writing.value = true;
		await nextTick();

		theme.value = answered;
		writing.value = false;
		await nextTick();

		expect(wrapper.text()).toBe(shown);
		wrapper.unmount();
	});

	it('keeps an edit made during a write when that write settles', async () => {
		const wrapper = mount(Harness);
		commitDraft('first');
		writing.value = true;
		await nextTick();

		editDraft('second');
		writing.value = false;
		await nextTick();

		expect(wrapper.text()).toBe('second');
		wrapper.unmount();
	});
});
