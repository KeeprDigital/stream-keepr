/**
 * Assert the built Worker's password hashing resolved to native `node:crypto`
 * scrypt through `@better-auth/utils`'s `workerd` export condition (#393).
 *
 * ADR-0010 keeps the `no_nodejs_compat_v2` pin and takes Better Auth's native
 * scrypt path — workerd implements `node:crypto` scrypt natively (~21 ms per
 * hash, measured on #385) — on the strength of one build-time fact: the
 * bundler resolves `@better-auth/utils/password` through the `workerd` export
 * condition to `dist/password.node.mjs`. If a bundler or preset change stops
 * honouring that condition, the fallback `dist/password.mjs` bundles instead:
 * a pure-JS scrypt off `@noble/hashes` that burns bounded-but-real CPU on
 * every sign-in and hash, and nothing fails loudly. This is the smoke
 * assertion the ADR asked for at implementation time.
 *
 * The server bundle is minified, so no identifier or code shape can be
 * trusted to survive it — and the two implementations share every interesting
 * string literal (`"NFKC"`, the scrypt cost parameters). What does record the
 * resolution verbatim is the build's own source maps: each chunk's `sources`
 * array names the original module files it was bundled from. The scan reads
 * those, requiring the native file present and the fallback file absent —
 * which is also why this guard scans exactly the files its sibling
 * `assert-no-runtime-wasm.mjs` skips.
 *
 * One honesty note on what a pass proves: `workerd` and `node` both map to
 * `password.node.mjs` in the exports map, and a source map cannot say which
 * condition fired — only that the resolution landed on the native module,
 * which is the fact the ADR's decision rests on either way.
 *
 * A build that emits no source maps, or none naming `@better-auth/utils`,
 * fails the scan rather than passing it: a scan that cannot see the password
 * module cannot certify it, and "found nothing" must never read as "found
 * nothing wrong".
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/** The resolution the `workerd` condition must have produced. */
const NATIVE_PASSWORD_MODULE = /@better-auth\/utils\/dist\/password\.node\.[mc]js$/;
/** The pure-JS fallback that means the condition was not honoured. */
const FALLBACK_PASSWORD_MODULE = /@better-auth\/utils\/dist\/password\.[mc]js$/;

/**
 * Classify one source map's `sources` against the two password modules. Both
 * patterns anchor on the full basename, so neither can match the other's file.
 */
export function classifySources(sources) {
	return {
		native: sources.filter(source => NATIVE_PASSWORD_MODULE.test(source)),
		fallback: sources.filter(source => FALLBACK_PASSWORD_MODULE.test(source)),
	};
}

function* sourceMapFiles(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const entryPath = join(directory, entry.name);
		if (entry.isDirectory())
			yield* sourceMapFiles(entryPath);
		else if (entry.name.endsWith('.map'))
			yield entryPath;
	}
}

/**
 * Prove the classification bites, in both directions, before trusting it to
 * stay quiet. Returns the ways it is broken, empty when it is sound.
 */
export function selfTest() {
	const native = '../node_modules/@better-auth/utils/dist/password.node.mjs';
	const fallback = '../node_modules/@better-auth/utils/dist/password.mjs';
	const bystander = '../node_modules/@better-auth/utils/dist/hash.mjs';

	const failures = [];
	const nativeOnly = classifySources([native, bystander]);
	if (nativeOnly.native.length !== 1 || nativeOnly.fallback.length !== 0)
		failures.push('the native module was not classified as native — this scan cannot pass an honest build.');
	const fallbackOnly = classifySources([fallback, bystander]);
	if (fallbackOnly.fallback.length !== 1 || fallbackOnly.native.length !== 0)
		failures.push('a planted fallback module was not reported — this scan cannot fail.');
	return failures;
}

/**
 * Scan `directory`'s source maps for the password-module resolution. Returns
 * `{ ok, lines }` rather than throwing, so the caller can print the reason
 * before choosing an exit code.
 */
export function nativeScryptScan(directory) {
	const broken = selfTest();
	if (broken.length > 0) {
		return {
			ok: false,
			lines: [
				'assert-native-scrypt: SELF-TEST FAILED — the guard cannot be trusted, so the bundle was not scanned.',
				...broken.map(failure => `  ${failure}`),
			],
		};
	}

	let files;
	try {
		files = [...sourceMapFiles(directory)];
	}
	catch (error) {
		return { ok: false, lines: [`assert-native-scrypt: cannot read ${directory} — ${error.message}`] };
	}

	if (files.length === 0)
		return { ok: false, lines: [`assert-native-scrypt: no source maps under ${directory}. A scan of nothing is not a pass.`] };

	const nativeSites = [];
	const fallbackSites = [];
	for (const file of files) {
		let sources;
		try {
			sources = JSON.parse(readFileSync(file, 'utf8')).sources ?? [];
		}
		catch {
			// A source map that does not parse cannot name the password module
			// either way; the presence requirement below still holds.
			continue;
		}
		const classified = classifySources(sources);
		nativeSites.push(...classified.native.map(source => `${file}: ${source}`));
		fallbackSites.push(...classified.fallback.map(source => `${file}: ${source}`));
	}

	if (fallbackSites.length > 0) {
		return {
			ok: false,
			lines: [
				'assert-native-scrypt: the pure-JS scrypt fallback is in the Worker bundle.',
				'The bundler did not resolve `@better-auth/utils/password` through the `workerd`',
				'export condition, so every password hash would run @noble/hashes scrypt in JS',
				'instead of native `node:crypto` scrypt (ADR-0010, #393). Check the bundler\'s',
				'export conditions and the `@better-auth/utils` exports map at its pinned version.',
				...fallbackSites.map(site => `  ${site}`),
			],
		};
	}

	if (nativeSites.length === 0) {
		return {
			ok: false,
			lines: [
				`assert-native-scrypt: no source map under ${directory} names the Better Auth password module.`,
				'The scan cannot certify what it cannot see — if source maps were turned off or the',
				'module moved, point this guard at the resolution evidence before trusting a deploy.',
			],
		};
	}

	return {
		ok: true,
		lines: [`assert-native-scrypt: self-test passed; password hashing resolved to native node:crypto scrypt (${nativeSites.length} source-map site(s), no fallback) under ${directory}`],
	};
}

/** `node scripts/assert-native-scrypt.mjs <directory>`, or `--self-test`. */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [target] = process.argv.slice(2);

	if (target === '--self-test') {
		const broken = selfTest();
		for (const failure of broken)
			process.stderr.write(`assert-native-scrypt: ${failure}\n`);
		if (broken.length === 0)
			process.stdout.write('assert-native-scrypt: self-test passed — the guard reports a planted fallback and accepts the native module.\n');
		process.exit(broken.length === 0 ? 0 : 1);
	}

	if (!target) {
		process.stderr.write('assert-native-scrypt: name the build output directory to scan, or pass --self-test.\n');
		process.exit(1);
	}

	const scan = nativeScryptScan(target);
	for (const line of scan.lines)
		(scan.ok ? process.stdout : process.stderr).write(`${line}\n`);
	process.exit(scan.ok ? 0 : 1);
}
