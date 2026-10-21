/**
 * An acceptance runner reduced to its browser (#687): it launches the stubborn
 * stand-in through the real launcher, says which pid it got, and waits to be
 * stopped. Usage: node chromium-runner.mjs <stand-in> [exit | own-cleanup]
 *
 * `exit` leaves without disposing the browser. `own-cleanup` gives the runner
 * a SIGTERM handler of its own, as `verify` and `worker:smoke` have, which
 * takes a moment and then exits 0 — and must be left to finish.
 */
import process from 'node:process';
import { launchChromium } from '../../../../scripts/graphics-acceptance/chromium.mjs';

const mode = process.argv[3];
if (mode === 'own-cleanup') {
	process.once('SIGTERM', () => setTimeout(() => {
		process.stdout.write('own cleanup finished\n');
		process.exit(0);
	}, 500));
}

const browser = await launchChromium(process.argv[2], [], { terminateGraceMs: 200 });
process.stdout.write(`${JSON.stringify({ pid: browser.pid, profile: browser.profile })}\n`);
if (mode === 'exit')
	process.exit(3);
setInterval(() => {}, 1_000);
