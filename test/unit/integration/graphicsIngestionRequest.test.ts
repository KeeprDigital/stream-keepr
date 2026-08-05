import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
 * The scan is deliberately narrow. It flags only initiations whose policy the
 * library actually honours — `local-upload` (the implicit source) and
 * `remote-copy`. `replacement` and `template-package` initiations pin
 * `create-separate` inside the library, so demanding a policy on those would be
 * demanding a field the server throws away.
 */

const INITIATION_PATH = '/api/graphics-assets/ingestion-operations';
const REQUEST_HELPER = 'graphicsIngestionRequest';
const integrationDirectory = fileURLToPath(new URL('../../integration', import.meta.url));

/** Sources whose `duplicateContentPolicy` the library reads from the request. */
function policyIsHonoured(source: string | undefined) {
	return source === undefined || source === 'remote-copy';
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

function stringValue(expression: ts.Expression | undefined) {
	return expression && ts.isStringLiteral(expression) ? expression.text : undefined;
}

/**
 * The object literal a body expression eventually is, seen through the three
 * shapes the suites use: a literal, `JSON.stringify(literal)`, and a `const`
 * declared earlier in the same file and posted twice.
 */
function resolveBody(expression: ts.Expression, declarations: Map<string, ts.Expression>) {
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

function initiationsIn(file: string): Initiation[] {
	const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
	const declarations = declarationsIn(source);
	const found: Initiation[] = [];

	const visit = (node: ts.Node) => {
		if (ts.isCallExpression(node)) {
			const [path, options] = node.arguments;
			const initiatesAnOperation = path
				&& ts.isStringLiteral(path)
				&& path.text === INITIATION_PATH
				&& options
				&& ts.isObjectLiteralExpression(options)
				&& stringValue(propertyNamed(options, 'method')) === 'POST';

			if (initiatesAnOperation) {
				const body = propertyNamed(options as ts.ObjectLiteralExpression, 'body');
				const resolved = body && resolveBody(body, declarations);
				const viaHelper = !!resolved
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

function everyIntegrationInitiation() {
	return readdirSync(integrationDirectory)
		.filter(name => name.endsWith('.ts'))
		.sort()
		.flatMap(name => initiationsIn(join(integrationDirectory, name)));
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
		const unguarded = everyIntegrationInitiation()
			.filter(one => policyIsHonoured(one.source) && !one.viaHelper)
			.map(one => `${one.file.slice(one.file.lastIndexOf('/') + 1)}:${one.line}`);

		// These initiations take the API's `reuse` default. Any of them that shares
		// bytes with another suite is handed that suite's Graphic Asset instead of
		// publishing its own. Wrap the body in `graphicsIngestionRequest` — it
		// defaults to `create-separate`, and takes `duplicateContentPolicy: 'reuse'`
		// if reuse is what the test is actually about.
		expect(unguarded).toEqual([]);
	});
});
