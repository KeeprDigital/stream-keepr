import { execFileSync } from 'node:child_process';
import { chmodSync, rmSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { launchChromium, warmChromium } from '../../../scripts/graphics-acceptance/chromium.mjs';
import { fakeChrome } from './fixtures/fake-chrome';

/**
 * A browser that fails to start says why (#790).
 *
 * CI's browser gate failed with only "Chrome DevTools endpoint timed out.", so
 * nothing in the log could tell a hung Chrome from a crashed one or from one
 * that listened without saying so. These drive the real launcher against a
 * stand-in that writes to stderr what a real Chrome would log. A bound is short
 * only where it is meant to run out, and then nothing has to happen before it
 * does: a spawned stand-in is still booting when a short one ends on a busy machine.
 */
const STUBBORN_CHROME = fileURLToPath(new URL('./fixtures/stubborn-chrome.mjs', import.meta.url));

chmodSync(STUBBORN_CHROME, 0o755);

async function startupFailure(...launch: Parameters<typeof launchChromium>): Promise<string> {
	const error = await launchChromium(...launch).then(
		() => { throw new Error('the stand-in launched'); },
		(failure: Error) => failure,
	);
	return error.message;
}

describe('the acceptance browser\'s startup', () => {
	it('says what a browser that never announced itself printed, and how it was stopped', async () => {
		// In this process, and heard from as it is spawned: before either bound starts.
		const chrome = fakeChrome({
			diesOn: ['SIGKILL'],
		});
		const message = await startupFailure('chrome', [], {
			startupTimeoutMs: 50,
			terminateGraceMs: 50,
			spawnProcess: (command: string, args: readonly string[]) => {
				const child = chrome.spawn(command, args);
				chrome.say('ERROR:bus.cc(407)] Failed to connect to the bus\n');
				return child;
			},
		});

		expect(message).toContain('Chrome DevTools endpoint timed out.');
		expect(message).toContain('ERROR:bus.cc(407)] Failed to connect to the bus');
		expect(message).toContain('still running after 50 ms');
		expect(message).toContain('stopped by SIGKILL');
		expect(message).toContain('no DevToolsActivePort');
	});

	it('says how a browser that left before announcing itself exited, and what it printed', async () => {
		const message = await startupFailure(STUBBORN_CHROME, ['--say=FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox!', '--exit=0']);

		expect(message).toMatch(/^Chromium exited with code 0 before announcing its DevTools endpoint\./);
		expect(message).toContain('FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox!');
		expect(message).toContain('already exited');
	});
});

describe('the acceptance browser\'s DevTools endpoint', () => {
	it.each([
		{
			chunks: ['DevTools listening on ws://127.0.0.1:9/devtools/browser/whole\n'],
		},
		{
			chunks: ['DevTools listening on ws://127.0.0.1:9/devtools/bro', 'wser/whole\n'],
		},
		{
			chunks: ['DevTools listen', 'ing on ws://127.0.0.1:9/devtools/browser/whole', '\nnext line'],
		},
	])('is read from a complete line however stderr splits it: $chunks', async ({ chunks }) => {
		const chrome = fakeChrome();
		const launching = launchChromium('chrome', [], { spawnProcess: chrome.spawn });
		await chrome.started();
		for (const chunk of chunks) {
			chrome.say(chunk);
			await new Promise(resolve => setImmediate(resolve));
		}

		const browser = await launching;

		expect(browser?.endpoint).toBe('ws://127.0.0.1:9/devtools/browser/whole');
		chrome.reap();
		rmSync(chrome.profile()!, { recursive: true, force: true });
	});
});

describe('warming the acceptance browser', () => {
	const chromeBin = process.env.CHROME_BIN;
	afterEach(() => {
		if (chromeBin === undefined)
			delete process.env.CHROME_BIN;
		else
			process.env.CHROME_BIN = chromeBin;
	});

	it('starts the first available browser once and leaves nothing running', async () => {
		const tag = `--stand-in=${process.pid}-${Date.now()}`;
		process.env.CHROME_BIN = STUBBORN_CHROME;

		await expect(warmChromium({
			extraArgs: [tag],
			terminateGraceMs: 200,
		})).resolves.toBe(STUBBORN_CHROME);

		const ps = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
		expect(ps.split('\n').filter(line => line.includes(tag))).toEqual([]);
	});
});
