import type { Plugin } from 'rollup';
import { readFile } from 'node:fs/promises';

const virtualPrefix = '\0stream-keepr-wasm:';

export function wasmModulePlugin(name: string): Plugin {
	const plugin: Plugin & { enforce: 'pre' } = {
		name,
		enforce: 'pre',
		async resolveId(source, importer) {
			if (source.startsWith(virtualPrefix) || !source.endsWith('.wasm'))
				return null;
			const resolved = await this.resolve(source, importer, { skipSelf: true });
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
