import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { announceIntegrationMode, INTEGRATION_MODE_ENV } from '~~/test/integration/state';

/**
 * That the integration suite's own process knows it is the integration suite,
 * before anything can read otherwise.
 *
 * `integrationSetupOptions.env` looks like it settles this and does not.
 * `@nuxt/test-utils` spreads that object into the server child it spawns
 * (`startServer(ctx.options.env)`) and nowhere else, while `loadFixture()` calls
 * `loadNuxt({ cwd: rootDir, dev: true, … })` in the *globalSetup* process first —
 * with `rootDir` resolving through `process.cwd()` to the repository root, where
 * a developer's real `.env` sits. So a config-time reader in the parent sees no
 * suite, acts as it would for an ordinary `pnpm dev`, and the server child
 * inherits the result: `{ ...process.env, ...options.env }` overrides only the
 * two names the suite happened to pin.
 *
 * That is isolation by the coincidence of which names somebody thought to list —
 * the shape #197 and #222 were about, and the shape the first two attempts at
 * #233's gate had. `build/localConfiguration.ts` staying silent under the flag is
 * correct and was never the problem; the flag simply was not set where it had to
 * be read.
 *
 * `globalSetup.ts` is not reachable from this suite, so a call sitting in it is a
 * convention. The scan below is what makes it a rule: the announcement must
 * happen, inside `setup`, before `createTest` — because `createTest`'s
 * `beforeAll` is what reaches `loadFixture`.
 */

const globalSetupPath = fileURLToPath(new URL('../../integration/globalSetup.ts', import.meta.url));

const ANNOUNCEMENT = 'announceIntegrationMode';
const FIXTURE_ENTRY_POINT = 'createTest';

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

	it('is announced by globalSetup before the fixture is ever loaded', () => {
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
		// Order, not mere presence. Announcing after `createTest` announces it to a
		// process that has already loaded the config, which is no announcement.
		expect(announced).toBeLessThan(loaded);
	});
});
