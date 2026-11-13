import { describe, expect, it } from 'vitest';
import { toScreenOutputEvent } from '~~/shared/utils/screenOutputEvent';
import { createMockEvent } from '~~/test/helpers/fixtures';

describe('what a Screen Output holds of its Event', () => {
	// Feature Match Controls lay a Commander Event's four Seats out by it (ADR-0087).
	it('carries the Variant, and nothing an operator alone may read', () => {
		const held = toScreenOutputEvent(createMockEvent({ game: 'mtg', variant: 'commander' }));

		expect(held).toMatchObject({ game: 'mtg', variant: 'commander' });
		expect(held).not.toHaveProperty('featureMatchNotesEnabled');
	});
});
