import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { decideValidatorDeploy, describeMarker, fingerprintValidator, gitMarkerStore, markApp, parseMarker, promote, promoteValidator } from '../../../scripts/deploy-promotion.mjs';

const FINGERPRINT_A = `sha256:${'a'.repeat(64)}`;
const FINGERPRINT_B = `sha256:${'b'.repeat(64)}`;
const COMMIT_A = '1'.repeat(40);

/** A marker as an annotated tag's message carries it, written out by hand. */
function deployedMarker(fingerprint: string, commit = COMMIT_A) {
	return [
		'stream-keepr promotion marker',
		'',
		'component: validator',
		'state: deployed',
		`commit: ${commit}`,
		'worktree: clean',
		`fingerprint: ${fingerprint}`,
		'source: local',
		'',
	].join('\n');
}

describe('deciding whether the validator deploys', () => {
	it('deploys when no validator marker exists', () => {
		const decision = decideValidatorDeploy({ mode: 'auto', targetFingerprint: FINGERPRINT_A, markerText: undefined });

		expect(decision.deploy).toBe(true);
		expect(decision.reason).toMatch(/no production-validator marker/);
	});

	it('skips when the deployed validator has the target fingerprint', () => {
		const decision = decideValidatorDeploy({
			mode: 'auto',
			targetFingerprint: FINGERPRINT_A,
			markerText: deployedMarker(FINGERPRINT_A),
		});

		expect(decision.deploy).toBe(false);
		expect(decision.reason).toContain('unchanged');
		expect(decision.reason).toContain(COMMIT_A);
	});

	it('deploys when the target fingerprint differs from the deployed one', () => {
		const decision = decideValidatorDeploy({
			mode: 'auto',
			targetFingerprint: FINGERPRINT_B,
			markerText: deployedMarker(FINGERPRINT_A),
		});

		expect(decision.deploy).toBe(true);
		expect(decision.reason).toContain('changed');
	});

	it.each([
		['an empty message (a lightweight tag)', ''],
		['a message without the marker header', 'Release v1.4.0\n'],
		[
			'a garbled field line',
			deployedMarker(FINGERPRINT_A).replace('state: deployed', 'state deployed'),
		],
		[
			'another component\'s marker',
			deployedMarker(FINGERPRINT_A).replace('component: validator', 'component: app'),
		],
		[
			'an unknown state',
			deployedMarker(FINGERPRINT_A).replace('state: deployed', 'state: rolled-back'),
		],
		[
			'an unknown fingerprint',
			deployedMarker('unknown'),
		],
		[
			'a fingerprint of an unknown scheme',
			deployedMarker(`md5:${'a'.repeat(32)}`),
		],
	])('deploys when the marker is unreadable: %s', (_case, markerText) => {
		const decision = decideValidatorDeploy({ mode: 'auto', targetFingerprint: FINGERPRINT_A, markerText });

		expect(decision.deploy).toBe(true);
		expect(decision.reason).toMatch(/unreadable|unknown/);
	});

	it('deploys when the last validator deploy was started but never confirmed, even at the target fingerprint', () => {
		const pending = deployedMarker(FINGERPRINT_A).replace('state: deployed', 'state: pending');

		const decision = decideValidatorDeploy({ mode: 'auto', targetFingerprint: FINGERPRINT_A, markerText: pending });

		expect(decision.deploy).toBe(true);
		expect(decision.reason).toContain('never confirmed');
	});

	it('always and never override the markers', () => {
		const unchanged = deployedMarker(FINGERPRINT_A);

		expect(decideValidatorDeploy({ mode: 'always', targetFingerprint: FINGERPRINT_A, markerText: unchanged }).deploy).toBe(true);
		expect(decideValidatorDeploy({ mode: 'never', targetFingerprint: FINGERPRINT_B, markerText: undefined }).deploy).toBe(false);
	});

	it('refuses an unknown mode rather than guessing', () => {
		expect(() => decideValidatorDeploy({ mode: 'sometimes' as 'auto', targetFingerprint: FINGERPRINT_A, markerText: undefined }))
			.toThrow(/sometimes/);
	});

	it('deploys when the target could not be fingerprinted', () => {
		const decision = decideValidatorDeploy({
			mode: 'auto',
			targetFingerprint: undefined,
			markerText: deployedMarker(FINGERPRINT_A),
		});

		expect(decision.deploy).toBe(true);
		expect(decision.reason).toContain('could not be fingerprinted');
	});
});

/**
 * The fingerprint is what `wrangler deploy` would upload (the bundle) plus what
 * it would build the Container image from (its Docker context) plus the
 * Worker's configuration. These cases stand a fixture checkout in for the
 * repository and a fixed bundle in for wrangler. Wrangler is never run here: a
 * real bundle's stability (no absolute or temporary paths in the module) was
 * measured by hand, and an unstable one would only redeploy the validator.
 */
describe('fingerprinting the validator', () => {
	const roots: string[] = [];

	afterEach(() => {
		for (const root of roots.splice(0))
			rmSync(root, { recursive: true, force: true });
	});

	function checkout() {
		const root = mkdtempSync(join(tmpdir(), 'sk-validator-'));
		roots.push(root);
		const files: Record<string, string> = {
			'package.json': '{ "version": "1.0.0" }\n',
			'workers/silent-video-validator/wrangler.jsonc': '{ "name": "stream-silent-video-validator" }\n',
			'workers/silent-video-validator/container/Dockerfile': 'FROM node:22\nCOPY server.mjs ./server.mjs\n',
			'workers/silent-video-validator/container/server.mjs': 'console.log(1);\n',
			'workers/silent-video-validator/src/index.ts': 'export default {};\n',
		};
		for (const [path, content] of Object.entries(files)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), content);
		}
		return root;
	}

	/** A bundler writing what wrangler writes: the module, its source map, a timestamped README. */
	function bundler(moduleSource: string) {
		return ({ outDir }: { root: string; outDir: string }) => {
			writeFileSync(join(outDir, 'index.js'), moduleSource);
			writeFileSync(join(outDir, 'index.js.map'), `{"sourceRoot":"${outDir}"}`);
			writeFileSync(join(outDir, 'README.md'), `generated at ${new Date().toISOString()}${Math.random()}`);
		};
	}

	const bundle = bundler('// node_modules/@cloudflare/containers@0.3.7\nexport default {};\n');

	it('is the same for the same inputs in different checkouts, ignoring source maps and wrangler\'s README', () => {
		const first = fingerprintValidator({
			root: checkout(),
			bundle,
		});
		const second = fingerprintValidator({
			root: checkout(),
			bundle,
		});

		expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(second).toBe(first);
	});

	it('changes on a dependency-only change: the validator folder is untouched but the bundle differs', () => {
		const root = checkout();
		const before = fingerprintValidator({ root, bundle });
		const after = fingerprintValidator({
			root,
			bundle: bundler('// node_modules/@cloudflare/containers@0.3.8\nexport default {};\n'),
		});

		expect(after).not.toBe(before);
	});

	it.each([
		['the Dockerfile', 'workers/silent-video-validator/container/Dockerfile'],
		['a file in the Container\'s Docker context', 'workers/silent-video-validator/container/server.mjs'],
		['the Worker configuration', 'workers/silent-video-validator/wrangler.jsonc'],
	])('changes when %s changes, though the bundle does not', (_case, path) => {
		const root = checkout();
		const before = fingerprintValidator({ root, bundle });
		writeFileSync(join(root, path), '# changed\n', { flag: 'a' });

		expect(fingerprintValidator({ root, bundle })).not.toBe(before);
	});

	it('changes when a file is added to the Container\'s Docker context', () => {
		const root = checkout();
		const before = fingerprintValidator({ root, bundle });
		writeFileSync(join(root, 'workers/silent-video-validator/container/extra.mjs'), '');

		expect(fingerprintValidator({ root, bundle })).not.toBe(before);
	});

	it('does not change on a release\'s version bump, which leaves the bundle alone', () => {
		const root = checkout();
		const before = fingerprintValidator({ root, bundle });
		writeFileSync(join(root, 'package.json'), '{ "version": "1.1.0" }\n');

		expect(fingerprintValidator({ root, bundle })).toBe(before);
	});

	it('fails rather than fingerprinting a bundle that could not be built', () => {
		const failing = () => {
			throw new Error('could not bundle the validator: boom');
		};

		expect(() => fingerprintValidator({
			root: checkout(),
			bundle: failing,
		})).toThrow(/boom/);
	});
});

interface Release {
	commit: string;
	/** What `fingerprintValidator` answers for this release's checkout. */
	validator: string;
}

const A: Release = {
	commit: 'a'.repeat(40),
	validator: FINGERPRINT_A,
};
const A_PATCH: Release = {
	commit: 'c'.repeat(40),
	validator: FINGERPRINT_A,
};
const B: Release = {
	commit: 'b'.repeat(40),
	validator: FINGERPRINT_B,
};
const C: Release = {
	commit: 'd'.repeat(40),
	validator: `sha256:${'d'.repeat(64)}`,
};

function quiet() {}

/**
 * Production and the marker remote, both in memory. The deploy commands stand
 * in for `wrangler deploy` and `pnpm run deploy`: they move what production
 * runs, or fail without moving it. Nothing here spawns a process.
 */
function world() {
	const tags = new Map<string, { commit: string; message: string }>();
	const production: { app?: string; validator?: string } = {};
	let checkout: Release = A;
	let dirty = false;
	const store = {
		head: () => checkout.commit,
		dirty: () => dirty,
		read: (name: string) => tags.get(name)?.message,
		write: (name: string, commit: string, message: string) => {
			tags.set(name, { commit, message });
		},
	};

	function checkOut(release: Release, options: { dirty?: boolean } = {}) {
		checkout = release;
		dirty = options.dirty ?? false;
	}

	function commands(release: Release, fail?: 'validator' | 'app') {
		return {
			fingerprint: () => release.validator,
			deployValidator: () => {
				if (fail === 'validator')
					throw new Error('wrangler deploy failed');
				production.validator = release.validator;
			},
			deployApp: () => {
				if (fail === 'app')
					throw new Error('deploy:verify failed');
				production.app = release.commit;
			},
		};
	}

	/** One Deploy workflow run of `release`. */
	function dispatch(release: Release, options: { mode?: 'auto' | 'always' | 'never'; fail?: 'validator' | 'app' } = {}) {
		checkOut(release);
		return promote({
			store,
			mode: options.mode ?? 'auto',
			...commands(release, options.fail),
			source: 'actions',
			log: quiet,
		});
	}

	function marker(name: 'production' | 'production-validator') {
		const tag = tags.get(name);
		return tag && {
			tagged: tag.commit,
			...parseMarker(tag.message),
		};
	}

	return {
		store,
		production,
		checkOut,
		commands,
		dispatch,
		marker,
	};
}

describe('promoting a release', () => {
	it('a first run with no markers deploys and records both components', () => {
		const w = world();

		const result = w.dispatch(A);

		expect(result.validator.deploy).toBe(true);
		expect(w.production).toEqual({ app: A.commit, validator: A.validator });
		expect(w.marker('production-validator')).toEqual({
			tagged: A.commit,
			component: 'validator',
			state: 'deployed',
			commit: A.commit,
			worktree: 'clean',
			fingerprint: A.validator,
			source: 'actions',
		});
		expect(w.marker('production')).toEqual({
			tagged: A.commit,
			component: 'app',
			state: 'deployed',
			commit: A.commit,
			worktree: 'clean',
			source: 'actions',
		});
	});

	it('skips the validator when its build inputs are unchanged, and leaves its marker on the release that deployed it', () => {
		const w = world();
		w.dispatch(A);

		const result = w.dispatch(A_PATCH);

		expect(result.validator.deploy).toBe(false);
		expect(w.production).toEqual({ app: A_PATCH.commit, validator: A.validator });
		expect(w.marker('production-validator')).toMatchObject({ commit: A.commit, state: 'deployed', fingerprint: A.validator });
		expect(w.marker('production')).toMatchObject({ commit: A_PATCH.commit, state: 'deployed' });
	});

	it('records a partial promotion (validator B deployed, app B failed) as exactly that', () => {
		const w = world();
		w.dispatch(A);

		expect(() => w.dispatch(B, { fail: 'app' })).toThrow(/deploy:verify failed/);

		expect(w.production).toEqual({ app: A.commit, validator: B.validator });
		expect(w.marker('production-validator')).toMatchObject({ commit: B.commit, state: 'deployed', fingerprint: B.validator });
		// A failure inside `pnpm run deploy` may leave A or B serving: unconfirmed, never claimed.
		expect(w.marker('production')).toMatchObject({ commit: B.commit, state: 'pending' });
	});

	it('rolling back to A after that partial promotion restores A\'s validator as well as A\'s app', () => {
		const w = world();
		w.dispatch(A);
		expect(() => w.dispatch(B, { fail: 'app' })).toThrow();

		const result = w.dispatch(A);

		expect(result.validator.deploy).toBe(true);
		expect(w.production).toEqual({ app: A.commit, validator: A.validator });
		expect(w.marker('production-validator')).toMatchObject({ commit: A.commit, state: 'deployed', fingerprint: A.validator });
		expect(w.marker('production')).toMatchObject({ commit: A.commit, state: 'deployed' });
	});

	it('a failed validator deploy stops before the app and leaves its marker pending, so the next run redeploys it', () => {
		const w = world();
		w.dispatch(A);

		expect(() => w.dispatch(B, { fail: 'validator' })).toThrow(/wrangler deploy failed/);

		expect(w.production).toEqual({ app: A.commit, validator: A.validator });
		expect(w.marker('production-validator')).toMatchObject({ commit: B.commit, state: 'pending', fingerprint: B.validator });
		expect(w.marker('production')).toMatchObject({ commit: A.commit, state: 'deployed' });
		// Even back at A's fingerprint, an unconfirmed deploy is not trusted.
		expect(w.dispatch(A).validator.deploy).toBe(true);
	});

	it('an emergency local deploy records its markers, so the next run sees what production really runs', () => {
		const w = world();
		w.dispatch(B);

		// The operator deploys C from a local checkout with uncommitted changes.
		w.checkOut(C, { dirty: true });
		const local = w.commands(C);
		promoteValidator({
			store: w.store,
			fingerprint: local.fingerprint,
			deploy: local.deployValidator,
			source: 'local',
		});
		markApp({ store: w.store, state: 'pending', source: 'local' });
		local.deployApp();
		markApp({ store: w.store, state: 'deployed', source: 'local' });

		expect(w.marker('production-validator')).toMatchObject({
			commit: C.commit,
			state: 'deployed',
			fingerprint: C.validator,
			worktree: 'dirty',
			source: 'local',
		});
		expect(w.marker('production')).toMatchObject({
			commit: C.commit,
			state: 'deployed',
			worktree: 'dirty',
			source: 'local',
		});

		const result = w.dispatch(B);

		expect(result.validator.deploy).toBe(true);
		expect(w.production).toEqual({ app: B.commit, validator: B.validator });
	});

	it('never deploys when its pending marker cannot be written', () => {
		const w = world();
		let deployed = false;
		const store = {
			...w.store,
			write: () => {
				throw new Error('marker write refused');
			},
		};

		expect(() => promoteValidator({
			store,
			fingerprint: () => A.validator,
			deploy: () => {
				deployed = true;
			},
			source: 'local',
		})).toThrow(/marker write refused/);
		expect(deployed).toBe(false);
	});

	it('records an unknown fingerprint when the checkout cannot be fingerprinted, so the next run redeploys', () => {
		const w = world();
		const failing = () => {
			throw new Error('could not bundle the validator');
		};

		promoteValidator({
			store: w.store,
			fingerprint: failing,
			deploy: () => {},
			source: 'local',
			log: quiet,
		});

		expect(w.marker('production-validator')).toMatchObject({ state: 'deployed', fingerprint: 'unknown' });
		expect(w.dispatch(A).validator.deploy).toBe(true);
	});

	it('the never input leaves the validator and its marker alone', () => {
		const w = world();
		w.dispatch(A);

		const result = w.dispatch(B, { mode: 'never' });

		expect(result.validator.deploy).toBe(false);
		expect(w.production).toEqual({ app: B.commit, validator: A.validator });
		expect(w.marker('production-validator')).toMatchObject({ commit: A.commit, fingerprint: A.validator });
	});
});

/**
 * The markers are annotated tags on the remote. These cases hand the store a
 * scripted stand-in for `git` and check what it would run: no git process is
 * spawned and no remote is reached.
 */
describe('the git marker store', () => {
	function fakeGit(answers: Record<string, string> = {}) {
		const calls: { args: string[]; input?: string }[] = [];
		const git = (args: string[], options: { input?: string } = {}) => {
			calls.push({
				args,
				...(options.input === undefined
					? {}
					: { input: options.input }),
			});
			return answers[args.join(' ')] ?? '';
		};
		return { git, calls };
	}

	it('reads a missing marker as undefined without fetching it', () => {
		const { git, calls } = fakeGit();

		expect(gitMarkerStore({ git }).read('production-validator')).toBeUndefined();
		expect(calls.map(call => call.args)).toEqual([
			[
				'ls-remote',
				'--tags',
				'origin',
				'refs/tags/production-validator',
			],
		]);
	});

	it('reads the remote\'s marker, replacing any stale local copy of the tag', () => {
		const message = deployedMarker(FINGERPRINT_A);
		const { git, calls } = fakeGit({
			'ls-remote --tags origin refs/tags/production-validator': `${'f'.repeat(40)}\trefs/tags/production-validator\n`,
			'cat-file -t refs/tags/production-validator': 'tag\n',
			'for-each-ref --format=%(contents) refs/tags/production-validator': message,
		});

		expect(gitMarkerStore({ git }).read('production-validator')).toBe(message);
		expect(calls.map(call => call.args)).toContainEqual([
			'fetch',
			'--no-tags',
			'origin',
			'+refs/tags/production-validator:refs/tags/production-validator',
		]);
	});

	it('reads a lightweight tag (the pre-#616 production tag) as an empty, unreadable message', () => {
		const { git } = fakeGit({
			'ls-remote --tags origin refs/tags/production': `${'f'.repeat(40)}\trefs/tags/production\n`,
			'cat-file -t refs/tags/production': 'commit\n',
		});

		expect(gitMarkerStore({ git }).read('production')).toBe('');
	});

	it('writes an annotated tag on the commit and force-pushes that one tag only', () => {
		const { git, calls } = fakeGit();
		const message = deployedMarker(FINGERPRINT_A);

		gitMarkerStore({ git }).write('production-validator', COMMIT_A, message);

		expect(calls).toEqual([
			{
				args: [
					'tag',
					'--force',
					'--annotate',
					'--file=-',
					'production-validator',
					COMMIT_A,
				],
				input: message,
			},
			{
				args: ['push', 'origin', '+refs/tags/production-validator:refs/tags/production-validator'],
			},
		]);
	});

	it('describes the checkout: its HEAD commit, and dirty when anything is uncommitted or untracked', () => {
		const clean = fakeGit({ 'rev-parse HEAD': `${COMMIT_A}\n` });
		const dirty = fakeGit({ 'status --porcelain --untracked-files=all': '?? stray.ts\n' });

		expect(gitMarkerStore({ git: clean.git }).head()).toBe(COMMIT_A);
		expect(gitMarkerStore({ git: clean.git }).dirty()).toBe(false);
		expect(gitMarkerStore({ git: dirty.git }).dirty()).toBe(true);
	});
});

describe('describing a marker', () => {
	it.each([
		['a missing marker', undefined, 'missing'],
		['a lightweight tag', '', 'unreadable'],
		[
			'a confirmed validator deploy',
			deployedMarker(FINGERPRINT_A),
			`deployed ${COMMIT_A} (fingerprint ${FINGERPRINT_A}, clean worktree, from local)`,
		],
		[
			'an unconfirmed one',
			deployedMarker(FINGERPRINT_A).replace('state: deployed', 'state: pending'),
			`pending (started, never confirmed) ${COMMIT_A}`,
		],
	])('%s', (_case, text, expected) => {
		expect(describeMarker(text)).toContain(expected);
	});

	it('names missing fields rather than printing undefined', () => {
		const description = describeMarker('stream-keepr promotion marker\n\ncomponent: validator\n');

		expect(description).toBe('(no state) (no commit)');
	});
});

describe('the deploy-promotion command line', () => {
	it('refuses an unknown command or mode before touching git', () => {
		// An empty PATH: any git or wrangler the script tried to spawn would fail to start.
		const env = { ...process.env, PATH: '', CLOUDFLARE_API_TOKEN: 'blocked-by-test-guard' };
		for (const args of [
			['promote', 'sometimes'],
			['mark-app', 'confirmed'],
			['bogus'],
		]) {
			const result = spawnSync(process.execPath, ['scripts/deploy-promotion.mjs', ...args], { env, encoding: 'utf8' });

			expect(result.status).toBe(2);
			expect(result.stderr).toContain('usage: node scripts/deploy-promotion.mjs');
		}
	});
});
