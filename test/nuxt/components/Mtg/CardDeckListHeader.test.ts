import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

const cardStore = {
	deckListHasData: false,
	deckListFilter: '',
	clearMatchDeckLists: vi.fn(),
	loadMatchupDeckLists: vi.fn(),
	loadMatchDeckLists: vi.fn(),
};

mockNuxtImport('useCardStore', () => () => cardStore);
mockNuxtImport('useFeatureMatchMenuItems', () => () => ref([]));

const FeatureMatchNoteStub = defineComponent({
	props: ['note', 'noteKey', 'remoteChanged', 'save'],
	template: '<div data-testid="cards-production-note" :data-note="note" :data-remote-changed="String(remoteChanged)" />',
});

describe('mtgCardDeckListHeader', () => {
	it('presents the selected Assignment Note beside the Cards match-decklist controls', async () => {
		const save = vi.fn().mockResolvedValue(undefined);
		const { default: CardDeckListHeader } = await import('~/components/Mtg/CardDeckListHeader.vue');
		const wrapper = mount(CardDeckListHeader, {
			props: {
				deckListMatchId: 7,
				selectedAssignment: {
					id: 9,
					eventId: 1,
					roundId: 3,
					slotId: 2,
					matchId: 7,
					note: 'Talent can read this without leaving Cards',
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				saveAssignmentNote: save,
				assignmentNoteRemoteChanged: true,
			},
			global: {
				stubs: {
					FeatureMatchNote: FeatureMatchNoteStub,
					USelect: true,
					UInput: true,
					UButton: true,
				},
			},
		});

		const note = wrapper.get('[data-testid="cards-production-note"]');
		expect(note.attributes('data-note')).toBe('Talent can read this without leaving Cards');
		expect(note.attributes('data-remote-changed')).toBe('true');
	});
});
