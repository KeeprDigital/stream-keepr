import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

/**
 * Acceptance for the silent-video validation runtime.
 *
 * Local mode seeds the exact fixture revisions into local R2 state, runs the
 * validator Worker under `wrangler dev` with its real Workflow and Container,
 * and drives the production service-binding contract end to end, including a
 * deterministic metadata rejection.
 *
 * `--deployed` stages the same fixtures in the production staging bucket,
 * triggers the deployed `silent-video-validation` Workflow for each, and
 * verifies decode, playback, seeking, transparency, and the deterministic
 * poster against the exact staged revision before cleaning up.
 */

const deployed = process.argv.includes('--deployed');
const repoRoot = new URL('..', import.meta.url).pathname;
const validatorConfig = join(repoRoot, 'workers/silent-video-validator/wrangler.jsonc');
const fixtures = JSON.parse(await readFile(
	new URL('./silent-video-validator-fixtures.json', import.meta.url),
	'utf8',
));

function sha256Hex(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function validationInput(fixture, operationId) {
	const factsDigest = sha256Hex(Buffer.from(JSON.stringify(fixture.facts), 'utf8'));
	const idempotencyKey = [
		'silent-video-playback-v1',
		operationId,
		fixture.facts.sha256,
		factsDigest,
	].join(':');
	return {
		operationId,
		idempotencyKey,
		sourceDigest: fixture.facts.sha256,
		sourceByteLength: fixture.facts.byteLength,
		sourceContentType: fixture.facts.canonicalMime,
		factsDigest,
		inspectedFacts: fixture.facts,
	};
}

/**
 * Wrangler colourises even when piped, and ignores NO_COLOR/FORCE_COLOR — an
 * ANSI prefix on the `Status:` line defeats a `^Status:` anchor, which read as
 * "deployed validation did not complete in time" while the workflow had
 * completed in seconds. This output is parsed, so the codes are stripped here,
 * once, for every caller.
 */
function stripAnsi(text) {
	// eslint-disable-next-line no-control-regex
	return text.replace(/\x1B\[[0-9;]*m/g, '');
}

function wrangler(argumentList, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn('npx', ['wrangler', ...argumentList], {
			cwd: repoRoot,
			stdio: ['ignore', 'pipe', 'pipe'],
			...options,
		});
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8').on('data', chunk => stdout += chunk);
		child.stderr.setEncoding('utf8').on('data', chunk => stderr += chunk);
		child.once('error', reject);
		child.once('exit', (code) => {
			if (code === 0)
				resolve(stripAnsi(stdout));
			else
				reject(new Error(`wrangler ${argumentList.join(' ')} exited ${code}: ${stripAnsi(stderr.trim() || stdout.trim())}`));
		});
	});
}

async function seedStagedSource(fixture, operationId, persistTo) {
	const workspace = await mkdtemp(join(tmpdir(), 'silent-video-acceptance-'));
	const file = join(workspace, 'source.bin');
	try {
		await writeFile(file, Buffer.from(fixture.base64, 'base64'));
		await wrangler([
			'r2',
			'object',
			'put',
			`stream-graphics-asset-staging/ingestion/${operationId}/source`,
			'--file',
			file,
			'--content-type',
			fixture.facts.canonicalMime,
			...(persistTo ? ['--local', '--persist-to', persistTo] : ['--remote']),
			'--config',
			validatorConfig,
		]);
	}
	finally {
		await rm(workspace, { recursive: true, force: true });
	}
}

function assertAccepted(fixture, input, headers, posterBytes, label) {
	const required = (name) => {
		const value = headers.get(name);
		if (!value)
			throw new Error(`${label}: response omitted ${name}`);
		return value;
	};
	if (required('x-stream-keepr-operation-id') !== input.operationId
		|| required('x-stream-keepr-idempotency-key') !== input.idempotencyKey
		|| required('x-stream-keepr-source-digest') !== input.sourceDigest
		|| required('x-stream-keepr-facts-digest') !== input.factsDigest) {
		throw new Error(`${label}: response was not bound to the exact validation input`);
	}
	if (required('x-stream-keepr-muted-inline-playback') !== 'true'
		|| required('x-stream-keepr-seeked') !== 'true') {
		throw new Error(`${label}: playback and seek proof headers missing`);
	}
	const transparency = required('x-stream-keepr-transparency-rendered');
	if (fixture.facts.hasAlpha && transparency !== 'true')
		throw new Error(`${label}: VP9 transparency was not proven`);
	if (Number(required('x-stream-keepr-video-width')) !== fixture.facts.width
		|| Number(required('x-stream-keepr-video-height')) !== fixture.facts.height) {
		throw new Error(`${label}: verified dimensions do not match inspection`);
	}
	if (Math.abs(Number(required('x-stream-keepr-video-duration')) - fixture.facts.durationSeconds) > 0.05)
		throw new Error(`${label}: verified duration does not match inspection`);
	if (Math.abs(Number(required('x-stream-keepr-poster-time')) - fixture.facts.posterTimeSeconds) > 0.001)
		throw new Error(`${label}: poster time does not match the settled selection rule`);
	if (sha256Hex(posterBytes) !== required('x-stream-keepr-poster-digest'))
		throw new Error(`${label}: poster bytes do not match their digest`);
	if (posterBytes.length <= 0 || posterBytes.length > 2 * 1024 * 1024)
		throw new Error(`${label}: poster byte length is out of bounds`);
}

async function driveServiceBinding(baseUrl, fixture, operationId, label) {
	const input = validationInput(fixture, operationId);
	for (let attempt = 1; attempt <= 60; attempt++) {
		const response = await fetch(`${baseUrl}/validate`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'idempotency-key': input.idempotencyKey,
			},
			body: JSON.stringify(input),
		});
		if (response.status === 429 || response.status >= 500) {
			await response.arrayBuffer();
			await new Promise(resolve => setTimeout(resolve, 3000));
			continue;
		}
		if (response.status === 422) {
			const body = await response.json();
			return { outcome: 'rejected', stage: body.stage, input };
		}
		if (!response.ok)
			throw new Error(`${label}: unexpected status ${response.status}`);
		const posterBytes = Buffer.from(await response.arrayBuffer());
		assertAccepted(fixture, input, response.headers, posterBytes, label);
		return { outcome: 'accepted', input };
	}
	throw new Error(`${label}: validation did not settle in time`);
}

async function runLocalAcceptance() {
	const persistTo = await mkdtemp(join(tmpdir(), 'silent-video-validator-state-'));
	const port = 8987;
	const suffix = Date.now().toString(36);
	const plan = [
		['h264Mp4', `acceptance-${suffix}-mp4`],
		['vp9Webm', `acceptance-${suffix}-webm`],
		['vp9AlphaWebm', `acceptance-${suffix}-alpha`],
	];
	for (const [name, operationId] of plan)
		await seedStagedSource(fixtures[name], operationId, persistTo);
	// The tampered case declares WebM facts against staged MP4 bytes.
	const tamperedOperation = `acceptance-${suffix}-tampered`;
	await seedStagedSource(fixtures.h264Mp4, tamperedOperation, persistTo);

	const dev = spawn('npx', [
		'wrangler',
		'dev',
		'--config',
		validatorConfig,
		'--persist-to',
		persistTo,
		'--port',
		String(port),
	], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
	try {
		await new Promise((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error('wrangler dev did not become ready; is Docker running?')),
				300_000,
			);
			let output = '';
			const watch = (chunk) => {
				output += chunk;
				if (output.includes('Ready on')) {
					clearTimeout(timeout);
					resolve();
				}
			};
			dev.stdout.setEncoding('utf8').on('data', watch);
			dev.stderr.setEncoding('utf8').on('data', watch);
			dev.once('exit', code => reject(new Error(`wrangler dev exited early with ${code}: ${output.trim()}`)));
		});
		const baseUrl = `http://127.0.0.1:${port}`;
		for (const [name, operationId] of plan) {
			const result = await driveServiceBinding(baseUrl, fixtures[name], operationId, name);
			if (result.outcome !== 'accepted')
				throw new Error(`${name}: expected acceptance but got ${result.stage}`);
			process.stdout.write(`${name}: accepted with playback, seek, and poster proof\n`);
		}
		const tampered = await driveServiceBinding(
			baseUrl,
			fixtures.vp9Webm,
			tamperedOperation,
			'tampered',
		);
		if (tampered.outcome !== 'rejected' || tampered.stage !== 'metadata')
			throw new Error(`tampered: expected a metadata rejection but got ${JSON.stringify(tampered)}`);
		process.stdout.write('tampered: rejected at the metadata stage as required\n');
	}
	finally {
		dev.kill('SIGTERM');
		await new Promise(resolve => setTimeout(resolve, 2000));
		dev.kill('SIGKILL');
		await rm(persistTo, { recursive: true, force: true });
	}
}

async function runDeployedAcceptance() {
	const suffix = Date.now().toString(36);
	const plan = [
		['h264Mp4', `acceptance-${suffix}-mp4`],
		['vp9Webm', `acceptance-${suffix}-webm`],
		['vp9AlphaWebm', `acceptance-${suffix}-alpha`],
	];
	for (const [name, operationId] of plan) {
		const fixture = fixtures[name];
		await seedStagedSource(fixture, operationId);
		const input = validationInput(fixture, operationId);
		const validationId = sha256Hex(Buffer.from(input.idempotencyKey, 'utf8'));
		try {
			await wrangler([
				'workflows',
				'trigger',
				'silent-video-validation',
				JSON.stringify(input),
				'--id',
				validationId,
				'--config',
				validatorConfig,
			]);
			let output;
			for (let attempt = 1; attempt <= 120; attempt++) {
				const described = await wrangler([
					'workflows',
					'instances',
					'describe',
					'silent-video-validation',
					validationId,
					'--config',
					validatorConfig,
				]);
				const status = described.match(/^Status:[^\S\n]+(\S[^\n]*)$/m)?.[1] ?? '';
				if (status.includes('Complete')) {
					// The final step's Output line carries the workflow return as
					// an escaped JSON string literal.
					const outputs = [...described.matchAll(/^\s+Output:\s+("(?:\\.|[^"\\])*")$/gm)];
					const raw = outputs.at(-1)?.[1];
					if (!raw)
						throw new Error(`${name}: completed instance did not expose a step output`);
					output = JSON.parse(JSON.parse(raw));
					break;
				}
				if (status.includes('Errored') || status.includes('Terminated'))
					throw new Error(`${name}: deployed validation settled as ${status}`);
				await new Promise(resolve => setTimeout(resolve, 5000));
			}
			if (!output)
				throw new Error(`${name}: deployed validation did not complete in time`);
			if (output.outcome !== 'accepted'
				|| output.idempotencyKey !== input.idempotencyKey
				|| output.mutedInlinePlayback !== true
				|| output.seeked !== true
				|| (fixture.facts.hasAlpha && output.transparencyRendered !== true)) {
				throw new Error(`${name}: deployed validation output is not an exact acceptance: ${JSON.stringify(output)}`);
			}
			const workspace = await mkdtemp(join(tmpdir(), 'silent-video-acceptance-poster-'));
			const posterFile = join(workspace, 'poster.png');
			try {
				await wrangler([
					'r2',
					'object',
					'get',
					`stream-graphics-asset-staging/${output.posterKey}`,
					'--file',
					posterFile,
					'--remote',
					'--config',
					validatorConfig,
				]);
				const posterBytes = await readFile(posterFile);
				if (sha256Hex(posterBytes) !== output.posterDigest)
					throw new Error(`${name}: deployed poster does not match its digest`);
			}
			finally {
				await rm(workspace, { recursive: true, force: true });
			}
			process.stdout.write(`${name}: deployed validation accepted with verified poster\n`);
		}
		finally {
			for (const key of [
				`ingestion/${operationId}/source`,
				`validation/silent-video/${validationId}/poster`,
			]) {
				await wrangler([
					'r2',
					'object',
					'delete',
					`stream-graphics-asset-staging/${key}`,
					'--remote',
					'--config',
					validatorConfig,
				]).catch(() => undefined);
			}
		}
	}
}

if (deployed)
	await runDeployedAcceptance();
else
	await runLocalAcceptance();
process.stdout.write(`silent-video validator acceptance passed (${deployed ? 'deployed' : 'local'})\n`);
