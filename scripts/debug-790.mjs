// [DEBUG-790] Temporary CI probe: how does this runner's Chrome start? Never fails.
/* eslint-disable unused-imports/no-unused-vars, no-unmodified-loop-condition */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const LIMIT_MS = 40_000;
let gapsOf = false;
const say = line => process.stdout.write(`[DEBUG-790] ${line}\n`);

function run(command, args) {
	try {
		return execFileSync(command, args, { encoding: 'utf8', timeout: 10_000 }).trim();
	}
	catch (error) {
		return `(${command} failed: ${error.message.split('\n')[0]})`;
	}
}

say(`uname: ${run('uname', ['-a'])}`);
say(`chrome: ${run('google-chrome-stable', ['--version'])} at ${run('readlink', ['-f', run('which', ['google-chrome-stable'])])}`);
say(`nproc: ${run('nproc', [])}; load: ${run('cat', ['/proc/loadavg'])}`);
say(`dbus: DBUS_SESSION_BUS_ADDRESS=${process.env.DBUS_SESSION_BUS_ADDRESS ?? '(unset)'} XDG_RUNTIME_DIR=${process.env.XDG_RUNTIME_DIR ?? '(unset)'}`);
say(`userns: ${run('sysctl', ['-n', 'kernel.apparmor_restrict_unprivileged_userns'])}`);

const BASE = [
	'--headless=new',
	'--disable-gpu',
	'--no-sandbox',
	'--autoplay-policy=no-user-gesture-required',
	'--disable-background-media-suspend',
	'--remote-debugging-port=0',
	'--remote-allow-origins=*',
];

function processTree(pid) {
	return run('ps', ['-eo', 'pid,ppid,stat,wchan:24,etimes,pcpu,args', '--sort=pid'])
		.split('\n')
		.filter((line, index) => index === 0 || /chrome/.test(line))
		.map(line => line.slice(0, 220))
		.join('\n    ');
}

async function probe(name, extra = [], env = {}) {
	const profile = mkdtempSync(join(tmpdir(), 'debug-790-'));
	const started = Date.now();
	const at = () => Date.now() - started;
	const events = [];
	let stderr = '';
	let stdout = '';
	const child = spawn('google-chrome-stable', [...BASE, `--user-data-dir=${profile}`, ...extra], {
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env, ...env },
	});
	child.stderr.setEncoding('utf8').on('data', (chunk) => {
		if (!stderr)
			events.push(`first stderr @${at()}`);
		stderr += chunk;
		if (/DevTools listening on/.test(chunk))
			events.push(`stderr DevTools line @${at()}`);
	});
	child.stdout.setEncoding('utf8').on('data', (chunk) => {
		if (!stdout)
			events.push(`first stdout @${at()}`);
		stdout += chunk;
		if (/DevTools listening on/.test(chunk))
			events.push(`stdout DevTools line @${at()}`);
	});
	let exited;
	child.once('exit', (code, signal) => {
		exited = `${code}/${signal}`;
		events.push(`exit ${exited} @${at()}`);
	});
	let portFileAt;
	let snapshot = '';
	while (at() < LIMIT_MS && exited === undefined && !/DevTools listening on/.test(stderr + stdout)) {
		if (portFileAt === undefined && existsSync(join(profile, 'DevToolsActivePort'))) {
			portFileAt = at();
			events.push(`DevToolsActivePort @${portFileAt}: ${readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').trim().replace(/\n/g, ' ')}`);
		}
		if (!snapshot && at() > 10_000)
			snapshot = processTree(child.pid);
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	if (portFileAt === undefined && existsSync(join(profile, 'DevToolsActivePort')))
		events.push(`DevToolsActivePort present at end @${at()}`);
	const verdict = /DevTools listening on/.test(stderr + stdout) ? `READY @${at()}` : exited !== undefined ? `EXITED ${exited}` : `HUNG ${LIMIT_MS}`;
	child.kill('SIGTERM');
	const stoppedBy = await new Promise((resolve) => {
		if (exited !== undefined)
			return resolve('already');
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			resolve('SIGKILL');
		}, 3_000);
		child.once('exit', () => {
			clearTimeout(timer);
			resolve('SIGTERM');
		});
	});
	await new Promise(resolve => setTimeout(resolve, 300));
	rmSync(profile, { recursive: true, force: true });
	say(`--- ${name}: ${verdict}; stopped ${stoppedBy}`);
	say(`  events: ${events.join(' | ')}`);
	if (snapshot)
		say(`  ps @10s:\n    ${snapshot}`);
	if (gapsOf) {
		const lines = stderr.split('\n');
		const stamp = (line) => {
			const match = line.match(/^\[\d+:\d+:\d{4}\/(\d\d)(\d\d)(\d\d)\.(\d{6}):/);
			return match ? ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4]) / 1000 : undefined;
		};
		say(`  ${lines.length} stderr lines; first: ${lines[0]?.slice(0, 200)}`);
		let previous;
		let previousLine;
		for (const line of lines) {
			const at = stamp(line);
			if (at === undefined)
				continue;
			if (previous !== undefined && at - previous > 250) {
				say(`  GAP ${Math.round(at - previous)} ms`);
				say(`    before: ${previousLine.slice(0, 260)}`);
				say(`    after:  ${line.slice(0, 260)}`);
			}
			previous = at;
			previousLine = line;
		}
		const devtools = lines.findIndex(line => line.includes('DevTools listening'));
		say(`  around DevTools line:\n    ${lines.slice(Math.max(0, devtools - 8), devtools + 2).map(line => line.slice(0, 260)).join('\n    ')}`);
	}
	say(`  stdout tail: ${JSON.stringify(stdout.slice(-600))}`);
	say(`  stderr tail:\n${stderr.slice(-3_000).split('\n').map(line => `    ${line}`).join('\n')}`);
}

const home = process.env.HOME;
const state = () => say(`state: ${run('ls', ['-la', `${home}/.cache/fontconfig`, `${home}/.pki/nssdb`]).replace(/\n/g, ' ;; ').slice(0, 600)}`);
state();
say(`meminfo: ${run('grep', ['-E', '^(MemFree|Cached|Buffers):', '/proc/meminfo']).replace(/\n/g, ' ')}`);
say(`chrome dir size: ${run('du', ['-sh', '/opt/google/chrome'])}`);
gapsOf = true;
await probe('cold verbose', ['--enable-logging=stderr', '--v=1']);
gapsOf = false;
state();
{
	const started = Date.now();
	const fonts = run('fc-list', []).split('\n').length;
	say(`fc-list: ${fonts} fonts in ${Date.now() - started} ms`);
}
await probe('warm baseline');
