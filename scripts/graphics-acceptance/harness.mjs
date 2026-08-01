/**
 * The shape every acceptance harness runs inside.
 *
 * A harness has exactly two ways to end — a pass line or a block of stable
 * codes — and both go through the evidence formatter. Wrapping them here means
 * an unexpected throw cannot escape as a raw Node message: an aborted fetch or
 * a refused connection would otherwise print a URL, and a failed provisioning
 * step would print the asset identity in its path.
 */

import process from 'node:process';
import { AcceptanceFailure, createAcceptanceEvidence } from './evidence.mjs';

/**
 * Reduce an unexpected error to something safe to print. Only the shape of the
 * failure survives; anything the error chose to say about it does not.
 */
const UNREACHABLE = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'ETIMEDOUT']);

function unexpectedFailure(error) {
	// `fetch` reports a transport failure as a bare TypeError and puts the
	// useful code one or more `cause` links down.
	let code;
	for (let current = error, depth = 0; current && depth < 4; current = current.cause, depth += 1) {
		if (typeof current.code === 'string') {
			code = current.code;
			break;
		}
	}
	if (UNREACHABLE.has(code))
		return new AcceptanceFailure('harness-installation-unreachable', { reason: code });
	return new AcceptanceFailure('harness-precondition-unmet', {
		reason: code ?? error?.name ?? 'unknown',
	});
}

/**
 * @param {{
 *   harness: string,
 *   secrets?: readonly string[],
 *   run: (context: {
 *     evidence: ReturnType<typeof createAcceptanceEvidence>,
 *     record: (failures: { code: string, detail?: object }[]) => void,
 *     note: (failure: { code: string, detail?: object }) => void,
 *     checks: () => number,
 *   }) => Promise<object | void>,
 * }} options
 */
export async function runAcceptanceHarness({ harness, secrets = [], run }) {
	const evidence = createAcceptanceEvidence({ harness, secrets });
	const failures = [];
	const notes = [];
	let checks = 0;

	let deferral;
	const context = {
		evidence,
		record(found) {
			checks += 1;
			failures.push(...found);
		},
		note(failure) {
			notes.push(failure);
		},
		/**
		 * End without proving anything, because a driver the run needs is not
		 * available. A deferred run is never a pass: it prints what a person
		 * still has to observe, and says plainly that nothing was proved.
		 */
		defer(detail, instructions) {
			deferral = { detail, instructions };
		},
		checks: () => checks,
	};

	let summary;
	try {
		summary = await run(context) ?? {};
	}
	catch (error) {
		const failure = error instanceof AcceptanceFailure ? error : unexpectedFailure(error);
		failures.push({ code: failure.code, detail: failure.detail });
	}

	for (const entry of notes)
		process.stdout.write(`${evidence.report([entry])} (reported, not enforced)\n`);

	if (failures.length > 0) {
		process.stderr.write(`${harness} acceptance failed:\n${evidence.report(failures)}\n`);
		process.exitCode = 1;
		return;
	}
	if (deferral) {
		if (deferral.instructions)
			process.stdout.write(`${deferral.instructions}\n`);
		process.stdout.write(`${evidence.deferred(deferral.detail)}\n`);
		return;
	}
	process.stdout.write(`${evidence.passed({ checks, ...summary })}\n`);
}
