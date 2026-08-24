import type { FeatureMatchLayoutEdge } from './featureMatchLayoutItems';
import type { PlayerSide } from './types/enums';
import type { GraphicItemConfig, GraphicSurfaceStyle, GraphicTypography } from './types/graphics';
import type {
	FeatureMatchOverlayModeConfig,
	FeatureMatchOverlayPresetId,
	FeatureMatchSourceFramingStyle,
	FeatureMatchSourceItemConfig,
} from './types/screenConfig';
import { FEATURE_MATCH_LAYOUT_COMPOSITION_ID, FEATURE_MATCH_LAYOUT_COMPOSITION_NAME } from './featureMatchLayoutComposition';
import {
	clockItem,
	edgeRuleItem,
	fillStop,
	gameWinsItem,
	gradientFill,
	groupItem,
	mediaItem,
	playerLifeItem,
	shapeItem,
	solidFill,
	surfaceStyle,
	textItem,
	typography,
} from './featureMatchLayoutItems';
import { roundedShapeGeometry } from './modules/graphics/shapeGeometry';
import { DEFAULT_FRAME_ANIMATION, DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG } from './screenGraphicsDefaults';

/**
 * The built-in Feature Match Overlay Presets, recreated on the Shared Graphics
 * Foundation.
 *
 * A preset initialises a whole Feature Match Layout: the host-owned Frame and
 * Source Items, and the shared Graphic Item tree. Nothing is carried over from a
 * legacy widget list, because there is none — the database is wiped before ship
 * and `docs/feature-match-overlay-capability-parity.md` replaces migration.
 *
 * These three are that checklist's evidence, and `left-stacked-player-cams` is
 * also the default Feature Match Overlay configuration. Between them they
 * exercise host tokens in Graphic Text Templates, the context-gated Clock, Player
 * Life and Game Wins Definitions, Media Graphic Items, canvas Graphic Groups,
 * Graphic Layer Order as list order, per-corner Shape Geometry, gradient and solid
 * Graphic Fills with outline and glow, Text Overflow Policies, and — for the
 * per-side borders the shared Graphic Surface Style deliberately dropped —
 * composed rule-preset Shape Graphic Items.
 */

export interface FeatureMatchOverlayPreset {
	id: FeatureMatchOverlayPresetId;
	label: string;
	description: string;
	aspectRatio: number;
	config: Omit<FeatureMatchOverlayModeConfig, 'featureMatchId'>;
}

/* ────────────────────────────────────────────────
 * Table with Left Stacked Player Cams
 * ──────────────────────────────────────────────── */

/** The teal framing every Source Item of the default preset is cut into. */
function tealSourceFraming(): FeatureMatchSourceFramingStyle {
	return {
		backgroundColor: '#000000',
		backgroundOpacity: 0,
		borderVisible: true,
		borderColor: '#0077a3',
		borderWidth: 4,
		borderRadius: 8,
	};
}

/** A Player Bar's own text: white, heavy, and clipped to the bar with an ellipsis. */
function playerBarTypography(overrides: Partial<GraphicTypography> = {}): GraphicTypography {
	return typography({ fontSize: 30, fontWeight: 800, ...overrides });
}

/**
 * A rounded pill behind a Player Life total.
 *
 * Two Graphic Items rather than one, because a Graphic Surface Style carries no
 * Shape Geometry: corners belong to a Shape Graphic Item, so a rounded bed is
 * composed behind the Item that reads the life total. This is the same
 * composition the dropped per-side borders use, applied to corners.
 */
function playerLifePill(side: PlayerSide, prefix: string, rect: { x: number; y: number; width: number; height: number }) {
	return [
		shapeItem({
			id: `${prefix}-life-bed`,
			label: 'Life Total Bed',
			...rect,
			geometry: roundedShapeGeometry(8),
			surfaceStyle: surfaceStyle(solidFill('#333333'), { outline: { color: '#0077a3', width: 4 } }),
		}),
		playerLifeItem({
			id: `${prefix}-life`,
			label: 'Life Total',
			...rect,
			playerSide: side,
			typography: typography({ fontSize: 42, fontWeight: 800, textAlign: 'center' }),
		}),
	];
}

function leftStackedPlayerCamsConfig(): Omit<FeatureMatchOverlayModeConfig, 'featureMatchId'> {
	return {
		presetId: 'left-stacked-player-cams',
		layout: {
			frame: {
				backgroundColor: '#111111',
				opacity: 0.92,
				backgroundImageFit: 'cover',
				mediaBackground: { ...DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG },
				animation: { ...DEFAULT_FRAME_ANIMATION },
				borderVisible: true,
				borderColor: '#0077a3',
				borderWidth: 4,
			},
			sources: [
				{ id: 'main-source', label: 'Main Match Source', visible: true, sourceRole: 'main', frameCutout: true, x: 400, y: 90, width: 1500, height: 900, framingStyle: tealSourceFraming() },
				{ id: 'player1-source', label: 'Player 1 Source', visible: true, sourceRole: 'player1', frameCutout: true, x: 24, y: 16, width: 340, height: 250, framingStyle: tealSourceFraming() },
				{ id: 'player2-source', label: 'Player 2 Source', visible: true, sourceRole: 'player2', frameCutout: true, x: 24, y: 800, width: 340, height: 250, framingStyle: tealSourceFraming() },
			],
			composition: {
				id: FEATURE_MATCH_LAYOUT_COMPOSITION_ID,
				name: FEATURE_MATCH_LAYOUT_COMPOSITION_NAME,
				items: [
					groupItem({
						id: 'top-bar',
						label: 'Top Player Bar',
						x: 400,
						y: 8,
						width: 1500,
						height: 74,
						children: [
							textItem({ id: 'top-name-record', label: 'Name and Record', x: 0, y: 0, width: 300, height: 74, text: '{player1Name}\n{player1Record}', typography: playerBarTypography() }),
							...playerLifePill('player1', 'top', { x: 700, y: 4, width: 96, height: 66 }),
							textItem({ id: 'top-deck', label: 'Deck', x: 820, y: 0, width: 500, height: 74, text: '{player1DeckColors} {player1Deck}', typography: playerBarTypography() }),
							clockItem({ id: 'top-clock', label: 'Clock', x: 1360, y: 0, width: 140, height: 74, typography: playerBarTypography({ fontSize: 28, fontWeight: 500, textAlign: 'right' }) }),
						],
					}),
					groupItem({
						id: 'bottom-bar',
						label: 'Bottom Player Bar',
						x: 400,
						y: 1000,
						width: 1500,
						height: 74,
						children: [
							textItem({ id: 'bottom-name-record', label: 'Name and Record', x: 0, y: 0, width: 300, height: 74, text: '{player2Name}\n{player2Record}', typography: playerBarTypography() }),
							...playerLifePill('player2', 'bottom', { x: 700, y: 4, width: 96, height: 66 }),
							textItem({ id: 'bottom-deck', label: 'Deck', x: 820, y: 0, width: 500, height: 74, text: '{player2DeckColors} {player2Deck}', typography: playerBarTypography() }),
							textItem({ id: 'bottom-details', label: 'Match Details', x: 1320, y: 0, width: 180, height: 74, text: '{stage}\n{format}', typography: playerBarTypography({ fontSize: 28, fontWeight: 700, textAlign: 'right' }) }),
						],
					}),
					gameWinsItem({ id: 'player1-game-wins', label: 'Player 1 Game Wins', x: 24, y: 278, width: 340, height: 28, playerSide: 'player1', boxWidth: 22, boxHeight: 22, boxGap: 6, boxRadius: 11, outlineWidth: 2, outlineColor: '#ffffff', wonColor: '#22c55e' }),
					gameWinsItem({ id: 'player2-game-wins', label: 'Player 2 Game Wins', x: 24, y: 760, width: 340, height: 28, playerSide: 'player2', boxWidth: 22, boxHeight: 22, boxGap: 6, boxRadius: 11, outlineWidth: 2, outlineColor: '#ffffff', wonColor: '#22c55e' }),
					groupItem({
						id: 'branding',
						label: 'Event Branding',
						x: 60,
						y: 360,
						width: 280,
						height: 280,
						children: [
							textItem({ id: 'branding-text', label: 'Event Name', x: 0, y: 0, width: 280, height: 80, text: '{eventName}', typography: typography({ fontSize: 24, fontWeight: 700, textAlign: 'center' }) }),
							mediaItem({ id: 'branding-image-1', label: 'Image 1', x: 0, y: 96, width: 132, height: 132 }),
							mediaItem({ id: 'branding-image-2', label: 'Image 2', x: 148, y: 96, width: 132, height: 132 }),
						],
					}),
				],
			},
		},
	};
}

/**
 * The default Feature Match Overlay configuration, which is the
 * `left-stacked-player-cams` preset with no Feature Match Slot selected.
 */
export const DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG: FeatureMatchOverlayModeConfig = {
	featureMatchId: null,
	...leftStackedPlayerCamsConfig(),
};

/* ────────────────────────────────────────────────
 * Full Table
 * ──────────────────────────────────────────────── */

function fullTableConfig(): Omit<FeatureMatchOverlayModeConfig, 'featureMatchId'> {
	const base = leftStackedPlayerCamsConfig();
	const sources: FeatureMatchSourceItemConfig[] = base.layout.sources
		.filter(source => source.id === 'main-source')
		.map(source => ({ ...source, label: 'Main Match Source', x: 24, y: 90, width: 1872, height: 900 }));
	// The stacked player cameras are gone, so the Player Bars stretch the full
	// width and the branding block moves down beside them. Everything else,
	// including the Game Wins indicators, keeps its place.
	const items = base.layout.composition.items.map((item): GraphicItemConfig => {
		if (item.id === 'top-bar' || item.id === 'bottom-bar')
			return { ...item, x: 24, width: 1872 };
		if (item.id === 'branding')
			return { ...item, x: 60, y: 1000, width: 500, height: 74 };
		return item;
	});

	return {
		presetId: 'full-table',
		layout: { ...base.layout, sources, composition: { ...base.layout.composition, items } },
	};
}

/* ────────────────────────────────────────────────
 * Neon Feature Match
 * ──────────────────────────────────────────────── */

const NEON_LINE = '#ffffff';
const NEON_LINE_WIDTH = 3;

function neonGlow(size: number, opacity: number) {
	return { color: NEON_LINE, size, opacity };
}

/** The lit white line every neon panel is edged with. */
function neonRuleStyle(glow = neonGlow(8, 0.8)): GraphicSurfaceStyle {
	return surfaceStyle(solidFill(NEON_LINE), { glow });
}

function neonSourceFraming(overrides: Partial<FeatureMatchSourceFramingStyle> = {}): FeatureMatchSourceFramingStyle {
	return {
		backgroundOpacity: 0,
		borderVisible: true,
		borderColor: NEON_LINE,
		borderWidth: NEON_LINE_WIDTH,
		borderRadius: 0,
		glowColor: NEON_LINE,
		glowSize: 7,
		glowOpacity: 0.75,
		...overrides,
	};
}

/**
 * A neon panel: a bed, plus one Shape Graphic Item per lit edge.
 *
 * The legacy preset asked for a border on some sides and not others. A Graphic
 * Surface Style has one uniform outline, so each lit edge becomes its own thin
 * Shape Graphic Item from the rule preset — the settled replacement for per-side
 * border flags, and the composition this preset exists to demonstrate.
 *
 * The glow follows the border. Legacy glow was emitted only for the sides that
 * actually had a border, so a partially bordered panel was lit on those edges
 * alone; the shared glow is a drop-shadow over the whole painted alpha and would
 * light the unlit edges too. So `litGlow` puts the panel's glow on its edge
 * rules, and the bed carries a glow only when every side was bordered — which is
 * exactly the case a uniform outline states directly and `litEdges` is empty.
 */
function neonPanel(
	panel: {
		id: string;
		label: string;
		x: number;
		y: number;
		width: number;
		height: number;
		surfaceStyle: GraphicSurfaceStyle;
		litEdges: FeatureMatchLayoutEdge[];
		litGlow?: ReturnType<typeof neonGlow>;
		children?: Parameters<typeof groupItem>[0]['children'];
	},
) {
	const bounds = { x: 0, y: 0, width: panel.width, height: panel.height };
	return groupItem({
		id: panel.id,
		label: panel.label,
		x: panel.x,
		y: panel.y,
		width: panel.width,
		height: panel.height,
		surfaceStyle: panel.surfaceStyle,
		children: [
			...(panel.children ?? []),
			...panel.litEdges.map(edge => edgeRuleItem({
				id: `${panel.id}-${edge}-rule`,
				label: `${panel.label} ${edge} rule`,
				edge,
				bounds,
				thickness: NEON_LINE_WIDTH,
				surfaceStyle: neonRuleStyle(panel.litGlow),
			})),
		],
	});
}

function neonBrandingTypography(): GraphicTypography {
	return typography({ fontSize: 28, fontWeight: 900, textAlign: 'center', lineHeight: 1.05, textTransform: 'uppercase' });
}

function neonPlayerBarChildren() {
	const nameTypography = (textAlign: 'left' | 'right') => typography({ fontSize: 34, fontWeight: 900, lineHeight: 1, textAlign, textTransform: 'uppercase' });
	const detailTypography = (textAlign: 'left' | 'right') => typography({ fontSize: 22, fontWeight: 500, lineHeight: 1, textAlign, textTransform: 'uppercase' });
	const lifeTypography = typography({ fontSize: 32, fontWeight: 900, textAlign: 'center' });

	return [
		gameWinsItem({ id: 'p1-wins', label: 'Player 1 Wins', x: 48, y: 46, width: 36, height: 30, playerSide: 'player1', boxWidth: 22, boxHeight: 22, boxGap: 4, outlineWidth: 3, outlineColor: NEON_LINE, wonColor: NEON_LINE }),
		playerLifeItem({
			id: 'p1-life',
			label: 'Player 1 Life',
			x: 88,
			y: 28,
			width: 60,
			height: 60,
			playerSide: 'player1',
			typography: lifeTypography,
			surfaceStyle: surfaceStyle(solidFill('#7c0f5b'), { fillOpacity: 0.72, outline: { color: NEON_LINE, width: 4 }, glow: neonGlow(7, 0.75) }),
		}),
		textItem({ id: 'p1-name', label: 'Player 1 Name', x: 162, y: 24, width: 590, height: 44, text: '{player1Name}', typography: nameTypography('left') }),
		textItem({ id: 'p1-record-deck', label: 'Player 1 Record and Deck', x: 164, y: 68, width: 620, height: 32, text: '{player1Record}     {player1Deck}', typography: detailTypography('left') }),
		textItem({ id: 'p2-name', label: 'Player 2 Name', x: 1168, y: 24, width: 590, height: 44, text: '{player2Name}', typography: nameTypography('right') }),
		textItem({ id: 'p2-record-deck', label: 'Player 2 Record and Deck', x: 1136, y: 68, width: 620, height: 32, text: '{player2Deck}     {player2Record}', typography: detailTypography('right') }),
		playerLifeItem({
			id: 'p2-life',
			label: 'Player 2 Life',
			x: 1772,
			y: 28,
			width: 60,
			height: 60,
			playerSide: 'player2',
			typography: lifeTypography,
			surfaceStyle: surfaceStyle(solidFill('#53128c'), { fillOpacity: 0.72, outline: { color: NEON_LINE, width: 4 }, glow: neonGlow(7, 0.75) }),
		}),
		gameWinsItem({ id: 'p2-wins', label: 'Player 2 Wins', x: 1838, y: 46, width: 36, height: 30, playerSide: 'player2', boxWidth: 22, boxHeight: 22, boxGap: 4, outlineWidth: 3, outlineColor: NEON_LINE, wonColor: NEON_LINE }),
	];
}

function neonFeatureMatchConfig(): Omit<FeatureMatchOverlayModeConfig, 'featureMatchId'> {
	return {
		presetId: 'neon-feature-match',
		layout: {
			frame: {
				backgroundColor: '#050008',
				opacity: 1,
				backgroundImageFit: 'cover',
				gradient: 'linear-gradient(180deg, rgba(10,0,16,0.2) 0%, rgba(122,0,122,0.28) 48%, rgba(4,0,10,0.5) 100%)',
				mediaBackground: { ...DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG, enabled: true },
				// The net port landing (#473) ends the caustics stand-in: this is the
				// pre-rebuild preset's own net configuration, in per-effect params form.
				animation: {
					enabled: true,
					effect: 'net',
					opacity: 0.34,
					params: {
						color: '#d600ff',
						backgroundColor: '#050008',
						points: 12,
						maxDistance: 34,
						spacing: 18,
						showDots: false,
					},
				},
				borderVisible: true,
				borderColor: NEON_LINE,
				borderWidth: NEON_LINE_WIDTH,
				glowColor: NEON_LINE,
				glowSize: 10,
				glowOpacity: 0.85,
			},
			sources: [
				{ id: 'main-source', label: 'Main Table Source', visible: true, sourceRole: 'main', frameCutout: true, x: 296, y: 164, width: 1328, height: 908, framingStyle: neonSourceFraming({ borderWidth: 4, glowSize: 8, glowOpacity: 0.8 }) },
				{ id: 'player1-source', label: 'Left Player Camera', visible: true, sourceRole: 'player1', frameCutout: true, x: 0, y: 208, width: 296, height: 300, framingStyle: neonSourceFraming({ borderLeftVisible: false }) },
				{ id: 'player2-source', label: 'Right Player Camera', visible: true, sourceRole: 'player2', frameCutout: true, x: 1624, y: 208, width: 296, height: 300, framingStyle: neonSourceFraming({ borderRightVisible: false }) },
			],
			composition: {
				id: FEATURE_MATCH_LAYOUT_COMPOSITION_ID,
				name: FEATURE_MATCH_LAYOUT_COMPOSITION_NAME,
				items: [
					// One lit line under the upper rail. The legacy preset drew it as the
					// bottom border of an otherwise invisible Graphic Group; here it is
					// simply the Shape Graphic Item it always was.
					edgeRuleItem({
						id: 'upper-neon-rail',
						label: 'Upper Neon Rail',
						edge: 'bottom',
						bounds: { x: 0, y: 144, width: 1920, height: 64 },
						thickness: NEON_LINE_WIDTH,
						surfaceStyle: neonRuleStyle(),
					}),
					neonPanel({
						id: 'left-empty-panel',
						label: 'Left Upper Branding Panel',
						x: 0,
						y: 508,
						width: 296,
						height: 104,
						surfaceStyle: surfaceStyle(gradientFill(180, [fillStop('#0a0010', 0, 0.76), fillStop('#4e0043', 1, 0.58)])),
						litEdges: ['top', 'right', 'bottom'],
						litGlow: neonGlow(7, 0.78),
					}),
					neonPanel({
						id: 'left-branding',
						label: 'Left Branding',
						x: 0,
						y: 612,
						width: 296,
						height: 252,
						surfaceStyle: surfaceStyle(gradientFill(180, [fillStop('#510049', 0, 0.72), fillStop('#090012', 1, 0.82)])),
						litEdges: ['right', 'bottom'],
						litGlow: neonGlow(7, 0.78),
						children: [
							mediaItem({ id: 'left-branding-image', label: 'Left Branding Image', x: 40, y: 28, width: 216, height: 112, visible: false }),
							textItem({ id: 'left-event-name', label: 'Event Name', x: 24, y: 152, width: 248, height: 56, text: '{eventName}', typography: neonBrandingTypography(), overflowPolicy: 'shrink', minFontSize: 18 }),
						],
					}),
					neonPanel({
						id: 'left-footer-panel',
						label: 'Left Footer Panel',
						x: 0,
						y: 864,
						width: 296,
						height: 208,
						surfaceStyle: surfaceStyle(gradientFill(180, [fillStop('#090012', 0, 0.82), fillStop('#510049', 1, 0.62)])),
						litEdges: ['right', 'bottom'],
						litGlow: neonGlow(7, 0.78),
					}),
					neonPanel({
						id: 'right-branding',
						label: 'Right Branding',
						x: 1624,
						y: 508,
						width: 296,
						height: 356,
						surfaceStyle: surfaceStyle(gradientFill(180, [fillStop('#090012', 0, 0.82), fillStop('#51006e', 1, 0.72)])),
						litEdges: ['top', 'left', 'bottom'],
						litGlow: neonGlow(7, 0.78),
						children: [
							mediaItem({ id: 'right-branding-image', label: 'Right Branding Image', x: 42, y: 52, width: 212, height: 158, visible: false }),
							textItem({ id: 'right-event-name', label: 'Event Name', x: 24, y: 232, width: 248, height: 56, text: '{eventName}', typography: neonBrandingTypography(), overflowPolicy: 'shrink', minFontSize: 18 }),
						],
					}),
					neonPanel({
						id: 'right-footer-panel',
						label: 'Right Footer Panel',
						x: 1624,
						y: 864,
						width: 296,
						height: 208,
						surfaceStyle: surfaceStyle(gradientFill(180, [fillStop('#51006e', 0, 0.62), fillStop('#090012', 1, 0.86)])),
						litEdges: ['left', 'bottom'],
						litGlow: neonGlow(7, 0.78),
					}),
					neonPanel({
						id: 'top-player-bar',
						label: 'Top Scoreboard Gradient',
						x: 0,
						y: 28,
						width: 1920,
						height: 116,
						// The legacy gradient carried five CSS colour stops. A Graphic Fill
						// takes two to four, which is the settled bound of the shared
						// vocabulary, so the recreation keeps the four that carry the look.
						surfaceStyle: surfaceStyle(gradientFill(90, [
							fillStop('#b80054', 0, 0.96),
							fillStop('#07000e', 0.5, 0.92),
							fillStop('#480074', 0.7, 0.86),
							fillStop('#7f22f6', 1, 0.96),
						])),
						litEdges: ['top', 'bottom'],
						litGlow: neonGlow(8, 0.85),
						children: neonPlayerBarChildren(),
					}),
					neonPanel({
						id: 'round-clock',
						label: 'Round and Clock',
						x: 852,
						y: 28,
						width: 216,
						height: 116,
						// Bordered on all four sides, so one uniform outline says it — and
						// the only panel whose legacy glow lit the whole silhouette, so it
						// is the only one that keeps a glow on the bed.
						surfaceStyle: surfaceStyle(solidFill('#050008'), { fillOpacity: 0.72, outline: { color: NEON_LINE, width: NEON_LINE_WIDTH }, glow: neonGlow(10, 0.9) }),
						litEdges: [],
						children: [
							textItem({ id: 'round-label', label: 'Round', x: 12, y: 20, width: 192, height: 34, text: '{round}', typography: typography({ fontSize: 26, fontWeight: 900, textAlign: 'center', lineHeight: 1, textTransform: 'uppercase' }), overflowPolicy: 'clip' }),
							clockItem({ id: 'match-clock', label: 'Clock', x: 12, y: 62, width: 192, height: 38, typography: typography({ fontSize: 32, fontWeight: 400, textAlign: 'center', lineHeight: 1 }) }),
						],
					}),
				],
			},
		},
	};
}

export const FEATURE_MATCH_OVERLAY_PRESETS: FeatureMatchOverlayPreset[] = [
	{
		id: 'full-table',
		label: 'Full Table',
		description: 'A full-width main match source with separated details and branding Graphic Items.',
		aspectRatio: 16 / 9,
		config: fullTableConfig(),
	},
	{
		id: 'left-stacked-player-cams',
		label: 'Table with Left Stacked Player Cams',
		description: 'Main table source with two stacked player source items in a left rail.',
		aspectRatio: 16 / 9,
		config: leftStackedPlayerCamsConfig(),
	},
	{
		id: 'neon-feature-match',
		label: 'Neon Feature Match',
		description: 'A neon broadcast frame with player cameras, a full-width scoreboard, glowing rules, gradient name bars, and looping video background support.',
		aspectRatio: 16 / 9,
		config: neonFeatureMatchConfig(),
	},
];

function getFeatureMatchOverlayPreset(id: FeatureMatchOverlayPresetId): FeatureMatchOverlayPreset {
	return FEATURE_MATCH_OVERLAY_PRESETS.find(preset => preset.id === id) ?? FEATURE_MATCH_OVERLAY_PRESETS[0]!;
}

/**
 * A Feature Match Overlay Preset initialises a Feature Match Layout.
 *
 * The whole layout: the Frame, the host-owned Source Items, and the shared item
 * tree. Nothing is carried across any more — a preset owns every part of the
 * layout, so applying one replaces the design and nothing else. Only the selected
 * Feature Match Slot survives, because it says what the Screen is pointing at
 * rather than what it looks like.
 */
export function applyFeatureMatchOverlayPreset(current: FeatureMatchOverlayModeConfig, presetId: FeatureMatchOverlayPresetId): FeatureMatchOverlayModeConfig {
	return {
		...structuredClone(getFeatureMatchOverlayPreset(presetId).config),
		featureMatchId: current.featureMatchId,
		presetId,
	};
}
