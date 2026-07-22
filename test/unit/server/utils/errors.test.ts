import { describe, expect, it } from 'vitest';
import { StateConflictError } from '~~/server/utils/errors';

describe('stateConflictError', () => {
	it('extends Error', () => {
		const error = new StateConflictError('Match', 42);
		expect(error).toBeInstanceOf(Error);
	});

	it('has statusCode 409', () => {
		const error = new StateConflictError('Match', 1);
		expect(error.statusCode).toBe(409);
	});

	it('has name "StateConflictError"', () => {
		const error = new StateConflictError('Match', 1);
		expect(error.name).toBe('StateConflictError');
	});

	it('includes resource type and ID in message', () => {
		const error = new StateConflictError('Match', 42);
		expect(error.message).toBe('Match 42 state was modified concurrently');
	});

	it('includes different resource types in message', () => {
		const error = new StateConflictError('Player', 7);
		expect(error.message).toBe('Player 7 state was modified concurrently');
	});

	it('produces a useful stack trace', () => {
		const error = new StateConflictError('Event', 99);
		expect(error.stack).toBeDefined();
		expect(error.stack).toContain('StateConflictError');
	});
});
