import type { VueWrapper } from '@vue/test-utils';
import type { ThemeResponse } from '~~/shared/types/theme';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { deferred } from '~~/test/helpers/deferred';
import { settleUntil } from '~~/test/helpers/settle';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';

// The Theme editor writes one token per edit and shows each token's state and
// inherited default; what a write stores is the Theme library's own test.

const { mockApiFetch } = vi.hoisted(() => ({
	mockApiFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockApiFetch);
mockNuxtImport('useRoute', () => () => ({
	params: { themeId: 'brand' },
}));

enableAutoUnmount(afterEach);

const TOKEN_PATH = '/api/themes/brand/tokens/';

function theme(revision: number, tokens: Record<string, unknown> = {}): ThemeResponse {
	return {
		id: 'brand',
		name: 'Brand',
		tokens,
		revision,
		createdAt: new Date(0),
		updatedAt: new Date(0),
	};
}

type Answer = (body: { value?: unknown } | undefined) => ThemeResponse | Promise<ThemeResponse>;
let answerWrite: Answer;

beforeEach(() => {
	mockApiFetch.mockReset();
	answerWrite = () => theme(2);
	mockApiFetch.mockImplementation(async (url: string, init?: { method?: string; body?: { value?: unknown } }) => {
		if (url === '/api/themes/brand' && !init?.method)
			return theme(1);
		return answerWrite(init?.body);
	});
});

const passthroughStub = defineComponent({ template: '<div><slot /></div>' });

async function mountEditor() {
	const { default: ThemeEditor } = await import('../../../../app/pages/themes/[themeId].vue');
	const wrapper = mount(ThemeEditor, {
		global: {
			stubs: {
				...nuxtUiStubs,
				NuxtLayout: passthroughStub,
				NuxtLink: passthroughStub,
				ScreenAnimationEffectPresetLibrary: true,
			},
		},
		// Attached, so the preview's painted style can be read back.
		attachTo: document.body,
	});
	await flushPromises();
	return wrapper;
}

const field = (wrapper: VueWrapper, token: string) => wrapper.get(`[data-token="${token}"]`);
const part = (wrapper: VueWrapper, token: string, name: string) => field(wrapper, token).get(`[data-token-part="${name}"]`);

async function commit(wrapper: VueWrapper, token: string, name: string, value: string) {
	const input = part(wrapper, token, name);
	(input.element as HTMLInputElement).value = value;
	await input.trigger('change');
	await flushPromises();
}

function writes() {
	return mockApiFetch.mock.calls
		.filter(([url]) => String(url).startsWith(TOKEN_PATH))
		.map(([url, init]) => [
			init?.method,
			String(url).slice(TOKEN_PATH.length),
			init?.body,
		]);
}

describe('the Theme editor', () => {
	it.each([
		['a Foundation colour', 'accent', 'Default: #0077a3'],
		['a Foundation dimension', 'inset', 'Default: 0px'],
		['a Mode Token following a Foundation Token', 'standings.row-divider', 'Default: follows Divider'],
		['the background', 'background', 'Default: no layers'],
		['the Animation Effect', 'animation-effect', 'Default: Fog'],
	])('shows %s inheriting its default', async (_case, token, inherited) => {
		const wrapper = await mountEditor();

		expect(field(wrapper, token).attributes('data-token-state')).toBe('inherited');
		expect(field(wrapper, token).get('[data-token-inherited]').text()).toBe(inherited);
	});

	it.each([
		[
			'a colour',
			'accent',
			'colour',
			'#ff0000',
			'#ff0000',
		],
		[
			'a colour\'s opacity',
			'accent',
			'opacity',
			'50',
			'rgba(0, 119, 163, 0.5)',
		],
		[
			'a Mode Token\'s own colour, keeping the opacity it follows',
			'standings.row-divider',
			'colour',
			'#00ff00',
			'rgba(0, 255, 0, 0.12)',
		],
	])('writes %s as one token, and shows it set once the write lands', async (_case, token, name, entered, value) => {
		answerWrite = () => theme(2, { [token]: value });
		const wrapper = await mountEditor();

		await commit(wrapper, token, name, entered);

		expect(writes()).toEqual([
			[
				'PUT',
				token,
				{ value },
			],
		]);
		expect(field(wrapper, token).attributes('data-token-state')).toBe('set');
	});

	it('repaints its preview once a write lands', async () => {
		answerWrite = () => theme(2, { 'standings.surface': 'rgb(0, 255, 0)' });
		const wrapper = await mountEditor();
		await settleUntil(() => wrapper.find('.standings-table').exists());

		await commit(wrapper, 'standings.surface', 'colour', '#00ff00');

		expect(getComputedStyle(wrapper.get('.standings-table').element).backgroundColor).toBe('rgb(0, 255, 0)');
	});

	it('points a Mode Token at another Foundation Token of its type', async () => {
		const wrapper = await mountEditor();

		await part(wrapper, 'standings.row-divider', 'source').setValue('accent');
		await flushPromises();

		expect(writes()).toEqual([
			[
				'PUT',
				'standings.row-divider',
				{
					value: { token: 'accent' },
				},
			],
		]);
	});

	it('resets a set token by clearing it', async () => {
		mockApiFetch.mockImplementation(async (url: string, init?: { method?: string }) => init?.method
			? theme(3)
			: theme(2, { accent: '#ff0000' }));
		const wrapper = await mountEditor();
		expect(field(wrapper, 'accent').attributes('data-token-state')).toBe('set');

		await field(wrapper, 'accent').findAll('button').find(button => button.text() === 'Reset')!.trigger('click');
		await flushPromises();

		expect(writes()).toEqual([
			['DELETE', 'accent', undefined],
		]);
		expect(field(wrapper, 'accent').attributes('data-token-state')).toBe('inherited');
	});

	it('keeps a newer write\'s Theme when an older write answers after it', async () => {
		const older = deferred<ThemeResponse>();
		const answers = [
			() => older.promise,
			() => theme(3, { 'accent': '#ff0000', 'standings.surface': '#000000' }),
		];
		answerWrite = () => answers.shift()!();
		const wrapper = await mountEditor();

		await commit(wrapper, 'accent', 'colour', '#ff0000');
		await commit(wrapper, 'standings.surface', 'colour', '#000000');
		older.resolve(theme(2, { accent: '#ff0000' }));
		await flushPromises();

		expect(field(wrapper, 'standings.surface').attributes('data-token-state')).toBe('set');
	});

	it('writes the background once its edits pause, as the whole stack', async () => {
		answerWrite = body => theme(2, { background: body?.value });
		const wrapper = await mountEditor();
		const addLayer = () => part(wrapper, 'background', 'background-layers').get('[data-testid="add-layer"]').trigger('click');

		await addLayer();
		await addLayer();
		expect(part(wrapper, 'background', 'background-layers').findAll('[data-testid="background-layer-row"]')).toHaveLength(2);
		expect(writes()).toEqual([]);

		const colorLayer = {
			id: expect.any(String),
			type: 'color',
			color: '#000000',
			enabled: true,
			opacity: 1,
		};
		await vi.waitFor(() => expect(writes()).toEqual([
			[
				'PUT',
				'background',
				{
					value: [colorLayer, colorLayer],
				},
			],
		]));
		await flushPromises();
		expect(field(wrapper, 'background').attributes('data-token-state')).toBe('set');
	});

	it('offers a Theme\'s media layers a Remote Media URL only', async () => {
		const wrapper = await mountEditor();
		const editor = part(wrapper, 'background', 'background-layers');

		await editor.get('[data-testid="add-layer-type"] select').setValue('image');
		await editor.get('[data-testid="add-layer"]').trigger('click');

		const sourceKinds = editor.get('[data-testid="background-layer-row"]').findAll('option').map(option => option.text());
		expect(sourceKinds).toContain('Remote URL');
		expect(sourceKinds).not.toContain('Asset library');
	});

	it('writes the Animation Effect an operator picks', async () => {
		const wrapper = await mountEditor();

		expect(field(wrapper, 'animation-effect').findComponent({ name: 'ScreenAnimationEffectPresetLibrary' }).exists()).toBe(false);
		await part(wrapper, 'animation-effect', 'animation-effect').get('select').setValue('caustics');

		await vi.waitFor(() => expect(writes()).toEqual([
			[
				'PUT',
				'animation-effect',
				{
					value: { effect: 'caustics' },
				},
			],
		]));
	});
});
