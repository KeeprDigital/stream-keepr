import type { DbEvent } from '~~/server/db/schema';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { PlayerDisplayConfig } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, reactive, ref } from 'vue';
import { getMatchFormatDefaults } from '~~/shared/config/games';
import { createInitialFeatureMatchSessionStateFromSnapshot } from '~~/shared/modules/feature-match-session';
import { SEAT_VALUES } from '~~/shared/types/enums';
import { fromFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { commanderSnapshot } from '~~/test/helpers/commanderSession';
import { createMockEvent, createMockFeatureMatch } from '~~/test/helpers/fixtures';
import { matchStatePart } from '~~/test/nuxt/helpers/featureMatchControls';
import { createSession } from '~~/test/nuxt/helpers/featureMatchStateHarness';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import CommanderTable from '~/components/FeatureMatch/State/CommanderTable.vue';

/*
 * A Commander Slot's Controls (ADR-0087): four Seats where they sit at the
 * table, each control sending its own command. The game's rules are the
 * reducer's; this is that each control reads and writes the right Seat.
 */

const EVENT_ID = 1;
const SLOT_ID = 1;
// Ana (Atraxa), Ben (Tymna), Cleo (Tymna and Kraum); Seat 4 is empty.
const snapshot = commanderSnapshot({ player4: null });

const event = ref(createMockEvent());
const stateStore = reactive({
	featureMatchStates: new Map<number, FeatureMatchState>(),
	featureMatchSessions: new Map(),
	sessionIdBySlotId: new Map<number, number>(),
	adjustLife: vi.fn(),
	setLife: vi.fn(),
	setCardsKept: vi.fn(),
	adjustCommanderDamage: vi.fn(),
	setEliminated: vi.fn(),
	setOutcome: vi.fn(),
	selectFirstPlayer: vi.fn(),
	stepTurn: vi.fn(),
	setTurnNumber: vi.fn(),
	startOvertime: vi.fn(),
});

mockNuxtImport('useEventStore', () => () => reactive({
	eventId: EVENT_ID,
	event: computed(() => event.value),
	displayEvent: computed(() => event.value),
}));
mockNuxtImport('useFeatureMatchStateStore', () => () => stateStore);
mockNuxtImport('useFeatureMatchStore', () => () => ({
	featureMatches: [
		createMockFeatureMatch({ id: SLOT_ID }),
	],
}));
mockNuxtImport('usePlayerStore', () => () => ({ players: [] }));
mockNuxtImport('useOverlay', () => () => ({
	create: vi.fn(),
}));
mockNuxtImport('useToast', () => () => ({
	add: vi.fn(),
}));

/** A counter that shows what it counts and steps by one either way. */
const NumericCounterStub = defineComponent({
	props: ['value', 'accessibleLabel', 'readonly'],
	emits: ['adjust', 'set'],
	template: `<div data-counter :data-label="accessibleLabel" :data-value="value" :data-readonly="String(!!readonly)">
		<button type="button" data-step="up" @click="$emit('adjust', 1)" />
		<button type="button" data-step="down" @click="$emit('adjust', -1)" />
	</div>`,
});
const CounterListStub = defineComponent({
	props: ['player', 'counters'],
	template: '<div data-match-state-part="counters" :data-player="player" :data-counters="JSON.stringify(counters)" />',
});

const TRACKING: Partial<DbEvent> = {
	featureMatchDefaultTurnTrackingEnabled: true,
	featureMatchDefaultActivePlayerTrackingEnabled: true,
	featureMatchDefaultMulliganTrackingEnabled: true,
};

/** The Slot's Session held with `overrides` on its opening state, and its Controls mounted. */
function mountTable(overrides: Partial<FeatureMatchState> = {}, props: { config?: PlayerDisplayConfig } = {}) {
	event.value = createMockEvent({
		game: 'mtg',
		variant: 'commander',
		...fromFeatureMatchDefaults(getMatchFormatDefaults('mtg-commander')),
		...TRACKING,
	});
	const state = {
		...createInitialFeatureMatchSessionStateFromSnapshot(snapshot),
		turnNumber: 1,
		...overrides,
	};
	const session = createSession(state, { slotId: SLOT_ID, sourceSnapshot: snapshot });
	stateStore.featureMatchStates = new Map([
		[SLOT_ID, state],
	]);
	stateStore.featureMatchSessions = new Map([
		[session.id, session],
	]);
	stateStore.sessionIdBySlotId = new Map([
		[SLOT_ID, session.id],
	]);
	const wrapper = mount(CommanderTable, {
		props: { matchId: SLOT_ID, ...props },
		global: {
			stubs: {
				...nuxtUiStubs,
				UINumericCounter: NumericCounterStub,
				FeatureMatchStateCounterList: CounterListStub,
				FeatureMatchStateOvertimeTurnsCounter: matchStatePart('overtime'),
			},
		},
	});
	return { wrapper, state };
}

type Table = ReturnType<typeof mountTable>['wrapper'];
const seat = (wrapper: Table, key: string) => wrapper.get(`[data-seat="${key}"]`);
function button(scope: { findAll: Table['findAll'] }, label: string) {
	return scope.findAll('button').find(candidate => candidate.text() === label || candidate.attributes('aria-label') === label)!;
}

describe('a Commander Slot\'s Controls', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('shows the four Seats clockwise from the top left, an empty one as empty', () => {
		const { wrapper } = mountTable();

		expect(SEAT_VALUES.map(key => seat(wrapper, key).attributes('data-table-position')))
			.toEqual([
				'top-left',
				'top-right',
				'bottom-right',
				'bottom-left',
			]);
		expect(SEAT_VALUES.map(key => seat(wrapper, key).attributes('data-seat-empty')))
			.toEqual(['false', 'false', 'false', 'true']);
		expect(seat(wrapper, 'player3').text()).toContain('Cleo');
		expect(seat(wrapper, 'player4').find('[data-counter]').exists()).toBe(false);
	});

	it('shows a Seat\'s life and adjusts that Seat', async () => {
		const opened = createInitialFeatureMatchSessionStateFromSnapshot(snapshot);
		const { wrapper } = mountTable({
			player3: { ...opened.player3!, lifeTotal: 31 },
		});
		const life = seat(wrapper, 'player3').get('[data-counter][data-label="Cleo life total"]');

		expect(life.attributes('data-value')).toBe('31');
		await life.get('[data-step="down"]').trigger('click');

		expect(stateStore.adjustLife).toHaveBeenCalledWith(EVENT_ID, SLOT_ID, 'player3', -1);
	});

	it('offers a Seat a Commander Damage stepper per opposing Commander, and enters it against that one', async () => {
		const opened = createInitialFeatureMatchSessionStateFromSnapshot(snapshot);
		const { wrapper } = mountTable({
			player2: {
				...opened.player2,
				commanderDamage: [
					{ seat: 'player3', commander: 2, damage: 7 },
				],
			},
		});
		const steppers = seat(wrapper, 'player2').findAll('[data-commander-damage]');

		// Ana's one Commander and each of Cleo's pair; none of its own, none for the empty Seat.
		expect(steppers.map(stepper => [
			stepper.attributes('data-commander-damage'),
			stepper.get('[data-counter]').attributes('data-value'),
		]))
			.toEqual([
				['player1:1', '0'],
				['player3:1', '0'],
				['player3:2', '7'],
			]);
		expect(steppers[2]!.text()).toContain('Kraum');

		await steppers[2]!.get('[data-step="up"]').trigger('click');

		expect(stateStore.adjustCommanderDamage).toHaveBeenCalledWith(EVENT_ID, SLOT_ID, 'player2', 'player3', 2, 1);
	});

	it('hands each Seat\'s counters to its counter list', () => {
		const opened = createInitialFeatureMatchSessionStateFromSnapshot(snapshot);
		const { wrapper } = mountTable({
			player1: {
				...opened.player1,
				counters: [
					{ type: 'poison', value: 3 },
				],
			},
		});

		const counters = seat(wrapper, 'player1').get('[data-match-state-part="counters"]');
		expect([
			counters.attributes('data-player'),
			counters.attributes('data-counters'),
		])
			.toEqual([
				'player1',
				JSON.stringify([
					{ type: 'poison', value: 3 },
				]),
			]);
	});

	it('counts the cards a Seat keeps while mulligans are taken', async () => {
		const { wrapper } = mountTable({ turnNumber: 0 });
		const hand = seat(wrapper, 'player2').get('[data-counter][data-label="Ben hand size"]');

		expect(hand.attributes('data-value')).toBe('7');
		await hand.get('[data-step="down"]').trigger('click');

		expect(stateStore.setCardsKept).toHaveBeenCalledWith(EVENT_ID, SLOT_ID, 'player2', 6);
	});

	it('shows which Seats are Eliminated and sets it for the Seat toggled', async () => {
		const opened = createInitialFeatureMatchSessionStateFromSnapshot(snapshot);
		const { wrapper } = mountTable({
			player1: { ...opened.player1, eliminated: true },
		});

		expect(SEAT_VALUES.map(key => seat(wrapper, key).attributes('data-eliminated'))).toEqual(['true', 'false', 'false', 'false']);
		const toggle = seat(wrapper, 'player2').get('[role="switch"]');
		expect(toggle.text()).toBe('Eliminated');
		await toggle.trigger('click');

		expect(stateStore.setEliminated).toHaveBeenCalledWith(EVENT_ID, SLOT_ID, 'player2', true);
	});

	it.each([
		[
			'a Seat the winner',
			(wrapper: Table) => button(seat(wrapper, 'player2'), 'Declare Ben the winner'),
			{ winner: 'player2' },
		],
		[
			'a draw',
			(wrapper: Table) => button(wrapper, 'Declare Draw'),
			{ winner: null },
		],
	] as const)('declares %s', async (_case, control, outcome) => {
		const { wrapper } = mountTable();

		await control(wrapper).trigger('click');

		expect(stateStore.setOutcome).toHaveBeenCalledWith(EVENT_ID, SLOT_ID, outcome);
	});

	it('shows a declared outcome in place of the controls that declare one, and takes it back', async () => {
		const { wrapper } = mountTable({
			isComplete: true,
			outcome: { winner: 'player3' },
		});

		expect(wrapper.get('[data-outcome]').text()).toContain('Cleo wins');
		expect(seat(wrapper, 'player3').attributes('data-winner')).toBe('true');
		expect(button(wrapper, 'Declare Draw')).toBeUndefined();
		await button(wrapper, 'Undo').trigger('click');

		expect(stateStore.setOutcome).toHaveBeenCalledWith(EVENT_ID, SLOT_ID, null);
	});

	it('asks which Seat goes first, of the filled ones, and starts the turn there', async () => {
		const { wrapper } = mountTable({ turnNumber: 0 });

		expect(SEAT_VALUES.map(key => !!button(seat(wrapper, key), 'Goes First'))).toEqual([true, true, true, false]);
		await button(seat(wrapper, 'player3'), 'Goes First').trigger('click');

		await vi.waitFor(() => expect(stateStore.selectFirstPlayer).toHaveBeenCalledWith(EVENT_ID, SLOT_ID, 'player3'));
		// The hands not yet counted are kept at full, for the filled Seats alone.
		expect(stateStore.setCardsKept.mock.calls.map(call => call[2])).toEqual(['player1', 'player2', 'player3']);
	});

	it('marks the Seat whose turn it is and steps the turn on', async () => {
		const { wrapper } = mountTable({ firstPlayer: 'player2', activePlayer: 'player3', turnNumber: 4 });

		expect(SEAT_VALUES.map(key => seat(wrapper, key).attributes('data-active'))).toEqual(['false', 'false', 'true', 'false']);
		expect(wrapper.text()).toContain('Turn 4');
		await button(wrapper, 'Next step').trigger('click');

		expect(stateStore.stepTurn).toHaveBeenCalledWith(EVENT_ID, SLOT_ID, 1);
	});

	// A Controls Screen may show the game without letting its viewer change life.
	it.each([
		[undefined, 'false'],
		[
			{ allowLifeControls: false },
			'true',
		],
	])('with config %j, has life and Commander Damage read-only: %s', (config, readonly) => {
		const { wrapper } = mountTable({}, { config });

		expect(new Set(wrapper.findAll('[data-counter]').map(counter => counter.attributes('data-readonly')))).toEqual(new Set([readonly]));
	});
});
