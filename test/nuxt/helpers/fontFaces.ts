import { vi } from 'vitest';

/**
 * `document.fonts` alone, accepting every face and answering `load` as `load`
 * does: by default with one face, as for a family the stylesheet declares. It
 * stays defined, `vi.unstubAllGlobals()` or not, until the next call replaces it.
 */
export function stubDocumentFonts(load: (font: string) => Promise<unknown> = async () => [{}]) {
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

/**
 * The browser's font loading, faked at its boundary: a `FontFace` that records
 * every face constructed and loads at once, and a `document.fonts` from
 * `stubDocumentFonts`. `vi.unstubAllGlobals()` undoes the `FontFace`.
 */
export function stubFontFaces() {
	const constructed: Array<{ family: string; source: string }> = [];
	vi.stubGlobal('FontFace', class {
		constructor(public family: string, public source: string) {
			constructed.push({ family, source });
		}

		async load() {
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
