import type { FeatureMatchOverlayModeConfig, FeatureMatchOverlayPresetId } from './types/screenConfig';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from './types/screenConfig';

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

export interface FeatureMatchOverlayPreset {
	id: FeatureMatchOverlayPresetId;
	label: string;
	description: string;
	aspectRatio: number;
	config: Omit<FeatureMatchOverlayModeConfig, 'featureMatchId'>;
}

const leftStacked = clone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
const fullTable = clone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
const neonFeatureMatch = clone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
fullTable.presetId = 'full-table';
fullTable.layout.items = [
	{ ...fullTable.layout.items.find(item => item.id === 'main-source')!, x: 24, y: 90, width: 1872, height: 900, label: 'Main Match Source' },
	...fullTable.layout.items
		.filter(item => item.type !== 'source')
		.map((item) => {
			if (item.id === 'top-bar')
				return { ...item, x: 24, width: 1872 };
			if (item.id === 'bottom-bar')
				return { ...item, x: 24, width: 1872 };
			if (item.id === 'branding')
				return { ...item, x: 60, y: 1000, width: 500, height: 74 };
			return item;
		}),
];

neonFeatureMatch.presetId = 'neon-feature-match';
neonFeatureMatch.layout.frame = {
	...neonFeatureMatch.layout.frame,
	backgroundColor: '#050008',
	opacity: 1,
	gradient: 'linear-gradient(180deg, rgba(10,0,16,0.2) 0%, rgba(122,0,122,0.28) 48%, rgba(4,0,10,0.5) 100%)',
	mediaBackground: {
		...(neonFeatureMatch.layout.frame.mediaBackground ?? { enabled: false, type: 'video', url: '', fit: 'cover', opacity: 1, playbackRate: 1, loop: true }),
		enabled: true,
		url: '',
		fit: 'cover',
		opacity: 1,
		playbackRate: 1,
		loop: true,
	},
	animation: {
		...neonFeatureMatch.layout.frame.animation!,
		enabled: true,
		effect: 'net',
		opacity: 0.34,
		color: '#d600ff',
		color2: '#6d5cff',
		backgroundColor: '#050008',
		points: 12,
		maxDistance: 34,
		spacing: 18,
		showDots: false,
		showLines: true,
		speed: 0.35,
		mouseDriftEnabled: true,
		mouseDriftMode: 'orbit',
		mouseDriftSeconds: 22,
		mouseDriftRadius: 0.22,
	},
	borderVisible: true,
	borderColor: '#ffffff',
	borderWidth: 3,
	glowColor: '#ffffff',
	glowSize: 10,
	glowOpacity: 0.85,
};
neonFeatureMatch.layout.items = [
	{
		id: 'main-source',
		type: 'source',
		label: 'Main Table Source',
		visible: true,
		sourceRole: 'main',
		frameCutout: true,
		x: 296,
		y: 164,
		width: 1328,
		height: 908,
		surfaceStyle: { backgroundOpacity: 0, borderVisible: true, borderColor: '#ffffff', borderWidth: 4, borderRadius: 0, glowColor: '#ffffff', glowSize: 8, glowOpacity: 0.8 },
	},
	{
		id: 'player1-source',
		type: 'source',
		label: 'Left Player Camera',
		visible: true,
		sourceRole: 'player1',
		frameCutout: true,
		x: 0,
		y: 208,
		width: 296,
		height: 300,
		surfaceStyle: { backgroundOpacity: 0, borderVisible: true, borderColor: '#ffffff', borderWidth: 3, borderLeftVisible: false, borderRadius: 0, glowColor: '#ffffff', glowSize: 7, glowOpacity: 0.75 },
	},
	{
		id: 'player2-source',
		type: 'source',
		label: 'Right Player Camera',
		visible: true,
		sourceRole: 'player2',
		frameCutout: true,
		x: 1624,
		y: 208,
		width: 296,
		height: 300,
		surfaceStyle: { backgroundOpacity: 0, borderVisible: true, borderColor: '#ffffff', borderWidth: 3, borderRightVisible: false, borderRadius: 0, glowColor: '#ffffff', glowSize: 7, glowOpacity: 0.75 },
	},
	{
		id: 'top-player-bar',
		type: 'widget-group',
		label: 'Top Scoreboard Gradient',
		visible: true,
		x: 0,
		y: 28,
		width: 1920,
		height: 116,
		surfaceStyle: {
			backgroundOpacity: 1,
			backgroundGradient: 'linear-gradient(90deg, rgba(184,0,84,0.96) 0%, rgba(74,0,76,0.84) 30%, rgba(7,0,14,0.92) 50%, rgba(72,0,116,0.86) 70%, rgba(127,34,246,0.96) 100%)',
			borderVisible: true,
			borderColor: '#ffffff',
			borderWidth: 3,
			borderLeftVisible: false,
			borderRightVisible: false,
			glowColor: '#ffffff',
			glowSize: 8,
			glowOpacity: 0.85,
		},
		defaultChildSurfaceStyle: {
			textColor: '#ffffff',
			fontSize: 28,
			fontWeight: 800,
			textTransform: 'uppercase',
			overflow: 'clip',
		},
		arrangement: { mode: 'canvas', padding: 0 },
		overflow: 'clip',
		children: [
			{ id: 'p1-wins', label: 'Player 1 Wins', visible: true, widget: { type: 'game-wins', playerSide: 'player1', displayMode: 'boxes', boxOrientation: 'horizontal', boxWidth: 22, boxHeight: 22, boxGap: 4, boxBorderWidth: 3 }, layout: { mode: 'canvas', x: 48, y: 46, width: 36, height: 30 }, surfaceStyle: { backgroundColor: '#ffffff', backgroundOpacity: 0, borderColor: '#ffffff', borderRadius: 0 } },
			{ id: 'p1-life', label: 'Player 1 Life', visible: true, widget: { type: 'player-life', playerSide: 'player1', lifeAnimation: 'glow', lifeAnimationDurationMs: 420, lifeAnimationAccentColor: '#ffffff' }, layout: { mode: 'canvas', x: 88, y: 28, width: 60, height: 60 }, surfaceStyle: { backgroundColor: '#7c0f5b', backgroundOpacity: 0.72, borderVisible: true, borderColor: '#ffffff', borderWidth: 4, borderRadius: 0, textColor: '#ffffff', fontSize: 32, fontWeight: 900, textAlign: 'center', glowColor: '#ffffff', glowSize: 7, glowOpacity: 0.75 } },
			{ id: 'p1-name', label: 'Player 1 Name', visible: true, widget: { type: 'text', playerSide: 'player1', template: '{name}' }, layout: { mode: 'canvas', x: 162, y: 24, width: 590, height: 44 }, surfaceStyle: { fontSize: 34, fontWeight: 900, lineHeight: 1, overflow: 'ellipsis' } },
			{ id: 'p1-record-deck', label: 'Player 1 Record and Deck', visible: true, widget: { type: 'text', playerSide: 'player1', template: '{record}     {deck}' }, layout: { mode: 'canvas', x: 164, y: 68, width: 620, height: 32 }, surfaceStyle: { fontSize: 22, fontWeight: 500, lineHeight: 1, overflow: 'ellipsis' } },
			{ id: 'p2-name', label: 'Player 2 Name', visible: true, widget: { type: 'text', playerSide: 'player2', template: '{name}' }, layout: { mode: 'canvas', x: 1168, y: 24, width: 590, height: 44 }, surfaceStyle: { fontSize: 34, fontWeight: 900, lineHeight: 1, textAlign: 'right', overflow: 'ellipsis' } },
			{ id: 'p2-record-deck', label: 'Player 2 Record and Deck', visible: true, widget: { type: 'text', playerSide: 'player2', template: '{deck}     {record}' }, layout: { mode: 'canvas', x: 1136, y: 68, width: 620, height: 32 }, surfaceStyle: { fontSize: 22, fontWeight: 500, lineHeight: 1, textAlign: 'right', overflow: 'ellipsis' } },
			{ id: 'p2-life', label: 'Player 2 Life', visible: true, widget: { type: 'player-life', playerSide: 'player2', lifeAnimation: 'glow', lifeAnimationDurationMs: 420, lifeAnimationAccentColor: '#ffffff' }, layout: { mode: 'canvas', x: 1772, y: 28, width: 60, height: 60 }, surfaceStyle: { backgroundColor: '#53128c', backgroundOpacity: 0.72, borderVisible: true, borderColor: '#ffffff', borderWidth: 4, borderRadius: 0, textColor: '#ffffff', fontSize: 32, fontWeight: 900, textAlign: 'center', glowColor: '#ffffff', glowSize: 7, glowOpacity: 0.75 } },
			{ id: 'p2-wins', label: 'Player 2 Wins', visible: true, widget: { type: 'game-wins', playerSide: 'player2', displayMode: 'boxes', boxOrientation: 'horizontal', boxWidth: 22, boxHeight: 22, boxGap: 4, boxBorderWidth: 3 }, layout: { mode: 'canvas', x: 1838, y: 46, width: 36, height: 30 }, surfaceStyle: { backgroundColor: '#ffffff', backgroundOpacity: 0, borderColor: '#ffffff', borderRadius: 0 } },
		],
	},
	{
		id: 'round-clock',
		type: 'widget-group',
		label: 'Round and Clock',
		visible: true,
		x: 852,
		y: 28,
		width: 216,
		height: 116,
		surfaceStyle: { backgroundColor: '#050008', backgroundOpacity: 0.72, borderVisible: true, borderColor: '#ffffff', borderWidth: 3, glowColor: '#ffffff', glowSize: 10, glowOpacity: 0.9 },
		defaultChildSurfaceStyle: { textColor: '#ffffff', textAlign: 'center', textTransform: 'uppercase', overflow: 'clip' },
		arrangement: { mode: 'canvas', padding: 0 },
		overflow: 'clip',
		children: [
			{ id: 'round-label', label: 'Round', visible: true, widget: { type: 'text', template: '{round}' }, layout: { mode: 'canvas', x: 12, y: 20, width: 192, height: 34 }, surfaceStyle: { fontSize: 26, fontWeight: 900, textAlign: 'center', lineHeight: 1 } },
			{ id: 'match-clock', label: 'Clock', visible: true, widget: { type: 'clock' }, layout: { mode: 'canvas', x: 12, y: 62, width: 192, height: 38 }, surfaceStyle: { fontSize: 32, fontWeight: 400, textAlign: 'center', lineHeight: 1 } },
		],
	},
	{ id: 'upper-neon-rail', type: 'widget-group', label: 'Upper Neon Rail', visible: true, x: 0, y: 144, width: 1920, height: 64, surfaceStyle: { backgroundOpacity: 0, borderVisible: true, borderColor: '#ffffff', borderWidth: 3, borderTopVisible: false, borderLeftVisible: false, borderRightVisible: false, glowColor: '#ffffff', glowSize: 8, glowOpacity: 0.8 }, defaultChildSurfaceStyle: {}, arrangement: { mode: 'canvas', padding: 0 }, overflow: 'clip', children: [] },
	{ id: 'left-empty-panel', type: 'widget-group', label: 'Left Upper Branding Panel', visible: true, x: 0, y: 508, width: 296, height: 104, surfaceStyle: { backgroundOpacity: 1, backgroundGradient: 'linear-gradient(180deg, rgba(10,0,16,0.76), rgba(78,0,67,0.58))', borderVisible: true, borderColor: '#ffffff', borderWidth: 3, borderLeftVisible: false, borderRightVisible: true, glowColor: '#ffffff', glowSize: 7, glowOpacity: 0.78 }, defaultChildSurfaceStyle: {}, arrangement: { mode: 'canvas', padding: 0 }, overflow: 'clip', children: [] },
	{
		id: 'left-branding',
		type: 'widget-group',
		label: 'Left Branding',
		visible: true,
		x: 0,
		y: 612,
		width: 296,
		height: 252,
		surfaceStyle: { backgroundOpacity: 1, backgroundGradient: 'linear-gradient(180deg, rgba(81,0,73,0.72), rgba(9,0,18,0.82))', borderVisible: true, borderColor: '#ffffff', borderWidth: 3, borderTopVisible: false, borderLeftVisible: false, borderRightVisible: true, glowColor: '#ffffff', glowSize: 7, glowOpacity: 0.78 },
		defaultChildSurfaceStyle: { textColor: '#ffffff', fontSize: 30, fontWeight: 900, textAlign: 'center', textTransform: 'uppercase' },
		arrangement: { mode: 'canvas', padding: 0 },
		overflow: 'clip',
		children: [
			{ id: 'left-branding-image', label: 'Left Branding Image', visible: false, widget: { type: 'image', fit: 'contain', opacity: 1, borderRadius: 0 }, layout: { mode: 'canvas', x: 40, y: 28, width: 216, height: 112 } },
			{ id: 'left-event-name', label: 'Event Name', visible: true, widget: { type: 'text', template: '{eventName}' }, layout: { mode: 'canvas', x: 24, y: 152, width: 248, height: 56 }, surfaceStyle: { fontSize: 28, fontWeight: 900, textAlign: 'center', lineHeight: 1.05, overflow: 'shrink' } },
		],
	},
	{ id: 'left-footer-panel', type: 'widget-group', label: 'Left Footer Panel', visible: true, x: 0, y: 864, width: 296, height: 208, surfaceStyle: { backgroundOpacity: 1, backgroundGradient: 'linear-gradient(180deg, rgba(9,0,18,0.82), rgba(81,0,73,0.62))', borderVisible: true, borderColor: '#ffffff', borderWidth: 3, borderTopVisible: false, borderLeftVisible: false, borderRightVisible: true, glowColor: '#ffffff', glowSize: 7, glowOpacity: 0.78 }, defaultChildSurfaceStyle: {}, arrangement: { mode: 'canvas', padding: 0 }, overflow: 'clip', children: [] },
	{
		id: 'right-branding',
		type: 'widget-group',
		label: 'Right Branding',
		visible: true,
		x: 1624,
		y: 508,
		width: 296,
		height: 356,
		surfaceStyle: { backgroundOpacity: 1, backgroundGradient: 'linear-gradient(180deg, rgba(9,0,18,0.82), rgba(81,0,110,0.72))', borderVisible: true, borderColor: '#ffffff', borderWidth: 3, borderLeftVisible: true, borderRightVisible: false, glowColor: '#ffffff', glowSize: 7, glowOpacity: 0.78 },
		defaultChildSurfaceStyle: { textColor: '#ffffff', fontSize: 30, fontWeight: 900, textAlign: 'center', textTransform: 'uppercase' },
		arrangement: { mode: 'canvas', padding: 0 },
		overflow: 'clip',
		children: [
			{ id: 'right-branding-image', label: 'Right Branding Image', visible: false, widget: { type: 'image', fit: 'contain', opacity: 1, borderRadius: 0 }, layout: { mode: 'canvas', x: 42, y: 52, width: 212, height: 158 } },
			{ id: 'right-event-name', label: 'Event Name', visible: true, widget: { type: 'text', template: '{eventName}' }, layout: { mode: 'canvas', x: 24, y: 232, width: 248, height: 56 }, surfaceStyle: { fontSize: 28, fontWeight: 900, textAlign: 'center', lineHeight: 1.05, overflow: 'shrink' } },
		],
	},
	{ id: 'right-footer-panel', type: 'widget-group', label: 'Right Footer Panel', visible: true, x: 1624, y: 864, width: 296, height: 208, surfaceStyle: { backgroundOpacity: 1, backgroundGradient: 'linear-gradient(180deg, rgba(81,0,110,0.62), rgba(9,0,18,0.86))', borderVisible: true, borderColor: '#ffffff', borderWidth: 3, borderTopVisible: false, borderLeftVisible: true, borderRightVisible: false, glowColor: '#ffffff', glowSize: 7, glowOpacity: 0.78 }, defaultChildSurfaceStyle: {}, arrangement: { mode: 'canvas', padding: 0 }, overflow: 'clip', children: [] },
];

export const FEATURE_MATCH_OVERLAY_PRESETS: FeatureMatchOverlayPreset[] = [
	{
		id: 'full-table',
		label: 'Full Table',
		description: 'A full-width main match source with separated details and branding widgets.',
		aspectRatio: 16 / 9,
		config: (({ featureMatchId: _featureMatchId, ...config }) => config)(fullTable),
	},
	{
		id: 'left-stacked-player-cams',
		label: 'Table with Left Stacked Player Cams',
		description: 'Main table source with two stacked player source items in a left rail.',
		aspectRatio: 16 / 9,
		config: (({ featureMatchId: _featureMatchId, ...config }) => config)(leftStacked),
	},
	{
		id: 'neon-feature-match',
		label: 'Neon Feature Match',
		description: 'A neon broadcast frame with player cameras, a full-width scoreboard, glowing lines, gradient name bars, and looping video background support.',
		aspectRatio: 16 / 9,
		config: (({ featureMatchId: _featureMatchId, ...config }) => config)(neonFeatureMatch),
	},
];

function getFeatureMatchOverlayPreset(id: FeatureMatchOverlayPresetId): FeatureMatchOverlayPreset {
	return FEATURE_MATCH_OVERLAY_PRESETS.find(preset => preset.id === id) ?? FEATURE_MATCH_OVERLAY_PRESETS[0]!;
}

export function applyFeatureMatchOverlayPreset(current: FeatureMatchOverlayModeConfig, presetId: FeatureMatchOverlayPresetId): FeatureMatchOverlayModeConfig {
	const preset = clone(getFeatureMatchOverlayPreset(presetId).config) as Omit<FeatureMatchOverlayModeConfig, 'featureMatchId'>;
	return {
		...preset,
		featureMatchId: current.featureMatchId,
		presetId,
	};
}
