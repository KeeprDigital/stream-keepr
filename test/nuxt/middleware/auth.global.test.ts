import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEnsure, mockNavigateTo, mockStatus } = vi.hoisted(() => ({
	mockEnsure: vi.fn(),
	mockNavigateTo: vi.fn(),
	mockStatus: { value: 'unknown' as string },
}));

vi.mock('~/modules/auth/session', () => ({
	useAuthSession: () => ({ ensure: mockEnsure, status: mockStatus }),
}));

mockNuxtImport('navigateTo', () => mockNavigateTo);
mockNuxtImport('defineNuxtRouteMiddleware', () => (fn: any) => fn);

const { default: middleware } = await import('~/middleware/auth.global');

function createRoute(fullPath: string) {
	const [path, search] = fullPath.split('?');
	const query = Object.fromEntries(new URLSearchParams(search ?? ''));
	return { path, fullPath, query } as any;
}

function runMiddleware(fullPath: string) {
	return middleware(createRoute(fullPath), createRoute('/'));
}

describe('auth.global middleware', () => {
	beforeEach(() => {
		mockEnsure.mockReset();
		mockNavigateTo.mockReset();
		mockStatus.value = 'unknown';
	});

	it('sends a signed-out browser to login, carrying the page it wanted', async () => {
		mockEnsure.mockResolvedValue('signed-out');

		await runMiddleware('/event/12/matches?round=3');

		expect(mockNavigateTo).toHaveBeenCalledWith('/login?redirect=%2Fevent%2F12%2Fmatches%3Fround%3D3');
	});

	it('lets a signed-in operator through', async () => {
		mockEnsure.mockResolvedValue('signed-in');

		await runMiddleware('/event/12/matches');

		expect(mockNavigateTo).not.toHaveBeenCalled();
	});

	it('leaves the screen-output page alone, and does not even ask about a session', async () => {
		await runMiddleware('/event/12/screen/main');

		expect(mockNavigateTo).not.toHaveBeenCalled();
		expect(mockEnsure).not.toHaveBeenCalled();
	});

	it('still gates the screens control surface', async () => {
		mockEnsure.mockResolvedValue('signed-out');

		await runMiddleware('/event/12/screens/3');

		expect(mockNavigateTo).toHaveBeenCalledWith('/login?redirect=%2Fevent%2F12%2Fscreens%2F3');
	});

	it('does not take an operator off a page over an unanswered ask', async () => {
		mockEnsure.mockResolvedValue('unavailable');

		await runMiddleware('/event/12/matches');

		expect(mockNavigateTo).not.toHaveBeenCalled();
	});

	describe('the login page', () => {
		it('stands for a browser with no session', async () => {
			mockEnsure.mockResolvedValue('signed-out');

			await runMiddleware('/login');

			expect(mockNavigateTo).not.toHaveBeenCalled();
		});

		it('stands when the session could not be read, so the form is reachable in an outage', async () => {
			mockEnsure.mockResolvedValue('unavailable');

			await runMiddleware('/login');

			expect(mockNavigateTo).not.toHaveBeenCalled();
		});

		it('returns an already signed-in operator to the page they were sent from', async () => {
			mockEnsure.mockResolvedValue('signed-in');

			await runMiddleware('/login?redirect=%2Fevent%2F12%2Fmatches');

			expect(mockNavigateTo).toHaveBeenCalledWith('/event/12/matches');
		});

		it('sends an already signed-in operator home when nothing sent them here', async () => {
			mockEnsure.mockResolvedValue('signed-in');

			await runMiddleware('/login');

			expect(mockNavigateTo).toHaveBeenCalledWith('/');
		});

		it('sends them home rather than off-site when the query names another origin', async () => {
			mockEnsure.mockResolvedValue('signed-in');

			await runMiddleware('/login?redirect=https%3A%2F%2Fevil.example%2Fsteal');

			expect(mockNavigateTo).toHaveBeenCalledWith('/');
		});
	});
});
