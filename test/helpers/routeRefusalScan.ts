import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Reading a route's own refusals out of its source, for the guard that keeps a refusal
 * list exhaustive against the realtime diagnosis (`test/unit/integration/realtimeDiagnosis.test.ts`).
 *
 * The guarantee this owes its caller is narrow and worth stating exactly: **every
 * `createError` call it finds produces exactly one entry, whether or not it could read
 * the call**. #277 was filed because the previous scan owed no such thing — it pushed an
 * entry only when `statusCode` was a numeric literal, so `statusCode: FORBIDDEN` behind a
 * `const` was dropped rather than reported, and the exhaustiveness check passed on a route
 * that had grown a refusal it could not see. A scan that silently sees less than it is
 * asked about is the same defect the list itself exists to prevent, one level down.
 *
 * So an unreadable half becomes `undefined` rather than an absence or a plausible default.
 * `undefined` matches no listed refusal, so the entry surfaces as unaccounted-for and the
 * check fails loudly, carrying `site` and `source` to say which call defeated it. That is
 * the safe direction: a false alarm costs a reader one look at a named line, where a silent
 * drop costs them the guarantee.
 *
 * #277 also widened *where* it looks. The scan used to read the route file alone, so a
 * refusal raised from an imported helper was invisible — which is precisely what
 * `assertTrustedScreenCommandBoundary` becomes when app-level authentication lands, since
 * ADR-0008 names these guards as the seams a credential will strengthen and a 401/403 is
 * what such a guard raises. It now walks the route's first-party import graph.
 */

/** A `createError` site the scan found, and as much of it as the scan could read. */
export interface ScannedRefusal {
	/** `<path>:<line>` relative to the repository root, so a failure names the site. */
	readonly site: string;
	/** The status, or `undefined` where the scan could not read one. */
	readonly statusCode: number | undefined;
	/** The message, or `undefined` where the scan could not read one. */
	readonly message: string | undefined;
	/** The call as written, so an unreadable entry says what defeated the scan. */
	readonly source: string;
}

export interface RouteRefusalScan {
	/** One entry per `createError` call in the graph, readable or not. */
	readonly refusals: readonly ScannedRefusal[];
	/** Every first-party module parsed, the entry point included. */
	readonly files: readonly string[];
	/**
	 * First-party imports the scan could not follow to a file, as `<site>: <specifier>`.
	 * Each is a module whose refusals are missing from `refusals` without anything saying
	 * so, so the guard treats a non-empty list as a failure rather than as a caveat.
	 */
	readonly unfollowedImports: readonly string[];
}

/**
 * The keys h3 composes a status from, in the order it consults them.
 *
 * `createError` reads `input.statusCode`, and falls back to `input.status`
 * (h3 1.15.11, `dist/index.mjs:91-95`). Reading only the first was #277's own defect in
 * another spelling: the route answered a real 403 while the scan saw no status at all,
 * applied h3's default of 500, filtered it out of the band, and the entry vanished before
 * the listing check — the one outcome this scan must never produce. h3 v2 makes `status`
 * the canonical name, so the gap would have widened rather than stayed still.
 */
const H3_STATUS_KEYS = ['statusCode', 'status'] as const;

/**
 * The keys h3 composes a message from: `input.message ?? input.statusMessage`
 * (`dist/index.mjs:71`). `statusText` is deliberately absent — it sets the H3Error's
 * `statusMessage`, not the `message` Nitro reports and the diagnosis matches on.
 */
const H3_MESSAGE_KEYS = ['message', 'statusMessage'] as const;

/** h3 answers a `createError` that names no status with 500. */
const H3_DEFAULT_STATUS = 500;

/** h3 answers a `createError` that names no message with the empty string. */
const H3_DEFAULT_MESSAGE = '';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * `const` initialisers in one file, by name, for resolving `statusCode: FORBIDDEN`.
 *
 * Textual rather than scope-aware: the scan parses a file, it does not bind it. A name
 * declared twice is therefore recorded as ambiguous (`undefined`) rather than guessed at,
 * because picking either declaration would be picking one at random. `let` and `var` are
 * not collected at all — a binding that can be reassigned does not tell the scan what the
 * route answers.
 */
function constantInitialisers(source: ts.SourceFile): Map<string, ts.Expression | undefined> {
	const constants = new Map<string, ts.Expression | undefined>();

	function visit(node: ts.Node) {
		if (
			ts.isVariableDeclaration(node)
			&& ts.isIdentifier(node.name)
			&& node.initializer !== undefined
			&& ts.isVariableDeclarationList(node.parent)
			&& node.parent.getFirstToken()?.kind === ts.SyntaxKind.ConstKeyword
		) {
			constants.set(node.name.text, constants.has(node.name.text) ? undefined : node.initializer);
		}
		node.forEachChild(visit);
	}

	visit(source);
	return constants;
}

/** Unwrap the forms that mean "the same expression": `(x)`, `x as const`, `<T>x`. */
function unwrap(expression: ts.Expression): ts.Expression {
	if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression))
		return unwrap(expression.expression);
	return expression;
}

/**
 * A literal's value, following at most one `const` hop.
 *
 * One hop rather than a fixed point: a chain of aliases is not a shape anyone writes, and
 * refusing to follow it reports the site instead of silently mis-resolving a cycle.
 */
function literalValue(
	expression: ts.Expression | undefined,
	constants: Map<string, ts.Expression | undefined>,
	read: (expression: ts.Expression) => string | number | undefined,
): string | number | undefined {
	if (expression === undefined)
		return undefined;

	const unwrapped = unwrap(expression);
	const direct = read(unwrapped);
	if (direct !== undefined)
		return direct;

	if (ts.isIdentifier(unwrapped) && constants.has(unwrapped.text)) {
		const initialiser = constants.get(unwrapped.text);
		if (initialiser !== undefined)
			return read(unwrap(initialiser));
	}
	return undefined;
}

function readNumber(expression: ts.Expression): number | undefined {
	return ts.isNumericLiteral(expression) ? Number(expression.text) : undefined;
}

function readString(expression: ts.Expression): string | undefined {
	if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
		return expression.text;
	return undefined;
}

/** The call as one line, so a failure message stays readable. */
function excerpt(node: ts.Node): string {
	const text = node.getText().replace(/\s+/g, ' ').trim();
	return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

/**
 * Every `createError` call in one source text, as a refusal the scan could or could not read.
 *
 * Exported so the guard can be tested against refusal shapes no route in this repository
 * has yet — which is the only way to establish it would catch them. Testing it against the
 * real route alone cannot distinguish a scan that reads everything from one that reads
 * nothing and finds nothing to complain about.
 */
export function scanSourceForRefusals(label: string, text: string): ScannedRefusal[] {
	const source = ts.createSourceFile(label, text, ts.ScriptTarget.Latest, true);
	const constants = constantInitialisers(source);
	const refusals: ScannedRefusal[] = [];

	function visit(node: ts.Node) {
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createError') {
			const site = `${label}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
			refusals.push({ site, source: excerpt(node), ...readRefusal(node, constants) });
		}
		node.forEachChild(visit);
	}

	visit(source);
	return refusals;
}

/** The status and message halves of one `createError` call, each possibly unreadable. */
function readRefusal(
	node: ts.CallExpression,
	constants: Map<string, ts.Expression | undefined>,
): Pick<ScannedRefusal, 'statusCode' | 'message'> {
	const unreadable = { statusCode: undefined, message: undefined };

	const argument = node.arguments[0];
	// `createError(somethingElse)` and `createError('a string')` hide the whole shape.
	if (argument === undefined || !ts.isObjectLiteralExpression(argument))
		return unreadable;
	// A spread can supply or override either half, so neither half can be trusted.
	if (argument.properties.some(property => ts.isSpreadAssignment(property)))
		return unreadable;

	const assigned = new Map<string, ts.Expression>();
	for (const property of argument.properties) {
		// A shorthand or a method hides its value the same way a spread does.
		if (!ts.isPropertyAssignment(property))
			return unreadable;
		const name = propertyName(property.name);
		// A key the scan cannot name might BE the status key, so the call is unreadable
		// rather than a call with one property fewer. `['statusCode']: 403` used to
		// satisfy neither arm here and was dropped in silence.
		if (name === undefined)
			return unreadable;
		assigned.set(name, property.initializer);
	}

	return {
		statusCode: composed(assigned, H3_STATUS_KEYS, H3_DEFAULT_STATUS, constants, readNumber),
		message: composed(assigned, H3_MESSAGE_KEYS, H3_DEFAULT_MESSAGE, constants, readString),
	};
}

/** The key a property assigns to, where the scan can name it at all. */
function propertyName(name: ts.PropertyName): string | undefined {
	if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))
		return name.text;
	// `['statusCode']` is a computed name whose text is still plain to read.
	if (ts.isComputedPropertyName(name)) {
		const inner = unwrap(name.expression);
		if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner))
			return inner.text;
	}
	return undefined;
}

/**
 * One half of a refusal, composed the way h3 composes it.
 *
 * The distinction that matters, and that #277's first fix got wrong: **naming no key at
 * all** is not the same as **naming a key the scan could not parse**. h3 has a real
 * default for the first, so `undefined` there would be a false alarm on every
 * `createError` that leaves a half out. The second must stay `undefined`, because a
 * plausible default is how an entry disappears — 500 is outside the credential band, so
 * a status defaulted rather than reported is a refusal the listing check never sees.
 */
function composed<T extends string | number>(
	assigned: Map<string, ts.Expression>,
	keys: readonly string[],
	fallback: T,
	constants: Map<string, ts.Expression | undefined>,
	read: (expression: ts.Expression) => T | undefined,
): T | undefined {
	const key = keys.find(candidate => assigned.has(candidate));
	if (key === undefined)
		return fallback;
	return literalValue(assigned.get(key), constants, read) as T | undefined;
}

/**
 * This repository's path aliases, from `.nuxt/tsconfig.json` rather than from memory.
 *
 * All six reach this repository's own source, so all six are first-party and every one
 * has to be followed. Reading only `~~/` was a narrower claim than "leave no first-party
 * import unfollowed" was making: an unrecognised prefix fell through to the third-party
 * branch, which says nothing at all, so `#shared/x` would have shrunk the graph in
 * silence. No module under `server/` or `shared/` imports through the other five today,
 * which is exactly why nothing caught it.
 *
 * `#imports`, `#build`, `#app` and `#internal/*` are intentionally absent: those are
 * Nuxt's virtual modules, not this repository's code.
 */
const PATH_ALIASES: readonly (readonly [string, string])[] = [
	['~~/', ''],
	['@@/', ''],
	['#shared/', 'shared'],
	['#server/', 'server'],
	['~/', 'app'],
	['@/', 'app'],
];

function resolveModule(specifier: string, fromFile: string): { file: string } | { unfollowed: string } | undefined {
	const alias = PATH_ALIASES.find(([prefix]) => specifier.startsWith(prefix));

	let base: string;
	if (alias !== undefined)
		base = resolve(REPOSITORY_ROOT, alias[1], specifier.slice(alias[0].length));
	else if (specifier.startsWith('.'))
		base = resolve(dirname(fromFile), specifier);
	else
		// A bare or virtual specifier (`h3`, `ably`, `hub:db`, `#imports`) is not the
		// route's own code. A refusal from a dependency is not one this repository can
		// list or rename.
		return undefined;

	for (const candidate of [`${base}.ts`, `${base}/index.ts`, base]) {
		if (existsSync(candidate) && statSync(candidate).isFile())
			return { file: candidate };
	}
	return { unfollowed: specifier };
}

/**
 * Every refusal reachable from a route through its first-party imports.
 *
 * Module reachability, not call reachability: a `createError` in an imported module counts
 * even where the route never calls the function holding it. That over-approximates, and
 * deliberately — the alternative under-approximates, and an exhaustiveness guard that
 * under-approximates is the one that passes while the hole is open. An over-approximation
 * costs a false alarm that names a file and a line; #277's measurement was that the
 * Screen-command route's graph is 77 files carrying exactly one `createError`, so the
 * cost today is nil.
 *
 * **When that false alarm arrives, narrow the scan — never widen the refusal list.**
 * Adding an uncalled module's message to `SCREEN_COMMAND_ROUTE_REFUSALS` would silence it
 * by teaching the diagnosis to excuse that message at that status, so a genuine Ably 403
 * whose body echoed it would go unremarked. That is precisely the hole #268 closed. The
 * fixes that stay honest are call-reachability or excluding a subtree.
 *
 * Value imports only. A type-only import cannot carry a throw, and following it would pull
 * in the schema layer's whole transitive closure for nothing.
 *
 * **Import reachability only, which is narrower than "everything the route can answer".**
 * Nitro composes middleware around a handler rather than importing it, so
 * `server/middleware/**` is outside every graph this builds — including
 * `event-exists.ts`, which answers a banded 404 for any `/api/events/:id/**` path and so
 * for this route. That gap predates #277 and is recorded rather than closed here; closing
 * it means giving middleware its own path-matched entry points and deciding what belongs
 * in the refusal list, which is a change to what the diagnosis excuses and wants its own
 * review.
 */
export function scanRouteRefusals(entryFile: string): RouteRefusalScan {
	const refusals: ScannedRefusal[] = [];
	const unfollowedImports: string[] = [];
	const visited = new Set<string>();
	const queue = [entryFile];

	while (queue.length > 0) {
		const file = queue.shift() as string;
		if (visited.has(file))
			continue;
		visited.add(file);

		const label = relative(REPOSITORY_ROOT, file);
		const text = readFileSync(file, 'utf8');
		refusals.push(...scanSourceForRefusals(label, text));

		const source = ts.createSourceFile(label, text, ts.ScriptTarget.Latest, true);
		function follow(node: ts.Node, specifier: ts.Expression | undefined) {
			const site = `${label}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
			if (specifier === undefined || !ts.isStringLiteral(specifier)) {
				unfollowedImports.push(`${site}: ${excerpt(node)}`);
				return;
			}
			const resolved = resolveModule(specifier.text, file);
			if (resolved === undefined)
				return;
			if ('file' in resolved)
				queue.push(resolved.file);
			else
				unfollowedImports.push(`${site}: ${resolved.unfollowed}`);
		}

		function visit(node: ts.Node) {
			// `export { x } from './y'` re-exports values as surely as an import brings them.
			if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly !== true)
				follow(node, node.moduleSpecifier);
			else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier !== undefined)
				follow(node, node.moduleSpecifier);
			else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
				follow(node, node.arguments[0]);
			node.forEachChild(visit);
		}
		visit(source);
	}

	return {
		refusals,
		files: [...visited].map(file => relative(REPOSITORY_ROOT, file)).sort(),
		unfollowedImports,
	};
}
