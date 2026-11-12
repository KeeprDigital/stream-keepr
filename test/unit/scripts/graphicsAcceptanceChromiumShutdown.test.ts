import type { ChildProcess } from 'node:child_process';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acceptanceProfilePrefix, checkoutProfileMarker } from '../../../scripts/graphics-acceptance/chromium-profile.mjs';
import { launchChromium } from '../../../scripts/graphics-acceptance/chromium.mjs';
import { LOAD_TOLERANT_WAIT_MS } from '../../helpers/loadTolerantBounds';
import { fakeChrome } from './fixtures/fake-chrome';

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
/** A runner that goes at once, or exits, leaves its browser's profile where it was. */
const runnerProfiles = new Set<string>();

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	}
	catch {
		return false;
	}
}

/** Holds until `pid` is gone: a killed process goes when a busy machine gets round to it. */
function gone(pid: number) {
	return vi.waitFor(() => expect(alive(pid)).toBe(false));
}

/** The signals the stand-in has recorded ignoring, in order: none until it has taken one. */
function signalsReceived(profile: string): string[] {
	const record = join(profile, 'signals-received');
	return existsSync(record)
		? readFileSync(record, 'utf8').split('\n').filter(Boolean)
		: [];
}

/**
 * The graces for a stand-in that ignores SIGTERM and dies of SIGKILL. The first
 * is meant to run out; the second never is, so it is a hang bound and not a budget.
 */
const stubbornGraces = { terminateGraceMs: 200, killGraceMs: LOAD_TOLERANT_WAIT_MS };

afterEach(() => {
	for (const pid of strays) {
		if (alive(pid))
			process.kill(pid, 'SIGKILL');
	}
	strays.clear();
	for (const runner of runners)
		runner.kill('SIGKILL');
	runners.clear();
	for (const profile of runnerProfiles)
		rmSync(profile, { recursive: true, force: true });
	runnerProfiles.clear();
});

/** Start the runner fixture and read the stand-in's pid and profile from it. */
async function startRunner(...args: string[]) {
	const runner = spawn(process.execPath, [RUNNER, STUBBORN_CHROME, ...args], {
		stdio: ['ignore', 'pipe', 'inherit'],
	});
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
	runnerProfiles.add(launched.profile);
	return {
		runner,
		exited,
		printed: () => output,
		...launched,
	};
}

/** The stand-in, launched through the real launcher with a short SIGTERM grace. */
async function launchStandIn() {
	const browser = await launchChromium(STUBBORN_CHROME, [], stubbornGraces);
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

		await expect(launchChromium(STUBBORN_CHROME, ['--silent', tag], { ...stubbornGraces, startupTimeoutMs: 300 }))
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
		await gone(pid);
		expect(existsSync(profile)).toBe(false);
	});

	it('leaves a runner\'s own SIGTERM handler to finish, and still takes the browser down', async () => {
		const { runner, exited, pid, printed } = await startRunner('own-cleanup');

		runner.kill('SIGTERM');

		expect(await exited).toEqual({ code: 0, signal: null });
		// Its exit can be seen before the last of what it printed has been read.
		await vi.waitFor(() => expect(printed()).toContain('own cleanup finished'));
		await gone(pid);
	});

	it('takes the browser down at once on a second signal, without waiting out the grace', async () => {
		const { runner, exited, pid, profile } = await startRunner('patient');

		// The first signal is taken once the stand-in records the SIGTERM it brings. The
		// grace it starts outlasts the test, so only the second signal's skip ends the runner.
		runner.kill('SIGINT');
		await vi.waitFor(() => expect(signalsReceived(profile)).toEqual(['SIGTERM']));
		runner.kill('SIGINT');

		expect(await exited).toEqual({ code: null, signal: 'SIGINT' });
		await gone(pid);
	});

	it('takes the browser down with it when the runner exits without disposing it', async () => {
		const { exited, pid } = await startRunner('exit');

		expect(await exited).toEqual({ code: 3, signal: null });
		await gone(pid);
	});
});

describe('a browser that outlives SIGKILL', () => {
	const held: Array<ReturnType<typeof fakeChrome>> = [];
	afterEach(() => {
		vi.restoreAllMocks();
		for (const chrome of held.splice(0)) {
			chrome.reap();
			rmSync(chrome.profile()!, { recursive: true, force: true });
		}
	});

	type ImmortalChrome = ReturnType<typeof immortalChrome>;

	/** A Chrome no signal stops, so both of its graces are short: each is meant to run out. */
	function immortalChrome() {
		const chrome = fakeChrome({ diesOn: [] });
		held.push(chrome);
		const options = {
			terminateGraceMs: 100,
			killGraceMs: 100,
			spawnProcess: chrome.spawn,
		};
		return { chrome, options };
	}

	function captureStderr() {
		let written = '';
		vi.spyOn(process.stderr, 'write').mockImplementation((text: string | Uint8Array) => {
			written += String(text);
			return true;
		});
		return () => written;
	}

	it.each([
		{
			stopping: 'a browser that never announced itself, in its startup report',
			// It says nothing, so its startup bound is meant to run out as well.
			stop: async ({ options }: ImmortalChrome) => await launchChromium('chrome', [], { ...options, startupTimeoutMs: 100 }).then(
				() => { throw new Error('the stand-in launched'); },
				(failure: Error) => failure.message,
			),
		},
		{
			stopping: 'a browser being disposed of, on stderr',
			stop: async ({ chrome, options }: ImmortalChrome) => {
				const launching = launchChromium('chrome', [], options);
				await chrome.started();
				chrome.say('DevTools listening on ws://127.0.0.1:9/devtools/browser/immortal\n');
				const browser = await launching;
				const stderr = captureStderr();
				await browser!.dispose();
				return stderr();
			},
		},
	])('keeps the profile it still holds, and names it, when stopping $stopping', async ({ stop }) => {
		const stand = immortalChrome();

		const report = await stop(stand);

		expect(report).toContain('still running after SIGKILL');
		expect(report).toContain(`profile kept: ${stand.chrome.profile()}`);
		expect(existsSync(stand.chrome.profile()!)).toBe(true);
	});
});
