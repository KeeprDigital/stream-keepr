import { describe, expect, it } from 'vitest';
import { saveCommanderDeckListSchema } from '~~/server/schemas/api/featureMatchDeckList';

const PRINTING = '0a5b1c2d-3e4f-4a6b-8c7d-9e0f1a2b3c0';

// A Seat holds one or two Commanders (ADR-0087). A save confirming none passes
// here, so the save can refuse it by name.
describe('a Commander Deck List save', () => {
	it.each([
		{ commanders: 0, accepted: true },
		{ commanders: 2, accepted: true },
		{ commanders: 3, accepted: false },
	])('confirming $commanders Commanders is taken: $accepted', ({ commanders, accepted }) => {
		const result = saveCommanderDeckListSchema.safeParse({
			seat: 'player4',
			text: '1 Sol Ring',
			commanders: Array.from({ length: commanders }, (_, index) => `${PRINTING}${index}`),
		});

		expect(result.success).toBe(accepted);
	});
});
