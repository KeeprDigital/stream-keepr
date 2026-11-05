import type { ManualBracket } from '~~/shared/modules/top-cut-bracket';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { UButtonStub, UFormFieldStub, UInputMenuStub, UInputStub, USelectStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { screenSettingsLayoutStubs } from '~~/test/nuxt/helpers/screenSettingsLayout';
import ManualBracketEditor from '~/components/Screen/Modes/TopCut/ManualBracketEditor.vue';

enableAutoUnmount(afterEach);

/**
 * The Manual Bracket editor writes the whole Manual Bracket on every edit: a
 * Seed set to a Player or a typed name, who advanced from a position seating
 * two entrants, and their game score (ADR-0075).
 */

const playerStore = {
	players: [
		{
			id: 7,
			name: 'Kim',
			nickname: null,
			externalId: null,
			externalSource: null,
		},
		{
			id: 8,
			name: '',
			nickname: 'luffy_fan',
			externalId: '0000123',
			externalSource: 'tcgplus',
		},
	],
};
mockNuxtImport('usePlayerStore', () => () => playerStore);

const EMPTY: ManualBracket = { size: 4, entrants: [], results: [] };
const SEEDED: ManualBracket = {
	size: 4,
	entrants: [
		{ playerId: 7 },
		{ name: 'Walk-in' },
		{ playerId: 8 },
		{ name: 'Late Entry' },
	],
	results: [],
};

function mountEditor(manual: ManualBracket) {
	const wrapper = mount(ManualBracketEditor, {
		props: { manual },
		global: {
			stubs: {
				...screenSettingsLayoutStubs,
				UFormField: UFormFieldStub,
				USelect: USelectStub,
				UInputMenu: UInputMenuStub,
				UInput: UInputStub,
				UButton: UButtonStub,
			},
		},
	});
	const written = () => wrapper.emitted('update')?.at(-1)?.[0] as ManualBracket | undefined;
	return { wrapper, written };
}

const seed = (wrapper: ReturnType<typeof mountEditor>['wrapper'], number: number) => wrapper.get(`[data-seed="${number}"]`);

describe('screenModesTopCutManualBracketEditor', () => {
	it('lists a Seed for each place in the bracket', () => {
		const { wrapper } = mountEditor({ ...EMPTY, size: 8 });

		expect(wrapper.findAll('[data-seed]').map(row => row.attributes('data-seed'))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
	});

	it.each([
		[
			'a Player found by Nickname',
			'luffy',
			'luffy_fan',
			{ playerId: 8 },
		],
		[
			'a Player found by name',
			'ki',
			'Kim',
			{ playerId: 7 },
		],
		[
			'what was typed, as a name',
			'Walk-in',
			'Use “Walk-in” as a name',
			{ name: 'Walk-in' },
		],
	])('sets a Seed to %s', async (_, search, option, entrant) => {
		const { wrapper, written } = mountEditor(EMPTY);
		await seed(wrapper, 2).get('input[role="combobox"]').setValue(search);
		const picked = seed(wrapper, 2).findAll('[role="option"]').find(candidate => candidate.text() === option);
		await picked!.trigger('click');

		expect(written()?.entrants).toEqual([null, entrant]);
	});

	it('clears a Seed, keeping the Seeds around it', async () => {
		const { wrapper, written } = mountEditor(SEEDED);
		await wrapper.get('[data-testid="manual-bracket-clear-seed-2"]').trigger('click');

		expect(written()?.entrants).toEqual([
			{ playerId: 7 },
			null,
			{ playerId: 8 },
			{ name: 'Late Entry' },
		]);
	});

	it('resizes the bracket, clearing its results', async () => {
		const { wrapper, written } = mountEditor({
			...SEEDED,
			results: [
				[
					{ winner: 0 },
				],
			],
		});
		await wrapper.get('[data-field="manualBracket.size"] select').setValue('8');

		expect(written()).toEqual({ size: 8, entrants: SEEDED.entrants, results: [] });
	});

	it('offers a result only where a position seats both its entrants, naming them by their Seed\'s Player', async () => {
		const { wrapper } = mountEditor({
			size: 4,
			entrants: [
				{ playerId: 7 },
				{ name: 'Walk-in' },
				{ playerId: 8 },
			],
			results: [],
		});

		expect(wrapper.findAll('[data-column="0"] [data-position]').map(position => position.attributes('data-status'))).toEqual(['bye', 'unreported']);
		expect(wrapper.find('[data-testid="manual-bracket-winner-0-0-0"]').exists()).toBe(false);
		expect(wrapper.get('[data-testid="manual-bracket-winner-0-1-0"]').text()).toBe('Walk-in');
		expect(wrapper.get('[data-testid="manual-bracket-winner-0-1-1"]').text()).toBe('luffy_fan');
	});

	it.each([
		[
			'marks who advanced',
			null,
			1,
			{ winner: 1, gameWins: null },
		],
		[
			'moves the win to the other side, keeping its score',
			{
				winner: 0 as const,
				gameWins: [2, 1] as [number, number],
			},
			1,
			{
				winner: 1,
				gameWins: [2, 1],
			},
		],
		[
			'clears the result when the winner is picked again',
			{ winner: 1 as const },
			1,
			null,
		],
	])('%s', async (_, held, side, result) => {
		const { wrapper, written } = mountEditor({
			...SEEDED,
			results: held
				? [
						[null, held],
					]
				: [],
		});
		await wrapper.get(`[data-testid="manual-bracket-winner-0-1-${side}"]`).trigger('click');

		expect(written()?.results).toEqual(result
			? [
					[null, result],
				]
			: []);
	});

	it('shows the winner as pressed, and the next column seating them', () => {
		const { wrapper } = mountEditor({
			...SEEDED,
			results: [
				[
					{ winner: 0 },
					{ winner: 1 },
				],
			],
		});

		expect(wrapper.get('[data-testid="manual-bracket-winner-0-0-0"]').attributes('aria-pressed')).toBe('true');
		expect(wrapper.get('[data-testid="manual-bracket-winner-0-0-1"]').attributes('aria-pressed')).toBe('false');
		expect(wrapper.get('[data-testid="manual-bracket-winner-1-0-0"]').text()).toBe('Kim');
		expect(wrapper.get('[data-testid="manual-bracket-winner-1-0-1"]').text()).toBe('luffy_fan');
	});

	it.each([
		[
			'the winner\'s',
			0,
			'2',
			[2, 0],
		],
		[
			'the loser\'s',
			1,
			'1',
			[0, 1],
		],
		[
			'a score past the most games, at the most',
			0,
			'42',
			[9, 0],
		],
	] as const)('writes %s games won as the game score', async (_, side, value, gameWins) => {
		const { wrapper, written } = mountEditor({
			...SEEDED,
			results: [
				[
					{ winner: 0 },
				],
			],
		});
		await wrapper.get(`[data-testid="manual-bracket-score-0-0-${side}"]`).setValue(value);
		await flushPromises();

		expect(written()?.results).toEqual([
			[
				{ winner: 0, gameWins },
			],
		]);
	});

	it('clears the game score when a side\'s games are emptied', async () => {
		const { wrapper, written } = mountEditor({
			...SEEDED,
			results: [
				[
					{
						winner: 0,
						gameWins: [2, 1],
					},
				],
			],
		});
		await wrapper.get('[data-testid="manual-bracket-score-0-0-1"]').setValue('');

		expect(written()?.results).toEqual([
			[
				{ winner: 0, gameWins: null },
			],
		]);
	});
});
