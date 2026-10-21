import type { ChildProcess } from 'node:child_process';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { acceptanceProfilePrefix, checkoutProfileMarker } from '../../../scripts/graphics-acceptance/chromium-profile.mjs';
import { launchChromium } from '../../../scripts/graphics-acceptance/chromium.mjs';

/**
 * The acceptance browser always goes away (#687).
 *
 * A headless Chrome from an acceptance run was found orphaned, ignoring SIGTERM
 * and spinning at 100% CPU for an hour and a half, which slowed every run
 * beside it. These drive the real launcher against a stand-in that behaves the
 * same way — it ignores SIGINT and SIGTERM and answers no protocol — so what is
 * proven is the escalation, not Chrome's good manners.
 */
const STUBBORN_CHROME = fileURLToPath(new URL('./fixtures/stubborn-chrome.mjs', import.meta.url));
const RUNNER = fileURLToPath(new URL('./fixtures/chromium-runner.mjs', import.meta.url));
const CHECKOUT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');

chmodSync(STUBBORN_CHROME, 0o755);

const strays = new Set<number>();
const runners = new Set<ChildProcess>();

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	}
	catch {
		return false;
	}
}

async function gone(pid: number, withinMs: number): Promise<boolean> {
	const deadline = Date.now() + withinMs;
	while (Date.now() < deadline) {
		if (!alive(pid))
			return true;
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	return !alive(pid);
}

afterEach(() => {
	for (const pid of strays) {
		if (alive(pid))
			process.kill(pid, 'SIGKILL');
	}
	strays.clear();
	for (const runner of runners)
		runner.kill('SIGKILL');
	runners.clear();
});

/** Start the runner fixture and read the stand-in's pid and profile from it. */
async function startRunner(...args: string[]) {
	const runner = spawn(process.execPath, [RUNNER, STUBBORN_CHROME, ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
	runners.add(runner);
	const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve =>
		runner.once('exit', (code, signal) => resolve({ code, signal })));
	let output = '';
	const launched = await new Promise<{ pid: number; profile: string }>((resolve, reject) => {
		runner.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
			output += chunk;
			const line = output.split('\n').find(candidate => candidate.startsWith('{'));
			if (line)
				resolve(JSON.parse(line));
		});
		runner.once('exit', () => reject(new Error(`runner exited before launching: ${output}`)));
	});
	strays.add(launched.pid);
	return { runner, exited, printed: () => output, ...launched };
}

/** The stand-in, launched through the real launcher with a short SIGTERM grace. */
async function launchStandIn() {
	const browser = await launchChromium(STUBBORN_CHROME, [], { terminateGraceMs: 200 });
	if (!browser?.pid)
		throw new Error('the stand-in did not launch');
	strays.add(browser.pid);
	return { ...browser, pid: browser.pid };
}

describe('the acceptance browser\'s shutdown', () => {
	it('escalates to SIGKILL when the browser ignores the protocol and SIGTERM', async () => {
		const browser = await launchStandIn();

		await browser.dispose();

		expect(alive(browser.pid)).toBe(false);
		expect(existsSync(browser.profile)).toBe(false);
	});

	it('stops a browser that never announced itself rather than leaving it to run on', async () => {
		const tag = `--stand-in=${process.pid}-${Date.now()}`;

		await expect(launchChromium(STUBBORN_CHROME, ['--silent', tag], { startupTimeoutMs: 300, terminateGraceMs: 200 }))
			.rejects
			.toThrow('Chrome DevTools endpoint timed out.');

		const ps = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
		expect(ps.split('\n').filter(line => line.includes(tag))).toEqual([]);
	});

	it('names its profile after this checkout, so a reap can tell it from anyone else\'s browser', async () => {
		const browser = await launchStandIn();

		expect(basename(browser.profile).startsWith(acceptanceProfilePrefix(checkoutProfileMarker(CHECKOUT)))).toBe(true);
		await browser.dispose();
	});

	it.each(['SIGTERM', 'SIGINT'] as const)('takes the browser down with it when the runner gets %s', async (signal) => {
		const { runner, exited, pid, profile } = await startRunner();

		runner.kill(signal);

		expect(await exited).toEqual({ code: null, signal });
		expect(await gone(pid, 2_000)).toBe(true);
		expect(existsSync(profile)).toBe(false);
	});

	it('leaves a runner\'s own SIGTERM handler to finish, and still takes the browser down', async () => {
		const { runner, exited, pid, printed } = await startRunner('own-cleanup');

		runner.kill('SIGTERM');

		expect(await exited).toEqual({ code: 0, signal: null });
		expect(printed()).toContain('own cleanup finished');
		expect(await gone(pid, 2_000)).toBe(true);
	});

	it('takes the browser down at once on a second signal', async () => {
		const { runner, exited, pid } = await startRunner();

		runner.kill('SIGINT');
		runner.kill('SIGINT');

		expect(await exited).toEqual({ code: null, signal: 'SIGINT' });
		expect(await gone(pid, 1_000)).toBe(true);
	});

	it('takes the browser down with it when the runner exits without disposing it', async () => {
		const { exited, pid } = await startRunner('exit');

		expect(await exited).toEqual({ code: 3, signal: null });
		expect(await gone(pid, 2_000)).toBe(true);
	});
});
