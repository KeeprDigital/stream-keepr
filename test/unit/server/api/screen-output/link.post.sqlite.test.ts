import type { H3Event } from 'h3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { refusalFrom } from '~~/test/helpers/publicServerFailure';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Screen Output Link is exchanged, once, for its Screen's capability. Every refusal is the
// Screen Output surface's one 404; only a storage failure is anything else.

const signingKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const otherSigningKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';

const harness = await createSqliteD1Harness();
const realDb = drizzle(harness.database, { schema });

/** Set to make every Screen lookup fail, as an unreachable database does. */
let storageUnavailable = false;
const db = new Proxy(realDb, {
	get(target, property) {
		if (property === 'query') {
			return {
				...target.query,
				screens: {
					...target.query.screens,
					findFirst: async (...args: Parameters<typeof target.query.screens.findFirst>) => {
						if (storageUnavailable)
							throw new Error('D1_ERROR: network error');
						return await target.query.screens.findFirst(...args);
					},
				},
			};
		}
		const value = Reflect.get(target, property, target);
		return typeof value === 'function'
			? value.bind(target)
			: value;
	},
});
vi.doMock('~~/server/db', () => ({ db }));

/** Whether the request carries a Session, as every request does under the local auth bypass. */
let signedIn = false;
vi.doMock('~~/server/utils/auth', () => ({
	requireUserId: async () => 'user-1',
	optionalUserSession: async () => signedIn
		? {
				user: { id: 'user-1' },
				session: { id: 'session-1' },
			}
		: null,
}));

interface StubEvent {
	params?: Record<string, string>;
	body?: unknown;
	bodyIsNotJson?: boolean;
	headers: Record<string, string>;
	responseHeaders: Record<string, unknown>;
}
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('useRuntimeConfig', () => ({ screenOutputCapabilitySigningKey: signingKey }));
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('getRequestHeader', (event: StubEvent, name: string) => event.headers[name]);
vi.stubGlobal('setResponseHeader', (event: StubEvent, name: string, value: unknown) => {
	event.responseHeaders[name] = value;
});
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));
// h3 refuses a body that is not JSON with its own 400; the route must not pass that on.
vi.stubGlobal('readBody', async (event: StubEvent) => {
	if (event.bodyIsNotJson)
		throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 });
	return event.body;
});

type Handler = (event: H3Event) => Promise<unknown>;
const exchangeLink = (await import('~~/server/api/screen-output/link.post')).default as unknown as Handler;
const getAssetCapability = (await import('~~/server/api/events/[id]/screens/[screenId]/asset-capability.get')).default as unknown as Handler;
const rotateAssetCapability = (await import('~~/server/api/events/[id]/screens/[screenId]/asset-capability.post')).default as unknown as Handler;
const getOutputScreen = (await import('~~/server/api/screen-output/events/[id]/screens/[screenId]/index.get')).default as unknown as Handler;
const { createScreenOutputAssetCapabilityManager } = await import('~~/server/modules/screen-output-assets/manager');
const { createScreenOutputLink } = await import('~~/server/modules/screen-output-assets/link');
const { screenService } = await import('~~/server/services/screen');

const manager = createScreenOutputAssetCapabilityManager({
	signingKey,
	screens: screenService(),
});

interface Issued { assetCapability: string; outputLink: string }
interface Exchanged { eventId: number; screenId: number; assetCapability: string }

let eventId: number;
let screenId: number;
let neighbourId: number;
let screenSeq = 0;

async function createScreen(): Promise<number> {
	screenSeq += 1;
	const prepared = await manager.prepare();
	const [screen] = await realDb.insert(schema.screens)
		.values({
			eventId,
			name: `Output ${screenSeq}`,
			slug: `output-${screenSeq}`,
			...prepared.persisted,
		})
		.returning({ id: schema.screens.id });
	return screen!.id;
}

function sessionRequest(id = screenId): StubEvent {
	return {
		params: {
			id: String(eventId),
			screenId: String(id),
		},
		headers: {},
		responseHeaders: {},
	};
}

function exchangeRequest(body: unknown, extra: Partial<StubEvent> = {}): StubEvent {
	return {
		body,
		headers: {},
		responseHeaders: {},
		...extra,
	};
}

async function issued(id = screenId): Promise<Issued> {
	return await getAssetCapability(stubH3Event({
		...sessionRequest(id),
	})) as Issued;
}

async function rotated(id = screenId): Promise<Issued> {
	return await rotateAssetCapability(stubH3Event({
		...sessionRequest(id),
	})) as Issued;
}

async function exchange(body: unknown): Promise<Exchanged> {
	return await exchangeLink(stubH3Event({
		...exchangeRequest(body),
	})) as Exchanged;
}

/** A Screen Output read of the Screen itself, presenting only this bearer. */
async function readScreenAsOutput(capability: string | null, id = screenId) {
	return await getOutputScreen(stubH3Event({
		...sessionRequest(id),
		headers: capability
			? { authorization: `Bearer ${capability}` }
			: {},
	})) as { id: number };
}

function refusalShape(failure: { statusCode?: number; statusMessage?: string; message?: string; data?: unknown }) {
	return {
		statusCode: failure.statusCode,
		statusMessage: failure.statusMessage,
		message: failure.message,
		data: failure.data,
	};
}

function lastCharacterChanged(text: string): string {
	return `${text.slice(0, -1)}${text.endsWith('2')
		? '3'
		: '2'}`;
}

beforeAll(async () => {
	const [event] = await realDb.insert(schema.events)
		.values({ name: 'Output Links', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	eventId = event!.id;
});

beforeEach(async () => {
	storageUnavailable = false;
	signedIn = false;
	screenId = await createScreen();
	neighbourId = await createScreen();
});

afterAll(async () => {
	await harness.close();
});

describe('what an operator is handed for a Screen', () => {
	it('answers the Screen Output Link beside the capability, which is unchanged by it', async () => {
		const current = await manager.current({ eventId, screenId });
		if (current.outcome !== 'available')
			throw new Error('expected a current capability');

		expect(await issued()).toEqual({
			assetCapability: current.capability,
			outputLink: current.link,
		});
	});

	it('answers the new link with the new capability when the capability is regenerated', async () => {
		const before = await issued();
		const after = await rotated();

		expect(after.outputLink).not.toBe(before.outputLink);
		expect(after.assetCapability).not.toBe(before.assetCapability);
		expect(await issued()).toEqual(after);
	});
});

describe('exchanging a Screen Output Link', () => {
	it('answers the Screen, its Event, and exactly the capability current() gives', async () => {
		const { outputLink } = await issued();
		const current = await manager.current({ eventId, screenId });
		if (current.outcome !== 'available')
			throw new Error('expected a current capability');

		expect(await exchange({ link: outputLink })).toEqual({
			eventId,
			screenId,
			assetCapability: current.capability,
		});
	});

	it('answers a capability that admits a Screen Output read, where no credential does not', async () => {
		const { assetCapability } = await exchange({ link: (await issued()).outputLink });

		expect((await readScreenAsOutput(assetCapability)).id).toBe(screenId);
		await expect(readScreenAsOutput(null)).rejects.toMatchObject({ statusCode: 404 });
	});

	it('answers each Screen for its own link, and neither for the other\'s', async () => {
		const own = await exchange({ link: (await issued()).outputLink });
		const neighbours = await exchange({ link: (await issued(neighbourId)).outputLink });

		expect(own.screenId).toBe(screenId);
		expect(neighbours.screenId).toBe(neighbourId);
		expect(neighbours.assetCapability).not.toBe(own.assetCapability);
		await expect(readScreenAsOutput(neighbours.assetCapability)).rejects.toMatchObject({ statusCode: 404 });
	});

	it('must not be stored by anything between the output and here', async () => {
		const event = exchangeRequest({ link: (await issued()).outputLink });

		await exchangeLink(stubH3Event({ ...event }));

		expect(event.responseHeaders).toEqual({ 'cache-control': 'private, no-store' });
	});

	// Regenerating the capability regenerates the link: before it the old one exchanges, after it only the new.
	it('stops exchanging a link once its capability is regenerated', async () => {
		const before = await issued();
		expect((await exchange({ link: before.outputLink })).assetCapability).toBe(before.assetCapability);

		const after = await rotated();

		await expect(exchange({ link: before.outputLink })).rejects.toMatchObject({ statusCode: 404 });
		expect(await exchange({ link: after.outputLink })).toEqual({
			eventId,
			screenId,
			assetCapability: after.assetCapability,
		});
	});

	// One refusal, the Screen Output surface's own, so nothing says which part was wrong.
	it.each<[string, (current: Issued) => Promise<Partial<StubEvent>> | Partial<StubEvent>]>([
		[
			'no body',
			() => ({ body: undefined }),
		],
		[
			'a body that is not JSON',
			() => ({ bodyIsNotJson: true }),
		],
		[
			'a null body',
			() => ({ body: null }),
		],
		[
			'a body that is the link alone',
			({ outputLink }) => ({ body: outputLink }),
		],
		[
			'a body that is a list',
			({ outputLink }) => ({
				body: [
					{ link: outputLink },
				],
			}),
		],
		[
			'a body with no link',
			() => ({ body: {} }),
		],
		[
			'a link that is not text',
			() => ({
				body: { link: 17 },
			}),
		],
		[
			'the right link beside another field',
			({ outputLink }) => ({
				body: { link: outputLink, screenId },
			}),
		],
		[
			'an empty link',
			() => ({
				body: { link: '' },
			}),
		],
		[
			'text that is not a link',
			() => ({
				body: { link: 'not a link at all' },
			}),
		],
		[
			'a character outside the alphabet',
			({ outputLink }) => ({
				body: { link: `${outputLink.slice(0, -1)}0` },
			}),
		],
		[
			'a second spelling of the right link',
			({ outputLink }) => ({
				body: { link: `1${outputLink}` },
			}),
		],
		[
			'the right link and a trailing space',
			({ outputLink }) => ({
				body: { link: `${outputLink} ` },
			}),
		],
		[
			'a wrong MAC',
			({ outputLink }) => ({
				body: {
					link: lastCharacterChanged(outputLink),
				},
			}),
		],
		[
			'the capability presented as a link',
			({ assetCapability }) => ({
				body: { link: assetCapability },
			}),
		],
		[
			'a link signed with another key',
			async () => ({
				body: {
					link: await createScreenOutputLink({
						signingKey: otherSigningKey,
						screenId,
						seed: 'seed',
						version: 1,
					}),
				},
			}),
		],
		[
			'a Screen that does not exist',
			async () => ({
				body: {
					link: await createScreenOutputLink({
						signingKey,
						screenId: 999_999,
						seed: 'seed',
						version: 1,
					}),
				},
			}),
		],
		[
			'a link from before a rotation',
			async ({ outputLink }) => {
				await rotated();
				return {
					body: { link: outputLink },
				};
			},
		],
		[
			'a link to a deleted Screen',
			async ({ outputLink }) => {
				await realDb.delete(schema.screens).where(eq(schema.screens.id, screenId));
				return {
					body: { link: outputLink },
				};
			},
		],
		// Under the local auth bypass every request carries a Session; it names no Screen here.
		[
			'a Session and no link',
			() => {
				signedIn = true;
				return { body: {} };
			},
		],
		[
			'a Session and a wrong link',
			({ outputLink }) => {
				signedIn = true;
				return {
					body: {
						link: lastCharacterChanged(outputLink),
					},
				};
			},
		],
	])('refuses %s exactly as a Screen Output read refuses', async (_what, presented) => {
		const reference = refusalShape(await refusalFrom(readScreenAsOutput(null)));
		const request = exchangeRequest(undefined, await presented(await issued()));

		const refusal = await refusalFrom(exchangeLink(stubH3Event({ ...request })));

		expect(reference).toEqual({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Not found',
			data: undefined,
		});
		expect(refusalShape(refusal)).toEqual(reference);
	});

	// The Session that a Screen Output read admits is not a way in here.
	it('admits a Session on a Screen Output read while refusing it the exchange', async () => {
		signedIn = true;

		expect((await readScreenAsOutput(null)).id).toBe(screenId);
		await expect(exchange({})).rejects.toMatchObject({ statusCode: 404 });
	});

	// An output retries a 5xx and renders nothing on a 404, so the two must not be confused.
	it('answers a retryable 503, never the 404, when the Screen cannot be read', async () => {
		const { outputLink } = await issued();
		storageUnavailable = true;
		const request = exchangeRequest({ link: outputLink });

		const failure = await refusalFrom(exchangeLink(stubH3Event({ ...request })));

		expect(failure).toMatchObject({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'Screen Output Link exchange is temporarily unavailable',
		});
		expect(failure.message).not.toContain('D1_ERROR');
		expect(request.responseHeaders).toEqual({ 'retry-after': 5 });
	});
});
