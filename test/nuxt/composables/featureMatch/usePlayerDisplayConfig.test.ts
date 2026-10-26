import { describe, expect, it } from 'vitest';

function read(display: ReturnType<typeof usePlayerDisplayConfig>) {
	return Object.fromEntries(Object.entries(display).map(([key, value]) => [key, value.value]));
}

describe('usePlayerDisplayConfig', () => {
	it('shows a Player\'s identity, deck and controls, but not their record or LGS, by default', () => {
		expect(read(usePlayerDisplayConfig(undefined))).toEqual({
			showName: true,
			showPronouns: true,
			showDeckName: true,
			showCounters: true,
			showRecord: false,
			showLgs: false,
			showMulliganInfo: true,
			allowLifeControls: true,
			allowGameWinControls: true,
			allowCounterControls: true,
			mulliganPhase: false,
			startingHandSize: 7,
			activePlayerTrackingEnabled: false,
			hasDeckList: false,
			seatLabel: undefined,
		});
	});

	it('reads what the config sets, following it as it changes', () => {
		const config = ref<any>({ showName: false, showRecord: true, startingHandSize: 5 });
		const display = usePlayerDisplayConfig(config);
		expect(read(display)).toMatchObject({
			showName: false,
			showRecord: true,
			startingHandSize: 5,
			showPronouns: true,
		});

		config.value = { showName: true };

		expect(display.showName.value).toBe(true);
	});

	it('labels the seat from the config, else from the default it is given', () => {
		expect(usePlayerDisplayConfig(undefined, 'Top').seatLabel.value).toBe('Top');
		expect(usePlayerDisplayConfig({ seatLabel: 'Left' }, 'Top').seatLabel.value).toBe('Left');
	});
});
