import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	firstPartyPathAliases,
	scanRouteRefusals,
	scanSourceForRefusals,
	serverMiddlewareFiles,
} from '~~/test/helpers/routeRefusalScan';

// The scan backs the API-boundary and error-handler censuses, so an entry it drops
// or a module it fails to reach would let either census pass in silence.

describe('what the scan reads out of a source file', () => {
	function scan(body: string) {
		return scanSourceForRefusals('route.ts', body);
	}

	it.each([
		[
			'literals',
			'createError({ statusCode: 403, message: \'Screen is locked\' });',
			403,
			'Screen is locked',
		],
		[
			'a status held in a const',
			'const FORBIDDEN = 403;\ncreateError({ statusCode: FORBIDDEN, message: \'Screen is locked\' });',
			403,
			'Screen is locked',
		],
		[
			'a message held in a const',
			'const LOCKED = \'Screen is locked\';\ncreateError({ statusCode: 403, message: LOCKED });',
			403,
			'Screen is locked',
		],
		[
			'an empty template',
			'createError({ statusCode: 403, message: `Screen is locked` });',
			403,
			'Screen is locked',
		],
		[
			'h3\'s `status` key',
			'createError({ status: 403, message: \'Screen is locked\' });',
			403,
			'Screen is locked',
		],
		[
			'h3\'s `statusMessage` key',
			'createError({ statusCode: 404, statusMessage: \'Screen not found\' });',
			404,
			'Screen not found',
		],
		[
			'a quoted computed key',
			'createError({ [\'statusCode\']: 403, message: \'Screen is locked\' });',
			403,
			'Screen is locked',
		],
		[
			'h3\'s defaults for unnamed halves',
			'createError({ message: \'Screen is locked\' });',
			500,
			'Screen is locked',
		],
	])('reads %s', (_, source, statusCode, message) => {
		expect(scan(source)).toEqual([
			expect.objectContaining({ statusCode, message }),
		]);
	});

	it.each([
		['a status from a member expression', 'createError({ statusCode: statuses.forbidden, message: \'x\' });'],
		['a computed key it cannot name', 'createError({ [statusKey]: 403, message: \'x\' });'],
		['a name declared twice', 'const S = 403;\nfunction other() { const S = 404; }\ncreateError({ statusCode: S, message: \'x\' });'],
		['a reassignable name', 'let status = 403;\ncreateError({ statusCode: status, message: \'x\' });'],
		['a non-object argument', 'createError(refusalFor(screen));'],
		['a spread', 'createError({ ...base, message: \'x\' });'],
		['a shorthand property', 'createError({ statusCode, message });'],
	])('reports an unreadable status for %s rather than dropping the site', (_, source) => {
		const refusals = scan(source);

		expect(refusals).toHaveLength(1);
		expect(refusals[0]?.statusCode).toBeUndefined();
	});

	it('reports a message it cannot read as unreadable, not as empty', () => {
		// eslint-disable-next-line no-template-curly-in-string -- TypeScript source under scan.
		expect(scan('createError({ statusCode: 404, message: `Screen ${id} not found` });')[0]?.message).toBeUndefined();
	});

	it.each([
		['a named cause', 'createError({ statusCode: 503, message: \'x\', cause: failure });', true],
		['a constructed cause', 'createError({ statusCode: 503, message: \'x\', cause: new TemporarilyUnavailableError(\'x\') });', true],
		['no cause', 'createError({ statusCode: 503, message: \'x\' });', false],
		['an undefined cause', 'createError({ statusCode: 503, message: \'x\', cause: undefined });', false],
		['a hidden shape', 'createError({ ...base, statusCode: 503 });', undefined],
	])('reads whether a refusal carries a cause: %s', (_, source, carriesCause) => {
		expect(scan(source)[0]?.carriesCause).toBe(carriesCause);
	});

	it('records one entry per createError call, readable or not', () => {
		const refusals = scan([
			'createError({ statusCode: 404, message: \'Screen not found\' });',
			'createError({ statusCode: unknownStatus, message: \'Screen is locked\' });',
			'createError(somethingElse);',
		].join('\n'));

		expect(refusals.map(refusal => refusal.site)).toEqual(['route.ts:1', 'route.ts:2', 'route.ts:3']);
	});
});

describe('the scan\'s reach through a route\'s imports', () => {
	let root: string;

	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), 'route-refusal-scan-'));
		const fixtures: Record<string, string> = {
			'entry.ts': [
				'import type { Ignored } from \'./type-only\';',
				'import { direct } from \'./direct\';',
				'export { reexported } from \'./re-exported\';',
				'export async function load() { return import(\'./dynamic\'); }',
				'createError({ statusCode: 404, message: \'the entry point\' });',
			].join('\n'),
			'direct.ts': 'export const direct = () => createError({ statusCode: 401, message: \'a direct import\' });',
			're-exported.ts': 'export const reexported = () => createError({ statusCode: 403, message: \'a re-export\' });',
			'dynamic.ts': 'export const dynamic = () => createError({ statusCode: 403, message: \'a dynamic import\' });',
			'type-only.ts': 'export interface Ignored { readonly x: number }\n'
				+ 'const unreachable = () => createError({ statusCode: 403, message: \'a type-only import\' });',
		};
		for (const [name, text] of Object.entries(fixtures))
			writeFileSync(join(root, name), text);
	});

	afterAll(() => rmSync(root, { recursive: true, force: true }));

	it('follows direct imports, re-exports and dynamic imports, but not type-only imports', () => {
		const messages = scanRouteRefusals(join(root, 'entry.ts')).refusals.map(refusal => refusal.message);

		expect(messages).toEqual(expect.arrayContaining([
			'the entry point',
			'a direct import',
			'a re-export',
			'a dynamic import',
		]));
		expect(messages).not.toContain('a type-only import');
	});

	it('reports a first-party import it cannot follow', () => {
		const entry = join(root, 'broken.ts');
		writeFileSync(entry, 'import { gone } from \'./not-a-module\';\n');

		expect(scanRouteRefusals(entry).unfollowedImports).toEqual([
			expect.stringContaining('./not-a-module'),
		]);
	});

	it('follows a first-party alias other than `~~/`', () => {
		const entry = join(root, 'aliased.ts');
		writeFileSync(entry, 'import { screenRealtimeChannel } from \'#shared/utils/realtimeChannels\';\n');

		const scan = scanRouteRefusals(entry);

		expect(scan.files).toContain('shared/utils/realtimeChannels.ts');
		expect(scan.unfollowedImports).toEqual([]);
	});

	it('leaves third-party and virtual specifiers alone', () => {
		const entry = join(root, 'third-party.ts');
		writeFileSync(entry, [
			'import { createError } from \'h3\';',
			'import { ofetch } from \'ofetch\';',
			'import { useRuntimeConfig } from \'#imports\';',
		].join('\n'));

		expect(scanRouteRefusals(entry).unfollowedImports).toEqual([]);
	});
});

describe('the path aliases the scan follows', () => {
	it('are this repository\'s own roots from the generated tsconfig, in both spellings', () => {
		const prefixes = firstPartyPathAliases().map(alias => alias.prefix);

		expect(prefixes).toEqual(expect.arrayContaining([
			'~~/',
			'@@/',
			'#shared/',
			'#server/',
			'~/',
			'@/',
			'~~',
			'#shared',
		]));
		for (const outside of [
			'h3',
			'ofetch',
			'nitropack',
			'#ui',
			'#app',
			'#imports',
			'#build',
			'#components',
		])
			expect(prefixes).not.toContain(outside);
		for (const alias of firstPartyPathAliases())
			expect(existsSync(alias.target), alias.prefix).toBe(true);
	});

	it('refuses a missing tsconfig, naming the command that writes it', () => {
		expect(() => firstPartyPathAliases(join(tmpdir(), 'route-refusal-scan-absent', 'tsconfig.json')))
			.toThrow(/nuxt prepare/);
	});

	it('refuses a tsconfig whose paths name none of this repository\'s roots', () => {
		const directory = mkdtempSync(join(tmpdir(), 'route-refusal-scan-aliases-'));
		const tsconfig = join(directory, 'tsconfig.json');
		writeFileSync(tsconfig, JSON.stringify({
			compilerOptions: {
				paths: {
					h3: ['../node_modules/h3'],
				},
			},
		}));

		try {
			expect(() => firstPartyPathAliases(tsconfig)).toThrow(/first-party/);
		}
		finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});

describe('the middleware entry points', () => {
	it('are found on disk, nested ones included and declaration files excluded', () => {
		const directory = mkdtempSync(join(tmpdir(), 'route-refusal-scan-nested-'));
		mkdirSync(join(directory, 'nested'));
		writeFileSync(join(directory, 'nested', 'deep.ts'), 'export default defineEventHandler(() => {});\n');
		writeFileSync(join(directory, 'shallow.d.ts'), 'export declare const nothing: number;\n');

		try {
			expect(serverMiddlewareFiles(directory)).toEqual([
				join(directory, 'nested', 'deep.ts'),
			]);
		}
		finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('refuse a directory holding no middleware rather than scanning none', () => {
		const directory = mkdtempSync(join(tmpdir(), 'route-refusal-scan-middleware-'));

		try {
			expect(() => serverMiddlewareFiles(directory)).toThrow(/middleware/);
		}
		finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
