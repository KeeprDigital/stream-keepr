import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	classifySources,
	nativeScryptScan,
	selfTest,
} from '../../../scripts/assert-native-scrypt.mjs';

/**
 * The scrypt-resolution guard's file-walking half (#393), per the precedent
 * `assertNoRuntimeWasm.test.ts` set: `selfTest()` proves the classifier bites
 * and runs before every scan, but it never opens a file. Every row here plants
 * its case in a real directory — the fallback module in a nested source map,
 * an output with no maps at all, a map that does not parse — and requires the
 * scan to answer for what the walk actually reached.
 */

/** As pnpm spells the two resolutions inside a real build's source map. */
const NATIVE_SOURCE = '../../../../node_modules/.pnpm/@better-auth+utils@0.4.2/node_modules/@better-auth/utils/dist/password.node.mjs';
const FALLBACK_SOURCE = '../../../../node_modules/.pnpm/@better-auth+utils@0.4.2/node_modules/@better-auth/utils/dist/password.mjs';
const BYSTANDER_SOURCE = '../../../../node_modules/.pnpm/@better-auth+utils@0.4.2/node_modules/@better-auth/utils/dist/hash.mjs';

function sourceMap(sources: string[]): string {
	return JSON.stringify({ version: 3, sources, mappings: '' });
}

const directories: string[] = [];

/** A build output on disk. Keys are paths relative to its root. */
function buildOutput(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), 'stream-keepr-scrypt-scan-'));
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

describe('the classifier the guard runs on each source map', () => {
	it('accepts the native module without reporting it as fallback', () => {
		expect(classifySources([NATIVE_SOURCE, BYSTANDER_SOURCE])).toEqual({
			native: [NATIVE_SOURCE],
			fallback: [],
		});
	});

	it('reports the fallback module', () => {
		expect(classifySources([FALLBACK_SOURCE, BYSTANDER_SOURCE])).toEqual({
			native: [],
			fallback: [FALLBACK_SOURCE],
		});
	});

	it('passes its own self-test', () => {
		expect(selfTest()).toEqual([]);
	});
});

describe('scanning a build output', () => {
	it('certifies an output whose maps name only the native module', () => {
		const root = buildOutput({
			'chunks/nitro/nitro.mjs.map': sourceMap([NATIVE_SOURCE, BYSTANDER_SOURCE]),
		});
		const scan = nativeScryptScan(root);
		expect(scan.ok).toBe(true);
	});

	it('fails an output carrying the fallback, wherever the map sits', () => {
		const root = buildOutput({
			'chunks/nitro/nitro.mjs.map': sourceMap([BYSTANDER_SOURCE]),
			'chunks/routes/deep/handler.mjs.map': sourceMap([FALLBACK_SOURCE]),
		});
		const scan = nativeScryptScan(root);
		expect(scan.ok).toBe(false);
		expect(scan.lines.join('\n')).toContain('workerd');
		expect(scan.lines.join('\n')).toContain(FALLBACK_SOURCE);
	});

	it('fails an output carrying both resolutions', () => {
		const root = buildOutput({
			'chunks/nitro/nitro.mjs.map': sourceMap([NATIVE_SOURCE, FALLBACK_SOURCE]),
		});
		expect(nativeScryptScan(root).ok).toBe(false);
	});

	it('refuses an output with no source maps rather than passing it', () => {
		const root = buildOutput({ 'chunks/nitro/nitro.mjs': 'export default {}' });
		const scan = nativeScryptScan(root);
		expect(scan.ok).toBe(false);
		expect(scan.lines.join('\n')).toContain('not a pass');
	});

	it('refuses an output whose maps never name the password module', () => {
		const root = buildOutput({
			'chunks/nitro/nitro.mjs.map': sourceMap([BYSTANDER_SOURCE]),
		});
		const scan = nativeScryptScan(root);
		expect(scan.ok).toBe(false);
		expect(scan.lines.join('\n')).toContain('cannot certify');
	});

	it('refuses when the only map naming nothing is unparseable', () => {
		const root = buildOutput({
			'chunks/nitro/nitro.mjs.map': 'not json',
		});
		expect(nativeScryptScan(root).ok).toBe(false);
	});

	it('refuses a directory it cannot read', () => {
		const root = buildOutput({});
		rmSync(root, { recursive: true, force: true });
		const scan = nativeScryptScan(root);
		expect(scan.ok).toBe(false);
		expect(scan.lines.join('\n')).toContain('cannot read');
	});
});
