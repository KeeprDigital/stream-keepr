import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { ScreenGraphicAssetReference } from '~~/shared/utils/graphicsAssetReferences';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { deferred } from '~~/test/helpers/deferred';
import { testGraphicAssetReference } from '~~/test/helpers/graphicsAssetIdentities';
import { useGraphicAssetFontFaces } from '~/composables/screen/useGraphicAssetFontFaces';

/**
 * Loads a graphics Screen Output's library fonts, holding the output not-ready
 * until they are and leaving a settled output alone through edits that name no
 * different font (#160). The hosts' own suites keep one wiring test each.
 */

const family = (revisionId: string) => `stream-keepr-graphic-asset-font-asset-${revisionId}`;

function font(revisionId: string, ownerSlot = 'item'): ScreenGraphicAssetReference {
	return {
		kind: 'font',
		ownerSlot,
		reference: testGraphicAssetReference('font-asset', revisionId),
	};
}

function image(revisionId: string): ScreenGraphicAssetReference {
	return {
		kind: 'image',
		ownerSlot: 'frame',
		reference: testGraphicAssetReference('image-asset', revisionId),
	};
}

const contentUrl = (reference: GraphicAssetReference) => `/private-assets/${reference.assetId}/${reference.revisionId}`;

/** Every `FontFace` constructed, with a load each test can hold open or fail. */
let constructed: Array<{ family: string; source: string }>;
let loadFor: (family: string) => Promise<unknown>;
let documentFonts: { add: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn>; load: ReturnType<typeof vi.fn>; check: ReturnType<typeof vi.fn>; ready: Promise<void> };

beforeEach(() => {
	constructed = [];
	loadFor = async () => undefined;
	vi.stubGlobal('FontFace', class {
		constructor(public family: string, public source: string) {
			constructed.push({ family, source });
		}

		load() {
			return loadFor(this.family).then(() => this);
		}
	});
	documentFonts = {
		add: vi.fn(),
		delete: vi.fn(),
		load: vi.fn().mockResolvedValue([]),
		check: vi.fn().mockReturnValue(true),
		ready: Promise.resolve(),
	};
	Object.defineProperty(document, 'fonts', { configurable: true, value: documentFonts });
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function mountFonts(initial: ScreenGraphicAssetReference[], settled = true) {
	const references = ref(initial);
	const contentUrlsSettled = ref(settled);
	let fonts!: ReturnType<typeof useGraphicAssetFontFaces>;
	const wrapper = mount(defineComponent({
		setup() {
			fonts = useGraphicAssetFontFaces(references, contentUrl, contentUrlsSettled);
			return () => null;
		},
	}));
	return {
		wrapper,
		references,
		contentUrlsSettled,
		fonts,
	};
}

async function settle() {
	await flushPromises();
	await nextTick();
}

describe('useGraphicAssetFontFaces', () => {
	it('is ready at once for an output naming no library font', () => {
		const { fonts } = mountFonts([
			image('image-revision-1'),
		]);

		expect(fonts.fontsReady.value).toBe(true);
		expect(constructed).toEqual([]);
	});

	it('loads each family once, from its exact content URL, and is not ready until it has', async () => {
		const load = deferred();
		loadFor = () => load.promise;
		const { fonts } = mountFonts([
			font('font-revision-2'),
			font('font-revision-2', 'other-item'),
		]);
		await nextTick();

		expect(fonts.fontsReady.value).toBe(false);
		expect(constructed).toEqual([
			{
				family: family('font-revision-2'),
				source: 'url("/private-assets/font-asset/font-revision-2")',
			},
		]);
		expect(fonts.fontSources.value).toEqual([
			{
				family: family('font-revision-2'),
				url: '/private-assets/font-asset/font-revision-2',
			},
		]);

		load.resolve();
		await settle();

		expect(fonts.fontsReady.value).toBe(true);
		expect(fonts.fontsFailed.value).toBe(false);
	});

	// An unsettled URL is the empty string, which would be a failure rather than a wait.
	it('loads nothing until the content URLs have settled', async () => {
		const { fonts, contentUrlsSettled } = mountFonts([
			font('font-revision-2'),
		], false);
		await settle();

		expect(constructed).toEqual([]);
		expect(fonts.fontsReady.value).toBe(false);

		contentUrlsSettled.value = true;
		await settle();

		expect(constructed).toHaveLength(1);
		expect(fonts.fontsReady.value).toBe(true);
	});

	it('reports a font that cannot load, taking its face back off the document', async () => {
		loadFor = async () => {
			throw new Error('unavailable');
		};
		const { fonts } = mountFonts([
			font('font-revision-2'),
		]);
		await settle();

		expect(fonts.fontsFailed.value).toBe(true);
		expect(fonts.fontsReady.value).toBe(false);
		expect(documentFonts.delete).toHaveBeenCalledOnce();
	});

	// Hiding means "this font has not loaded yet"; blanking a settled output for an
	// edit no font depends on is the blank on air the hiding exists to prevent (#160).
	it('leaves a settled output alone when the references change but the fonts do not', async () => {
		const { fonts, references } = mountFonts([
			font('font-revision-2'),
		]);
		await settle();

		references.value = [
			font('font-revision-2'),
			image('image-revision-1'),
		];
		await nextTick();
		expect(fonts.fontsReady.value).toBe(true);
		await settle();

		expect(constructed).toHaveLength(1);
		expect(documentFonts.delete).not.toHaveBeenCalled();
	});

	// A new asset of any kind sends the content URLs through an unsettled round trip.
	it('sits through an unsettled window that leaves the fonts unchanged', async () => {
		const { fonts, references, contentUrlsSettled } = mountFonts([
			font('font-revision-2'),
		]);
		await settle();

		references.value = [
			font('font-revision-2'),
			image('image-revision-1'),
		];
		contentUrlsSettled.value = false;
		await nextTick();
		expect(fonts.fontsReady.value).toBe(true);

		contentUrlsSettled.value = true;
		await settle();

		expect(fonts.fontsReady.value).toBe(true);
		expect(constructed).toHaveLength(1);
	});

	it('hides again for a different pinned revision, loading it and discarding the old face', async () => {
		const { fonts, references } = mountFonts([
			font('font-revision-2'),
		]);
		await settle();
		const load = deferred();
		loadFor = () => load.promise;

		references.value = [
			font('font-revision-3'),
		];
		await nextTick();
		expect(fonts.fontsReady.value).toBe(false);
		expect(documentFonts.delete).toHaveBeenCalledOnce();

		load.resolve();
		await settle();

		expect(fonts.fontsReady.value).toBe(true);
		expect(constructed.map(face => face.family)).toEqual([
			family('font-revision-2'),
			family('font-revision-3'),
		]);
	});

	it('discards a load a newer requirement superseded', async () => {
		const first = deferred();
		loadFor = name => name === family('font-revision-2')
			? first.promise
			: Promise.resolve();
		const { fonts, references } = mountFonts([
			font('font-revision-2'),
		]);
		await nextTick();

		references.value = [
			font('font-revision-3'),
		];
		await settle();
		expect(fonts.fontsReady.value).toBe(true);

		first.resolve();
		await settle();

		expect(fonts.fontsReady.value).toBe(true);
		expect(fonts.fontsFailed.value).toBe(false);
		expect(documentFonts.add).toHaveBeenCalledTimes(2);
		expect(documentFonts.delete).toHaveBeenCalled();
	});

	it('takes its faces off the document when its host unmounts', async () => {
		const { wrapper } = mountFonts([
			font('font-revision-2'),
		]);
		await settle();

		wrapper.unmount();

		expect(documentFonts.delete).toHaveBeenCalledOnce();
	});
});
