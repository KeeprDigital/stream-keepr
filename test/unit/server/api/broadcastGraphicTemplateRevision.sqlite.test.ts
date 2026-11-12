import type { H3Event } from 'h3';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import * as authSchema from '~~/server/db/schema/auth';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { refusalFrom } from '~~/test/helpers/publicServerFailure';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// Revising a Broadcast Graphic Template states the revision it was built on. A stale one
// is the author's 409, naming the revision that exists; none at all is refused outright.
// Either way the template stays as the last accepted revision left it.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({
	db,
	schema: {
		...schema,
		...authSchema,
	},
}));
vi.doMock('~~/server/utils/auth', () => ({
	requireUserId: async () => 'user-1',
	optionalBrowserSessionId: async () => 'session-1',
}));
// The Graphics Asset Library is the object-storage boundary; no template here pins a revision.
vi.doMock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => ({
		inspectGraphicAssetRevisions: async () => [],
		findInstalledGraphicsTemplate: async () => undefined,
	}),
}));

interface StubEvent { params: Record<string, string>; body: unknown }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('getRequestHeader', () => undefined);
vi.stubGlobal('getRequestWebStream', () => undefined);
vi.stubGlobal('readBody', async (event: StubEvent) => event.body);
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const reviseTemplate = (await import('~~/server/api/graphics-templates/broadcast-graphics/[templateId]/index.patch')).default as unknown as (event: H3Event) => Promise<{ revision: number }>;
const { broadcastGraphicTemplateService } = await import('~~/server/services/broadcastGraphicTemplate');

const TEMPLATE_ID = 'template';

function revise(body: Record<string, unknown>) {
	return reviseTemplate(stubH3Event({
		params: { templateId: TEMPLATE_ID },
		body,
	}));
}

async function stored() {
	const template = await broadcastGraphicTemplateService().findById(TEMPLATE_ID);
	return { description: template?.description, revision: template?.revision };
}

beforeEach(async () => {
	await db.delete(schema.broadcastGraphicTemplates);
	await broadcastGraphicTemplateService().create({
		id: TEMPLATE_ID,
		name: 'Lower third',
		description: null,
		document: { id: 'lower-third', name: 'Lower third', items: [] },
	});
});

afterAll(async () => await harness.close());

describe('revising a Broadcast Graphic Template', () => {
	it('refuses a revision built on a stale one with a 409 naming the revision that exists', async () => {
		// Two windows read revision 1; the first to write moves the template to revision 2.
		expect((await revise({ description: 'First writer wins', revision: 1 })).revision).toBe(2);

		const refusal = await refusalFrom(revise({ description: 'Second writer overwrites', revision: 1 }));

		expect(refusal).toMatchObject({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: 'Broadcast Graphic Template has been revised by another session (now revision 2)',
		});
		expect(await stored()).toEqual({ description: 'First writer wins', revision: 2 });
	});

	// Two fields, so the refusal is the missing revision and not a revision with nothing
	// to change. The error plugin answers a ZodError as the 400 (`error-handler.test.ts`).
	it('refuses a revision that states no revision at all, revising nothing', async () => {
		await expect(revise({ name: 'Renamed', description: 'Stated no revision' })).rejects.toMatchObject({
			name: 'ZodError',
			issues: [
				expect.objectContaining({
					path: ['revision'],
				}),
			],
		});

		expect(await stored()).toEqual({ description: null, revision: 1 });
	});
});
