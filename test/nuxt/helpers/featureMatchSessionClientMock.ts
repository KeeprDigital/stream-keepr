import { vi } from 'vitest';

/**
 * The Feature Match Session client the Feature Match State store suites mock. It
 * imports nothing from the app, so a `vi.mock` factory can load it without a cycle:
 *
 *   vi.mock('~/modules/feature-match-session/client', async () => ({
 *     useFeatureMatchSessionClient: () => (await import('~~/test/nuxt/helpers/featureMatchSessionClientMock')).sessionClient,
 *   }));
 */
export const sessionClient = {
	getState: vi.fn(),
	ensureSession: vi.fn(),
	updateState: vi.fn(),
	updatePlayerFeatureMatchState: vi.fn(),
	startClock: vi.fn(),
	pauseClock: vi.fn(),
	resetClock: vi.fn(),
	restartClock: vi.fn(),
	adjustClock: vi.fn(),
	setClock: vi.fn(),
	recordGameWin: vi.fn(),
	undoGameWin: vi.fn(),
	resetMatch: vi.fn(),
	stepTurn: vi.fn(),
	stepOvertime: vi.fn(),
	startOvertime: vi.fn(),
	swapPlayers: vi.fn(),
	bulkClockAction: vi.fn(),
};
