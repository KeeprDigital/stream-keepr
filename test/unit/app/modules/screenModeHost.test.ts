import { describe, expect, it } from 'vitest';
import {
	getScreenModeConfigurationPolicy,
	getScreenModeDisplayType,
	getScreenModeHostDefinition,
	isControlScreenMode,
	resolveScreenModeHost,
} from '~/modules/screen-mode';

describe('screen mode host', () => {
	it('classifies each mode as an overlay or a control host', () => {
		expect(getScreenModeDisplayType('feature-match')).toBe('control');
		expect(isControlScreenMode('feature-match')).toBe(true);
		expect(isControlScreenMode('deck')).toBe(false);
	});

	it('sizes, pads, aligns and scales a fixed-size overlay to its window', () => {
		const host = resolveScreenModeHost({
			mode: 'card',
			screenConfig: { width: 1280, height: 720, paddingX: 32, paddingY: 16, background: '#101010', horizontalAlign: 'right', verticalAlign: 'bottom' },
			viewportWidth: 640,
			viewportHeight: 360,
		});

		expect(host).toMatchObject({ kind: 'overlay', provideOverlayContainer: true });
		expect(host.containerStyle).toMatchObject({
			width: '1280px',
			height: '720px',
			padding: '16px 32px',
			background: '#101010',
			justifyItems: 'end',
			alignItems: 'end',
			transform: 'translate(0px, 0px) scale(0.5)',
			transformOrigin: 'top left',
		});
	});

	it('fills the window with an overlay that has no fixed size, unscaled', () => {
		const host = resolveScreenModeHost({ mode: 'deck', screenConfig: {}, viewportWidth: 1920, viewportHeight: 1080 });

		expect(host.containerStyle).toMatchObject({ width: '100%', height: '100%', justifyItems: 'center', alignItems: 'center' });
		expect(host.containerStyle).not.toHaveProperty('transform');
	});

	it('hosts the Feature Match Overlay at 1920×1080 without the Screen\'s padding or background', () => {
		const host = resolveScreenModeHost({
			mode: 'feature-match-overlay',
			screenConfig: { paddingX: 64, paddingY: 32, background: '#ff00ff', horizontalAlign: 'left', verticalAlign: 'top' },
		});

		expect(getScreenModeHostDefinition('feature-match-overlay')).toMatchObject({
			defaultWidth: 1920,
			defaultHeight: 1080,
			useScreenPadding: false,
			useScreenBackground: false,
			useScreenAlignment: true,
		});
		expect(host.containerStyle).toMatchObject({ width: '1920px', height: '1080px', padding: '0px 0px', justifyItems: 'start', alignItems: 'start' });
		expect(host.containerStyle).not.toHaveProperty('background');
	});

	it('hosts Broadcast Graphics transparently, scaling its whole canvas uniformly', () => {
		const host = resolveScreenModeHost({
			mode: 'broadcast-graphics',
			screenConfig: { paddingX: 64, paddingY: 32, background: '#ff00ff', horizontalAlign: 'left', verticalAlign: 'top' },
			viewportWidth: 960,
			viewportHeight: 540,
		});

		expect(host.containerStyle).toMatchObject({ width: '1920px', height: '1080px', padding: '0px 0px', transform: 'translate(0px, 0px) scale(0.5)' });
		expect(host.containerStyle).not.toHaveProperty('background');
		expect(host.containerStyle).not.toHaveProperty('justifyItems');
	});

	// Scaling is the mode's own registration, so the output on air fits its window (#232).
	it('letterboxes a scaling canvas in a window of another aspect ratio', () => {
		const host = resolveScreenModeHost({
			mode: 'broadcast-graphics',
			screenConfig: { width: 1920, height: 1080 },
			viewportWidth: 1551,
			viewportHeight: 900,
		});

		const scale = 1551 / 1920;
		expect(host.containerStyle.transform).toBe(`translate(0px, ${(900 - 1080 * scale) / 2}px) scale(${scale})`);
	});

	it('never scales a mode whose host does not register viewport-fit scaling', () => {
		const host = resolveScreenModeHost({ mode: 'feature-match', screenConfig: { width: 1920, height: 1080 }, viewportWidth: 800, viewportHeight: 600 });

		expect(host.kind).toBe('control');
		expect(host.containerStyle).not.toHaveProperty('transform');
	});

	it('pads a control host and follows its color mode', () => {
		const systemDark = resolveScreenModeHost({ mode: 'feature-match', screenConfig: { paddingX: 20, paddingY: 12, colorMode: 'system' }, preferredDark: true });
		const explicitLight = resolveScreenModeHost({ mode: 'feature-match', screenConfig: { colorMode: 'light' }, preferredDark: true });

		expect(systemDark).toMatchObject({
			kind: 'control',
			containerStyle: { padding: '12px 20px' },
			wrapperClass: ['dark'],
			wrapperStyle: { colorScheme: 'dark' },
			provideOverlayContainer: false,
		});
		expect(explicitLight.wrapperClass).toEqual(['light']);
		expect(explicitLight.wrapperStyle).toEqual({ colorScheme: 'light' });
	});

	describe('configuration policy', () => {
		it('offers a pixel-exact Feature Match Overlay with fill and key outputs, its container controls in the container', () => {
			expect(getScreenModeConfigurationPolicy('feature-match-overlay')).toMatchObject({
				displayType: 'overlay',
				containerControls: { dimensions: true, padding: false, textColors: false, background: false },
				containerControlPlacement: { dimensions: 'mode', padding: 'container', textColors: 'container', background: 'container' },
				dimensions: { width: { defaultValue: 1920 }, height: { defaultValue: 1080 } },
				resetScreenConfigDefaults: { width: 1920, height: 1080 },
			});
			expect(getScreenModeConfigurationPolicy('feature-match-overlay').outputOptions.map(option => option.value)).toEqual(['overlay', 'fill', 'key']);
		});

		it('keeps a generic overlay fluid and output-free', () => {
			const policy = getScreenModeConfigurationPolicy('card');

			expect(policy).toMatchObject({
				displayType: 'overlay',
				containerControls: { dimensions: true, padding: true, textColors: true, background: true },
				dimensions: { width: { defaultValue: null }, height: { defaultValue: null } },
				outputOptions: [],
			});
			expect(policy.resetScreenConfigDefaults).toBeUndefined();
		});

		it('offers a control host no outputs', () => {
			expect(getScreenModeConfigurationPolicy('feature-match')).toMatchObject({ displayType: 'control', outputOptions: [] });
		});
	});
});
