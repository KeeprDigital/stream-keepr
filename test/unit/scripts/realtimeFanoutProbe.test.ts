import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { probeOrigin, RealtimeFanoutProbeRefusal } from '../../../scripts/measure-realtime-fanout.mjs';

// The probe writes an Event and a live session, so the only reachable part is its
// refusal to default an origin: the old default, :8787, is the port every worktree
// shares (#289).
const PROBE_PATH = fileURLToPath(new URL('../../../scripts/measure-realtime-fanout.mjs', import.meta.url));

describe('the fan-out probe refuses to default its origin', () => {
	it.each([
		{},
		{ PROBE_ORIGIN: '' },
		{ PROBE_ORIGIN: '   ' },
	])('refuses %j with its own named error', (env) => {
		expect(() => probeOrigin(env)).toThrow(RealtimeFanoutProbeRefusal);
		expect(() => probeOrigin(env)).toThrowError(expect.objectContaining({ name: 'RealtimeFanoutProbeRefusal' }));
	});

	it.each(['http://127.0.0.1:8799', 'http://127.0.0.1:8799/', '  http://127.0.0.1:8799  '])('accepts the named origin %j', (origin) => {
		expect(probeOrigin({ PROBE_ORIGIN: origin })).toBe('http://127.0.0.1:8799');
	});

	it('exits non-zero naming the refusal before provisioning anything when run with no origin', () => {
		// The environment is built rather than inherited, so an ambient origin cannot make this a live run.
		const { PROBE_ORIGIN: _discarded, ...ambient } = process.env;
		const run = spawnSync(process.execPath, [PROBE_PATH], { env: ambient, encoding: 'utf8', timeout: 60_000 });

		expect(run.status).not.toBe(0);
		expect(run.stderr).toContain('RealtimeFanoutProbeRefusal');
		expect(run.stderr).not.toContain('provisioning against');
	});
});
