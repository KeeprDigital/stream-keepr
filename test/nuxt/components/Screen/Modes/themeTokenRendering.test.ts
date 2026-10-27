import type { VueWrapper } from '@vue/test-utils';
import type { StoredThemeTokens, ThemeTokenType, ThemeTokenValueTypes } from '~~/shared/modules/theme';
import type { BracketEntrant, BracketPosition, TopCutBracket } from '~~/shared/modules/top-cut-bracket';
import type { ScreenMode } from '~~/shared/types/enums';
import type { BroadcastGraphicConfig, GraphicApplicationFontSelection } from '~~/shared/types/graphics';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, reactive, ref } from 'vue';
import { FEATURE_MATCH_LAYOUT_COMPOSITION_ID } from '~~/shared/featureMatchLayoutComposition';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';
import { SCREEN_MODES, screenModeTokenName, screenModeTokens } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { METAGAME_CHART_MAX_ARCHETYPES } from '~~/shared/utils/metagameChart';
import { createMockScreen } from '~~/test/helpers/fixtures';
import { testGraphicAssetReference } from '~~/test/helpers/graphicsAssetIdentities';
import { text } from '~~/test/helpers/graphicsComposition';
import { stubCapabilitySession, stubFontFaces } from '~~/test/nuxt/helpers/fontFaces';
import Renderer from '~/components/Screen/Renderer.vue';

// Each themed Screen Mode's display, mounted by its Screen host under a
// resolved token set, paints every Mode Token it declares (ADR-0049).

/** Modes whose displays read no Mode Token, and the ticket moving each (or why none will). */
const MODES_NOT_YET_ON_THEME_TOKENS: Partial<Record<ScreenMode, string>> = {
	background: 'none: it declares no Mode Token, and paints the `background` Foundation Token (screenBackgroundLayers)',
};

type ColorProperty = 'color' | 'backgroundColor' | 'borderBottomColor' | 'borderTopColor' | 'borderLeftColor' | 'borderColor' | 'boxShadow' | 'width' | 'height' | 'gap';

/** Where a display paints one Mode Token: an element, and for a colour the property it sets. */
interface Probe {
	selector: string;
	property?: ColorProperty;
	/** For a value no style property carries: the attribute the element states it in. */
	attribute?: string;
	/** Mode config the element needs to render, over the mode's sample config. */
	config?: Record<string, unknown>;
}

/** The Metagame chart's categorical colour slots, slot 1 first. */
const CHART_SLOTS = Array.from({ length: METAGAME_CHART_MAX_ARCHETYPES }, (_, index) => index + 1);

/** Each themed mode's probes, one per Mode Token it declares, by the token's name within the mode. */
const THEMED_DISPLAYS: Partial<Record<ScreenMode, Record<string, Probe>>> = {
	'standings': {
		'surface': { selector: '.standings-table', property: 'backgroundColor' },
		'title-typography': { selector: '.standings-header h2' },
		'title-text': { selector: '.standings-header h2', property: 'color' },
		'title-divider': { selector: '.standings-header', property: 'borderBottomColor' },
		'row-typography': { selector: '.cell-position' },
		'row-divider': { selector: '.standings-row', property: 'borderBottomColor' },
		'primary-text': { selector: '.cell-name', property: 'color' },
		'secondary-text': { selector: '.cell-record', property: 'color' },
		'rise': { selector: '[data-position-change="up"]', property: 'color' },
		'fall': { selector: '[data-position-change="down"]', property: 'color' },
	},
	'pairings': {
		'surface': { selector: '.pairings-rows', property: 'backgroundColor' },
		'title-typography': { selector: '.pairings-header h2' },
		'title-text': { selector: '.pairings-header h2', property: 'color' },
		'title-divider': { selector: '.pairings-header', property: 'borderBottomColor' },
		'row-typography': { selector: '.pairing-row .table' },
		'row-divider': { selector: '.pairing-row', property: 'borderBottomColor' },
		'primary-text': { selector: '.player-1', property: 'color' },
		'secondary-text': { selector: '.versus', property: 'color' },
		'result-typography': { selector: '[data-result="reported"]' },
		'result-reported': { selector: '[data-result="reported"]', property: 'color' },
		'result-pending': { selector: '[data-result="pending"]', property: 'color' },
		'result-bye': { selector: '[data-result="bye"]', property: 'color' },
	},
	'player-history': {
		'surface': { selector: '.history-rows', property: 'backgroundColor' },
		'title-typography': { selector: '.history-header h2' },
		'title-text': { selector: '.history-header h2', property: 'color' },
		'title-divider': { selector: '.history-header', property: 'borderBottomColor' },
		'row-typography': { selector: '.history-row .round' },
		'row-divider': { selector: '.history-row', property: 'borderBottomColor' },
		'primary-text': { selector: '.opponent', property: 'color' },
		'secondary-text': { selector: '.round', property: 'color' },
		'outcome-typography': { selector: '[data-outcome="win"]' },
		'outcome-win': { selector: '[data-outcome="win"]', property: 'color' },
		'outcome-loss': { selector: '[data-outcome="loss"]', property: 'color' },
		'outcome-draw': { selector: '[data-outcome="draw"]', property: 'color' },
		'outcome-pending': { selector: '[data-outcome="pending"]', property: 'color' },
	},
	'head-to-head': {
		'title-typography': { selector: '.head-to-head-header h2' },
		'title-text': { selector: '.head-to-head-header h2', property: 'color' },
		'title-divider': { selector: '.head-to-head-header', property: 'borderBottomColor' },
		'name-typography': { selector: '.name' },
		'label-typography': { selector: '.earlier-matches-title' },
		'surface': { selector: '.head-to-head-earlier-matches', property: 'backgroundColor' },
		'row-typography': { selector: '.earlier-match .round' },
		'row-divider': { selector: '.earlier-match', property: 'borderBottomColor' },
		'primary-text': { selector: '.name', property: 'color' },
		'secondary-text': { selector: '.versus', property: 'color' },
	},
	'archetype-spotlight': {
		'title-typography': { selector: '.spotlight-header h2' },
		'title-text': { selector: '.spotlight-header h2', property: 'color' },
		'title-divider': { selector: '.spotlight-header', property: 'borderBottomColor' },
		'headline-typography': { selector: '.spotlight-name' },
		'label-typography': { selector: '.stat-label' },
		'surface': { selector: '.spotlight-pilots', property: 'backgroundColor' },
		'row-typography': { selector: '.pilot-name' },
		'row-divider': { selector: '.pilot-row', property: 'borderBottomColor' },
		'primary-text': { selector: '.pilot-name', property: 'color' },
		'secondary-text': { selector: '.stat-label', property: 'color' },
		'stat-badge-surface': { selector: '[data-testid="top-cards-stat-badge"]', property: 'backgroundColor' },
		'stat-badge-text': { selector: '[data-testid="top-cards-stat-badge"]', property: 'color' },
	},
	'top-cut': {
		'title-typography': { selector: '.broadcast-table-title h2' },
		'title-text': { selector: '.broadcast-table-title h2', property: 'color' },
		'title-divider': { selector: '.broadcast-table-title', property: 'borderBottomColor' },
		'round-name-typography': { selector: '.bracket-column-name' },
		'round-name-text': { selector: '.bracket-column-name', property: 'color' },
		'entrant-typography': { selector: '.bracket-entrant-name' },
		'primary-text': { selector: '.is-winner .bracket-entrant-name', property: 'color' },
		'secondary-text': { selector: '.is-eliminated .bracket-entrant-name', property: 'color' },
		'position-surface': { selector: '[data-status="reported"]', property: 'backgroundColor' },
		'position-border': { selector: '[data-status="reported"]', property: 'borderTopColor' },
		'pending-position-border': { selector: '[data-status="awaiting"]', property: 'borderTopColor' },
		'entrant-divider': { selector: '.bracket-entrant + .bracket-entrant', property: 'borderTopColor' },
		'winner-surface': { selector: '.bracket-entrant.is-winner', property: 'backgroundColor' },
		'connector': { selector: '.bracket-connector', property: 'borderTopColor' },
		'champion-typography': { selector: '.bracket-champion-name' },
		'champion-border': { selector: '.bracket-champion-name', property: 'borderTopColor' },
	},
	'metagame': {
		'surface': { selector: '.metagame-table', property: 'backgroundColor' },
		'title-typography': { selector: '.metagame-title h2' },
		'title-text': { selector: '.metagame-title h2', property: 'color' },
		'title-divider': { selector: '.metagame-title', property: 'borderBottomColor' },
		'header-typography': { selector: '.metagame-header-cell' },
		'header-text': { selector: '.metagame-header-row', property: 'color' },
		'header-divider': { selector: '.metagame-header-row', property: 'borderBottomColor' },
		'row-typography': { selector: '.metagame-cell' },
		'row-divider': { selector: '.metagame-row', property: 'borderBottomColor' },
		'primary-text': { selector: '.metagame-cell.is-name', property: 'color' },
		'secondary-text': { selector: '.metagame-cell:not(.is-name):not(.is-primary-metric)', property: 'color' },
		'chart-baseline': {
			selector: '.metagame-chart-track',
			property: 'borderLeftColor',
			config: { viewMode: 'chart' },
		},
		...Object.fromEntries(CHART_SLOTS.map(slot => [
			`chart-series-${slot}`,
			{
				selector: `[data-color-slot="${slot}"]`,
				property: 'backgroundColor',
				config: { viewMode: 'chart' },
			},
		])),
		'chart-other': {
			selector: '[data-color-slot="other"]',
			property: 'backgroundColor',
			config: { viewMode: 'chart' },
		},
	},
	'top-cards': {
		'title-typography': { selector: '.top-cards-title h2' },
		'title-text': { selector: '.top-cards-title h2', property: 'color' },
		'name-typography': { selector: '[data-testid="top-cards-name"]' },
		'name-text': { selector: '[data-testid="top-cards-name"]', property: 'color' },
		'card-placeholder-surface': { selector: '.mtg-card', property: 'backgroundColor' },
		'badge-typography': { selector: '[data-testid="top-cards-stat-badge"]' },
		'badge-shadow': { selector: '[data-testid="top-cards-rank-badge"]', property: 'boxShadow' },
		'rank-badge-surface': { selector: '[data-testid="top-cards-rank-badge"]', property: 'backgroundColor' },
		'rank-badge-text': { selector: '[data-testid="top-cards-rank-badge"]', property: 'color' },
		'stat-badge-surface': { selector: '[data-testid="top-cards-stat-badge"]', property: 'backgroundColor' },
		'stat-badge-text': { selector: '[data-testid="top-cards-stat-badge"]', property: 'color' },
		'page-indicator-text': { selector: '[data-testid="top-cards-page-indicator"]', property: 'color' },
	},
	'card': {
		'card-width': { selector: '[data-testid="spotlight-card"]', property: 'width' },
	},
	// A surface probes its outline: the Frame's border stroke, a Source Item's border.
	'feature-match-overlay': {
		'frame-surface': { selector: '.feature-match-overlay__frame-border', attribute: 'stroke' },
		'frame-media': { selector: '.frame-layer', attribute: 'data-frame-media' },
		'frame-animation-effect': { selector: '.frame-layer', attribute: 'data-frame-animation-effect' },
		'source-surface': { selector: '[data-graphic-item-id="main-source"]', property: 'borderTopColor' },
	},
	'deck': {
		'title-typography': { selector: '.deck-header h2' },
		'body-typography': { selector: '.deck-header p' },
		'primary-text': { selector: '.deck-header h2', property: 'color' },
		'secondary-text': { selector: '.deck-header p', property: 'color' },
		'card-placeholder': { selector: '.mtg-card', property: 'backgroundColor' },
		'quantity-badge-text': { selector: '.quantity-badge', property: 'color' },
		'quantity-badge-surface': { selector: '.quantity-badge', property: 'backgroundColor' },
		'points-badge-text': { selector: '[data-testid="highlander-card-badge"]', property: 'color' },
		'points-badge-surface': { selector: '[data-testid="highlander-card-badge"]', property: 'backgroundColor' },
		'meta-pill-text': { selector: '[data-testid="deck-meta-pill"] span', property: 'color' },
		'meta-pill-surface': { selector: '[data-testid="deck-meta-pill"]', property: 'backgroundColor' },
		'meta-pill-accent': { selector: '[data-testid="deck-meta-pill"] .font-medium', property: 'color' },
		'meta-pill-border': { selector: '[data-testid="deck-meta-pill"]', property: 'borderColor' },
		'pointed-card-text': { selector: '[data-testid="highlander-pointed-card-chip"]', property: 'color' },
		'pointed-card-surface': { selector: '[data-testid="highlander-pointed-card-chip"]', property: 'backgroundColor' },
		'pointed-card-accent': { selector: '[data-testid="highlander-pointed-card-chip"] span', property: 'color' },
		'pointed-card-border': { selector: '[data-testid="highlander-pointed-card-chip"]', property: 'borderColor' },
		'card-width': { selector: '[data-testid="mainboard-grid"] .card-item', property: 'width' },
		'card-gap': { selector: '[data-testid="mainboard-grid"]', property: 'gap' },
		'stack-reveal': { selector: '[data-testid="sideboard-stack-column"] .stack-card', property: 'height' },
	},
};

// ── Sample values, distinct from every default ──

const SAMPLES: { [T in ThemeTokenType]: ThemeTokenValueTypes[T] } = {
	'color': 'rgb(12, 34, 56)',
	'dimension': 37,
	'typography': {
		font: { kind: 'application', fontId: 'mplantin' },
		weight: 300,
		lineHeight: 1.7,
		tracking: 0.2,
		case: 'lowercase',
	},
	'backgroundLayers': [
		{
			id: 'wash',
			type: 'color',
			color: '#123456',
			enabled: true,
			opacity: 0.5,
		},
	],
	'animationEffect': { effect: 'caustics' },
	'asset': {
		kind: 'image',
		...testGraphicAssetReference('asset-logo', 'revision-logo'),
	},
	// The composites Graphic Items bind to (#829); no plain-mode Mode Token is one yet.
	'fill': { type: 'solid', color: 'rgb(12, 34, 56)' },
	'surface-style': {
		fill: { type: 'solid', color: 'rgb(12, 34, 56)' },
		fillOpacity: 0.5,
		outline: { color: 'rgb(12, 34, 56)', width: 3 },
	},
	'shape-geometry': {
		topLeft: { treatment: 'cut', size: 7 },
		topRight: { treatment: 'square', size: 0 },
		bottomRight: { treatment: 'square', size: 0 },
		bottomLeft: { treatment: 'square', size: 0 },
		leftSlant: 0,
		rightSlant: 0,
	},
	'animation-recipe': { duration: 700, easing: 'linear', delay: 0 },
};

/** The application fonts' faces, as `main.css` declares them, under names a test can read back. */
const FONT_FACES = { '--font-mplantin': 'SampleSerif', '--font-saira-condensed': 'SampleDisplay' } as const;

// ── The Screen and its data ──

const screen = ref();
const themeTokens = ref<StoredThemeTokens>();
const probeConfig = ref<Record<string, unknown>>({});
const assetCapability = ref<string>();

mockNuxtImport('useScreenContext', () => () => ({
	screen,
	eventId: computed(() => 1),
	interactive: ref(false),
	overlayContainer: ref(null),
	isPreview: ref(false),
	outputMode: ref('overlay'),
	themeTokens,
	assetCapability,
}));

mockNuxtImport('useStandingsModeData', () => () => {
	const config = computed(() => ({
		viewMode: 'all',
		showHeader: true,
		showArchetypeColors: false,
		rowsPerPage: 8,
		animateEntries: false,
		columns: [],
	}));
	const columns = [
		'position',
		'name',
		'record',
		'points',
		'positionChange',
	].map(key => ({ key, visible: true }));
	return {
		config,
		error: ref(null),
		isEmpty: computed(() => false),
		headerText: computed(() => 'Standings'),
		visibleColumns: computed(() => columns),
		pageData: computed(() => [
			{ id: 1, name: 'Climber', position: 1 },
			{ id: 2, name: 'Faller', position: 2 },
		]),
		formatCell: (player: { name: string }, key: string) => key === 'name'
			? player.name
			: key,
		positionChangeOf: (player: { id: number }) => player.id === 1
			? { kind: 'up', by: 1 }
			: { kind: 'down', by: 1 },
	};
});

mockNuxtImport('usePairingsModeData', () => () => ({
	config: computed(() => ({ showHeader: true, rowsPerPage: 8 })),
	error: ref(null),
	isEmpty: computed(() => false),
	headerText: computed(() => 'Pairings'),
	pageData: computed(() => [
		{
			matchId: 1,
			tableNumber: 1,
			player1: { id: 1, name: 'Reported' },
			player2: { id: 2, name: 'Result' },
			isBye: false,
			hasResult: true,
		},
		{
			matchId: 2,
			tableNumber: 2,
			player1: { id: 3, name: 'Still' },
			player2: { id: 4, name: 'Playing' },
			isBye: false,
			hasResult: false,
		},
		{
			matchId: 3,
			tableNumber: null,
			player1: { id: 5, name: 'Byed' },
			player2: null,
			isBye: true,
			hasResult: false,
		},
	]),
	formatResult: (row: { matchId: number }) => `Result ${row.matchId}`,
	winner: () => null,
}));

mockNuxtImport('usePlayerHistoryModeData', () => () => {
	const columns = [
		'round',
		'opponent',
		'table',
		'outcome',
	].map(key => ({ key, visible: true }));
	return {
		config: computed(() => ({ showHeader: true, rowsPerPage: 8, columns })),
		error: ref(null),
		isEmpty: computed(() => false),
		headerText: computed(() => 'History'),
		player: computed(() => ({
			name: 'Player',
			wins: 1,
			losses: 1,
			draws: 1,
			position: 1,
		})),
		pageData: computed(() => ['win', 'loss', 'draw', 'pending'].map((outcome, index) => ({
			id: index + 1,
			roundName: `Round ${index + 1}`,
			tableNumber: index + 1,
			opponentName: `Opponent ${index + 1}`,
			opponentDeckName: null,
			opponentDeckColors: null,
			outcome,
		}))),
		formatOutcome: (row: { outcome: string }) => row.outcome,
	};
});

mockNuxtImport('useHeadToHeadModeData', () => () => {
	const side = (id: number, name: string) => ({
		id,
		name,
		pronouns: 'they/them',
		wins: 1,
		losses: 0,
		draws: 0,
		points: 3,
		deckName: 'Deck',
		deckColors: null,
	});
	return {
		config: computed(() => ({ showHeader: true })),
		error: ref(null),
		isEmpty: computed(() => false),
		firstMeeting: computed(() => false),
		headerText: computed(() => 'Head to Head'),
		player1: computed(() => side(1, 'One')),
		player2: computed(() => side(2, 'Two')),
		earlierMatches: computed(() => [
			{
				matchId: 1,
				roundName: 'Round 1',
				outcome: 'player1',
				gameScore: '2-0',
			},
		]),
		formatRecord: () => '1-0',
	};
});

mockNuxtImport('useArchetypeSpotlightModeData', () => () => ({
	config: computed(() => ({ showHeader: true, rowsPerPage: 8 })),
	error: ref(null),
	isEmpty: computed(() => false),
	headerText: computed(() => 'Spotlight'),
	conversionLabel: computed(() => 'Top 8'),
	spotlight: computed(() => ({
		archetype: { id: 1, name: 'Archetype', colors: null },
		playerCount: 1,
		metaShare: 10,
		convertedCount: 1,
		conversionRate: 100,
	})),
	pageData: computed(() => [
		{ id: 1, name: 'Pilot', position: 1 },
	]),
	topCards: computed(() => [
		{
			id: 1,
			name: 'Card',
			scryfallId: null,
			inclusionRate: 100,
		},
	]),
	currentPage: computed(() => 1),
	totalPages: computed(() => 1),
	formatRecord: () => '1-0',
}));

function entrant(id: number): BracketEntrant {
	return {
		playerId: id,
		name: `Seed ${id}`,
		seed: id,
		deck: { name: `Deck ${id}`, colors: null },
	};
}

function position(status: 'reported' | 'awaiting', entrants: [number, number] | null): BracketPosition {
	return {
		matchId: entrants ? entrants[0] : null,
		tableNumber: null,
		entrants: entrants
			? [
					entrant(entrants[0]),
					entrant(entrants[1]),
				]
			: [null, null],
		gameWins: entrants
			? [2, 1]
			: [null, null],
		gameDraws: entrants ? 0 : null,
		winner: entrants ? 0 : null,
		status,
	};
}

mockNuxtImport('useTopCutModeData', () => () => ({
	config: computed(() => ({
		showSeeds: true,
		showArchetypes: true,
		showHeader: true,
		...probeConfig.value,
	})),
	error: ref(null),
	isEmpty: computed(() => false),
	headerText: computed(() => 'Top 4'),
	// Every kind of Bracket Position at once, which no one real bracket holds.
	bracket: computed((): TopCutBracket => ({
		size: 4,
		columns: [
			{
				roundId: 1,
				name: 'Semifinals',
				positions: [
					position('reported', [1, 4]),
					position('reported', [2, 3]),
				],
			},
			{
				roundId: null,
				name: 'Final',
				positions: [
					position('awaiting', null),
				],
			},
		],
		champion: entrant(1),
	})),
}));

mockNuxtImport('useMetagameModeData', () => () => ({
	config: computed(() => ({
		viewMode: 'archetype',
		showHeader: true,
		animateEntries: false,
		pageSize: 8,
		archetypeColumns: ['archetype', 'count', 'winRate'].map(key => ({ key, visible: true })),
		cardColumns: [],
		...probeConfig.value,
	})),
	error: ref(null),
	isEmpty: computed(() => false),
	headerText: computed(() => 'Metagame'),
	pageData: computed(() => [
		{
			id: 1,
			name: 'Boros Energy',
			count: 4,
			metaShare: 40,
			winRate: 55,
			avgPosition: 3,
			colors: null,
			conversionRate: null,
		},
		{
			id: 2,
			name: 'Eldrazi Ramp',
			count: 2,
			metaShare: 20,
			winRate: 45,
			avgPosition: 5,
			colors: null,
			conversionRate: null,
		},
	]),
	chartBars: computed(() => [
		...CHART_SLOTS.map(slot => ({
			id: slot,
			name: `Archetype ${slot}`,
			colors: null,
			metaShare: 10,
			length: 1,
			colorSlot: slot,
		})),
		{
			id: -1,
			name: 'Other',
			colors: null,
			metaShare: 20,
			length: 1,
			colorSlot: null,
		},
	]),
	currentPage: computed(() => 1),
	totalPages: computed(() => 2),
}));

mockNuxtImport('useTopCardsModeData', () => () => {
	const entry = {
		id: 1,
		name: 'Lightning Bolt',
		inclusionRate: 80,
		avgCopies: 3.6,
		totalCopies: 18,
		deckCount: 4,
		cardType: 'Instant',
		scryfallId: null,
	};
	return {
		config: computed(() => ({
			columns: 5,
			cardSize: 'medium',
			dynamicCardSize: true,
			cardGap: 12,
			showHeader: true,
			showCardNames: true,
			showRankBadges: true,
			statBadge: 'inclusionRate',
			statBadgeSize: 'medium',
			...probeConfig.value,
		})),
		error: ref(null),
		isEmpty: computed(() => false),
		headerText: computed(() => 'Most Played Cards'),
		pageEntries: computed(() => [
			{ entry, rank: 1 },
		]),
		currentPage: computed(() => 1),
		totalPages: computed(() => 2),
	};
});

function deckCard(name: string, compartment: 'mainboard' | 'sideboard') {
	return {
		name,
		quantity: 2,
		compartment,
		cardType: 'Instant',
		scryfallId: null,
		highlanderPoints: 1,
		mtgCard: null,
	};
}

mockNuxtImport('useDeckModeData', () => () => ({
	config: computed(() => ({
		board: 'full',
		sideboardPlacement: 'beside',
		mainboard: { view: 'grid', columns: 4, dynamicCardSize: false },
		sideboard: { view: 'stack' },
		showQuantities: true,
		showDeckName: true,
		showDeckColors: false,
		showDeckStats: false,
		showDeckMetaPill: true,
		showHighlanderTotal: false,
		showHighlanderPointedCards: true,
		showHighlanderPoints: true,
	})),
	primaryHeader: ref('Alice'),
	secondaryHeader: ref('Mono Blue'),
	deckColors: '',
	companion: ref({ name: 'Lurrus of the Dream-Den' }),
	highlander: ref({
		system: '7ph',
		status: 'legal',
		points: 1,
		maxPoints: 7,
		hasReserveListCards: false,
		pointedCards: [
			{
				name: 'Mana Drain',
				points: 1,
				compartments: [],
				totalQuantity: 1,
			},
		],
		duplicateCards: [],
		unknownCards: [],
	}),
	deckCounters: ref([]),
	deckStats: ref([]),
	mainboard: ref([
		deckCard('Mana Drain', 'mainboard'),
	]),
	sideboard: ref([
		deckCard('Pyroblast', 'sideboard'),
		deckCard('Hydroblast', 'sideboard'),
	]),
	error: ref(null),
	hasDisplayedDeck: computed(() => true),
	displayedDeckVersion: ref(1),
	pendingSwapVersion: ref(0),
	commitPendingDeck: () => {},
}));

const spotlightCard = {
	id: 'spotlight',
	imageData: {
		front: { normal: 'https://cards.example/spotlight.jpg' },
	},
	displayData: {},
};

mockNuxtImport('useCardModeData', () => () => ({
	displayConfig: computed(() => ({ animationEnabled: false, animationSpeed: 'normal' })),
	screenId: computed(() => 1),
	error: ref(null),
}));

// A store's state is refs, as `storeToRefs` reads it.
mockNuxtImport('useCardStore', () => () => {
	const activeCard = ref<typeof spotlightCard | null>(null);
	return reactive({
		activeCard,
		setActiveScreen() {},
		async loadActiveCard() {
			activeCard.value = spotlightCard;
		},
	});
});

// The graphics hosts: one on-air composition holding a Theme-bound Graphic Item.

const BOUND_TEXT = {
	...text('bound', {
		themeBindings: { 'typography.color': 'text-primary' },
	}),
	typography: {
		...text('bound').typography,
		color: '#123123',
	},
	text: 'Bound',
};
const boundComposition: BroadcastGraphicConfig = {
	id: 'graphic',
	name: 'Graphic',
	items: [BOUND_TEXT],
};

mockNuxtImport('useBroadcastGraphicsModeData', () => () => ({
	animationProjection: computed(() => ({})),
	background: computed(() => undefined),
	graphics: computed(() => [boundComposition]),
	onAirGraphicIds: computed(() => [boundComposition.id]),
	inputValues: computed(() => ({})),
	outgoingInputValues: computed(() => ({})),
	socialProfileValues: computed(() => ({})),
	outgoingSocialProfileValues: computed(() => ({})),
	socialProfilePresentations: computed(() => ({})),
	outgoingSocialProfilePresentations: computed(() => ({})),
	isAuthoringPreview: computed(() => false),
	selectedTarget: computed(() => ({ type: 'canvas' })),
	publishSelection: () => {},
}));

mockNuxtImport('useFeatureMatchOverlayModeData', () => () => ({
	config: computed(() => ({
		...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG,
		layout: {
			...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout,
			composition: { ...boundComposition, id: FEATURE_MATCH_LAYOUT_COMPOSITION_ID },
		},
	})),
	match: ref(null),
	matchState: ref(null),
	sourceMatch: ref(null),
	round: ref(null),
	phase: ref(null),
	event: ref(null),
	usesSampleDataset: computed(() => false),
	loading: ref(false),
	error: ref(null),
}));

mockNuxtImport('useFeatureMatchOverlaySideboardData', () => () => ({
	sideboards: computed(() => ({ player1: null, player2: null })),
	cardDataDegraded: ref(false),
}));

// ── Mounting and reading what is painted ──

let wrapper: VueWrapper | undefined;

beforeAll(() => {
	for (const [property, face] of Object.entries(FONT_FACES))
		document.documentElement.style.setProperty(property, face);
});

afterEach(() => {
	wrapper?.unmount();
	wrapper = undefined;
});

/** Mounts `mode` under `theme`, with mode config over its sample and the Screen's own overrides. */
async function mountMode(
	mode: ScreenMode,
	theme?: StoredThemeTokens,
	{ config = {}, themeOverrides = {} }: { config?: Record<string, unknown>; themeOverrides?: StoredThemeTokens } = {},
) {
	screen.value = createMockScreen({ currentMode: mode, themeOverrides });
	themeTokens.value = theme;
	probeConfig.value = config;
	wrapper = mount(Renderer, {
		attachTo: document.body,
		global: {
			stubs: { MtgManaColorDisplay: true, MtgCardImage: true },
		},
	});
	// The display is an async component.
	await vi.waitFor(() => expect(wrapper!.get('.screen-renderer').element.childElementCount).toBeGreaterThan(0));
	await flushPromises();
	// A display holding an image back until it loads shows it.
	for (const image of wrapper.findAll('img'))
		await image.trigger('load');
	await flushPromises();
	return wrapper;
}

/** What a probe's element visibly paints. */
function painted(probe: Probe, type: ThemeTokenType) {
	const element = wrapper!.find(probe.selector);
	expect(element.exists(), `${probe.selector} is rendered`).toBe(true);
	if (probe.attribute)
		return element.attributes(probe.attribute);
	const style = getComputedStyle(element.element);
	if (type !== 'typography') {
		return probe.property === 'boxShadow'
			// A shadow's colour, after its offsets, blur and spread.
			? style.boxShadow.replace(/^(?:-?[\d.]+(?:px)?\s+)+/, '')
			: style[probe.property!];
	}
	return {
		fontFamily: style.fontFamily,
		fontWeight: style.fontWeight,
		lineHeight: style.lineHeight,
		letterSpacing: inEm(style.letterSpacing, style.fontSize),
		textTransform: style.textTransform,
	};
}

/** Tracking as em, whether the element computes it in px or keeps the em it inherited. */
function inEm(letterSpacing: string, fontSize: string) {
	return letterSpacing.endsWith('px')
		? `${Number.parseFloat(letterSpacing) / Number.parseFloat(fontSize)}em`
		: letterSpacing;
}

/** What a sample value looks like painted, as the test's independent reading of it. */
function expectedPaint(type: ThemeTokenType, value: unknown) {
	if (type === 'color')
		return value;
	if (type === 'dimension')
		return `${value}px`;
	if (type === 'surface-style') {
		// Its outline's colour, read as the colour Foundation Token it names, if it names one.
		const color = (value as ThemeTokenValueTypes['surface-style']).outline!.color;
		return typeof color === 'string'
			? color
			: FOUNDATION_TOKENS[color.token as 'accent'].default;
	}
	if (type === 'asset') {
		const asset = value as ThemeTokenValueTypes['asset'];
		return asset
			? `${asset.assetId}/${asset.revisionId}`
			: 'none';
	}
	if (type === 'animationEffect')
		return (value as ThemeTokenValueTypes['animationEffect']).effect;
	const typography = value as ThemeTokenValueTypes['typography'];
	const font = typography.font as GraphicApplicationFontSelection;
	return {
		fontFamily: FONT_FACES[`--font-${font.fontId}` as keyof typeof FONT_FACES],
		fontWeight: String(typography.weight),
		lineHeight: String(typography.lineHeight),
		letterSpacing: `${typography.tracking}em`,
		textTransform: typography.case,
	};
}

/** The graphics hosts: their Graphic Items bind Foundation Tokens, and the Feature Match Overlay's Frame and Source Items paint Mode Tokens. */
const GRAPHICS_HOSTS = ['broadcast-graphics', 'feature-match-overlay'] as const satisfies readonly ScreenMode[];

describe.each(GRAPHICS_HOSTS)('the %s display', (mode) => {
	function boundColor() {
		return getComputedStyle(wrapper!.get('[data-graphic-item-kind="text"] p').element).color;
	}

	it('paints a Theme-bound Graphic Item from its Event\'s Theme, and restyles it on air when the Theme changes', async () => {
		await mountMode(mode, { 'text-primary': 'rgb(12, 34, 56)' });
		expect(boundColor()).toBe('rgb(12, 34, 56)');

		themeTokens.value = { 'text-primary': 'rgb(65, 43, 21)' };
		await flushPromises();
		expect(boundColor()).toBe('rgb(65, 43, 21)');
	});

	it('paints it as the Default Theme ships it when its Event has no Theme', async () => {
		await mountMode(mode);

		expect(boundColor()).toBe(FOUNDATION_TOKENS['text-primary'].default);
	});

	it('paints it from the Screen\'s own override of its Foundation Token, over the Theme', async () => {
		await mountMode(mode, { 'text-primary': 'rgb(12, 34, 56)' }, {
			themeOverrides: { 'text-primary': 'rgb(65, 43, 21)' },
		});

		expect(boundColor()).toBe('rgb(65, 43, 21)');
	});
});

describe.each(SCREEN_MODE_VALUES)('the %s display', (mode) => {
	const probes = THEMED_DISPLAYS[mode];
	const notYet = MODES_NOT_YET_ON_THEME_TOKENS[mode];
	const declared = screenModeTokens(mode);

	if (mode === 'broadcast-graphics') {
		it('declares no Mode Tokens: its Graphic Items bind Foundation Tokens', () => {
			expect(declared).toEqual({});
		});
		return;
	}

	if (SCREEN_MODES[mode].displayType === 'control') {
		it('consumes no Theme Token, as an operator surface', () => {
			expect(declared).toEqual({});
		});
		return;
	}

	it('is themed with a probe per Mode Token, or listed as not yet on Theme Tokens', () => {
		expect(Boolean(probes) !== Boolean(notYet), `list ${mode} in THEMED_DISPLAYS or MODES_NOT_YET_ON_THEME_TOKENS`).toBe(true);
		if (probes)
			expect(Object.keys(probes).map(token => screenModeTokenName(mode, token)).sort()).toEqual(Object.keys(declared).sort());
	});

	if (!probes)
		return;

	const tokens = Object.entries(SCREEN_MODES[mode].modeTokens ?? {}).map(([token, definition]) => ({
		name: screenModeTokenName(mode, token),
		definition,
		probe: probes[token]!,
	}));

	it.each(tokens)('paints $name from the Theme', async ({ name, definition, probe }) => {
		// A dimension sample sits within the token's bounds, which a stored value outside reads clamped to.
		const sample = definition.type === 'dimension' && definition.bounds
			? Math.min(definition.bounds.max, Math.max(definition.bounds.min + 1, SAMPLES.dimension))
			: SAMPLES[definition.type];
		await mountMode(mode, { [name]: sample }, { config: probe.config });

		expect(painted(probe, definition.type)).toEqual(expectedPaint(definition.type, sample));
	});

	it.each(tokens)('paints $name as the Default Theme ships it when its Event has no Theme', async ({ definition, probe }) => {
		const shipped = typeof definition.default === 'object' && definition.default !== null && 'token' in definition.default
			? FOUNDATION_TOKENS[definition.default.token].default
			: definition.default;
		await mountMode(mode, undefined, { config: probe.config });

		expect(painted(probe, definition.type)).toEqual(expectedPaint(definition.type, shipped));
	});
});

describe('a Screen Theme Override', () => {
	const dividers = [THEMED_DISPLAYS.standings!['title-divider']!, THEMED_DISPLAYS.standings!['row-divider']!];

	it('paints over the Theme wherever its Foundation Token is named, and the Theme again once cleared', async () => {
		await mountMode('standings', { divider: 'rgb(1, 2, 3)' }, {
			themeOverrides: { divider: 'rgb(4, 5, 6)' },
		});
		expect(dividers.map(probe => painted(probe, 'color'))).toEqual(['rgb(4, 5, 6)', 'rgb(4, 5, 6)']);

		screen.value = { ...screen.value, themeOverrides: {} };
		await flushPromises();

		expect(dividers.map(probe => painted(probe, 'color'))).toEqual(['rgb(1, 2, 3)', 'rgb(1, 2, 3)']);
	});
});

// A library font in the Theme is loaded on the output as a `FontFace` through the
// Screen Output Asset Capability, and a Theme edit restyles live text (ADR-0050).
describe('a library font in the Theme', () => {
	const title = THEMED_DISPLAYS.standings!['title-typography']!;
	const heading = (revisionId: string) => ({
		...FOUNDATION_TOKENS.heading.default,
		font: {
			kind: 'asset',
			reference: testGraphicAssetReference('asset-brand-face', revisionId),
		},
	});
	let fonts: ReturnType<typeof stubFontFaces>;

	beforeEach(() => {
		fonts = stubFontFaces();
		stubCapabilitySession();
		assetCapability.value = 'capability-token';
	});

	afterEach(() => {
		assetCapability.value = undefined;
		vi.unstubAllGlobals();
	});

	it('paints in the revision\'s face, loaded through the capability, and follows a Theme edit', async () => {
		await mountMode('standings', {
			heading: heading('revision-1'),
		});
		await vi.waitFor(() => expect(wrapper!.get('.screen-renderer').attributes('data-font-ready')).toBe('true'));

		expect(painted(title, 'typography')).toMatchObject({ fontFamily: 'stream-keepr-graphic-asset-asset-brand-face-revision-1' });
		expect(fonts.constructed).toEqual([
			{
				family: 'stream-keepr-graphic-asset-asset-brand-face-revision-1',
				source: expect.stringContaining('/api/screen-output/screens/'),
			},
		]);
		expect(fonts.constructed[0]!.source).toContain('/assets/asset-brand-face/revisions/revision-1/content');

		themeTokens.value = {
			heading: heading('revision-2'),
		};
		await vi.waitFor(() => expect(fonts.constructed.map(face => face.family)).toContain('stream-keepr-graphic-asset-asset-brand-face-revision-2'));
		await flushPromises();

		expect(painted(title, 'typography')).toMatchObject({ fontFamily: 'stream-keepr-graphic-asset-asset-brand-face-revision-2' });
	});
});
