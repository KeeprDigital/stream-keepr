/**
 * The shape every acceptance harness runs inside.
 *
 * A harness has exactly two ways to end — a pass line or a block of stable
 * codes — and both go through the evidence formatter. Wrapping them here means
 * an unexpected throw cannot escape as a raw Node message: an aborted fetch or
 * a refused connection would otherwise print a URL, and a failed provisioning
 * step would print the asset identity in its path.
 *
 * The formatter itself is the last thing to run, after the run's own `try`, and
 * it reports a leak by throwing — so it was the one call whose failure escaped
 * the wrapping, printing an absolute filesystem path per stack frame on the
 * path built to prevent exactly that (#275). Nothing below throws now: a
 * refused line degrades to its stable codes, and a refused closing line ends
 * the run as a failure, because a leak is itself one.
 */

import process from 'node:process';
import { ACCEPTANCE_FAILURE_CODES, AcceptanceFailure, createAcceptanceEvidence } from './evidence.mjs';

const PUBLISHED_CODES = new Set(ACCEPTANCE_FAILURE_CODES);

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
 * Say that a line was refused, in the words the formatter refused it with.
 *
 * Those words are assembled from the harness name, a leak code, and the name of
 * the field that carried the value — never the value — so the message is
 * printable as it stands. Anything else reaching here is not the formatter
 * talking, and is reduced to the fact that a line could not be built.
 */
function refusalLine(harness, error) {
	const message = error instanceof Error ? error.message : '';
	return message.startsWith(`${harness} evidence-`) && !/[/\\]/.test(message)
		? message
		: `${harness} evidence-report-refused`;
}

/**
 * The failures themselves, once the formatter has refused their details.
 *
 * A code is contract and safe to print — but only one the registry publishes. A
 * browser verdict names its own code and that name is untrusted page text
 * (`chromium.mjs`), so an unpublished code is replaced by the formatter's own
 * word for it rather than echoed on the way out.
 */
function reportFailures(evidence, harness, failures) {
	try {
		return evidence.report(failures);
	}
	catch (error) {
		return [
			...failures.map(({ code }) =>
				`${harness} ${PUBLISHED_CODES.has(code) ? code : 'evidence-unknown-code'} detail=withheld`),
			refusalLine(harness, error),
		].join('\n');
	}
}

/**
 * Whatever `run` returns is merged into the pass line, so a harness can say
 * what it covered without printing anything itself.
 *
 * @param {{
 *   harness: string,
 *   secrets?: readonly string[],
 *   run: (context: {
 *     evidence: ReturnType<typeof createAcceptanceEvidence>,
 *     record: (failures: { code: string, detail?: object }[]) => void,
 *     note: (failure: { code: string, detail?: object }) => void,
 *     defer: (detail: object, instructions?: string) => void,
 *     checks: () => number,
 *     failed: () => boolean,
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
		/**
		 * Whether anything has been recorded against the run so far. A harness
		 * that has to tidy up differently depending on the verdict — keeping a
		 * restore path a failed run still needs, say — asks here rather than
		 * guessing from its own last statement.
		 */
		failed: () => failures.length > 0,
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
		process.stdout.write(`${reportFailures(evidence, harness, [entry])} (reported, not enforced)\n`);

	if (failures.length > 0) {
		process.stderr.write(`${harness} acceptance failed:\n${reportFailures(evidence, harness, failures)}\n`);
		process.exitCode = 1;
		return;
	}

	// A leak is itself a failure, so a run whose closing line the formatter
	// refuses has not been observed to pass: it ends as the refusal rather than
	// as the summary it could not print.
	let closing;
	try {
		closing = deferral ? evidence.deferred(deferral.detail) : evidence.passed({ checks, ...summary });
	}
	catch (error) {
		process.stderr.write(`${harness} acceptance failed:\n${refusalLine(harness, error)}\n`);
		process.exitCode = 1;
		return;
	}
	if (deferral?.instructions)
		process.stdout.write(`${deferral.instructions}\n`);
	process.stdout.write(`${closing}\n`);
}
