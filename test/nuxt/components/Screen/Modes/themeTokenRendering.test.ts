import type { VueWrapper } from '@vue/test-utils';
import type { StoredThemeTokens, ThemeTokenType, ThemeTokenValueTypes } from '~~/shared/modules/theme';
import type { ScreenMode } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';
import { SCREEN_MODES, screenModeTokenName, screenModeTokens } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import { createMockScreen } from '~~/test/helpers/fixtures';
import Renderer from '~/components/Screen/Renderer.vue';

// Each themed Screen Mode's display, mounted by its Screen host under a
// resolved token set, paints every Mode Token it declares (ADR-0049).

/** Modes whose displays still read their look from elsewhere, and the ticket moving each. */
const MODES_NOT_YET_ON_THEME_TOKENS: Partial<Record<ScreenMode, string>> = {
	'background': '#825',
	'card': '#824',
	'deck': '#824',
	'top-cut': '#823',
	'feature-match-overlay': '#831',
	'broadcast-graphics': '#829',
	'metagame': '#823',
	'top-cards': '#823',
};

type ColorProperty = 'color' | 'backgroundColor' | 'borderBottomColor';

/** Where a display paints one Mode Token: an element, and for a colour the property it sets. */
interface Probe {
	selector: string;
	property?: ColorProperty;
}

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
		'win': { selector: '[data-outcome="win"]', property: 'color' },
		'loss': { selector: '[data-outcome="loss"]', property: 'color' },
		'draw': { selector: '[data-outcome="draw"]', property: 'color' },
		'pending': { selector: '[data-outcome="pending"]', property: 'color' },
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
};

// ── Sample values, distinct from every default ──

const SAMPLES: { [T in ThemeTokenType]: ThemeTokenValueTypes[T] } = {
	color: 'rgb(12, 34, 56)',
	dimension: 37,
	typography: {
		font: { kind: 'application', fontId: 'mplantin' },
		weight: 300,
		lineHeight: 1.7,
		tracking: 0.2,
		case: 'lowercase',
	},
};

/** The application fonts' faces, as `main.css` declares them, under names a test can read back. */
const FONT_FACES = { '--font-mplantin': 'SampleSerif', '--font-saira-condensed': 'SampleDisplay' } as const;

// ── The Screen and its data ──

const screen = ref();
const themeTokens = ref<StoredThemeTokens>();

mockNuxtImport('useScreenContext', () => () => ({
	screen,
	eventId: computed(() => 1),
	interactive: ref(false),
	overlayContainer: ref(null),
	isPreview: ref(false),
	outputMode: ref('overlay'),
	themeTokens,
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

async function mountMode(mode: ScreenMode, theme?: StoredThemeTokens) {
	screen.value = createMockScreen({ currentMode: mode });
	themeTokens.value = theme;
	wrapper = mount(Renderer, {
		attachTo: document.body,
		global: {
			stubs: { MtgManaColorDisplay: true },
		},
	});
	// The display is an async component.
	await vi.waitFor(() => expect(wrapper!.get('.screen-renderer').element.childElementCount).toBeGreaterThan(0));
	await flushPromises();
	return wrapper;
}

/** What a probe's element visibly paints. */
function painted(probe: Probe, type: ThemeTokenType) {
	const element = wrapper!.find(probe.selector);
	expect(element.exists(), `${probe.selector} is rendered`).toBe(true);
	const style = getComputedStyle(element.element);
	if (type !== 'typography')
		return style[probe.property!];
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
	const typography = value as ThemeTokenValueTypes['typography'];
	return {
		fontFamily: FONT_FACES[`--font-${typography.font.fontId}` as keyof typeof FONT_FACES],
		fontWeight: String(typography.weight),
		lineHeight: String(typography.lineHeight),
		letterSpacing: `${typography.tracking}em`,
		textTransform: typography.case,
	};
}

describe.each(SCREEN_MODE_VALUES)('the %s display', (mode) => {
	const probes = THEMED_DISPLAYS[mode];
	const notYet = MODES_NOT_YET_ON_THEME_TOKENS[mode];
	const declared = screenModeTokens(mode);

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
		const sample = SAMPLES[definition.type];
		await mountMode(mode, { [name]: sample });

		expect(painted(probe, definition.type)).toEqual(expectedPaint(definition.type, sample));
	});

	it.each(tokens)('paints $name as the Default Theme ships it when its Event has no Theme', async ({ definition, probe }) => {
		const shipped = typeof definition.default === 'object' && 'token' in definition.default
			? FOUNDATION_TOKENS[definition.default.token].default
			: definition.default;
		await mountMode(mode);

		expect(painted(probe, definition.type)).toEqual(expectedPaint(definition.type, shipped));
	});
});
