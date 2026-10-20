import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { DeployVerifyFailure, verifyDeployment } from '../../../scripts/deploy-verify.mjs';

const SCRIPT = 'scripts/deploy-verify.mjs';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

/**
 * A stand-in for a deployed origin on localhost: real HTTP, no deployment, no
 * credentials, no network beyond loopback. Each case spawns the real script,
 * except the retry cases, which call its exported probe to skip the pauses.
 */
describe('deploy:verify against a local stand-in origin', () => {
	const servers: Server[] = [];

	afterEach(async () => {
		await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
	});

	async function origin(handler: Handler) {
		const server = createServer(handler);
		servers.push(server);
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	}

	function json(body: unknown, status = 200): Handler {
		return (_request, response) => {
			response.writeHead(status, { 'content-type': 'application/json' });
			response.end(JSON.stringify(body));
		};
	}

	function runScript(healthUrl: string) {
		return new Promise<{ code: number | null; output: string }>((resolve) => {
			execFile(process.execPath, [SCRIPT], {
				env: { ...process.env, STREAM_KEEPR_DEPLOY_HEALTH_URL: healthUrl },
				timeout: 20_000,
			}, (error, stdout, stderr) => {
				resolve({ code: error ? (error.code as number) ?? 1 : 0, output: `${stdout}${stderr}` });
			});
		});
	}

	it('passes a live origin answering the clock reading, and claims liveness only', async () => {
		const requested: string[] = [];
		const url = await origin((request, response) => {
			requested.push(request.url ?? '');
			json({ serverTime: Date.now() })(request, response);
		});

		const { code, output } = await runScript(`${url}/`);

		expect(code).toBe(0);
		expect(requested).toEqual(['/api/time']);
		expect(output).toContain('liveness only');
		expect(output).not.toMatch(/new release is serving/i);
	});

	it('fails a redirect to a sign-in page without following it', async () => {
		const requested: string[] = [];
		const url = await origin((request, response) => {
			requested.push(request.url ?? '');
			if (request.url === '/login')
				return json({ serverTime: Date.now() })(request, response);
			response.writeHead(302, { location: '/login' });
			response.end();
		});

		const { code, output } = await runScript(url);

		expect(code).not.toBe(0);
		expect(requested).toEqual(['/api/time']);
		expect(output).toContain('302');
		expect(output).toContain('/login');
		expect(output).not.toContain('liveness only');
	});

	it('fails a 200 HTML page such as an SPA fallback', async () => {
		const url = await origin((_request, response) => {
			response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
			response.end('<!DOCTYPE html><html><body><div id="__nuxt"></div></body></html>');
		});

		const { code, output } = await runScript(url);

		expect(code).not.toBe(0);
		expect(output).toContain('text/html');
		expect(output).not.toContain('liveness only');
	});

	it('fails a JSON content type whose body does not parse', async () => {
		const url = await origin((_request, response) => {
			response.writeHead(200, { 'content-type': 'application/json' });
			response.end('{"serverTime": 17');
		});

		const { code, output } = await runScript(url);

		expect(code).not.toBe(0);
		expect(output).toMatch(/not valid JSON/);
		expect(output).not.toContain('liveness only');
	});

	it.each([
		['an empty object', {}],
		['a JSON null', null],
		['an array', [{ serverTime: 1_760_000_000_000 }]],
		['a string serverTime', { serverTime: '1760000000000' }],
		['a fractional serverTime', { serverTime: 1_760_000_000_000.5 }],
		['a non-positive serverTime', { serverTime: 0 }],
		['a JSON error envelope', { statusCode: 503, message: 'Service Unavailable' }],
	])('fails a JSON body of the wrong shape: %s', async (_name, body) => {
		const url = await origin(json(body));

		const { code, output } = await runScript(url);

		expect(code).not.toBe(0);
		expect(output).toContain('serverTime');
		expect(output).not.toContain('liveness only');
	});

	it.each([201, 203, 401, 404])('fails status %i even with a clock-reading body', async (status) => {
		const url = await origin(json({ serverTime: Date.now() }, status));

		const { code, output } = await runScript(url);

		expect(code).not.toBe(0);
		expect(output).toContain(`answered ${status}`);
		expect(output).not.toContain('liveness only');
	});

	it.each(['not a url', 'ftp://127.0.0.1', '127.0.0.1:3000', 'http://127.0.0.1:9/?preview=1', 'http://127.0.0.1:9/#top'])('refuses the target %j without probing anything', async (target) => {
		const { code, output } = await runScript(target);

		expect(code).not.toBe(0);
		expect(output).toContain('STREAM_KEEPR_DEPLOY_HEALTH_URL');
		expect(output).not.toContain('Retrying');
	});

	describe('retrying what a fresh promotion can still be settling', () => {
		// The script's own retry policy, called in-process so the test need not
		// sit through the real five-second pauses. Still real HTTP to loopback.
		const fast = { attempts: 3, retryDelayMs: 0 };

		it('fails an origin that keeps answering 503, after every attempt', async () => {
			let requests = 0;
			const url = await origin((_request, response) => {
				requests += 1;
				response.writeHead(503, { 'content-type': 'text/plain' });
				response.end('Service Unavailable');
			});

			const failure = verifyDeployment({ baseUrl: url, ...fast });

			await expect(failure).rejects.toBeInstanceOf(DeployVerifyFailure);
			await expect(failure).rejects.toThrow(/answered 503/);
			expect(requests).toBe(3);
		});

		it('passes once a 503 settles into the clock reading', async () => {
			let requests = 0;
			const url = await origin((request, response) => {
				requests += 1;
				if (requests === 1) {
					response.writeHead(503);
					return response.end();
				}
				json({ serverTime: Date.now() })(request, response);
			});

			await expect(verifyDeployment({ baseUrl: url, ...fast })).resolves.toMatchObject({ url: `${url}/api/time` });
			expect(requests).toBe(2);
		});

		it('fails an origin nothing is listening on', async () => {
			const url = await origin(json({ serverTime: Date.now() }));
			await new Promise(resolve => servers.pop()!.close(resolve));

			await expect(verifyDeployment({ baseUrl: url, ...fast })).rejects.toThrow(DeployVerifyFailure);
		});

		it('fails an origin that accepts the connection and never answers', async () => {
			let requests = 0;
			const url = await origin(() => {
				requests += 1;
			});

			await expect(verifyDeployment({ baseUrl: url, ...fast, timeoutMs: 100 })).rejects.toThrow(/could not be reached/);
			expect(requests).toBe(3);
		});

		it('does not retry a definitive wrong answer', async () => {
			let requests = 0;
			const url = await origin((_request, response) => {
				requests += 1;
				response.writeHead(200, { 'content-type': 'text/html' });
				response.end('<html></html>');
			});

			await expect(verifyDeployment({ baseUrl: url, ...fast })).rejects.toThrow(/text\/html/);
			expect(requests).toBe(1);
		});
	});
});

/**
 * The probe's exit code is only as good as what waits on it. `pnpm run deploy`
 * must end in it, and the Deploy workflow's `production` tag (the deployed-state
 * marker) must move only after that step succeeded.
 */
describe('a failed deploy:verify cannot advance the production marker', () => {
	const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>;

	it('pnpm deploy:verify runs this probe, and pnpm run deploy ends in it with nothing to swallow its failure', () => {
		expect(scripts['deploy:verify']).toBe(`node ${SCRIPT}`);
		const deploy = scripts.deploy!;
		expect(deploy).not.toMatch(/\|\||;|(^|[^&])&([^&]|$)/);
		expect(deploy.split('&&').map(command => command.trim()).at(-1)).toBe('pnpm deploy:verify');
	});

	it('the workflow moves the production tag only in a later, unconditional step after the deploy step', () => {
		const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
		const steps = workflow.slice(workflow.indexOf('    steps:\n')).split(/^ {6}- /m).slice(1);
		const deployStep = steps.findIndex(step => /^\s+run: pnpm run deploy$/m.test(step));
		const markerStep = steps.findIndex(step => /^\s+run: git push \S+ \S*refs\/tags\/production$/m.test(step));

		expect(deployStep).toBeGreaterThanOrEqual(0);
		expect(markerStep).toBeGreaterThan(deployStep);
		// A step-level `if:` replaces the implicit `success()`; `continue-on-error`
		// lets a failure through. Neither may touch the deploy or the marker step.
		for (const step of [steps[deployStep], steps[markerStep]])
			expect(step).not.toMatch(/^\s+(if|continue-on-error):/m);
	});
});
