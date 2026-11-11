import type { DOMWrapper, VueWrapper } from '@vue/test-utils';
import type { DbEvent } from '~~/server/db/schema';
import type { ScreenModeConfigField } from '~~/shared/screenModeConfigs/fields';
import type { Game, ScreenMode } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import { SCREEN_SETTINGS_CARDS } from '~~/shared/screenModeConfigs/fields';
import { SUPPORTED_SOCIAL_NETWORK_KEYS } from '~~/shared/socialProfiles';
import { screenModeConfigContract, screenModeTokens } from '~~/shared/screenModes';
import { GAME_VALUES } from '~~/shared/types/enums';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { layersPinningNoAsset } from '~~/test/helpers/backgroundLayers';
import { createMockEvent } from '~~/test/helpers/fixtures';
import { nuxtUiStubs, UFormFieldBesideStub, UInputMenuStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { fakeScreenThemeNetwork, overrideWrites, screenSettingsPage, seedThemedScreen } from '~~/test/nuxt/helpers/screenThemeOverrides';
import { getScreenModeSettingsComponent } from '~/modules/screen-mode';
import { useEventStore } from '~/stores/event';

vi.mock('~/modules/screen-mode/editorModeData', () => import('~~/test/helpers/editedScreenModeData'));

// The generic settings renderer draws a mode's page from its config contract
// and Mode Tokens: each field once, in the fixed card order, hidden when it
// cannot apply, each edit naming its field, each Mode Token in its group's Look.

enableAutoUnmount(afterEach);

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

// ── The mode's config, as `useModeConfigUpdate` holds it ──

const config = ref<Record<string, any>>({});
const writes: Record<string, unknown>[] = [];
const { resetConfig } = vi.hoisted(() => ({
	resetConfig: vi.fn(),
}));

mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: computed(() => config.value),
	saving: ref(false),
	saveState: ref('idle'),
	saveError: ref(null),
	updateConfig: (patch: Record<string, unknown>) => {
		writes.push(patch);
		config.value = {
			...config.value,
			...patch,
		};
	},
	resetConfig,
	retry: vi.fn(),
}));
mockNuxtImport('useServerTime', () => () => ({
	isSynced: ref(true),
	serverTimeOffset: ref(0),
	getServerTime: () => 1_000_000,
}));

// ── What each Event Reference picker offers: one entity of each kind ──

const loaded = {
	isLoaded: true,
	$reset: vi.fn(),
};
mockNuxtImport('usePlayerStore', () => () => ({
	...loaded,
	players: [
		{ id: 5, name: 'Ada', gameData: { type: 'mtg', deckName: 'Mono Blue' } },
	],
	loadPlayersByEventId: vi.fn(),
}));
mockNuxtImport('usePlayerListStore', () => () => ({
	...loaded,
	lists: [],
	loadByEventId: vi.fn(),
}));
mockNuxtImport('useRoundStore', () => () => ({
	...loaded,
	rounds: [
		{
			id: 31,
			phaseId: 3,
			name: 'Round 4',
			roundNumber: 4,
		},
	],
	loadRoundsByEventId: vi.fn(),
}));
mockNuxtImport('usePhaseStore', () => () => ({
	...loaded,
	phases: [
		{ id: 3, name: 'Swiss', sortOrder: 1 },
	],
	loadPhasesByEventId: vi.fn(),
}));
mockNuxtImport('useFeatureMatchStore', () => () => ({
	...loaded,
	loadFeatureMatchesByEventId: vi.fn(),
}));
mockNuxtImport('useFeatureMatchMenuItems', () => () => ref([
	{ label: 'Table 1', value: 4 },
]));
mockNuxtImport('useFeatureMatchStateStore', () => () => ({
	...loaded,
	featureMatchSessions: new Map(),
	sessionIdBySlotId: new Map(),
}));
mockNuxtImport('useBroadcastDeckListStore', () => () => ({
	summaries: [],
	loadCollection: vi.fn(),
}));
mockNuxtImport('usePlayerDeckCache', () => () => ({
	fetchDeck: vi.fn(async () => null),
}));

/** A Mode Token row, named by its token. */
const ThemeTokenFieldStub = defineComponent({
	props: {
		name: { type: String, required: true },
	},
	template: '<div :data-theme-token="name" />',
});

/** An Event offering everything a Screen Mode can show. */
const EVERY_FEATURE: Partial<DbEvent> & { talents?: unknown[] } = {
	talents: [
		{ id: 8, name: 'Kim' },
	],
	pronounsEnabled: true,
	standingsEnabled: true,
	lgsEnabled: true,
	tableNumberEnabled: true,
	featureMatchDefaultTurnTrackingEnabled: true,
	featureMatchDefaultExtraTurnsEnabled: true,
	featureMatchDefaultMulliganTrackingEnabled: true,
	pointsSystem: '7ph',
	broadcastDeckListsEnabled: true,
};

/** What the mounted settings hand the page: its reset, and whether a write is in flight. */
const exposed = ref<{ resetConfig: () => void; saving: boolean } | null>(null);

interface PageOptions {
	game?: Game;
	config?: Record<string, unknown>;
	event?: Partial<DbEvent>;
	overrides?: Record<string, unknown>;
}

async function mountPage(mode: ScreenMode, { game = 'mtg', config: variant = {}, event = {}, overrides = {} }: PageOptions = {}) {
	fakeScreenThemeNetwork(mockFetch, mode);
	const screen = seedThemedScreen(mode, overrides as never);
	useEventStore().event = createMockEvent({
		...EVERY_FEATURE,
		game,
		...event,
		themeId: 'brand',
	}) as never;
	config.value = structuredClone({
		...getDefaultConfigForMode(mode),
		...variant,
	});
	writes.length = 0;
	// The mode's settings as the page mounts them: the renderer, or the mode's own wrapping of it.
	const Settings = getScreenModeSettingsComponent(mode)!;
	await (Settings as { __asyncLoader?: () => Promise<unknown> }).__asyncLoader?.();
	const Page = screenSettingsPage(screen, () => h(Settings, {
		ref: exposed,
		screen: screen(),
		eventId: 1,
	}));
	const wrapper = mount(Page, {
		global: {
			stubs: {
				...nuxtUiStubs,
				UInputMenu: UInputMenuStub,
				// A column list's switches sit in one field row; a wrapping label would forward every click to its first.
				UFormField: UFormFieldBesideStub,
				ThemeTokenField: ThemeTokenFieldStub,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

// ── Reading the page ──

/** Every field a contract declares, a nested block's by its path. */
function declaredFields(mode: ScreenMode): Map<string, ScreenModeConfigField> {
	const fields = new Map<string, ScreenModeConfigField>();
	const visit = (views: Readonly<Record<string, ScreenModeConfigField>>, path: string[]) => {
		for (const field of Object.values(views)) {
			if (field.control === 'block' && field.fields)
				visit(field.fields, [...path, field.key]);
			else
				fields.set([...path, field.key].join('.'), field);
		}
	};
	visit(screenModeConfigContract(mode).fields as Record<string, ScreenModeConfigField>, []);
	return fields;
}

/** Each field the page renders, in page order, with the card it sits in; a slot's widget renders each field naming it. */
function renderedFields(wrapper: VueWrapper): { path: string; card: string }[] {
	return wrapper.findAll('[data-settings-field], [data-settings-fields]').flatMap((found) => {
		const card = found.element.closest('[data-settings-card]')!.getAttribute('data-settings-card')!;
		const paths = found.attributes('data-settings-field')?.split(' ')
			?? found.attributes('data-settings-fields')!.split(' ');
		return paths.map(path => ({ path, card }));
	});
}

function cardsInOrder(wrapper: VueWrapper): string[] {
	return wrapper.findAll('[data-settings-card]').map(card => card.attributes('data-settings-card')!);
}

/** Changes a field's control to a value it does not hold, as an operator would. */
async function edit(row: Omit<DOMWrapper<Element>, 'exists'>) {
	const option = row.find('[role="option"]');
	if (option.exists())
		return option.trigger('click');
	const point = row.findAll('[role="radio"]').find(found => found.attributes('aria-checked') !== 'true' && found.attributes('disabled') === undefined);
	if (point)
		return point.trigger('click');
	const toggle = row.find('[role="switch"], [role="checkbox"]');
	if (toggle.exists())
		return toggle.trigger('click');
	const select = row.find('select');
	if (select.exists()) {
		const other = select.findAll('option').find(found => !(found.element as HTMLOptionElement).selected && !['', 'null'].includes(found.attributes('value') ?? ''));
		return select.setValue(other!.attributes('value'));
	}
	const number = row.find<HTMLInputElement>('input[type="number"]');
	if (number.exists()) {
		const held = Number(number.element.value);
		const min = Number(number.attributes('min') ?? 1);
		const max = Number(number.attributes('max') ?? Number.POSITIVE_INFINITY);
		return number.setValue(String(Number.isNaN(held) || number.element.value === ''
			? min
			: held < max
				? held + 1
				: held - 1));
	}
	return row.get('input').setValue('Edited');
}

// ── The migrated Screen Modes, and the configs that between them show every field ──

const VARIANTS = {
	'round-clock': [
		{},
		{ countUpAfterEnd: true },
	],
	'pairings': [
		{},
		{ autoPageEnabled: true },
	],
	'card': [{}],
	'player-history': [
		{},
		{ autoPageEnabled: true },
	],
	'head-to-head': [
		{},
		{ playerSource: 'players' },
	],
	'feature-match': [{}],
	'talent': [
		{},
		{ selection: 'lineup', rotateSocialProfiles: true, showHeader: true },
	],
	'top-cut': [
		{},
		{ bracketSource: 'manual' },
	],
	'background': [{}],
	// Each board in each view: a grid mainboard and a stacked sideboard following it;
	// a list mainboard and a customised grid sideboard; a customised list sideboard (#1091).
	'deck': [
		{ showDeckStats: true },
		{
			mainboard: { view: 'list' },
			sideboard: { view: 'grid', alignment: 'center' },
		},
		{
			sideboard: { view: 'list', alignment: 'center' },
		},
	],
} as const satisfies Partial<Record<ScreenMode, readonly Record<string, unknown>[]>>;

type RenderedMode = keyof typeof VARIANTS;
const RENDERED_MODES = Object.keys(VARIANTS) as RenderedMode[];

/** The fields a Card Game's Screen cannot use, so its page leaves them out. */
const NOT_FOR_GAME: Partial<Record<RenderedMode, Partial<Record<Game, readonly string[]>>>> = {
	// One Piece has no counters, and its Card Game tracks no life, overtime or mulligan.
	'feature-match': {
		op: [
			'showCounters',
			'allowCounterControls',
			'showOvertime',
			'showMulliganInfo',
			'allowLifeControls',
		],
	},
	// One Piece holds no Phases, so its bracket is always the Manual Bracket, and only its Players have Nicknames.
	'top-cut': {
		mtg: ['playerNameShown'],
		op: ['bracketSource', 'phaseId', 'bracketSizeOverride'],
	},
	// A One Piece Deck List has a Leader and a mainboard only: no sideboard, companion, details row or points.
	'deck': {
		mtg: ['showCostCurve'],
		op: [
			'board',
			'sideboardPlacement',
			...['view', 'columns', 'maxCardSize', 'cardGap', 'listColumns', 'alignment', 'stackReveal'].map(key => `sideboard.${key}`),
			'showCompanion',
			'showDeckStats',
			'showDeckMetaPill',
			'showHighlanderTotal',
			'showHighlanderPointedCards',
			'showHighlanderPoints',
			'highlanderPointsPosition',
			'companionTagPosition',
			'pointsBadgeSize',
			'metaPillSize',
			'pointedCardSize',
		],
	},
};

/** Keys a Page Rotation adds to an edit; never the field an operator edits (ADR-0039). */
const ROTATION_KEYS = new Set(['currentPage', 'rotationAnchor']);

const MODE_GAMES = RENDERED_MODES.flatMap(mode => GAME_VALUES.map(game => [mode, game] as const));

describe('the generic settings renderer', () => {
	it.each(MODE_GAMES)('draws every %s field a %s Event can use once, in the fixed card order', async (mode, game) => {
		const declared = declaredFields(mode);
		const seen = new Set<string>();

		for (const variant of VARIANTS[mode]) {
			const wrapper = await mountPage(mode, { game, config: variant });
			const rendered = renderedFields(wrapper);
			const cards = cardsInOrder(wrapper);

			expect(rendered.map(({ path }) => path), `${mode} ${JSON.stringify(variant)} renders a field twice`)
				.toEqual([
					...new Set(rendered.map(({ path }) => path)),
				]);
			expect(cards).toEqual([...cards].sort((a, b) => SCREEN_SETTINGS_CARDS.indexOf(a as never) - SCREEN_SETTINGS_CARDS.indexOf(b as never)));
			for (const { path, card } of rendered) {
				expect(declared.get(path)?.card, `${mode} renders "${path}" in the ${card} card`).toBe(card);
				seen.add(path);
			}
			wrapper.unmount();
		}

		const unusable = NOT_FOR_GAME[mode]?.[game] ?? [];
		expect([...seen].sort()).toEqual([
			...declared.keys(),
		].filter(path => !unusable.includes(path)).sort());
	});

	it.each([
		{
			mode: 'round-clock',
			config: { countUpAfterEnd: false },
			event: {},
			field: 'countUpLimitMinutes',
			shown: false,
		},
		{
			mode: 'round-clock',
			config: { countUpAfterEnd: true },
			event: {},
			field: 'countUpLimitMinutes',
			shown: true,
		},
		{
			mode: 'pairings',
			config: { showHeader: false },
			event: {},
			field: 'headerText',
			shown: false,
		},
		{
			mode: 'pairings',
			config: { autoPageEnabled: false },
			event: {},
			field: 'autoPageIntervalMs',
			shown: false,
		},
		{
			mode: 'head-to-head',
			config: { playerSource: 'featureMatchSlot' },
			event: {},
			field: 'player1Id',
			shown: false,
		},
		{
			mode: 'head-to-head',
			config: { playerSource: 'players' },
			event: {},
			field: 'featureMatchId',
			shown: false,
		},
		{
			mode: 'head-to-head',
			config: {},
			event: { pronounsEnabled: false },
			field: 'showPronouns',
			shown: false,
		},
		{
			mode: 'feature-match',
			config: {},
			event: { pronounsEnabled: false },
			field: 'showPronouns',
			shown: false,
		},
		{
			mode: 'feature-match',
			config: {},
			event: { standingsEnabled: false },
			field: 'showRecords',
			shown: false,
		},
		{
			mode: 'feature-match',
			config: {},
			event: { lgsEnabled: false },
			field: 'showLgs',
			shown: false,
		},
		{
			mode: 'feature-match',
			config: {},
			event: { tableNumberEnabled: false },
			field: 'showTableNumber',
			shown: false,
		},
		{
			mode: 'feature-match',
			config: {},
			event: { featureMatchDefaultTurnTrackingEnabled: false },
			field: 'showTurnControls',
			shown: false,
		},
		{
			mode: 'feature-match',
			config: {},
			event: { featureMatchDefaultExtraTurnsEnabled: false },
			field: 'showOvertime',
			shown: false,
		},
		{
			mode: 'feature-match',
			config: {},
			event: { featureMatchDefaultMulliganTrackingEnabled: false },
			field: 'showMulliganInfo',
			shown: false,
		},
		{
			mode: 'talent',
			config: { selection: 'one' },
			event: {},
			field: 'talentIds',
			shown: false,
		},
		{
			mode: 'talent',
			config: { selection: 'lineup' },
			event: {},
			field: 'talentId',
			shown: false,
		},
		{
			mode: 'talent',
			config: { rotateSocialProfiles: false },
			event: {},
			field: 'socialProfileDwellMs',
			shown: false,
		},
		{
			mode: 'top-cut',
			config: { bracketSource: 'phase' },
			event: {},
			field: 'manualBracket',
			shown: false,
		},
		{
			mode: 'top-cut',
			config: { bracketSource: 'phase' },
			event: { game: 'op' },
			field: 'manualBracket',
			shown: true,
		},
		{
			mode: 'deck',
			config: { board: 'mainboard' },
			event: {},
			field: 'sideboard.view',
			shown: false,
		},
		{
			mode: 'deck',
			config: { board: 'sideboard' },
			event: {},
			field: 'mainboard.view',
			shown: false,
		},
		{
			mode: 'deck',
			config: { sideboard: { view: 'grid' } },
			event: {},
			field: 'sideboard.columns',
			shown: false,
		},
		{
			mode: 'deck',
			config: { sideboard: { view: 'grid', columns: 3 } },
			event: {},
			field: 'sideboard.columns',
			shown: true,
		},
		{
			mode: 'deck',
			config: {},
			event: { pointsSystem: null },
			field: 'showHighlanderPoints',
			shown: false,
		},
		{
			mode: 'deck',
			config: { deckSource: { type: 'broadcast', broadcastDeckListId: 23 } },
			event: {},
			field: 'showHighlanderTotal',
			shown: false,
		},
	] as { mode: RenderedMode; config: Record<string, unknown>; event: Partial<DbEvent>; field: string; shown: boolean }[])(
		'$mode with $config on an Event with $event shows $field: $shown',
		async ({ mode, config: variant, event, field, shown }) => {
			const wrapper = await mountPage(mode, { config: variant, event });

			expect(renderedFields(wrapper).some(({ path }) => path === field)).toBe(shown);
			// Hidden, never disabled.
			expect(wrapper.find('[role="switch"][disabled], select[disabled], input[disabled]').exists()).toBe(false);
		},
	);

	it.each(RENDERED_MODES)('writes each %s edit as the patch naming its field', async (mode) => {
		for (const variant of VARIANTS[mode]) {
			const wrapper = await mountPage(mode, { config: variant });
			const initial = JSON.parse(JSON.stringify(config.value));
			const rows = wrapper.findAll('[data-settings-field], [data-settings-slot="columns"]')
				.map(row => row.attributes('data-settings-field') ?? row.attributes('data-settings-fields')!);

			for (const path of rows) {
				config.value = structuredClone(initial);
				await nextTick();
				writes.length = 0;
				await edit(wrapper.get(`[data-settings-field="${path}"], [data-settings-fields="${path}"]`));

				const named = writes.flatMap(patch => Object.keys(patch)).filter(key => !ROTATION_KEYS.has(key));
				expect(named, `editing ${mode} "${path}"`).toEqual([path.split('.')[0]]);
			}
			wrapper.unmount();
		}
	});

	it.each(RENDERED_MODES)('renders every %s Mode Token in its group\'s Look, at the end of that group\'s card', async (mode) => {
		const wrapper = await mountPage(mode);
		const groups = screenModeConfigContract(mode).groups as Record<string, { card: string }>;
		const tokens = Object.entries(screenModeTokens(mode));

		expect(wrapper.findAll('[data-theme-token]')).toHaveLength(tokens.length);
		for (const [name, token] of tokens) {
			const card = wrapper.get(`[data-settings-card="${groups[token.settingsGroup]!.card}"]`);
			expect(card.find(`[data-settings-look] [data-settings-group="${token.settingsGroup}"] [data-theme-token="${name}"]`).exists(), name).toBe(true);
		}
	});

	it('counts a card\'s overridden Mode Tokens while its Look is closed, and clears them in one write', async () => {
		const wrapper = await mountPage('pairings', {
			overrides: {
				'pairings.result-reported': '#ff0000',
				'pairings.result-bye': '#00ff00',
			},
		});
		const look = wrapper.get('[data-settings-card="content"] [data-settings-look]');
		const toggle = look.get('button[aria-expanded]');

		expect(toggle.attributes('aria-expanded')).toBe('false');
		expect(toggle.text()).toContain('2 Screen Theme Overrides');

		await toggle.trigger('click');
		await look.findAll('button').find(button => button.text() === 'Clear 2 overrides')!.trigger('click');
		await flushPromises();

		expect(overrideWrites(mockFetch)).toEqual([
			{ 'pairings.result-reported': null, 'pairings.result-bye': null },
		]);
	});

	it('offers a column list every column, one added since the Screen stored its list included, writing the whole list', async () => {
		const stored = [
			{ key: 'round', visible: true },
			{ key: 'opponent', visible: true },
			{ key: 'table', visible: true },
			{ key: 'outcome', visible: true },
		];
		const wrapper = await mountPage('player-history', {
			config: { columns: stored },
		});
		const list = wrapper.get('[data-settings-slot="columns"]');

		await list.get('[aria-label="Show Game score column"]').trigger('click');

		expect(writes).toEqual([
			{
				columns: [
					...stored,
					{ key: 'opponentArchetype', visible: false },
					{ key: 'gameScore', visible: true },
				],
			},
		]);
	});

	it('writes a set in the order its values run, whatever order they were picked in', async () => {
		const [first, second] = SUPPORTED_SOCIAL_NETWORK_KEYS;
		const wrapper = await mountPage('talent', {
			config: { socialNetworks: [second] },
		});

		await wrapper.get('[data-settings-field="socialNetworks"]').findAll('[role="checkbox"]')[0]!.trigger('click');

		expect(writes).toEqual([
			{ socialNetworks: [first, second] },
		]);
	});

	// A block is written whole, and its schema has no `null` inside: an emptied value is Auto, its key left out.
	it.each([
		{ path: 'mainboard.columns', block: 'mainboard', stored: { view: 'grid', columns: 4, maxCardSize: 144, alignment: 'top' }, written: { view: 'grid', maxCardSize: 144, alignment: 'top' } },
		{ path: 'sideboard.cardGap', block: 'sideboard', stored: { view: 'grid', cardGap: 8, alignment: 'top' }, written: { view: 'grid', alignment: 'top' } },
	])('writes $path emptied as its whole block without it', async ({ path, block, stored, written }) => {
		const wrapper = await mountPage('deck', {
			config: { [block]: stored },
		});

		await wrapper.get(`[data-settings-field="${path}"] input[type="number"]`).setValue('');

		expect(writes).toEqual([
			{ [block]: written },
		]);
		expect(screenModeConfigContract('deck').schema.partial().safeParse(writes[0]).success).toBe(true);
	});

	it('bounds a max card size by the largest card the Screen\'s Event Canvas holds', async () => {
		const wrapper = await mountPage('deck', {
			event: { canvasWidth: 1280, canvasHeight: 720 } as Partial<DbEvent>,
		});

		// 720 px tall at a card's 61:85 aspect.
		expect(wrapper.get('[data-settings-field="mainboard.maxCardSize"] input[type="number"]').attributes('max')).toBe('516');
	});

	it('offers a badge position every point but the centre, which a badge cannot take', async () => {
		const wrapper = await mountPage('deck');
		const points = wrapper.get('[data-settings-field="quantityPosition"]').findAll('[role="radio"]');

		expect(points.filter(point => point.attributes('disabled') !== undefined).map(point => point.attributes('data-point'))).toEqual(['center']);
	});

	it.each(RENDERED_MODES)('hands the page the %s settings\' reset and saving state', async (mode) => {
		await mountPage(mode);
		resetConfig.mockClear();

		exposed.value!.resetConfig();

		expect(resetConfig).toHaveBeenCalledOnce();
		expect(exposed.value!.saving).toBe(false);
	});

	// A mode's own widget mounts in the slot its fields name, or heading its group, and writes through the page.
	it.each([
		{
			name: 'Deck List\'s board toggles hide the mainboard',
			mode: 'deck',
			config: {},
			slot: '[data-settings-slot="board-toggles"]',
			act: (row: DOMWrapper<Element>) => row.findAll('[role="switch"]')[0]!.trigger('click'),
			written: { board: 'sideboard' },
		},
		{
			name: 'Deck List\'s Customise copies the mainboard\'s layout to the sideboard',
			mode: 'deck',
			config: { sideboard: { view: 'stack', stackReveal: 40 } },
			slot: '[data-settings-section="sideboard"] [data-settings-group-slot="before:sideboard"]',
			act: (row: DOMWrapper<Element>) => row.findAll('button').find(button => button.text() === 'Customise')!.trigger('click'),
			written: {
				sideboard: { view: 'stack', stackReveal: 40, listColumns: 2, alignment: 'center' },
			},
		},
		{
			name: 'Deck List\'s Use mainboard\'s keeps only the sideboard\'s view and reveal',
			mode: 'deck',
			config: { sideboard: { view: 'stack', stackReveal: 40, columns: 3, alignment: 'top' } },
			slot: '[data-settings-section="sideboard"] [data-settings-group-slot="before:sideboard"]',
			act: (row: DOMWrapper<Element>) => row.findAll('button').find(button => button.text() === 'Use mainboard\'s')!.trigger('click'),
			written: {
				sideboard: { view: 'stack', stackReveal: 40 },
			},
		},
		{
			name: 'Top Cut Bracket\'s Manual Bracket editor seats a Player',
			mode: 'top-cut',
			config: { bracketSource: 'manual' },
			slot: '[data-settings-card="live"] [data-settings-slot="manual-bracket"]',
			act: (row: DOMWrapper<Element>) => row.get('[role="option"]').trigger('click'),
			written: {
				manualBracket: { size: 8, entrants: [{ playerId: 5 }], results: [] },
			},
		},
		{
			name: 'Top Cut Bracket\'s bracket size',
			mode: 'top-cut',
			config: {},
			slot: '[data-settings-slot="bracket-size"]',
			act: (row: DOMWrapper<Element>) => row.get('select').setValue('16'),
			written: { bracketSizeOverride: 16 },
		},
		{
			name: 'Talent\'s lineup adds a Talent',
			mode: 'talent',
			config: { selection: 'lineup' },
			slot: '[data-settings-slot="talent-lineup"]',
			act: (row: DOMWrapper<Element>) => row.get('select').setValue('8'),
			written: { talentIds: [8] },
		},
		{
			name: 'Background\'s Reset to Theme',
			mode: 'background',
			config: { layers: layersPinningNoAsset().slice(0, 1) },
			slot: '[data-settings-card="background-placement"] [data-settings-slot="background-layers"]',
			act: (row: DOMWrapper<Element>) => row.findAll('button').find(button => button.text() === 'Reset to Theme')!.trigger('click'),
			written: { layers: [] },
		},
	] as { name: string; mode: RenderedMode; config: Record<string, unknown>; slot: string; act: (row: DOMWrapper<Element>) => Promise<unknown>; written: Record<string, unknown> }[])(
		'$name in one write',
		async ({ mode, config: variant, slot, act, written }) => {
			const wrapper = await mountPage(mode, { config: variant });

			await act(wrapper.get(slot));
			await flushPromises();

			expect(writes).toEqual([written]);
		},
	);

	it('draws no card a mode gives nothing to show', async () => {
		const wrapper = await mountPage('card');

		expect(cardsInOrder(wrapper)).toEqual(['source', 'content']);
	});
});
