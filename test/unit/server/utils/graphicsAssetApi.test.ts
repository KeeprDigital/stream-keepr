import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphicsAssetLibraryError } from '~~/server/modules/graphics-asset-library';
import { GraphicsObjectInputError } from '~~/server/modules/graphics-asset-library/object-store';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import { stubH3Event } from '~~/test/helpers/h3Event';

// Every graphics route answers library failures through this one mapping, so
// the per-route tests no longer repeat it.

vi.mock('~~/server/utils/auth', () => ({ optionalUserId: vi.fn() }));

const setResponseHeader = vi.fn();
vi.stubGlobal('setResponseHeader', setResponseHeader);
vi.stubGlobal('createError', (input: Record<string, unknown>) =>
	Object.assign(new Error(input.message as string), input));

function rethrown(error: unknown) {
	const event = stubH3Event();
	try {
		rethrowGraphicsAssetApiError(error, event);
	}
	catch (thrown) {
		return { thrown: thrown as Record<string, unknown>, event };
	}
	throw new Error('rethrowGraphicsAssetApiError returned');
}

describe('rethrowGraphicsAssetApiError', () => {
	beforeEach(() => setResponseHeader.mockReset());

	it.each([
		['invalid-ingestion-input', 400, 'Bad Request'],
		['ingestion-operation-not-found', 404, 'Not Found'],
		['graphics-subject-not-found', 404, 'Not Found'],
		['ingestion-operation-not-uploadable', 409, 'Conflict'],
		['ingestion-operation-lease-held', 409, 'Conflict'],
		['graphic-asset-lifecycle-action-not-allowed', 409, 'Conflict'],
		['staging-capacity-exhausted', 507, 'Insufficient Storage'],
		['canonical-capacity-exhausted', 507, 'Insufficient Storage'],
		['graphics-asset-library-unavailable', 503, 'Service Unavailable'],
	] as const)('answers %s as %i %s, keeping the library\'s message', (code, statusCode, statusMessage) => {
		const error = new GraphicsAssetLibraryError(`library says ${code}`, code);

		const { thrown } = rethrown(error);

		expect(thrown).toMatchObject({ statusCode, statusMessage, message: `library says ${code}`, cause: error });
	});

	it('asks a client to retry an unavailable library, and only then', () => {
		const { event } = rethrown(new GraphicsAssetLibraryError('down', 'graphics-asset-library-unavailable'));
		expect(setResponseHeader).toHaveBeenCalledWith(event, 'retry-after', 5);

		setResponseHeader.mockReset();
		rethrown(new GraphicsAssetLibraryError('gone', 'ingestion-operation-not-found'));
		expect(setResponseHeader).not.toHaveBeenCalled();
	});

	it('carries the exhausted capacity to the client', () => {
		const capacity = { scope: 'canonical' } as never;

		const { thrown } = rethrown(new GraphicsAssetLibraryError('full', 'canonical-capacity-exhausted', { capacity }));

		expect(thrown.data).toBe(capacity);
	});

	it('answers a malformed object input as 400', () => {
		expect(rethrown(new GraphicsObjectInputError('empty identity')).thrown).toMatchObject({ statusCode: 400, message: 'empty identity' });
	});

	it('passes any other failure through untouched', () => {
		const failure = new TypeError('unexpected');

		expect(rethrown(failure).thrown).toBe(failure);
	});
});
