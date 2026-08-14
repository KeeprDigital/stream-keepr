import type { GraphicAsset } from '~~/shared/types/graphicsAsset';
import { $fetch } from '@nuxt/test-utils/e2e';
import { suiteGraphicsAuthorSessionCookie } from './graphicsAuthorSession';

/**
 * The library listing, read under the suite's graphics author session (#172).
 *
 * The read surface refuses a caller carrying no session, and the listing is
 * installation-wide, so the session decides whether the read is answered rather
 * than what it contains. That is what makes one shared reader correct: a suite
 * comparing the listing before and after an operation is asking what the library
 * now holds, not what its own author owns.
 *
 * Shared because the Template Package preflight and installation suites both
 * prove what an operation published by reading it, and their two copies of this
 * were byte-identical, docblock included (#206 item 4, #334).
 */
export async function libraryAssets(): Promise<GraphicAsset[]> {
	return await $fetch<GraphicAsset[]>('/api/graphics-assets', {
		headers: { cookie: await suiteGraphicsAuthorSessionCookie() },
	});
}
