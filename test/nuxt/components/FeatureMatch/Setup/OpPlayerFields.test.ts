import type { OpPlayerGameData } from '~~/shared/types/game';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { opCardSummary, ZORO } from '~~/test/helpers/opCards';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import OpPlayerFields from '~/components/FeatureMatch/Setup/OpPlayerFields.vue';

// A Slot side's Leader picker. The Event's `op-cards` route is faked at `$fetch`.

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useEventStore', () => () => ({ eventId: 7 }));

function mountFields(gameData: OpPlayerGameData = { type: 'op', leader: null }) {
	const updates: OpPlayerGameData[] = [];
	const wrapper = mount(OpPlayerFields, {
		props: {
			'modelValue': gameData,
			'onUpdate:modelValue': (value: OpPlayerGameData) => {
				updates.push(value);
				void wrapper.setProps({ modelValue: value });
			},
		},
		global: { stubs: nuxtUiStubs },
	});
	return { wrapper, updates };
}

async function search(wrapper: ReturnType<typeof mountFields>['wrapper'], text: string) {
	const input = wrapper.get('input[aria-label="Search Leaders"]');
	await input.setValue(text);
	await input.trigger('keydown', { key: 'Enter' });
	await flushPromises();
}

describe('a Slot side\'s Leader picker', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		mockFetch.mockResolvedValue({
			available: true,
			items: [
				opCardSummary(),
			],
			total: 1,
		});
	});

	it('searches only Leaders', async () => {
		const { wrapper } = mountFields();

		await search(wrapper, 'zoro');

		expect(mockFetch).toHaveBeenLastCalledWith('/api/events/7/op-cards', expect.objectContaining({
			query: { q: 'zoro', category: 'leader' },
		}));
	});

	it('holds the picked Leader as a snapshot of its card', async () => {
		const { wrapper, updates } = mountFields();

		await search(wrapper, 'zoro');
		await wrapper.get('button[aria-label="Pick Leader Roronoa Zoro (OP01-001)"]').trigger('click');

		expect(updates.at(-1)).toEqual({ type: 'op', leader: ZORO });
		expect(wrapper.get('[data-leader]').text()).toContain('Roronoa Zoro');
		expect(wrapper.get('[data-leader] [data-op-colors]').attributes('aria-label')).toBe('Red');
	});

	it('clears the side\'s Leader', async () => {
		const { wrapper, updates } = mountFields({ type: 'op', leader: ZORO });

		await wrapper.get('button[aria-label="Clear Leader"]').trigger('click');

		expect(updates.at(-1)).toEqual({ type: 'op', leader: null });
		expect(wrapper.find('[data-leader]').exists()).toBe(false);
	});

	it('says at once that card data is unavailable, and keeps the Leader it holds', async () => {
		mockFetch.mockResolvedValue({ available: false });
		const { wrapper } = mountFields({ type: 'op', leader: ZORO });

		await flushPromises();

		expect(wrapper.text()).toContain('Card data unavailable');
		expect(wrapper.get('input[aria-label="Search Leaders"]').attributes('disabled')).toBeDefined();
		expect(wrapper.get('[data-leader]').text()).toContain('Roronoa Zoro');
	});
});
