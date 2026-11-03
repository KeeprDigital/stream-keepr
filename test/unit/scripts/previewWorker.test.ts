import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPreviewWorker } from '../../../scripts/preview-worker.mjs';

/*
 * `pnpm preview` runs the built Worker under local workerd, where no cron trigger
 * fires, so the launcher fires the Live Results cron through Wrangler's test
 * route each minute: the Worker's own scheduled handler, as Cloudflare calls it.
 */

const repositoryRoot = '/Users/dev/stream-keepr';

beforeEach(() => vi.useFakeTimers({
	toFake: ['setInterval', 'clearInterval'],
}));
afterEach(() => vi.useRealTimers());

function fakeWrangler() {
	const child = Object.assign(new EventEmitter(), {
		kill: vi.fn(),
	});
	const spawnProcess = vi.fn((_command: string, _arguments: string[]) => child);
	return { child, spawnProcess };
}

describe('the preview launcher', () => {
	it.each([
		{ argv: [], port: 8787 },
		{
			argv: ['--port', '9100'],
			port: 9100,
		},
	])('fires the minute cron at the built Worker on port $port each minute', async ({ argv, port }) => {
		const { child, spawnProcess } = fakeWrangler();
		const fetchRequest = vi.fn(async (_url: string) => new Response('ok'));

		const exited = runPreviewWorker({
			argv,
			repositoryRoot,
			// Wrangler is stood in for by an emitter with `kill`, all the launcher uses.
			spawnProcess: spawnProcess as unknown as typeof spawn,
			fetchRequest: fetchRequest as unknown as typeof fetch,
		});
		await vi.advanceTimersByTimeAsync(2 * 60_000);

		const [, wranglerArguments] = spawnProcess.mock.calls[0]!;
		expect(wranglerArguments).toEqual(expect.arrayContaining([
			'dev',
			'--local',
			'--test-scheduled',
			'--port',
			String(port),
		]));
		expect(fetchRequest.mock.calls.map(([url]) => url)).toEqual(
			Array.from({ length: 3 }).fill(`http://localhost:${port}/__scheduled?cron=*+*+*+*+*`),
		);

		child.emit('exit', 0, null);
		expect(await exited).toBe(0);
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		expect(fetchRequest).toHaveBeenCalledTimes(3);
	});
});
