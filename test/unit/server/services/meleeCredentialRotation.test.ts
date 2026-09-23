import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReturning = vi.fn();
const mockWhere = vi.fn(() => ({ returning: mockReturning }));
const mockSet = vi.fn(() => ({ where: mockWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));
const mockProtectMeleeClientSecret = vi.fn();

vi.mock('~~/server/db', () => ({ db: { update: mockUpdate } }));
vi.mock('drizzle-orm', () => ({
	and: (...conditions: unknown[]) => ({ and: conditions }),
	eq: (field: unknown, value: unknown) => ({ field, value }),
}));
vi.mock('~~/server/db/schema', () => ({
	events: {
		id: 'events.id',
		meleeClientSecret: 'events.meleeClientSecret',
	},
}));
vi.mock('~~/server/services/meleeCredentials', () => ({
	protectMeleeClientSecret: (...args: unknown[]) => mockProtectMeleeClientSecret(...args),
}));

const { rewrapMeleeClientSecret } = await import('~~/server/services/meleeCredentialRotation');

describe('rewrapMeleeClientSecret', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockProtectMeleeClientSecret.mockResolvedValue('new-envelope');
		mockReturning.mockResolvedValue([{ id: 42 }]);
	});

	it('updates only the Event that still has the credential that was read', async () => {
		await expect(rewrapMeleeClientSecret(42, 'old-value', 'plaintext')).resolves.toBe(true);

		expect(mockProtectMeleeClientSecret).toHaveBeenCalledWith('plaintext');
		expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
			meleeClientSecret: 'new-envelope',
			updatedAt: expect.any(Date),
		}));
		expect(mockWhere).toHaveBeenCalledWith({
			and: [
				{ field: 'events.id', value: 42 },
				{ field: 'events.meleeClientSecret', value: 'old-value' },
			],
		});
	});

	it('reports a lost CAS without overwriting a newer credential', async () => {
		mockReturning.mockResolvedValue([]);

		await expect(rewrapMeleeClientSecret(42, 'stale-value', 'plaintext')).resolves.toBe(false);
	});
});
