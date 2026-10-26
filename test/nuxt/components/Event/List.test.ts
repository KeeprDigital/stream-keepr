import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { transportFailure } from '~~/test/helpers/transportFailure';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import EventList from '~/components/Event/List.vue';

function mountList(error: Error | null) {
	return mount(EventList, {
		props: { loading: false, error, events: [] },
		global: {
			stubs: { ...nuxtUiStubs, UILoadingSpinner: true, EventListItem: true },
		},
	});
}

// The only surface for the Event store's load failures. Which sentence a failure
// reads as is `failureSentence`'s test; this proves the list routes through it.
describe('eventList', () => {
	it('shows the sentence the server wrote about a refused load, not the transport line (#271)', () => {
		const wrapper = mountList(transportFailure({
			status: 403,
			body: { message: 'This Event belongs to another installation' },
			request: `[GET] "/api/events"`,
		}));

		expect(wrapper.text()).toContain('This Event belongs to another installation');
		expect(wrapper.text()).not.toContain('403');
	});

	it('offers a retry past a failure', async () => {
		const wrapper = mountList(transportFailure({ status: 409 }));

		await wrapper.get('button').trigger('click');

		expect(wrapper.emitted('loadEventsList')).toHaveLength(1);
	});
});
