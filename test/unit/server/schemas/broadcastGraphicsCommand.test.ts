import { describe, expect, it } from 'vitest';
import {
	broadcastGraphicsCommandSchema,
	MAX_GRAPHIC_INPUT_VALUE_LENGTH,
} from '~~/server/schemas/api/broadcastGraphicsLiveSession';
import { MAX_GRAPHIC_TEXT_LENGTH } from '~~/shared/types/graphics';

function setInput(value: unknown) {
	return broadcastGraphicsCommandSchema.safeParse({
		commandId: 'set:1',
		type: 'Set Input',
		payload: { graphicId: 'lower-third', inputKey: 'name', value },
	});
}

describe('broadcastGraphicsCommandSchema', () => {
	it('discriminates the four actions by type, each with its own payload', () => {
		expect(broadcastGraphicsCommandSchema.safeParse({
			commandId: 'take:1',
			type: 'Take',
			payload: { graphicId: 'a', cut: true },
		}).success).toBe(true);

		// Update Graphic carries the acceptance it supersedes; the others must not.
		expect(broadcastGraphicsCommandSchema.safeParse({
			commandId: 'update:1',
			type: 'Update Graphic',
			payload: { graphicId: 'a', basedOnAcceptedRevision: 3 },
		}).success).toBe(true);
		expect(broadcastGraphicsCommandSchema.safeParse({
			commandId: 'update:2',
			type: 'Update Graphic',
			payload: { graphicId: 'a' },
		}).success).toBe(false);
		expect(broadcastGraphicsCommandSchema.safeParse({
			commandId: 'take:2',
			type: 'Take',
			payload: { graphicId: 'a', basedOnAcceptedRevision: 3 },
		}).success).toBe(false);
	});

	it('accepts a Graphic Input value in each shape a declared type takes', () => {
		expect(setInput('Ava Reed').success).toBe(true);
		expect(setInput(20).success).toBe(true);
		expect(setInput(true).success).toBe(true);
		expect(setInput(null).success).toBe(true);
		expect(setInput({ assetId: 'asset-1', revisionId: 'rev-1' }).success).toBe(true);
		// Not a shape any declared type takes.
		expect(setInput(['a']).success).toBe(false);
		expect(setInput(Number.POSITIVE_INFINITY).success).toBe(false);
	});

	it('bounds one Graphic Input value above the longest a declaration may allow', () => {
		// The ceiling has to sit *above* the authored cap, not at it. A value that
		// exceeds its own declaration's `maxLength` must still reach the server so it
		// can be stored and reported unavailable — that is what "unavailable rather
		// than truncated" means in practice, and it is only true if an over-long value
		// is representable on the wire.
		expect(MAX_GRAPHIC_INPUT_VALUE_LENGTH).toBeGreaterThan(MAX_GRAPHIC_TEXT_LENGTH);

		expect(setInput('a'.repeat(MAX_GRAPHIC_TEXT_LENGTH + 1)).success).toBe(true);
		expect(setInput('a'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH)).success).toBe(true);
		// But it is bounded, so one command cannot be unboundedly large.
		expect(setInput('a'.repeat(MAX_GRAPHIC_INPUT_VALUE_LENGTH + 1)).success).toBe(false);
	});

	it('rejects an input key a Graphic Text Template could not name', () => {
		expect(broadcastGraphicsCommandSchema.safeParse({
			commandId: 'set:2',
			type: 'Set Input',
			payload: { graphicId: 'a', inputKey: '2 names', value: 'x' },
		}).success).toBe(false);
	});

	it('accepts only bounded authored Social Profile Projection commands', () => {
		for (const command of [
			{ commandId: 'profile:1', type: 'Select Social Profile', payload: { graphicId: 'lower', projectionKey: 'profile', network: 'x' } },
			{ commandId: 'profile:2', type: 'Previous Social Profile', payload: { graphicId: 'lower', projectionKey: 'profile' } },
			{ commandId: 'profile:3', type: 'Next Social Profile', payload: { graphicId: 'lower', projectionKey: 'profile' } },
			{ commandId: 'profile:4', type: 'Set Social Profile Automatic', payload: { graphicId: 'lower', projectionKey: 'profile', automatic: false } },
		])
			expect(broadcastGraphicsCommandSchema.safeParse(command).success).toBe(true);

		expect(broadcastGraphicsCommandSchema.safeParse({
			commandId: 'profile:5',
			type: 'Select Social Profile',
			payload: { graphicId: 'lower', projectionKey: 'profile', network: 'facebook' },
		}).success).toBe(false);
		expect(broadcastGraphicsCommandSchema.safeParse({
			commandId: 'profile:6',
			type: 'Next Social Profile',
			payload: { graphicId: 'lower', projectionKey: 'profile', network: 'x' },
		}).success).toBe(false);
		expect(broadcastGraphicsCommandSchema.safeParse({
			commandId: 'profile:7',
			type: 'Set Social Profile Automatic',
			payload: { graphicId: 'lower', projectionKey: 'profile', automatic: 'yes' },
		}).success).toBe(false);
	});
});
