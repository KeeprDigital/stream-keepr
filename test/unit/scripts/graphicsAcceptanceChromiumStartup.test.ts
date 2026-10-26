import { execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { launchChromium, warmChromium } from '../../../scripts/graphics-acceptance/chromium.mjs';

/**
 * A browser that fails to start says why (#790).
 *
 * CI's browser gate failed with only "Chrome DevTools endpoint timed out.", so
 * nothing in the log could tell a hung Chrome from a crashed one or from one
 * that listened without saying so. These drive the real launcher against the
 * stand-in, which writes to stderr what a real Chrome would log.
 */
const STUBBORN_CHROME = fileURLToPath(new URL('./fixtures/stubborn-chrome.mjs', import.meta.url));

chmodSync(STUBBORN_CHROME, 0o755);

const quick = { startupTimeoutMs: 300, terminateGraceMs: 200 };

async function startupFailure(args: string[]): Promise<string> {
	const error = await launchChromium(STUBBORN_CHROME, args, quick).then(
		() => { throw new Error('the stand-in launched'); },
		(failure: Error) => failure,
	);
	return error.message;
}

describe('the acceptance browser\'s startup', () => {
	it('says what a browser that never announced itself printed, and how it was stopped', async () => {
		const message = await startupFailure(['--silent', '--say=ERROR:bus.cc(407)] Failed to connect to the bus']);

		expect(message).toContain('Chrome DevTools endpoint timed out.');
		expect(message).toContain('ERROR:bus.cc(407)] Failed to connect to the bus');
		expect(message).toContain('still running after 300 ms');
		expect(message).toContain('stopped by SIGKILL');
		expect(message).toContain('no DevToolsActivePort');
	});

	it('says how a browser that left before announcing itself exited, and what it printed', async () => {
		const message = await startupFailure(['--say=FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox!', '--exit=0']);

		expect(message).toMatch(/^Chromium exited with code 0 before announcing its DevTools endpoint\./);
		expect(message).toContain('FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox!');
		expect(message).toContain('already exited');
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

	it('says why a browser could not start even on an idle machine', async () => {
		process.env.CHROME_BIN = STUBBORN_CHROME;

		await expect(warmChromium({
			extraArgs: ['--silent', '--say=still loading fonts'],
			...quick,
		}))
			.rejects
			.toThrow(/Chrome DevTools endpoint timed out\.[\s\S]*still loading fonts/);
	});
});
