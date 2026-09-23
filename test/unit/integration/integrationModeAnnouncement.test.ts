import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { announceIntegrationMode, INTEGRATION_MODE_ENV } from '~~/test/integration/state';

/**
 * That the integration suite's own process knows it is the integration suite,
 * before anything can read otherwise.
 *
 * The servers the suite starts inherit this process's environment
 * (`test/integration/servers.ts`), and a config-time reader in this process
 * (`build/localConfiguration.ts`, `integrationRealtimeConfigured`) must reach
 * the same answer they do. When `@nuxt/test-utils` started the server, its
 * `loadFixture()` ran `loadNuxt()` here against a developer's real `.env` with
 * no sign that a suite was running — the shape #197, #222 and #233 were about.
 *
 * `globalSetup.ts` is not reachable from this suite, so a call sitting in it is a
 * convention. The scan below is what makes it a rule: the announcement must
 * happen, inside `setup`, before the servers start.
 */

const globalSetupPath = fileURLToPath(new URL('../../integration/globalSetup.ts', import.meta.url));

const ANNOUNCEMENT = 'announceIntegrationMode';
const FIXTURE_ENTRY_POINT = 'startIntegrationServers';

function calledFunctionName(node: ts.Node): string | undefined {
	const call = ts.isAwaitExpression(node) ? node.expression : node;
	if (!ts.isCallExpression(call))
		return undefined;
	return ts.isIdentifier(call.expression) ? call.expression.text : undefined;
}

/** Every top-level call in `setup`'s body, in source order, by name. */
function setupCallOrder(source: ts.SourceFile): string[] {
	let body: ts.Block | undefined;
	source.forEachChild((node) => {
		if (ts.isFunctionDeclaration(node) && node.name?.text === 'setup')
			body = node.body;
	});

	if (!body)
		throw new Error('globalSetup.ts no longer exports a `setup` function declaration');

	return body.statements.flatMap((statement) => {
		if (ts.isExpressionStatement(statement))
			return calledFunctionName(statement.expression) ?? [];
		if (ts.isVariableStatement(statement)) {
			return statement.declarationList.declarations.flatMap(declaration =>
				declaration.initializer ? calledFunctionName(declaration.initializer) ?? [] : [],
			);
		}
		return [];
	});
}

describe('the integration suite announcing itself to its own process', () => {
	it('sets the flag the rest of the repo reads', () => {
		// Nuxt generates a `ProcessEnv` augmentation that declares every
		// runtimeConfig-backed variable as required, so an empty environment —
		// which is exactly what this test is about — cannot be written literally.
		const env = {} as NodeJS.ProcessEnv;

		announceIntegrationMode(env);

		// `'true'` exactly, because `nuxt.config.ts`, `server/plugins/error-handler.ts`
		// and `build/localConfiguration.ts` all compare against that string.
		expect(env[INTEGRATION_MODE_ENV]).toBe('true');
	});

	it('is announced by globalSetup before any server starts', () => {
		const source = ts.createSourceFile(
			globalSetupPath,
			readFileSync(globalSetupPath, 'utf8'),
			ts.ScriptTarget.Latest,
			true,
		);

		const calls = setupCallOrder(source);
		const announced = calls.indexOf(ANNOUNCEMENT);
		const loaded = calls.indexOf(FIXTURE_ENTRY_POINT);

		expect(announced, `globalSetup.setup() must call ${ANNOUNCEMENT}()`).toBeGreaterThanOrEqual(0);
		expect(loaded, `globalSetup.setup() must still call ${FIXTURE_ENTRY_POINT}()`).toBeGreaterThanOrEqual(0);
		// Order, not mere presence. Announcing after the servers start announces it
		// to children that have already loaded the config, which is no announcement.
		expect(announced).toBeLessThan(loaded);
	});
});
