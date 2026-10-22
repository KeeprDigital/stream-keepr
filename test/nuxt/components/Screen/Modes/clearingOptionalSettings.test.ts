import type { ScreenMode } from '~~/shared/types/enums';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, inject, provide, ref } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';

/**
 * Clearing an optional setting in a mode's settings editor writes the `null` that
 * deletes it (#703). An editor used to write `undefined`, which JSON omits, so the
 * server kept the old value and it came back after the save. What the write does
 * from there — the request, the merge, the reload — is
 * `test/nuxt/composables/screen/screenSettingsSaves.test.ts`.
 */

const config = ref<Record<string, unknown>>({});
const writes: Record<string, unknown>[] = [];

mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: computed(() => config.value),
	saving: ref(false),
	saveState: ref('idle'),
	saveError: ref(null),
	updateConfig: (patch: Record<string, unknown>) => {
		writes.push(patch);
		config.value = { ...config.value, ...patch };
	},
	resetConfig: vi.fn(),
	retry: vi.fn(),
}));

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn(async () => ({ history: [], matches: [] })) }));
mockNuxtImport('$fetch', () => mockFetch);

const loaded = { isLoaded: true, $reset: vi.fn() };
mockNuxtImport('usePlayerStore', () => () => ({ ...loaded, players: [{ id: 5, name: 'Ada' }], loadPlayersByEventId: vi.fn() }));
mockNuxtImport('usePlayerListStore', () => () => ({ ...loaded, lists: [{ id: 7, name: 'Feature Table', memberCount: 4 }], loadByEventId: vi.fn() }));
mockNuxtImport('useRoundStore', () => () => ({ ...loaded, rounds: [{ id: 31, name: 'Round 4' }], loadRoundsByEventId: vi.fn() }));
mockNuxtImport('useArchetypeStore', () => () => ({ ...loaded, archetypes: [{ id: 4, name: 'Mono Red' }], loadByEventId: vi.fn() }));
mockNuxtImport('useEventStore', () => () => ({ event: { id: 1, game: 'mtg' }, $reset: vi.fn() }));

// ── Controls, each found by the label of the form field around it ──

const FIELD_LABEL = Symbol('form-field-label');
const clearers = new Map<string, () => void>();

const UFormFieldStub = defineComponent({
	props: { label: { type: String, required: false } },
	setup(props, { slots }) {
		provide(FIELD_LABEL, () => props.label);
		return () => h('div', slots.default?.());
	},
});

/** A control an operator clears: a text input emptied, or a select put back on its placeholder. */
function clearableStub(cleared: unknown) {
	return defineComponent({
		inheritAttrs: false,
		props: { modelValue: { type: null, required: false } },
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

async function mountEditor(editor: string) {
	const { default: Settings } = await import(`../../../../../app/components/Screen/Modes/${editor}/Settings.vue`);
	const wrapper = mount(Settings, {
		props: { screen: { id: 1 } as Screen, eventId: 1 },
		global: {
			stubs: {
				ScreenSettingsCard: defineComponent({ setup: (_, { slots }) => () => h('section', slots.default?.()) }),
				ScreenSettingsToggle: true,
				ScreenColumnConfigEditor: true,
				ScreenColumnVisibilityList: true,
				ScreenRotationSettings: true,
				UFormField: UFormFieldStub,
				UInput: clearableStub(''),
				USelect: clearableStub(null),
				USelectMenu: clearableStub(null),
				UInputNumber: true,
				USwitch: true,
				UButton: true,
				USeparator: true,
				UIcon: true,
				UBadge: true,
			},
		},
	});
	mounted = wrapper;
	await flushPromises();
	return wrapper;
}

type ClearableField = [label: string, field: string, storedValue: unknown];

describe.each<[string, ScreenMode, Record<string, unknown>, ClearableField[]]>([
	['Metagame', 'metagame', { viewMode: 'cards', scope: 'playerList' }, [
		['Archetype filter', 'archetypeFilter', 'Rakdos Midrange'],
		['Custom header text', 'headerText', 'Day 2 Metagame'],
		['Select list', 'playerListId', 7],
	]],
	['TopCards', 'top-cards', { scope: 'playerList' }, [
		['Archetype filter', 'archetypeFilter', 'Azorius Control'],
		['Custom header text', 'headerText', 'Top Cards'],
		['Select list', 'playerListId', 7],
	]],
	['Standings', 'standings', { viewMode: 'watchlist' }, [
		['Custom header text', 'headerText', 'Final Standings'],
		['Select list', 'playerListId', 7],
	]],
	['PlayerHistory', 'player-history', {}, [
		['Custom header text', 'headerText', 'Match History'],
		['Player', 'playerId', 5],
	]],
	['Pairings', 'pairings', {}, [
		['Custom header text', 'headerText', 'Top Tables'],
		['Round', 'roundId', 31],
	]],
	['ArchetypeSpotlight', 'archetype-spotlight', { scope: 'playerList' }, [
		['Custom header text', 'headerText', 'Deck to Beat'],
		['Archetype', 'archetypeId', 4],
		['Select list', 'playerListId', 7],
	]],
])('the %s settings editor', (editor, mode, variant, fields) => {
	beforeEach(() => {
		writes.length = 0;
		clearers.clear();
	});

	it.each(fields)('writes a cleared "%s" as the null that deletes %s', async (label, field, storedValue) => {
		config.value = { ...getDefaultConfigForMode(mode), showHeader: true, ...variant, [field]: storedValue };
		await mountEditor(editor);

		const clear = clearers.get(label);
		expect(clear, `no "${label}" control rendered`).toBeDefined();
		clear!();

		expect(writes.at(-1)).toHaveProperty(field, null);
	});
});
