import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

/**
 * The fan-out probe's refusal to default its origin (#289).
 *
 * This is the only part of `scripts/measure-realtime-fanout.mjs` a test can
 * reach. Everything past the refusal needs a live installation and a real Ably
 * key, and the probe is a writer — it provisions an Event, three Screen Outputs
 * and a live session — so there is no harmless way to exercise it here. The
 * refusal is also the part worth pinning: it used to default to
 * `http://127.0.0.1:8787`, the port every worktree on the machine shares, and
 * round nine records a harness on that port writing into a sibling lane's
 * database.
 *
 * Imported dynamically rather than at the top of the file, so the "importing it
 * contacts nothing" test evaluates the module for the first time with the fetch
 * spy already in place. A static import would have run it before the spy
 * existed and made that assertion vacuous.
 */
const PROBE_MODULE = '../../../scripts/measure-realtime-fanout.mjs';
const PROBE_PATH = fileURLToPath(new URL(PROBE_MODULE, import.meta.url));

async function loadProbe() {
	return import(PROBE_MODULE) as Promise<{
		probeOrigin: (env?: Record<string, string | undefined>) => string;
		RealtimeFanoutProbeRefusal: new (message: string) => Error;
	}>;
}

describe('the fan-out probe refuses to default its origin', () => {
	it('throws its own named error when PROBE_ORIGIN is unset', async () => {
		const { probeOrigin, RealtimeFanoutProbeRefusal } = await loadProbe();

		expect(() => probeOrigin({})).toThrow(RealtimeFanoutProbeRefusal);
		expect(() => probeOrigin({})).toThrow(/PROBE_ORIGIN is unset/);
	});

	/**
	 * A distinguishable name, not just a message. A caller reading a stack has to
	 * be able to tell "this never started" from "this failed mid-measurement",
	 * because only the second leaves an Event behind.
	 */
	it('names the error so a refusal is not read as a failed measurement', async () => {
		const { probeOrigin } = await loadProbe();

		expect(() => probeOrigin({})).toThrowError(
			expect.objectContaining({ name: 'RealtimeFanoutProbeRefusal' }),
		);
	});

	it('refuses a blank or whitespace-only origin too', async () => {
		const { probeOrigin, RealtimeFanoutProbeRefusal } = await loadProbe();

		expect(() => probeOrigin({ PROBE_ORIGIN: '' })).toThrow(RealtimeFanoutProbeRefusal);
		expect(() => probeOrigin({ PROBE_ORIGIN: '   ' })).toThrow(RealtimeFanoutProbeRefusal);
	});

	/**
	 * The forward control. A guard that refused everything would pass every test
	 * above and be useless, so the case it must *not* refuse is asserted too.
	 */
	it('accepts an origin the caller named, trailing slash and all', async () => {
		const { probeOrigin } = await loadProbe();

		expect(probeOrigin({ PROBE_ORIGIN: 'http://127.0.0.1:8799' })).toBe('http://127.0.0.1:8799');
		expect(probeOrigin({ PROBE_ORIGIN: 'http://127.0.0.1:8799/' })).toBe('http://127.0.0.1:8799');
		expect(probeOrigin({ PROBE_ORIGIN: '  http://127.0.0.1:8799  ' })).toBe('http://127.0.0.1:8799');
	});

	it('contacts nothing — not on import, and not on the refusal', async () => {
		const fetchSpy = vi.fn(async () => new Response(null));
		vi.stubGlobal('fetch', fetchSpy);
		vi.resetModules();

		const { probeOrigin } = await loadProbe();
		expect(() => probeOrigin({})).toThrow();

		expect(fetchSpy).not.toHaveBeenCalled();

		// The instrument's own control: the spy is wired to the global the probe
		// would have called, so the zero above is a measurement and not a blind
		// spot.
		await globalThis.fetch('http://127.0.0.1:1/never-reached');
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		vi.unstubAllGlobals();
		vi.resetModules();
	});

	/**
	 * Run for real, as an operator would run it. This is what proves the
	 * entry-point guard fires at all — every test above calls an exported
	 * function, which would keep passing if the guard were wrong and the script
	 * did nothing when invoked. The environment is built rather than inherited so
	 * an ambient `PROBE_ORIGIN` cannot turn this into a live measurement.
	 */
	it('exits non-zero naming the refusal when run with no origin', () => {
		const { PROBE_ORIGIN: _discarded, ...ambient } = process.env;
		const run = spawnSync(process.execPath, [PROBE_PATH], {
			env: ambient,
			encoding: 'utf8',
			timeout: 60_000,
		});

		expect(run.status).not.toBe(0);
		expect(run.stderr).toContain('RealtimeFanoutProbeRefusal');
		expect(run.stderr).toContain('PROBE_ORIGIN is unset');
		// It never got as far as saying which installation it was writing to.
		expect(run.stderr).not.toContain('provisioning against');
	});
});
