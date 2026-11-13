import type { VueWrapper } from '@vue/test-utils';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import EventCreateModal from '~/components/Event/CreateModal.vue';

const createEvent = vi.fn(async (_input: Record<string, unknown>) => ({ id: 9 }));
mockNuxtImport('useEventStore', () => () => ({ createEvent }));

function mountModal() {
	return mount(EventCreateModal, {
		attrs: { open: true },
		global: { stubs: nuxtUiStubs },
	});
}

async function choose(wrapper: VueWrapper, field: string, label: string) {
	const select = wrapper.get(`[data-field="${field}"] select`);
	const option = select.findAll('option').find(candidate => candidate.text() === label)!;
	await select.setValue(option.attributes('value'));
}

async function create(wrapper: VueWrapper, name: string) {
	await wrapper.get('[data-field="name"] input').setValue(name);
	await wrapper.get('form').trigger('submit');
	await flushPromises();
	return createEvent.mock.calls.at(-1)![0];
}

beforeEach(() => {
	createEvent.mockClear();
	// The modal leaves for the new Event's page, which this test does not load.
	vi.spyOn(useRouter(), 'push').mockResolvedValue(undefined);
});

// Only a Magic: The Gathering Event has a Variant, chosen with its Card Game (ADR-0087).
describe('creating an Event', () => {
	it('creates a Magic: The Gathering Event as Two-Player unless a Variant is chosen', async () => {
		const wrapper = mountModal();

		expect(await create(wrapper, 'Regional')).toMatchObject({ game: 'mtg', variant: 'two-player' });
	});

	it('creates a Commander Event with its Variant and a Commander Event\'s Match Format', async () => {
		const wrapper = mountModal();
		await choose(wrapper, 'variant', 'Commander');

		expect(await create(wrapper, 'Commander Night')).toMatchObject({
			game: 'mtg',
			variant: 'commander',
			featureMatchDefaultStartingLife: 40,
			featureMatchDefaultClockType: 'untimed',
			featureMatchDefaultBestOf: 1,
		});
	});

	it('offers a One Piece Card Game Event no Variant, and sends none after one was chosen', async () => {
		const wrapper = mountModal();
		await choose(wrapper, 'variant', 'Commander');
		await choose(wrapper, 'game', 'One Piece');

		expect(wrapper.find('[data-field="variant"]').exists()).toBe(false);
		const sent = await create(wrapper, 'Treasure Cup');
		expect(sent).toMatchObject({ game: 'op', featureMatchDefaultBestOf: 1, featureMatchDefaultStartingLife: 0 });
		expect(sent).not.toHaveProperty('variant');
	});
});
