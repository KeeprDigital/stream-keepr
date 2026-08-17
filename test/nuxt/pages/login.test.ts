import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

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

const UFormStub = defineComponent({
	emits: ['submit'],
	template: '<form @submit.prevent="$emit(\'submit\')"><slot /></form>',
});

const UFormFieldStub = defineComponent({
	props: { label: { type: String, default: '' } },
	template: '<label>{{ label }}<slot /></label>',
});

const UInputStub = defineComponent({
	props: {
		modelValue: { type: String, default: '' },
		type: { type: String, default: 'text' },
		disabled: { type: Boolean, default: false },
	},
	emits: ['update:modelValue'],
	template: '<input :type="type" :disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">',
});

const UButtonStub = defineComponent({
	props: {
		type: { type: String, default: 'button' },
		loading: { type: Boolean, default: false },
	},
	template: '<button :type="type" :data-loading="loading"><slot /></button>',
});

const UAlertStub = defineComponent({
	props: { description: { type: String, default: '' } },
	template: '<div data-testid="refusal">{{ description }}</div>',
});

async function mountLogin() {
	const { default: LoginPage } = await import('../../../app/pages/login.vue');

	return mount(LoginPage, {
		global: {
			stubs: {
				UForm: UFormStub,
				UFormField: UFormFieldStub,
				UInput: UInputStub,
				UButton: UButtonStub,
				UAlert: UAlertStub,
				UCard: { template: '<div><slot /></div>' },
				UIcon: true,
			},
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

	it('signs in and returns to the page the gate interrupted', async () => {
		mockRoute.query = { redirect: '/event/12/matches' };
		mockSignIn.mockResolvedValue({ ok: true });

		const wrapper = await mountLogin();
		await submitCredentials(wrapper, 'operator@example.test', 'correct horse');

		expect(mockSignIn).toHaveBeenCalledWith('operator@example.test', 'correct horse');
		expect(mockNavigateTo).toHaveBeenCalledWith('/event/12/matches');
	});

	it('goes home when nothing sent it here', async () => {
		mockSignIn.mockResolvedValue({ ok: true });

		const wrapper = await mountLogin();
		await submitCredentials(wrapper, 'operator@example.test', 'correct horse');

		expect(mockNavigateTo).toHaveBeenCalledWith('/');
	});

	it('goes home rather than off-site when the query names another origin', async () => {
		mockRoute.query = { redirect: 'https://evil.example/steal' };
		mockSignIn.mockResolvedValue({ ok: true });

		const wrapper = await mountLogin();
		await submitCredentials(wrapper, 'operator@example.test', 'correct horse');

		expect(mockNavigateTo).toHaveBeenCalledWith('/');
	});

	it('shows the refusal and stays put', async () => {
		mockSignIn.mockResolvedValue({ ok: false, message: 'Invalid email or password' });

		const wrapper = await mountLogin();
		await submitCredentials(wrapper, 'operator@example.test', 'wrong');

		expect(wrapper.find('[data-testid="refusal"]').text()).toBe('Invalid email or password');
		expect(mockNavigateTo).not.toHaveBeenCalled();
	});

	it('clears a shown refusal when the next attempt starts', async () => {
		mockSignIn.mockResolvedValueOnce({ ok: false, message: 'Invalid email or password' });
		mockSignIn.mockResolvedValueOnce({ ok: true });

		const wrapper = await mountLogin();
		await submitCredentials(wrapper, 'operator@example.test', 'wrong');
		await submitCredentials(wrapper, 'operator@example.test', 'correct horse');

		expect(wrapper.find('[data-testid="refusal"]').exists()).toBe(false);
	});

	it('offers no way to create an account, because there is none', async () => {
		const wrapper = await mountLogin();

		expect(wrapper.text()).not.toMatch(/sign up|create an account|register/i);
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

	it('says where an account comes from instead, since nothing on this page issues one', async () => {
		const wrapper = await mountLogin();

		expect(wrapper.text()).toMatch(/administrator/i);
	});
});
