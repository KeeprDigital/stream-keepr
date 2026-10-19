import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerLogWindow } from '~~/test/integration/serverLogWindow';

/**
 * What a failed integration test prints of its server's log (#633).
 *
 * A part upload answered 503 once and the server's account of why was in that
 * server's log file, which the next run overwrote before anyone read it. These
 * rows pin that a failure report carries the lines its own test caused, and
 * only those.
 */

const directories: string[] = [];

function logFile(contents = '') {
	const directory = mkdtempSync(join(tmpdir(), 'server-log-window-'));
	directories.push(directory);
	const path = join(directory, 'integration-1.log');
	writeFileSync(path, contents);
	return path;
}

afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

describe('the integration suite\'s server log window', () => {
	it('reads only what the server wrote after the test began', () => {
		const path = logFile('booted\n{"message":"api_request_failed","path":"/api/earlier"}\n');
		const window = createServerLogWindow(path);

		window.mark();
		appendFileSync(path, '{"message":"graphics_object_store_unavailable","operation":"uploadPart"}\n\n');
		appendFileSync(path, '{"message":"api_request_failed","statusCode":503}\n');

		expect(window.since()).toEqual([
			'{"message":"graphics_object_store_unavailable","operation":"uploadPart"}',
			'{"message":"api_request_failed","statusCode":503}',
		]);
	});

	it('keeps the most recent lines of a long window and says how many it left out', () => {
		const path = logFile();
		const window = createServerLogWindow(path, { maximumLines: 2 });

		window.mark();
		appendFileSync(path, 'first\nsecond\nthird\nfourth\n');

		expect(window.since()).toEqual(['… 2 earlier lines', 'third', 'fourth']);
	});

	it('reads nothing, rather than failing the report, when there is no log to read', () => {
		const window = createServerLogWindow(join(tmpdir(), 'no-such-directory', 'integration-9.log'));

		window.mark();

		expect(window.since()).toEqual([]);
	});
});
