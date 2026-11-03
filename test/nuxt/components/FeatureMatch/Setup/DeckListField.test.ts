import type { FeatureMatchDeckListReference, FeatureMatchDeckListView } from '~~/shared/types/featureMatchDeckList';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import DeckListField from '~/components/FeatureMatch/Setup/DeckListField.vue';

// A Slot side's Feature Match Deck List: paste, preview, save. The routes are faked at `$fetch`.

const { mockFetch, applySavedSlot } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
	applySavedSlot: vi.fn(() => true),
}));
mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useEventStore', () => () => ({ eventId: 7 }));
mockNuxtImport('useFeatureMatchStore', () => () => ({ applySavedSlot }));

const TEXT = '1x OP01-001\n4x OP99-999';
const preview: FeatureMatchDeckListView = {
	entries: [
		{
			number: 'OP01-001',
			quantity: 1,
			card: {
				name: 'Roronoa Zoro',
				category: 'leader',
				colors: ['Red'],
				cost: null,
				power: 5000,
				counter: null,
				imageUrl: 'https://cards-img.keepr.digital/OP01-001.png',
			},
		},
		{ number: 'OP99-999', quantity: 4, card: null },
	],
	leaderNumber: 'OP01-001',
	mainboardCount: 4,
	warnings: [
		{ code: 'MAINBOARD_COUNT', message: 'The Mainboard has 4 cards, not 50.', count: 4 },
		{
			code: 'UNKNOWN_CARD',
			message: 'Card data has no card OP99-999; kept as a number only.',
			numbers: ['OP99-999'],
		},
	],
};

function mountField(props: { deckList?: FeatureMatchDeckListReference | null; locked?: boolean } = {}) {
	return mount(DeckListField, {
		props: {
			slotId: 3,
			side: 'player2',
			deckList: null,
			locked: false,
			...props,
		},
		global: { stubs: nuxtUiStubs },
	});
}

async function paste(wrapper: ReturnType<typeof mountField>, text = TEXT) {
	await wrapper.get('button[aria-label="Paste Deck List"]').trigger('click');
	await flushPromises();
	await wrapper.get('textarea').setValue(text);
	await wrapper.get('button[aria-label="Preview Deck List"]').trigger('click');
	await flushPromises();
}

describe('a Slot side\'s Deck List field', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		applySavedSlot.mockClear();
		mockFetch.mockImplementation(async (path: string) => path.endsWith('/preview')
			? { available: true, deckList: preview }
			: {
					available: true,
					deckList: {
						...preview,
						id: 11,
						slotId: 3,
						sourceText: TEXT,
					},
					featureMatch: { id: 3 },
				});
	});

	it('shows the side\'s Deck List by its Mainboard count', () => {
		expect(mountField({
			deckList: { id: 11, mainboardCount: 50 },
		}).get('[data-deck-list]').attributes('data-mainboard-count')).toBe('50');
		expect(mountField().find('[data-deck-list]').exists()).toBe(false);
	});

	it('previews resolved cards, number-only placeholders and warnings, and saves despite the warnings', async () => {
		const wrapper = mountField();

		await paste(wrapper);

		const entries = wrapper.findAll('[data-deck-list-entry]');
		expect(entries.map(entry => [
			entry.attributes('data-number'),
			entry.attributes('data-resolved'),
		])).toEqual([
			['OP01-001', 'true'],
			['OP99-999', 'false'],
		]);
		expect(wrapper.findAll('[data-warning-code]').map(warning => warning.attributes('data-warning-code')))
			.toEqual(['MAINBOARD_COUNT', 'UNKNOWN_CARD']);

		const saving = deferred<unknown>();
		mockFetch.mockImplementationOnce(() => saving.promise);
		await wrapper.get('button[aria-label="Save Deck List"]').trigger('click');
		await flushPromises();
		expect(wrapper.get('button[aria-label="Save Deck List"]').attributes('aria-busy')).toBe('true');
		expect(mockFetch).toHaveBeenLastCalledWith('/api/events/7/feature-match-slots/3/deck-lists', expect.objectContaining({
			method: 'POST',
			body: { side: 'player2', text: TEXT },
		}));

		saving.resolve({
			available: true,
			deckList: {
				...preview,
				id: 11,
				slotId: 3,
				sourceText: TEXT,
			},
			featureMatch: { id: 3 },
		});
		await flushPromises();
		expect(applySavedSlot).toHaveBeenCalledWith({ id: 3 });
		expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
	});

	it('saves only the text it previewed', async () => {
		const wrapper = mountField();

		await paste(wrapper);
		await wrapper.get('textarea').setValue(`${TEXT}\n4x OP01-025`);

		expect(wrapper.get('button[aria-label="Save Deck List"]').attributes('disabled')).toBeDefined();
	});

	it('starts a re-paste from the saved Deck List\'s text', async () => {
		mockFetch.mockResolvedValueOnce({
			...preview,
			id: 11,
			slotId: 3,
			sourceText: TEXT,
		});
		const wrapper = mountField({
			deckList: { id: 11, mainboardCount: 4 },
		});

		await wrapper.get('button[aria-label="Paste Deck List"]').trigger('click');
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledWith('/api/events/7/feature-match-slots/3/deck-lists/11', expect.anything());
		expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe(TEXT);
	});

	it('waits for the setup form\'s unsaved changes', () => {
		const wrapper = mountField({ locked: true });

		expect(wrapper.get('button[aria-label="Paste Deck List"]').attributes('disabled')).toBeDefined();
		expect(wrapper.text()).toContain('Save or reset');
	});

	it('says when card data is unavailable', async () => {
		mockFetch.mockResolvedValue({ available: false });
		const wrapper = mountField();

		await paste(wrapper);

		expect(wrapper.text()).toContain('Card data unavailable');
		expect(wrapper.find('button[aria-label="Save Deck List"]').attributes('disabled')).toBeDefined();
	});
});
