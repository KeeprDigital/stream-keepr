<script setup lang="ts">
import { passwordResetTokenFromHash } from '~~/shared/utils/passwordResetLink';
import { LOGIN_PATH } from '~/modules/auth/pageGate';
import { redeemPasswordReset } from '~/modules/auth/passwordReset';

/**
 * Where a password reset link lands (#399, ADR-0010).
 *
 * The one page in this application that a person with no account at all is
 * meant to reach: an invited account has no credential until this form is
 * submitted, so `pageGate.ts` exempts this path from the session gate.
 *
 * The token arrives in the URL **fragment**, which is why this page can exist
 * at a plain path with nothing in its query: a fragment is never sent to the
 * server as part of the navigation, so nothing between the browser and the
 * Worker logs the credential. Reading it is the page's first job and presenting
 * it to `/api/auth/reset-password` is its only other one — the page has no
 * authority of its own, and the server decides whether the token is still good.
 */

definePageMeta({
	title: 'Set a password',
	layout: false,
});

const route = useRoute();

/**
 * Read once, on the client, from `window.location` rather than from the route.
 *
 * Vue Router hands over `route.hash` too, and it is the same string here — but
 * this page is reached by pasting a URL into an address bar rather than by
 * navigation, so reading the address the browser actually has is the reading
 * that cannot be one router refactor away from being empty.
 */
const token = ref<string | null>(null);

onMounted(() => {
	token.value = passwordResetTokenFromHash(window.location.hash || route.hash || '');
});

const form = reactive({ password: '', confirmation: '' });
const submitting = ref(false);
const refusal = ref<string | null>(null);
const done = ref(false);

const mismatched = computed(() =>
	form.confirmation.length > 0 && form.password !== form.confirmation);

async function submit() {
	// Enter pressed twice on a slow connection is one person asking once — and
	// here it is worse than wasted: the link is single-use, so a second request
	// carrying the same token is one the server has already consumed.
	if (submitting.value || !token.value)
		return;

	if (form.password !== form.confirmation) {
		refusal.value = 'The two passwords do not match.';
		return;
	}

	submitting.value = true;
	refusal.value = null;

	const result = await redeemPasswordReset(token.value, form.password);

	submitting.value = false;

	if (!result.ok) {
		refusal.value = result.message;
		return;
	}

	// The link is spent whatever happens next, so it is cleared out of the
	// address bar before anything else: a page left showing a consumed token is
	// a credential sitting in a browser history for no reason.
	window.history.replaceState(null, '', window.location.pathname);
	done.value = true;
}
</script>

<template>
	<div class="min-h-screen flex items-center justify-center p-4">
		<UCard class="w-full max-w-sm">
			<div v-if="done" class="flex flex-col gap-4">
				<h1 class="text-lg font-semibold">
					Password set
				</h1>
				<p class="text-sm text-muted">
					You can sign in with it now. This link has been used and will not work again.
				</p>
				<UButton :to="LOGIN_PATH" color="primary" block>
					Go to sign in
				</UButton>
			</div>

			<!--
				No token in the fragment at all: somebody has opened this page
				directly, or pasted half a link. Said plainly, with the only thing
				that fixes it, rather than shown a form that could not work.
			-->
			<div v-else-if="token === null" class="flex flex-col gap-4">
				<h1 class="text-lg font-semibold">
					This link is not valid
				</h1>
				<p class="text-sm text-muted">
					Password reset links are issued by an administrator and can only be used
					once. Ask for a new one.
				</p>
				<UButton
					:to="LOGIN_PATH"
					color="neutral"
					variant="outline"
					block
				>
					Go to sign in
				</UButton>
			</div>

			<UForm v-else :state="form" @submit="submit">
				<div class="flex flex-col gap-4">
					<h1 class="text-lg font-semibold">
						Set a password
					</h1>

					<UAlert
						v-if="refusal"
						color="error"
						variant="subtle"
						icon="i-lucide-triangle-alert"
						:description="refusal"
					/>

					<UFormField name="password" label="New password">
						<UInput
							v-model="form.password"
							type="password"
							autofocus
							autocomplete="new-password"
							class="w-full"
							:disabled="submitting"
						/>
					</UFormField>

					<UFormField
						name="confirmation"
						label="Confirm password"
						:error="mismatched ? 'The two passwords do not match.' : undefined"
					>
						<UInput
							v-model="form.confirmation"
							type="password"
							autocomplete="new-password"
							class="w-full"
							:disabled="submitting"
						/>
					</UFormField>

					<UButton
						type="submit"
						color="primary"
						block
						:loading="submitting"
						:disabled="form.password.length === 0 || mismatched"
					>
						Set password
					</UButton>

					<p class="text-xs text-muted text-center">
						This link can only be used once.
					</p>
				</div>
			</UForm>
		</UCard>
	</div>
</template>
