import type { FoundationTokenName, FoundationTokenVocabulary, ModeTokenDeclarations, StoredThemeTokens } from '~~/shared/modules/theme';
import type { ScreenMode } from '~~/shared/types/enums';
import { describe, expect, it } from 'vitest';
import { FOUNDATION_TOKENS, resolveFoundationTokens, resolveThemeCompositeColors, resolveThemeTokens } from '~~/shared/modules/theme';
import { SCREEN_MODES, screenModeTokens } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';

// The one home of Theme Token resolution (ADR-0049): a Mode Token reads its override, else its
// default; a Foundation Token the Theme, else its default, over which only a host token reads its override.

const body = {
	font: { kind: 'application', fontId: 'inter' },
	weight: 400,
	lineHeight: 1.2,
	tracking: 0,
	case: 'none',
} as const;

const vocabulary = {
	'accent': { type: 'color', label: 'Accent', default: 'rgb(0, 0, 1)' },
	'text-primary': { type: 'color', label: 'Primary text', default: 'rgb(0, 0, 2)' },
	'inset': {
		type: 'dimension',
		label: 'Inset',
		default: 10,
		bounds: { min: 0, max: 100 },
	},
	'body': { type: 'typography', label: 'Body', default: body },
} satisfies FoundationTokenVocabulary;

const modeTokens = {
	'demo.title': {
		type: 'color',
		label: 'Title',
		default: { token: 'accent' },
	},
	'demo.badge': { type: 'color', label: 'Badge', default: 'rgb(0, 0, 9)' },
	'demo.gap': {
		type: 'dimension',
		label: 'Gap',
		default: { token: 'inset' },
		bounds: { min: 0, max: 40 },
	},
} satisfies ModeTokenDeclarations;

/** What the fixture mode consumes: its Mode Tokens, then the Foundation Tokens their defaults name. */
const DECLARED_CONSUMPTION = [
	'demo.title',
	'demo.badge',
	'demo.gap',
	'accent',
	'inset',
];

function resolve(theme: StoredThemeTokens = {}, overrides: StoredThemeTokens = {}) {
	return resolveThemeTokens({
		vocabulary,
		modeTokens,
		theme,
		overrides,
	});
}

describe('resolveThemeTokens', () => {
	it.each([
		['the default', {}, {}, 'rgb(0, 0, 9)'],
		// A Theme stores Foundation Tokens only; one it stored before is never read.
		[
			'the default, never the Theme\'s value',
			{ 'demo.badge': 'rgb(1, 0, 0)' },
			{},
			'rgb(0, 0, 9)',
		],
		[
			'the override over the default',
			{ 'demo.badge': 'rgb(1, 0, 0)' },
			{ 'demo.badge': 'rgb(2, 0, 0)' },
			'rgb(2, 0, 0)',
		],
	])('reads a Mode Token as %s', (_, theme, overrides, expected) => {
		expect(resolve(theme, overrides).values['demo.badge']).toBe(expected);
	});

	it.each([
		[
			'its Foundation Token\'s default',
			{},
			{},
			'rgb(0, 0, 1)',
		],
		[
			'its Foundation Token\'s Theme value',
			{ accent: 'rgb(3, 0, 0)' },
			{},
			'rgb(3, 0, 0)',
		],
		[
			'its Foundation Token\'s Theme value, never a Screen\'s override of it',
			{ accent: 'rgb(3, 0, 0)' },
			{ accent: 'rgb(4, 0, 0)' },
			'rgb(3, 0, 0)',
		],
		[
			'another Foundation Token the override names',
			{},
			{
				'demo.title': { token: 'text-primary' },
			},
			'rgb(0, 0, 2)',
		],
		[
			'that Foundation Token\'s Theme value',
			{ 'text-primary': 'rgb(5, 0, 0)' },
			{
				'demo.title': { token: 'text-primary' },
			},
			'rgb(5, 0, 0)',
		],
		[
			'the override\'s literal over the Foundation Token',
			{ accent: 'rgb(4, 0, 0)' },
			{ 'demo.title': 'rgb(6, 0, 0)' },
			'rgb(6, 0, 0)',
		],
	// A default names a Foundation Token; so may an override stored before writes were literal-only.
	])('reads a Mode Token naming a Foundation Token as %s', (_, theme, overrides, expected) => {
		expect(resolve(theme, overrides).values['demo.title']).toBe(expected);
	});

	it.each([
		[
			'a former Foundation Token the Theme still stores',
			{ 'retired-glow': 'rgb(7, 0, 0)' },
			{},
		],
		[
			'a Mode Token the Theme stores',
			{
				'demo.title': { token: 'text-primary' },
				'demo.badge': 'rgb(7, 0, 0)',
				'demo.gap': 4,
			},
			{},
		],
		[
			'a Mode Token naming a former Foundation Token',
			{},
			{
				'demo.title': { token: 'retired-glow' },
			},
		],
		[
			'a Mode Token naming a Foundation Token of another type',
			{},
			{
				'demo.title': { token: 'inset' },
			},
		],
		[
			'a Foundation Token naming another',
			{
				accent: { token: 'text-primary' },
			},
			{},
		],
		[
			'a value of the wrong type',
			{ accent: 12 },
			{
				'demo.title': { value: 'rgb(8, 0, 0)' },
			},
		],
		[
			'another mode\'s Mode Token, overridden on this Screen',
			{},
			{ 'other.title': 'rgb(9, 0, 0)' },
		],
		// A Screen takes a Foundation Token from its Theme unless its host consumes the token itself.
		[
			'a Foundation Token overridden on this Screen',
			{},
			{ accent: 'rgb(9, 0, 0)', inset: 30 },
		],
	])('drops %s', (_, theme, overrides) => {
		const resolved = resolve(theme, overrides);

		expect(resolved.values).toEqual(resolve().values);
		expect(resolved.consumed).toEqual(DECLARED_CONSUMPTION);
	});

	it.each([
		[
			'a Foundation Token above its bound',
			{ inset: 240 },
			{},
			'inset',
			100,
		],
		[
			'a Foundation Token below its bound',
			{ inset: -4 },
			{},
			'inset',
			0,
		],
		[
			'a Mode Token above its own bound',
			{},
			{ 'demo.gap': 90 },
			'demo.gap',
			40,
		],
		[
			'a Foundation Token through a Mode Token\'s tighter bound',
			{ inset: 90 },
			{},
			'demo.gap',
			40,
		],
		[
			'a value within its bounds',
			{ inset: 30 },
			{},
			'demo.gap',
			30,
		],
	])('reads %s within it', (_, theme, overrides, token, expected) => {
		expect(resolve(theme, overrides).values[token]).toBe(expected);
	});

	it('reads a stored typography outside its bounds at the nearest bound, field by field', () => {
		const modeTokens = {
			'demo.text': {
				type: 'typography',
				label: 'Text',
				default: { token: 'body' },
			},
		} satisfies ModeTokenDeclarations;
		const theme = {
			body: { ...body, weight: 1000, lineHeight: 0.1 },
		};

		expect(resolveThemeTokens({
			vocabulary,
			modeTokens,
			theme,
			overrides: {},
		}).values['demo.text']).toEqual({
			...body,
			weight: 900,
			lineHeight: 0.5,
		});
	});

	it.each([
		['nothing is stored', {}],
		[
			'a Mode Token is pointed at another Foundation Token',
			{
				'demo.title': { token: 'text-primary' },
			},
		],
		[
			'every Mode Token holds a literal',
			{ 'demo.title': 'rgb(1, 1, 1)', 'demo.badge': 'rgb(2, 2, 2)', 'demo.gap': 4 },
		],
	])('consumes its Mode Tokens and the Foundation Tokens their defaults name when %s', (_, overrides) => {
		const resolved = resolve({}, overrides);

		expect(resolved.consumed).toEqual(DECLARED_CONSUMPTION);
		expect(Object.keys(resolved.values)).toEqual(DECLARED_CONSUMPTION);
	});

	it('also consumes, in vocabulary order and once, each Foundation Token its host consumes itself, reading its override', () => {
		const resolved = resolveThemeTokens({
			vocabulary,
			modeTokens,
			theme: { 'text-primary': 'rgb(3, 3, 3)' },
			overrides: { inset: 20 },
			hostTokens: ['text-primary', 'inset'],
		});

		expect(resolved.consumed).toEqual([
			'demo.title',
			'demo.badge',
			'demo.gap',
			'accent',
			'text-primary',
			'inset',
		]);
		expect(resolved.values).toMatchObject({ 'text-primary': 'rgb(3, 3, 3)', 'inset': 20 });
	});
});

/** A shipped default with each colour a composite names read as that colour's default. */
function withColorDefaults(value: unknown): unknown {
	if (Array.isArray(value))
		return value.map(withColorDefaults);
	if (typeof value !== 'object' || value === null)
		return value;
	if ('token' in value && Object.keys(value).length === 1)
		return FOUNDATION_TOKENS[value.token as FoundationTokenName].default;
	return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
		key,
		withColorDefaults(entry),
	]));
}

describe('a composite Foundation Token naming a colour', () => {
	const composites = {
		...vocabulary,
		panel: {
			type: 'surface-style',
			label: 'Panel',
			default: {
				fill: {
					type: 'linear-gradient',
					angle: 90,
					stops: [
						{
							color: { token: 'accent' },
							position: 0,
							opacity: 1,
						},
						{ color: '#000000', position: 1, opacity: 1 },
					],
				},
				fillOpacity: 1,
				outline: {
					color: { token: 'text-primary' },
					width: 2,
				},
			},
		},
	} satisfies FoundationTokenVocabulary;

	function panel(theme: StoredThemeTokens = {}, overrides: StoredThemeTokens = {}) {
		return resolveFoundationTokens({ vocabulary: composites, theme, overrides }).panel as Record<string, any>;
	}

	it.each([
		[
			'the colour\'s default',
			{},
			{},
			'rgb(0, 0, 1)',
		],
		[
			'the colour\'s Theme value',
			{ accent: 'rgb(3, 0, 0)' },
			{},
			'rgb(3, 0, 0)',
		],
		[
			'the colour\'s Theme value, never a Screen\'s override of it',
			{ accent: 'rgb(3, 0, 0)' },
			{ accent: 'rgb(4, 0, 0)' },
			'rgb(3, 0, 0)',
		],
	])('reads it as %s', (_, theme, overrides, expected) => {
		expect(panel(theme, overrides).fill.stops[0].color).toBe(expected);
		expect(panel(theme, overrides).fill.stops[1].color).toBe('#000000');
	});

	// A surface stored before writes were literal-only reads to its literal, as a default does.
	it('reads a stored surface whose colour names the accent as the accent', () => {
		const theme = {
			accent: 'rgb(3, 0, 0)',
			panel: {
				fill: {
					type: 'solid',
					color: { token: 'accent' },
				},
				fillOpacity: 0.5,
			},
		};

		expect(panel(theme)).toEqual({
			fill: { type: 'solid', color: 'rgb(3, 0, 0)' },
			fillOpacity: 0.5,
		});
	});

	it.each([
		[
			'a colour that is not a colour token',
			{ token: 'inset' },
		],
		[
			'a former colour token',
			{ token: 'retired-glow' },
		],
	])('falls through to the next source when the Theme\'s names %s', (_, color) => {
		const theme = {
			panel: {
				fill: { type: 'solid', color },
				fillOpacity: 1,
			},
		};

		expect(panel(theme)).toEqual(panel());
	});

	// The background stack's colour layers name colour tokens as a fill's colours do (#831).
	it.each([
		['the Theme value', {}, 'rgb(3, 0, 0)'],
		[
			'the Theme value, never a Screen\'s override of the accent or the background',
			{ accent: 'rgb(4, 0, 0)', background: [] },
			'rgb(3, 0, 0)',
		],
	])('reads a background colour layer naming the accent as %s', (_, overrides, expected) => {
		const theme = {
			accent: 'rgb(3, 0, 0)',
			background: [
				{
					id: 'wash',
					type: 'color',
					enabled: true,
					opacity: 0.5,
					color: { token: 'accent' },
				},
			],
		};

		const background = resolveFoundationTokens({ vocabulary: FOUNDATION_TOKENS, theme, overrides }).background;

		expect(background).toEqual([
			{
				id: 'wash',
				type: 'color',
				enabled: true,
				opacity: 0.5,
				color: expected,
			},
		]);
	});
});

describe('the shipped vocabulary and Mode Token declarations', () => {
	const themedModes = SCREEN_MODE_VALUES.filter(mode => SCREEN_MODES[mode].modeTokens);

	it.each(themedModes)('read every %s Mode Token default as declared, within its bounds', (mode) => {
		const modeTokens = screenModeTokens(mode);
		const { values } = resolveThemeTokens({
			vocabulary: FOUNDATION_TOKENS,
			modeTokens,
			theme: {},
			overrides: {},
		});

		for (const [name, { type, default: declared }] of Object.entries(modeTokens)) {
			// A motion that follows a Foundation motion is pinned below, by its shipped value.
			if (typeof declared === 'object' && declared !== null && 'movement' in declared)
				continue;
			// A literal composite's colours read as the colour Foundation Tokens they name.
			const expected = typeof declared === 'object' && declared !== null && 'token' in declared
				? FOUNDATION_TOKENS[declared.token as FoundationTokenName].default
				: resolveThemeCompositeColors(type, declared, color => FOUNDATION_TOKENS[color as FoundationTokenName].default as string);
			expect(values[name], name).toEqual(expected);
		}
	});

	it('reads every Foundation Token default as shipped, within its bounds', () => {
		const modeTokens = Object.fromEntries(Object.entries(FOUNDATION_TOKENS).map(([name, definition]) => [
			`probe.${name}`,
			{
				...definition,
				label: name,
				default: { token: name },
			},
		])) as ModeTokenDeclarations;
		const { values } = resolveThemeTokens({
			vocabulary: FOUNDATION_TOKENS,
			modeTokens,
			theme: {},
			overrides: {},
		});

		for (const [name, definition] of Object.entries(FOUNDATION_TOKENS))
			expect(values[name], name).toEqual(withColorDefaults(definition.default));
	});
});

describe('a motion Mode Token', () => {
	const ROW_MOTION = {
		duration: 400,
		easing: 'ease-out',
		delay: 0,
		fade: { opacity: 0 },
		slide: { direction: 'west', distanceMode: 'fixed', distance: 20 },
	};
	const REVEAL_MOTION = {
		duration: 600,
		easing: 'ease-out',
		delay: 0,
		fade: { opacity: 0 },
		slide: { direction: 'south', distanceMode: 'fixed', distance: 20 },
		scale: { factor: 0.95, origin: 'center' },
	};
	const CARD_MOTION = {
		duration: 200,
		easing: 'ease-in-out',
		delay: 0,
		fade: { opacity: 0 },
		scale: { factor: 0.7, origin: 'center' },
	};
	const THEME_ENTER = {
		duration: 900,
		easing: 'back-out',
		delay: 50,
		scale: { factor: 0.5, origin: 'center' },
	};
	const SCREEN_ENTER = { duration: 250, easing: 'linear', delay: 0 };

	function motion(name: string, theme: StoredThemeTokens = {}, overrides: StoredThemeTokens = {}) {
		return resolveThemeTokens({
			vocabulary: FOUNDATION_TOKENS,
			modeTokens: screenModeTokens(name.split('.')[0] as ScreenMode),
			theme,
			overrides,
		}).values[name];
	}

	it.each([
		['standings.row-motion', ROW_MOTION],
		['metagame.row-motion', ROW_MOTION],
		['standings.reveal-motion', REVEAL_MOTION],
		['card.motion', CARD_MOTION],
	])('reads %s under the Default Theme as it shipped', (name, shipped) => {
		expect(motion(name)).toEqual(shipped);
	});

	// The shared row motion takes the Theme's enter motion's timing and keeps its own movement.
	it.each([
		['standings.row-motion', 'with nothing overridden', {}],
		['metagame.row-motion', 'with nothing overridden', {}],
		['standings.row-motion', 'over a Screen\'s override of the enter motion', { 'motion-enter': SCREEN_ENTER }],
		['metagame.row-motion', 'over a Screen\'s override of the enter motion', { 'motion-enter': SCREEN_ENTER }],
	])('times %s by the Theme\'s enter motion %s', (name, _, overrides) => {
		expect(motion(name, { 'motion-enter': THEME_ENTER }, overrides)).toEqual({
			duration: THEME_ENTER.duration,
			easing: THEME_ENTER.easing,
			delay: THEME_ENTER.delay,
			fade: { opacity: 0 },
			slide: { direction: 'west', distanceMode: 'fixed', distance: 20 },
		});
	});

	it.each(['standings', 'metagame'] as const)('has a %s Screen consume the enter motion its row motion follows', (mode) => {
		const { consumed } = resolveThemeTokens({
			vocabulary: FOUNDATION_TOKENS,
			modeTokens: screenModeTokens(mode),
			theme: {},
			overrides: {},
		});
		expect(consumed).toContain('motion-enter');
	});

	it.each(['standings.row-motion', 'metagame.row-motion'])('reads %s\'s own override over the enter motion', (name) => {
		expect(motion(name, { 'motion-enter': THEME_ENTER }, { [name]: CARD_MOTION })).toEqual(CARD_MOTION);
	});

	// Their timing matches no Foundation motion, so each keeps the literal it shipped with.
	it.each([
		['standings.reveal-motion', REVEAL_MOTION],
		['card.motion', CARD_MOTION],
	])('keeps %s as shipped whatever the Theme\'s motions', (name, shipped) => {
		const theme = { 'motion-enter': THEME_ENTER, 'motion-update': THEME_ENTER, 'motion-exit': THEME_ENTER };
		expect(motion(name, theme)).toEqual(shipped);
	});
});
