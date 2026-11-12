import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
	createWranglerCommands,
	parseInstanceDescription,
	RemoteCommandFailure,
} from '../../../scripts/graphics-acceptance/validator-commands.mjs';

/**
 * The Wrangler command adapter the validator gate writes through (#619), driven
 * with a fake `execute` so no Wrangler process starts.
 */

const TARGET = {
	accountId: '0123456789abcdef0123456789abcdef',
	stagingBucket: 'a-staging-bucket',
	workflow: 'a-workflow',
	validatorConfigPath: '/repo/validator/wrangler.jsonc',
};

/** A stand-in Wrangler: it downloads an empty object to a `get`'s `--file`, and exits with `result`. */
function adapter(result = { code: 0, stdout: '' }) {
	const execute = vi.fn(async (argv: string[], _options: { cwd: string; env: Record<string, string | undefined> }) => {
		if (argv.includes('get'))
			await writeFile(argv[argv.indexOf('--file') + 1]!, '');
		return result;
	});
	const commands = createWranglerCommands({
		repoRoot: '/repo',
		execute,
		baseEnv: { PATH: '/bin', CLOUDFLARE_ACCOUNT_ID: 'the-shell-account' },
	});
	return { execute, commands };
}

describe('the validator command adapter', () => {
	type Commands = ReturnType<typeof adapter>['commands'];

	/** Each command as the gate calls it on a deployed target, and what its arguments must name: the target's bucket or Workflow, and for an object the remote store. */
	const REMOTE: Record<string, { run: (commands: Commands) => Promise<unknown>; names: string[] }> = {
		probeBucket: {
			run: commands => commands.probeBucket({ target: TARGET }),
			names: [TARGET.stagingBucket],
		},
		probeWorkflow: {
			run: commands => commands.probeWorkflow({ target: TARGET }),
			names: [TARGET.workflow],
		},
		putObject: {
			run: commands => commands.putObject({
				target: TARGET,
				key: 'some/key',
				bytes: new Uint8Array([1]),
				contentType: 'video/mp4',
			}),
			names: [`${TARGET.stagingBucket}/some/key`, '--remote'],
		},
		getObject: {
			run: commands => commands.getObject({ target: TARGET, key: 'some/key' }),
			names: [`${TARGET.stagingBucket}/some/key`, '--remote'],
		},
		deleteObject: {
			run: commands => commands.deleteObject({ target: TARGET, key: 'some/key' }),
			names: [`${TARGET.stagingBucket}/some/key`, '--remote'],
		},
		triggerWorkflow: {
			run: commands => commands.triggerWorkflow({
				target: TARGET,
				id: 'an-id',
				params: { a: 1 },
			}),
			names: [TARGET.workflow],
		},
		describeInstance: {
			run: commands => commands.describeInstance({ target: TARGET, id: 'an-id' }),
			names: [TARGET.workflow],
		},
	};

	// Every command the adapter has, so one added without a row here fails.
	it.each(Object.keys(adapter().commands))('%s reaches a deployed target on its own account and config, naming its bucket or Workflow', async (command) => {
		const { execute, commands } = adapter();
		expect(REMOTE).toHaveProperty(command);
		const { run, names } = REMOTE[command]!;

		await run(commands);

		expect(execute).toHaveBeenCalled();
		for (const [argv, options] of execute.mock.calls) {
			expect(options.env.CLOUDFLARE_ACCOUNT_ID).toBe(TARGET.accountId);
			expect(options.cwd).toBe('/repo');
			expect(argv[argv.indexOf('--config') + 1]).toBe(TARGET.validatorConfigPath);
			expect(argv).toEqual(expect.arrayContaining(names));
			expect(argv).not.toContain('--local');
		}
	});

	it('keeps a local run local, on no account', async () => {
		const { execute, commands } = adapter();

		await commands.putObject({
			target: { local: '/tmp/state', stagingBucket: 'b', validatorConfigPath: '/c' },
			key: 'k',
			bytes: new Uint8Array([1]),
			contentType: 'video/mp4',
		});

		const [argv, options] = execute.mock.calls[0]!;
		expect(argv).toEqual(expect.arrayContaining(['--local', '--persist-to', '/tmp/state']));
		expect(argv).not.toContain('--remote');
		expect(options.env.CLOUDFLARE_ACCOUNT_ID).toBe('the-shell-account');
	});

	it('fails with the step and exit code only, never the arguments or what Wrangler printed', async () => {
		const { commands } = adapter({ code: 1, stdout: 'a-staging-bucket/ingestion/acceptance-x-mp4/source not found' });

		const error = await commands.deleteObject({ target: TARGET, key: 'ingestion/acceptance-x-mp4/source' })
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(RemoteCommandFailure);
		expect(error).toMatchObject({ step: 'delete', exit: 1, message: 'wrangler delete exited 1' });
		expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toMatch(/ingestion|acceptance-x|a-staging-bucket/u);
	});
});

describe('reading a described Workflow instance', () => {
	it('reads the status, and the final step\'s output once complete', () => {
		const text = [
			'Name:      silent-video-validation',
			'Status:    ✅ Completed',
			'  Step: verify',
			'    Output:   "{\\"outcome\\":\\"pending\\"}"',
			'  Step: validate',
			'    Output:   "{\\"outcome\\":\\"accepted\\",\\"seeked\\":true}"',
		].join('\n');

		expect(parseInstanceDescription(text)).toEqual({
			status: '✅ Completed',
			output: { outcome: 'accepted', seeked: true },
		});
	});

	it('reads a running instance as no output yet', () => {
		expect(parseInstanceDescription('Status:    ▶ Running\n')).toEqual({ status: '▶ Running' });
	});
});
