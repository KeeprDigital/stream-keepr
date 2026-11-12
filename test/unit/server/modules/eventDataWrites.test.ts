import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The Feature Match Session module's own two rules, over a stood-in state service.
 * The Event Data write modules that once shared this file are
 * `eventDataWrites.sqlite.test.ts`'s, over real SQL.
 */

const featureMatchState = {
	createSessionForSlot: vi.fn(),
	applyCommand: vi.fn(),
};
const refreshBroadcastGraphicsBindings = vi.fn();

vi.mock('~~/server/services/featureMatchState', () => ({
	featureMatchStateService: () => featureMatchState,
}));
vi.mock('~~/server/modules/broadcast-graphics-live-session', () => ({ refreshBroadcastGraphicsBindings }));

const { featureMatchSessionModule } = await import('~~/server/modules/feature-match-session');

const origin = 'origin-1';

beforeEach(() => {
	featureMatchState.createSessionForSlot.mockReset();
	featureMatchState.applyCommand.mockReset();
});

describe('the Feature Match Session module', () => {
	it('catches bound Broadcast Graphics up after a Session command, since that change bypasses Event Data publication', async () => {
		const result = { sequence: 2 };
		featureMatchState.applyCommand.mockResolvedValue(result);

		await expect(featureMatchSessionModule().applyCommand(10, 1, {} as never, origin)).resolves.toBe(result);

		expect(refreshBroadcastGraphicsBindings).toHaveBeenCalledWith(1);
	});

	it('answers no Session when the Slot could not open one', async () => {
		featureMatchState.createSessionForSlot.mockResolvedValue(null);

		await expect(featureMatchSessionModule().createSessionForSlot(2, 1, origin)).resolves.toBeNull();
	});
});
