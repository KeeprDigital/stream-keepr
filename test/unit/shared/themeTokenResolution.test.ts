import type { FoundationTokenName, FoundationTokenVocabulary, ModeTokenDeclarations, StoredThemeTokens } from '~~/shared/modules/theme';
import { describe, expect, it } from 'vitest';
import { FOUNDATION_TOKENS, resolveFoundationTokens, resolveThemeTokens } from '~~/shared/modules/theme';
import { SCREEN_MODES, screenModeTokens } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';

// The one home of Theme Token resolution (ADR-0049): override, else Theme, else default.

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
		[
			'the Theme\'s value over the default',
			{ 'demo.badge': 'rgb(1, 0, 0)' },
			{},
			'rgb(1, 0, 0)',
		],
		[
			'the override over the default',
			{},
			{ 'demo.badge': 'rgb(2, 0, 0)' },
			'rgb(2, 0, 0)',
		],
		[
			'the override over the Theme',
			{ 'demo.badge': 'rgb(1, 0, 0)' },
			{ 'demo.badge': 'rgb(2, 0, 0)' },
			'rgb(2, 0, 0)',
		],
	])('reads %s', (_, theme, overrides, expected) => {
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
			'its Foundation Token\'s override, over the Theme',
			{ accent: 'rgb(3, 0, 0)' },
			{ accent: 'rgb(4, 0, 0)' },
			'rgb(4, 0, 0)',
		],
		[
			'another Foundation Token the Theme names',
			{
				'demo.title': { token: 'text-primary' },
			},
			{},
			'rgb(0, 0, 2)',
		],
		[
			'that Foundation Token\'s override',
			{
				'demo.title': { token: 'text-primary' },
			},
			{ 'text-primary': 'rgb(5, 0, 0)' },
			'rgb(5, 0, 0)',
		],
		[
			'the Theme\'s literal over the Foundation Token',
			{ 'demo.title': 'rgb(6, 0, 0)' },
			{ accent: 'rgb(4, 0, 0)' },
			'rgb(6, 0, 0)',
		],
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
			'a Mode Token naming a former Foundation Token',
			{
				'demo.title': { token: 'retired-glow' },
			},
			{},
		],
		[
			'a Mode Token naming a Foundation Token of another type',
			{
				'demo.title': { token: 'inset' },
			},
			{},
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
			{
				'accent': 12,
				'demo.title': { value: 'rgb(8, 0, 0)' },
			},
			{},
		],
		[
			'another mode\'s Mode Token, overridden on this Screen',
			{},
			{ 'other.title': 'rgb(9, 0, 0)' },
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
			'inset',
			100,
		],
		[
			'a Foundation Token below its bound',
			{ inset: -4 },
			'inset',
			0,
		],
		[
			'a Mode Token above its own bound',
			{ 'demo.gap': 90 },
			'demo.gap',
			40,
		],
		[
			'a Foundation Token through a Mode Token\'s tighter bound',
			{ inset: 90 },
			'demo.gap',
			40,
		],
		[
			'a value within its bounds',
			{ inset: 30 },
			'demo.gap',
			30,
		],
	])('reads %s within it', (_, theme, token, expected) => {
		expect(resolve(theme).values[token]).toBe(expected);
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
	])('consumes its Mode Tokens and the Foundation Tokens their defaults name when %s', (_, theme) => {
		const resolved = resolve(theme);

		expect(resolved.consumed).toEqual(DECLARED_CONSUMPTION);
		expect(Object.keys(resolved.values)).toEqual(DECLARED_CONSUMPTION);
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
			'the colour\'s override, over the Theme',
			{ accent: 'rgb(3, 0, 0)' },
			{ accent: 'rgb(4, 0, 0)' },
			'rgb(4, 0, 0)',
		],
	])('reads it as %s', (_, theme, overrides, expected) => {
		expect(panel(theme, overrides).fill.stops[0].color).toBe(expected);
		expect(panel(theme, overrides).fill.stops[1].color).toBe('#000000');
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

		for (const [name, { default: declared }] of Object.entries(modeTokens)) {
			const expected = typeof declared === 'object' && 'token' in declared
				? FOUNDATION_TOKENS[declared.token as FoundationTokenName].default
				: declared;
			expect(values[name], name).toEqual(expected);
		}
	});

	it('reads every Foundation Token default as shipped, within its bounds', () => {
		const modeTokens = Object.fromEntries(Object.entries(FOUNDATION_TOKENS).map(([name, definition]) => [
			`probe.${name}`,
			{
				type: definition.type,
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
