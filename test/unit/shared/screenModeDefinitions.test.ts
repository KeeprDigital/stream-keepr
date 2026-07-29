import { describe, expect, it } from 'vitest';
import {
	getScreenModeConfigurationPolicy,
	getScreenModeDefinition,
	getScreenModeSelectOptions,
} from '~~/shared/screenModeDefinitions';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';

describe('screen Mode Definition module', () => {
	it('defines metadata, defaults, host policy, and select options for every Screen Mode', () => {
		const selectOptions = getScreenModeSelectOptions();

		for (const mode of SCREEN_MODE_VALUES) {
			const definition = getScreenModeDefinition(mode);

			expect(definition.mode).toBe(mode);
			expect(definition.label).toBeTruthy();
			expect(definition.icon).toBeTruthy();
			expect(definition.description).toBeTruthy();
			expect(definition.displayType).toMatch(/^(overlay|control)$/);
			expect(definition.getDefaultConfig()).toBeTruthy();
			expect(definition.getDisplayDefaults()).toBeTruthy();
			expect(definition.host.kind).toMatch(/^(overlay|control)$/);
			expect(definition.configurationPolicy.displayType).toBe(definition.displayType);
			expect(selectOptions).toContainEqual({ label: definition.label, value: mode, icon: definition.icon });
		}
	});

	it('gives Broadcast Graphics a transparent host with a 1920x1080 canvas that fits the viewport uniformly', () => {
		const definition = getScreenModeDefinition('broadcast-graphics');

		expect(definition.host).toEqual({
			kind: 'overlay',
			defaultWidth: 1920,
			defaultHeight: 1080,
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
		expect(policy.containerControlPlacement.dimensions).toBe('mode');
		expect(policy.resetScreenConfigDefaults).toEqual({ width: 1920, height: 1080 });
	});

	it('keeps Feature Match Overlay fixed dimensions and output options in shared policy', () => {
		const definition = getScreenModeDefinition('feature-match-overlay');
		const policy = getScreenModeConfigurationPolicy('feature-match-overlay');

		expect(definition.host.defaultWidth).toBe(1920);
		expect(definition.host.defaultHeight).toBe(1080);
		expect(policy.containerControlPlacement.dimensions).toBe('mode');
		expect(policy.resetScreenConfigDefaults).toEqual({ width: 1920, height: 1080 });
		expect(policy.outputOptions.map(option => option.value)).toEqual(['overlay', 'fill', 'key']);
	});
});
