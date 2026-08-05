import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { graphicsIngestionRequest } from '~~/test/integration/graphicsIngestionRequest';

/**
 * The isolation that keeps one integration suite from ingesting another's asset.
 *
 * The integration suites share one library and one 92-byte single-pixel PNG, and
 * the initiation API defaults `duplicateContentPolicy` to `reuse`. Two suites that
 * ingest the same bytes with the policy unstated therefore end up on one Graphic
 * Asset, whichever ran first having published it — the second suite's assertions
 * are then about somebody else's asset, and #123 catalogues how expensive that
 * class of failure is to diagnose, because it reads as a code regression.
 *
 * `graphicsIngestionRequest` inverts the default so silence means isolation. This
 * file is what turns that from a convention into a rule: a suite can only get the
 * unsafe default by building the body itself, and the scan below fails when it
 * does. Written for #197, which was filed because the invariant had been passed
 * along in PR prose through #141/#159 and #160/#192 without anything enforcing it.
 *
 * One source is exempt, and only one. `initiateTemplatePackagePreflight` pins
 * `create-separate` at `server/modules/graphics-asset-library/index.ts:4018`
 * whatever the request said, so demanding a policy on a `template-package`
 * initiation would be demanding a field the server discards. Every other source
 * on this endpoint — `local-upload` and `remote-copy` — is read from the request
 * (index.ts:3968 and :3987).
 *
 * Note that an omitted source and an explicit `source: 'local-upload'` are the
 * same request: `index.post.ts:72` preprocesses the missing case into the
 * explicit one before the discriminated union sees the body. The first version
 * of this scan honoured only `undefined` and `'remote-copy'`, which exempted the
 * explicit spelling of the default source and let it take the server's `reuse`
 * — the exact hole this file exists to close. The review of #224 caught it.
 *
 * So the exemption is written as a denylist rather than an allowlist, and that
 * is the point rather than a detail. An allowlist of honoured sources fails open:
 * a fourth source added to the endpoint later is silently exempt, and the bug
 * above recurs in a form nobody is looking for. A denylist fails loud — a new
 * source is flagged until somebody decides it belongs here.
 */

const INITIATION_PATH = '/api/graphics-assets/ingestion-operations';
const REQUEST_HELPER = 'graphicsIngestionRequest';
/** Matched against the import specifier's basename, so any relative depth resolves. */
const HELPER_MODULE = 'graphicsIngestionRequest';
const integrationDirectory = fileURLToPath(new URL('../../integration', import.meta.url));

/** The source the endpoint fills in when a body names none (index.post.ts:72). */
const IMPLICIT_SOURCE = 'local-upload';

/** Sources the library pins for itself, ignoring whatever the request asked for. */
const SOURCES_THE_LIBRARY_PINS = new Set(['template-package']);

/** Sources whose `duplicateContentPolicy` the library reads from the request. */
function policyIsHonoured(source: string | undefined) {
	return !SOURCES_THE_LIBRARY_PINS.has(source ?? IMPLICIT_SOURCE);
}

interface Initiation {
	file: string;
	line: number;
	source: string | undefined;
	viaHelper: boolean;
}

function propertyNamed(literal: ts.ObjectLiteralExpression, name: string) {
	for (const property of literal.properties) {
		if (ts.isPropertyAssignment(property) && property.name.getText() === name)
			return property.initializer;
	}
	return undefined;
}

/**
 * Backticks count. A no-substitution template literal is the same string to the
 * server and one keystroke away from the quoted form, so a scan that recognised
 * only `ts.isStringLiteral` would miss the path, the method and the source.
 */
function stringValue(expression: ts.Expression | undefined) {
	return expression && ts.isStringLiteralLike(expression) ? expression.text : undefined;
}

/**
 * What an expression eventually is, seen through the shapes the suites use: a
 * literal, `JSON.stringify(literal)`, and a `const` declared elsewhere in the
 * same file. Used for the request path as well as the body — a path held in a
 * `const` is the same initiation as a path written inline.
 */
function resolveThroughDeclarations(expression: ts.Expression, declarations: Map<string, ts.Expression>) {
	let current = expression;
	for (let hop = 0; hop < 4; hop += 1) {
		if (ts.isCallExpression(current) && current.expression.getText() === 'JSON.stringify' && current.arguments[0])
			current = current.arguments[0];
		else if (ts.isIdentifier(current) && declarations.has(current.text))
			current = declarations.get(current.text)!;
		else
			break;
	}
	return current;
}

function declarationsIn(source: ts.SourceFile) {
	const declarations = new Map<string, ts.Expression>();
	const visit = (node: ts.Node) => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
			declarations.set(node.name.text, node.initializer);
		ts.forEachChild(node, visit);
	};
	visit(source);
	return declarations;
}

/**
 * Whether the name `graphicsIngestionRequest` in this file is the imported
 * helper rather than something local wearing its name. Matching on the name
 * alone would let a file declare its own pass-through function and satisfy the
 * scan while taking the server's default.
 *
 * The module is matched by basename, not by the whole specifier. A suite one
 * directory down reaches the same file as `'../graphicsIngestionRequest'`, and
 * comparing the literal `'./graphicsIngestionRequest'` reported it as unguarded
 * — a false positive on correct code, which is the worse direction for this
 * guard to fail in: the fix it appears to ask for is to stop using the helper.
 */
function bindsTheRealHelper(source: ts.SourceFile) {
	let imported = false;
	let shadowed = false;

	const visit = (node: ts.Node) => {
		const specifier = ts.isImportDeclaration(node)
			? stringValue(node.moduleSpecifier as ts.Expression)
			: undefined;
		if (ts.isImportDeclaration(node) && specifier && basename(specifier) === HELPER_MODULE) {
			const bindings = node.importClause?.namedBindings;
			if (bindings && ts.isNamedImports(bindings)) {
				for (const element of bindings.elements) {
					if (element.name.text === REQUEST_HELPER)
						imported = true;
				}
			}
		}
		const declaresTheName
			= (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name?.text === REQUEST_HELPER;
		const bindsTheName
			= ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === REQUEST_HELPER;
		if (declaresTheName || bindsTheName)
			shadowed = true;
		ts.forEachChild(node, visit);
	};
	visit(source);
	return imported && !shadowed;
}

function initiationsIn(file: string): Initiation[] {
	return initiationsInSource(file, readFileSync(file, 'utf8'));
}

function initiationsInSource(file: string, text: string): Initiation[] {
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const declarations = declarationsIn(source);
	const helperIsTheRealOne = bindsTheRealHelper(source);
	const found: Initiation[] = [];

	const visit = (node: ts.Node) => {
		if (ts.isCallExpression(node)) {
			const [path, options] = node.arguments;
			const initiatesAnOperation = path
				&& stringValue(resolveThroughDeclarations(path, declarations)) === INITIATION_PATH
				&& options
				&& ts.isObjectLiteralExpression(options)
				&& stringValue(propertyNamed(options, 'method')) === 'POST';

			if (initiatesAnOperation) {
				const body = propertyNamed(options as ts.ObjectLiteralExpression, 'body');
				const resolved = body && resolveThroughDeclarations(body, declarations);
				const viaHelper = helperIsTheRealOne
					&& !!resolved
					&& ts.isCallExpression(resolved)
					&& resolved.expression.getText() === REQUEST_HELPER;
				const literal = viaHelper
					? (resolved as ts.CallExpression).arguments[0]
					: resolved;
				found.push({
					file,
					line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
					source: literal && ts.isObjectLiteralExpression(literal)
						? stringValue(propertyNamed(literal, 'source'))
						: undefined,
					viaHelper,
				});
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

/**
 * Recursive, because `vitest.integration.config.ts` collects
 * `test/integration/**\/*.test.ts` — a suite in a subdirectory runs like any
 * other, and a scan that only read the top level would never see it.
 */
function integrationSourceFiles() {
	return readdirSync(integrationDirectory, { recursive: true, encoding: 'utf8' })
		.filter(name => name.endsWith('.ts'))
		.sort();
}

function everyIntegrationInitiation() {
	return integrationSourceFiles().flatMap(name => initiationsIn(join(integrationDirectory, name)));
}

describe('the body of a Graphics Ingestion Operation initiation', () => {
	it('isolates by default, so a suite that says nothing cannot be handed another suite\'s asset', () => {
		expect(graphicsIngestionRequest({ idempotencyKey: 'a-suite-that-said-nothing' }))
			.toEqual({ idempotencyKey: 'a-suite-that-said-nothing', duplicateContentPolicy: 'create-separate' });
	});

	it('lets the suite that means reuse ask for it', () => {
		expect(graphicsIngestionRequest({ duplicateContentPolicy: 'reuse' as const }))
			.toEqual({ duplicateContentPolicy: 'reuse' });
	});

	it('keeps everything else the caller sent', () => {
		expect(graphicsIngestionRequest({ idempotencyKey: 'k', name: 'n', declaredByteLength: 92 }))
			.toMatchObject({ idempotencyKey: 'k', name: 'n', declaredByteLength: 92 });
	});
});

describe('every integration suite that initiates an ingestion', () => {
	it('finds the initiations it is meant to be checking', () => {
		// A scan that silently matches nothing would pass forever. The suites are
		// free to grow, so this asserts a floor rather than a count.
		const honoured = everyIntegrationInitiation().filter(one => policyIsHonoured(one.source));
		expect(honoured.length).toBeGreaterThanOrEqual(30);
	});

	it('states its duplicate-content policy by going through graphicsIngestionRequest', () => {
		// Reported relative to test/integration, so two suites of the same name in
		// different directories name themselves apart.
		const unguarded = everyIntegrationInitiation()
			.filter(one => policyIsHonoured(one.source) && !one.viaHelper)
			.map(one => `${relative(integrationDirectory, one.file)}:${one.line}`);

		// These initiations take the API's `reuse` default. Any of them that shares
		// bytes with another suite is handed that suite's Graphic Asset instead of
		// publishing its own. Wrap the body in `graphicsIngestionRequest` — it
		// defaults to `create-separate`, and takes `duplicateContentPolicy: 'reuse'`
		// if reuse is what the test is actually about.
		expect(unguarded).toEqual([]);
	});
});

/**
 * The shapes the scan has to recognise, pinned one at a time.
 *
 * Every case below was green against the first version of this scan — the review
 * of #224 found them by writing each shape into `test/integration/` and watching
 * the guard stay quiet. They are pinned here rather than as probe files because
 * the scan's input is source text, so the honest test hands it source text.
 */
describe('the scan', () => {
	const unguarded = (text: string) =>
		initiationsInSource('probe.test.ts', text).filter(one => policyIsHonoured(one.source) && !one.viaHelper);

	const importsHelper = `import { graphicsIngestionRequest } from './graphicsIngestionRequest';\n`;

	function initiation(body: string, path = `'${INITIATION_PATH}'`) {
		return `${importsHelper}await $fetch(${path}, { method: 'POST', body: ${body} });`;
	}

	it('flags a body that names local-upload explicitly and says nothing about the policy', () => {
		// The case that shipped broken. An omitted source and an explicit
		// `local-upload` are the same request — `index.post.ts:72` fills the first
		// in as the second — but the original predicate honoured only the omitted
		// spelling, so this passed the guard and took the server's `reuse`.
		expect(unguarded(initiation(`{ idempotencyKey: 'k', source: 'local-upload' }`))).toHaveLength(1);
	});

	it('flags a body that names no source at all', () => {
		expect(unguarded(initiation(`{ idempotencyKey: 'k' }`))).toHaveLength(1);
	});

	it('flags a remote copy that says nothing about the policy', () => {
		expect(unguarded(initiation(`{ idempotencyKey: 'k', source: 'remote-copy' }`))).toHaveLength(1);
	});

	it('exempts a template package, whose policy the library pins for itself', () => {
		expect(unguarded(initiation(`{ idempotencyKey: 'k', source: 'template-package' }`))).toEqual([]);
	});

	it('flags a source it has never heard of, rather than exempting it', () => {
		// The denylist earning its keep: a fourth source added to the endpoint is
		// flagged until somebody decides it belongs, instead of silently escaping.
		expect(unguarded(initiation(`{ idempotencyKey: 'k', source: 'something-new' }`))).toHaveLength(1);
	});

	it('accepts a body that went through the helper', () => {
		expect(unguarded(initiation(`graphicsIngestionRequest({ idempotencyKey: 'k' })`))).toEqual([]);
	});

	it('recognises the path written as a template literal', () => {
		expect(unguarded(initiation(`{ idempotencyKey: 'k' }`, `\`${INITIATION_PATH}\``))).toHaveLength(1);
	});

	it('recognises the path held in a const', () => {
		const text = `${importsHelper}const path = '${INITIATION_PATH}';\n`
			+ `await $fetch(path, { method: 'POST', body: { idempotencyKey: 'k' } });`;
		expect(unguarded(text)).toHaveLength(1);
	});

	it('accepts a subdirectory suite reaching the helper by a relative path', () => {
		// A suite at `test/integration/<dir>/` imports the helper as
		// `'../graphicsIngestionRequest'`. Matching the specifier literally against
		// `'./graphicsIngestionRequest'` reported such a suite as unguarded — a
		// false positive on correct code, and the worse direction for a guard to
		// fail in, since the fix a reader would reach for is to stop using the
		// helper. Found by the verifier of #224.
		const text = `import { ${REQUEST_HELPER} } from '../graphicsIngestionRequest';\n`
			+ `await $fetch('${INITIATION_PATH}', { method: 'POST', body: ${REQUEST_HELPER}({ idempotencyKey: 'k' }) });`;
		expect(unguarded(text)).toEqual([]);
	});

	it('does not accept a local function wearing the helper\'s name', () => {
		const text = `function ${REQUEST_HELPER}<T>(body: T) { return body; }\n`
			+ `await $fetch('${INITIATION_PATH}', { method: 'POST', body: ${REQUEST_HELPER}({ idempotencyKey: 'k' }) });`;
		expect(unguarded(text)).toHaveLength(1);
	});

	it('reads a suite in a subdirectory, because the suite glob does', () => {
		// `vitest.integration.config.ts` collects `test/integration/**`, so a suite
		// one directory down runs like any other. This asserts against the scan's
		// own file list rather than against a fresh `readdirSync` — the first
		// version of this test called the API itself and so passed happily with
		// the scan reading only the top level.
		expect(integrationSourceFiles()).toContain(join('fixtures', 'drain-request-body.ts'));
	});
});
