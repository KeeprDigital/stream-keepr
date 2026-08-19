import type { LocallyRequiredNuxtName } from '~~/build/localConfiguration';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	announcesLocalConfiguration,
	LOCAL_NUXT_NAME_SURFACES,
	localConfigurationBootNotice,
	localConfigurationLogLine,
	LOCALLY_OPTIONAL_NUXT_NAMES,
	LOCALLY_REQUIRED_NUXT_NAMES,
	missingLocalNuxtNames,
	parseDotenv,
} from '~~/build/localConfiguration';

/** The name of the file #412 deleted, named once for the rows that rule it out. */
const DELETED_FILE = '.dev.vars';

/**
 * A configured checkout: every required name set, which since #412 means one
 * file supplied them.
 *
 * Built from `LOCALLY_REQUIRED_NUXT_NAMES` rather than written out, because the
 * cells below mean "a configured checkout" and a transcription of the list stops
 * meaning that the moment the list grows — silently, since a fourth name absent
 * from a fixture called `configuredEnv` reads as configured to every reader and as
 * missing to every assertion. #396 added two names and found this the hard way.
 *
 * The values are per-name only where the shape matters: the signing key is read as
 * 32-byte base64 by the surface that needs it, and a fixture that could not be one
 * would be a lie about what a configured checkout holds.
 */
const CONFIGURED_VALUES: Partial<Record<LocallyRequiredNuxtName, string>> = {
	NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
};

function configuredEnv(): Record<string, string | undefined> {
	return Object.fromEntries(
		LOCALLY_REQUIRED_NUXT_NAMES.map(name => [name, CONFIGURED_VALUES[name] ?? 'from-dotenv']),
	);
}

describe('which processes say anything about local configuration at all', () => {
	it('speaks in an ordinary dev server, which is the whole point', () => {
		expect(announcesLocalConfiguration({ dev: true, env: {} })).toBe(true);
	});

	/**
	 * A build's names come from Worker secrets, and its process is not a checkout
	 * anybody is about to develop in. #130's notice is advice to a developer at a
	 * dev server, and a build reading it would be a build being told to copy a file
	 * that must never reach its output.
	 */
	it('says nothing in a build, whose names are not a checkout\'s to supply', () => {
		expect(announcesLocalConfiguration({ dev: false, env: {} })).toBe(false);
	});

	/**
	 * The integration suite runs its own `nuxt dev`, and pins the names it needs
	 * into the *server child's* environment rather than its own. Its parent process
	 * is therefore short of every one of them by design, so a notice keyed on what
	 * this process can supply would fire on every run of a suite that is behaving
	 * exactly as intended.
	 *
	 * Before #412 this refusal did a second job — it kept a developer's `.dev.vars`
	 * from being adopted into the parent and inherited by the child, where only the
	 * names the suite thought to pin were overridden (#197, #222). That job went
	 * away with the file and the adoption; the silence is now about noise alone.
	 */
	it('says nothing under the integration suite, whose environment is its own', () => {
		expect(announcesLocalConfiguration({ dev: true, env: { STREAM_KEEPR_INTEGRATION: 'true' } })).toBe(false);
	});

	it('reads that announcement exactly as the rest of the repo reads it', () => {
		// `nuxt.config.ts` and `server/plugins/error-handler.ts` both test for
		// `'true'`. A looser reading here would silence the notice for a developer
		// who happens to have the variable set to anything else at all.
		expect(announcesLocalConfiguration({ dev: true, env: { STREAM_KEEPR_INTEGRATION: 'false' } })).toBe(true);
		expect(announcesLocalConfiguration({ dev: true, env: { STREAM_KEEPR_INTEGRATION: '' } })).toBe(true);
	});
});

/**
 * #130: that a checkout with no local configuration says so once, at boot.
 *
 * The trap the issue is about is a fresh `git worktree`, which inherits no `.env`
 * because it is gitignored, and then fails in whatever way the first surface
 * needing a secret fails. That is unit-testable only because the decision lives
 * here rather than in the Nuxt module — the #242 precedent — so what the notice
 * says and which runs get it are both settled in this file.
 */
describe('which names a local checkout has to be given', () => {
	it('counts a blank as missing, the way the readers that refuse count it', () => {
		// `requireGraphicsAdministrator` trims before testing, `signingKey` rejects
		// the empty string, and `serverAuth` trims as of #396 — so a name set to ''
		// or to a space is not configured. It is also the likeliest wrong state there
		// is: `cp .env.example .env` produces exactly it, and this notice is where
		// that advice comes from.
		const blanks = Object.fromEntries(LOCALLY_REQUIRED_NUXT_NAMES.map((name, index) => [name, index % 2 === 0 ? '' : '   ']));

		expect(missingLocalNuxtNames(blanks)).toEqual([...LOCALLY_REQUIRED_NUXT_NAMES]);
	});

	it('counts nothing as missing once they are all set', () => {
		expect(missingLocalNuxtNames(configuredEnv())).toEqual([]);
	});

	it('reports only the one that is actually absent', () => {
		const env = configuredEnv();
		delete env.NUXT_GRAPHICS_ADMIN_TOKEN;

		expect(missingLocalNuxtNames(env)).toEqual(['NUXT_GRAPHICS_ADMIN_TOKEN']);
	});

	/**
	 * Repointed from `.dev.vars.example` on #412, which is the whole of what the
	 * partition lost when that file went: `.env.example` is now the file a
	 * developer copies, and it assigns three names the old one never did.
	 */
	it('partitions exactly the names `.env.example` assigns', () => {
		// The honest home for "the known names". The example file is what a developer
		// copies, so a ninth name added there has to be sorted into required or
		// deliberately-optional before this passes — rather than silently becoming a
		// name the notice never mentions.
		const example = readFileSync(fileURLToPath(new URL('../../../.env.example', import.meta.url)), 'utf8');
		const assigned = [...example.matchAll(/^(NUXT_\w+)=/gm)].map(match => match[1]).sort();

		expect(assigned).toEqual([...LOCALLY_REQUIRED_NUXT_NAMES, ...LOCALLY_OPTIONAL_NUXT_NAMES].sort());
	});

	it('gives every required name a surface, in that surface\'s own words', () => {
		// `satisfies` already makes a missing entry a type error; this pins the other
		// half, that each string is the one the refusal actually uses, so a reader can
		// match the notice to the 503 they are looking at.
		expect(Object.keys(LOCAL_NUXT_NAME_SURFACES).sort()).toEqual([...LOCALLY_REQUIRED_NUXT_NAMES].sort());
		expect(LOCAL_NUXT_NAME_SURFACES.NUXT_GRAPHICS_ADMIN_TOKEN).toBe('Graphics Administrator operations');
		expect(LOCAL_NUXT_NAME_SURFACES.NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY).toBe('Screen Output asset capabilities');
		expect(LOCAL_NUXT_NAME_SURFACES.NUXT_BETTER_AUTH_SECRET).toBe('signing in and every authenticated API route');
		expect(LOCAL_NUXT_NAME_SURFACES.NUXT_ADMIN_BOOTSTRAP_TOKEN).toBe('first-admin bootstrap');
	});

	it('leaves the Ably key deliberately optional, because #223 already owns it', () => {
		// An empty Ably key is the expected state of a checkout that never claimed to
		// have realtime. Requiring it here would warn every such checkout about a
		// third-party secret it does not need, which is #223's failure mode inverted.
		expect(LOCALLY_REQUIRED_NUXT_NAMES).not.toContain('NUXT_ABLY_API_KEY');
		expect(LOCALLY_OPTIONAL_NUXT_NAMES).toContain('NUXT_ABLY_API_KEY');
	});

	/**
	 * The three names #412 brought into the partition, and the side they belong on.
	 *
	 * They were outside it until this ticket only because the partition was pinned
	 * against `.dev.vars.example`, which never assigned them — the reason the ticket
	 * gives for a previewed Worker having no Melee credential key at all. Optional
	 * because nothing refuses at boot without them: a notice naming them would send a
	 * developer after a secret they do not need yet, which is cell H's lesson.
	 */
	it('leaves the Melee names optional, because nothing refuses at boot without them', () => {
		for (const name of [
			'NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY',
			'NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY_VERSION',
			'NUXT_MELEE_CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS',
		] as const) {
			expect(LOCALLY_OPTIONAL_NUXT_NAMES).toContain(name);
			expect(LOCALLY_REQUIRED_NUXT_NAMES).not.toContain(name);
		}
	});

	/**
	 * #396's half of the #394 handoff, pinned rather than left to a docblock.
	 *
	 * Both names sat in the optional list from #393 and #394 with a written promise
	 * that the boundary ticket would move them, and the shape of the failure if it
	 * did not is a silent one: the boundary lands, a checkout without either name
	 * can sign in to nothing at all, and the boot notice says nothing because these
	 * two are still "deliberately optional". A comment cannot fail; this can.
	 */
	it('requires the two auth names, now that a checkout without them can sign in to nothing', () => {
		expect(LOCALLY_REQUIRED_NUXT_NAMES).toContain('NUXT_BETTER_AUTH_SECRET');
		expect(LOCALLY_REQUIRED_NUXT_NAMES).toContain('NUXT_ADMIN_BOOTSTRAP_TOKEN');
		expect(LOCALLY_OPTIONAL_NUXT_NAMES).not.toContain('NUXT_BETTER_AUTH_SECRET');
		expect(LOCALLY_OPTIONAL_NUXT_NAMES).not.toContain('NUXT_ADMIN_BOOTSTRAP_TOKEN');
	});
});

/**
 * #130: that a checkout without local configuration says so once, at boot — and that
 * a checkout *with* it says nothing.
 *
 * The cells are the whole point, and the one #130's review found is the one where a
 * populated `.env` supplies the names. The first version keyed the notice on a
 * missing `.dev.vars` file alone, which is wrong because Nuxt loads `.env` into
 * `process.env` before a module's `setup` runs — a developer who read #130's own
 * `.env`-centric ticket text and copied `.env` alone was then told their working
 * installation kept its empty defaults and answered 503. Both clauses false, from a
 * notice that exists to stop false readings.
 *
 * #412 deleted the file the other cells were about, and left this one: keyed on the
 * names, it is the only cell there ever needed to be.
 */
describe('what a dev server says about its local configuration', () => {
	it('warns when nothing in the environment supplies the names', () => {
		const line = localConfigurationLogLine({ dev: true, env: {} });

		expect(line?.level).toBe('warn');
		for (const name of LOCALLY_REQUIRED_NUXT_NAMES)
			expect(line?.message).toContain(name);
	});

	it('warns about an `.env` that exists and supplies nothing', () => {
		// `cp .env.example .env`, which is advice this very notice gives. Keyed on
		// the names, this cell is covered for free; keyed on the file it would have
		// been silent here, which is a real 503 with no explanation.
		const blanks = Object.fromEntries(LOCALLY_REQUIRED_NUXT_NAMES.map(name => [name, '']));

		expect(localConfigurationLogLine({ dev: true, env: blanks })?.level).toBe('warn');
	});

	/**
	 * The configured checkout, which is now the ordinary one: `.env` is loaded into
	 * `process.env` before this module's `setup` runs, so by the time the decision is
	 * made the names are simply there. Saying anything here is saying something false.
	 */
	it('says nothing when `.env` already supplied the names', () => {
		expect(localConfigurationLogLine({ dev: true, env: configuredEnv() })).toBeUndefined();
	});

	it('stays silent for the two runs that are not a developer\'s dev server', () => {
		// Both are short of these names in their own process — the integration suite
		// pins them into the server child's environment, not its own — so a gate on
		// `missing` alone would warn them on every run about behaving correctly.
		const integration = localConfigurationLogLine({
			dev: true,
			env: { STREAM_KEEPR_INTEGRATION: 'true' },
		});
		const build = localConfigurationLogLine({ dev: false, env: {} });

		expect(integration).toBeUndefined();
		expect(build).toBeUndefined();
	});

	/**
	 * Cell H: `.env` supplies the admin token and not the signing key.
	 *
	 * The residual #130's verification found. Naming the missing *name* correctly is
	 * not enough — the causal clause named both surfaces unconditionally, so this
	 * developer was told Graphics Administrator operations answer 503 while they
	 * demonstrably worked. It is the most ordinary way to arrive anywhere near here:
	 * filling in `.env.example` one name at a time, with the signing key left for
	 * last because it needs an `openssl` command to generate.
	 */
	it('names only the one that is missing when only one is, and only its surface', () => {
		const env = configuredEnv();
		delete env.NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY;

		const line = localConfigurationLogLine({ dev: true, env });

		expect(line?.level).toBe('warn');
		expect(line?.message).toContain('NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY');
		expect(line?.message).not.toContain('NUXT_GRAPHICS_ADMIN_TOKEN');
		expect(line?.message).toContain('Screen Output asset capabilities');
		// The mirror assertion, and the whole of cell H: the surface that still works
		// must not be named. `requireGraphicsAdministrator` refuses only on an empty
		// token and otherwise falls through to its 403 branch.
		expect(line?.message).not.toContain('Graphics Administrator');
		// Singular, because a notice that says "they keep their empty default" about
		// one name reads as though a second thing is wrong that the reader cannot find.
		expect(line?.message).toContain('it keeps its');
		// And no "each says so on its own", which needs more than one to be true.
		expect(line?.message).not.toContain('each says so');
	});

	/** Cell H's mirror, so neither surface is named unconditionally in either direction. */
	it('names only the admin surface when only the admin token is missing', () => {
		const env = configuredEnv();
		delete env.NUXT_GRAPHICS_ADMIN_TOKEN;

		const line = localConfigurationLogLine({ dev: true, env });

		expect(line?.message).toContain('Graphics Administrator operations');
		expect(line?.message).not.toContain('Screen Output asset capabilities');
	});

	/**
	 * Cell H for each of #396's two names, because the lesson of cell H is that a
	 * surface named where its words are false is worse than no notice — and these two
	 * are the ones a reader is least able to check for themselves. A developer told
	 * that signing in is unavailable, on a checkout where it works, would go looking
	 * for a boundary defect.
	 */
	it.each([
		['NUXT_BETTER_AUTH_SECRET', 'signing in and every authenticated API route'],
		['NUXT_ADMIN_BOOTSTRAP_TOKEN', 'first-admin bootstrap'],
	] as const)('names only %s\'s surface when only it is missing', (missing, surface) => {
		const env = configuredEnv();
		delete env[missing];

		const line = localConfigurationLogLine({ dev: true, env });

		expect(line?.level).toBe('warn');
		expect(line?.message).toContain(missing);
		expect(line?.message).toContain(surface);
		expect(line?.message).toContain('it keeps its');
		for (const other of LOCALLY_REQUIRED_NUXT_NAMES.filter(name => name !== missing)) {
			expect(line?.message).not.toContain(other);
			expect(line?.message).not.toContain(LOCAL_NUXT_NAME_SURFACES[other]);
		}
	});
});

describe('the notice a missing name produces', () => {
	const notice = localConfigurationBootNotice([...LOCALLY_REQUIRED_NUXT_NAMES]);

	/**
	 * One file, since #412. The notice named two and a copy step for both, and the
	 * second of them no longer exists — a reader sent after it would spend the trip
	 * and arrive at nothing, which is this repository's own definition of a comment
	 * worse than no comment.
	 */
	it('names the one gitignored file, so the reader knows what to copy', () => {
		// The lookahead is load-bearing. `toContain('.env')` is satisfied by
		// `.env.example`, so the first version of this assertion passed against a
		// notice that had stopped naming `.env` at all.
		expect(notice).toMatch(/\.env(?!\.example)/);
		expect(notice).toContain('.env.example');
		expect(notice).not.toContain(DELETED_FILE);
	});

	it('names the cause and the fix, not just the condition', () => {
		// The state is something a reader can already see. What they cannot see is
		// that a worktree is why, and that a copy closes it.
		expect(notice).toContain('git worktree');
		expect(notice).toContain('gitignored');
		expect(notice).toContain('Fix:');
	});

	it('warns that a copied .env.example is not a configured one', () => {
		// The trap inside the fix: the advice this notice gives produces a file whose
		// names are all blank, and a reader who followed it deserves to know that.
		expect(notice).toContain('empty values');
	});

	it('names the 503s it is explaining, which is how a reader connects the two', () => {
		expect(notice).toContain('503');
		expect(notice).toContain('Graphics Administrator');
		expect(notice).toContain('Screen Output asset capabilities');
	});

	it('points at a document that carries the copy step it promises', () => {
		// Read rather than asserted, because a pointer to a step that has been edited
		// away is worse than no pointer: it costs the reader the trip and they arrive
		// at a hazard list with no instruction in it.
		//
		// The command itself rather than a mention of the filename. The document
		// names the file a dozen times over — a check for that is satisfied by prose
		// about the problem, which is exactly what the reader already has.
		const doc = readFileSync(fileURLToPath(new URL('../../../docs/agents/parallel-rounds.md', import.meta.url)), 'utf8');

		expect(notice).toContain('docs/agents/parallel-rounds.md');
		expect(doc).toContain('cp .env ');
	});
});

/**
 * #412's first acceptance criterion, made executable: nothing sends a reader after
 * the file that no longer exists.
 *
 * Two rows rather than a repository-wide grep for the name, and the distinction is
 * this repository's own: a sentence saying what *used to* be true is how every
 * correction here is written, and a scan that banned the string outright would ban
 * the explanations along with the instructions. What must not survive is an
 * instruction — a copy step, or an example file to copy — so those are what these
 * read.
 */
describe('the file this ticket deleted', () => {
	const root = fileURLToPath(new URL('../../../', import.meta.url));

	it('has no example left for anyone to copy', () => {
		expect(existsSync(join(root, `${DELETED_FILE}.example`))).toBe(false);
		// The negative control: the example that survives is the one the notice sends
		// its reader to, so a checkout that has neither would pass the row above.
		expect(existsSync(join(root, '.env.example'))).toBe(true);
	});

	it('is in no copy step the worktree instructions give', () => {
		// Read as commands rather than as prose. The document explains the two-file
		// era in the past tense on purpose — what must not survive is a line an agent
		// pastes into a shell, and that is what this reads.
		const doc = readFileSync(join(root, 'docs/agents/parallel-rounds.md'), 'utf8');
		const copySteps = [...doc.matchAll(/^cp .*$/gm)].map(match => match[0]);

		expect(copySteps.length).toBeGreaterThan(0);
		for (const step of copySteps)
			expect(step).not.toContain(DELETED_FILE);
	});
});

describe('reading a dotenv body', () => {
	it('reads plain, quoted and exported entries alike', () => {
		const values = parseDotenv([
			'NUXT_PLAIN=plain',
			'NUXT_DOUBLE="double value"',
			'NUXT_SINGLE=\'single value\'',
			'export NUXT_EXPORTED=exported',
			'NUXT_SPACED = spaced ',
		].join('\n'));

		expect(Object.fromEntries(values)).toEqual({
			NUXT_PLAIN: 'plain',
			NUXT_DOUBLE: 'double value',
			NUXT_SINGLE: 'single value',
			NUXT_EXPORTED: 'exported',
			NUXT_SPACED: 'spaced',
		});
	});

	it('ignores comments, blank lines and anything that is not an assignment', () => {
		const values = parseDotenv([
			'# The whole file is commented at the top',
			'',
			'   ',
			'not an assignment',
			'NUXT_KEPT=kept # trailing note',
			'NUXT_QUOTED="kept # inside quotes"',
		].join('\n'));

		expect(Object.fromEntries(values)).toEqual({
			NUXT_KEPT: 'kept',
			NUXT_QUOTED: 'kept # inside quotes',
		});
	});
});
