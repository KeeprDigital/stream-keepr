import type { PlayerMatchHistoryEntry } from '~/composables/screen/usePlayerHistoryModeData';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';
import { createMockPlayer } from '~~/test/helpers/fixtures';
import { nuxtUiStubs, UTableStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import MatchHistoryModal from '~/components/Player/MatchHistoryModal.vue';

const bob = createMockPlayer({ id: 8, name: 'Bob' });
mockNuxtImport('usePlayerStore', () => () => reactive({
	players: [bob],
}));
mockNuxtImport('usePlayerDeckListModal', () => () => ({
	openPlayerDeckList: vi.fn(),
}));
mockNuxtImport('useSendPlayerHistoryToScreen', () => () => ({
	hasPlayerHistoryScreens: ref(false),
	playerHistoryScreens: ref([]),
}));

const { openPlayerMatchHistory } = vi.hoisted(() => ({
	openPlayerMatchHistory: vi.fn(),
}));
mockNuxtImport('usePlayerMatchHistoryModal', () => () => ({ openPlayerMatchHistory }));

const UModalStub = defineComponent({
	template: '<div><slot name="title" /><slot name="body" /><slot name="footer" /></div>',
});

function entry(opponentId: number | null, opponentName: string) {
	return {
		roundNumber: 1,
		roundName: 'Round 1',
		phaseName: 'Swiss',
		opponentId,
		opponentName,
		outcome: 'win',
	} as PlayerMatchHistoryEntry;
}

describe('player match history modal', () => {
	it.each([
		[
			'a roster opponent',
			entry(8, 'Bob'),
			true,
		],
		[
			'an opponent off the roster',
			entry(null, 'Walk-in'),
			false,
		],
	])('names %s, opening their history only when they are a Player', async (_, row, clickable) => {
		const wrapper = mount(MatchHistoryModal, {
			props: {
				player: createMockPlayer({ id: 7, name: 'Alice' }) as never,
				history: [row],
			},
			global: {
				stubs: {
					...nuxtUiStubs,
					UModal: UModalStub,
					UTable: UTableStub,
					MtgManaColorDisplay: true,
				},
			},
		});

		const opponent = wrapper.get('[data-column="opponentName"]');
		expect(opponent.text()).toBe(row.opponentName);
		expect(opponent.find('button').exists()).toBe(clickable);
		if (clickable) {
			await opponent.get('button').trigger('click');
			expect(openPlayerMatchHistory).toHaveBeenCalledWith(bob);
		}
	});
});
