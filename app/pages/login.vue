<script setup lang="ts">
import { postSignInPath } from '~/modules/auth/pageGate';
import { useAuthSession } from '~/modules/auth/session';

definePageMeta({
	title: 'Sign in',
	layout: false,
});

const route = useRoute();
const session = useAuthSession();

const credentials = reactive({ email: '', password: '' });
const submitting = ref(false);
const refusal = ref<string | null>(null);

async function submit() {
	// Enter pressed twice on a slow connection is one operator asking once.
	// Better Auth rate-limits sign-in attempts, so a duplicate is not merely
	// wasted — it spends the budget of the attempt that is still running.
	if (submitting.value)
		return;

	submitting.value = true;
	refusal.value = null;

	const result = await session.signIn(credentials.email, credentials.password);

	submitting.value = false;

	if (!result.ok) {
		refusal.value = result.message;
		return;
	}

	await navigateTo(postSignInPath(route.query));
}
</script>

<template>
	<div class="min-h-screen flex items-center justify-center p-4">
		<UCard class="w-full max-w-sm">
			<UForm :state="credentials" @submit="submit">
				<div class="flex flex-col gap-4">
					<h1 class="text-lg font-semibold">
						Sign in
					</h1>

					<UAlert
						v-if="refusal"
						color="error"
						variant="subtle"
						icon="i-lucide-triangle-alert"
						:description="refusal"
					/>

					<UFormField name="email" label="Email">
						<UInput
							v-model="credentials.email"
							type="email"
							autofocus
							autocomplete="username"
							class="w-full"
							:disabled="submitting"
						/>
					</UFormField>

					<UFormField name="password" label="Password">
						<UInput
							v-model="credentials.password"
							type="password"
							autocomplete="current-password"
							class="w-full"
							:disabled="submitting"
						/>
					</UFormField>

					<UButton
						type="submit"
						color="primary"
						block
						:loading="submitting"
					>
						Sign in
					</UButton>

					<!--
						There is no self-signup and no self-serve reset: accounts are
						admin-created and a reset is a link an administrator hands over
						out of band (ADR-0010). Saying so is the whole of what this page
						can do for someone who cannot get in — without it they are left
						looking for a link that does not exist.
					-->
					<p class="text-xs text-muted text-center">
						Accounts and password resets are issued by an administrator.
					</p>
				</div>
			</UForm>
		</UCard>
	</div>
</template>
