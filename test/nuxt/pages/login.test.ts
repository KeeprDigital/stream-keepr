import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';

const { mockNavigateTo, mockRoute, mockSignIn } = vi.hoisted(() => ({
	mockNavigateTo: vi.fn(),
	mockRoute: { query: {} as Record<string, unknown> },
	mockSignIn: vi.fn(),
}));

vi.mock('~/modules/auth/session', () => ({
	useAuthSession: () => ({
		signIn: mockSignIn,
		status: ref('signed-out'),
		user: ref(null),
	}),
}));

mockNuxtImport('navigateTo', () => mockNavigateTo);
mockNuxtImport('useRoute', () => () => mockRoute);

async function mountLogin() {
	const { default: LoginPage } = await import('../../../app/pages/login.vue');

	return mount(LoginPage, {
		global: {
			stubs: nuxtUiStubs,
		},
	});
}

async function submitCredentials(wrapper: Awaited<ReturnType<typeof mountLogin>>, email: string, password: string) {
	await wrapper.find('input[type="email"]').setValue(email);
	await wrapper.find('input[type="password"]').setValue(password);
	await wrapper.find('form').trigger('submit');
	await flushPromises();
}

describe('login page', () => {
	beforeEach(() => {
		mockNavigateTo.mockReset();
		mockSignIn.mockReset();
		mockRoute.query = {};
	});

	it.each([
		[
			'returns to the page the gate interrupted',
			{ redirect: '/event/12/matches' },
			'/event/12/matches',
		],
		['goes home when nothing sent it here', {}, '/'],
		[
			'goes home rather than off-site when the query names another origin',
			{ redirect: 'https://evil.example/steal' },
			'/',
		],
	])('signs in and %s', async (_, query, destination) => {
		mockRoute.query = query;
		mockSignIn.mockResolvedValue({ ok: true });

		const wrapper = await mountLogin();
		await submitCredentials(wrapper, 'operator@example.test', 'correct horse');

		expect(mockSignIn).toHaveBeenCalledWith('operator@example.test', 'correct horse');
		expect(mockNavigateTo).toHaveBeenCalledWith(destination);
	});

	it('shows the refusal and stays put', async () => {
		mockSignIn.mockResolvedValue({ ok: false, message: 'Invalid email or password' });

		const wrapper = await mountLogin();
		await submitCredentials(wrapper, 'operator@example.test', 'wrong');

		expect(wrapper.find('[data-alert]').text()).toBe('Invalid email or password');
		expect(mockNavigateTo).not.toHaveBeenCalled();
	});

	it('clears a shown refusal when the next attempt starts', async () => {
		mockSignIn.mockResolvedValueOnce({ ok: false, message: 'Invalid email or password' });
		mockSignIn.mockResolvedValueOnce({ ok: true });

		const wrapper = await mountLogin();
		await submitCredentials(wrapper, 'operator@example.test', 'wrong');
		await submitCredentials(wrapper, 'operator@example.test', 'correct horse');

		expect(wrapper.find('[data-alert]').exists()).toBe(false);
	});

	it('makes one attempt out of an impatient second press', async () => {
		let release: (() => void) | undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		mockSignIn.mockImplementation(async () => {
			await held;
			return { ok: true };
		});

		const wrapper = await mountLogin();
		await wrapper.find('input[type="email"]').setValue('operator@example.test');
		await wrapper.find('input[type="password"]').setValue('correct horse');
		await wrapper.find('form').trigger('submit');
		await wrapper.find('form').trigger('submit');
		release?.();
		await flushPromises();

		expect(mockSignIn).toHaveBeenCalledTimes(1);
	});
});
