import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { computed, ref } from 'vue';
import Display from '~/components/Screen/Modes/HeadToHead/Display.vue';

const config = ref<any>(null);
const error = ref<string | null>(null);
const isEmpty = ref(false);
const firstMeeting = ref(false);
const headerText = ref('Head to Head');
const player1 = ref<any>(null);
const player2 = ref<any>(null);
const earlierMatches = ref<any[]>([]);

// A canned record, not a copy of the real formatting, which the composable's
// own test covers: the component only places what it is handed.
mockNuxtImport('useHeadToHeadModeData', () => () => ({
	config: computed(() => config.value),
	error: computed(() => error.value),
	isEmpty: computed(() => isEmpty.value),
	firstMeeting: computed(() => firstMeeting.value),
	headerText: computed(() => headerText.value),
	player1: computed(() => player1.value),
	player2: computed(() => player2.value),
	earlierMatches: computed(() => earlierMatches.value),
	formatRecord: (record: any) => record.wins == null
		? null
		: `${record.wins} wins`,
}));

function side(id: number, name: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		name,
		pronouns: null,
		wins: 4,
		losses: 1,
		draws: 0,
		points: 12,
		deckName: null,
		deckColors: null,
		...overrides,
	};
}

function earlierMatch(overrides: Record<string, unknown> = {}) {
	return {
		matchId: 20,
		roundId: 31,
		roundName: 'Round 2',
		roundNumber: 2,
		phaseName: 'Swiss',
		outcome: 'player1',
		gameScore: '2-1',
		...overrides,
	};
}

async function mountComponent() {
	// ScreenModeBase is left real so the empty case asserts the broadcast
	// contract itself: that state renders nothing at all.
	return mount(Display, {
		global: {
			stubs: {
				MtgManaColorDisplay: {
					props: ['colors'],
					template: '<span class="mana">{{ colors }}</span>',
				},
			},
		},
	});
}

describe('screenModesHeadToHeadDisplay', () => {
	beforeEach(() => {
		config.value = { playerSource: 'featureMatchSlot', featureMatchId: 4, showHeader: true };
		error.value = null;
		isEmpty.value = false;
		firstMeeting.value = false;
		headerText.value = 'Head to Head';
		player1.value = side(7, 'Nadia Rivers', { pronouns: 'she/her', deckName: 'Boros Energy', deckColors: 'RW' });
		player2.value = side(8, 'Oskar Lind', { points: 9 });
		earlierMatches.value = [
			earlierMatch(),
		];
	});

	it('shows the header, and hides it when the mode config disables it', async () => {
		expect((await mountComponent()).get('.head-to-head-header h2').text()).toBe('Head to Head');

		config.value = { ...config.value, showHeader: false };
		expect((await mountComponent()).find('.head-to-head-header').exists()).toBe(false);
	});

	it('shows each Player with their record, points and Archetype', async () => {
		const wrapper = await mountComponent();
		const [first, second] = wrapper.findAll('.head-to-head-player');

		expect(first!.get('.name').text()).toBe('Nadia Rivers');
		expect(first!.get('.pronouns').text()).toBe('she/her');
		expect(first!.get('.record').text()).toBe('4 wins');
		expect(first!.get('.points').text()).toBe('12 pts');
		expect(first!.get('.deck').text()).toContain('Boros Energy');
		expect(first!.get('.mana').text()).toBe('RW');
		expect(second!.get('.name').text()).toBe('Oskar Lind');
		expect(second!.find('.pronouns').exists()).toBe(false);
		expect(second!.get('.points').text()).toBe('9 pts');
		expect(second!.find('.deck').exists()).toBe(false);
	});

	it('leaves out a record and points a Player does not have yet', async () => {
		player2.value = side(8, 'Oskar Lind', {
			wins: null,
			losses: null,
			draws: null,
			points: null,
		});

		const second = (await mountComponent()).findAll('.head-to-head-player')[1]!;

		expect(second.find('.record').exists()).toBe(false);
		expect(second.find('.points').exists()).toBe(false);
	});

	it('names a side no Player fills as to be decided', async () => {
		player2.value = null;

		expect((await mountComponent()).findAll('.head-to-head-player')[1]!.get('.name').text()).toBe('TBD');
	});

	it('lists earlier Matches with their Round, winner and game score', async () => {
		earlierMatches.value = [
			earlierMatch({
				matchId: 20,
				roundName: 'Round 2',
				outcome: 'player1',
				gameScore: '2-1',
			}),
			earlierMatch({
				matchId: 21,
				roundName: 'Round 5',
				outcome: 'player2',
				gameScore: '0-2',
			}),
			earlierMatch({
				matchId: 22,
				roundName: 'Quarterfinal',
				outcome: 'draw',
				gameScore: '1-1-1',
			}),
		];

		const rows = (await mountComponent()).findAll('.earlier-match');

		expect(rows.map(row => row.get('.round').text())).toEqual(['Round 2', 'Round 5', 'Quarterfinal']);
		expect(rows.map(row => row.get('.winner').text())).toEqual(['Nadia Rivers', 'Oskar Lind', 'Draw']);
		expect(rows.map(row => row.get('.score').text())).toEqual(['2-1', '0-2', '1-1-1']);
	});

	it('says it is the two Players\' first earlierMatch when they have not met', async () => {
		earlierMatches.value = [];
		firstMeeting.value = true;

		const wrapper = await mountComponent();

		expect(wrapper.get('.first-meeting').text()).toBe('First meeting');
		expect(wrapper.find('.earlier-match').exists()).toBe(false);
	});

	it('renders nothing while the mode is empty', async () => {
		isEmpty.value = true;

		const wrapper = await mountComponent();

		expect(wrapper.text()).toBe('');
		expect(wrapper.find('.head-to-head-display').exists()).toBe(false);
	});
});
