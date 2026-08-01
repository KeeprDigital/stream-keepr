/**
 * The file that survives between arming a fault-injection scenario and running
 * the fault against it.
 *
 * A fault run happens in two halves with a person and a broken binding in
 * between, so the identities have to outlive the process that made them. This
 * file is how: it carries the two representations the fault modes address, a
 * live capability for each, and the exact bytes each one was published from.
 *
 * Those bytes matter more than they look. Once the operator has deleted a
 * canonical object, this file holds the only copy of what was there — so the
 * file is deleted when a fault run passes and **kept when one fails**, because
 * a failed run is exactly the case where the operator still needs to restore
 * what they broke and try again.
 */

import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { AcceptanceFailure } from './evidence.mjs';
import { screenOutputRepresentation } from './routes.mjs';

/**
 * What one representation looks like on disk, and how it comes back.
 *
 * Both directions live beside the completeness check so that adding a field is
 * one edit rather than three.
 */
export function armedRepresentation(representation) {
	return {
		eventId: representation.eventId,
		screenId: representation.screenId,
		assetId: representation.assetId,
		revisionId: representation.revisionId,
		capability: representation.capability,
		contentType: representation.contentType,
		// The canonical object key is `sha256/<digest>`, so recording the digest is
		// what makes the runbook's delete step something an operator can carry out
		// at all — the harness itself never prints an identity. Digested here
		// rather than through the installation module's helper so that this file
		// depends only on routes and evidence, and stays unit-testable without
		// dragging in the TypeScript bridge.
		contentDigest: createHash('sha256').update(representation.content).digest('hex'),
		content: [...representation.content],
	};
}

export function restoreArmedRepresentation(stored) {
	return screenOutputRepresentation({ ...stored, content: Uint8Array.from(stored.content) });
}

/** Written 0600: it carries live capabilities for two Screen Outputs. */
export async function writeArmedScenario(path, scenario) {
	await writeFile(path, JSON.stringify(scenario), { mode: 0o600 });
}

export async function readArmedScenario(path) {
	let parsed;
	try {
		parsed = JSON.parse(await readFile(path, 'utf8'));
	}
	catch {
		throw new AcceptanceFailure('harness-precondition-unmet', {
			reason: 'the armed scenario could not be read',
		});
	}
	// Half-reading an older or hand-edited file would address the wrong
	// representation and report a fault that was never injected.
	if (!parsed?.warm || !parsed?.cold) {
		throw new AcceptanceFailure('harness-precondition-unmet', {
			reason: 'the armed scenario is missing a representation',
		});
	}
	return parsed;
}

/**
 * @returns {Promise<{ kept: boolean }>} Whether the file is still on disk, so
 * the caller can tell the operator where their restore path went.
 */
export async function releaseArmedScenario(path, { passed }) {
	if (!passed) {
		const exists = await readFile(path).then(() => true, () => false);
		return { kept: exists };
	}
	await rm(path, { force: true });
	return { kept: false };
}
