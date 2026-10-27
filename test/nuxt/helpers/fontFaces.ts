import { vi } from 'vitest';

/**
 * The browser's font loading, faked at its boundary: a `FontFace` that records
 * every face constructed and loads at once, and a `document.fonts` that accepts
 * every face. Undo with `vi.unstubAllGlobals()`.
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
	Object.defineProperty(document, 'fonts', {
		configurable: true,
		value: {
			add: vi.fn(),
			delete: vi.fn(),
			load: vi.fn().mockResolvedValue([]),
			check: vi.fn().mockReturnValue(true),
			ready: Promise.resolve(),
		},
	});
	return { constructed };
}

/** A Screen Output Asset Capability session that the server opens for any capability. */
export function stubCapabilitySession() {
	vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
		status: 200,
		headers: { 'content-type': 'application/json' },
	})));
}
