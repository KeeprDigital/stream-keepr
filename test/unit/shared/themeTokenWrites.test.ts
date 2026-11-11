import { describe, expect, it } from 'vitest';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';
import { parseThemeTokenValue, parseThemeTokenWrite } from '~~/shared/themeTokens';

// A stored value is checked strictly where a read forgives: a wrong type or an out-of-bounds
// value is refused, never clamped, and a value that names another token is refused whole.

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

describe('a Theme Token value', () => {
	it.each([
		['a Foundation colour', 'accent', 'rgba(255, 0, 0, 0.5)'],
		['a Foundation dimension at its lower bound', 'inset', 0],
		['a Foundation dimension at its upper bound', 'inset', insetMax],
		['a Foundation typography', 'heading', typography],
		['a Mode Token literal', 'standings.rise', '#ff0000'],
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
			'a gradient at its fewest stops',
			'accent-fill',
			{
				type: 'linear-gradient',
				angle: 0,
				stops: [
					{ color: '#fff', position: 0, opacity: 1 },
					{ color: '#123456', position: 1, opacity: 0.5 },
				],
			},
		],
		[
			'a surface with a fill and an outline',
			'panel',
			{
				fill: { type: 'solid', color: '#123456' },
				fillOpacity: 0.5,
				outline: { color: '#abcdef', width: 2 },
			},
		],
		[
			'a Feature Match Overlay surface with an outline and a glow',
			'feature-match-overlay.frame-surface',
			{
				fill: { type: 'solid', color: '#202020' },
				fillOpacity: 1,
				outline: { color: '#ff0000', width: 3 },
				glow: { color: '#ff0000', size: 8, opacity: 0.5 },
			},
		],
		[
			'a Feature Match Overlay Frame media',
			'feature-match-overlay.frame-media',
			{ kind: 'image', ...libraryRevision },
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
		[
			'an alignment',
			'alignment',
			{ horizontal: 'left', vertical: 'bottom' },
		],
	])('admits %s', (_case, name, value) => {
		expect(parseThemeTokenValue(name, value)).toEqual({ ok: true, value });
	});

	it.each([
		[
			'a name no token has',
			'nonsense',
			'#fff',
			'unknown-token',
		],
		[
			'a misspelt Mode Token',
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
			'a Mode Token naming a Foundation Token of its type',
			'standings.rise',
			{ token: 'accent' },
			'invalid-value',
		],
		[
			'an asset Mode Token naming the logo',
			'feature-match-overlay.frame-media',
			{ token: 'logo' },
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
			'a fill whose colour names a colour Foundation Token',
			'accent-fill',
			{
				type: 'solid',
				color: { token: 'positive' },
			},
			'invalid-value',
		],
		[
			'a gradient whose stop names a colour Foundation Token',
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
			'invalid-value',
		],
		[
			'a surface whose outline names a colour Foundation Token',
			'panel',
			{
				fill: { type: 'solid', color: '#123456' },
				fillOpacity: 0.5,
				outline: {
					color: { token: 'divider' },
					width: 2,
				},
			},
			'invalid-value',
		],
		[
			'a Mode Token surface whose glow names a colour Foundation Token',
			'feature-match-overlay.frame-surface',
			{
				fill: { type: 'solid', color: '#202020' },
				fillOpacity: 1,
				glow: {
					color: { token: 'accent' },
					size: 8,
					opacity: 0.5,
				},
			},
			'invalid-value',
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
		expect(parseThemeTokenValue(name, value)).toEqual({ ok: false, refusal });
	});
});

describe('a Theme Token write', () => {
	it('stores a Foundation Token\'s value', () => {
		expect(parseThemeTokenWrite('accent', '#ff0000')).toEqual({ ok: true, value: '#ff0000' });
	});

	it('refuses a Foundation Token\'s invalid value', () => {
		expect(parseThemeTokenWrite('accent', 12)).toEqual({ ok: false, refusal: 'invalid-value' });
	});

	// A Theme stores Foundation Tokens only: a Mode Token is set per Screen.
	it.each([
		['a value it may hold', 'standings.rise', '#ff0000'],
		['a value it could never hold', 'standings.rise', 12],
		[
			'an asset',
			'feature-match-overlay.frame-media',
			{ kind: 'image', assetId: 'asset-brand', revisionId: 'revision-brand' },
		],
	])('accepts a Mode Token given %s, and drops it', (_case, name, value) => {
		expect(parseThemeTokenWrite(name, value)).toEqual({ ok: true, dropped: true });
	});

	it('refuses a name no token has', () => {
		expect(parseThemeTokenWrite('standings.nonsense', '#fff')).toEqual({ ok: false, refusal: 'unknown-token' });
	});

	// A former token is one its mode declared once: accepted whatever it holds, and never stored.
	it.each([
		['a value it once held', 'metagame.chart-series-1', '#ff0000'],
		[
			'a reference it once held',
			'metagame.chart-other',
			{ token: 'accent' },
		],
		['a value it could never hold', 'metagame.chart-series-8', 12],
	])('accepts a former token given %s, and drops it', (_case, name, value) => {
		expect(parseThemeTokenWrite(name, value)).toEqual({ ok: true, dropped: true });
	});

	// A table's max width is its mode's config (#1081).
	it.each(['standings.max-width', 'metagame.max-width'])('accepts %s, once a Mode Token, and drops it', (name) => {
		expect(parseThemeTokenWrite(name, 1200)).toEqual({ ok: true, dropped: true });
	});

	// The table modes' type and shared chrome read Foundation Tokens (#1077).
	const SHARED_CHROME = [
		'surface',
		'title-typography',
		'title-text',
		'title-divider',
		'row-typography',
		'row-divider',
		'primary-text',
		'secondary-text',
	];
	it.each([
		['standings', SHARED_CHROME],
		[
			'metagame',
			[
				...SHARED_CHROME,
				'header-typography',
				'header-text',
				'header-divider',
				'chart-baseline',
			],
		],
		[
			'pairings',
			[...SHARED_CHROME, 'result-typography'],
		],
		[
			'player-history',
			[...SHARED_CHROME, 'outcome-typography'],
		],
		[
			'head-to-head',
			[...SHARED_CHROME, 'name-typography', 'label-typography'],
		],
		[
			'round-clock',
			[
				'surface',
				'round-name-typography',
				'round-name-text',
				'clock-typography',
			],
		],
		// The card modes' too, with their placeholder surface and badge shadow (#1078).
		[
			'deck',
			[
				'title-typography',
				'body-typography',
				'primary-text',
				'secondary-text',
				'card-placeholder',
				'badge-shadow',
			],
		],
		[
			'top-cards',
			[
				'title-typography',
				'title-text',
				'name-typography',
				'name-text',
				'card-placeholder-surface',
				'badge-typography',
				'badge-shadow',
				'page-indicator-text',
			],
		],
		[
			'archetype-spotlight',
			[
				...SHARED_CHROME,
				'headline-typography',
				'label-typography',
				'card-placeholder-surface',
				'badge-shadow',
			],
		],
		// Top Cut Bracket's, with a settled Bracket Position's border and the rule between its entrants (#1079).
		[
			'top-cut',
			[
				'title-typography',
				'title-text',
				'title-divider',
				'round-name-typography',
				'round-name-text',
				'entrant-typography',
				'primary-text',
				'secondary-text',
				'position-border',
				'entrant-divider',
				'champion-typography',
			],
		],
		[
			'talent',
			[
				'title-typography',
				'title-text',
				'title-divider',
				'surface',
				'accent',
				'name-typography',
				'name-text',
				'detail-typography',
				'role-text',
				'profile-text',
			],
		],
	])('accepts each typography and shared chrome token %s once declared, and drops it', (mode, tokens) => {
		expect(tokens.map(token => parseThemeTokenWrite(`${mode}.${token}`, '#ff0000'))).toEqual(tokens.map(() => ({ ok: true, dropped: true })));
	});
});
