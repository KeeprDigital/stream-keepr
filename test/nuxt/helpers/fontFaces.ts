import { vi } from 'vitest';

/** The environment's own `document.fonts` property, kept while a stub replaces it. */
let environmentFonts: { descriptor: PropertyDescriptor | undefined } | undefined;

/**
 * `document.fonts` alone, accepting every face and answering `load` as `load`
 * does: by default with one face, as for a family the stylesheet declares. It
 * stays defined, `vi.unstubAllGlobals()` or not, until the next call replaces it
 * or `restoreDocumentFonts()` puts the environment's back.
 */
export function stubDocumentFonts(load: (font: string) => Promise<unknown> = async () => [{}]) {
	environmentFonts ??= {
		descriptor: Object.getOwnPropertyDescriptor(document, 'fonts'),
	};
	const fonts = {
		add: vi.fn(),
		delete: vi.fn(),
		load: vi.fn(load),
		check: vi.fn().mockReturnValue(true),
		ready: Promise.resolve(),
	};
	Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
	return fonts;
}

/** Undoes every `stubDocumentFonts` since the last restore, so a load left pending leaks into no later test. */
export function restoreDocumentFonts() {
	if (!environmentFonts)
		return;
	if (environmentFonts.descriptor)
		Object.defineProperty(document, 'fonts', environmentFonts.descriptor);
	else
		Reflect.deleteProperty(document, 'fonts');
	environmentFonts = undefined;
}

/**
 * The browser's font loading, faked at its boundary: a `FontFace` that records
 * every face constructed and loads at once, and a `document.fonts` from
 * `stubDocumentFonts`. `vi.unstubAllGlobals()` undoes the `FontFace`.
 */
export function stubFontFaces(
	/** When a constructed face's own load settles: at once, unless a test holds it. */
	load: (family: string) => Promise<unknown> = async () => {},
) {
	const constructed: Array<{ family: string; source: string }> = [];
	vi.stubGlobal('FontFace', class {
		constructor(public family: string, public source: string) {
			constructed.push({ family, source });
		}

		async load() {
			await load(this.family);
			return this;
		}
	});
	stubDocumentFonts();
	return { constructed };
}

/** A Screen Output Asset Capability session that the server opens for any capability. */
export function stubCapabilitySession() {
	vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
		status: 200,
		headers: { 'content-type': 'application/json' },
	})));
}
