import type { VueWrapper } from '@vue/test-utils';
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { ScreenMode } from '~~/shared/types/enums';
import type { ThemeResponse } from '~~/shared/types/theme';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';
import { screenModeTokenName } from '~~/shared/screenModes';
import { standingsModeTokens } from '~~/shared/screenModeTokens/standings';
import { deferred } from '~~/test/helpers/deferred';
import { createWireMockScreen } from '~~/test/helpers/fixtures';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ThemeTokensSettings from '~/components/Screen/ThemeTokensSettings.vue';

// A Screen's token section lists exactly what its mode consumes, says what each
// token inherits from the Event's Theme, and writes one override per edit.

const { mockApiFetch } = vi.hoisted(() => ({
	mockApiFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockApiFetch);

enableAutoUnmount(afterEach);

const OVERRIDES_PATH = '/api/events/1/screens/1/theme-overrides';

function theme(tokens: StoredThemeTokens): ThemeResponse {
	return {
		id: 'brand',
		name: 'Brand',
		tokens,
		revision: 1,
		createdAt: new Date(0),
		updatedAt: new Date(0),
	};
}

let themeTokens: StoredThemeTokens;
let answerWrite: (body: { tokens: Record<string, unknown>; stateVersion: number }) => Promise<Screen> | Screen;

beforeEach(() => {
	themeTokens = {};
	answerWrite = ({ tokens, stateVersion }) => createWireMockScreen({
		id: 1,
		currentMode: 'standings',
		themeOverrides: tokens,
		stateVersion: stateVersion + 1,
	}) as unknown as Screen;
	mockApiFetch.mockReset();
	mockApiFetch.mockImplementation(async (url: string, init?: { method?: string; body?: any }) => {
		if (url === '/api/themes/brand')
			return theme(themeTokens);
		if (url === OVERRIDES_PATH && init?.method === 'PATCH')
			return answerWrite(init.body);
		throw new Error(`Unexpected request ${url}`);
	});
});

async function mountSection(mode: ScreenMode, themeOverrides: StoredThemeTokens = {}) {
	const eventStore = useEventStore();
	eventStore.event = { id: 1, themeId: 'brand' } as never;
	const screenStore = useScreenStore();
	screenStore.$reset();
	screenStore.currentEventId = 1;
	screenStore.screens = [
		createWireMockScreen({ id: 1, currentMode: mode, themeOverrides }) as unknown as Screen,
	];
	const Host = defineComponent(() => () => h(ThemeTokensSettings, { screen: screenStore.screens[0]!, eventId: 1 }));
	const wrapper = mount(Host, {
		global: { stubs: nuxtUiStubs },
	});
	await flushPromises();
	return wrapper;
}

const field = (wrapper: VueWrapper, token: string) => wrapper.get(`[data-token="${token}"]`);

async function commitColour(wrapper: VueWrapper, token: string, value: string) {
	const input = field(wrapper, token).get('[data-token-part="colour"]');
	(input.element as HTMLInputElement).value = value;
	await input.trigger('change');
}

function writes() {
	return mockApiFetch.mock.calls
		.filter(([url]) => url === OVERRIDES_PATH)
		.map(([, init]) => init.body.tokens);
}

describe('a Screen\'s token section', () => {
	it('lists exactly the Mode Tokens of its mode, the Foundation Tokens their defaults name, and those its host consumes', async () => {
		const declared = Object.entries(standingsModeTokens);
		const named = new Set(declared.map(([, definition]) => definition.default.token));

		const wrapper = await mountSection('standings');

		expect(wrapper.findAll('[data-token]').map(row => row.attributes('data-token')).sort()).toEqual([
			...declared.map(([token]) => screenModeTokenName('standings', token)),
			...Object.keys(FOUNDATION_TOKENS).filter(name => named.has(name as typeof declared[number][1]['default']['token'])),
			// The Screen inset and alignment, by which a plain mode's host places it.
			'inset',
			'alignment',
		].sort());
	});

	it('shows nothing for a mode that consumes no Theme Token', async () => {
		const wrapper = await mountSection('broadcast-graphics');

		expect(wrapper.find('[data-testid="screen-theme-tokens"]').exists()).toBe(false);
	});

	it.each([
		[
			'a Foundation Token the Theme leaves unset',
			{},
			'divider',
			`Theme: ${FOUNDATION_TOKENS.divider.default}`,
		],
		[
			'a Foundation Token the Theme sets',
			{ divider: '#123456' },
			'divider',
			'Theme: #123456',
		],
		[
			'a Mode Token following its default',
			{},
			'standings.row-divider',
			'Theme: follows Divider',
		],
		[
			'a Mode Token the Theme points elsewhere',
			{
				'standings.row-divider': { token: 'accent' },
			},
			'standings.row-divider',
			'Theme: follows Accent',
		],
	])('shows %s inheriting the Theme\'s value', async (_case, tokens, token, inherited) => {
		themeTokens = tokens;
		const wrapper = await mountSection('standings');

		expect(field(wrapper, token).attributes('data-token-state')).toBe('inherited');
		expect(field(wrapper, token).get('[data-token-inherited]').text()).toBe(inherited);
	});

	it('writes one override per edit, and shows it overridden while the write is out', async () => {
		const answer = deferred<Screen>();
		answerWrite = () => answer.promise;
		const wrapper = await mountSection('standings');

		await commitColour(wrapper, 'divider', '#ff0000');
		await flushPromises();

		expect(writes()).toEqual([
			{ divider: 'rgba(255, 0, 0, 0.12)' },
		]);
		expect(field(wrapper, 'divider').attributes('data-token-state')).toBe('set');

		answer.resolve(createWireMockScreen({
			id: 1,
			currentMode: 'standings',
			themeOverrides: { divider: 'rgba(255, 0, 0, 0.12)' },
			stateVersion: 1,
		}) as unknown as Screen);
		await flushPromises();
		expect(field(wrapper, 'divider').attributes('data-token-state')).toBe('set');
	});

	it('clears an override as a null, and shows the Theme\'s value again while the write is out', async () => {
		const answer = deferred<Screen>();
		answerWrite = () => answer.promise;
		const wrapper = await mountSection('standings', { divider: '#ff0000' });
		expect(field(wrapper, 'divider').attributes('data-token-state')).toBe('set');

		await field(wrapper, 'divider').findAll('button').find(button => button.text() === 'Clear')!.trigger('click');
		await flushPromises();

		expect(writes()).toEqual([
			{ divider: null },
		]);
		expect(field(wrapper, 'divider').attributes('data-token-state')).toBe('inherited');
		answer.resolve(createWireMockScreen({
			id: 1,
			currentMode: 'standings',
			themeOverrides: {},
			stateVersion: 1,
		}) as unknown as Screen);
		await flushPromises();
	});
});
