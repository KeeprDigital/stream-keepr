import { describe, expect, it, vi } from 'vitest';
import {
	LOCAL_NUXT_NAME_SURFACES,
	LOCALLY_REQUIRED_NUXT_NAMES,
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
	requireLocalAcceptanceConfiguration,
	suppliedNames,
} from '../../../scripts/graphics-acceptance/local-configuration.mjs';

const SIGNING_KEY = 'NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY';
const ADMIN_TOKEN = 'NUXT_GRAPHICS_ADMIN_TOKEN';
/** A real one is 32 bytes base64; nothing here decodes it, only measures emptiness. */
const A_KEY = 'Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE=';

/** The three states a checkout's files can be in, as bodies the reader gets. */
const noFiles = () => [null, null, null];
const blankFiles = () => [null, `${SIGNING_KEY}=""\n${ADMIN_TOKEN}=""\n`, null];

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
		expect(missingLocalAcceptanceNames({})).toEqual([SIGNING_KEY]);
	});
});

describe('folding the checkout\'s sources into one answer', () => {
	it('reads the name out of any one of them', () => {
		for (const source of [
			{ [SIGNING_KEY]: A_KEY },
			`${SIGNING_KEY}=${A_KEY}`,
			`export ${SIGNING_KEY}="${A_KEY}"`,
		])
			expect(missingLocalAcceptanceNames(suppliedNames([source]))).toEqual([]);
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
		expect(missingLocalAcceptanceNames(supplied)).toEqual([]);
	});

	it('counts whitespace as blank, the way the readers do', () => {
		expect(missingLocalAcceptanceNames(suppliedNames([{ [SIGNING_KEY]: '   ' }]))).toEqual([SIGNING_KEY]);
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
		expect(missingLocalAcceptanceNames(supplied)).toEqual([]);
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
			.toEqual({ checked: true, missing: [SIGNING_KEY] });
		expect(readSources).toHaveBeenCalledTimes(1);
	});

	it('passes silently when a source supplies the name', () => {
		expect(requireLocalAcceptanceConfiguration({
			deployed: false,
			env: {},
			readSources: () => [null, `${SIGNING_KEY}=${A_KEY}`, null],
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
			detail: { surface: 'Screen Output asset capabilities' },
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
		expect(written.mock.calls[0]![0]).toBe(`${localConfigurationNotice([SIGNING_KEY])}\n`);
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
			+ 'NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY, so Screen Output asset capabilities answer 503 '
			+ 'and this run would never reach anything to assert. Nothing was proved and nothing was disproved. '
			+ 'A fresh git worktree is the usual way to arrive here — .env and .dev.vars are both gitignored, '
			+ 'so a new checkout inherits neither from the one it was branched from, and a copied example carries '
			+ 'the names with empty values. Fix: copy .env and .dev.vars in from the checkout you branched from, '
			+ 'or fill in .env.example and .dev.vars.example. A --deployed run reads neither file and is '
			+ 'unaffected. See docs/agents/parallel-rounds.md.',
		);
	});

	/**
	 * The state a developer working through `.env.example` one name at a time
	 * arrives in. The admin token is blank and the signing key is not, and the
	 * run is fine — so there must be no sentence at all.
	 */
	it('says nothing when only the name no harness reaches is blank', () => {
		expect(noticeFor(() => [null, `${ADMIN_TOKEN}=""\n${SIGNING_KEY}=${A_KEY}`, null])).toBeUndefined();
	});

	it('says nothing when the shell alone carries the name', () => {
		expect(noticeFor(noFiles, { [SIGNING_KEY]: A_KEY })).toBeUndefined();
	});

	it('says nothing when only the built worker\'s own copy carries it', () => {
		expect(noticeFor(() => [null, null, `${SIGNING_KEY}=${A_KEY}`])).toBeUndefined();
	});

	/**
	 * Unreachable today with one name required, and pinned anyway because the
	 * partition test above is designed to let a second name in. A sentence that
	 * has never been read in the plural is how #130's cell-H got written.
	 */
	it('joins names and surfaces when more than one is missing', () => {
		const both = localConfigurationNotice([ADMIN_TOKEN, SIGNING_KEY]);
		expect(both).toContain(
			'sets NUXT_GRAPHICS_ADMIN_TOKEN or NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY, '
			+ 'so Graphics Administrator operations and Screen Output asset capabilities answer 503',
		);
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

	it('names the missing name and not the one that is present', () => {
		expect(localConfigurationNotice([SIGNING_KEY])).not.toContain(ADMIN_TOKEN);
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
		const evidence = createAcceptanceEvidence({ harness: 'graphics-delivery-v1', secrets: [] });
		const surface = [...LOCALLY_REQUIRED_NUXT_NAMES].map(name => LOCAL_NUXT_NAME_SURFACES[name]).join(' and ');
		expect(evidence.report([{ code: 'harness-local-configuration-missing', detail: { surface } }]))
			.toBe(`graphics-delivery-v1 harness-local-configuration-missing surface=${surface}`);
	});
});
