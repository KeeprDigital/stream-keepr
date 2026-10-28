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
/** What the Theme stores when the editor opens. */
let storedTokens: Record<string, unknown>;

beforeEach(() => {
	mockApiFetch.mockReset();
	answerWrite = () => theme(2);
	storedTokens = {};
	mockApiFetch.mockImplementation(async (url: string, init?: { method?: string; body?: { value?: unknown } }) => {
		if (url === '/api/themes/brand' && !init?.method)
			return theme(1, storedTokens);
		// The preview's Deck tile looks its sample cards up on Scryfall; none is found.
		if (!url.startsWith('/api/themes/brand'))
			throw Object.assign(new Error('Not Found'), { statusCode: 404 });
		return answerWrite(init?.body);
	});
});

const passthroughStub = defineComponent({ template: '<div><slot /></div>' });

/** The library picker, pinning one revision of the first kind it was asked for on a click. */
const FocusPickerStub = defineComponent({
	name: 'GraphicsAssetFocusPicker',
	props: {
		assetKind: {
			type: [String, Array],
			default: 'image',
		},
		eventId: { type: Number, required: false },
	},
	emits: ['select', 'update:modelValue'],
	computed: {
		kinds(): string[] {
			return ([] as string[]).concat(this.assetKind as string | string[]);
		},
	},
	template: `<button
		type="button"
		data-testid="pick-asset"
		:data-asset-kinds="kinds.join()"
		:data-event-id="eventId ?? 'none'"
		@click="$emit('select', { kind: kinds[0] }, { assetId: 'asset-1', revisionId: 'revision-1' })"
	/>`,
});

async function mountEditor() {
	const { default: ThemeEditor } = await import('../../../../app/pages/themes/[themeId].vue');
	const wrapper = mount(ThemeEditor, {
		global: {
			stubs: {
				...nuxtUiStubs,
				NuxtLayout: passthroughStub,
				NuxtLink: passthroughStub,
				GraphicsAssetFocusPicker: FocusPickerStub,
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
		['the Screen alignment', 'alignment', 'Default: center center'],
		['a Mode Token following a Foundation Token', 'standings.row-divider', 'Default: follows Divider'],
		['the background', 'background', 'Default: no layers'],
		['the Animation Effect', 'animation-effect', 'Default: Fog'],
		['the logo', 'logo', 'Default: none'],
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

	it('writes the whole Screen alignment when one axis changes', async () => {
		const wrapper = await mountEditor();

		await part(wrapper, 'alignment', 'horizontal').setValue('left');
		await flushPromises();

		expect(writes()).toEqual([
			[
				'PUT',
				'alignment',
				{
					value: { horizontal: 'left', vertical: 'center' },
				},
			],
		]);
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

	// A background colour layer follows a colour Foundation Token or holds its own colour.
	it.each([
		{
			case: 'keeps a colour layer following a token through an edit to the stack',
			stored: { token: 'accent' },
			edit: (editor: ReturnType<typeof part>) => editor.get('[data-testid="add-layer"]').trigger('click'),
			written: [
				{ token: 'accent' },
				'#000000',
			],
		},
		{
			case: 'points a colour layer at a token',
			stored: '#123456',
			edit: (editor: ReturnType<typeof part>) => editor.get('[data-token-part="colour-source"]').setValue('token:accent'),
			written: [
				{ token: 'accent' },
			],
		},
	])('$case', async ({ stored, edit, written }) => {
		storedTokens = {
			background: [
				{
					id: 'wash',
					type: 'color',
					color: stored,
					enabled: true,
					opacity: 1,
				},
			],
		};
		const wrapper = await mountEditor();

		await edit(part(wrapper, 'background', 'background-layers'));

		await vi.waitFor(() => expect(writes()).toHaveLength(1));
		const [[, token, body]] = writes() as [[string, string, { value: Array<{ color: unknown }> }]];
		expect(token).toBe('background');
		expect(body.value.map(layer => layer.color)).toEqual(written);
	});

	it('offers a Theme\'s media layers the whole library', async () => {
		const wrapper = await mountEditor();
		const editor = part(wrapper, 'background', 'background-layers');

		await editor.get('[data-testid="add-layer-type"] select').setValue('image');
		await editor.get('[data-testid="add-layer"]').trigger('click');

		const source = editor.get('[data-testid="background-layer-row"]').findAll('select').find(select => select.findAll('option').some(option => option.text() === 'Asset library'))!;
		await source.setValue('asset');

		expect(editor.get('[data-testid="pick-asset"]').attributes('data-event-id')).toBe('none');
	});

	it.each([
		[
			'the logo, as an exact image revision',
			'logo',
			async (wrapper: VueWrapper) => {
				expect(part(wrapper, 'logo', 'asset').get('[data-testid="pick-asset"]').attributes('data-asset-kinds')).toBe('image,silent-video');
				await part(wrapper, 'logo', 'asset').get('[data-testid="pick-asset"]').trigger('click');
			},
			{ kind: 'image', assetId: 'asset-1', revisionId: 'revision-1' },
		],
		[
			'a library font for a typography token',
			'heading',
			async (wrapper: VueWrapper) => {
				await part(wrapper, 'heading', 'font').get('select').setValue('asset');
				await part(wrapper, 'heading', 'font').get('[data-testid="pick-asset"]').trigger('click');
			},
			{
				font: {
					kind: 'asset',
					reference: { assetId: 'asset-1', revisionId: 'revision-1' },
				},
				weight: 800,
				lineHeight: 1,
				tracking: 0.06,
				case: 'uppercase',
			},
		],
	])('writes %s the picker pins', async (_case, token, pick, value) => {
		const wrapper = await mountEditor();

		await pick(wrapper);
		await flushPromises();

		expect(writes()).toEqual([
			[
				'PUT',
				token,
				{ value },
			],
		]);
	});

	it('writes the Animation Effect an operator picks', async () => {
		const wrapper = await mountEditor();

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
