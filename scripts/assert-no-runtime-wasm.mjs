/**
 * Assert a built Worker bundle compiles no Wasm at runtime.
 *
 * A deployed Worker refuses `new WebAssembly.Module(bytes)` with "Wasm code
 * generation disallowed by embedder", which is what broke every deployed JPEG
 * and WebP ingestion until #302. The fix was to stop registering
 * `build/wasmModulePlugin.ts` in `nitro.rollupConfig` and let Nitro's own Wasm
 * support emit the codecs as ESM imports of real `.wasm` assets instead — but
 * nothing failed if a later edit registered that plugin again, and the plugin's
 * own docblock warning was the entire defence. This is the standing guard #319
 * asked for; `pnpm worker:dry-run` runs it, so `pnpm deploy` reaches it before
 * promotion rather than after.
 *
 * The pattern is deliberately narrow, and measured rather than assumed. A
 * correct bundle already contains `WebAssembly.Module` twice — Emscripten's
 * glue writes `r instanceof WebAssembly.Module` to accept a pre-compiled
 * module — alongside `WebAssembly.instantiate` and `instantiateStreaming`, so a
 * check for the bare name would fail every honest build. The constructor call
 * is the thing the embedder refuses, and only the inlining plugin emits it.
 *
 * Two ways a scan like this passes while seeing nothing, both closed here: it
 * refuses a directory it found no file in rather than reporting zero
 * matches, and `selfTest` runs before every scan, planting a regression that
 * must be found and Emscripten's real `instanceof` line that must not be. A
 * search that cannot match is indistinguishable from a clean bundle.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/** The constructor call a deployed Worker's embedder refuses. */
const RUNTIME_WASM_COMPILATION = 'new WebAssembly.Module(';

/**
 * Everything the dry run emits is scanned except source maps, which are not
 * executed and are twice the size of the bundle.
 *
 * Extension-filtering to `.js` was the first version of this and it was wrong,
 * caught by the planted regression it exists to catch. With the plugin
 * re-registered, rollup emits the plugin's *JavaScript* under the codecs'
 * original `.wasm` names — `mozjpeg_dec-<hash>.wasm` opens with
 * `const bytes = Uint8Array.from(atob('AGFzbQEA…` — so the constructor call
 * ships inside a file a `.js` filter never opens. What a file is named is not
 * what it contains, and the guard reads bytes rather than trusting either.
 */
const NOT_SCANNED = /\.map$/;

/** The 1-based lines of `source` that compile Wasm from a byte buffer. */
export function findRuntimeWasmCompilation(source) {
	const found = [];
	for (const [index, line] of source.split('\n').entries()) {
		if (line.includes(RUNTIME_WASM_COMPILATION))
			found.push(index + 1);
	}
	return found;
}

function* scannableFiles(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const entryPath = join(directory, entry.name);
		if (entry.isDirectory())
			yield* scannableFiles(entryPath);
		else if (!NOT_SCANNED.test(entry.name))
			yield entryPath;
	}
}

/**
 * Prove the search bites, in both directions, before trusting it to stay quiet.
 * Returns the ways it is broken, empty when it is sound.
 */
export function selfTest() {
	// What `build/wasmModulePlugin.ts` emits, which this must always report.
	const planted = 'export default new WebAssembly.Module(bytes);';
	// Verbatim from a correct bundle, which this must never report.
	const emscripten = '1 !== arguments.length || r34 instanceof WebAssembly.Module || (t27 = void 0, n57 = r34), a = (function(r35, e28, t28 = {}) {';

	const failures = [];
	if (findRuntimeWasmCompilation(planted).length !== 1)
		failures.push('a planted `new WebAssembly.Module(` was not found — this scan cannot fail.');
	if (findRuntimeWasmCompilation(emscripten).length !== 0)
		failures.push('Emscripten\'s `instanceof WebAssembly.Module` was reported as runtime compilation — this scan fails honest builds.');
	return failures;
}

/**
 * Scan `directory` for runtime Wasm compilation. Returns `{ ok, lines }` rather
 * than throwing, so both callers can print the reason before choosing an exit
 * code.
 */
export function runtimeWasmScan(directory) {
	const broken = selfTest();
	if (broken.length > 0) {
		return {
			ok: false,
			lines: [
				'assert-no-runtime-wasm: SELF-TEST FAILED — the guard cannot be trusted, so the bundle was not scanned.',
				...broken.map(failure => `  ${failure}`),
			],
		};
	}

	let files;
	try {
		files = [...scannableFiles(directory)];
	}
	catch (error) {
		return { ok: false, lines: [`assert-no-runtime-wasm: cannot read ${directory} — ${error.message}`] };
	}

	if (files.length === 0)
		return { ok: false, lines: [`assert-no-runtime-wasm: nothing to scan under ${directory}. A scan of nothing is not a pass.`] };

	const found = [];
	for (const file of files) {
		for (const line of findRuntimeWasmCompilation(readFileSync(file, 'utf8')))
			found.push(`${file}:${line}`);
	}

	if (found.length > 0) {
		return {
			ok: false,
			lines: [
				`assert-no-runtime-wasm: \`${RUNTIME_WASM_COMPILATION}\` is in the Worker bundle.`,
				'A deployed Worker refuses to compile Wasm from bytes ("Wasm code generation disallowed',
				'by embedder"), so this bundle would fail every JPEG and WebP ingestion once promoted.',
				'Check whether `build/wasmModulePlugin.ts` has been registered in `nitro.rollupConfig`;',
				'it is for the Node-hosted test runs only (#302, #319).',
				...found.map(site => `  ${site}`),
			],
		};
	}

	return {
		ok: true,
		lines: [`assert-no-runtime-wasm: self-test passed; no \`${RUNTIME_WASM_COMPILATION}\` in ${files.length} bundled file(s) under ${directory}`],
	};
}

/** `node scripts/assert-no-runtime-wasm.mjs <directory>`, or `--self-test`. */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [target] = process.argv.slice(2);

	if (target === '--self-test') {
		const broken = selfTest();
		for (const failure of broken)
			process.stderr.write(`assert-no-runtime-wasm: ${failure}\n`);
		if (broken.length === 0)
			process.stdout.write('assert-no-runtime-wasm: self-test passed — the guard finds a planted regression and ignores Emscripten\'s `instanceof`.\n');
		process.exit(broken.length === 0 ? 0 : 1);
	}

	if (!target) {
		process.stderr.write('assert-no-runtime-wasm: name the bundle directory to scan, or pass --self-test.\n');
		process.exit(1);
	}

	const scan = runtimeWasmScan(target);
	for (const line of scan.lines)
		(scan.ok ? process.stdout : process.stderr).write(`${line}\n`);
	process.exit(scan.ok ? 0 : 1);
}
