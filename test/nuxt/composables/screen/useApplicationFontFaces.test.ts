import type { ApplicationFontFaceRequest } from '~~/shared/modules/graphics/typography';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { deferred } from '~~/test/helpers/deferred';
import { stubDocumentFonts } from '~~/test/nuxt/helpers/fontFaces';
import { combineFontFaceStates, useApplicationFontFaces } from '~/composables/screen/useApplicationFontFaces';

/**
 * Holds a Screen Output not-ready until the application faces it paints have
 * loaded or failed, and leaves a settled output alone through an edit naming the
 * same faces (#160). The hosts' own suites keep one wiring test each.
 */

const POPPINS_BOLD: ApplicationFontFaceRequest = { fontId: 'poppins', weight: 700, style: 'normal' };
const INTER_LIGHT_ITALIC: ApplicationFontFaceRequest = { fontId: 'inter', weight: 300, style: 'italic' };
const SYSTEM_SANS: ApplicationFontFaceRequest = { fontId: 'system-sans', weight: 400, style: 'normal' };

const face = async () => [{}];

function mountFonts(requests: ApplicationFontFaceRequest[], load: (font: string) => Promise<unknown>) {
	const documentFonts = stubDocumentFonts(load);
	const source = ref(requests);
	let fonts!: ReturnType<typeof useApplicationFontFaces>;
	mount(defineComponent({
		setup() {
			fonts = useApplicationFontFaces(source);
			return () => null;
		},
	}));
	return { fonts, source, documentFonts };
}

async function settle() {
	await flushPromises();
	await nextTick();
}

describe('useApplicationFontFaces', () => {
	it.each([
		{
			row: 'pending',
			requests: [POPPINS_BOLD],
			load: () => deferred().promise,
			loads: ['normal 700 1em "Poppins"'],
			fontsReady: false,
			fontsFailed: false,
		},
		{
			row: 'loaded',
			requests: [INTER_LIGHT_ITALIC],
			load: face,
			loads: ['italic 300 1em "Inter"'],
			fontsReady: true,
			fontsFailed: false,
		},
		{
			row: 'failed',
			requests: [POPPINS_BOLD],
			load: async () => Promise.reject(new Error('blocked')),
			loads: ['normal 700 1em "Poppins"'],
			fontsReady: false,
			fontsFailed: true,
		},
		// No face for the family: it is not declared, so it paints the fallback.
		{
			row: 'empty',
			requests: [POPPINS_BOLD],
			load: async () => [],
			loads: ['normal 700 1em "Poppins"'],
			fontsReady: false,
			fontsFailed: true,
		},
		{
			row: 'system only',
			requests: [SYSTEM_SANS],
			load: face,
			loads: [],
			fontsReady: true,
			fontsFailed: false,
		},
		{
			row: 'duplicate',
			requests: [
				POPPINS_BOLD,
				{ ...POPPINS_BOLD },
			],
			load: face,
			loads: ['normal 700 1em "Poppins"'],
			fontsReady: true,
			fontsFailed: false,
		},
		// An edit naming the same faces must not blank a settled output, even for a tick.
		{
			row: 'same values',
			requests: [POPPINS_BOLD],
			replacement: [
				{ ...POPPINS_BOLD },
			],
			load: face,
			loads: ['normal 700 1em "Poppins"'],
			fontsReady: true,
			fontsFailed: false,
		},
	])('$row: loads $loads', async ({ requests, replacement, load, loads, fontsReady, fontsFailed }) => {
		const { fonts, source, documentFonts } = mountFonts(requests, load);
		await settle();
		if (replacement) {
			source.value = replacement;
			await nextTick();
			expect(fonts.fontsReady.value).toBe(fontsReady);
			await settle();
		}

		expect(documentFonts.load.mock.calls.map(([font]) => font)).toEqual(loads);
		expect({ fontsReady: fonts.fontsReady.value, fontsFailed: fonts.fontsFailed.value }).toEqual({ fontsReady, fontsFailed });
	});

	it('discards a load a newer set of requests superseded', async () => {
		const first = deferred<unknown>();
		const { fonts, source } = mountFonts([POPPINS_BOLD], font => font.includes('Poppins')
			? first.promise
			: face());
		await nextTick();

		source.value = [INTER_LIGHT_ITALIC];
		await settle();
		first.reject(new Error('blocked'));
		await settle();

		expect({ fontsReady: fonts.fontsReady.value, fontsFailed: fonts.fontsFailed.value }).toEqual({ fontsReady: true, fontsFailed: false });
	});
});

describe('combineFontFaceStates', () => {
	const PENDING = { fontsReady: false, fontsFailed: false };
	const READY = { fontsReady: true, fontsFailed: false };
	const FAILED = { fontsReady: false, fontsFailed: true };

	// A failure is reported only once every state has settled, so ready-or-failed still means settled.
	it.each([
		{
			row: 'one pending',
			library: READY,
			application: PENDING,
			combined: PENDING,
		},
		{
			row: 'a failure beside a pending load',
			library: FAILED,
			application: PENDING,
			combined: PENDING,
		},
		{
			row: 'both ready',
			library: READY,
			application: READY,
			combined: READY,
		},
		{
			row: 'one failed, both settled',
			library: READY,
			application: FAILED,
			combined: FAILED,
		},
	])('$row', ({ library, application, combined }) => {
		const state = (value: typeof PENDING) => ({
			fontsReady: ref(value.fontsReady),
			fontsFailed: ref(value.fontsFailed),
		});

		const { fontsReady, fontsFailed } = combineFontFaceStates(state(library), state(application));

		expect({ fontsReady: fontsReady.value, fontsFailed: fontsFailed.value }).toEqual(combined);
	});
});
