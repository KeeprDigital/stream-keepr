import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

const mockPlayerControls = {
	recordWin: vi.fn(),
	undoWin: vi.fn(),
};

const mockFeatureMatchStateStore = {
	$reset: vi.fn(),
	featureMatchStates: new Map([[1, { currentGame: 2, isComplete: false }]]),
};

const mockToast = { add: vi.fn() };

mockNuxtImport('usePlayerControls', () => () => mockPlayerControls);
mockNuxtImport('useFeatureMatchStateStore', () => () => mockFeatureMatchStateStore);
mockNuxtImport('useToast', () => () => mockToast);

const GameWinModalStub = defineComponent({
	template: '<div data-testid="game-win-modal" />',
});

async function mountComponent(props: Record<string, unknown>) {
	const componentPath = '../../../../../app/components/FeatureMatch/State/' + 'GameWins.vue';
	const { default: GameWins } = await import(componentPath);

	return mount(GameWins, {
		props: {
			matchId: 1,
			player: 'player1',
			gameWins: 1,
			bestOf: 3,
			...props,
		},
		global: {
			stubs: {
				FeatureMatchStateGameWinModal: GameWinModalStub,
			},
		},
	});
}

describe('featureMatchGameWins', () => {
	beforeEach(() => {
		mockPlayerControls.recordWin.mockReset();
		mockPlayerControls.undoWin.mockReset();
		mockFeatureMatchStateStore.$reset.mockReset();
		mockFeatureMatchStateStore.featureMatchStates = new Map([[1, { currentGame: 2, isComplete: false }]]);
		mockToast.add.mockReset();
	});

	it('renders a vertical touch layout when requested', async () => {
		const wrapper = await mountComponent({ touch: true, orientation: 'vertical' });
		const root = wrapper.get('.game-wins');
		const slots = wrapper.get('.game-wins-slots');

		expect(root.classes()).toContain('game-wins--clustered');
		expect(root.classes()).toContain('rounded-[1.75rem]');

		expect(slots.classes()).toContain('flex-col');
		expect(slots.classes()).toContain('items-center');
		expect(slots.classes()).toContain('gap-3');

		const buttons = wrapper.findAll('button');
		expect(buttons).toHaveLength(2);
		expect(buttons.map(button => button.text())).toEqual(['G1', 'G2']);
		expect(buttons[0]!.classes()).toContain('w-14');
		expect(buttons[1]!.classes()).toContain('game-wins-slot--empty');
	});

	it('keeps win markers visible without rendering interactive buttons in readonly mode', async () => {
		const wrapper = await mountComponent({ readonly: true });

		expect(wrapper.findAll('button')).toHaveLength(0);
		expect(wrapper.text()).toContain('G1');
		expect(wrapper.text()).toContain('G2');
	});
});
