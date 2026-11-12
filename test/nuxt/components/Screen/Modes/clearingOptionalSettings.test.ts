import type { ScreenMode } from '~~/shared/types/enums';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, inject, provide, ref } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { ScreenSettingsSectionStub } from '~~/test/nuxt/helpers/screenSettingsSection';

vi.mock('~/modules/screen-mode/editorModeData', () => import('~~/test/helpers/editedScreenModeData'));

// Clearing an optional setting in a mode's settings editor writes the `null` that deletes it
// (#703): one case per control kind and write path. Each control's own clearing is its home's
// (`ConfigField.test.ts`, `eventReferencePickers.test.ts`); each field's write is `ModeSettings.test.ts`'s.

const config = ref<Record<string, unknown>>({});
const writes: Record<string, unknown>[] = [];

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
	resetConfig: vi.fn(),
	retry: vi.fn(),
}));

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(async () => ({ history: [], matches: [] })),
}));
mockNuxtImport('$fetch', () => mockFetch);

const loaded = {
	isLoaded: true,
	$reset: vi.fn(),
};
mockNuxtImport('usePlayerStore', () => () => ({
	...loaded,
	players: [
		{ id: 5, name: 'Ada' },
	],
	loadPlayersByEventId: vi.fn(),
}));
mockNuxtImport('usePlayerListStore', () => () => ({
	...loaded,
	lists: [
		{ id: 7, name: 'Feature Table', memberCount: 4 },
	],
	loadByEventId: vi.fn(),
}));
mockNuxtImport('useRoundStore', () => () => ({
	...loaded,
	rounds: [
		{ id: 31, name: 'Round 4' },
	],
	loadRoundsByEventId: vi.fn(),
}));
mockNuxtImport('usePhaseStore', () => () => ({
	...loaded,
	phases: [
		{ id: 3, name: 'Top 8', sortOrder: 1 },
	],
	loadPhasesByEventId: vi.fn(),
}));
mockNuxtImport('useEventStore', () => () => ({
	event: { id: 1, game: 'mtg' },
	$reset: vi.fn(),
}));
mockNuxtImport('useFeatureMatchStore', () => () => ({
	...loaded,
	loadFeatureMatchesByEventId: vi.fn(),
}));
mockNuxtImport('useFeatureMatchMenuItems', () => () => ref([
	{ label: 'Table 1', value: 4 },
]));

// ── Controls, each found by the label of the form field around it ──

const FIELD_LABEL = Symbol('form-field-label');
const clearers = new Map<string, () => void>();

const UFormFieldStub = defineComponent({
	props: {
		label: { type: String, required: false },
	},
	setup(props, { slots }) {
		provide(FIELD_LABEL, () => props.label);
		return () => h('div', slots.default?.());
	},
});

/** A control an operator clears: a text input emptied, or a select put back on its placeholder. */
function clearableStub(cleared: unknown) {
	return defineComponent({
		inheritAttrs: false,
		props: {
			modelValue: { type: null, required: false },
		},
		emits: ['update:modelValue'],
		setup(_, { emit }) {
			const label = inject<() => string | undefined>(FIELD_LABEL, () => undefined)();
			if (label)
				clearers.set(label, () => emit('update:modelValue', cleared));
			return () => h('div');
		},
	});
}

let mounted: { unmount: () => void } | null = null;

afterEach(() => {
	mounted?.unmount();
	mounted = null;
});

/** The modes below whose page the generic settings renderer draws itself; the others wrap it. */
const RENDERED: ReadonlySet<ScreenMode> = new Set([
	'round-clock',
	'head-to-head',
]);

async function mountEditor(editor: string, mode: ScreenMode) {
	const { default: Settings } = RENDERED.has(mode)
		? await import('~/components/Screen/ModeSettings.vue')
		: await import(`../../../../../app/components/Screen/Modes/${editor}/Settings.vue`);
	const wrapper = mount(Settings, {
		props: {
			screen: { id: 1, currentMode: mode } as Screen,
			eventId: 1,
		},
		global: {
			stubs: {
				ScreenSettingsSection: ScreenSettingsSectionStub,
				ScreenSettingsToggle: true,
				ScreenColumnConfigEditor: true,
				ScreenColumnVisibilityList: true,
				ScreenRotationSettings: true,
				UFormField: UFormFieldStub,
				UInput: clearableStub(''),
				USelect: clearableStub(null),
				USelectMenu: clearableStub(null),
				UInputMenu: clearableStub(null),
				UInputNumber: clearableStub(null),
				USwitch: true,
				UButton: true,
				USeparator: true,
				UIcon: true,
				UBadge: true,
				// A group's Look writes Screen Theme Overrides, never config (ADR-0072).
				ScreenThemeTokenGroup: true,
				ScreenSettingsLook: true,
			},
		},
	});
	mounted = wrapper;
	await flushPromises();
	return wrapper;
}

type ClearableField = [label: string, field: string, storedValue: unknown];

describe.each<[string, ScreenMode, Record<string, unknown>, ClearableField[]]>([
	// A paginated mode writes through its Page Rotation: a number, and a picker in its Source.
	[
		'Metagame',
		'metagame',
		{ viewMode: 'cards', scope: 'playerList' },
		[
			['Max width', 'maxWidth', 1200],
			['Player List', 'playerListId', 7],
		],
	],
	// Text, on a mode that writes its config directly.
	[
		'HeadToHead',
		'head-to-head',
		{},
		[
			['Header text', 'headerText', 'Feature Match Preview'],
		],
	],
	// A slot's own widget.
	[
		'TopCut',
		'top-cut',
		{},
		[
			['Bracket size', 'bracketSizeOverride', 8],
		],
	],
	// A cleared Round follows the Current Round (ADR-0066).
	[
		'RoundClock',
		'round-clock',
		{},
		[
			['Round', 'roundId', 31],
		],
	],
])('the %s settings editor', (editor, mode, variant, fields) => {
	beforeEach(() => {
		writes.length = 0;
		clearers.clear();
	});

	it.each(fields)('writes a cleared "%s" as the null that deletes %s', async (label, field, storedValue) => {
		config.value = {
			...getDefaultConfigForMode(mode),
			showHeader: true,
			...variant,
			[field]: storedValue,
		};
		await mountEditor(editor, mode);

		const clear = clearers.get(label);
		expect(clear, `no "${label}" control rendered`).toBeDefined();
		clear!();

		expect(writes.at(-1)).toHaveProperty(field, null);
	});
});
