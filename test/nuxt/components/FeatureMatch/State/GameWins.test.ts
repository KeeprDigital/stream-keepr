import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import GameWins from '~/components/FeatureMatch/State/GameWins.vue';

const playerControls = {
	recordWin: vi.fn(async () => {}),
	undoWin: vi.fn(async () => {}),
};
const featureMatchStates = new Map([
	[
		1,
		{ currentGame: 2, isComplete: false },
	],
]);
const toast = {
	add: vi.fn(),
};

mockNuxtImport('usePlayerControls', () => () => playerControls);
mockNuxtImport('useFeatureMatchStateStore', () => () => ({ featureMatchStates }));
mockNuxtImport('useToast', () => () => toast);

// Confirms with the operator's reset choices as soon as it is opened.
const GameWinModalStub = defineComponent({
	props: ['open', 'mode'],
	emits: ['confirm', 'update:open'],
	template: '<button v-if="open" type="button" data-testid="confirm" :data-mode="mode" @click="$emit(\'confirm\', { resetLife: true, resetCounters: false })" />',
});

function mountGameWins(props: Record<string, unknown> = {}) {
	return mount(GameWins, {
		props: {
			matchId: 1,
			player: 'player1',
			playerName: 'Alice',
			gameWins: 1,
			bestOf: 3,
			...props,
		},
		global: {
			stubs: { FeatureMatchStateGameWinModal: GameWinModalStub },
		},
	});
}

function slot(wrapper: ReturnType<typeof mountGameWins>, label: string) {
	return wrapper.findAll('button').find(button => button.text() === label)!;
}

describe('featureMatchGameWins', () => {
	beforeEach(() => {
		featureMatchStates.set(1, { currentGame: 2, isComplete: false });
	});

	it('shows one slot per win the match needs, filled up to the Player\'s wins', () => {
		const wrapper = mountGameWins({ gameWins: 1, bestOf: 5 });

		expect(wrapper.findAll('button[aria-label]').map(button => button.attributes('aria-label')))
			.toEqual(['Undo win', 'Record win', 'Record win']);
	});

	it('records a win with the operator\'s reset choices once confirmed', async () => {
		const wrapper = mountGameWins();

		await slot(wrapper, 'G2').trigger('click');
		expect(wrapper.get('[data-testid="confirm"]').attributes('data-mode')).toBe('win');
		await wrapper.get('[data-testid="confirm"]').trigger('click');
		await flushPromises();

		expect(playerControls.recordWin).toHaveBeenCalledWith({ resetLife: true, resetCounters: false });
		expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({ title: 'Alice wins Game 1' }));
	});

	it('undoes a recorded win from a filled slot', async () => {
		const wrapper = mountGameWins();

		await slot(wrapper, 'G1').trigger('click');
		expect(wrapper.get('[data-testid="confirm"]').attributes('data-mode')).toBe('undo');
		await wrapper.get('[data-testid="confirm"]').trigger('click');
		await flushPromises();

		expect(playerControls.undoWin).toHaveBeenCalledWith({ resetLife: true, resetCounters: false });
		expect(playerControls.recordWin).not.toHaveBeenCalled();
	});

	it('shows the win markers without controls when read-only', () => {
		const wrapper = mountGameWins({ readonly: true });

		expect(wrapper.findAll('button')).toHaveLength(0);
		expect(wrapper.text()).toContain('G1');
		expect(wrapper.text()).toContain('G2');
	});

	it('shows no markers for a best-of-one match', () => {
		const wrapper = mountGameWins({ bestOf: 1 });

		expect(wrapper.findAll('button')).toHaveLength(0);
		expect(wrapper.text()).not.toContain('G1');
	});
});
