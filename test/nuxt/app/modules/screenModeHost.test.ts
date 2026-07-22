import { describe, expect, it } from 'vitest';
import {
	getScreenModeConfigurationPolicy,
	getScreenModeDisplayType,
	getScreenModeHostDefinition,
	getScreenModeIcon,
	getScreenModeLabel,
	getScreenModeSelectOptions,
	isControlScreenMode,
	resolveScreenModeHost,
} from '~/modules/screen-mode';

describe('screen mode host definition', () => {
	it('exposes screen mode presentation metadata through the Screen Mode Definition boundary', () => {
		expect(getScreenModeLabel('feature-match-overlay')).toBe('Feature Match Overlay');
		expect(getScreenModeIcon('feature-match-overlay')).toBe('i-lucide-panels-top-left');
		expect(getScreenModeDisplayType('feature-match')).toBe('control');
		expect(isControlScreenMode('feature-match')).toBe(true);
		expect(isControlScreenMode('deck')).toBe(false);
		expect(getScreenModeSelectOptions()).toContainEqual({
			label: 'Feature Match Overlay',
			value: 'feature-match-overlay',
			icon: 'i-lucide-panels-top-left',
		});
	});

	it('resolves standard overlay host policy from the Screen Mode Definition boundary', () => {
		const host = resolveScreenModeHost({
			mode: 'card',
			screenConfig: {
				width: 1280,
				height: 720,
				paddingX: 32,
				paddingY: 16,
				background: '#101010',
				horizontalAlign: 'right',
				verticalAlign: 'bottom',
			},
			fitToViewport: true,
			viewportWidth: 640,
			viewportHeight: 360,
		});

		expect(host).toMatchObject({
			kind: 'overlay',
			containerClass: 'screen-renderer',
			provideOverlayContainer: true,
			wrapperClass: [],
			wrapperStyle: {},
		});
		expect(host.containerStyle).toMatchObject({
			width: '1280px',
			height: '720px',
			flexShrink: '0',
			padding: '16px 32px',
			background: '#101010',
			justifyItems: 'end',
			alignItems: 'end',
			transform: 'scale(0.5)',
			transformOrigin: 'top left',
			margin: '0',
		});
	});

	it('uses fluid overlay dimensions when a mode has no fixed host size', () => {
		const host = resolveScreenModeHost({
			mode: 'deck',
			screenConfig: {},
			fitToViewport: true,
			viewportWidth: 1920,
			viewportHeight: 1080,
		});

		expect(host.containerStyle).toMatchObject({
			width: '100%',
			height: '100%',
			padding: '0px 0px',
			justifyItems: 'center',
			alignItems: 'center',
		});
		expect(host.containerStyle).not.toHaveProperty('transform');
	});

	it('keeps Feature Match Overlay host defaults and exclusions out of renderer code', () => {
		const definition = getScreenModeHostDefinition('feature-match-overlay');
		const policy = getScreenModeConfigurationPolicy('feature-match-overlay');
		const host = resolveScreenModeHost({
			mode: 'feature-match-overlay',
			screenConfig: {
				paddingX: 64,
				paddingY: 32,
				background: '#ff00ff',
				horizontalAlign: 'left',
				verticalAlign: 'top',
			},
		});

		expect(definition).toMatchObject({
			kind: 'overlay',
			defaultWidth: 1920,
			defaultHeight: 1080,
			useScreenPadding: false,
			useScreenBackground: false,
			useScreenAlignment: true,
		});
		expect(policy).toMatchObject({
			displayType: 'overlay',
			containerControls: {
				dimensions: true,
				padding: false,
				textColors: false,
				background: false,
			},
			containerControlPlacement: {
				dimensions: 'mode',
				padding: 'container',
				textColors: 'container',
				background: 'container',
			},
			dimensions: {
				width: {
					defaultValue: 1920,
					placeholder: '1920',
					description: 'Pixel-exact output width in pixels.',
				},
				height: {
					defaultValue: 1080,
					placeholder: '1080',
					description: 'Pixel-exact output height in pixels.',
				},
			},
			resetScreenConfigDefaults: {
				width: 1920,
				height: 1080,
			},
			outputOptions: [
				{ value: 'overlay', label: 'Open overlay output', icon: 'i-lucide-panel-top' },
				{ value: 'fill', label: 'Open fill output', icon: 'i-lucide-square' },
				{ value: 'key', label: 'Open key output', icon: 'i-lucide-contrast' },
			],
		});
		expect(host.containerStyle).toMatchObject({
			width: '1920px',
			height: '1080px',
			padding: '0px 0px',
			justifyItems: 'start',
			alignItems: 'start',
		});
		expect(host.containerStyle).not.toHaveProperty('background');
	});

	it('keeps generic overlay configuration policy fluid and output-free', () => {
		const policy = getScreenModeConfigurationPolicy('card');

		expect(policy).toMatchObject({
			displayType: 'overlay',
			containerControls: {
				dimensions: true,
				padding: true,
				textColors: true,
				background: true,
			},
			dimensions: {
				width: {
					defaultValue: null,
					placeholder: 'Auto',
					description: 'Overlay width in pixels. Leave empty to fill the viewport.',
				},
				height: {
					defaultValue: null,
					placeholder: 'Auto',
					description: 'Overlay height in pixels. Leave empty to fill the viewport.',
				},
			},
			outputOptions: [],
		});
		expect(policy.resetScreenConfigDefaults).toBeUndefined();
	});

	it('resolves control host padding and screen color mode theme', () => {
		const policy = getScreenModeConfigurationPolicy('feature-match');
		const systemDarkHost = resolveScreenModeHost({
			mode: 'feature-match',
			screenConfig: {
				paddingX: 20,
				paddingY: 12,
				colorMode: 'system',
			},
			preferredDark: true,
		});
		const explicitLightHost = resolveScreenModeHost({
			mode: 'feature-match',
			screenConfig: {
				colorMode: 'light',
			},
			preferredDark: true,
		});

		expect(policy).toMatchObject({
			displayType: 'control',
			outputOptions: [],
		});
		expect(systemDarkHost).toMatchObject({
			kind: 'control',
			containerClass: 'screen-control-renderer w-full h-full overflow-hidden',
			containerStyle: {
				padding: '12px 20px',
			},
			wrapperClass: ['dark'],
			wrapperStyle: {
				colorScheme: 'dark',
			},
			provideOverlayContainer: false,
		});
		expect(explicitLightHost.wrapperClass).toEqual(['light']);
		expect(explicitLightHost.wrapperStyle).toEqual({ colorScheme: 'light' });
	});
});
