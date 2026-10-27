import { describe, expect, it } from 'vitest';
import {
	getScreenModeConfigurationPolicy,
	getScreenModeDefinition,
	getScreenModeSelectOptions,
} from '~~/shared/screenModeDefinitions';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';

describe('screen Mode Definition module', () => {
	it('keeps each definition, its host, its policy and its select option in agreement', () => {
		const selectOptions = getScreenModeSelectOptions();

		for (const mode of SCREEN_MODE_VALUES) {
			const definition = getScreenModeDefinition(mode);

			expect(definition.mode).toBe(mode);
			expect(definition.host.kind).toBe(definition.displayType);
			expect(definition.configurationPolicy.displayType).toBe(definition.displayType);
			expect(selectOptions).toContainEqual({ label: definition.label, value: mode, icon: definition.icon });
		}
	});

	it('gives Broadcast Graphics a transparent host that fits its canvas to the viewport uniformly', () => {
		const definition = getScreenModeDefinition('broadcast-graphics');

		expect(definition.host).toEqual({
			kind: 'overlay',
			useScreenPadding: false,
			useScreenBackground: false,
			useScreenAlignment: false,
			fitToViewport: true,
			themePolicy: 'none',
		});
	});

	it('exposes overlay, fill, and key Screen Outputs for Broadcast Graphics', () => {
		const policy = getScreenModeConfigurationPolicy('broadcast-graphics');

		expect(policy.outputOptions.map(option => option.value)).toEqual(['overlay', 'fill', 'key']);
	});

	it('gives every graphics host the full Screen configuration width for its compositor', () => {
		expect(getScreenModeConfigurationPolicy('broadcast-graphics').fullWidthConfiguration).toBe(true);
		expect(getScreenModeConfigurationPolicy('feature-match-overlay').fullWidthConfiguration).toBe(true);
		expect(getScreenModeConfigurationPolicy('standings').fullWidthConfiguration).toBe(false);
	});

	it('keeps Feature Match Overlay output options in shared policy', () => {
		const policy = getScreenModeConfigurationPolicy('feature-match-overlay');

		expect(policy.outputOptions.map(option => option.value)).toEqual(['overlay', 'fill', 'key']);
	});
});
