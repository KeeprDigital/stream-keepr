import type { H3Event } from 'h3';
import type { TemplatePackageExportOutcome } from '~~/server/modules/graphics-asset-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { publicServerFailure } from '~~/test/helpers/publicServerFailure';

const { mockSetResponseHeader, mockSetResponseHeaders } = vi.hoisted(() => ({
	mockSetResponseHeader: vi.fn(),
	mockSetResponseHeaders: vi.fn(),
}));

// The module reaches the library runtime for its two exporters, which reach `~~/server/db`.
// Nothing here exercises those; the HTTP boundary below is called directly.
vi.mock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => ({ exportTemplatePackage: vi.fn() }),
}));

vi.mock('~~/server/utils/graphicsAssetApi', () => ({
	rethrowGraphicsAssetApiError: (error: unknown) => {
		throw error;
	},
}));

vi.stubGlobal('setResponseHeader', mockSetResponseHeader);
vi.stubGlobal('setResponseHeaders', mockSetResponseHeaders);
vi.stubGlobal('createError', (input: {
	statusCode: number;
	statusMessage?: string;
	message: string;
	cause?: unknown;
	data?: unknown;
}) => Object.assign(new Error(input.message), input));

async function respond() {
	return (await import('~~/server/utils/templatePackageExportApi')).respondWithTemplatePackage;
}

function rejectedWith(issues: { code: string; retryable: boolean }[]): TemplatePackageExportOutcome {
	return { outcome: 'rejected', report: { issues } } as unknown as TemplatePackageExportOutcome;
}

/** The refusal this boundary raised, as a caller receives it: after the sanitizer. */
async function refusalOf(event: H3Event, outcome: TemplatePackageExportOutcome) {
	const respondWith = await respond();
	let caught: unknown;
	try {
		respondWith(event, outcome);
	}
	catch (error) {
		caught = error;
	}
	if (caught === undefined)
		throw new Error('expected the boundary to refuse, and it returned a stream');
	return await publicServerFailure(caught);
}

/**
 * What a Template Package export says when it refused, and which half of that refusal
 * the reader is allowed to see.
 *
 * The two halves are answered at different statuses on purpose: an integrity or content
 * problem is a 409 the author has to correct, and a report of nothing but retryable
 * issues is a 503 they can simply ask again about. #321 found the 503 half sanitized —
 * the ternary raising it carried no cause, so its message became 'Internal Server Error'
 * while the report underneath came through intact, which is the shape most likely to be
 * mistaken for working.
 */
describe('the Template Package export HTTP boundary', () => {
	beforeEach(() => {
		vi.resetModules();
		mockSetResponseHeader.mockReset();
		mockSetResponseHeaders.mockReset();
	});

	it('says what could not be exported when every issue is retryable', async () => {
		const event = stubH3Event();

		const failure = await refusalOf(event, rejectedWith([{ code: 'asset-bytes-unreadable', retryable: true }]));

		expect(failure).toMatchObject({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'The Template Package could not be exported',
		});
		expect(mockSetResponseHeader).toHaveBeenCalledWith(event, 'retry-after', 5);
	});

	it('keeps the report beside the sentence, which is what hid the sanitizing', async () => {
		const failure = await refusalOf(
			stubH3Event(),
			rejectedWith([{ code: 'asset-bytes-unreadable', retryable: true }]),
		) as { data?: unknown };

		expect(failure.data).toEqual({ issues: [{ code: 'asset-bytes-unreadable', retryable: true }] });
	});

	it('answers a report the author has to act on with 409, which is never sanitized', async () => {
		const event = stubH3Event();

		const failure = await refusalOf(event, rejectedWith([
			{ code: 'asset-bytes-unreadable', retryable: true },
			{ code: 'capability-missing', retryable: false },
		]));

		expect(failure).toMatchObject({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: 'The Template Package could not be exported',
		});
		expect(mockSetResponseHeader).not.toHaveBeenCalled();
	});

	it('treats a rejection with no issues at all as the author\'s to correct', async () => {
		const failure = await refusalOf(stubH3Event(), rejectedWith([]));

		expect(failure.statusCode).toBe(409);
	});

	it('streams an accepted export without touching the refusal path', async () => {
		const body = new ReadableStream<Uint8Array>();
		const respondWith = await respond();

		const stream = respondWith(stubH3Event(), {
			outcome: 'exported',
			package: {
				mediaType: 'application/zip',
				archiveByteLength: 1024,
				fileName: 'slate.skgraphic',
				open: () => body,
			},
		} as unknown as TemplatePackageExportOutcome);

		expect(stream).toBe(body);
		expect(mockSetResponseHeaders).toHaveBeenCalledOnce();
		expect(mockSetResponseHeader).not.toHaveBeenCalled();
	});
});
