/**
 * A Screen's Theme Token rows on its settings page: the Event's Theme read and
 * the Screen Theme Override write faked at the network, a Screen seeded in the
 * real stores, the page's one Screen Theme Override instance over a card, and
 * a settings card showing whether it starts open.
 */
import type { Mock } from 'vitest';
import type { Component, VNodeChild } from 'vue';
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { ScreenMode } from '~~/shared/types/enums';
import type { ThemeResponse } from '~~/shared/types/theme';
import type { Screen } from '~/types';
import { defineComponent } from 'vue';
import { createWireMockScreen } from '~~/test/helpers/fixtures';
import { provideScreenThemeOverrides } from '~/composables/screen/useScreenThemeOverrides';
import { useEventStore } from '~/stores/event';
import { useScreenStore } from '~/stores/screen';

const THEME_PATH = '/api/themes/brand';
export const OVERRIDES_PATH = '/api/events/1/screens/1/theme-overrides';

interface OverrideWrite {
	tokens: Record<string, unknown>;
	stateVersion: number;
}

/** What the faked network answers; a test may replace either before acting. */
export interface ScreenThemeNetwork {
	/** What the Event's Theme, "Brand", stores. */
	themeTokens: StoredThemeTokens;
	/** The Screen an override write answers with, by default one holding what the write set and nothing it cleared. */
	answerWrite: (write: OverrideWrite) => Promise<Screen> | Screen;
}

function appliedWrite(mode: ScreenMode) {
	return ({ tokens, stateVersion }: OverrideWrite) => createWireMockScreen({
		id: 1,
		currentMode: mode,
		themeOverrides: Object.fromEntries(Object.entries(tokens).filter(([, value]) => value !== null)),
		stateVersion: stateVersion + 1,
	}) as unknown as Screen;
}

/** Route `fetch` (the test's `$fetch` mock) to the Theme read and the override write. */
export function fakeScreenThemeNetwork(fetch: Mock, mode: ScreenMode = 'standings'): ScreenThemeNetwork {
	const network: ScreenThemeNetwork = {
		themeTokens: {},
		answerWrite: appliedWrite(mode),
	};
	fetch.mockReset();
	fetch.mockImplementation(async (url: string, init?: { method?: string; body?: any }) => {
		if (url === THEME_PATH) {
			return {
				id: 'brand',
				name: 'Brand',
				tokens: network.themeTokens,
				revision: 1,
				createdAt: new Date(0),
				updatedAt: new Date(0),
			} satisfies ThemeResponse;
		}
		if (url === OVERRIDES_PATH && init?.method === 'PATCH')
			return network.answerWrite(init.body);
		throw new Error(`Unexpected request ${url}`);
	});
	return network;
}

/** Seed Event 1, using the "Brand" Theme, and its Screen 1 in `mode`; answers that Screen as the store holds it. */
export function seedThemedScreen(mode: ScreenMode, themeOverrides: StoredThemeTokens = {}): () => Screen {
	const eventStore = useEventStore();
	eventStore.event = { id: 1, themeId: 'brand' } as never;
	eventStore.eventTheme = null;
	const screenStore = useScreenStore();
	screenStore.$reset();
	screenStore.currentEventId = 1;
	screenStore.screens = [
		createWireMockScreen({ id: 1, currentMode: mode, themeOverrides }) as unknown as Screen,
	];
	return () => screenStore.screens[0]!;
}

/**
 * A stand-in for the Screen's settings page: it holds the one Screen Theme
 * Override instance for `screen`, of Event 1, and renders `cards` under it.
 */
export function screenSettingsPage(screen: () => Screen | null, cards: () => VNodeChild): Component {
	return defineComponent({
		setup() {
			provideScreenThemeOverrides(screen, 1);
			return cards;
		},
	});
}

/** How many times the Event's Theme was read. */
export function themeReads(fetch: Mock): number {
	return fetch.mock.calls.filter(([url]) => url === THEME_PATH).length;
}

/** The token maps each override write sent, in order. */
export function overrideWrites(fetch: Mock): Array<Record<string, unknown>> {
	return fetch.mock.calls
		.filter(([url]) => url === OVERRIDES_PATH)
		.map(([, init]) => init.body.tokens);
}
