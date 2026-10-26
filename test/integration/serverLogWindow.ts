import { Buffer } from 'node:buffer';
import { closeSync, openSync, readSync, statSync } from 'node:fs';

/** How many of a failed test's server lines a report prints; the newest are kept. */
const DEFAULT_MAXIMUM_LINES = 40;

function byteLengthOf(path: string): number {
	try {
		return statSync(path).size;
	}
	catch {
		return 0;
	}
}

/**
 * The server log lines written while the current integration test ran (#633).
 *
 * Each server's whole output goes to one file (`./servers.ts`), and the next run
 * truncates it. A part upload answered 503 once, and whatever its server logged
 * about why — the failure line, the store's refusal — was gone before anyone
 * looked. `./requestLedgerReport.ts` marks the file's length as a test begins
 * and prints what was appended when it fails, so a failure carries its server's
 * side with it.
 *
 * Synchronous and total: it runs inside a failure report, which must say what it
 * can rather than fail itself. Imports only Node built-ins, so
 * `test/unit/integration/serverLogWindow.test.ts` can pin it without a server.
 */
export function createServerLogWindow(path: string, options: { maximumLines?: number } = {}) {
	const maximumLines = options.maximumLines ?? DEFAULT_MAXIMUM_LINES;
	let offset = 0;

	return {
		mark() {
			offset = byteLengthOf(path);
		},

		since(): string[] {
			const length = byteLengthOf(path) - offset;
			if (length <= 0)
				return [];
			let text: string;
			try {
				const descriptor = openSync(path, 'r');
				try {
					const buffer = Buffer.alloc(length);
					readSync(descriptor, buffer, 0, length, offset);
					text = buffer.toString('utf8');
				}
				finally {
					closeSync(descriptor);
				}
			}
			catch {
				return [];
			}
			const lines = text.split('\n').filter(Boolean);
			const elided = lines.length - maximumLines;
			return elided > 0
				? [
						`… ${elided} earlier lines`,
						...lines.slice(elided),
					]
				: lines;
		},
	};
}
