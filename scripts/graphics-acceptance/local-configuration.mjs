/**
 * What a local acceptance run needs the checkout to have, checked before the
 * run touches the installation.
 *
 * #223 made the integration suite announce a missing Ably key, and #130 made
 * `nuxt dev` warn when the required `NUXT_` names are unusable. Neither reaches
 * here: an acceptance harness is its own `node` process, started separately
 * from whatever installation it points at, so it inherits neither notice. A
 * fresh worktree running `pnpm test:delivery:graphics` therefore got 503s from
 * capability minting and, in the ticket's words, never reached anything to
 * assert — with no named cause anywhere in the transcript (#274).
 *
 * The names and the surfaces they hold up are **imported** from
 * `build/devVars.ts` rather than restated. That file is a build module and
 * these are `.mjs` scripts, which is a real seam and not a stylistic one; it is
 * crossed by importing the `.ts` directly, which Node does natively — type
 * stripping has been on by default since 22.18, and `.node-version` pins 24.
 * `devVars.ts` is erasable-syntax-only (`as const satisfies`, `export type`,
 * `export interface`), so nothing there needs a transform. A third copy of the
 * list is what the ticket asked us not to write, and the drift pin in
 * `test/unit/scripts/localAcceptanceConfiguration.test.ts` is what makes the
 * import mean something: a name added to `LOCALLY_REQUIRED_NUXT_NAMES` fails
 * that test until somebody says which side of the partition below it is on.
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';
import {
	LOCAL_NUXT_NAME_SURFACES,
	missingLocalNuxtNames,
	parseDevVars,
	sentenceList,
} from '../../build/devVars.ts';
import { AcceptanceFailure } from './evidence.mjs';

/**
 * The required names a **local acceptance run** cannot proceed without.
 *
 * Not all of them, and the distinction is #130's cell-H lesson applied to a
 * different caller: a notice that fires where its words are false is worse than
 * no notice. `NUXT_GRAPHICS_ADMIN_TOKEN` guards `requireGraphicsAdministrator`,
 * which is mounted only under the `server/api/admin` tree — and no path in
 * `routes.mjs` is an admin path, so no harness can reach it. Blocking a run on
 * that name would refuse a checkout that would have passed.
 *
 * `.dev.vars.example` and `docs/operations/graphics-staging-acceptance.md` both
 * already say the signing key is load-bearing; this is that sentence made
 * executable.
 *
 * The two auth names joined it on #396, when `/api/**` began denying by default
 * and every route in `routes.mjs` became a route that needs a signed-in
 * operator (`./operator.mjs`):
 *
 * - `NUXT_BETTER_AUTH_SECRET`, because an installation without it cannot admit
 *   anybody at all — sign-in itself answers 503 naming the setting — however the
 *   harness came by its credentials.
 * - `NUXT_ADMIN_BOOTSTRAP_TOKEN`, because a local run acquires its operator by
 *   calling the first-admin bootstrap with it. A deployed run is not checked
 *   here at all and takes the other path, signing in with credentials from the
 *   environment; that is why this name being required *locally* is not the false
 *   alarm it would otherwise look like.
 *
 * @type {import('../../build/devVars.ts').LocallyRequiredNuxtName[]}
 */
export const LOCAL_ACCEPTANCE_REQUIRED_NUXT_NAMES = [
	'NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY',
	'NUXT_BETTER_AUTH_SECRET',
	'NUXT_ADMIN_BOOTSTRAP_TOKEN',
];

/**
 * Required of a checkout, but not of an acceptance run — named here so the
 * partition is total and legible, exactly as `LOCALLY_OPTIONAL_NUXT_NAMES` is
 * in `build/devVars.ts`.
 *
 * @type {import('../../build/devVars.ts').LocallyRequiredNuxtName[]}
 */
export const LOCAL_ACCEPTANCE_UNREACHED_NUXT_NAMES = ['NUXT_GRAPHICS_ADMIN_TOKEN'];

/**
 * Where a previewed Worker's secrets are actually opened from.
 *
 * Exported so `scripts/stage-preview-secrets.mjs` writes to the same path this
 * file reads, by construction rather than by two authors agreeing. A staging
 * step and a preflight that disagreed about this path would reproduce the
 * original defect one layer up: the file staged somewhere nothing looks.
 */
export const RESOLVED_PREVIEW_DEV_VARS = '.output/server/.dev.vars';

/**
 * Every file this checkout keeps such a name in, relative to the repository
 * root.
 *
 * The question this preflight answers is "can this checkout supply the name at
 * all", not "which file will the installation read" — because the harness
 * cannot know how the installation in front of it was started. Erring towards
 * staying quiet is deliberate: a false silence costs the reader the 503s they
 * were already getting, and a false alarm blocks a run that works.
 *
 * All three, rather than only the one wrangler opens, and the reason is the
 * point of the whole ticket. `.output/server/.dev.vars` is the resolved path —
 * wrangler resolves `.dev.vars` against the directory of its config file, and
 * `pnpm preview` passes `--config .output/server/wrangler.json` — but the
 * repository root is where a developer puts the file, and `pnpm preview` now
 * stages it across (`scripts/stage-preview-secrets.mjs`). Checking only the
 * resolved path would refuse a correctly configured checkout that has not run
 * a build yet; checking only the root would have been the falsehood #274 was
 * filed about. Reading `.env` too because the harness may be pointed at a
 * `nuxt dev` server through `STREAM_KEEPR_LOCAL_ACCEPTANCE_URL`, and that one
 * reads `.env`.
 */
export const LOCAL_CONFIGURATION_FILES = ['.env', '.dev.vars', RESOLVED_PREVIEW_DEV_VARS];

/**
 * Which of the names an acceptance run needs the merged environment cannot
 * supply.
 *
 * Blankness is decided by `missingLocalNuxtNames`, so "missing" means here
 * exactly what it means to the #130 notice and to the readers themselves —
 * `signingKey` rejects the empty string, and a checkout holding
 * `cp .dev.vars.example .dev.vars` holds a file full of blanks.
 *
 * @param {Record<string, string | undefined>} env
 */
export function missingLocalAcceptanceNames(env) {
	return missingLocalNuxtNames(env)
		.filter(name => LOCAL_ACCEPTANCE_REQUIRED_NUXT_NAMES.includes(name));
}

/**
 * Fold the sources into one environment, keeping only values that are actually
 * usable.
 *
 * A blank never displaces a real value, whatever order the sources arrive in,
 * because the whole point of reading three of them is that any one may be the
 * one that was filled in.
 *
 * @param {readonly (string | Record<string, string | undefined> | null | undefined)[]} sources
 *   Either a dotenv body to parse or an environment already in hand.
 * @returns {Record<string, string>} Every name some source could actually supply.
 */
export function suppliedNames(sources) {
	/** @type {Record<string, string>} */
	const supplied = {};
	for (const source of sources) {
		if (source === null || source === undefined)
			continue;
		const entries = typeof source === 'string' ? parseDevVars(source) : Object.entries(source);
		for (const [name, value] of entries) {
			if (typeof value === 'string' && value.trim().length > 0)
				supplied[name] ??= value;
		}
	}
	return supplied;
}

/**
 * The whole decision, with nothing read that the decision did not need.
 *
 * A deployed run never calls `readSources`: `--deployed` points the harness at
 * an installation whose secrets are Worker secrets, where no local file is
 * consulted by anybody and a notice about one would be pure noise. Passing the
 * sources in as a thunk is what lets a test prove they were not opened, which
 * is the shape `adoptDevVarsInto` uses in `build/devVars.ts` for the same
 * reason.
 *
 * @param {{
 *   deployed?: boolean,
 *   env?: Record<string, string | undefined>,
 *   readSources: () => readonly (string | null)[],
 * }} options
 */
export function localAcceptanceConfiguration({ deployed, env = {}, readSources }) {
	if (deployed)
		return { checked: false, missing: [] };
	return { checked: true, missing: missingLocalAcceptanceNames(suppliedNames([env, ...readSources()])) };
}

/**
 * What the run is about to fail to do, said before it fails to do it.
 *
 * Only the names that are actually missing, and only the surfaces belonging to
 * them, joined from the same `satisfies`-guarded map the #130 notice uses — so
 * a future required name is a compile error there rather than a surface this
 * sentence silently omits.
 *
 * One wording covers a file that is absent and a file whose value is blank,
 * because "nothing sets it" is true of both and keying on the file is the
 * mistake #130's review made once already.
 *
 * @param {readonly import('../../build/devVars.ts').LocallyRequiredNuxtName[]} missing
 */
export function localConfigurationNotice(missing) {
	const names = sentenceList(missing, 'or');
	const surfaces = missing.map(name => LOCAL_NUXT_NAME_SURFACES[name]);
	const consequence = `${sentenceList(surfaces, 'and')} answer 503`;

	// Why the other required names are absent from this sentence, said rather
	// than left to be rediscovered. Derived from the partition instead of
	// spelled out, so it cannot describe a list it no longer matches, and
	// phrased on reachability alone — the one thing membership of that list
	// guarantees.
	//
	// Filtered against `missing` because the first draft was not true in every
	// state it can reach: told that both names were missing it named the admin
	// token as a cause and then, one sentence later, said the admin token was
	// not checked. Unreachable today, and the prose probe that reads the plural
	// case is exactly the reachable state where a reader would have met it.
	const unnamed = LOCAL_ACCEPTANCE_UNREACHED_NUXT_NAMES.filter(name => !missing.includes(name));
	const unreached = unnamed.length === 0
		? ''
		: `${sentenceList(unnamed, 'and')} ${unnamed.length === 1 ? 'is' : 'are'} not checked here and a blank one `
			+ 'is not what stopped this: no route an acceptance run calls reads it. ';

	return `Nothing this checkout can give a local installation sets ${names}, so ${consequence} `
		+ `and this run would never reach anything to assert. Nothing was proved and nothing was disproved. ${
			unreached
		}A fresh git worktree is the usual way to arrive here — .env and .dev.vars are both gitignored, so a new `
		+ `checkout inherits neither from the one it was branched from, and a copied example carries the names with `
		+ `empty values. Fix: copy .env and .dev.vars in from the checkout you branched from, or fill in `
		+ `.env.example and .dev.vars.example — \`pnpm preview\` stages .dev.vars into .output/server/, which is `
		+ `where wrangler resolves it from the config. A --deployed run reads neither file and is unaffected. `
		+ `See docs/agents/parallel-rounds.md.`;
}

/**
 * What the preview staging step should do, and what it should say while doing
 * it.
 *
 * Extracted from `scripts/stage-preview-secrets.mjs` so the decision can be
 * pinned; the script around it is left with a read, a write, and two prints.
 *
 * The replacement line exists because the first version of the staging step
 * overwrote the resolved file unconditionally and silently. That is fine when
 * it is a copy of the root file, which is the whole point — but #189 reported
 * hand-maintaining `.output/server/.dev.vars` with a name the root copy did not
 * have, and a silent clobber would have taken it away and left a preview
 * failing for a reason nothing on screen explained. That is this ticket's own
 * defect class, one layer up, so the step says when it is replacing something
 * different rather than only when it writes.
 *
 * It still replaces. The root file is the source of truth — that is what the
 * corrected documentation now promises — and a staging step that declined to
 * stage would just be the old silence with extra steps.
 *
 * @param {{ source: string | null, existing: string | null }} files
 */
export function previewStagingPlan({ source, existing }) {
	if (source === null)
		return { stage: false, lines: [] };

	const staged = `Staged .dev.vars into ${RESOLVED_PREVIEW_DEV_VARS}, `
		+ 'where wrangler resolves it from the config (#274).';
	if (existing !== null && existing !== source) {
		return {
			stage: true,
			lines: [
				`Replacing the existing ${RESOLVED_PREVIEW_DEV_VARS}, which differs from the .dev.vars it is `
				+ 'staged from. The repository root copy is the source of truth; anything only in the staged '
				+ 'one is about to be lost.',
				staged,
			],
		};
	}
	return { stage: true, lines: [staged] };
}

/**
 * Read the sources from disk, relative to the repository root.
 *
 * A file that is not there is `null` rather than a throw: any of the three is
 * routinely absent in a working checkout, and the whole question is which of
 * them happens to carry the name.
 *
 * @returns {(string | null)[]} One body per entry of `LOCAL_CONFIGURATION_FILES`, in that order.
 */
export function readLocalConfigurationFiles() {
	return LOCAL_CONFIGURATION_FILES.map((name) => {
		try {
			return readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
		}
		catch {
			return null;
		}
	});
}

/**
 * Stop the run here, before it opens an installation it cannot use.
 *
 * The prose goes to stderr on its own rather than through the evidence
 * formatter, which is a deliberate exception and not an oversight. That
 * formatter exists to reduce values *observed from the installation* — object
 * keys, capability tokens, digests — and it enforces that with a length rule
 * several sentences of guidance trip on sight. (The opaque-token rule no longer
 * refuses a `NUXT_`-prefixed name for its length alone; #275 taught it that an
 * upper-case name is words rather than a token.) This sentence carries no
 * observation at all: it is assembled from a compile-time map and
 * the names of files that are checked into the repository as `.example`s, so
 * there is nothing in it to withhold. The stable code that follows it is what
 * a machine reads.
 *
 * @param {{
 *   deployed?: boolean,
 *   env?: Record<string, string | undefined>,
 *   readSources?: () => readonly (string | null)[],
 * }} [options]
 */
export function requireLocalAcceptanceConfiguration({
	deployed,
	env = process.env,
	readSources = readLocalConfigurationFiles,
} = {}) {
	const decision = localAcceptanceConfiguration({ deployed, env, readSources });
	if (decision.missing.length === 0)
		return decision;

	process.stderr.write(`${localConfigurationNotice(decision.missing)}\n`);
	throw new AcceptanceFailure('harness-local-configuration-missing', {
		surface: sentenceList(decision.missing.map(name => LOCAL_NUXT_NAME_SURFACES[name]), 'and'),
	});
}
