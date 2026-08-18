<script setup lang="ts">
import type {
	AdministeredUser,
	AdministeredUserList,
	CreatedUserAccount,
	IssuedPasswordResetLink,
	PasswordResetLink,
	RevokedUserSessions,
} from '~~/shared/types/userAdministration';
import { formatInstant } from '~~/shared/utils/formatInstant';

/**
 * The user administration surface (#399, ADR-0010): who has an account here,
 * and the four things an administrator does about it.
 *
 * Gated exactly as the other administrator surfaces are — a Graphics
 * Administrator token held for this browser session and never stored, through
 * `useGraphicsAdminReading`, which also owns the polling and the rule that a
 * token which stops being accepted takes the reading off the screen with it.
 *
 * **The reset link is the deliverable, not a side effect.** There is no email
 * sender in this installation, so creating an account produces a link that the
 * administrator copies and hands over out of band — and it is shown once,
 * because nothing stores it and no route reads it back.
 */

definePageMeta({
	title: 'User Administration',
});

const invitation = reactive({ email: '', name: '' });

/**
 * The key the invite form's pending state is held under.
 *
 * `runAction` keys on an account id, and an invite has no account yet — so it
 * gets a name no account id can collide with rather than a second pending flag
 * beside the shared one.
 */
const INVITE_FORM = 'invite-form';

/**
 * The one link currently on screen, and which account it belongs to.
 *
 * Held as a single value rather than one per row because it is a credential:
 * accumulating them would leave a screen full of live passwords, and the
 * administrator only ever hands over one at a time.
 */
const issuedLink = ref<{ email: string; url: string; expiresAt: string } | null>(null);

/**
 * Which administrative action a button stands for.
 *
 * A union rather than a bare string because `runAction` and `isPending` agree on
 * a `userId:kind` key by spelling it twice — a typo in one of them silently
 * never spins a button, which looks like a hung request rather than a typo.
 */
type ActionKind = 'invite' | 'reset-link' | 'password' | 'ban' | 'unban' | 'sessions';

/** Which row has a form open, so only one is ever collecting a secret. */
const openAction = ref<{ userId: string; kind: 'password' | 'ban' } | null>(null);
const actionInput = reactive({ password: '', reason: '' });

/** The action in flight, as `userId:kind`, so exactly one button spins. */
const actionPending = ref<string | null>(null);
const actionError = ref<string | null>(null);
const actionSummary = ref<string | null>(null);

const {
	administratorToken,
	reading: accounts,
	loadPending,
	loadError,
	hasReading,
	administratorHeaders,
	describeFailure,
	load: loadAccounts,
} = useGraphicsAdminReading<AdministeredUserList>({
	read: async headers => await $fetch<AdministeredUserList>('/api/admin/users', { headers }),
	failureMessage: 'The account list could not be read.',
	// A poll landing mid-action would re-read the list from before the action
	// settled, which is what the composable's `paused` exists for.
	paused: () => actionPending.value !== null,
	onAuthorizationLost: () => {
		// A minted link on screen belongs to the reading that produced it. Leaving
		// it visible after the token stopped being accepted would leave a live
		// credential on a surface nobody is authorised to be looking at.
		issuedLink.value = null;
	},
});

const { copy, copied, isSupported: clipboardSupported } = useClipboard();

function isPending(userId: string, kind: ActionKind) {
	return actionPending.value === `${userId}:${kind}`;
}

function openFormFor(user: AdministeredUser, kind: 'password' | 'ban') {
	const alreadyOpen = openAction.value?.userId === user.id && openAction.value.kind === kind;
	actionInput.password = '';
	actionInput.reason = '';
	actionError.value = null;
	openAction.value = alreadyOpen ? null : { userId: user.id, kind };
}

function isFormOpen(userId: string, kind: 'password' | 'ban') {
	return openAction.value?.userId === userId && openAction.value.kind === kind;
}

/**
 * One administrative action, with the bookkeeping every one of them shares:
 * exactly one thing pending, the previous outcome cleared before the next runs,
 * and the list re-read afterwards so the page shows the state the server
 * settled on rather than the one the button predicted.
 */
async function runAction(
	userId: string,
	kind: ActionKind,
	perform: () => Promise<string>,
	failureMessage: string,
) {
	if (actionPending.value)
		return;

	actionPending.value = `${userId}:${kind}`;
	actionError.value = null;
	actionSummary.value = null;

	try {
		actionSummary.value = await perform();
		await loadAccounts();
	}
	catch (caught) {
		actionError.value = describeFailure(caught, failureMessage);
	}
	finally {
		actionPending.value = null;
	}
}

/**
 * Put a freshly minted link on screen, replacing whatever was there.
 *
 * One writer, because this is the only state on the page that is a credential:
 * two call sites building the object meant two places to remember that it is
 * shown once and stored nowhere.
 */
function showIssuedLink(email: string, link: PasswordResetLink) {
	issuedLink.value = { email, url: link.url, expiresAt: link.expiresAt };
}

/**
 * The invite runs through `runAction` like every other action — keyed on the
 * form rather than a row, since there is no account yet to key it on.
 */
async function invite() {
	issuedLink.value = null;
	await runAction(INVITE_FORM, 'invite', async () => {
		const created = await $fetch<CreatedUserAccount>('/api/admin/users', {
			method: 'POST',
			headers: administratorHeaders(),
			body: { email: invitation.email.trim(), name: invitation.name.trim() },
		});

		showIssuedLink(created.user.email, created.passwordResetLink);
		invitation.email = '';
		invitation.name = '';
		return `${created.user.email} has an account. Hand the link below over yourself.`;
	}, 'The account could not be created.');
}

async function issueResetLink(user: AdministeredUser) {
	issuedLink.value = null;
	await runAction(user.id, 'reset-link', async () => {
		const issued = await $fetch<IssuedPasswordResetLink>(
			`/api/admin/users/${user.id}/password-reset-link`,
			{ method: 'POST', headers: administratorHeaders() },
		);
		showIssuedLink(user.email, issued.passwordResetLink);
		return `A new reset link for ${user.email} is ready to hand over. Using it will `
			+ 'end their other sessions.';
	}, 'The reset link could not be issued.');
}

async function setPassword(user: AdministeredUser) {
	const password = actionInput.password;
	await runAction(user.id, 'password', async () => {
		await $fetch(`/api/admin/users/${user.id}/password`, {
			method: 'PUT',
			headers: administratorHeaders(),
			body: { password },
		});
		openAction.value = null;
		actionInput.password = '';
		return `The password for ${user.email} was set. Their existing sessions are untouched — `
			+ 'revoke them separately if that is what you meant.';
	}, 'The password could not be set.');
}

async function ban(user: AdministeredUser) {
	const reason = actionInput.reason.trim();
	await runAction(user.id, 'ban', async () => {
		const outcome = await $fetch<RevokedUserSessions>(`/api/admin/users/${user.id}/ban`, {
			method: 'POST',
			headers: administratorHeaders(),
			body: reason ? { reason } : {},
		});
		openAction.value = null;
		actionInput.reason = '';
		return `${user.email} is banned, and ${sessionCount(outcome.revokedSessionCount)} ended.`;
	}, 'The account could not be banned.');
}

async function unban(user: AdministeredUser) {
	await runAction(user.id, 'unban', async () => {
		await $fetch(`/api/admin/users/${user.id}/ban`, {
			method: 'DELETE',
			headers: administratorHeaders(),
		});
		return `${user.email} can sign in again with the password they already had.`;
	}, 'The ban could not be lifted.');
}

async function revokeSessions(user: AdministeredUser) {
	await runAction(user.id, 'sessions', async () => {
		const outcome = await $fetch<RevokedUserSessions>(`/api/admin/users/${user.id}/sessions`, {
			method: 'DELETE',
			headers: administratorHeaders(),
		});
		// "0 sessions ended" is the useful answer as often as any other: the
		// compromise being chased is not a live session.
		return `${sessionCount(outcome.revokedSessionCount)} for ${user.email} ended. They can sign back in.`;
	}, 'The sessions could not be revoked.');
}

function sessionCount(count: number) {
	return count === 1 ? '1 session' : `${count} sessions`;
}

const hiddenAccountCount = computed(() =>
	Math.max((accounts.value?.total ?? 0) - (accounts.value?.users.length ?? 0), 0));
</script>

<template>
	<NuxtLayout name="default">
		<template #actions>
			<UButton
				color="neutral"
				variant="outline"
				icon="i-lucide-refresh-cw"
				:loading="loadPending"
				:disabled="!hasReading"
				@click="loadAccounts"
			>
				Refresh
			</UButton>
		</template>

		<div class="mx-auto flex w-full max-w-4xl flex-col gap-6">
			<div>
				<h1 class="text-2xl font-semibold text-highlighted">
					User Administration
				</h1>
				<p class="mt-1 text-sm text-muted">
					Accounts are created here and there is no self sign-up. This installation
					sends no email, so an invite is a link you copy and hand over yourself.
				</p>
			</div>

			<UCard v-if="!hasReading">
				<template #header>
					<h2 class="font-semibold text-highlighted">
						Graphics Administrator access
					</h2>
				</template>
				<div class="flex flex-col gap-4">
					<UFormField
						label="Graphics Administrator token"
						description="This surface is administrator-only. The token is held for this session only and never stored."
					>
						<UInput
							v-model="administratorToken"
							type="password"
							autocomplete="current-password"
						/>
					</UFormField>
					<div>
						<UButton
							label="Open user administration"
							icon="i-lucide-users"
							:loading="loadPending"
							@click="loadAccounts"
						/>
					</div>
					<p v-if="loadError" class="text-sm text-error">
						{{ loadError }}
					</p>
				</div>
			</UCard>

			<template v-if="accounts">
				<UAlert
					v-if="loadError"
					color="error"
					variant="soft"
					icon="i-lucide-triangle-alert"
					title="The last reading failed"
					:description="loadError"
				/>

				<UCard>
					<template #header>
						<h2 class="font-semibold text-highlighted">
							Invite someone
						</h2>
					</template>
					<UForm :state="invitation" @submit="invite">
						<div class="flex flex-col gap-4">
							<div class="grid gap-4 sm:grid-cols-2">
								<UFormField name="email" label="Email">
									<UInput
										v-model="invitation.email"
										type="email"
										autocomplete="off"
										class="w-full"
										:disabled="isPending(INVITE_FORM, 'invite')"
									/>
								</UFormField>
								<UFormField name="name" label="Name">
									<UInput
										v-model="invitation.name"
										autocomplete="off"
										class="w-full"
										:disabled="isPending(INVITE_FORM, 'invite')"
									/>
								</UFormField>
							</div>
							<p class="text-sm text-muted">
								The account is created with no password. The link below is what sets
								one, and only the person you give it to should ever see it.
							</p>
							<div>
								<UButton
									type="submit"
									icon="i-lucide-user-plus"
									label="Create account"
									:loading="isPending(INVITE_FORM, 'invite')"
									:disabled="!invitation.email.trim() || !invitation.name.trim()"
								/>
							</div>
						</div>
					</UForm>
				</UCard>

				<UAlert
					v-if="issuedLink"
					color="success"
					variant="soft"
					icon="i-lucide-link"
					:title="`Reset link for ${issuedLink.email}`"
				>
					<template #description>
						<div class="flex flex-col gap-3">
							<p class="text-sm">
								Hand this over yourself — in team chat, or in person. It can be used
								once, and expires {{ formatInstant(issuedLink.expiresAt) }}. It is
								shown here once and is not stored anywhere. Using it ends every other
								session the account has.
							</p>
							<div class="flex flex-wrap items-center gap-2">
								<UInput
									:model-value="issuedLink.url"
									readonly
									class="min-w-0 flex-1"
									@focus="(event: FocusEvent) => (event.target as HTMLInputElement).select()"
								/>
								<UButton
									v-if="clipboardSupported"
									color="neutral"
									variant="outline"
									:icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
									:label="copied ? 'Copied' : 'Copy'"
									@click="copy(issuedLink.url)"
								/>
								<UButton
									color="neutral"
									variant="ghost"
									icon="i-lucide-x"
									label="Dismiss"
									@click="issuedLink = null"
								/>
							</div>
						</div>
					</template>
				</UAlert>

				<p v-if="actionSummary" class="text-sm text-success">
					{{ actionSummary }}
				</p>
				<p v-if="actionError" class="text-sm text-error">
					{{ actionError }}
				</p>

				<section class="flex flex-col gap-3">
					<div class="flex flex-wrap items-center gap-3">
						<h2 class="text-lg font-semibold text-highlighted">
							Accounts
						</h2>
						<UBadge variant="soft" color="neutral" :label="`${accounts.total} total`" />
					</div>

					<p v-if="hiddenAccountCount > 0" class="text-sm text-warning">
						Showing the first {{ accounts.cap }} accounts; {{ hiddenAccountCount }} are not
						listed.
					</p>

					<p v-if="accounts.users.length === 0" class="text-sm text-muted">
						This installation holds no accounts at all. The first one is created by the
						bootstrap ceremony in the README, not from here.
					</p>

					<UCard v-for="user in accounts.users" :key="user.id">
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div>
								<h3 class="font-medium text-highlighted">
									{{ user.name }}
								</h3>
								<p class="mt-1 text-sm text-muted">
									{{ user.email }} · created {{ formatInstant(user.createdAt) }}
								</p>
							</div>
							<div class="flex flex-wrap items-center gap-2">
								<UBadge
									v-if="user.role"
									variant="subtle"
									color="neutral"
									:label="user.role"
								/>
								<UBadge
									v-if="user.banned"
									variant="soft"
									color="error"
									label="Banned"
								/>
							</div>
						</div>

						<p v-if="user.banned && user.banReason" class="mt-2 text-sm text-toned">
							Banned: {{ user.banReason }}
						</p>

						<div class="mt-4 flex flex-wrap gap-2">
							<UButton
								color="neutral"
								variant="outline"
								size="sm"
								icon="i-lucide-link"
								label="Issue reset link"
								:loading="isPending(user.id, 'reset-link')"
								@click="issueResetLink(user)"
							/>
							<UButton
								color="neutral"
								variant="outline"
								size="sm"
								icon="i-lucide-key-round"
								label="Set password"
								@click="openFormFor(user, 'password')"
							/>
							<UButton
								color="neutral"
								variant="outline"
								size="sm"
								icon="i-lucide-log-out"
								label="Revoke sessions"
								:loading="isPending(user.id, 'sessions')"
								@click="revokeSessions(user)"
							/>
							<UButton
								v-if="!user.banned"
								color="error"
								variant="outline"
								size="sm"
								icon="i-lucide-ban"
								label="Ban"
								@click="openFormFor(user, 'ban')"
							/>
							<UButton
								v-else
								color="neutral"
								variant="outline"
								size="sm"
								icon="i-lucide-undo-2"
								label="Lift ban"
								:loading="isPending(user.id, 'unban')"
								@click="unban(user)"
							/>
						</div>

						<div v-if="isFormOpen(user.id, 'password')" class="mt-4 flex flex-col gap-3">
							<UFormField
								label="New password"
								description="Prefer a reset link. This one leaves you holding a password that works."
							>
								<UInput
									v-model="actionInput.password"
									type="password"
									autocomplete="new-password"
									class="w-full"
								/>
							</UFormField>
							<div>
								<UButton
									size="sm"
									label="Set password"
									:loading="isPending(user.id, 'password')"
									:disabled="actionInput.password.length === 0"
									@click="setPassword(user)"
								/>
							</div>
						</div>

						<div v-if="isFormOpen(user.id, 'ban')" class="mt-4 flex flex-col gap-3">
							<UFormField
								label="Reason"
								description="Optional, and shown on this list. Banning ends every session this account currently holds."
							>
								<UInput v-model="actionInput.reason" class="w-full" />
							</UFormField>
							<div>
								<UButton
									color="error"
									size="sm"
									label="Ban this account"
									:loading="isPending(user.id, 'ban')"
									@click="ban(user)"
								/>
							</div>
						</div>
					</UCard>
				</section>
			</template>
		</div>
	</NuxtLayout>
</template>
