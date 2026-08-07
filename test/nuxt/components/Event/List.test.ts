import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { transportFailure } from '~~/test/helpers/transportFailure';

const UCardStub = defineComponent({
	template: '<div><slot /></div>',
});

const UButtonStub = defineComponent({
	emits: ['click'],
	template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
});

async function mountComponent(error: Error | null) {
	const { default: EventList } = await import('~/components/Event/List.vue');

	return mount(EventList, {
		props: { loading: false, error, events: [] },
		global: {
			stubs: {
				UCard: UCardStub,
				UButton: UButtonStub,
				UIcon: true,
				UILoadingSpinner: true,
				EventListItem: true,
			},
		},
	});
}

/**
 * The events list is the first thing anyone sees, and the only surface that reports a
 * failure of the Event store's loads.
 *
 * Those loads report the sentence to `eventStore.error` and re-raise the ORIGINAL failure,
 * deliberately — the store has no business narrowing what it hands on (#262). So the raised
 * object reaching this component is a `FetchError` whose own `message` is the transport's
 * line, and rendering it is what showed operators '[GET] "/api/events": 403 Forbidden' in
 * place of the reason they were refused (#271).
 */
describe('eventList', () => {
	it('shows the sentence the server wrote about a refused load', async () => {
		const wrapper = await mountComponent(transportFailure({
			status: 403,
			body: { message: 'This Event belongs to another installation' },
			request: `[GET] "/api/events"`,
		}));

		expect(wrapper.text()).toContain('This Event belongs to another installation');
		expect(wrapper.text()).not.toContain('403');
	});

	/**
	 * A 5xx has had its prose replaced with a placeholder on the way out, so there is
	 * nothing to quote — the transport line is what an operator gets, and it reads as
	 * machinery rather than as the authority's words. The body here is deliberately
	 * distinctive: it proves the read did not happen at all, which asserting against
	 * 'Internal Server Error' could not, since the status line contains that phrase.
	 */
	it('never shows a 5xx body detail as though the server had written it', async () => {
		const wrapper = await mountComponent(transportFailure({
			status: 500,
			body: { message: 'D1_ERROR: no such table: events' },
			request: `[GET] "/api/events"`,
		}));

		expect(wrapper.text()).not.toContain('D1_ERROR');
		expect(wrapper.text()).toContain('[GET] "/api/events": 500 Internal Server Error');
	});

	it('shows an ordinary failure its own message', async () => {
		const wrapper = await mountComponent(new Error('Network unavailable'));

		expect(wrapper.text()).toContain('Network unavailable');
	});

	it('offers the retry the operator needs to get past a failure', async () => {
		const wrapper = await mountComponent(transportFailure({ status: 409 }));

		await wrapper.get('button').trigger('click');

		expect(wrapper.emitted('loadEventsList')).toHaveLength(1);
	});
});
