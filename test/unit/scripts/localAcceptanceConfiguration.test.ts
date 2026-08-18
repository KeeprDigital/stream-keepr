import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
	LOCAL_NUXT_NAME_SURFACES,
	LOCALLY_REQUIRED_NUXT_NAMES,
	sentenceList,
} from '../../../build/devVars';
import {
	ACCEPTANCE_FAILURE_CODES,
	createAcceptanceEvidence,
} from '../../../scripts/graphics-acceptance/evidence.mjs';
import {
	LOCAL_ACCEPTANCE_REQUIRED_NUXT_NAMES,
	LOCAL_ACCEPTANCE_UNREACHED_NUXT_NAMES,
	LOCAL_CONFIGURATION_FILES,
	localAcceptanceConfiguration,
	localConfigurationNotice,
	missingLocalAcceptanceNames,
	previewStagingPlan,
	requireLocalAcceptanceConfiguration,
	RESOLVED_PREVIEW_DEV_VARS,
	suppliedNames,
} from '../../../scripts/graphics-acceptance/local-configuration.mjs';

const SIGNING_KEY = 'NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY';
const ADMIN_TOKEN = 'NUXT_GRAPHICS_ADMIN_TOKEN';
const AUTH_SECRET = 'NUXT_BETTER_AUTH_SECRET';
const BOOTSTRAP_TOKEN = 'NUXT_ADMIN_BOOTSTRAP_TOKEN';
/** A real one is 32 bytes base64; nothing here decodes it, only measures emptiness. */
const A_KEY = 'Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE=';

/**
 * Every name a local run needs, as a `.dev.vars` body — because "configured" has
 * meant three names since #396 and a fixture that supplies one of them is a
 * fixture about a broken checkout wearing the name of a working one.
 */
function configuredBody() {
	return LOCAL_ACCEPTANCE_REQUIRED_NUXT_NAMES
		.map(name => `${name}=${name === SIGNING_KEY ? A_KEY : 'a-value'}`)
		.join('\n');
}

/** The three states a checkout's files can be in, as bodies the reader gets. */
const noFiles = () => [null, null, null];

function blankFiles() {
	const blanks = [...LOCAL_ACCEPTANCE_REQUIRED_NUXT_NAMES, ADMIN_TOKEN].map(name => `${name}=""`).join('\n');
	return [null, `${blanks}\n`, null];
}

describe('which required names a local acceptance run needs', () => {
	/**
	 * The drift pin the shared import exists for. `build/devVars.ts` owns the
	 * list; this file owns only the partition of it, and a third required name
	 * added there has to be classified before it can reach a harness. Without
	 * this, a new name would simply never be checked by the preflight and
	 * nothing would say so.
	 */
	it('classifies every required name as either needed here or unreached', () => {
		expect([...LOCAL_ACCEPTANCE_REQUIRED_NUXT_NAMES, ...LOCAL_ACCEPTANCE_UNREACHED_NUXT_NAMES].sort())
			.toEqual([...LOCALLY_REQUIRED_NUXT_NAMES].sort());
	});

	it('claims no name that is not required of a checkout in the first place', () => {
		for (const name of LOCAL_ACCEPTANCE_REQUIRED_NUXT_NAMES)
			expect(LOCALLY_REQUIRED_NUXT_NAMES).toContain(name);
	});

	/**
	 * `requireGraphicsAdministrator` is mounted only under the `server/api/admin`
	 * tree and no acceptance route is an admin route, so a run blocked on the admin
	 * token would be refused for a surface it never touches — #130's cell-H
	 * defect wearing this ticket's clothes.
	 */
	it('does not need the admin token, which no acceptance route can reach', () => {
		expect(LOCAL_ACCEPTANCE_REQUIRED_NUXT_NAMES).not.toContain(ADMIN_TOKEN);
		expect(missingLocalAcceptanceNames({})).not.toContain(ADMIN_TOKEN);
	});

	/**
	 * #396's addition, and the distinction that makes it not a cell-H false alarm.
	 *
	 * Both names are things a local run genuinely cannot proceed without once
	 * `/api/**` denies by default: the installation cannot admit anybody at all
	 * without the secret, and the harness acquires its operator by calling the
	 * first-admin bootstrap with the token. What makes requiring the *token* honest
	 * is that a deployed run — the one that has no bootstrap secret to read — is
	 * not checked here at all.
	 */
	it('needs the auth secret and the bootstrap token a local run signs in with', () => {
		expect(missingLocalAcceptanceNames({})).toEqual([SIGNING_KEY, AUTH_SECRET, BOOTSTRAP_TOKEN]);
		expect(localAcceptanceConfiguration({ deployed: true, env: {}, readSources: noFiles }).missing).toEqual([]);
	});
});

/**
 * The fold, read one name at a time.
 *
 * On the signing key rather than on "nothing is missing", because three names are
 * required of a local run since #396 and a fixture that supplies one of them is a
 * checkout that would still be refused. What these rows are about is whether a
 * value survives the fold, which is a question about one name.
 */
describe('folding the checkout\'s sources into one answer', () => {
	it('reads the name out of any one of them', () => {
		for (const source of [
			{ [SIGNING_KEY]: A_KEY },
			`${SIGNING_KEY}=${A_KEY}`,
			`export ${SIGNING_KEY}="${A_KEY}"`,
		])
			expect(missingLocalAcceptanceNames(suppliedNames([source]))).not.toContain(SIGNING_KEY);
	});

	it('reads every name a local run needs, not only the first', () => {
		// The negative control for the rows above: they would all pass against a
		// fold that had stopped reading anything but the signing key.
		expect(missingLocalAcceptanceNames(suppliedNames([configuredBody()]))).toEqual([]);
	});

	/**
	 * The reason three files are read rather than one: any of them may be the
	 * filled-in one, and an earlier blank must not shadow a later value.
	 */
	it('lets a later source supply what an earlier one left blank', () => {
		const supplied = suppliedNames([
			{ [SIGNING_KEY]: '' },
			`${SIGNING_KEY}=""`,
			`${SIGNING_KEY}=${A_KEY}`,
		]);
		expect(supplied[SIGNING_KEY]).toBe(A_KEY);
		expect(missingLocalAcceptanceNames(supplied)).not.toContain(SIGNING_KEY);
	});

	it('counts whitespace as blank, the way the readers do', () => {
		expect(missingLocalAcceptanceNames(suppliedNames([{ [SIGNING_KEY]: '   ' }]))).toContain(SIGNING_KEY);
	});

	/**
	 * The assertion above does not actually reach the trim in `suppliedNames`:
	 * `missingLocalNuxtNames` trims again downstream, so a whitespace value that
	 * got through the fold is still counted missing and the mutation survives.
	 * What only this case can catch is the shadowing — a `.env` holding a stray
	 * space would otherwise occupy the name and hide the real `.dev.vars` value,
	 * which is a false alarm on a checkout that works.
	 */
	it('does not let a whitespace-only earlier source shadow a real later one', () => {
		const supplied = suppliedNames([{ [SIGNING_KEY]: '   ' }, `${SIGNING_KEY}=${A_KEY}`]);
		expect(supplied[SIGNING_KEY]).toBe(A_KEY);
		expect(missingLocalAcceptanceNames(supplied)).not.toContain(SIGNING_KEY);
	});

	it('skips a source that is not there at all', () => {
		expect(suppliedNames([null, undefined, `${SIGNING_KEY}=${A_KEY}`])[SIGNING_KEY]).toBe(A_KEY);
	});

	/**
	 * Measured, not assumed: wrangler resolves `.dev.vars` against its config
	 * file's directory, and `pnpm preview` passes
	 * `--config .output/server/wrangler.json`. Someone who has worked that out
	 * has the name in a place the repository root does not hold.
	 */
	it('looks in the three places this checkout keeps such a name', () => {
		expect(LOCAL_CONFIGURATION_FILES).toEqual(['.env', '.dev.vars', '.output/server/.dev.vars']);
	});
});

describe('a deployed run', () => {
	it('is not checked, and does not open a local file to decide that', () => {
		const readSources = vi.fn(() => {
			throw new Error('a deployed run must not read local configuration');
		});
		expect(localAcceptanceConfiguration({ deployed: true, env: {}, readSources }))
			.toEqual({ checked: false, missing: [] });
		expect(readSources).not.toHaveBeenCalled();
	});

	it('never throws, however empty the checkout is', () => {
		expect(requireLocalAcceptanceConfiguration({
			deployed: true,
			env: {},
			readSources: noFiles,
		})).toEqual({ checked: false, missing: [] });
	});
});

describe('a local run', () => {
	it('is checked, and reads the sources to decide', () => {
		const readSources = vi.fn(noFiles);
		expect(localAcceptanceConfiguration({ deployed: false, env: {}, readSources }))
			.toEqual({ checked: true, missing: [...LOCAL_ACCEPTANCE_REQUIRED_NUXT_NAMES] });
		expect(readSources).toHaveBeenCalledTimes(1);
	});

	it('passes silently when a source supplies the names', () => {
		expect(requireLocalAcceptanceConfiguration({
			deployed: false,
			env: {},
			readSources: () => [null, configuredBody(), null],
		})).toEqual({ checked: true, missing: [] });
	});

	it('stops the run with a stable code rather than letting it 503 its way to nothing', () => {
		// Silenced only so a passing suite does not print the notice; the test
		// below is the one that reads what was written.
		vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		expect(() => requireLocalAcceptanceConfiguration({
			deployed: false,
			env: {},
			readSources: noFiles,
		})).toThrow(expect.objectContaining({
			code: 'harness-local-configuration-missing',
			detail: {
				surface: 'Screen Output asset capabilities, signing in and every authenticated API route, '
					+ 'and first-admin bootstrap',
			},
		}));
	});

	it('prints the notice before it throws, so the code has prose above it', () => {
		const written = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		expect(() => requireLocalAcceptanceConfiguration({
			deployed: false,
			env: {},
			readSources: noFiles,
		})).toThrow();
		expect(written).toHaveBeenCalledTimes(1);
		expect(written.mock.calls[0]![0])
			.toBe(`${localConfigurationNotice([...LOCAL_ACCEPTANCE_REQUIRED_NUXT_NAMES])}\n`);
	});
});

/**
 * The #130 lesson, applied to this ticket's notice: the defect class is a
 * sentence, so the sentence is read in every state it can be produced in
 * rather than merely asserted to contain a substring.
 */
describe('the notice, read as prose', () => {
	function noticeFor(readSources: () => (string | null)[], env: Record<string, string> = {}) {
		const decision = localAcceptanceConfiguration({ deployed: false, env, readSources });
		return decision.missing.length === 0 ? undefined : localConfigurationNotice(decision.missing);
	}

	/** No file at all — the fresh worktree the ticket is about. */
	it('is the same sentence whether the file is absent or its value is blank', () => {
		expect(noticeFor(noFiles)).toBe(noticeFor(blankFiles));
		expect(noticeFor(noFiles)).toBe(
			'Nothing this checkout can give a local installation sets '
			+ 'NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY, NUXT_BETTER_AUTH_SECRET, or NUXT_ADMIN_BOOTSTRAP_TOKEN, '
			+ 'so Screen Output asset capabilities, signing in and every authenticated API route, '
			+ 'and first-admin bootstrap answer 503 '
			+ 'and this run would never reach anything to assert. Nothing was proved and nothing was disproved. '
			+ 'NUXT_GRAPHICS_ADMIN_TOKEN is not checked here and a blank one is not what stopped this: '
			+ 'no route an acceptance run calls reads it. '
			+ 'A fresh git worktree is the usual way to arrive here — .env and .dev.vars are both gitignored, '
			+ 'so a new checkout inherits neither from the one it was branched from, and a copied example carries '
			+ 'the names with empty values. Fix: copy .env and .dev.vars in from the checkout you branched from, '
			+ 'or fill in .env.example and .dev.vars.example — `pnpm preview` stages .dev.vars into '
			+ '.output/server/, which is where wrangler resolves it from the config. '
			+ 'A --deployed run reads neither file and is unaffected. See docs/agents/parallel-rounds.md.',
		);
	});

	/**
	 * The excluded name is named, so a reader who has just been told their run
	 * is blocked does not go hunting for the other blank in `.dev.vars`. Read
	 * against the partition rather than a literal, so the clause cannot outlive
	 * the list it describes.
	 */
	it('says which required name it is deliberately not checking, and why', () => {
		const notice = localConfigurationNotice([SIGNING_KEY]);
		for (const name of LOCAL_ACCEPTANCE_UNREACHED_NUXT_NAMES)
			expect(notice).toContain(`${name} is not checked here`);
		expect(notice).toContain('no route an acceptance run calls reads it');
	});

	/**
	 * The first draft of that clause was false in the plural state: it named the
	 * admin token as a cause and then said the admin token was not checked. A
	 * name cannot be both, so the clause covers only names that are NOT missing.
	 */
	it('does not excuse a name it has just blamed', () => {
		const both = localConfigurationNotice([ADMIN_TOKEN, SIGNING_KEY]);
		expect(both).toContain(`sets ${ADMIN_TOKEN} or`);
		expect(both).not.toContain(`${ADMIN_TOKEN} is not checked here`);
	});

	/**
	 * The advice has to carry the mechanism, because the copy step alone is
	 * necessary and not sufficient — that was the whole defect (#274).
	 */
	it('says where the copied file actually has to end up', () => {
		expect(localConfigurationNotice([SIGNING_KEY]))
			.toContain('`pnpm preview` stages .dev.vars into .output/server/');
	});

	/**
	 * The state a developer working through `.env.example` one name at a time
	 * arrives in. The admin token is blank and the signing key is not, and the
	 * run is fine — so there must be no sentence at all.
	 */
	it('says nothing when only the name no harness reaches is blank', () => {
		expect(noticeFor(() => [null, `${ADMIN_TOKEN}=""\n${configuredBody()}`, null])).toBeUndefined();
	});

	it('says nothing when the shell alone carries the names', () => {
		const env = Object.fromEntries(LOCAL_ACCEPTANCE_REQUIRED_NUXT_NAMES.map(name => [name, A_KEY]));

		expect(noticeFor(noFiles, env)).toBeUndefined();
	});

	it('says nothing when only the built worker\'s own copy carries them', () => {
		expect(noticeFor(() => [null, null, configuredBody()])).toBeUndefined();
	});

	it('joins two names and surfaces with a plain conjunction', () => {
		const both = localConfigurationNotice([ADMIN_TOKEN, SIGNING_KEY]);
		expect(both).toContain(
			'sets NUXT_GRAPHICS_ADMIN_TOKEN or NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY, '
			+ 'so Graphics Administrator operations and Screen Output asset capabilities answer 503',
		);
	});

	/**
	 * Three is the reachable state as of #396, and the serial comma in it is
	 * load-bearing rather than decorative: one of the surfaces contains an `and` of
	 * its own ('signing in and every authenticated API route'), so a list joined
	 * with bare conjunctions reads as five surfaces where there are three. The
	 * plural sentence had never been read in this state, which is exactly how
	 * #130's cell-H got written.
	 */
	it('separates three surfaces from the conjunction inside one of them', () => {
		const all = localConfigurationNotice([...LOCAL_ACCEPTANCE_REQUIRED_NUXT_NAMES]);

		expect(all).toContain(
			'so Screen Output asset capabilities, signing in and every authenticated API route, '
			+ 'and first-admin bootstrap answer 503',
		);
		expect(all).not.toContain('capabilities and signing in');
	});

	/**
	 * The surfaces are the map's, not this file's. Swapping the map's strings has
	 * to change the sentence, or the reuse is decorative and a future edit to
	 * `devVars.ts` would leave the notice claiming the old surface.
	 */
	it('names the surface the shared map gives, not one of its own', () => {
		expect(localConfigurationNotice([SIGNING_KEY]))
			.toContain(`so ${LOCAL_NUXT_NAME_SURFACES[SIGNING_KEY]} answer 503`);
		expect(localConfigurationNotice([SIGNING_KEY]))
			.not
			.toContain(LOCAL_NUXT_NAME_SURFACES[ADMIN_TOKEN]);
	});

	/**
	 * The name that is present may appear — the clause above exists to say it is
	 * not the problem — but it must never appear as the CAUSE, so this reads the
	 * causal clause on its own rather than the whole sentence.
	 */
	it('names the missing name and not the one that is present as the cause', () => {
		const notice = localConfigurationNotice([SIGNING_KEY]);
		const cause = notice.slice(0, notice.indexOf('and this run would never reach'));
		expect(cause).toContain(SIGNING_KEY);
		expect(cause).not.toContain(ADMIN_TOKEN);
		expect(cause).not.toContain(LOCAL_NUXT_NAME_SURFACES[ADMIN_TOKEN]);
	});

	/**
	 * The instruction has to be the one `docs/agents/parallel-rounds.md` gives,
	 * spelled out rather than gestured at, and it must not be satisfiable by the
	 * example files' own names — `.env.example` is not `.env`.
	 */
	it('gives the copy step literally', () => {
		expect(localConfigurationNotice([SIGNING_KEY]))
			.toContain('copy .env and .dev.vars in from the checkout you branched from');
		expect(localConfigurationNotice([SIGNING_KEY])).toMatch(/\.env(?!\.example)/);
	});
});

/**
 * The staging step is the half of #274 that makes the documentation true, and
 * it lives in a `package.json` line nothing else would notice the loss of.
 */
describe('the preview command', () => {
	const packageJson = JSON.parse(
		readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
	) as { scripts: Record<string, string> };

	/**
	 * All three positions, because two of them are not enough. The first version
	 * of this test pinned only staging-before-wrangler, and rev-274 ran the row it
	 * was missing: reordering to `stage && build && migrate && wrangler` passed
	 * every test with zero failures. It also silently restores #274's original
	 * defect, because `nuxt build` rebuilds `.output` — a sentinel written to
	 * `.output/server/.dev.vars` is gone afterwards — so a stage that runs first
	 * is a stage that never happened, and the previewed Worker comes up with no
	 * secrets again. The module docblock already stated this invariant; nothing
	 * made it executable.
	 */
	it('builds, then stages the secrets, then starts wrangler', () => {
		const preview = packageJson.scripts.preview!;
		const built = preview.indexOf('pnpm build');
		const staged = preview.indexOf('scripts/stage-preview-secrets.mjs');
		const wrangler = preview.indexOf('wrangler dev');
		expect(built).toBeGreaterThan(-1);
		// Staging into `.output/server` is only meaningful once the build that
		// creates — and wipes — that directory has finished.
		expect(built).toBeLessThan(staged);
		expect(staged).toBeGreaterThan(-1);
		expect(wrangler).toBeGreaterThan(-1);
		expect(staged).toBeLessThan(wrangler);
	});

	/**
	 * The staging step only matters because of where the config lives; if the
	 * preview command stopped pointing at `.output/server`, the resolved path
	 * this whole mechanism is built around would be the wrong one.
	 */
	it('still points wrangler at the config the resolved path is derived from', () => {
		expect(packageJson.scripts.preview).toContain('--config .output/server/wrangler.json');
		expect(RESOLVED_PREVIEW_DEV_VARS).toBe('.output/server/.dev.vars');
	});
});

describe('staging .dev.vars for the preview', () => {
	const source = `${SIGNING_KEY}=${A_KEY}\n`;

	it('does nothing at all when there is no .dev.vars to stage', () => {
		expect(previewStagingPlan({ source: null, existing: null }))
			.toEqual({ stage: false, lines: [] });
	});

	it('stages quietly when nothing is there yet', () => {
		const plan = previewStagingPlan({ source, existing: null });
		expect(plan.stage).toBe(true);
		expect(plan.lines).toHaveLength(1);
		expect(plan.lines[0]).toContain(`Staged .dev.vars into ${RESOLVED_PREVIEW_DEV_VARS}`);
	});

	it('stages quietly when the staged copy already matches', () => {
		expect(previewStagingPlan({ source, existing: source }).lines).toHaveLength(1);
	});

	/**
	 * #189 hand-maintained this file with a name the root copy did not carry. An
	 * unannounced overwrite would have removed it and left a preview failing for
	 * a reason nothing on screen explained — this ticket's own defect class, one
	 * layer up. It still overwrites; it no longer does so silently.
	 */
	it('says so before replacing a staged copy that differs', () => {
		const plan = previewStagingPlan({ source, existing: `${source}NUXT_ABLY_API_KEY=live\n` });
		expect(plan.stage).toBe(true);
		expect(plan.lines).toHaveLength(2);
		expect(plan.lines[0]).toContain('differs from the .dev.vars it is staged from');
		expect(plan.lines[0]).toContain('about to be lost');
	});

	/** The warning must not become noise on the ordinary path. */
	it('does not cry replacement when the two agree', () => {
		for (const existing of [null, source]) {
			for (const line of previewStagingPlan({ source, existing }).lines)
				expect(line).not.toContain('about to be lost');
		}
	});
});

describe('the failure this preflight raises', () => {
	it('is a registered code', () => {
		expect(ACCEPTANCE_FAILURE_CODES).toContain('harness-local-configuration-missing');
	});

	/**
	 * The evidence formatter refuses long values and opaque tokens, and a
	 * `NUXT_`-prefixed name trips the second on sight. That is why the names go
	 * in the prose and only the surfaces go in the detail — and if a future
	 * surface string grew past those rules, the harness would throw a leak error
	 * instead of the notice it was trying to print.
	 */
	it('prints through the evidence gate without tripping it', () => {
		// The **worst case this failure can actually produce**, which is every name a
		// local run is checked for and not every name a checkout is required to have:
		// the admin token is never in this list, because no acceptance route reads it.
		// Read as the worst case rather than as one name, because the gate refuses a
		// detail over 120 characters and three surfaces come to 103 — so a fourth
		// required-here name would turn a helpful notice into a leak error about the
		// notice, and this row is what says so first.
		const evidence = createAcceptanceEvidence({ harness: 'graphics-delivery-v1', secrets: [] });
		const surface = sentenceList(
			LOCAL_ACCEPTANCE_REQUIRED_NUXT_NAMES.map(name => LOCAL_NUXT_NAME_SURFACES[name]),
			'and',
		);

		expect(evidence.report([{ code: 'harness-local-configuration-missing', detail: { surface } }]))
			.toBe(`graphics-delivery-v1 harness-local-configuration-missing surface=${surface}`);
	});
});
