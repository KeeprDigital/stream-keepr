import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPublishMessage = vi.fn();

// cardTimeout uses the auto-imported `publishMessage` from server utils
vi.stubGlobal('publishMessage', mockPublishMessage);

const { cardTimeoutService } = await import('~~/server/services/cardTimeout');

describe('cardTimeoutService', () => {
	beforeEach(() => {
		mockPublishMessage.mockReset();
		vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('setCardTimeout', () => {
		it('publishes card:timeout message with duration and expiresAt', async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
			const now = Date.now();

			await cardTimeoutService().setCardTimeout(1, 5000, 2, 'conn-1');

			expect(mockPublishMessage).toHaveBeenCalledWith(
				1,
				'card:timeout',
				{
					timeoutDuration: 5000,
					expiresAt: now + 5000,
					screenId: 2,
				},
				'conn-1',
			);
		});
	});

	describe('clearCardTimeout', () => {
		it('publishes card:timeout:cancel message', async () => {
			await cardTimeoutService().clearCardTimeout(1, 2, 'conn-1');

			expect(mockPublishMessage).toHaveBeenCalledWith(
				1,
				'card:timeout:cancel',
				{ screenId: 2 },
				'conn-1',
			);
		});
	});
});
