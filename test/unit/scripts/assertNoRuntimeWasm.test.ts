import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	findRuntimeWasmCompilation,
	runtimeWasmScan,
	selfTest,
} from '../../../scripts/assert-no-runtime-wasm.mjs';

/**
 * The bundle scanner's file-walking half (#326).
 *
 * `selfTest()` proves the pattern matcher bites and is run before every scan,
 * but it never opens a file — and the walker is the half that was wrong in the
 * guard's first version: it filtered on `.js`/`.mjs`, and rollup emits a
 * re-registered `build/wasmModulePlugin.ts`'s *JavaScript* under the codecs'
 * original `.wasm` names, so the forbidden constructor shipped inside a file
 * the filter never opened. Nothing standing caught a future narrowing of
 * `NOT_SCANNED`, or a regression in the refusals that stop a scan of nothing
 * from reading as a pass.
 *
 * Every row here plants a regression in a real directory and requires the scan
 * to find it, per the scanner's own precedent — a self-test of the pattern is
 * not evidence that the walk reaches the file the pattern would match.
 */

/** What `build/wasmModulePlugin.ts` emits, which a scan must always report. */
const POISONED = `const bytes = Uint8Array.from(atob('AGFzbQEAAAABBAFgAAA='), c => c.charCodeAt(0));\n`
	+ `export default new WebAssembly.Module(bytes);\n`;

/**
 * A correct bundle already says `WebAssembly.Module` — Emscripten's glue writes
 * `instanceof` to accept a pre-compiled module — so a scan that reported the
 * bare name would fail every honest build.
 */
const HONEST = `var r = await WebAssembly.instantiateStreaming(fetch(u), i);\n`
	+ `1 !== arguments.length || r34 instanceof WebAssembly.Module || (t27 = void 0, n57 = r34);\n`;

const directories: string[] = [];

/** A bundle on disk. Keys are paths relative to its root; nested ones are created. */
function bundle(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), 'stream-keepr-wasm-scan-'));
	directories.push(root);
	for (const [relative, contents] of Object.entries(files)) {
		const target = join(root, relative);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, contents, 'utf8');
	}
	return root;
}

afterEach(() => {
	for (const root of directories.splice(0))
		rmSync(root, { recursive: true, force: true });
});

describe('the pattern the guard searches for', () => {
	it('reports the 1-based line of every runtime compilation', () => {
		expect(findRuntimeWasmCompilation(`a\nnew WebAssembly.Module(b)\nc\nnew WebAssembly.Module(d)`))
			.toEqual([2, 4]);
		expect(findRuntimeWasmCompilation(HONEST)).toEqual([]);
	});

	it('proves itself in both directions before any scan trusts it', () => {
		expect(selfTest()).toEqual([]);
	});
});

describe('the files a bundle scan opens', () => {
	it('passes an honest bundle and says how many files it read', () => {
		const scan = runtimeWasmScan(bundle({
			'index.js': HONEST,
			'chunks/nitro.mjs': 'export default 1;\n',
		}));

		expect(scan.ok).toBe(true);
		expect(scan.lines.join('\n')).toContain('no `new WebAssembly.Module(` in 2 bundled file(s)');
	});

	/**
	 * The planted regression the walker exists for: JavaScript under a `.wasm`
	 * name. An extension filter passes over this bundle in silence, which is
	 * what shipped the deployed-Worker failure #302 removed.
	 */
	it('opens a file whose name says it is not JavaScript', () => {
		const scan = runtimeWasmScan(bundle({
			'index.js': HONEST,
			'mozjpeg_dec-a1b2c3.wasm': POISONED,
		}));

		expect(scan.ok).toBe(false);
		expect(scan.lines.join('\n')).toContain('mozjpeg_dec-a1b2c3.wasm:2');
		expect(scan.lines.join('\n')).toContain('`new WebAssembly.Module(` is in the Worker bundle');
	});

	it('walks into subdirectories rather than only the root it was given', () => {
		const scan = runtimeWasmScan(bundle({
			'index.js': HONEST,
			'chunks/build/codecs/webp_enc-d4e5f6.wasm': POISONED,
		}));

		expect(scan.ok).toBe(false);
		expect(scan.lines.join('\n')).toContain(join('chunks', 'build', 'codecs', 'webp_enc-d4e5f6.wasm:2'));
	});

	/**
	 * Sourcemaps are the one exclusion, and they are excluded because they are
	 * not executed — a sourcemap of the honest glue quotes the constructor call
	 * from the plugin's own source without the Worker ever running it. Widening
	 * `NOT_SCANNED` past this is what this row refuses.
	 */
	it('skips sourcemaps, and only sourcemaps', () => {
		const scan = runtimeWasmScan(bundle({
			'index.js': HONEST,
			'index.js.map': `{"sourcesContent":["export default new WebAssembly.Module(bytes);"]}`,
			'wasmModulePlugin.mjs.map': POISONED,
		}));

		expect(scan.ok).toBe(true);
		// The count is the assertion that the two maps were never opened: a scan
		// that read them would have failed, and one that counted them would say 3.
		expect(scan.lines.join('\n')).toContain('in 1 bundled file(s)');
	});
});

describe('what the guard refuses to call a pass', () => {
	it('refuses a directory it found no file in', () => {
		const scan = runtimeWasmScan(bundle({}));

		expect(scan.ok).toBe(false);
		expect(scan.lines.join('\n')).toContain('A scan of nothing is not a pass.');
	});

	/**
	 * A directory of nothing but sourcemaps is a scan of nothing wearing an
	 * emitted bundle's clothes — the exclusion must not be able to empty the
	 * file list into a pass.
	 */
	it('refuses a directory whose every file was excluded', () => {
		const scan = runtimeWasmScan(bundle({ 'index.js.map': '{}\n', 'chunks/nitro.mjs.map': '{}\n' }));

		expect(scan.ok).toBe(false);
		expect(scan.lines.join('\n')).toContain('A scan of nothing is not a pass.');
	});

	it('refuses a directory that is not there, naming it', () => {
		const missing = join(bundle({}), 'never-emitted');

		const scan = runtimeWasmScan(missing);

		expect(scan.ok).toBe(false);
		expect(scan.lines.join('\n')).toContain(`cannot read ${missing}`);
	});

	it('refuses a path that is a file rather than a bundle directory', () => {
		const scan = runtimeWasmScan(join(bundle({ 'index.js': HONEST }), 'index.js'));

		expect(scan.ok).toBe(false);
		expect(scan.lines.join('\n')).toContain('cannot read');
	});
});
