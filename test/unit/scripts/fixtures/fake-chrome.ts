import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

/**
 * A browser process the launcher can spawn without one: stderr is written by
 * the test, and `kill` stops it only for the signals in `diesOn`. With none, it
 * is the browser no real process can stand in for, one that outlives SIGKILL.
 */
export function fakeChrome({ diesOn = ['SIGTERM', 'SIGKILL'] }: { diesOn?: readonly NodeJS.Signals[] } = {}) {
	const child = Object.assign(new EventEmitter(), {
		pid: 424242,
		exitCode: null as number | null,
		signalCode: null as NodeJS.Signals | null,
		stderr: new PassThrough(),
		kill(signal: NodeJS.Signals = 'SIGTERM') {
			if (diesOn.includes(signal))
				queueMicrotask(() => exit(signal));
			return true;
		},
	});
	function exit(signal: NodeJS.Signals) {
		if (child.exitCode !== null || child.signalCode !== null)
			return;
		child.signalCode = signal;
		child.stderr.end();
		child.emit('exit', null, signal);
	}
	let profile: string | undefined;
	let spawned!: () => void;
	const started = new Promise<void>(resolve => spawned = resolve);
	return {
		child,
		/** A `spawn` that hands the launcher this process and notes the profile it was given. */
		spawn: (_command: string, args: readonly string[]) => {
			profile = args.find(arg => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
			spawned();
			return child;
		},
		/** Settles once the launcher has spawned it and is reading its stderr. */
		started: () => started.then(() => new Promise(resolve => setImmediate(resolve))),
		profile: () => profile,
		say: (text: string) => child.stderr.write(text),
		/** Lets the launcher see the process gone, the way the OS eventually would. */
		reap: () => exit('SIGKILL'),
	};
}
