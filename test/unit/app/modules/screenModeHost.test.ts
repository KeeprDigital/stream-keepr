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
/** A Theme setting the Screen inset and alignment away from their defaults. */
const LAYOUT_THEME = {
	inset: 32,
	alignment: { horizontal: 'right', vertical: 'bottom' },
};

describe('screen mode host', () => {
	it('classifies each mode as an overlay or a control host', () => {
		expect(getScreenModeDisplayType('feature-match')).toBe('control');
		expect(isControlScreenMode('feature-match')).toBe(true);
		expect(isControlScreenMode('deck')).toBe(false);
	});

	// The Screen inset and alignment Foundation Tokens: override, else Theme, else default.
	it.each([
		[
			'the Default Theme',
			{},
			{},
			'0px',
			'center',
			'center',
		],
		[
			'its Theme',
			LAYOUT_THEME,
			{},
			'32px',
			'end',
			'end',
		],
		[
			'its Screen\'s overrides over its Theme',
			LAYOUT_THEME,
			{
				inset: 8,
				alignment: { horizontal: 'left', vertical: 'top' },
			},
			'8px',
			'start',
			'start',
		],
	])('insets and aligns a plain mode in its canvas by %s', (_case, theme, overrides, padding, justifyItems, alignItems) => {
		const host = resolveScreenModeHost({
			mode: 'card',
			canvas: CANVAS,
			theme,
			overrides,
		});

		expect(host).toMatchObject({ kind: 'overlay', provideOverlayContainer: true });
		expect(host.containerStyle).toMatchObject({ padding, justifyItems, alignItems });
	});

	// Graphics hosts compose pixel-exact and keyable; the Background Screen is its stack, edge to edge.
	it.each(['feature-match-overlay', 'broadcast-graphics', 'background'] as const)('hosts %s in its canvas, ignoring the Screen inset and alignment', (mode) => {
		const host = resolveScreenModeHost({
			mode,
			canvas: CANVAS,
			theme: LAYOUT_THEME,
			overrides: {},
		});

		expect(host.containerStyle).toMatchObject({ width: '1280px', height: '720px' });
		expect(host.containerStyle).not.toHaveProperty('padding');
		expect(host.containerStyle).not.toHaveProperty('justifyItems');
		expect(host.containerStyle).not.toHaveProperty('alignItems');
	});

	// ADR-0051: the Event Canvas is a coordinate space; output resolution is the window's.
	it.each(OVERLAY_MODES)('renders %s in the Event Canvas, scaled uniformly to fit its window', (mode) => {
		const host = resolveScreenModeHost({
			mode,
			canvas: CANVAS,
			theme: {},
			overrides: {},
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
			theme: {},
			overrides: {},
			...viewport,
		});

		expect(host.containerStyle.transform).toBe(`translate(${offsetX}px, ${offsetY}px) scale(${scale})`);
	});

	it('never scales a mode whose host does not register viewport-fit scaling', () => {
		const host = resolveScreenModeHost({
			mode: 'feature-match',
			canvas: CANVAS,
			theme: {},
			overrides: {},
			viewportWidth: 800,
			viewportHeight: 600,
		});

		expect(host.kind).toBe('control');
		expect(host.containerStyle).not.toHaveProperty('transform');
	});

	// An operator surface keeps the app's own look and fills its window (ADR-0051).
	it('hosts Feature Match Controls the same under any Theme', () => {
		const underDefault = resolveScreenModeHost({
			mode: 'feature-match',
			canvas: CANVAS,
			theme: {},
			overrides: {},
		});
		const underTheme = resolveScreenModeHost({
			mode: 'feature-match',
			canvas: CANVAS,
			theme: LAYOUT_THEME,
			overrides: LAYOUT_THEME,
		});

		expect(underTheme).toEqual(underDefault);
		expect(underTheme).toMatchObject({
			kind: 'control',
			containerClass: expect.stringContaining('w-full h-full'),
			containerStyle: {},
			provideOverlayContainer: false,
		});
	});

	describe('configuration policy', () => {
		it('offers the Feature Match Overlay fill and key outputs', () => {
			expect(getScreenModeConfigurationPolicy('feature-match-overlay')).toMatchObject({ displayType: 'overlay' });
			expect(getScreenModeConfigurationPolicy('feature-match-overlay').outputOptions.map(option => option.value)).toEqual(['overlay', 'fill', 'key']);
		});

		it('keeps a generic overlay output-free', () => {
			expect(getScreenModeConfigurationPolicy('card')).toMatchObject({
				displayType: 'overlay',
				outputOptions: [],
			});
		});

		it('offers a control host no outputs', () => {
			expect(getScreenModeConfigurationPolicy('feature-match')).toMatchObject({ displayType: 'control', outputOptions: [] });
		});
	});
});
