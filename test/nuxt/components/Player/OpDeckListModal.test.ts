import type { SavedOpPlayerDeckList } from '~~/shared/types/opDeckList';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { createMockPlayer, createWireMockPlayer } from '~~/test/helpers/fixtures';
import { opCardSummary, opDeckListEntry } from '~~/test/helpers/opCards';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import OpDeckListModal from '~/components/Player/OpDeckListModal.vue';

// The Players page's Deck List editor: prefilled paste box and Leader picker, saved
// through the OP Deck List write. The routes are faked at `$fetch`.

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useEventStore', () => () => ({ eventId: 7 }));

const SAVED: SavedOpPlayerDeckList = {
	id: 30,
	playerId: 4,
	handEdited: false,
	sourceText: '1x OP01-001 Card OP01-001\n4x OP01-025 Card OP01-025',
	entries: [
		opDeckListEntry('OP01-001', 1, 'leader'),
		opDeckListEntry('OP01-025', 4, 'character', 3),
	],
	leaderNumber: 'OP01-001',
	mainboardCount: 4,
	warnings: [],
};

function route(path: string, options?: { method?: string }) {
	if (path.includes('/op-cards')) {
		return Promise.resolve({
			available: true,
			items: [
				opCardSummary(),
			],
			total: 1,
		});
	}
	if (options?.method === 'GET')
		return Promise.resolve({ deckList: SAVED });
	throw new Error(`unexpected ${path}`);
}

function mountModal(player: Parameters<typeof createMockPlayer>[0] = {}) {
	return mount(OpDeckListModal, {
		props: {
			player: createMockPlayer({
				id: 4,
				name: '',
				nickname: 'ana',
				...player,
			}),
		},
		global: { stubs: nuxtUiStubs },
	});
}

function useImportedButton(wrapper: ReturnType<typeof mountModal>) {
	return wrapper.findAll('button').find(button => button.text() === 'Use imported Deck List');
}

describe('a Player\'s Deck List editor', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		mockFetch.mockImplementation(route);
	});

	it('opens on the saved list and Leader, and saves the edit despite its warnings', async () => {
		const wrapper = mountModal();
		await flushPromises();

		expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe(SAVED.sourceText);
		expect(wrapper.get('[data-leader]').text()).toContain('OP01-001');

		const saving = deferred<unknown>();
		mockFetch.mockImplementation((path: string, options?: { method?: string }) => options?.method === 'PUT'
			? saving.promise
			: route(path, options));
		await wrapper.get('textarea').setValue('4x OP01-025\n4x OP99-999');
		await wrapper.get('button[aria-label="Save Deck List"]').trigger('click');
		await flushPromises();

		expect(wrapper.get('button[aria-label="Save Deck List"]').attributes('aria-busy')).toBe('true');
		expect(mockFetch).toHaveBeenCalledWith('/api/events/7/players/4/deck-list', expect.objectContaining({
			method: 'PUT',
			body: { text: '4x OP01-025\n4x OP99-999', leaderNumber: 'OP01-001' },
		}));

		saving.resolve({
			deckList: {
				...SAVED,
				id: 31,
				handEdited: true,
				entries: [
					...SAVED.entries,
					opDeckListEntry('OP99-999', 4, null),
				],
				warnings: [
					{
						code: 'UNKNOWN_CARD',
						message: 'Card data has no card OP99-999; kept as a number only.',
						numbers: ['OP99-999'],
					},
				],
			},
			player: createWireMockPlayer({ id: 4 }),
		});
		await flushPromises();

		expect(wrapper.findAll('[data-warning-code]').map(warning => warning.attributes('data-warning-code'))).toEqual(['UNKNOWN_CARD']);
		expect(wrapper.findAll('[data-deck-list-entry]').map(entry => [
			entry.attributes('data-number'),
			entry.attributes('data-resolved'),
		]))
			.toEqual([
				['OP01-001', 'true'],
				['OP01-025', 'true'],
				['OP99-999', 'false'],
			]);
	});

	// A TCG+ Import keeps a hand edit it differs from (ADR-0074).
	it.each([
		[
			'a hand edit to an imported Player\'s list',
			'tcgplus',
			true,
			true,
		],
		[
			'an imported list',
			'tcgplus',
			false,
			false,
		],
		[
			'a hand-added Player\'s list',
			null,
			true,
			false,
		],
	] as const)('offers to use the imported Deck List over %s: %s', async (_label, externalSource, handEdited, offered) => {
		mockFetch.mockImplementation((path: string, options?: { method?: string }) => options?.method === 'GET'
			? Promise.resolve({
					deckList: { ...SAVED, handEdited },
				})
			: route(path, options));
		const wrapper = mountModal({
			externalSource,
			externalId: externalSource ? '0001' : null,
		});
		await flushPromises();

		expect(useImportedButton(wrapper) !== undefined).toBe(offered);
	});

	it('takes the imported Deck List, showing it as saved', async () => {
		const imported = {
			...SAVED,
			id: 32,
			handEdited: false,
			sourceText: '1x OP01-016 Nami',
		};
		const taking = deferred<unknown>();
		mockFetch.mockImplementation((path: string, options?: { method?: string }) => {
			if (options?.method === 'GET') {
				return Promise.resolve({
					deckList: { ...SAVED, handEdited: true },
				});
			}
			if (path.endsWith('/deck-list/use-imported'))
				return taking.promise;
			return route(path, options);
		});
		const wrapper = mountModal({ externalSource: 'tcgplus', externalId: '0001' });
		await flushPromises();

		await useImportedButton(wrapper)!.trigger('click');
		await flushPromises();

		expect(useImportedButton(wrapper)!.attributes('aria-busy')).toBe('true');
		expect(mockFetch).toHaveBeenCalledWith('/api/events/7/players/4/deck-list/use-imported', expect.objectContaining({ method: 'POST' }));
		taking.resolve({
			deckList: imported,
			player: createWireMockPlayer({ id: 4 }),
		});
		await flushPromises();

		expect(wrapper.get('[data-deck-list]').attributes('data-hand-edited')).toBe('false');
		expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('1x OP01-016 Nami');
		expect(useImportedButton(wrapper)).toBeUndefined();
	});
});
