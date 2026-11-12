import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ReviewToolbar from '~/components/Archetype/ReviewToolbar.vue';

function mountToolbar(props: { currentIndex?: number; canGoBack?: boolean; canAdvance?: boolean } = {}) {
	return mount(ReviewToolbar, {
		props: {
			currentIndex: 0,
			canGoBack: true,
			canAdvance: true,
			filteredCount: 3,
			queueFilter: 'unreviewed',
			reviewedCount: 1,
			totalDecks: 4,
			progressPercent: 25,
			initialLoading: false,
			entries: [],
			...props,
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				UDashboardToolbar: { template: '<div><slot name="left" /><slot name="right" /></div>' },
				UProgress: true,
			},
		},
	});
}

describe('archetype review toolbar', () => {
	it.each([
		[
			'Previous deck',
			'back',
			{ canGoBack: false },
		],
		[
			'Next deck',
			'advance',
			{ canAdvance: false },
		],
	] as const)('steps with %s, unless the queue has nowhere to go', async (label, event, nowhere) => {
		const wrapper = mountToolbar();
		await wrapper.get(`[aria-label="${label}"]`).trigger('click');
		expect(wrapper.emitted(event)).toHaveLength(1);

		expect(mountToolbar(nowhere).get(`[aria-label="${label}"]`).attributes('disabled')).toBeDefined();
	});

	it.each([
		['its place in the list', 1, '2 of 3'],
		['no place for a deck outside the list', -1, '– of 3'],
	])('shows %s', (_, currentIndex, text) => {
		expect(mountToolbar({ currentIndex }).get('[data-deck-position]').text()).toBe(text);
	});
});
