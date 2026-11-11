import type { VueWrapper } from '@vue/test-utils';
import type { ThemeResponse } from '~~/shared/types/theme';
import type { ColorPickerPart } from '~~/test/nuxt/helpers/colorPicker';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { deferred } from '~~/test/helpers/deferred';
import { settleUntil } from '~~/test/helpers/settle';
import { editColorPicker } from '~~/test/nuxt/helpers/colorPicker';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { THEME_TOKEN_DRAFT_COMMIT_MS } from '~/modules/theme-editor/draft';
import ThemeEditor from '~/pages/themes/[themeId].vue';

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

afterEach(() => {
	vi.useRealTimers();
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

/**
 * The editor, with its preview gallery stubbed unless `preview`: the gallery
 * renders every themed Screen Mode and has its own test, so one wiring test here mounts it.
 */
async function mountEditor({ preview = false } = {}) {
	const wrapper = mount(ThemeEditor, {
		global: {
			stubs: {
				...nuxtUiStubs,
				NuxtLayout: passthroughStub,
				NuxtLink: passthroughStub,
				GraphicsAssetFocusPicker: FocusPickerStub,
				...(preview
					? {}
					: { ThemePreviewGallery: true }),
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

/** A colour token commits once its picker closes. */
async function commitColour(wrapper: VueWrapper, token: string, control: ColorPickerPart, value: string) {
	await editColorPicker(field(wrapper, token), '[data-token-part="colour"]', control, value);
	await flushPromises();
}

/** A composite token's editor commits once its edits pause; the pause runs on a fake clock. */
function fakeDraftClock() {
	vi.useFakeTimers({
		toFake: ['setTimeout', 'clearTimeout'],
	});
}

async function pauseEdits() {
	await vi.advanceTimersByTimeAsync(THEME_TOKEN_DRAFT_COMMIT_MS);
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
			'hue',
			'#ff0000',
			'#ff0000',
		],
		[
			'a colour\'s alpha',
			'accent',
			'alpha',
			'50',
			'rgba(0, 119, 163, 0.5)',
		],
		[
			'a Mode Token\'s own colour, keeping the alpha it follows',
			'standings.row-divider',
			'hue',
			'#00ff00',
			'rgba(0, 255, 0, 0.12)',
		],
	] as const)('writes %s as one token, and shows it set once the write lands', async (_case, token, control, entered, value) => {
		answerWrite = () => theme(2, { [token]: value });
		const wrapper = await mountEditor();

		await commitColour(wrapper, token, control, entered);

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
		const wrapper = await mountEditor({ preview: true });
		await settleUntil(() => wrapper.find('.standings-table').exists());

		await commitColour(wrapper, 'standings.surface', 'hue', '#00ff00');

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

		await commitColour(wrapper, 'accent', 'hue', '#ff0000');
		await commitColour(wrapper, 'standings.surface', 'hue', '#111111');
		older.resolve(theme(2, { accent: '#ff0000' }));
		await flushPromises();

		expect(field(wrapper, 'standings.surface').attributes('data-token-state')).toBe('set');
	});

	it('writes the background once its edits pause, as the whole stack', async () => {
		answerWrite = body => theme(2, { background: body?.value });
		const wrapper = await mountEditor();
		fakeDraftClock();
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
		await pauseEdits();
		expect(writes()).toEqual([
			[
				'PUT',
				'background',
				{
					value: [colorLayer, colorLayer],
				},
			],
		]);
		expect(field(wrapper, 'background').attributes('data-token-state')).toBe('set');
	});

	// A value stored before writes were literal-only may name another token, and a
	// shipped default still does: the editor edits it resolved, so the next edit
	// writes literals.
	it.each([
		{
			case: 'a stored background colour layer naming the accent',
			token: 'background',
			stored: [
				{
					id: 'wash',
					type: 'color',
					color: { token: 'accent' },
					enabled: true,
					opacity: 1,
				},
			],
			edit: (wrapper: VueWrapper) => part(wrapper, 'background', 'background-layers').get('[data-testid="add-layer"]').trigger('click'),
			written: [
				{
					id: 'wash',
					type: 'color',
					color: '#aa0000',
					enabled: true,
					opacity: 1,
				},
				{
					id: expect.any(String),
					type: 'color',
					color: '#000000',
					enabled: true,
					opacity: 1,
				},
			],
		},
		{
			case: 'a stored surface whose fill and outline name colour tokens',
			token: 'panel',
			stored: {
				fill: {
					type: 'solid',
					color: { token: 'accent' },
				},
				fillOpacity: 0.5,
				outline: {
					color: { token: 'text-primary' },
					width: 2,
				},
			},
			edit: (wrapper: VueWrapper) => field(wrapper, 'panel').get('[data-testid="theme-surface-outline"]').trigger('click'),
			written: {
				fill: { type: 'solid', color: '#aa0000' },
				fillOpacity: 0.5,
			},
		},
		{
			case: 'an unset fill, whose default names the accent',
			token: 'accent-fill',
			stored: undefined,
			edit: (wrapper: VueWrapper) => field(wrapper, 'accent-fill').get('[data-testid="theme-fill-kind"]').setValue('linear-gradient'),
			written: {
				type: 'linear-gradient',
				angle: expect.any(Number),
				stops: [
					expect.objectContaining({ color: '#aa0000' }),
					expect.objectContaining({ color: 'rgba(255, 255, 255, 0.06)' }),
				],
			},
		},
	])('writes $case back as literals on its next edit', async ({ token, stored, edit, written }) => {
		storedTokens = {
			accent: '#aa0000',
			...(stored === undefined
				? {}
				: { [token]: stored }),
		};
		const wrapper = await mountEditor();
		fakeDraftClock();

		await edit(wrapper);
		await pauseEdits();

		expect(writes()).toEqual([
			[
				'PUT',
				token,
				{ value: written },
			],
		]);
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
		fakeDraftClock();

		await pick(wrapper);
		await pauseEdits();

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
		fakeDraftClock();

		await part(wrapper, 'animation-effect', 'animation-effect').get('select').setValue('caustics');
		await pauseEdits();

		expect(writes()).toEqual([
			[
				'PUT',
				'animation-effect',
				{
					value: { effect: 'caustics' },
				},
			],
		]);
	});

	// Each field writes the token whole, so a later edit carries the earlier
	// one and waits for its answer; edits made meanwhile are sent as one.
	it('builds a second edit on the first while its write is out, and sends it once that answers', async () => {
		const first = deferred<ThemeResponse>();
		const answers: Answer[] = [
			() => first.promise,
			body => theme(3, { heading: body?.value }),
		];
		answerWrite = body => answers.shift()!(body);
		const wrapper = await mountEditor();
		fakeDraftClock();

		await part(wrapper, 'heading', 'weight').setValue('400');
		await pauseEdits();
		await part(wrapper, 'heading', 'case').setValue('lowercase');
		await pauseEdits();
		await part(wrapper, 'heading', 'case').setValue('capitalize');
		await pauseEdits();

		expect(writes().map(([, , body]) => body.value)).toEqual([
			expect.objectContaining({ weight: 400, case: 'uppercase' }),
		]);
		expect((part(wrapper, 'heading', 'weight').element as unknown as HTMLSelectElement).value).toBe('400');

		first.resolve(theme(2, { heading: writes()[0]![2].value }));
		await flushPromises();

		expect(writes().map(([, , body]) => body.value)).toEqual([
			expect.objectContaining({ weight: 400, case: 'uppercase' }),
			expect.objectContaining({ weight: 400, case: 'capitalize' }),
		]);
		expect(field(wrapper, 'heading').attributes('data-token-state')).toBe('set');
	});

	it('writes a composite token once for edits made in steps', async () => {
		const wrapper = await mountEditor();
		fakeDraftClock();

		await part(wrapper, 'heading', 'case').setValue('lowercase');
		await part(wrapper, 'heading', 'weight').setValue('400');
		await pauseEdits();

		expect(writes().map(([, , body]) => body.value)).toEqual([
			expect.objectContaining({ weight: 400, case: 'lowercase' }),
		]);
	});

	it('leaves a token reset when an edit to it was still waiting', async () => {
		storedTokens = {
			'animation-effect': { effect: 'caustics' },
		};
		answerWrite = () => theme(2);
		const wrapper = await mountEditor();
		fakeDraftClock();

		await part(wrapper, 'animation-effect', 'animation-effect').get('select').setValue('fog');
		await field(wrapper, 'animation-effect').findAll('button').find(button => button.text() === 'Reset')!.trigger('click');
		await pauseEdits();

		expect(writes()).toEqual([
			['DELETE', 'animation-effect', undefined],
		]);
	});

	it('shows the stored value again once a write is refused', async () => {
		answerWrite = () => Promise.reject(Object.assign(new Error('Refused'), { statusCode: 422 }));
		const wrapper = await mountEditor();
		const horizontal = () => (part(wrapper, 'alignment', 'horizontal').element as unknown as HTMLSelectElement).value;

		await part(wrapper, 'alignment', 'horizontal').setValue('left');
		await flushPromises();

		expect(writes()).toHaveLength(1);
		expect(horizontal()).toBe('center');
	});
});
