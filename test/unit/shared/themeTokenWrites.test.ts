import { describe, expect, it } from 'vitest';
import { backgroundModeConfigSchema } from '~~/server/schemas/api/screen';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';
import { parseThemeTokenWrite } from '~~/shared/themeTokens';

// A Theme write is strict where a read forgives: a wrong type or an out-of-bounds value is
// refused, never clamped, and a Mode Token may name only a same-type Foundation Token.

const typography = {
	font: { kind: 'application', fontId: 'inter' },
	weight: 700,
	lineHeight: 1.2,
	tracking: 0.02,
	case: 'uppercase',
} as const;

const { max: insetMax } = FOUNDATION_TOKENS.inset.bounds;

const layer = { id: 'layer', enabled: true, opacity: 1 } as const;
const colorLayer = { ...layer, type: 'color', color: '#101010' } as const;
const animationLayer = {
	...layer,
	type: 'animation',
	animation: { effect: 'fog' },
} as const;
const remoteImageLayer = {
	...layer,
	type: 'image',
	fit: 'cover',
	source: { kind: 'url', url: 'https://example.com/plate.png' },
} as const;
const remoteVideoLayer = {
	...layer,
	type: 'video',
	fit: 'contain',
	playbackRate: 1,
	loop: true,
	source: { kind: 'url', url: 'https://example.com/loop.webm' },
} as const;

describe('a Theme Token write', () => {
	it.each([
		['a Foundation colour', 'accent', 'rgba(255, 0, 0, 0.5)'],
		['a Foundation dimension at its lower bound', 'inset', 0],
		['a Foundation dimension at its upper bound', 'inset', insetMax],
		['a Foundation typography', 'heading', typography],
		['a Mode Token literal', 'standings.row-divider', '#ff0000'],
		[
			'a Mode Token naming a same-type Foundation Token',
			'standings.row-divider',
			{ token: 'accent' },
		],
		[
			'a typography Mode Token naming a typography Foundation Token',
			'standings.title-typography',
			{ token: 'body' },
		],
		[
			'a background of colour, gradient, Remote Media URL and animation layers',
			'background',
			[
				colorLayer,
				{ ...layer, type: 'gradient', gradient: 'linear-gradient(#000, #123)' },
				remoteImageLayer,
				remoteVideoLayer,
				animationLayer,
			],
		],
		[
			'an Animation Effect',
			'animation-effect',
			{ effect: 'caustics' },
		],
		[
			'an alignment',
			'alignment',
			{ horizontal: 'left', vertical: 'bottom' },
		],
	])('stores %s', (_case, name, value) => {
		expect(parseThemeTokenWrite(name, value)).toEqual({ ok: true, value });
	});

	it.each([
		[
			'a name no token has',
			'nonsense',
			'#fff',
			'unknown-token',
		],
		[
			'a former or misspelt Mode Token',
			'standings.nonsense',
			'#fff',
			'unknown-token',
		],
		[
			'a colour token given a number',
			'accent',
			12,
			'invalid-value',
		],
		[
			'a dimension below its bound',
			'inset',
			-1,
			'invalid-value',
		],
		[
			'a dimension above its bound',
			'inset',
			insetMax + 1,
			'invalid-value',
		],
		[
			'an alignment off either axis',
			'alignment',
			{ horizontal: 'middle', vertical: 'top' },
			'invalid-value',
		],
		[
			'an alignment missing an axis',
			'alignment',
			{ horizontal: 'left' },
			'invalid-value',
		],
		[
			'a typography with a size',
			'heading',
			{ ...typography, size: 40 },
			'invalid-value',
		],
		[
			'a Foundation Token naming another',
			'accent',
			{ token: 'divider' },
			'invalid-value',
		],
		[
			'a Mode Token naming a Foundation Token of another type',
			'standings.row-divider',
			{ token: 'heading' },
			'invalid-value',
		],
		[
			'a Mode Token naming a Mode Token',
			'standings.row-divider',
			{ token: 'standings.title-divider' },
			'invalid-value',
		],
		[
			'a Mode Token naming no token',
			'standings.row-divider',
			{ token: 'nonsense' },
			'invalid-value',
		],
		[
			'a background layer referencing a library asset, until #828',
			'background',
			[
				{
					...remoteImageLayer,
					source: { kind: 'asset', assetId: 'asset', revisionId: 'revision' },
				},
			],
			'invalid-value',
		],
		[
			'an unimplemented Animation Effect',
			'animation-effect',
			{ effect: 'vanta-birds' },
			'invalid-value',
		],
	])('refuses %s', (_case, name, value, refusal) => {
		expect(parseThemeTokenWrite(name, value)).toEqual({ ok: false, refusal });
	});
});

// A Theme's background paints through the Screen's own stack, so each side of
// every bound the two share gives one answer; only library media differs (#828).
describe('a Theme background beside a Screen\'s own stack', () => {
	const screenAccepts = (layers: unknown) => backgroundModeConfigSchema.safeParse({ layers }).success;
	const themeAccepts = (layers: unknown) => parseThemeTokenWrite('background', layers).ok;
	const colorLayers = (count: number) => Array.from({ length: count }, (_, index) => ({ ...colorLayer, id: `layer-${index}` }));

	it.each([
		['an empty stack', [], true],
		[
			'twenty layers',
			colorLayers(20),
			true,
		],
		[
			'twenty-one layers',
			colorLayers(21),
			false,
		],
		[
			'one animation layer',
			[animationLayer],
			true,
		],
		[
			'two animation layers',
			[
				animationLayer,
				{ ...animationLayer, id: 'second' },
			],
			false,
		],
		[
			'opacity at both bounds',
			[
				{ ...colorLayer, opacity: 0 },
				{ ...colorLayer, id: 'top', opacity: 1 },
			],
			true,
		],
		[
			'opacity above its bound',
			[
				{ ...colorLayer, opacity: 1.01 },
			],
			false,
		],
		[
			'a video at both playback-rate bounds',
			[
				{ ...remoteVideoLayer, playbackRate: 0.25 },
				{ ...remoteVideoLayer, id: 'fast', playbackRate: 4 },
			],
			true,
		],
		[
			'an empty Remote Media URL, meaning unset',
			[
				{
					...remoteImageLayer,
					source: { kind: 'url', url: '' },
				},
			],
			true,
		],
		[
			'a plain-HTTP Remote Media URL',
			[
				{
					...remoteImageLayer,
					source: { kind: 'url', url: 'http://example.com/plate.png' },
				},
			],
			false,
		],
		[
			'an empty colour',
			[
				{ ...colorLayer, color: '' },
			],
			false,
		],
		[
			'an unimplemented effect',
			[
				{
					...animationLayer,
					animation: { effect: 'vanta-birds' },
				},
			],
			false,
		],
	])('answers the same for %s', (_case, stack, accepted) => {
		expect([
			themeAccepts(stack),
			screenAccepts(stack),
		]).toEqual([accepted, accepted]);
	});
});
