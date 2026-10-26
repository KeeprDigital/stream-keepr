import { describe, expect, it, vi } from 'vitest';
import { logGraphicsStoreFailure } from '~~/server/modules/graphics-asset-library/store-failure-log';

function logged(error: unknown) {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	logGraphicsStoreFailure('graphics_object_store_unavailable', { operation: 'uploadPart' }, error);
	expect(warn).toHaveBeenCalledTimes(1);
	return JSON.parse(warn.mock.calls[0]![0] as string);
}

// The one line a store refusal leaves behind, since the caller is told only which store (#633).
describe('the Graphics store failure log line', () => {
	it('names the refusal, its context, and what the provider threw', () => {
		expect(logged(Object.assign(new Error('We encountered an internal error.'), { code: 10001 }))).toEqual({
			message: 'graphics_object_store_unavailable',
			operation: 'uploadPart',
			errorName: 'Error',
			errorCode: 10001,
			reason: 'We encountered an internal error.',
		});
	});

	it.each([
		['a string code', 'ECONNRESET', 'ECONNRESET'],
		['a non-finite code', Number.NaN, null],
		[
			'an object code',
			{ nested: true },
			null,
		],
	])('keeps %s only when it is printable', (_label, code, expected) => {
		expect(logged(Object.assign(new Error('refused'), { code })).errorCode).toBe(expected);
	});

	it('cuts a long provider message short', () => {
		expect(logged(new Error('x'.repeat(500))).reason).toHaveLength(200);
	});

	it('logs a thrown non-Error without a name or reason', () => {
		expect(logged('not an error at all')).toMatchObject({ errorName: null, errorCode: null, reason: null });
	});

	it('never throws, whatever was caught', () => {
		const hostile = new Proxy({}, {
			get() {
				throw new Error('unreadable');
			},
		});
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		expect(() => logGraphicsStoreFailure('graphics_object_store_unavailable', {}, hostile)).not.toThrow();
	});
});
