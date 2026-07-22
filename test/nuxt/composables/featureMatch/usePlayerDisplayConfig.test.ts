import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('usePlayerDisplayConfig', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns default values when config is undefined', () => {
		const result = usePlayerDisplayConfig(undefined);
		expect(result.showName.value).toBe(true);
		expect(result.showPronouns.value).toBe(true);
		expect(result.showDeckName.value).toBe(true);
		expect(result.showCounters.value).toBe(true);
		expect(result.showRecord.value).toBe(false);
		expect(result.showLgs.value).toBe(false);
		expect(result.showMulliganInfo.value).toBe(true);
		expect(result.allowLifeControls.value).toBe(true);
		expect(result.allowGameWinControls.value).toBe(true);
		expect(result.allowCounterControls.value).toBe(true);
		expect(result.mulliganPhase.value).toBe(false);
		expect(result.startingHandSize.value).toBe(7);
		expect(result.activePlayerTrackingEnabled.value).toBe(false);
		expect(result.hasDeckList.value).toBe(false);
	});

	it('respects config overrides', () => {
		const config = {
			showName: false,
			showRecord: true,
			allowLifeControls: false,
			mulliganPhase: true,
			startingHandSize: 5,
		};
		const result = usePlayerDisplayConfig(config);
		expect(result.showName.value).toBe(false);
		expect(result.showRecord.value).toBe(true);
		expect(result.allowLifeControls.value).toBe(false);
		expect(result.mulliganPhase.value).toBe(true);
		expect(result.startingHandSize.value).toBe(5);
	});

	it('uses defaultSeatLabel when config has no seatLabel', () => {
		const result = usePlayerDisplayConfig(undefined, 'Top');
		expect(result.seatLabel.value).toBe('Top');
	});

	it('prefers config seatLabel over default', () => {
		const config = { seatLabel: 'Left' };
		const result = usePlayerDisplayConfig(config, 'Top');
		expect(result.seatLabel.value).toBe('Left');
	});

	it('supports reactive config', () => {
		const config = ref<any>({ showName: true });
		const result = usePlayerDisplayConfig(config);
		expect(result.showName.value).toBe(true);

		config.value = { showName: false };
		expect(result.showName.value).toBe(false);
	});
});
