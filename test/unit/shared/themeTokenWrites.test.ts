import { describe, expect, it } from 'vitest';
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

const libraryRevision = { assetId: 'asset-brand', revisionId: 'revision-brand' } as const;

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
			'a typography in a library font',
			'heading',
			{
				...typography,
				font: { kind: 'asset', reference: libraryRevision },
			},
		],
		[
			'a library image as the logo',
			'logo',
			{ kind: 'image', ...libraryRevision },
		],
		[
			'a library silent video as the logo',
			'logo',
			{ kind: 'silent-video', ...libraryRevision },
		],
		[
			'no logo',
			'logo',
			null,
		],
		[
			'a background of library image and video layers',
			'background',
			[
				{
					...remoteImageLayer,
					source: { kind: 'asset', ...libraryRevision },
				},
				{
					...remoteVideoLayer,
					id: 'loop',
					source: { kind: 'asset', ...libraryRevision },
				},
			],
		],
		[
			'a fill whose colour follows a colour token',
			'accent-fill',
			{
				type: 'solid',
				color: { token: 'positive' },
			},
		],
		[
			'a gradient at its fewest stops',
			'accent-fill',
			{
				type: 'linear-gradient',
				angle: 0,
				stops: [
					{ color: '#fff', position: 0, opacity: 1 },
					{
						color: { token: 'accent' },
						position: 1,
						opacity: 0.5,
					},
				],
			},
		],
		[
			'a surface with a literal fill and an outline following a colour token',
			'panel',
			{
				fill: { type: 'solid', color: '#123456' },
				fillOpacity: 0.5,
				outline: {
					color: { token: 'divider' },
					width: 2,
				},
			},
		],
		[
			'a background whose colour layer names a colour Foundation Token',
			'background',
			[
				{
					...colorLayer,
					color: { token: 'accent' },
				},
			],
		],
		[
			'a Feature Match Overlay surface whose colours name Foundation Tokens',
			'feature-match-overlay.frame-surface',
			{
				fill: {
					type: 'solid',
					color: { token: 'surface-raised' },
				},
				fillOpacity: 1,
				outline: {
					color: { token: 'accent' },
					width: 3,
				},
				glow: {
					color: { token: 'accent' },
					size: 8,
					opacity: 0.5,
				},
			},
		],
		[
			'a Feature Match Overlay Frame media naming the logo',
			'feature-match-overlay.frame-media',
			{ token: 'logo' },
		],
		[
			'a Shape Geometry',
			'panel-shape',
			{ ...FOUNDATION_TOKENS['panel-shape'].default, leftSlant: -40 },
		],
		[
			'an animation recipe',
			'motion-exit',
			{
				duration: 50,
				easing: 'back-in',
				delay: 0,
				scale: { factor: 0, origin: 'center' },
			},
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
			'a logo naming a font, a kind it does not admit',
			'logo',
			{ kind: 'font', ...libraryRevision },
			'invalid-value',
		],
		[
			'a logo naming no revision',
			'logo',
			{ kind: 'image', assetId: 'asset-brand' },
			'invalid-value',
		],
		[
			'an unimplemented Animation Effect',
			'animation-effect',
			{ effect: 'vanta-birds' },
			'invalid-value',
		],
		[
			'a fill whose colour names a token of another type',
			'accent-fill',
			{
				type: 'solid',
				color: { token: 'heading' },
			},
			'invalid-value',
		],
		[
			'a background whose colour layer names a token of another type',
			'background',
			[
				{
					...colorLayer,
					color: { token: 'heading' },
				},
			],
			'invalid-value',
		],
		[
			'a fill whose colour names no token',
			'accent-fill',
			{
				type: 'solid',
				color: { token: 'nonsense' },
			},
			'invalid-value',
		],
		[
			'a gradient with one stop',
			'accent-fill',
			{
				type: 'linear-gradient',
				angle: 0,
				stops: [
					{ color: '#fff', position: 0, opacity: 1 },
				],
			},
			'invalid-value',
		],
		[
			'an animation recipe shorter than its bound',
			'motion-enter',
			{ duration: 49, easing: 'linear', delay: 0 },
			'invalid-value',
		],
	])('refuses %s', (_case, name, value, refusal) => {
		expect(parseThemeTokenWrite(name, value)).toEqual({ ok: false, refusal });
	});
});
