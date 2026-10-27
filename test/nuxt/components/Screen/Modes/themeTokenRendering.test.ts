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
	'player-history': '#822',
	'pairings': '#822',
	'archetype-spotlight': '#822',
	'head-to-head': '#822',
};

type ColorProperty = 'color' | 'backgroundColor' | 'borderBottomColor';

/** Where a display paints one Mode Token: an element, and for a colour the property it sets. */
interface Probe {
	selector: string;
	property?: ColorProperty;
}

/** Each themed mode's probes, one per Mode Token it declares, by the token's name within the mode. */
const THEMED_DISPLAYS: Partial<Record<ScreenMode, Record<string, Probe>>> = {
	standings: {
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
