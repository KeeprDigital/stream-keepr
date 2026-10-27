import type { GraphicThemeOwner } from '~~/shared/modules/graphics';
import type { BroadcastGraphicConfig, GraphicItemConfig } from '~~/shared/types/graphics';
import type { GraphicThemeSlot } from '~~/shared/types/graphicThemeBindings';
import { describe, expect, it } from 'vitest';
import {
	addGraphicItem,
	bindGraphicThemeOwner,
	DEFAULT_GRAPHIC_THEME_TOKENS,
	detachGraphicThemeOwner,
	paintBroadcastGraphicThemeBindings,
	patchGraphicTypography,
	releaseEditedGraphicThemeBindings,
	resolveGraphicThemeTokens,
} from '~~/shared/modules/graphics';
import { FOUNDATION_TOKENS as VOCABULARY } from '~~/shared/modules/theme';
import { gameWins, graphic, group, shape, socialIcon, text } from '~~/test/helpers/graphicsComposition';

// The home of Graphic Item Theme bindings (ADR-0049): a bound property paints its
// Foundation Token's resolved value; detach keeps it as a literal; bind replaces one.

const TOKENS = resolveGraphicThemeTokens({
	'accent': 'rgba(10, 20, 30, 0.5)',
	'text-primary': 'rgb(1, 2, 3)',
	'body': {
		font: { kind: 'application', fontId: 'mplantin' },
		weight: 300,
		lineHeight: 1.7,
		tracking: 0.25,
		case: 'lowercase',
	},
	'panel-shape': {
		...VOCABULARY['panel-shape'].default,
		topLeft: { treatment: 'cut', size: 12 },
	},
	'motion-enter': {
		duration: 900,
		easing: 'linear',
		delay: 50,
		slide: { direction: 'east', distanceMode: 'clear-parent', distance: 0 },
	},
});

function only<T extends GraphicItemConfig>(composition: BroadcastGraphicConfig): T {
	return composition.items[0] as T;
}

function paintOne<T extends GraphicItemConfig>(item: T, tokens = TOKENS): T {
	return only<T>(paintBroadcastGraphicThemeBindings(graphic('g', [item]), tokens));
}

describe('a bound Graphic Item property', () => {
	it.each<[string, GraphicItemConfig, (item: any) => unknown, unknown]>([
		[
			'text colour from a colour token',
			text('t', {
				themeBindings: { 'typography.color': 'text-primary' },
			}),
			item => item.typography.color,
			'rgb(1, 2, 3)',
		],
		[
			'a fill from a fill token whose colour follows the accent',
			shape('s', {
				themeBindings: { 'surfaceStyle.fill': 'accent-fill' },
			}),
			item => item.surfaceStyle.fill,
			{ type: 'solid', color: 'rgba(10, 20, 30, 0.5)' },
		],
		[
			'a whole surface from a surface token',
			shape('s', {
				themeBindings: { surfaceStyle: 'panel' },
			}),
			item => item.surfaceStyle,
			{
				fill: { type: 'solid', color: 'rgba(10, 20, 30, 0.5)' },
				fillOpacity: 1,
			},
		],
		[
			'a win box surface',
			gameWins('w', {
				themeBindings: { wonBoxSurfaceStyle: 'panel' },
			}),
			item => item.wonBoxSurfaceStyle.fill.color,
			'rgba(10, 20, 30, 0.5)',
		],
		[
			'a Shape Geometry from a shape token',
			shape('s', {
				themeBindings: { geometry: 'panel-shape' },
			}),
			item => item.geometry.topLeft,
			{ treatment: 'cut', size: 12 },
		],
		[
			'a Social Network Icon\'s colour',
			socialIcon('i', {
				themeBindings: { color: 'text-primary' },
			}),
			item => item.color,
			'rgb(1, 2, 3)',
		],
		[
			'an item\'s enter recipe from a motion token',
			text('t', {
				themeBindings: { 'animation.enter': 'motion-enter' },
			}),
			item => item.animation.enter,
			{
				duration: 900,
				easing: 'linear',
				delay: 50,
				slide: { direction: 'east', distanceMode: 'clear-parent', distance: 0 },
			},
		],
	])('paints %s', (_case, item, read, expected) => {
		expect(read(paintOne(item))).toEqual(expected);
	});

	it('paints typography\'s face and setting, keeping the item\'s own size, alignment and colour', () => {
		const item = text('t', {
			typography: {
				...text('t').typography,
				fontSize: 40,
				textAlign: 'right',
				color: '#abcdef',
			},
			themeBindings: { typography: 'body' },
		});

		expect(paintOne(item).typography).toEqual({
			...item.typography,
			font: { kind: 'application', fontId: 'mplantin' },
			fontWeight: 300,
			lineHeight: 1.7,
			// Tracking is in em; letter spacing is pixels at the item's own size.
			letterSpacing: 10,
			textTransform: 'lowercase',
		});
	});

	it('paints a Broadcast Graphic\'s own motion and a Graphic Group child', () => {
		const composition: BroadcastGraphicConfig = {
			...graphic('g', [
				group('row', [
					socialIcon('i', {
						themeBindings: { color: 'text-primary' },
					}),
				]),
			]),
			themeBindings: { 'animation.enter': 'motion-enter' },
		};

		const painted = paintBroadcastGraphicThemeBindings(composition, TOKENS);

		expect(painted.animation?.enter?.duration).toBe(900);
		expect(painted.items[0]!.type === 'group' && painted.items[0].children[0]).toMatchObject({ color: 'rgb(1, 2, 3)' });
	});

	it.each([
		[
			'a Screen Theme Override',
			resolveGraphicThemeTokens({ accent: '#111111' }, { accent: '#222222' }),
			'#222222',
		],
		[
			'the Theme',
			resolveGraphicThemeTokens({ accent: '#111111' }),
			'#111111',
		],
		['the Default Theme', DEFAULT_GRAPHIC_THEME_TOKENS, VOCABULARY.accent.default],
	])('follows %s through the colour its token names', (_case, tokens, expected) => {
		const item = shape('s', {
			themeBindings: { surfaceStyle: 'panel' },
		});

		expect(paintOne(item, tokens).surfaceStyle?.fill).toEqual({ type: 'solid', color: expected });
	});

	it.each<[string, GraphicItemConfig]>([
		[
			'names no Foundation Token',
			text('t', {
				themeBindings: { 'typography.color': 'retired-colour' },
			}),
		],
		[
			'names a token of another type',
			text('t', {
				themeBindings: { 'typography.color': 'body' },
			}),
		],
		[
			'binds a slot its kind lacks',
			shape('s', {
				themeBindings: { typography: 'body' },
			}),
		],
	])('keeps its literal where the binding %s', (_case, item) => {
		const composition = graphic('g', [item]);

		expect(paintBroadcastGraphicThemeBindings(composition, TOKENS)).toBe(composition);
	});

	it('leaves an unbound graphic as the same object', () => {
		const composition = graphic('g', [
			text('t'),
			shape('s'),
		]);

		expect(paintBroadcastGraphicThemeBindings(composition, TOKENS)).toBe(composition);
	});
});

describe('binding and detaching', () => {
	const typed = text('t', {
		typography: {
			...text('t').typography,
			color: '#ff0000',
		},
	});

	it('binds by replacing the literal with the token\'s value', () => {
		const bound = bindGraphicThemeOwner(typed, 'typography.color', 'text-primary', TOKENS);

		expect(bound.themeBindings).toEqual({ 'typography.color': 'text-primary' });
		expect(bound.typography.color).toBe('rgb(1, 2, 3)');
	});

	it('detaches by keeping the resolved value as the literal, with no override record', () => {
		const bound = bindGraphicThemeOwner(typed, 'typography.color', 'text-primary', DEFAULT_GRAPHIC_THEME_TOKENS);
		const detached = detachGraphicThemeOwner(bound, 'typography.color', TOKENS);

		expect(detached).toEqual({
			...typed,
			typography: { ...typed.typography, color: 'rgb(1, 2, 3)' },
		});
		expect(detached).not.toHaveProperty('themeBindings');
	});

	it.each<[string, GraphicThemeOwner, GraphicThemeSlot, string]>([
		[
			'a token of another type',
			typed,
			'typography.color',
			'body',
		],
		[
			'a slot the kind lacks',
			shape('s'),
			'typography',
			'body',
		],
		[
			'an unknown token',
			typed,
			'typography.color',
			'nonsense',
		],
	])('binds nothing for %s', (_case, owner, slot, token) => {
		expect(bindGraphicThemeOwner(owner, slot, token, TOKENS)).toBe(owner);
	});
});

describe('an author\'s edit to a bound property', () => {
	const bound = graphic('g', [
		text('t', {
			themeBindings: { 'typography': 'body', 'typography.color': 'text-primary' },
		}),
	]);
	const painted = paintBroadcastGraphicThemeBindings(bound, TOKENS);

	it.each<[string, Parameters<typeof patchGraphicTypography>[2], Record<string, string>]>([
		[
			'a weight releases its typography, keeping its colour',
			{ fontWeight: 900 },
			{ 'typography.color': 'text-primary' },
		],
		[
			'a colour releases its colour, keeping its typography',
			{ color: '#00ff00' },
			{ typography: 'body' },
		],
		[
			'a size releases nothing a typography token owns',
			{ fontSize: 12 },
			{ 'typography': 'body', 'typography.color': 'text-primary' },
		],
	])('%s', (_case, patch, kept) => {
		const edited = releaseEditedGraphicThemeBindings(painted, patchGraphicTypography(painted, 't', patch));

		expect(only(edited).themeBindings).toEqual(kept);
	});
});

describe('a newly authored Graphic Item', () => {
	it.each([
		[
			'text',
			{ 'typography': 'body', 'typography.color': 'text-primary' },
		],
		[
			'shape',
			{ surfaceStyle: 'panel', geometry: 'panel-shape' },
		],
		[
			'social-network-icon',
			{ color: 'text-primary' },
		],
		['media', undefined],
	] as const)('of kind %s starts bound to %o', (kind, bindings) => {
		const { graphic: added } = addGraphicItem(graphic('g', []), {
			kind,
			id: 'new',
			canvasWidth: 1920,
			canvasHeight: 1080,
		});

		expect(only(added).themeBindings).toEqual(bindings);
	});
});
