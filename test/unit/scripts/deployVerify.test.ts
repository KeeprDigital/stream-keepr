import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeployVerifyFailure, verifyDeployment } from '../../../scripts/deploy-verify.mjs';
import { LOAD_TOLERANT_WAIT_MS } from '../../helpers/loadTolerantBounds';

const SCRIPT = 'scripts/deploy-verify.mjs';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const HTML = 'text/html; charset=utf-8';
const SPA_FALLBACK = '<!DOCTYPE html><html><body><div id="__nuxt"></div></body></html>';
const READING = '{"serverTime":1760000000000}';

/**
 * A stand-in for a deployed origin on localhost: real HTTP, no deployment, no
 * credentials, no network beyond loopback. The probe's rules are driven through
 * the script's exported probe; only what the command adds to it (the target
 * from the environment, the exit code, the liveness claim) spawns the script.
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

	// The script's own retry policy, without its real five-second pauses.
	const fast = { attempts: 3, retryDelayMs: 0 };

	interface WrongAnswer {
		answer: string;
		status?: number;
		contentType?: string;
		location?: string;
		body?: string;
		named: RegExp;
	}

	it.each<WrongAnswer>([
		{
			answer: 'a redirect to a sign-in page',
			status: 302,
			location: '/login',
			named: /302.*\/login/,
		},
		{
			answer: 'a 200 HTML page such as an SPA fallback',
			contentType: HTML,
			body: SPA_FALLBACK,
			named: /text\/html/,
		},
		{ answer: 'a JSON content type whose body does not parse', body: '{"serverTime": 17', named: /not valid JSON/ },
		{ answer: 'a JSON null', body: 'null', named: /serverTime/ },
		{ answer: 'a JSON array', body: `[${READING}]`, named: /serverTime/ },
		{ answer: 'a string serverTime', body: '{"serverTime":"1760000000000"}', named: /serverTime/ },
		{ answer: 'a fractional serverTime', body: '{"serverTime":1760000000000.5}', named: /serverTime/ },
		{ answer: 'a non-positive serverTime', body: '{"serverTime":0}', named: /serverTime/ },
		{ answer: 'a JSON error envelope', body: '{"statusCode":503,"message":"Service Unavailable"}', named: /serverTime/ },
		{
			answer: 'status 201 with a clock-reading body',
			status: 201,
			body: READING,
			named: /answered 201/,
		},
		{
			answer: 'status 401 with a clock-reading body',
			status: 401,
			body: READING,
			named: /answered 401/,
		},
	])('fails $answer on its first answer, following and retrying nothing', async ({ status = 200, contentType = 'application/json', location, body, named }) => {
		const requested: string[] = [];
		// Every other path answers the clock reading, so a redirect that was followed would pass.
		const url = await origin((request, response) => {
			requested.push(request.url ?? '');
			if (request.url !== '/api/time')
				return response.writeHead(200, { 'content-type': 'application/json' }).end(READING);
			response.writeHead(status, {
				'content-type': contentType,
				...(location
					? { location }
					: {}),
			}).end(body);
		});

		const outcome: unknown = await verifyDeployment({ baseUrl: url, ...fast }).catch((error: unknown) => error);

		expect(outcome).toBeInstanceOf(DeployVerifyFailure);
		expect((outcome as DeployVerifyFailure).message).toMatch(named);
		expect(requested).toEqual(['/api/time']);
	});

	it.each([
		'not a url',
		'ftp://127.0.0.1',
		'127.0.0.1:3000',
		'http://127.0.0.1:9/?preview=1',
		'http://127.0.0.1:9/#top',
	])('refuses the target %j without probing anything', async (target) => {
		const fetchRequest = vi.fn();

		const outcome: unknown = await verifyDeployment({
			baseUrl: target,
			fetchRequest: fetchRequest as unknown as typeof fetch,
			...fast,
		}).catch((error: unknown) => error);

		expect(outcome).toBeInstanceOf(DeployVerifyFailure);
		expect((outcome as DeployVerifyFailure).message).toContain('STREAM_KEEPR_DEPLOY_HEALTH_URL');
		expect(fetchRequest).not.toHaveBeenCalled();
	});

	describe('retrying what a fresh promotion can still be settling', () => {
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
				json({
					serverTime: Date.now(),
				})(request, response);
			});

			await expect(verifyDeployment({ baseUrl: url, ...fast })).resolves.toMatchObject({ url: `${url}/api/time` });
			expect(requests).toBe(2);
		});

		it('fails an origin nothing is listening on, after every attempt', async () => {
			// What Node's fetch rejects with on a closed port. A port bound and
			// released here could be taken again before the probe connected.
			const fetchRequest = vi.fn(async () => {
				throw new TypeError('fetch failed', {
					cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' }),
				});
			});

			const failure = verifyDeployment({
				baseUrl: 'https://127.0.0.1',
				fetchRequest: fetchRequest as unknown as typeof fetch,
				...fast,
			});

			await expect(failure).rejects.toBeInstanceOf(DeployVerifyFailure);
			await expect(failure).rejects.toThrow(/could not be reached \(ECONNREFUSED\)/);
			expect(fetchRequest).toHaveBeenCalledTimes(3);
		});

		it('fails an origin that accepts the connection and never answers, after every attempt', async () => {
			const url = await origin(() => {});
			// Counted where the probe asks: a request its timeout cuts off may never reach the origin.
			const fetchRequest = vi.fn((...request: Parameters<typeof fetch>) => fetch(...request));

			await expect(verifyDeployment({
				baseUrl: url,
				fetchRequest: fetchRequest as unknown as typeof fetch,
				...fast,
				timeoutMs: 25,
			})).rejects.toThrow(/could not be reached/);
			expect(fetchRequest).toHaveBeenCalledTimes(3);
		});
	});

	describe('run as the command, its target in STREAM_KEEPR_DEPLOY_HEALTH_URL', () => {
		function runScript(healthUrl: string) {
			return new Promise<{ code: number | null; output: string }>((resolve) => {
				execFile(process.execPath, [SCRIPT], {
					env: { ...process.env, STREAM_KEEPR_DEPLOY_HEALTH_URL: healthUrl },
					timeout: LOAD_TOLERANT_WAIT_MS,
				}, (error, stdout, stderr) => {
					resolve({
						code: error
							? (error.code as number) ?? 1
							: 0,
						output: `${stdout}${stderr}`,
					});
				});
			});
		}

		it('exits 0 on the clock reading, and claims liveness only', async () => {
			const requested: string[] = [];
			const url = await origin((request, response) => {
				requested.push(request.url ?? '');
				json({
					serverTime: Date.now(),
				})(request, response);
			});

			const { code, output } = await runScript(`${url}/`);

			expect(code).toBe(0);
			expect(requested).toEqual(['/api/time']);
			expect(output).toContain('liveness only');
			expect(output).not.toMatch(/new release is serving/i);
		});

		it('exits non-zero on a wrong answer, naming it and claiming nothing', async () => {
			const url = await origin((_request, response) => {
				response.writeHead(200, { 'content-type': HTML });
				response.end(SPA_FALLBACK);
			});

			const { code, output } = await runScript(url);

			expect(code).not.toBe(0);
			expect(output).toContain('text/html');
			expect(output).not.toContain('liveness only');
		});
	});
});
