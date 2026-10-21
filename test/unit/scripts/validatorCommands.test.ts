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

function adapter(result = { code: 0, stdout: '' }) {
	const execute = vi.fn(async (_argv: string[], _options: { cwd: string; env: Record<string, string | undefined> }) => result);
	const commands = createWranglerCommands({
		repoRoot: '/repo',
		execute,
		baseEnv: { PATH: '/bin', CLOUDFLARE_ACCOUNT_ID: 'the-shell-account' },
	});
	return { execute, commands };
}

describe('the validator command adapter', () => {
	it('runs every remote command on the target\'s account, bucket, Workflow and config', async () => {
		const { execute, commands } = adapter();

		await commands.deleteObject({ target: TARGET, key: 'some/key' });
		await commands.triggerWorkflow({ target: TARGET, id: 'an-id', params: { a: 1 } });
		await commands.probeBucket({ target: TARGET });
		await commands.probeWorkflow({ target: TARGET });

		expect(execute.mock.calls.map(([argv]) => argv)).toEqual([
			['r2', 'object', 'delete', 'a-staging-bucket/some/key', '--remote', '--config', TARGET.validatorConfigPath],
			['workflows', 'trigger', 'a-workflow', '{"a":1}', '--id', 'an-id', '--config', TARGET.validatorConfigPath],
			['r2', 'bucket', 'info', 'a-staging-bucket', '--config', TARGET.validatorConfigPath],
			['workflows', 'describe', 'a-workflow', '--config', TARGET.validatorConfigPath],
		]);
		for (const [, options] of execute.mock.calls) {
			expect(options.env.CLOUDFLARE_ACCOUNT_ID).toBe(TARGET.accountId);
			expect(options.cwd).toBe('/repo');
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
