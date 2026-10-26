import type { LocallyRequiredNuxtName } from '~~/build/localConfiguration';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertWorkerConfigurationDoesNotArmLocalAuthBypass } from '~~/build/localAuthDeployment';
import {
	announcesLocalConfiguration,
	LOCAL_NUXT_NAME_SURFACES,
	localAuthBypassActive,
	localAuthBypassLogLine,
	localConfigurationBootNotice,
	localConfigurationLogLine,
	LOCALLY_OPTIONAL_NUXT_NAMES,
	LOCALLY_REQUIRED_NUXT_NAMES,
	missingLocalNuxtNames,
	parseDotenv,
} from '~~/build/localConfiguration';
import {
	LOCAL_AUTH_BYPASS_ENABLED_VALUE,
	LOCAL_AUTH_BYPASS_NAME,
} from '~~/shared/utils/localDeveloperAuth';

// The signing key is read as 32-byte base64, so a configured checkout holds one.
const CONFIGURED_VALUES: Partial<Record<LocallyRequiredNuxtName, string>> = {
	NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
};

/** Every required name set, built from the list so a new name cannot leave it short. */
function configuredEnv(): Record<string, string | undefined> {
	return Object.fromEntries(
		LOCALLY_REQUIRED_NUXT_NAMES.map(name => [name, CONFIGURED_VALUES[name] ?? 'from-dotenv']),
	);
}

const bypassed = { [LOCAL_AUTH_BYPASS_NAME]: LOCAL_AUTH_BYPASS_ENABLED_VALUE };

describe('which processes say anything about local configuration at all', () => {
	it.each([
		[
			'an ordinary dev server',
			{ dev: true, env: {} },
			true,
		],
		[
			'a build, whose names come from Worker secrets',
			{ dev: false, env: {} },
			false,
		],
		[
			'the integration suite, which pins names into its server child',
			{
				dev: true,
				env: { STREAM_KEEPR_INTEGRATION: 'true' },
			},
			false,
		],
		[
			'a dev server with the integration flag set to anything but true',
			{
				dev: true,
				env: { STREAM_KEEPR_INTEGRATION: 'false' },
			},
			true,
		],
	])('%s: %s', (_, options, announces) => {
		expect(announcesLocalConfiguration(options)).toBe(announces);
	});
});

describe('which names a local checkout has to be given', () => {
	it('counts a blank or whitespace value as missing, the way the readers that refuse count it', () => {
		// `cp .env.example .env` produces exactly this state.
		const blanks = Object.fromEntries(LOCALLY_REQUIRED_NUXT_NAMES.map((name, index) => [
			name,
			index % 2 === 0
				? ''
				: '   ',
		]));

		expect(missingLocalNuxtNames(blanks)).toEqual([...LOCALLY_REQUIRED_NUXT_NAMES]);
	});

	it('reports only the names actually absent', () => {
		const env = configuredEnv();
		expect(missingLocalNuxtNames(env)).toEqual([]);

		delete env.NUXT_GRAPHICS_ADMIN_TOKEN;
		expect(missingLocalNuxtNames(env)).toEqual(['NUXT_GRAPHICS_ADMIN_TOKEN']);
	});

	it('partitions exactly the names `.env.example` assigns', () => {
		// A new example name must be sorted into required or optional before this passes.
		const example = readFileSync(fileURLToPath(new URL('../../../.env.example', import.meta.url)), 'utf8');
		const assigned = [
			...example.matchAll(/^(NUXT_\w+)=/gm),
		].map(match => match[1]).sort();

		expect(assigned).toEqual([
			...LOCALLY_REQUIRED_NUXT_NAMES,
			...LOCALLY_OPTIONAL_NUXT_NAMES,
		].sort());
		expect(Object.keys(LOCAL_NUXT_NAME_SURFACES).sort()).toEqual([...LOCALLY_REQUIRED_NUXT_NAMES].sort());
	});

	it('requires only what refuses at boot: the auth names but not Ably or the Melee keys', () => {
		expect(LOCALLY_REQUIRED_NUXT_NAMES).toEqual(expect.arrayContaining(['NUXT_BETTER_AUTH_SECRET', 'NUXT_ADMIN_BOOTSTRAP_TOKEN']));
		expect(LOCALLY_OPTIONAL_NUXT_NAMES).toEqual(expect.arrayContaining([
			'NUXT_ABLY_API_KEY',
			'NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY',
			'NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY_VERSION',
			'NUXT_MELEE_CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS',
		]));
	});

	it('does not require the Better Auth setup names while the local bypass is enabled', () => {
		expect(missingLocalNuxtNames({}, { localAuthBypassActive: true })).toEqual([
			'NUXT_GRAPHICS_ADMIN_TOKEN',
			'NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY',
		]);
		expect(missingLocalNuxtNames({})).toEqual([...LOCALLY_REQUIRED_NUXT_NAMES]);
		for (const name of [
			...LOCALLY_REQUIRED_NUXT_NAMES,
			...LOCALLY_OPTIONAL_NUXT_NAMES,
		])
			expect(name).not.toContain('LOCAL_AUTH_BYPASS');
	});
});

describe('what a dev server says about its local configuration', () => {
	it('warns, naming every missing name, when nothing supplies them or `.env` holds only blanks', () => {
		const blanks = Object.fromEntries(LOCALLY_REQUIRED_NUXT_NAMES.map(name => [name, '']));

		for (const env of [{}, blanks]) {
			const line = localConfigurationLogLine({ dev: true, env });
			expect(line?.level).toBe('warn');
			for (const name of LOCALLY_REQUIRED_NUXT_NAMES)
				expect(line?.message).toContain(name);
		}
	});

	it('says nothing once `.env` supplied the names, nor in a build or the integration suite', () => {
		expect(localConfigurationLogLine({
			dev: true,
			env: configuredEnv(),
		})).toBeUndefined();
		expect(localConfigurationLogLine({
			dev: true,
			env: { STREAM_KEEPR_INTEGRATION: 'true' },
		})).toBeUndefined();
		expect(localConfigurationLogLine({ dev: false, env: {} })).toBeUndefined();
	});

	// A surface named where it still works sends a reader after a defect that is not there.
	it.each(LOCALLY_REQUIRED_NUXT_NAMES)('names only %s and its own surface when only it is missing', (missing) => {
		const env = configuredEnv();
		delete env[missing];

		const line = localConfigurationLogLine({ dev: true, env });

		expect(line?.level).toBe('warn');
		expect(line?.message).toContain(missing);
		expect(line?.message).toContain(LOCAL_NUXT_NAME_SURFACES[missing]);
		expect(line?.message).toContain('it keeps its');
		expect(line?.message).not.toContain('each says so');
		for (const other of LOCALLY_REQUIRED_NUXT_NAMES.filter(name => name !== missing)) {
			expect(line?.message).not.toContain(other);
			expect(line?.message).not.toContain(LOCAL_NUXT_NAME_SURFACES[other]);
		}
	});

	it('names the file to copy, the cause, the fix, the blank-copy trap and the 503s', () => {
		const notice = localConfigurationBootNotice([...LOCALLY_REQUIRED_NUXT_NAMES]);

		expect(notice).toMatch(/\.env(?!\.example)/);
		for (const token of [
			'.env.example',
			'git worktree',
			'Fix:',
			'empty values',
			'503',
			'README.md → Local configuration',
		])
			expect(notice).toContain(token);
	});
});

describe('the Local Developer Session startup warning', () => {
	it('conspicuously names the bypass and the risk of binding beyond loopback', () => {
		const line = localAuthBypassLogLine({ dev: true, env: bypassed });

		expect(line?.level).toBe('warn');
		for (const token of [
			'AUTHENTICATION BYPASSED',
			'Local Developer User',
			'loopback',
			'other machines',
		])
			expect(line?.message).toContain(token);
	});

	it.each(['', ' ', 'TRUE', 'false', '1'])('stays silent on the value %j, which is not the exact enabling one', (value) => {
		expect(localAuthBypassLogLine({
			dev: true,
			env: { [LOCAL_AUTH_BYPASS_NAME]: value },
		})).toBeUndefined();
	});

	it('reads the launcher-owned name and no NUXT_ spelling of it, which a file could supply', () => {
		const nuxtSpelling = { [`NUXT_${LOCAL_AUTH_BYPASS_NAME}`]: LOCAL_AUTH_BYPASS_ENABLED_VALUE };

		expect(localAuthBypassActive({ dev: true, env: bypassed })).toBe(true);
		expect(localAuthBypassActive({ dev: true, env: nuxtSpelling })).toBe(false);
		expect(localAuthBypassLogLine({ dev: true, env: nuxtSpelling })).toBeUndefined();
	});

	it('says nothing in a build, whatever the environment holds', () => {
		expect(localAuthBypassLogLine({ dev: false, env: bypassed })).toBeUndefined();
		expect(localConfigurationLogLine({ dev: false, env: bypassed })).toBeUndefined();
	});
});

describe('the generated Worker configuration auth boundary', () => {
	it('refuses the bypass name anywhere in generated deployment configuration', () => {
		expect(() => assertWorkerConfigurationDoesNotArmLocalAuthBypass({
			env: {
				production: { vars: bypassed },
			},
		})).toThrow(/refusing to deploy/u);
		expect(() => assertWorkerConfigurationDoesNotArmLocalAuthBypass({
			name: 'stream',
			vars: { ORDINARY_CONFIGURATION: 'value' },
		})).not.toThrow();
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
