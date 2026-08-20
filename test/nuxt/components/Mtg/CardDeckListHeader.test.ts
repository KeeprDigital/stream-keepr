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
	template: '<div data-testid="cards-production-note" :data-note="note" :data-remote-changed="String(remoteChanged)"><button data-testid="cards-note-save" @click="save(\'Edited from Cards\')">Save</button></div>',
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
		await wrapper.get('[data-testid="cards-note-save"]').trigger('click');
		expect(save).toHaveBeenCalledWith('Edited from Cards');
		expect(wrapper.get('.space-y-3 > div').classes()).toContain('flex-wrap');
	});

	it('renders the shared empty Note state for a selected previous-Round Assignment', async () => {
		const { default: CardDeckListHeader } = await import('~/components/Mtg/CardDeckListHeader.vue');
		const wrapper = mount(CardDeckListHeader, {
			props: {
				deckListRoundId: 2,
				deckListMatchId: 7,
				selectedAssignment: {
					id: 9,
					eventId: 1,
					roundId: 2,
					slotId: 3,
					matchId: 7,
					note: null,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				saveAssignmentNote: vi.fn().mockResolvedValue(undefined),
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

		expect(wrapper.get('[data-testid="cards-production-note"]').attributes('data-note')).toBe('');
	});
});
