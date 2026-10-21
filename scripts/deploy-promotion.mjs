/**
 * Production promotion markers, and the validator decision read from them
 * (#616, ADR-0035).
 *
 * The app and the validator are deployed separately and can fail separately,
 * so each has its own marker: an annotated tag on `origin` whose message
 * records the component, its state, the commit it was deployed from, whether
 * that checkout was dirty, the validator's fingerprint, and who deployed it.
 *
 * - `production`: the app. `pnpm run deploy` marks it `pending` right before
 *   the D1 migration and `deployed` after `deploy:verify` passed.
 * - `production-validator`: the validator. `pnpm deploy:validator` marks it
 *   `pending`, runs `wrangler deploy`, then marks it `deployed`.
 *
 * A pending marker is the state a deploy leaves when it dies part-way: it
 * claims nothing, and the next decision does not trust it. Writing it first
 * is also what keeps an emergency local deploy honest, because one that cannot
 * write its marker never starts.
 *
 * The validator decision compares the target checkout's **fingerprint** with
 * the one the marker records. The fingerprint hashes what `wrangler deploy`
 * would upload and build, not which files changed: the bundle itself (so any
 * import it resolves counts, `@cloudflare/containers` and `shared/` among
 * them), the Container's Docker context, and the Worker configuration.
 * A version bump touches none of them; rolling back to a release with a
 * different validator changes all of the bundle. Anything unknown (no marker,
 * an unreadable one, a pending one, a checkout that could not be bundled)
 * means deploy.
 *
 * Commands (`node scripts/deploy-promotion.mjs <command>`):
 *
 * - `promote <auto|always|never>`: the Deploy workflow's run, from the
 *   workflow's own commit against the release checkout in the working directory.
 * - `deploy-validator`: `pnpm deploy:validator`.
 * - `mark-app <pending|deployed>`: inside `pnpm run deploy`.
 * - `status`: `pnpm deploy:status`, both markers and the decision for this checkout.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const APP_MARKER = 'production';
const VALIDATOR_MARKER = 'production-validator';
const MARKER_HEADER = 'stream-keepr promotion marker';
const FINGERPRINT = /^sha256:[0-9a-f]{64}$/;

const VALIDATOR_CONFIG = 'workers/silent-video-validator/wrangler.jsonc';
/** The Docker build context: the Dockerfile's directory, as wrangler.jsonc's `image` leaves it. */
const VALIDATOR_CONTAINER_CONTEXT = 'workers/silent-video-validator/container';

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function filesBelow(directory) {
	return readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter(entry => entry.isFile())
		.map(entry => join(entry.parentPath, entry.name));
}

/**
 * Bundle the validator as `wrangler deploy` would upload it, into the absolute
 * `outDir`, without Docker or credentials (`pnpm validator:dry-run`). It runs
 * the checkout's own wrangler, so a release is bundled by the wrangler it pins.
 *
 * @param {{ root: string, outDir: string }} options
 */
export function bundleValidator({ root, outDir }) {
	const result = spawnSync(join(root, 'node_modules/.bin/wrangler'), [
		'deploy',
		'--dry-run',
		'--containers-rollout=none',
		'--config',
		VALIDATOR_CONFIG,
		// Absolute: a relative --outdir resolves against the config's directory (scripts/worker-dry-run.mjs).
		'--outdir',
		outDir,
	], { cwd: root, encoding: 'utf8' });
	if (result.status !== 0)
		throw new Error(`could not bundle the validator: ${result.error?.message ?? `${result.stdout}${result.stderr}`.trim()}`);
}

/**
 * The validator's build fingerprint: a sha256 over the bundle wrangler would
 * upload (every module it writes, not its source maps or README), every file
 * of the Container's Docker context, and the Worker configuration. A change to
 * any import the bundle resolves, a root dependency among them, changes the
 * bundle; a release's version bump does not.
 *
 * @param {{ root: string, bundle?: typeof bundleValidator }} options
 * @returns {string} `sha256:<hex>`
 */
export function fingerprintValidator({ root, bundle = bundleValidator }) {
	const outDir = mkdtempSync(join(tmpdir(), 'sk-validator-fingerprint-'));
	try {
		bundle({ root, outDir });
		const entries = [
			...filesBelow(outDir)
				.filter(path => !path.endsWith('.map') && relative(outDir, path) !== 'README.md')
				.map(path => [`bundle/${relative(outDir, path)}`, path]),
			...filesBelow(join(root, VALIDATOR_CONTAINER_CONTEXT))
				.map(path => [`container/${relative(join(root, VALIDATOR_CONTAINER_CONTEXT), path)}`, path]),
			['config', join(root, VALIDATOR_CONFIG)],
		];
		const manifest = entries
			.map(([name, path]) => `${name}\0${sha256(readFileSync(path))}\n`)
			.sort()
			.join('');
		return `sha256:${sha256(manifest)}`;
	}
	finally {
		rmSync(outDir, { recursive: true, force: true });
	}
}

/**
 * A marker's message: the header, then one `name: value` line per field.
 *
 * @param {Record<string, string>} fields
 */
export function formatMarker(fields) {
	return [MARKER_HEADER, '', ...Object.entries(fields).map(([name, value]) => `${name}: ${value}`), ''].join('\n');
}

/**
 * Read a marker's message. Anything without the header line, or with a field
 * line that is not `name: value`, is unreadable (`undefined`).
 *
 * @param {string} text
 * @returns {Record<string, string> | undefined} its fields, or undefined when unreadable
 */
export function parseMarker(text) {
	const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
	if (lines[0] !== MARKER_HEADER)
		return undefined;
	const fields = {};
	for (const line of lines.slice(1)) {
		const match = /^([a-z]+): (.+)$/.exec(line);
		if (!match)
			return undefined;
		fields[match[1]] = match[2];
	}
	return fields;
}

/**
 * Whether a deploy of the target release promotes the validator.
 *
 * @param {{
 *   mode: 'auto' | 'always' | 'never',
 *   targetFingerprint: string | undefined,
 *   markerText: string | undefined,
 * }} input `targetFingerprint` is undefined when the target could not be
 *   fingerprinted; `markerText` is the marker tag's message, undefined when
 *   no marker exists.
 * @returns {{ deploy: boolean, reason: string }} whether to deploy, and why
 */
export function decideValidatorDeploy({ mode, targetFingerprint, markerText }) {
	if (mode === 'always')
		return { deploy: true, reason: 'forced by the always input' };
	if (mode === 'never')
		return { deploy: false, reason: 'suppressed by the never input' };
	if (mode !== 'auto')
		throw new Error(`unknown validator mode ${JSON.stringify(mode)}; expected auto, always or never.`);
	if (targetFingerprint === undefined)
		return { deploy: true, reason: 'the target validator could not be fingerprinted; deploying is the safe default' };
	if (markerText === undefined)
		return { deploy: true, reason: `no ${VALIDATOR_MARKER} marker exists; deploying is the safe default` };
	const marker = parseMarker(markerText);
	if (!marker || marker.component !== 'validator' || !['deployed', 'pending'].includes(marker.state)
		|| !FINGERPRINT.test(marker.fingerprint ?? '')) {
		return { deploy: true, reason: `the ${VALIDATOR_MARKER} marker is unreadable or its fingerprint unknown; deploying is the safe default` };
	}
	if (marker.state === 'pending')
		return { deploy: true, reason: `the validator deploy of ${marker.commit} started but was never confirmed; deploying is the safe default` };
	if (marker.fingerprint === targetFingerprint)
		return { deploy: false, reason: `validator fingerprint unchanged since the deployed ${marker.commit}` };
	return { deploy: true, reason: `validator fingerprint changed since the deployed ${marker.commit}` };
}

/**
 * Where the markers live. `head` and `dirty` describe the checkout being
 * deployed; `read` answers a marker tag's message on the remote (undefined
 * when the tag does not exist); `write` points the tag at a commit with that
 * message on the remote.
 *
 * @typedef {{
 *   head: () => string,
 *   dirty: () => boolean,
 *   read: (name: string) => string | undefined,
 *   write: (name: string, commit: string, message: string) => void,
 * }} MarkerStore
 */

function writeMarker(store, name, fields) {
	const commit = store.head();
	store.write(name, commit, formatMarker({
		component: fields.component,
		state: fields.state,
		commit,
		worktree: store.dirty() ? 'dirty' : 'clean',
		...(fields.fingerprint ? { fingerprint: fields.fingerprint } : {}),
		source: fields.source,
	}));
}

function tryFingerprint(fingerprint, log) {
	try {
		return fingerprint();
	}
	catch (error) {
		log(`deploy-promotion: ${error.message}`);
		return undefined;
	}
}

/**
 * Record the app's promotion: `pending` before the first remote change of
 * `pnpm run deploy`, `deployed` once `deploy:verify` passed.
 *
 * @param {{ store: MarkerStore, state: 'pending' | 'deployed', source: string }} options
 */
export function markApp({ store, state, source }) {
	writeMarker(store, APP_MARKER, { component: 'app', state, source });
}

/**
 * Deploy the checkout's validator between its two markers: `pending` first,
 * so a deploy that dies at any point leaves a marker the next decision
 * distrusts, and `deployed` only after `deploy` returned. A pending marker that
 * cannot be written stops the deploy before it starts.
 *
 * @param {{
 *   store: MarkerStore,
 *   fingerprint: () => string,
 *   deploy: () => void,
 *   source: string,
 *   log?: (line: string) => void,
 * }} options
 * @returns {string} the fingerprint recorded, `unknown` when there was none
 */
export function promoteValidator({ store, fingerprint, deploy, source, log = console.error }) {
	const target = tryFingerprint(fingerprint, log) ?? 'unknown';
	writeMarker(store, VALIDATOR_MARKER, { component: 'validator', state: 'pending', fingerprint: target, source });
	deploy();
	writeMarker(store, VALIDATOR_MARKER, { component: 'validator', state: 'deployed', fingerprint: target, source });
	return target;
}

/**
 * One Deploy workflow run: decide the validator, deploy it first when the
 * decision says so, then the app, each between its markers. Any failure
 * throws, leaving the markers saying only what is confirmed.
 *
 * @param {{
 *   store: MarkerStore,
 *   mode: 'auto' | 'always' | 'never',
 *   fingerprint: () => string,
 *   deployValidator: () => void,
 *   deployApp: () => void,
 *   source: string,
 *   log?: (line: string) => void,
 * }} options
 */
export function promote({ store, mode, fingerprint, deployValidator, deployApp, source, log = console.log }) {
	const target = mode === 'never' ? undefined : tryFingerprint(fingerprint, log);
	const validator = decideValidatorDeploy({ mode, targetFingerprint: target, markerText: store.read(VALIDATOR_MARKER) });
	log(`Validator deploy: ${validator.deploy} (${validator.reason})`);
	if (validator.deploy)
		promoteValidator({ store, fingerprint: () => target ?? fingerprint(), deploy: deployValidator, source, log });
	markApp({ store, state: 'pending', source });
	deployApp();
	markApp({ store, state: 'deployed', source });
	return { validator };
}

function runGit(cwd) {
	return (args, { input } = {}) => {
		const result = spawnSync('git', args, { cwd, encoding: 'utf8', input });
		if (result.status !== 0)
			throw new Error(`git ${args.join(' ')} failed: ${result.error?.message ?? result.stderr.trim()}`);
		return result.stdout;
	};
}

/**
 * The markers as annotated tags on `remote`, read and written through `git`
 * in the checkout being deployed. A read always fetches the remote's tag, so a
 * stale local copy never answers; a lightweight tag (the pre-#616 `production`
 * tag) reads as an empty message. A write force-pushes that one tag.
 *
 * @param {{
 *   cwd?: string,
 *   remote?: string,
 *   git?: (args: string[], options?: { input?: string }) => string,
 * }} options
 * @returns {MarkerStore} the store
 */
export function gitMarkerStore({ cwd = process.cwd(), remote = 'origin', git = runGit(cwd) } = {}) {
	const ref = name => `refs/tags/${name}`;
	return {
		head: () => git(['rev-parse', 'HEAD']).trim(),
		dirty: () => git(['status', '--porcelain', '--untracked-files=all']).trim() !== '',
		read(name) {
			if (git(['ls-remote', '--tags', remote, ref(name)]).trim() === '')
				return undefined;
			git(['fetch', '--no-tags', remote, `+${ref(name)}:${ref(name)}`]);
			if (git(['cat-file', '-t', ref(name)]).trim() !== 'tag')
				return '';
			return git(['for-each-ref', '--format=%(contents)', ref(name)]);
		},
		write(name, commit, message) {
			git(['tag', '--force', '--annotate', '--file=-', name, commit], { input: message });
			git(['push', remote, `+${ref(name)}:${ref(name)}`]);
		},
	};
}

/**
 * One line saying what a marker records.
 *
 * @param {string | undefined} text the marker tag's message, undefined when it does not exist
 */
export function describeMarker(text) {
	if (text === undefined)
		return 'missing';
	const marker = parseMarker(text);
	if (!marker)
		return 'unreadable (not a promotion marker; a pre-#616 lightweight tag reads this way)';
	const details = [marker.fingerprint && `fingerprint ${marker.fingerprint}`, `${marker.worktree} worktree`, `from ${marker.source}`].filter(Boolean);
	return `${marker.state === 'pending' ? 'pending (started, never confirmed)' : marker.state} ${marker.commit} (${details.join(', ')})`;
}

function run(command, args, cwd) {
	const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
	if (result.status !== 0)
		throw new Error(`${command} ${args.join(' ')} failed${result.error ? `: ${result.error.message}` : ` with status ${result.status ?? result.signal}`}`);
}

function source(env) {
	return env.GITHUB_ACTIONS === 'true'
		? `actions ${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
		: 'local';
}

const USAGE = `usage: node scripts/deploy-promotion.mjs <command>
  promote <auto|always|never>  the Deploy workflow's run: validator (when decided), then pnpm run deploy
  deploy-validator             pnpm deploy:validator: deploy this checkout's validator between its markers
  mark-app <pending|deployed>  record the app's promotion (inside pnpm run deploy)
  status                       print both markers and whether this checkout's validator would deploy`;

function main(argv, env) {
	const root = process.cwd();
	const store = gitMarkerStore({ cwd: root });
	const fingerprint = () => fingerprintValidator({ root });
	const deployValidator = () => run(join(root, 'node_modules/.bin/wrangler'), ['deploy', '--config', VALIDATOR_CONFIG], root);
	const summary = (line) => {
		if (env.GITHUB_STEP_SUMMARY)
			appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
	};
	const markers = () => [
		`${APP_MARKER}: ${describeMarker(store.read(APP_MARKER))}`,
		`${VALIDATOR_MARKER}: ${describeMarker(store.read(VALIDATOR_MARKER))}`,
	];
	const [command, argument] = argv;

	if (command === 'promote' && ['auto', 'always', 'never'].includes(argument)) {
		const log = (line) => {
			console.log(line);
			summary(line);
		};
		try {
			promote({ store, mode: argument, fingerprint, deployValidator, deployApp: () => run('pnpm', ['run', 'deploy'], root), source: source(env), log });
		}
		catch (error) {
			log(`Promotion stopped: ${error.message}. Markers now (README.md § Recovering from a partial promotion):`);
			try {
				for (const line of markers())
					log(`- ${line}`);
			}
			catch (readError) {
				log(`- unread: ${readError.message}; run pnpm deploy:status`);
			}
			return 1;
		}
		return 0;
	}
	if (command === 'deploy-validator' && argument === undefined) {
		const recorded = promoteValidator({ store, fingerprint, deploy: deployValidator, source: source(env) });
		console.log(`deploy:validator: deployed; ${VALIDATOR_MARKER} records ${recorded}.`);
		return 0;
	}
	if (command === 'mark-app' && ['pending', 'deployed'].includes(argument)) {
		markApp({ store, state: argument, source: source(env) });
		console.log(`deploy-promotion: ${APP_MARKER} marker is ${argument} at ${store.head()}.`);
		return 0;
	}
	if (command === 'status' && argument === undefined) {
		for (const line of markers())
			console.log(line);
		const decision = decideValidatorDeploy({ mode: 'auto', targetFingerprint: tryFingerprint(fingerprint, console.error), markerText: store.read(VALIDATOR_MARKER) });
		console.log(`this checkout's validator: ${decision.deploy ? 'would deploy' : 'would not deploy'} (${decision.reason})`);
		return 0;
	}
	console.error(USAGE);
	return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
	process.exitCode = main(process.argv.slice(2), process.env);
