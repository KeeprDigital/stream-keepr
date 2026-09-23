import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
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
 * refusal raised from an imported helper was invisible — the shape ADR-0010 predicted for
 * `assertTrustedScreenCommandBoundary` once app-level authentication landed, since it
 * named these guards as the seams a credential would strengthen and a 401/403 is what such
 * a guard raises. It now walks the route's first-party import graph.
 *
 * Authentication landed on #396 and that prediction came true somewhere else: the guard
 * itself still refuses nothing, and the 401 arrived from `api-session.ts` composed around
 * the route instead — which #292's middleware entry points, not #277's import graph, are
 * what see. Both widenings earned their keep; neither did it the way this paragraph
 * expected.
 *
 * #292 widened it once more, past what any import graph can reach: Nitro composes
 * `server/middleware/**` around a handler rather than importing it, so the banded 404
 * `event-exists.ts` answers for every `/api/events/:id/**` path was outside every graph
 * the scan could build. Middleware are entry points of their own now, and the alias map
 * the graph resolves through is read from `.nuxt/tsconfig.json` rather than remembered.
 */

/** A `createError` site the scan found, and as much of it as the scan could read. */
export interface ScannedRefusal {
	/** `<path>:<line>` relative to the repository root, so a failure names the site. */
	readonly site: string;
	/** The status, or `undefined` where the scan could not read one. */
	readonly statusCode: number | undefined;
	/** The message, or `undefined` where the scan could not read one. */
	readonly message: string | undefined;
	/**
	 * Whether the call names a `cause`, or `undefined` where the scan could not read
	 * the call's shape at all.
	 *
	 * #339's axis, and it exists for a different guard than the two above. A 5xx that
	 * names no cause has its message replaced with 'Internal Server Error' by
	 * `mapPublicNitroError`, so a hand-rolled 503 without one is an operator being told
	 * the server broke when the route had written them a sentence about what did. The
	 * class has been fixed three times (#233/#243, #294, #321) and nothing structural
	 * stopped it regrowing; `test/unit/server/plugins/error-handler.test.ts` holds the
	 * census that now does.
	 *
	 * **Presence, not usefulness.** The scan reads syntax: a `cause` naming an
	 * expression it cannot evaluate counts, because whether that expression is a class
	 * the mapper recognises is a question about the mapper rather than about the call.
	 * The one shape ruled out is the literal `cause: undefined`, which names the key
	 * and supplies nothing — counting it would let the census be satisfied by writing
	 * the word.
	 */
	readonly carriesCause: boolean | undefined;
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

/**
 * The key h3 carries through to the `H3Error`, and the one `mapPublicNitroError`
 * classifies a 5xx by. There is no fallback spelling: `cause` is the only name h3
 * reads for it.
 */
const H3_CAUSE_KEY = 'cause';

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

/** The status, message and cause of one `createError` call, each possibly unreadable. */
function readRefusal(
	node: ts.CallExpression,
	constants: Map<string, ts.Expression | undefined>,
): Pick<ScannedRefusal, 'statusCode' | 'message' | 'carriesCause'> {
	const unreadable = { statusCode: undefined, message: undefined, carriesCause: undefined };

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
		carriesCause: namesCause(assigned),
	};
}

/**
 * Whether a readable call names a `cause` worth anything.
 *
 * Deliberately not `composed`: the other two halves ask *what value* a key holds and
 * degrade to `undefined` when they cannot tell, because a status the scan misreads is
 * a refusal that vanishes from a band. This asks only *whether a key is there*, which
 * the syntax always answers — so it returns a boolean for every readable call rather
 * than a third state nobody could act on. The unreadable calls are already `undefined`
 * on all three halves, where `readRefusal` returns before reaching this.
 */
function namesCause(assigned: Map<string, ts.Expression>): boolean {
	const cause = assigned.get(H3_CAUSE_KEY);
	if (cause === undefined)
		return false;
	// `cause: undefined` is the one way to name the key and supply nothing. No call under
	// `server/` writes it today — this is a guard against the census being satisfiable by
	// typing the word, not a case anyone has met. The nearest real shape is
	// `templatePackageExportApi.ts`, which computes a cause that IS undefined on its 409
	// branch; but it passes it as a shorthand, so the whole call is unreadable and this
	// function never runs on it. Kept deliberately: the cheap defence is worth more than
	// the line it costs, and the day someone writes it out this reads it correctly.
	const value = unwrap(cause);
	return !(ts.isIdentifier(value) && value.text === 'undefined');
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

/** One `paths` entry the scan will follow: what it is written as, and where it lands. */
export interface PathAlias {
	/** `#shared/` for a wildcard key, `#shared` for the bare form. */
	readonly prefix: string;
	/** The absolute directory (wildcard) or file base (bare) the prefix stands for. */
	readonly target: string;
	/** Whether the key was `#shared/*`, which matches by prefix, or `#shared`, exactly. */
	readonly wildcard: boolean;
}

/**
 * Nuxt writes the authoritative alias map here. It is gitignored, and it does not
 * exist until `nuxt prepare` has run — hence the loud failure rather than an empty map.
 */
const NUXT_TSCONFIG = fileURLToPath(new URL('../../.nuxt/tsconfig.json', import.meta.url));

/** Where Nuxt's generated virtual modules resolve to, and so what is not source. */
const GENERATED_DIRECTORY = dirname(NUXT_TSCONFIG);

/**
 * This repository's own path aliases, read from `.nuxt/tsconfig.json` rather than
 * remembered.
 *
 * #292: the list used to be six literal prefixes. Every spelling that existed was
 * handled, so nothing was wrong — but an alias added to `nuxt.config.ts` afterwards, or
 * either of the bare no-slash forms (`#shared`, `~~`), fell through to the third-party
 * branch, which says nothing at all. The graph would have shrunk with nothing reporting
 * it, which is the defect class this whole file exists to close.
 *
 * **The map is not liftable wholesale, and that is the point of the filter.** The 43
 * keys Nuxt generates include this repository's roots *and* every dependency it resolves
 * for the type-checker — `h3`, `ofetch`, `nitropack`, `consola`, `hub:kv` — plus Nuxt's
 * own virtual modules, which resolve *inside* the repository, under `.nuxt/`. Taking the
 * lot would have walked the scan straight into `node_modules` and undone the deliberate
 * exclusion below: a refusal raised inside `h3` is not one this repository can list or
 * rename, so reporting it would be noise no reader could act on.
 *
 * An alias is therefore first-party by where its target lands: inside the repository,
 * outside `node_modules`, and outside the generated directory.
 */
export function firstPartyPathAliases(tsconfigPath: string = NUXT_TSCONFIG): readonly PathAlias[] {
	if (!existsSync(tsconfigPath)) {
		throw new Error(
			`${relative(REPOSITORY_ROOT, tsconfigPath)} does not exist, so the scan has no aliases to follow `
			+ 'and would report every first-party import as third-party. Run `pnpm nuxt prepare` (or `pnpm install`, '
			+ 'which runs it) and try again.',
		);
	}

	const read = ts.readConfigFile(tsconfigPath, file => readFileSync(file, 'utf8'));
	if (read.error !== undefined)
		throw new Error(`${relative(REPOSITORY_ROOT, tsconfigPath)} could not be parsed: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`);

	const config = read.config as { compilerOptions?: { paths?: Record<string, string[]> } } | undefined;
	const paths = config?.compilerOptions?.paths ?? {};
	const base = dirname(tsconfigPath);
	const aliases: PathAlias[] = [];

	for (const [key, targets] of Object.entries(paths)) {
		const target = targets[0];
		if (target === undefined)
			continue;
		const wildcard = key.endsWith('/*');
		const resolved = resolve(base, target.endsWith('/*') ? target.slice(0, -2) : target);
		if (!isFirstParty(resolved))
			continue;
		aliases.push({ prefix: wildcard ? `${key.slice(0, -2)}/` : key, target: resolved, wildcard });
	}

	if (aliases.length === 0) {
		throw new Error(
			`${relative(REPOSITORY_ROOT, tsconfigPath)} names no first-party path alias, so every import through `
			+ 'one would be read as third-party and skipped in silence. Expected `~~/*` and friends to resolve '
			+ 'inside the repository.',
		);
	}

	// Longest prefix first, so a specifier is claimed by the most specific alias that
	// can hold it rather than by whichever `paths` happened to list first.
	return aliases.sort((left, right) => right.prefix.length - left.prefix.length);
}

/** Whether a `paths` target is this repository's own source rather than something it resolves. */
function isFirstParty(target: string): boolean {
	const within = relative(REPOSITORY_ROOT, target);
	if (within.startsWith('..'))
		return false;
	const segments = within.split(sep);
	return !segments.includes('node_modules') && !target.startsWith(GENERATED_DIRECTORY + sep) && target !== GENERATED_DIRECTORY;
}

let cachedAliases: readonly PathAlias[] | undefined;

/** The generated map is read once per process; every scan in a run resolves against it. */
function pathAliases(): readonly PathAlias[] {
	cachedAliases ??= firstPartyPathAliases();
	return cachedAliases;
}

function resolveModule(specifier: string, fromFile: string): { file: string } | { unfollowed: string } | undefined {
	const alias = pathAliases().find(candidate => (candidate.wildcard
		? specifier.startsWith(candidate.prefix)
		: specifier === candidate.prefix));

	let base: string;
	if (alias !== undefined)
		base = alias.wildcard ? resolve(alias.target, specifier.slice(alias.prefix.length)) : alias.target;
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
 * **Import reachability alone is narrower than "everything the route can answer", which
 * is why `middlewareFiles` exists.** Nitro composes `server/middleware/**` around a
 * handler rather than importing it, so no import graph reaches it — and
 * `event-exists.ts` answers a banded 404 for any `/api/events/:id/**` path, this route's
 * included. #292 gives middleware its own entry points; see `serverMiddlewareFiles`
 * for how they are found and where a middleware's graph stops.
 */
export function scanRouteRefusals(entryFile: string, middlewareFiles: readonly string[] = []): RouteRefusalScan {
	const refusals: ScannedRefusal[] = [];
	const unfollowedImports: string[] = [];
	const visited = new Set<string>();

	function walk(entries: readonly string[], viaMiddleware: boolean) {
		const queue = [...entries];

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
				if (!('file' in resolved)) {
					unfollowedImports.push(`${site}: ${resolved.unfollowed}`);
					return;
				}
				if (viaMiddleware && isDomainLayer(resolved.file))
					return;
				queue.push(resolved.file);
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
	}

	// The route first and to a fixed point, so a module the route really imports is
	// scanned as the route's own even where a middleware reaches it too. Walking one
	// interleaved queue would have let the middleware narrowing below win by arriving
	// first, which is an under-approximation and the one direction that must not happen.
	walk([entryFile], false);
	walk(middlewareFiles, true);

	return {
		refusals,
		files: [...visited].map(file => relative(REPOSITORY_ROOT, file)).sort(),
		unfollowedImports,
	};
}

/** Where Nitro looks for the handlers it composes around every request. */
const MIDDLEWARE_DIRECTORY = resolve(REPOSITORY_ROOT, 'server/middleware');

/**
 * The layers a middleware consults rather than refuses through — excluded from a
 * middleware's graph, and only from a middleware's graph.
 */
const DOMAIN_LAYER_ROOTS = ['server/services', 'server/modules'] as const;

function isDomainLayer(file: string): boolean {
	const within = relative(REPOSITORY_ROOT, file);
	return DOMAIN_LAYER_ROOTS.some(root => within.startsWith(`${root}${sep}`));
}

/**
 * Every middleware Nitro will compose around a request, as entry points for the scan.
 *
 * The directory rather than a list of names: a hardcoded list would close #292's hole
 * and re-open it the day someone adds a middleware, which is the hardcoded-alias defect
 * one directory along. An empty directory is a failure rather than an empty list —
 * scanning no middleware passes every assertion the guard makes.
 *
 * **All of them, not the ones that match this route's path.** Nitro runs every
 * middleware on every request; which of them acts is a runtime decision each makes from
 * the path and method, and reading that decision out of the source means interpreting
 * guards like `if (event.method !== 'GET' || pathname.startsWith('/api/')) return;`.
 * So this over-approximates, the way module reachability already does, and the cost is
 * measured rather than assumed: across all four middleware exactly two banded refusals
 * arrive, and both are refusals this route can raise — `event-exists.ts`'s 404 for an
 * absent Event, and `api-session.ts`'s 401 for a request with no session. **When that
 * stops being true — a middleware growing a banded refusal for some path this route is
 * not on — path-match here or exclude it here. Do not add it to the refusal list**, for
 * the reason spelled out above.
 *
 * #396 is the case that distinguishes the two halves of that rule, so read it before
 * applying it. The API boundary's 401 was **added to the list**, which is what the
 * sentence above forbids — and legitimately, because the clause it turns on is "for some
 * path this route is not on". The boundary refuses `/api/**` without a session, and this
 * route is inside it: an unauthenticated request to the Screen-command path really is
 * answered 401, so a run whose session lapsed must read as a missing cookie rather than
 * as a fabricated Ably key. ADR-0010 pre-authorised exactly that addition, and
 * `SCREEN_COMMAND_ROUTE_REFUSALS` carries the argument at the entry. What stays
 * forbidden is the other thing: silencing a refusal the route **cannot** answer by
 * teaching the diagnosis to excuse its message, which is #268's hole.
 *
 * **A middleware's graph stops at the domain layer**, which is the second half of
 * keeping that cost at nil. `DOMAIN_LAYER_ROOTS` is excluded because middleware is
 * global: every route pays for whatever any middleware transitively imports, and
 * `event-exists.ts` alone reaches `featureMatch.ts`'s two banded 404s and an unreadable
 * 404 in `sequencedLiveState.ts` through `eventService()` — refusals raised by services
 * this route never calls, which no honest reading could add to its list. Middleware
 * consults the domain layer for a boolean and refuses on its own terms or through a
 * refusal helper (`payloadTooLarge`), and those helpers are still followed. The residual
 * is a middleware that genuinely refuses through a service; there is none today.
 */
export function serverMiddlewareFiles(directory: string = MIDDLEWARE_DIRECTORY): readonly string[] {
	// Recursively, because Nitro's own scan of this directory is recursive: a middleware
	// one directory down runs on every request exactly as a top-level one does, and a
	// flat read would have skipped it in silence. Declaration files are excluded for the
	// reason a type-only import is — they cannot carry a throw.
	const files = existsSync(directory) ? typeScriptFilesUnder(directory) : [];

	if (files.length === 0) {
		throw new Error(
			`${relative(REPOSITORY_ROOT, directory)} holds no middleware, so the scan would read a route's `
			+ 'imports only and miss every refusal Nitro composes around it. If middleware moved, point this at '
			+ 'the new directory.',
		);
	}

	return files;
}

/**
 * Every TypeScript source file under a directory, as absolute paths.
 *
 * Entries are visited in name order at each level, and a subdirectory is emitted whole
 * at the point its own name sorts — so a subdirectory's files can precede a file
 * sitting beside it. `server/modules` is the illustration: thirteen subdirectories'
 * files come out before the top-level `graphics-administrator.ts`. No caller depends on
 * the order; it is deterministic rather than meaningful, which is all a census needs.
 *
 * Declaration files are excluded for the reason a type-only import is followed by
 * nothing: they cannot carry a throw. Shared by `serverMiddlewareFiles`, whose
 * recursion this was, and by #339's `server/`-wide `carriesCause` census — which needs
 * every file rather than every file some route's graph reaches, because the class it
 * guards against is a `createError` nobody has connected up yet.
 */
export function typeScriptFilesUnder(directory: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory())
			found.push(...typeScriptFilesUnder(path));
		else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts'))
			found.push(path);
	}
	return found;
}
