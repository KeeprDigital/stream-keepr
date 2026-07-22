import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { computed, defineComponent, ref } from 'vue';

const loading = ref(false);
const error = ref<string | null>(null);
const match = ref<any>(null);
const matchState = ref<any>(null);
const config = ref({
	featureMatchId: null as number | null,
	showClock: true,
	showOvertime: true,
	showTableNumber: true,
	showNames: true,
	showPronouns: true,
	showDeckNames: true,
	showCounters: true,
	showRecords: true,
	showMulliganInfo: true,
	showLgs: true,
	leftSidePlayer: 'player1' as const,
	allowLifeControls: true,
	allowGameWinControls: true,
	allowCounterControls: true,
});

mockNuxtImport('useScreenContext', () => () => ({
	eventId: computed(() => 1),
}));

mockNuxtImport('useEventStore', () => () => ({
	event: { featureMatchOrientation: 'horizontal' },
}));

mockNuxtImport('useFeatureMatchModeData', () => () => ({
	config: computed(() => config.value),
	match: computed(() => match.value),
	matchState: computed(() => matchState.value),
	loading,
	error,
}));

mockNuxtImport('useFeatureMatchGameMode', () => () => ({
	activePlayerTrackingEnabled: computed(() => false),
	inMulliganPhase: computed(() => false),
	startingHandSize: computed(() => 7),
	turnCounterMode: computed(() => 'counter'),
	showTurnCounter: computed(() => false),
	turnCounterLabel: computed(() => 'Turn'),
	turnHalf: computed(() => 1),
	stepBackDisabled: computed(() => false),
	extraTurnsLabel: computed(() => 'Extra Turns'),
	handleTurnChange: () => {},
	handleSelectFirstPlayer: () => {},
	handleNextOvertimeTurn: () => {},
	handlePrevOvertimeTurn: () => {},
}));

mockNuxtImport('useClockDisplay', () => () => ({
	displayTime: computed(() => '00:00'),
	timeColorClass: computed(() => ''),
	isExpired: computed(() => false),
	isInOvertime: computed(() => false),
}));

const ScreenModeBaseStub = defineComponent({
	props: {
		error: { type: String, required: false },
		empty: { type: Boolean, required: false },
	},
	template: `
		<div data-testid="mode-base" :data-empty="String(!!empty)" :data-error="error || ''">
			<div v-if="!empty"><slot /></div>
		</div>
	`,
});

async function mountComponent() {
	const componentPath = '../../../../../../../app/components/Screen/Modes/FeatureMatch/Display.vue';
	const { default: Display } = await import(componentPath);

	return mount(Display, {
		global: {
			stubs: {
				ScreenModeBase: ScreenModeBaseStub,
				ScreenModesFeatureMatchPlayerSide: true,
				FeatureMatchStateOvertimeTurnsCounter: true,
				FeatureMatchStateTurnCounter: true,
				UIcon: true,
			},
		},
	});
}

describe('screenFeatureMatchDisplay', () => {
	beforeEach(() => {
		loading.value = false;
		error.value = null;
		match.value = null;
		matchState.value = null;
		config.value = {
			featureMatchId: null,
			showClock: true,
			showOvertime: true,
			showTableNumber: true,
			showNames: true,
			showPronouns: true,
			showDeckNames: true,
			showCounters: true,
			showRecords: true,
			showMulliganInfo: true,
			showLgs: true,
			leftSidePlayer: 'player1',
			allowLifeControls: true,
			allowGameWinControls: true,
			allowCounterControls: true,
		};
	});

	it('renders the empty state when no feature match is assigned', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="mode-base"]').attributes('data-empty')).toBe('true');
	});

	it('surfaces composable load errors', async () => {
		config.value.featureMatchId = 1;
		error.value = 'Failed to load feature match data';

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="mode-base"]').attributes('data-error')).toBe('Failed to load feature match data');
	});

	it('shows match not found when the configured match data is missing after load', async () => {
		config.value.featureMatchId = 1;

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="mode-base"]').attributes('data-error')).toBe('Match not found');
	});
});
