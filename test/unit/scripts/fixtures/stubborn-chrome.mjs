#!/usr/bin/env node
/**
 * A stand-in for the acceptance Chrome that will not shut down politely (#687).
 *
 * The leaked browser #687 found ignored SIGTERM and spun until SIGKILL. This
 * announces a DevTools endpoint the way Chrome does, so the launcher accepts it,
 * then ignores SIGINT and SIGTERM. Nothing listens on the endpoint, so a
 * `Browser.close` over the protocol cannot reach it either.
 *
 * `--say=<text>` writes `<text>` to stderr first, the way Chrome logs what it is
 * stuck on (#790). `--exit=<code>` leaves with that code instead of running on.
 */
import process from 'node:process';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

process.on('SIGINT', () => {});
process.on('SIGTERM', () => {});
const said = option('say');
if (said !== undefined)
	process.stderr.write(`${said}\n`);
const exit = option('exit');
if (exit !== undefined)
	process.exit(Number(exit));
// `--silent` stands in for a browser too slow to announce itself at all.
if (!process.argv.includes('--silent'))
	process.stderr.write('\nDevTools listening on ws://127.0.0.1:9/devtools/browser/stubborn\n');
setInterval(() => {}, 1_000);
