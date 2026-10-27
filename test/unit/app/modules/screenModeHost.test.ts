import { describe, expect, it } from 'vitest';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import {
	getScreenModeConfigurationPolicy,
	getScreenModeDisplayType,
	isControlScreenMode,
	resolveScreenModeHost,
} from '~/modules/screen-mode';

/** An Event Canvas other than the default, so a host that ignores it shows. */
const CANVAS = { width: 1280, height: 720 };
const OVERLAY_MODES = SCREEN_MODE_VALUES.filter(mode => !isControlScreenMode(mode));

describe('screen mode host', () => {
	it('classifies each mode as an overlay or a control host', () => {
		expect(getScreenModeDisplayType('feature-match')).toBe('control');
		expect(isControlScreenMode('feature-match')).toBe(true);
		expect(isControlScreenMode('deck')).toBe(false);
	});

	it('pads and aligns an overlay inside its canvas', () => {
		const host = resolveScreenModeHost({
			mode: 'card',
			canvas: CANVAS,
			screenConfig: {
				paddingX: 32,
				paddingY: 16,
				background: '#101010',
				horizontalAlign: 'right',
				verticalAlign: 'bottom',
			},
		});

		expect(host).toMatchObject({ kind: 'overlay', provideOverlayContainer: true });
		expect(host.containerStyle).toMatchObject({
			padding: '16px 32px',
			background: '#101010',
			justifyItems: 'end',
			alignItems: 'end',
		});
	});

	// ADR-0051: the Event Canvas is a coordinate space; output resolution is the window's.
	it.each(OVERLAY_MODES)('renders %s in the Event Canvas, scaled uniformly to fit its window', (mode) => {
		const host = resolveScreenModeHost({
			mode,
			canvas: CANVAS,
			screenConfig: {},
			viewportWidth: 640,
			viewportHeight: 360,
		});

		expect(host.containerStyle).toMatchObject({
			width: '1280px',
			height: '720px',
			transform: 'translate(0px, 0px) scale(0.5)',
			transformOrigin: 'top left',
		});
	});

	it.each([
		[
			'letterboxes',
			{ viewportWidth: 1000, viewportHeight: 1000 },
			1000 / 1280,
			0,
			(1000 - 720 * (1000 / 1280)) / 2,
		],
		[
			'pillarboxes',
			{ viewportWidth: 2560, viewportHeight: 1080 },
			1.5,
			(2560 - 1280 * 1.5) / 2,
			0,
		],
	])('%s the canvas in a window of another aspect ratio', (_case, viewport, scale, offsetX, offsetY) => {
		const host = resolveScreenModeHost({
			mode: 'standings',
			canvas: CANVAS,
			screenConfig: {},
			...viewport,
		});

		expect(host.containerStyle.transform).toBe(`translate(${offsetX}px, ${offsetY}px) scale(${scale})`);
	});

	it('hosts the Feature Match Overlay in the Event Canvas without the Screen\'s padding or background', () => {
		const host = resolveScreenModeHost({
			mode: 'feature-match-overlay',
			canvas: CANVAS,
			screenConfig: {
				paddingX: 64,
				paddingY: 32,
				background: '#ff00ff',
				horizontalAlign: 'left',
				verticalAlign: 'top',
			},
		});

		expect(host.containerStyle).toMatchObject({
			width: '1280px',
			height: '720px',
			padding: '0px 0px',
			justifyItems: 'start',
			alignItems: 'start',
		});
		expect(host.containerStyle).not.toHaveProperty('background');
	});

	it('hosts Broadcast Graphics transparently in the Event Canvas', () => {
		const host = resolveScreenModeHost({
			mode: 'broadcast-graphics',
			canvas: CANVAS,
			screenConfig: {
				paddingX: 64,
				paddingY: 32,
				background: '#ff00ff',
				horizontalAlign: 'left',
				verticalAlign: 'top',
			},
		});

		expect(host.containerStyle).toMatchObject({ width: '1280px', height: '720px', padding: '0px 0px' });
		expect(host.containerStyle).not.toHaveProperty('background');
		expect(host.containerStyle).not.toHaveProperty('justifyItems');
	});

	it('never scales a mode whose host does not register viewport-fit scaling', () => {
		const host = resolveScreenModeHost({
			mode: 'feature-match',
			canvas: CANVAS,
			screenConfig: {},
			viewportWidth: 800,
			viewportHeight: 600,
		});

		expect(host.kind).toBe('control');
		expect(host.containerStyle).not.toHaveProperty('transform');
	});

	it('pads a control host and follows its color mode', () => {
		const systemDark = resolveScreenModeHost({
			mode: 'feature-match',
			canvas: CANVAS,
			screenConfig: { paddingX: 20, paddingY: 12, colorMode: 'system' },
			preferredDark: true,
		});
		const explicitLight = resolveScreenModeHost({
			mode: 'feature-match',
			canvas: CANVAS,
			screenConfig: { colorMode: 'light' },
			preferredDark: true,
		});

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
		it('offers the Feature Match Overlay fill and key outputs, without the generic container controls', () => {
			expect(getScreenModeConfigurationPolicy('feature-match-overlay')).toMatchObject({
				displayType: 'overlay',
				containerControls: {
					padding: false,
					textColors: false,
					background: false,
				},
			});
			expect(getScreenModeConfigurationPolicy('feature-match-overlay').outputOptions.map(option => option.value)).toEqual(['overlay', 'fill', 'key']);
		});

		it('keeps a generic overlay output-free', () => {
			expect(getScreenModeConfigurationPolicy('card')).toMatchObject({
				displayType: 'overlay',
				containerControls: {
					padding: true,
					// Card Spotlight is on Mode Tokens, which hold its text colours.
					textColors: false,
					background: true,
				},
				outputOptions: [],
			});
		});

		it('offers a control host no outputs', () => {
			expect(getScreenModeConfigurationPolicy('feature-match')).toMatchObject({ displayType: 'control', outputOptions: [] });
		});
	});
});
