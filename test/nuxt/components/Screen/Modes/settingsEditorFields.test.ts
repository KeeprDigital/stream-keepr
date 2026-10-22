import type { ScreenModeConfigField } from '~~/shared/screenModeConfigs/fields';
import type { ScreenMode } from '~~/shared/types/enums';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, inject, nextTick, provide, ref } from 'vue';
import { z } from 'zod';
import { screenModeConfigFields, unwrapOptionalField } from '~~/shared/screenModeConfigs/fields';
import { SCREEN_MODES, screenModeConfigContract } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import { DEFAULT_DECK_BOARD_LAYOUT, getDefaultConfigForMode } from '~~/shared/types/screenConfig';

/**
 * The guard against an editor drifting from its config contract (ADR-0037, #498).
 *
 * For every Screen Mode it mounts the mode's settings editor under each listed
 * config variant, drives every scalar control it renders, and reads which
 * contract field the control wrote. The field must carry editor metadata, and
 * the control's label, bounds, step and select options must be the contract's.
 * Every editor field must also be rendered by some variant. An Event Reference
 * picker (ADR-0038) is bespoke, so a control writing one is skipped. A mode whose
 * editor renders no scalar control is listed with its reason, and its contract
 * may declare no editor field.
 */

const MODES_WITHOUT_SCALAR_CONTROLS: Partial<Record<ScreenMode, string>> = {
	'background': 'its editor is the Background Layer stack, an authored stack',
	'feature-match-overlay': 'its editor picks a Feature Match Slot (an Event Reference), applies a preset, and edits the server-validated layout',
	'broadcast-graphics': 'its editor edits the authored graphics stack, the Graphic Channels list, and the Broadcast Graphics Background: one Animation Effect selection, a union field the shared Animation Effect editor edits from its catalogue schema',
};

/**
 * Values a contract's select field allows that its editor does not offer. An enum
 * value has no nearest value to clamp a stored one to, so #498 left these for a
 * maintainer to decide rather than tightening the contract.
 */
const OPTIONS_NOT_OFFERED: Record<string, readonly string[]> = {
	// Shared Metagame vocabulary: the Metagame page sorts by it; this editor never offered it.
	'metagame.sortBy': ['conversionRate'],
	// Shared Metagame vocabulary: Top Cards carries no minimum-points field to scope by.
	'top-cards.scope': ['minPoints'],
};

/** Each mode's editor, and the config variants that between them render every scalar control. */
const EDITOR_VARIANTS: Partial<Record<ScreenMode, { editor: string; variants: Record<string, unknown>[] }>> = {
	'card': { editor: 'Card', variants: [{}] },
	'feature-match': { editor: 'FeatureMatch', variants: [{}] },
	// Each board in each view: the defaults show a grid Mainboard and a stacked Sideboard.
	'deck': {
		editor: 'Deck',
		variants: [
			{},
			{ mainboard: { ...DEFAULT_DECK_BOARD_LAYOUT, view: 'list' }, sideboard: { ...DEFAULT_DECK_BOARD_LAYOUT, view: 'grid' } },
			{ mainboard: { ...DEFAULT_DECK_BOARD_LAYOUT, view: 'stack' }, sideboard: { ...DEFAULT_DECK_BOARD_LAYOUT, view: 'list' } },
		],
	},
	// Each view mode's settings; the archetype colours show with the deck column.
	'standings': {
		editor: 'Standings',
		variants: [
			{ viewMode: 'topN' },
			{ viewMode: 'slice' },
			{ viewMode: 'reveal', autoPageEnabled: true, columns: [{ key: 'deck', visible: true }] },
		],
	},
	// Each scope's and each view's settings, and the conversion target a shown Conversion Rate column asks for.
	'metagame': {
		editor: 'Metagame',
		variants: [
			{ scope: 'topN', autoPageEnabled: true },
			{ scope: 'minPoints', viewMode: 'cards' },
			{ archetypeColumns: [{ key: 'archetype', visible: true }, { key: 'conversionRate', visible: true }] },
		],
	},
	'player-history': { editor: 'PlayerHistory', variants: [{ autoPageEnabled: true }] },
	'pairings': { editor: 'Pairings', variants: [{ autoPageEnabled: true }] },
	// The Slot binding and the two Player pickers: both are Event References, so only the source and header are scalar.
	'head-to-head': { editor: 'HeadToHead', variants: [{}, { playerSource: 'players' }] },
	'topCut': { editor: 'TopCut', variants: [{}] },
	// The Top N scope, a fixed card size, and auto-page.
	'top-cards': { editor: 'TopCards', variants: [{ scope: 'topN', dynamicCardSize: false, autoPageEnabled: true }] },
};

// ── The editor's environment ──

const config = ref<Record<string, any>>({});
const writes: Record<string, unknown>[] = [];

function saveConfig(patch: Record<string, unknown>) {
	writes.push(patch);
	config.value = { ...config.value, ...patch };
}

mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: computed(() => config.value),
	saving: ref(false),
	saveState: ref('idle'),
	saveError: ref(null),
	updateConfig: saveConfig,
	resetConfig: vi.fn(),
	retry: vi.fn(),
}));

vi.mock('~/composables/screen/useScreenConfigUpdate', () => ({
	useScreenConfigUpdate: () => ({
		screenConfig: ref({}),
		saving: ref(false),
		updateScreenConfig: vi.fn(),
	}),
}));

const loaded = { isLoaded: true, $reset: vi.fn() };
mockNuxtImport('usePlayerStore', () => () => ({ ...loaded, players: [], loadPlayersByEventId: vi.fn() }));
// One Player List, so every scope that needs one is offered.
mockNuxtImport('usePlayerListStore', () => () => ({ ...loaded, lists: [{ id: 7, name: 'Feature Table', memberCount: 4 }], loadByEventId: vi.fn() }));
mockNuxtImport('useRoundStore', () => () => ({ ...loaded, rounds: [], loadRoundsByEventId: vi.fn() }));
mockNuxtImport('usePhaseStore', () => () => ({ ...loaded, phases: [], loadPhasesByEventId: vi.fn() }));
mockNuxtImport('useFeatureMatchStore', () => () => ({ ...loaded, loadFeatureMatchesByEventId: vi.fn() }));
mockNuxtImport('useFeatureMatchStateStore', () => () => ({ ...loaded, loadState: vi.fn() }));
mockNuxtImport('useBroadcastDeckListStore', () => () => ({ summaries: [], loadCollection: vi.fn() }));
mockNuxtImport('useEventStore', () => () => ({ event: { id: 1, game: 'mtg' }, $reset: vi.fn() }));
mockNuxtImport('usePlayerDeckCache', () => () => ({ fetchDeck: vi.fn() }));
mockNuxtImport('useFeatureMatchMenuItems', () => () => ref([]));

// ── Control stubs: each renders one driveable control carrying what it offers ──

const FIELD_LABEL = Symbol('form-field-label');

const UFormFieldStub = defineComponent({
	props: { label: { type: String, required: false } },
	setup(props, { slots }) {
		provide(FIELD_LABEL, () => props.label);
		return () => h('div', slots.default?.());
	},
});

type ControlKind = ScreenModeConfigField['control'];

interface OptionItem { value: unknown }

function controlStub(kind: ControlKind, next: (props: Record<string, any>) => unknown) {
	return defineComponent({
		inheritAttrs: false,
		props: {
			modelValue: { type: null, required: false },
			label: { type: String, required: false },
			items: { type: Array, required: false },
			min: { type: Number, required: false },
			max: { type: Number, required: false },
			step: { type: Number, required: false },
		},
		emits: ['update:modelValue'],
		setup(props, { attrs, emit }) {
			const fieldLabel = inject<() => string | undefined>(FIELD_LABEL, () => undefined);
			return () => h('button', {
				'type': 'button',
				'data-guard-control': kind,
				'data-label': props.label ?? fieldLabel(),
				'data-aria-label': attrs['aria-label'] as string | undefined,
				'data-min': props.min,
				'data-max': props.max,
				'data-step': props.step,
				'data-values': props.items ? JSON.stringify((props.items as OptionItem[]).map(item => item.value)) : undefined,
				'onClick': () => emit('update:modelValue', next(props)),
			});
		},
	});
}

function differentItem(props: Record<string, any>) {
	const items = (props.items ?? []) as OptionItem[];
	return (items.find(item => item.value !== props.modelValue) ?? items[0])?.value;
}

const stubs = {
	ScreenSettingsCard: defineComponent({ setup: (_, { slots }) => () => h('section', slots.default?.()) }),
	ScreenSettingsToggle: controlStub('toggle', props => !props.modelValue),
	UFormField: UFormFieldStub,
	UInputNumber: controlStub('number', props => (Number(props.modelValue) || 0) + 1),
	USelect: controlStub('select', differentItem),
	UISegmentedTabs: controlStub('select', differentItem),
	UINinePointPicker: controlStub('select', props => (props.modelValue === 'bottom-left' ? 'bottom-right' : 'bottom-left')),
	UIColorPicker: controlStub('color', () => '#010203'),
	UInput: controlStub('text', () => 'Guard'),
	UTabs: true,
	UButton: true,
	USeparator: true,
	UIcon: true,
	UBadge: true,
	ScreenColumnVisibilityList: true,
	MtgManaColorDisplay: true,
};

// ── Reading which contract field a control wrote ──

/** Keys a Page Rotation write adds to an edit; never the field a control edits (ADR-0039). */
const ROTATION_KEYS = new Set(['currentPage', 'rotationAnchor']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The field path a control's first write names: a key, or a key inside a block it
 * rewrote whole. A bespoke field is named whole, whatever its value.
 */
function writtenPath(before: Record<string, unknown>, patch: Record<string, unknown>, bespoke: Set<string>): string[] {
	const keys = Object.keys(patch).filter(key => !ROTATION_KEYS.has(key));
	expect(keys, `a control wrote ${JSON.stringify(patch)}: one field per control`).toHaveLength(1);
	const key = keys[0]!;
	if (bespoke.has(key))
		return [key];
	const value = patch[key];
	const previous = before[key];
	if (isPlainObject(value) && isPlainObject(previous)) {
		const changed = Object.keys(value).filter(inner => value[inner] !== previous[inner]);
		expect(changed, `a control rewrote ${key} changing ${changed.join(', ')}`).toHaveLength(1);
		return [key, changed[0]!];
	}
	return [key];
}

/** Every editor field of a mode's contract, nested blocks included, by path. */
function contractEditorFields(mode: ScreenMode): Map<string, ScreenModeConfigField> {
	const contract = screenModeConfigContract(mode);
	const fields = new Map<string, ScreenModeConfigField>(
		Object.entries(contract.fields as Record<string, ScreenModeConfigField>),
	);
	for (const [key, field] of Object.entries(contract.shape)) {
		const inner = unwrapOptionalField(field as z.ZodType);
		if (inner instanceof z.ZodObject) {
			for (const [innerKey, innerField] of Object.entries(screenModeConfigFields(inner.shape)))
				fields.set(`${key}.${innerKey}`, innerField as ScreenModeConfigField);
		}
	}
	return fields;
}

function numberAttr(value: string | undefined): number | undefined {
	return value === undefined ? undefined : Number(value);
}

async function mountEditor(editor: string) {
	const { default: Settings } = await import(`../../../../../app/components/Screen/Modes/${editor}/Settings.vue`);
	const wrapper = mount(Settings, {
		props: { screen: { id: 1 } as Screen, eventId: 1 },
		global: { stubs },
	});
	await flushPromises();
	return wrapper;
}

describe.each(SCREEN_MODE_VALUES)('the %s settings editor', (mode) => {
	const entry = EDITOR_VARIANTS[mode];
	const reason = MODES_WITHOUT_SCALAR_CONTROLS[mode];

	it('is guarded: listed with its variants, or with why its editor has no scalar control', () => {
		expect(Boolean(entry) !== Boolean(reason), `list ${mode} in EDITOR_VARIANTS or MODES_WITHOUT_SCALAR_CONTROLS`).toBe(true);
	});

	if (reason) {
		it(`declares no editor field, since ${reason}`, () => {
			expect(contractEditorFields(mode).size).toBe(0);
		});
		return;
	}
	if (!entry)
		return;

	it('renders every scalar control from its contract field, and every editor field', async () => {
		const fields = contractEditorFields(mode);
		const eventReferences = new Set(Object.keys(SCREEN_MODES[mode].eventReferences));
		const rendered = new Set<string>();

		for (const variant of entry.variants) {
			const initial = { ...getDefaultConfigForMode(mode), ...variant } as Record<string, unknown>;
			config.value = structuredClone(initial);
			const wrapper = await mountEditor(entry.editor);
			const count = wrapper.findAll('[data-guard-control]').length;

			for (let index = 0; index < count; index++) {
				config.value = structuredClone(initial);
				await nextTick();
				const control = wrapper.findAll('[data-guard-control]')[index]!;
				writes.length = 0;
				await control.trigger('click');
				const patch = writes[0];
				if (!patch)
					continue; // not a write of this mode's config, such as a Screen's alignment

				const path = writtenPath(initial, patch, eventReferences);
				if (path.length === 1 && eventReferences.has(path[0]!))
					continue; // an Event Reference picker stays bespoke (ADR-0038)

				const key = path.join('.');
				const field = fields.get(key);
				const where = `${mode} editor control writing ${key}`;
				expect(field, `${where}: its contract field carries no editor metadata`).toBeDefined();
				const { guardControl, label, ariaLabel, min, max, step, values } = (control.element as HTMLElement).dataset;
				expect(guardControl, `${where}: control kind`).toBe(field!.control);
				// Labelled by its field, visibly or, inside a group of controls, by its accessible name.
				expect([label, ariaLabel], `${where}: label`).toContain(field!.label);
				if (field!.control === 'number') {
					expect({ min: numberAttr(min), max: numberAttr(max), step: numberAttr(step) }, `${where}: bounds`)
						.toEqual({ min: field!.min, max: field!.max, step: field!.step });
				}
				if (field!.control === 'select' && values) {
					const notOffered = OPTIONS_NOT_OFFERED[`${mode}.${key}`] ?? [];
					expect([...new Set(JSON.parse(values) as string[])].sort(), `${where}: options`)
						.toEqual(field!.values!.filter(value => !notOffered.includes(value)).sort());
				}
				rendered.add(key);
			}
			wrapper.unmount();
		}

		expect([...fields.keys()].filter(key => !rendered.has(key)), `${mode} editor fields never rendered`).toEqual([]);
	});
});
