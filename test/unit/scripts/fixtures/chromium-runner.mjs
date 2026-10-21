/**
 * An acceptance runner reduced to its browser (#687): it launches the stubborn
 * stand-in through the real launcher, says which pid it got, and waits to be
 * stopped. Usage: node chromium-runner.mjs <stand-in> [exit]
 */
import process from 'node:process';
import { launchChromium } from '../../../../scripts/graphics-acceptance/chromium.mjs';

const browser = await launchChromium(process.argv[2], [], { terminateGraceMs: 200 });
process.stdout.write(`${JSON.stringify({ pid: browser.pid, profile: browser.profile })}\n`);
if (process.argv[3] === 'exit')
	process.exit(3);
setInterval(() => {}, 1_000);
