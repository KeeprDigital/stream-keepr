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
		{
			argv: ['--port=9101', '--ip', '127.0.0.1'],
			port: 9101,
		},
	])('fires the minute cron at the built Worker on port $port until Wrangler exits', async ({ argv, port }) => {
		const { child, spawnProcess } = fakeWrangler();
		const fetchRequest = vi.fn(async (_url: string) => new Response('ok'));

		const exited = runPreviewWorker({
			argv,
			repositoryRoot,
			// Wrangler is stood in for by an emitter with `kill`, all the launcher uses.
			spawnProcess: spawnProcess as unknown as typeof spawn,
			fetchRequest: fetchRequest as unknown as typeof fetch,
		});
		await vi.advanceTimersByTimeAsync(0);

		const [, wranglerArguments] = spawnProcess.mock.calls[0]!;
		expect(wranglerArguments).toEqual(expect.arrayContaining([
			'--test-scheduled',
			'--port',
			String(port),
		]));
		expect(wranglerArguments.filter(argument => argument.startsWith('--port'))).toEqual(['--port']);
		expect(fetchRequest).toHaveBeenLastCalledWith(`http://localhost:${port}/__scheduled?cron=*+*+*+*+*`);

		const firings = fetchRequest.mock.calls.length;
		child.emit('exit', 0, null);
		expect(await exited).toBe(0);
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		expect(fetchRequest).toHaveBeenCalledTimes(firings);
	});

	it('fires its first minute once Wrangler is listening', async () => {
		const { child, spawnProcess } = fakeWrangler();
		const refused = Object.assign(new TypeError('fetch failed'), {
			cause: { code: 'ECONNREFUSED' },
		});
		const fetchRequest = vi.fn(async (_url: string) => new Response('ok'))
			.mockRejectedValueOnce(refused)
			.mockRejectedValueOnce(refused);

		const exited = runPreviewWorker({
			argv: [],
			repositoryRoot,
			spawnProcess: spawnProcess as unknown as typeof spawn,
			fetchRequest: fetchRequest as unknown as typeof fetch,
		});

		await vi.waitFor(() => expect(fetchRequest).toHaveBeenCalledTimes(3));
		expect(await fetchRequest.mock.results[2]!.value).toBeInstanceOf(Response);
		child.emit('exit', 0, null);
		await exited;
	});

	it.each([
		['--port', 'nope'],
		['--port=0'],
	])('refuses %s before starting Wrangler', async (...argv) => {
		const { spawnProcess } = fakeWrangler();

		await expect(runPreviewWorker({
			argv,
			repositoryRoot,
			spawnProcess: spawnProcess as unknown as typeof spawn,
		})).rejects.toThrow('--port must be a TCP port');
		expect(spawnProcess).not.toHaveBeenCalled();
	});
});
