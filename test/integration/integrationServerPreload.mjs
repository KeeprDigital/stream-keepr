// Preloaded into each integration server and its worker threads (`integrationServerEnv`
// in `./helpers.ts`; worker threads through `./serverConnectionDiagnostics.mjs`).
// Once per thread, however many routes lead here.
import process from 'node:process';
import { installEarlyAnswerDrain } from './earlyAnswerDrain.mjs';
import { installServerConnectionDiagnostics } from './serverConnectionDiagnostics.mjs';

const INSTALLED = Symbol.for('stream-keepr.integrationServerPreload');
if (!(/** @type {any} */ (globalThis))[INSTALLED]) {
	(/** @type {any} */ (globalThis))[INSTALLED] = process.pid;
	installServerConnectionDiagnostics({ announce: true });
	installEarlyAnswerDrain();
}
