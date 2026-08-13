import type { Plugin } from 'rollup';
import { readFile } from 'node:fs/promises';

const virtualPrefix = '\0stream-keepr-wasm:';
// The importer writes `…/mozjpeg_dec.wasm?module`; the query is unwasm's, and
// this plugin answers the same request Node-side.
const wasmRequest = /\.wasm(?:\?.*)?$/;

/**
 * A `.wasm` loader for the **Node-hosted** test runs, and nothing else.
 *
 * Vitest bundles `runtime/graphics-still-image-codecs.ts` under Node, where
 * compiling a module from bytes is legal and no ESM `.wasm` import is
 * available, so the codecs' Wasm arrives here as base64 and is compiled on
 * load. The Worker build must never take this route: a deployed Worker refuses
 * `new WebAssembly.Module(bytes)` with "Wasm code generation disallowed by
 * embedder", which is what broke every deployed JPEG and WebP ingestion until
 * #302. That build uses Nitro's own Wasm support instead — see the
 * `nitro.experimental.wasm` note in `nuxt.config.ts`. Registering this plugin
 * in `nitro.rollupConfig` reintroduces the defect — and no longer only in this
 * comment: `pnpm worker:dry-run` scans the bundle for the constructor call
 * below and fails the deploy before promotion (`scripts/assert-no-runtime-wasm.mjs`, #319).
 */
export function wasmModulePlugin(name: string): Plugin {
	const plugin: Plugin & { enforce: 'pre' } = {
		name,
		enforce: 'pre',
		async resolveId(source, importer) {
			if (source.startsWith(virtualPrefix) || !wasmRequest.test(source))
				return null;
			const resolved = await this.resolve(source.replace(/\?.*$/, ''), importer, { skipSelf: true });
			return resolved ? `${virtualPrefix}${resolved.id}` : null;
		},
		async load(id) {
			if (!id.startsWith(virtualPrefix))
				return null;
			let fileName = id;
			while (fileName.startsWith(virtualPrefix))
				fileName = fileName.slice(virtualPrefix.length);
			const encoded = (await readFile(
				fileName.startsWith('file:') ? new URL(fileName) : fileName,
			)).toString('base64');
			return `
				const bytes = Uint8Array.from(atob('${encoded}'), character => character.charCodeAt(0));
				export default new WebAssembly.Module(bytes);
			`;
		},
	};
	return plugin;
}
