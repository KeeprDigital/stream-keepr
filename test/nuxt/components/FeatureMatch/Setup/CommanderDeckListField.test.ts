import type { CommanderDeckListEntry, CommanderDeckListPreviewAnswer, FeatureMatchDeckListReference } from '~~/shared/types/featureMatchDeckList';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { MOXFIELD_CARDS, MOXFIELD_COPY } from '~~/test/helpers/magicDeckText';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import CommanderDeckListField from '~/components/FeatureMatch/Setup/CommanderDeckListField.vue';

// A Commander Seat's Feature Match Deck List (ADR-0087): paste, preview, confirm the
// Commanders, save. The routes are faked at `$fetch`.

const { mockFetch, applySavedSlot } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
	applySavedSlot: vi.fn(() => true),
}));
mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useEventStore', () => () => ({ eventId: 7 }));
mockNuxtImport('useFeatureMatchStore', () => () => ({ applySavedSlot }));

const { ashling, animar, forest } = MOXFIELD_CARDS;

function entry(card: { id: string; name: string; set: string; collector_number: string }, quantity = 1): CommanderDeckListEntry {
	return {
		quantity,
		scryfallId: card.id,
		name: card.name,
		setCode: card.set,
		collectorNumber: card.collector_number,
		cardType: null,
		colorIdentity: 'G',
		manaCost: null,
		manaValue: null,
	};
}

const accepted: CommanderDeckListPreviewAnswer = {
	ok: true,
	deckList: {
		entries: [
			entry(ashling),
			entry(animar),
			entry(forest, 3),
		],
		offeredCommanders: [ashling.id],
		sideboardDropped: 1,
	},
};
const saved = {
	deckList: {
		id: 11,
		slotId: 3,
		sourceText: MOXFIELD_COPY,
		entries: [],
	},
	featureMatch: { id: 3 },
};

function mountField(props: { deckList?: FeatureMatchDeckListReference | null; locked?: boolean } = {}) {
	return mount(CommanderDeckListField, {
		props: {
			slotId: 3,
			seat: 'player4',
			deckList: null,
			locked: false,
			...props,
		},
		global: { stubs: nuxtUiStubs },
	});
}

type Field = ReturnType<typeof mountField>;

async function paste(wrapper: Field, text = MOXFIELD_COPY) {
	await wrapper.get('button[aria-label="Paste Deck List"]').trigger('click');
	await flushPromises();
	await wrapper.get('textarea').setValue(text);
	await wrapper.get('button[aria-label="Preview Deck List"]').trigger('click');
	await flushPromises();
}

const commanderToggle = (wrapper: Field, name: string) => wrapper.get(`button[aria-label="Commander: ${name}"]`);
const saveButton = (wrapper: Field) => wrapper.get('button[aria-label="Save Deck List"]');

describe('a Commander Seat\'s Deck List field', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		applySavedSlot.mockClear();
		mockFetch.mockImplementation(async (path: string) => path.endsWith('/preview')
			? accepted
			: saved);
	});

	it('shows the Seat\'s Deck List by its Mainboard count, and clears it on request', async () => {
		const holding = mountField({
			deckList: { id: 11, mainboardCount: 99 },
		});

		expect(holding.get('[data-deck-list]').attributes('data-mainboard-count')).toBe('99');
		await holding.get('button[aria-label="Clear Deck List"]').trigger('click');
		expect(holding.emitted('clear')).toHaveLength(1);

		const empty = mountField();
		expect(empty.find('[data-deck-list]').exists()).toBe(false);
		expect(empty.find('button[aria-label="Clear Deck List"]').exists()).toBe(false);
	});

	it('previews the cards with the offered Commander confirmed and the dropped Sideboard counted, and saves that choice', async () => {
		const wrapper = mountField();

		await paste(wrapper);

		expect(wrapper.findAll('[data-deck-list-entry]').map(row => [
			row.attributes('data-printing'),
			row.attributes('data-commander'),
		])).toEqual([
			[ashling.id, 'true'],
			[animar.id, 'false'],
			[forest.id, 'false'],
		]);
		expect(wrapper.get('[data-sideboard-dropped]').attributes('data-sideboard-dropped')).toBe('1');

		const saving = deferred<unknown>();
		mockFetch.mockImplementationOnce(() => saving.promise);
		await saveButton(wrapper).trigger('click');
		await flushPromises();
		expect(saveButton(wrapper).attributes('aria-busy')).toBe('true');
		expect(mockFetch).toHaveBeenLastCalledWith('/api/events/7/feature-match-slots/3/commander-deck-lists', expect.objectContaining({
			method: 'POST',
			body: {
				seat: 'player4',
				text: MOXFIELD_COPY,
				commanders: [ashling.id],
			},
		}));

		saving.resolve(saved);
		await flushPromises();
		expect(applySavedSlot).toHaveBeenCalledWith({ id: 3 });
		expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
	});

	it.each([
		{
			choice: 'a second Commander added from the list',
			press: ['Animar, Soul of Elements'],
			commanders: [ashling.id, animar.id],
		},
		{
			choice: 'the Commander changed',
			press: ['Ashling, the Limitless', 'Animar, Soul of Elements'],
			commanders: [animar.id],
		},
	])('saves $choice', async ({ press, commanders }) => {
		const wrapper = mountField();
		await paste(wrapper);

		for (const name of press)
			await commanderToggle(wrapper, name).trigger('click');
		await saveButton(wrapper).trigger('click');
		await flushPromises();

		expect(mockFetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
			body: expect.objectContaining({ commanders }),
		}));
	});

	it('holds no more than two Commanders, and saves none', async () => {
		const wrapper = mountField();
		await paste(wrapper);

		await commanderToggle(wrapper, 'Animar, Soul of Elements').trigger('click');
		expect(commanderToggle(wrapper, 'Forest').attributes('disabled')).toBeDefined();

		await commanderToggle(wrapper, 'Animar, Soul of Elements').trigger('click');
		await commanderToggle(wrapper, 'Ashling, the Limitless').trigger('click');
		expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
		expect(wrapper.find('[data-no-commander]').exists()).toBe(true);
	});

	it('names each line that refuses the paste, and saves nothing', async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			errors: [
				{
					code: 'INVALID_PRINTING_HINT',
					message: 'Could not resolve the requested printing of Graveshifter',
					lineNumber: 5,
					sourceText: '1 Graveshifter (ECL) 9999',
				},
				{ code: 'EMPTY_DECK_LIST', message: 'At least one card outside the Sideboard is required' },
			],
		} satisfies CommanderDeckListPreviewAnswer);
		const wrapper = mountField();

		await paste(wrapper);

		expect(wrapper.findAll('[data-refusal-code]').map(refusal => [
			refusal.attributes('data-refusal-code'),
			refusal.attributes('data-line'),
		])).toEqual([
			['INVALID_PRINTING_HINT', '5'],
			['EMPTY_DECK_LIST', undefined],
		]);
		expect(wrapper.text()).toContain('1 Graveshifter (ECL) 9999');
		expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
	});

	it('saves only the text it previewed', async () => {
		const wrapper = mountField();

		await paste(wrapper);
		await wrapper.get('textarea').setValue(`${MOXFIELD_COPY}\n1 Sol Ring`);

		expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
	});

	it('starts a re-paste from the saved Deck List\'s text', async () => {
		mockFetch.mockResolvedValueOnce(saved.deckList);
		const wrapper = mountField({
			deckList: { id: 11, mainboardCount: 8 },
		});

		await wrapper.get('button[aria-label="Paste Deck List"]').trigger('click');
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledWith('/api/events/7/feature-match-slots/3/commander-deck-lists/11', expect.anything());
		expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe(MOXFIELD_COPY);
	});

	it('waits for the setup form\'s unsaved changes', () => {
		const wrapper = mountField({
			deckList: { id: 11, mainboardCount: 8 },
			locked: true,
		});

		expect(wrapper.get('button[aria-label="Paste Deck List"]').attributes('disabled')).toBeDefined();
		expect(wrapper.text()).toContain('Save or reset');
	});
});
