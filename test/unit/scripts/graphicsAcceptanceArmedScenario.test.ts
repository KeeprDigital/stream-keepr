import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	readArmedScenario,
	releaseArmedScenario,
	writeArmedScenario,
} from '../../../scripts/graphics-acceptance/armed-scenario.mjs';

describe('an armed fault-injection scenario', () => {
	let directory: string;
	let path: string;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), 'sk-armed-'));
		path = join(directory, 'armed.json');
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	const scenario = {
		warm: { eventId: 1, assetId: 'gaa-warm', contentDigest: 'a'.repeat(64), content: [1, 2, 3] },
		cold: { eventId: 2, assetId: 'gaa-cold', contentDigest: 'b'.repeat(64), content: [4, 5, 6] },
	};

	it('round-trips what the fault run needs to reach the same identities', async () => {
		await writeArmedScenario(path, scenario);

		expect(await readArmedScenario(path)).toEqual(scenario);
	});

	it('is readable only by the operator who armed it', async () => {
		await writeArmedScenario(path, scenario);

		// It carries a live capability, so it must not be world-readable.
		expect((await stat(path)).mode & 0o077).toBe(0);
	});

	it('is deleted once the fault run has passed', async () => {
		await writeArmedScenario(path, scenario);

		expect(await releaseArmedScenario(path, { passed: true })).toEqual({ kept: false });
		await expect(readFile(path)).rejects.toThrow();
	});

	it('survives a failed fault run, because it is the only copy of the bytes to restore', async () => {
		await writeArmedScenario(path, scenario);

		expect(await releaseArmedScenario(path, { passed: false })).toEqual({ kept: true });
		expect(await readArmedScenario(path)).toEqual(scenario);
	});

	it('reports nothing kept when there was no file to keep', async () => {
		expect(await releaseArmedScenario(path, { passed: false })).toEqual({ kept: false });
	});

	it('refuses a file that is not an armed scenario rather than half-reading it', async () => {
		await writeFile(path, JSON.stringify({ eventId: 1, assetId: 'gaa-1' }));

		await expect(readArmedScenario(path)).rejects.toThrow('harness-precondition-unmet');
	});
});
