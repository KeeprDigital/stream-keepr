/**
 * What a deployed run wrote, written down before it was written (#619).
 *
 * The validator gate stages fixtures straight into the staging bucket, with no
 * Graphics Ingestion Operation behind them, so ordinary retention has no record
 * through which to find one a run abandoned. This file is that record. A key is
 * added **before** the command that creates it, so a run killed between the two
 * still lists it; it is removed only once its delete has succeeded. A run whose
 * deletes did not all succeed leaves the file behind, the next run refuses to
 * stage more until it is gone, and a cleanup retry works through it. R2 deletes
 * are idempotent, so retrying a key that is already gone is harmless.
 *
 * The file holds object keys, so it is private (0600), lives under the
 * gitignored `.cache/`, and is never printed: evidence carries only counts.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { AcceptanceFailure } from './evidence.mjs';

export const DEFAULT_CLEANUP_MANIFEST = fileURLToPath(
	new URL('../../.cache/acceptance/silent-video-validator-cleanup.json', import.meta.url),
);

/** The part of a target a manifest is bound to: where its objects are. */
function targetIdentity({ accountId, stagingBucket, workflow }) {
	return { accountId, stagingBucket, workflow };
}

function sameTarget(left, right) {
	return left.accountId === right.accountId
		&& left.stagingBucket === right.stagingBucket
		&& left.workflow === right.workflow;
}

/** @param {string} path */
export function openCleanupManifest(path) {
	let state;

	async function persist() {
		await mkdir(dirname(path), { recursive: true, mode: 0o700 });
		const temporary = `${path}.${process.pid}.tmp`;
		await writeFile(temporary, `${JSON.stringify(state, null, '\t')}\n`, { mode: 0o600 });
		await rename(temporary, path);
	}

	return {
		/** The manifest a previous run left, or undefined. */
		async read() {
			try {
				return JSON.parse(await readFile(path, 'utf8'));
			}
			catch (error) {
				if (error?.code === 'ENOENT')
					return undefined;
				throw new AcceptanceFailure('harness-precondition-unmet', { reason: 'cleanup-manifest-unreadable' });
			}
		},
		async begin(target) {
			state = { version: 1, target: targetIdentity(target), objects: [] };
			await persist();
		},
		async resume(manifest) {
			state = manifest;
		},
		/** Before the command that creates the object. */
		async record(key) {
			if (!state.objects.some(entry => entry.key === key)) {
				state.objects.push({ key });
				await persist();
			}
		},
		async forget(key) {
			state.objects = state.objects.filter(entry => entry.key !== key);
			if (state.objects.length === 0)
				await rm(path, { force: true });
			else
				await persist();
		},
		pending: () => state?.objects.map(entry => entry.key) ?? [],
	};
}

/**
 * Delete everything a manifest still lists, against the target it was written
 * for. Every key is tried even after one fails, and the count left is the
 * answer: zero is the only outcome that lets a run pass.
 */
export async function drainCleanupManifest({ manifest, commands, target }) {
	let cleaned = 0;
	for (const key of manifest.pending()) {
		try {
			await commands.deleteObject({ target, key });
			await manifest.forget(key);
			cleaned += 1;
		}
		catch {
			// Stays listed; the count below reports it.
		}
	}
	return { cleaned, remaining: manifest.pending().length };
}

/** Refuse a manifest that was written for some other account, bucket or Workflow. */
export function assertManifestTarget(manifest, target) {
	if (!manifest?.target || !sameTarget(manifest.target, target))
		throw new AcceptanceFailure('harness-target-inconsistent', { reason: 'manifest-target-mismatch' });
}
