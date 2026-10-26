import { describe, expect, it } from 'vitest';

describe('usePlayerDisplayConfig', () => {
	it('shows a Player\'s identity and controls, but not their record or LGS, unless configured', () => {
		const defaults = usePlayerDisplayConfig(undefined);
		const configured = usePlayerDisplayConfig({ showName: false, showRecord: true, allowLifeControls: false, startingHandSize: 5 });

		expect([defaults.showName.value, defaults.showRecord.value, defaults.showLgs.value, defaults.allowLifeControls.value, defaults.startingHandSize.value])
			.toEqual([true, false, false, true, 7]);
		expect([configured.showName.value, configured.showRecord.value, configured.allowLifeControls.value, configured.startingHandSize.value])
			.toEqual([false, true, false, 5]);
	});

	it('labels the seat from the config, else from the default it is given', () => {
		expect(usePlayerDisplayConfig(undefined, 'Top').seatLabel.value).toBe('Top');
		expect(usePlayerDisplayConfig({ seatLabel: 'Left' }, 'Top').seatLabel.value).toBe('Left');
	});

	it('follows a config that changes', () => {
		const config = ref<any>({ showName: true });
		const result = usePlayerDisplayConfig(config);

		config.value = { showName: false };

		expect(result.showName.value).toBe(false);
	});
});
