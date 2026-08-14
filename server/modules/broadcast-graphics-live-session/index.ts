import type { BatchItem } from 'drizzle-orm/batch';
import type { DbScreen } from '~~/server/db/schema';
import type { GraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';
import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type {
	BroadcastGraphicsCommand,
	BroadcastGraphicsCommandResult,
	BroadcastGraphicsLiveSessionResponse,
} from '~~/shared/types/broadcastGraphicsLiveSession';
import type {
	BroadcastGraphicConfig,
	GraphicInputDeclaration,
} from '~~/shared/types/graphics';
import type { BroadcastGraphicsModeConfig } from '~~/shared/types/screenConfig';
import type { ScreenGraphicAssetReference } from '~~/shared/utils/graphicsAssetReferences';
import { mapBroadcastGraphicsLiveSessionToResponse } from '~~/server/mappers/broadcastGraphicsLiveSession';
import {
	graphicAssetId,
	graphicAssetRevisionId,
} from '~~/server/modules/graphics-asset-library';
import {
	clearOrphanedBroadcastGraphicsLiveSessionGraphicAssetReferences,
	updateBroadcastGraphicsLiveSessionGraphicAssetReferences,
} from '~~/server/modules/screen-graphic-asset-references';
import {
	broadcastGraphicsRejectionError,
	broadcastGraphicsStateService,
} from '~~/server/services/broadcastGraphicsState';
import { graphicBindingDataService } from '~~/server/services/graphicBindingData';
import { screenService } from '~~/server/services/screen';
import { publishMessage } from '~~/server/utils/ably';
import {
	broadcastGraphicChannelContexts,
	BroadcastGraphicsCommandRejection,
	broadcastGraphicsLiveSessionGraphicAssetReferences,
	broadcastGraphicSourceSelections,
	broadcastGraphicsResolveBindingsDue,
	recoveredBroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';
import {
	broadcastGraphicHasPhaseAnimation,
	broadcastGraphicPhaseDurations,
	findGraphicInputDeclaration,
	isMediaGraphicInputValue,
	resolveGraphicInputBindings,
} from '~~/shared/modules/graphics';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import {
	broadcastGraphicsGraphicAssetReferences,
	sameScreenGraphicAssetReferences,
} from '~~/shared/utils/graphicsAssetReferences';
import { randomCommandId } from '~~/shared/utils/uuid';

/**
 * A collaborator an operation needs, passed as a thunk and invoked at the point
 * of use.
 *
 * The same shape screen-write's operations take, and declared here rather than
 * imported because the alias is structural — `() => T` is `() => T` whichever
 * module writes it — so sharing one declaration would buy no type safety, and it
 * would cost a dependency in the wrong direction: screen-write imports this
 * module and calls it at four sites, so importing its alias back would close a
 * cycle between the two. The two decisions behind the shape are argued in full at
 * `server/modules/screen-write/index.ts` (#247); what they mean here is:
 *
 * **Required, and on `applyCommand` rather than on the module.** Optional module
 * dependencies meant a construction site could omit the library and find out at
 * runtime, which is the 503 #246 spent a ticket making legible. Requiring it
 * makes the omission a compile error and the defensive branch unrepresentable,
 * so it is deleted rather than decorated. It sits on the operation because
 * `applyCommand` is the only one of this module's seven entry points that reaches
 * the library — a module-level requirement would make the seven construction
 * sites that call one of the other six (two Live Session routes, four in
 * screen-write, and this module's own binding refresh) name a collaborator they
 * never use.
 *
 * **A thunk, because constructing one can be wasted.** Only a Take carrying
 * Graphic Asset References and a media Graphic Input selection ask the library;
 * an Out, a cleared media value, and a Take on a graphic that pins nothing all
 * ask it nothing, and none of them should pay for a library. See #265.
 */
type Provides<T> = () => T;

interface ApplyCommandParams {
	eventId: number;
	screenId: number;
	sessionId: number;
	command: BroadcastGraphicsCommand;
	originConnectionId?: string;
	graphicsAssets: Provides<Pick<GraphicsAssetLibrary, 'inspectGraphicAssetRevision'>>;
}

/**
 * Server-side Broadcast Graphics Live Session workflow module.
 *
 * The external seam for route handlers: it resolves the Screen a playout action
 * addresses, admits the action against the Screen's authored stack, and hands it
 * to the shared sequenced live-state module, which owns the authoritative order,
 * receipts, duplicate suppression, and realtime publication.
 *
 * Admission that needs the Screen belongs here rather than in the live-state
 * port, because the port's aggregate is exactly the row its projection writes
 * back — the Screen is a second entity the sequenced aggregate does not contain.
 */
export function broadcastGraphicsLiveSessionModule() {
	const state = broadcastGraphicsStateService();
	const screens = screenService();
	const bindingData = graphicBindingDataService();

	/**
	 * The Screen, proven to be a Broadcast Graphics Screen.
	 *
	 * A Broadcast Graphics Live Session only exists while its Screen is in
	 * Broadcast Graphics mode, so asking about playout on any other Screen is a
	 * conflict rather than an empty answer.
	 */
	const requireBroadcastGraphicsScreen = async (eventId: number, screenId: number): Promise<DbScreen> => {
		const screen = await screens.findById(screenId, eventId);
		if (!screen)
			throw createError({ statusCode: 404, message: 'Screen not found' });
		if (screen.currentMode !== 'broadcast-graphics') {
			throw createError({
				statusCode: 409,
				message: 'Screen is not in Broadcast Graphics mode',
			});
		}
		return screen;
	};

	/**
	 * The Screen's authored Broadcast Graphics stack and its Graphic Channels.
	 *
	 * Everything a command has to be admitted and reduced against that is not live
	 * state: whether the Screen places the graphic at all, which Graphic Inputs it
	 * declares, which Graphic Assets it pins, and which Graphic Channel it runs in.
	 * All of it is authored configuration, which is why it is answered here rather
	 * than inside the live-state port.
	 */
	function authoredStack(screen: DbScreen): BroadcastGraphicsModeConfig {
		return screen.modeConfigs?.['broadcast-graphics']
			?? getDefaultConfigForMode('broadcast-graphics');
	}

	/** The placed Broadcast Graphic a command addresses. */
	function findAuthoredGraphic(screen: DbScreen, graphicId: string): BroadcastGraphicConfig | undefined {
		return authoredStack(screen).graphics.find(graphic => graphic.id === graphicId);
	}

	/**
	 * A Missing Graphic Asset Reference invalidates the Broadcast Graphic that owns
	 * it, so that graphic cannot be taken on air.
	 *
	 * Enforced here rather than in the reducer, and rather than only in Live
	 * Control. The reducer's aggregate is exactly the row its projection writes
	 * back, and this question needs two more entities — the placed Broadcast Graphic
	 * and the Graphics Asset Library — so it belongs in the module that already
	 * resolves both before handing the command on. A disabled button is not the
	 * invariant: a second operator on stale data, a replayed command, or a direct
	 * API call all reach this path.
	 *
	 * Only Take is gated. Out needs none of the asset's bytes, and blocking it would
	 * trap on air the very graphic an operator most needs to remove. A retired asset
	 * is not a failure either: its pinned revisions keep resolving by design.
	 *
	 * The references are the graphic's own *and* the media Graphic Input values its
	 * Live Session has already accepted for it. A value an operator chose live is
	 * content the graphic renders exactly as an authored one is, so it invalidates the
	 * graphic on the same terms.
	 *
	 * The staged values this Take is about to accept are deliberately not re-checked.
	 * Each was proved resolvable when it was selected, so the only case this misses is
	 * a revision retired or purged between selection and Take — and asking again would
	 * mean composing the acceptance here, which needs the Graphic Input Bindings
	 * resolved against Event Data that only reduction has.
	 *
	 * Refused as a domain rejection for the same reason a refused selection is: a Take
	 * a client cannot tell from an ended epoch is a Take it reloads and sends again,
	 * against a library that will refuse it again (#203).
	 */
	const requireResolvableGraphicAssets = async (
		references: readonly ScreenGraphicAssetReference[],
		graphicsAssets: ApplyCommandParams['graphicsAssets'],
	): Promise<void> => {
		if (references.length === 0)
			return;

		const library = graphicsAssets();

		for (const item of references) {
			const status = await library.inspectGraphicAssetRevision({
				assetId: graphicAssetId(item.reference.assetId),
				revisionId: graphicAssetRevisionId(item.reference.revisionId),
			});
			if (status.outcome === 'available')
				continue;
			throw broadcastGraphicsRejectionError(status.outcome === 'missing'
				? new BroadcastGraphicsCommandRejection(
						'missing-asset-reference',
						`Graphic Asset Reference at ${item.ownerSlot} is missing, so this Broadcast Graphic cannot be taken on air`,
					)
				: new BroadcastGraphicsCommandRejection(
						'unavailable-asset-content',
						`Graphic Asset Content at ${item.ownerSlot} is temporarily unavailable, so this Broadcast Graphic cannot be taken on air`,
					));
		}
	};

	/**
	 * Record the pinned revision's own facts on a media Graphic Input value, at the
	 * moment the operator selects it.
	 *
	 * This is the authoritative half of #96. A media value is `{assetId, revisionId}`
	 * on the wire and carries no target compatibility, but the reference index checks
	 * a silent-video reference against the pinned revision's own — and a value with no
	 * such fact loses that precondition silently rather than failing it, so the media
	 * simply never becomes resolvable and the graphic reaches air without it. Nothing
	 * downstream of the value can go and ask the library, so the fact is stamped on
	 * here, by the authority, and travels with the value from then on.
	 *
	 * Recorded rather than trusted: the wire shape carries no facts precisely so a
	 * client cannot assert one. Selecting a revision that does not resolve is refused
	 * outright, because creating a Graphic Asset Reference requires its exact revision
	 * to resolve — a value naming a revision that is not there is a Missing Graphic
	 * Asset Reference rather than a value an operator can be shown and correct.
	 *
	 * That refusal is raised as a domain rejection so it reaches the client carrying
	 * the code for what it is. A bare conflict is what an ended epoch looks like, and a
	 * client that cannot tell the two apart reloads the session and restates the very
	 * command the authority has just refused (#203).
	 */
	const recordMediaSelectionFacts = async (
		graphic: BroadcastGraphicConfig,
		command: BroadcastGraphicsCommand,
		graphicsAssets: ApplyCommandParams['graphicsAssets'],
	): Promise<BroadcastGraphicsCommand> => {
		if (command.type !== 'Set Input' && command.type !== 'Set Override')
			return command;
		const value = command.payload.value;
		if (!isMediaGraphicInputValue(value))
			return command;
		const declaration: GraphicInputDeclaration | undefined = findGraphicInputDeclaration(
			graphic.inputs ?? [],
			command.payload.inputKey,
		);
		if (declaration?.type !== 'media')
			return command;

		const status = await graphicsAssets().inspectGraphicAssetRevision({
			assetId: graphicAssetId(value.assetId),
			revisionId: graphicAssetRevisionId(value.revisionId),
		});
		if (status.outcome !== 'available') {
			throw broadcastGraphicsRejectionError(status.outcome === 'missing'
				? new BroadcastGraphicsCommandRejection(
						'missing-asset-reference',
						`Graphic Asset Reference for Graphic Input ${command.payload.inputKey} is missing`,
						[command.payload.inputKey],
					)
				: new BroadcastGraphicsCommandRejection(
						'unavailable-asset-content',
						`Graphic Asset Content for Graphic Input ${command.payload.inputKey} is temporarily unavailable`,
						[command.payload.inputKey],
					));
		}

		return {
			...command,
			payload: {
				...command.payload,
				value: {
					assetId: value.assetId,
					revisionId: value.revisionId,
					...(status.targetCompatibility === undefined
						? {}
						: { videoCompatibility: status.targetCompatibility }),
				},
			},
		};
	};

	/**
	 * Bring the Screen's Live Session reference index in line with what it has just
	 * accepted, so a Screen Output can resolve a runtime-chosen media value — and
	 * stops being able to the moment that value is no longer accepted.
	 *
	 * Skipped outright when the accepted media values did not move, which is almost
	 * every command: capability derivation used to change only when authored
	 * configuration did, and this keeps the cost of following acceptance instead
	 * proportional to the acceptances that actually change what is published.
	 *
	 * Best-effort on the way out, and deliberately after the commit. The command has
	 * been accepted and its notification has gone out, so a failure here must not turn
	 * an applied command into an apparent failure that invites a retry. The write is
	 * guarded on the sequence it was derived from, so the next acceptance reconciles
	 * from a state that supersedes this one rather than compounding the gap.
	 */
	const reconcileLiveSessionReferences = async (
		screen: DbScreen,
		result: BroadcastGraphicsCommandResult,
		before: BroadcastGraphicsLiveState,
	): Promise<void> => {
		try {
			const stack = authoredStack(screen);
			const references = broadcastGraphicsLiveSessionGraphicAssetReferences(stack, result.currentState);
			const previous = broadcastGraphicsLiveSessionGraphicAssetReferences(stack, before);
			if (sameScreenGraphicAssetReferences(previous, references))
				return;

			const outcome = await updateBroadcastGraphicsLiveSessionGraphicAssetReferences({
				screenId: screen.id,
				eventId: result.session.eventId,
				sessionId: result.sessionId,
				sequence: result.sequence,
				references,
				previousReferences: previous,
			});
			if (outcome.indexed === outcome.expected)
				return;
			// Every accepted value was proved resolvable when it was selected, so a
			// reference that will not index now lost a race with the library — the
			// revision was retired, replaced, or purged in between. The graphic keeps
			// what it accepted; its output cannot fetch this one, which is worth saying
			// out loud rather than leaving to be discovered on air.
			console.error(JSON.stringify({
				message: 'broadcast_graphics_live_reference_index_incomplete',
				screenId: screen.id,
				sessionId: result.sessionId,
				expected: outcome.expected,
				indexed: outcome.indexed,
			}));
		}
		catch {
			console.error(JSON.stringify({
				message: 'broadcast_graphics_live_reference_index_failed',
				screenId: screen.id,
				sessionId: result.sessionId,
			}));
		}
	};

	/**
	 * Re-derive what the Live Session publishes after an authored write.
	 *
	 * The other half of following acceptance, and the one acceptance cannot do for
	 * itself. What the Live Session publishes is its accepted values read *through the
	 * Screen's current declarations*, so an authored write that stops declaring a media
	 * Graphic Input — or stops placing the Broadcast Graphic that declares it — changes
	 * what is published without any acceptance happening at all. The command path
	 * cannot notice: it derives before and after from the one configuration it can see,
	 * which is the new one, so both sides agree and it correctly does nothing.
	 *
	 * Left to the next acceptance that happens to move the media set, the row would
	 * outlive its declaration for as long as the show lasts — a Screen Output still
	 * fetching content the Screen no longer publishes, and an asset still pinned
	 * against retirement and purge by a reference nothing declares. So the authority
	 * that changed the declarations is the one that reconciles them.
	 *
	 * ## Why it retries once, and what a retry does not promise
	 *
	 * The write is guarded on the Live Session sequence it was derived from, so a
	 * command committing in the gap between reading the session and writing makes this
	 * apply nothing at all — which is precisely the outcome being fixed. Re-reading and
	 * repeating once closes that, and is bounded rather than unbounded because a
	 * reconciliation that kept chasing a busy show could livelock against it.
	 *
	 * Bounded means "usually enough", not "always". Two consecutive lost races exhaust
	 * both passes having applied nothing, and the convergence argument does not cover
	 * it: the racing command reconciles from its own state, but only writes when the
	 * accepted media set moved, so a Take on a text-only graphic deletes nothing on this
	 * one's behalf. The undeclared reference then survives until the next media-moving
	 * acceptance, epoch end, or reset — the pre-fix behaviour, in a case that now needs
	 * two lost races rather than happening on every undeclare.
	 *
	 * That residual is acceptable; being unable to see it is not. Exhausting both passes
	 * is the one outcome where this demonstrably did not take, so it says so.
	 */
	const republishLiveSessionReferences = async (input: {
		eventId: number;
		screenId: number;
		/** The stack as it was before this write, for the retirement rule. */
		previousStack?: BroadcastGraphicsModeConfig;
	}): Promise<void> => {
		try {
			for (let attempt = 0; attempt < 2; attempt += 1) {
				const session = await state.findActiveSessionByScreen(input.screenId, input.eventId);
				if (!session) {
					// No epoch, nothing accepted, nothing published.
					await clearOrphanedBroadcastGraphicsLiveSessionGraphicAssetReferences(input.screenId);
					return;
				}
				const screen = await screens.findById(input.screenId, input.eventId);
				if (!screen)
					return;

				const stack = authoredStack(screen);
				await updateBroadcastGraphicsLiveSessionGraphicAssetReferences({
					screenId: input.screenId,
					eventId: input.eventId,
					sessionId: session.id,
					sequence: session.sequence,
					references: broadcastGraphicsLiveSessionGraphicAssetReferences(stack, session.currentState),
					previousReferences: input.previousStack
						? broadcastGraphicsLiveSessionGraphicAssetReferences(input.previousStack, session.currentState)
						: undefined,
				});

				const settled = await state.findActiveSessionByScreen(input.screenId, input.eventId);
				if (settled?.sequence === session.sequence)
					return;
			}

			// Both passes lost the race, so neither applied. What the Screen no longer
			// declares is still published, and stays published until the next acceptance
			// that moves the media set, an epoch ending, or a reset.
			console.error(JSON.stringify({
				message: 'broadcast_graphics_live_reference_republish_incomplete',
				screenId: input.screenId,
			}));
		}
		catch {
			console.error(JSON.stringify({
				message: 'broadcast_graphics_live_reference_republish_failed',
				screenId: input.screenId,
			}));
		}
	};

	/**
	 * What reduction needs to know about the addressed Broadcast Graphic: its
	 * declarations, and how its Graphic Input Bindings resolve against Event Data.
	 *
	 * Event Data is loaded once, here, for the Graphic Source Selections this command
	 * could leave in place — the ones already accepted, plus the one this command is
	 * about. Reduction then resolves against that loaded set, so a Select Source can
	 * see its own effect and a merge retry re-resolves without another round trip.
	 *
	 * The bindings resolve through the shared catalog, which is the same function Live
	 * Control resolves its displayed bound values with. That is deliberate: an
	 * operator's "latest bound value" and the value acceptance actually puts on air are
	 * then the same computation over the same facts, rather than two implementations
	 * that agree until they do not.
	 */
	const reductionContextFor = async (
		eventId: number,
		screen: DbScreen,
		graphic: BroadcastGraphicConfig,
		currentState: BroadcastGraphicsLiveState,
		command: BroadcastGraphicsCommand,
	) => {
		const accepted = broadcastGraphicSourceSelections(currentState, graphic.id);
		const candidate = command.type === 'Select Source' && command.payload.selectionId !== null
			? { ...accepted, [command.payload.sourceKey]: command.payload.selectionId }
			: accepted;
		const data = await bindingData.load(eventId, graphic.sources ?? [], candidate);

		return {
			inputs: graphic.inputs ?? [],
			sources: graphic.sources ?? [],
			bindings: graphic.bindings ?? [],
			resolveBindings: (selections: Readonly<Record<string, number>>) =>
				resolveGraphicInputBindings(graphic, selections, data),
			// How long this graphic's lifecycle phases last, resolved from the placed
			// graphic this module already had to find. Authored Screen configuration, which
			// is exactly why the reducer is handed it rather than reaching for it.
			durations: broadcastGraphicPhaseDurations(graphic),
			// Whether this graphic cycles at all, which decides whether an Out has a cycling
			// origin worth carrying out of the record it replaces. Authored Screen
			// configuration again, and read here for the same reason the durations are.
			onScreen: broadcastGraphicHasPhaseAnimation(graphic, 'on-screen'),
			// The Graphic Channel this graphic runs in, and every other Broadcast Graphic
			// the Screen places in it. A Take is the one command whose effect reaches past
			// the graphic it names — it replaces whichever member the channel holds — so
			// resolving the channel is admission's job in exactly the way resolving the
			// graphic is: both are questions about the Screen's authored configuration,
			// which the sequenced aggregate does not contain.
			channel: broadcastGraphicChannelContexts(authoredStack(screen))[graphic.id],
		};
	};

	/**
	 * The authoritative snapshot, opening the Screen's epoch if it has none.
	 *
	 * Every reconnecting Live Control and Screen Output reloads through here:
	 * realtime messages are notifications, and this is the authority they point
	 * at.
	 */
	const loadSession = async (
		eventId: number,
		screenId: number,
	): Promise<BroadcastGraphicsLiveSessionResponse> => {
		await requireBroadcastGraphicsScreen(eventId, screenId);
		const session = await state.ensureActiveSession(screenId, eventId);
		return mapBroadcastGraphicsLiveSessionToResponse(session);
	};

	/**
	 * Announce that a Screen's playout epoch has been replaced.
	 *
	 * Its own notification rather than a variant of `commandApplied`, because it is
	 * not a command and nothing about it can be applied: every client holding state
	 * for this Screen is holding state from a session that has ended, and the only
	 * correct response is to reload.
	 *
	 * The case that needs it is an explicit reset, which changes nothing about the
	 * Screen and so publishes no other message — without this, every peer would sit on
	 * the ended epoch still rendering the graphics the reset was meant to clear. A mode
	 * change is already covered by `screen:updated`, and publishes this as well only so
	 * the stale epoch is dropped deterministically.
	 */
	const publishEpochEnded = async (
		eventId: number,
		screenId: number,
		sessionId: number | null,
		originConnectionId?: string,
	): Promise<void> => {
		await publishMessage(
			eventId,
			'broadcastGraphicsLiveSession:epochEnded',
			{ screenId, sessionId },
			originConnectionId,
		);
	};

	/**
	 * End the Screen's epoch, unannounced, on the way to deleting the Screen.
	 *
	 * The one end nobody is told about, and the only caller left that ends an epoch
	 * without a write of its own to commit alongside. Its clients are about to be
	 * told the Screen itself is gone, and pointing them at a snapshot route that will
	 * now refuse them would surface a spurious failure on the way out. The two ends
	 * that do leave the Screen in place — a mode change and a reset — announce, and
	 * each does so after the commit it rides in.
	 */
	const endSessionsForScreen = async (screenId: number, eventId: number): Promise<void> => {
		// One commit ends the epoch, discards its receipts, and unpublishes what it
		// had accepted — an ended epoch has accepted nothing, so a Screen switched
		// away and back must not find media on its outputs the new epoch never chose.
		await state.endSessionsForScreen(screenId, eventId);
	};

	/**
	 * Ending the Screen's epoch as one half of the write that causes it to end.
	 *
	 * A Screen leaving Broadcast Graphics mode ends its playout epoch, and the two
	 * used to be separate writes with the end going second. A failure in between left
	 * the mode changed and the epoch still active — and `ensureActiveSession` returns
	 * an active session as it stands, so the Screen's next activation of the mode got
	 * the previous show's graphics back on air, against the contract that a fresh
	 * epoch has nothing on air. The operator's retry did not repair it either: the
	 * committed mode change had moved the state version out from under it (#305).
	 *
	 * So the end is handed back as statements for the caller to commit with the mode
	 * change, and the announcement as a thunk to run once that commit has happened —
	 * an announcement is a claim that an epoch ended, and may not outlive a commit
	 * that did not. Which epoch it names is read here, before the statements are
	 * committed, because afterwards there is no active session left to identify.
	 */
	const endEpochOnLeavingBroadcastGraphics = async (
		screenId: number,
		eventId: number,
		originConnectionId?: string,
	): Promise<{
		statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]];
		announceEnded: () => Promise<void>;
	}> => {
		const ending = await state.findActiveSessionByScreen(screenId, eventId);
		return {
			statements: state.endSessionStatementsOnLeavingBroadcastGraphics(screenId, eventId),
			announceEnded: async () =>
				await publishEpochEnded(eventId, screenId, ending?.id ?? null, originConnectionId),
		};
	};

	/**
	 * Reset the Screen's live state: every Broadcast Graphic off, a new epoch, and
	 * nothing carried forward.
	 *
	 * The operator's escape hatch, and the recovery action for a Live Session whose
	 * durable state cannot be read at all. It is deliberately the same epoch
	 * advance as a mode change, so the guarantee that a command from an ended epoch
	 * can never affect a later show covers it for free.
	 */
	const resetLiveState = async ({
		eventId,
		screenId,
		originConnectionId,
	}: {
		eventId: number;
		screenId: number;
		originConnectionId?: string;
	}): Promise<BroadcastGraphicsLiveSessionResponse> => {
		await requireBroadcastGraphicsScreen(eventId, screenId);
		// One commit: the old epoch ends, what it published is unpublished, and the
		// successor opens carrying nothing forward — so the new epoch publishes
		// nothing until it accepts something of its own, and no failure can leave the
		// ended epoch's media on the Screen's outputs with nobody told.
		const { ended, opened } = await state.resetSessionForScreen(screenId, eventId);
		await publishEpochEnded(eventId, screenId, ended?.id ?? null, originConnectionId);
		return mapBroadcastGraphicsLiveSessionToResponse(opened);
	};

	const applyCommand = async ({
		eventId,
		screenId,
		sessionId,
		command,
		originConnectionId,
		graphicsAssets,
	}: ApplyCommandParams): Promise<BroadcastGraphicsCommandResult> => {
		const screen = await requireBroadcastGraphicsScreen(eventId, screenId);
		const graphic = findAuthoredGraphic(screen, command.payload.graphicId);

		if (!graphic) {
			throw createError({
				statusCode: 404,
				message: 'Broadcast Graphic not found on this Screen',
			});
		}

		const session = await state.findSessionById(sessionId, eventId);
		if (!session || session.screenId !== screenId) {
			throw createError({
				statusCode: 404,
				message: 'Broadcast graphics live session not found',
			});
		}

		if (command.type === 'Take') {
			await requireResolvableGraphicAssets([
				...broadcastGraphicsGraphicAssetReferences({ graphics: [graphic] }),
				...broadcastGraphicsLiveSessionGraphicAssetReferences(
					{ graphics: [graphic] },
					session.currentState,
				),
			], graphicsAssets);
		}

		const admitted = await recordMediaSelectionFacts(graphic, command, graphicsAssets);

		const result = await state.applyCommand(
			sessionId,
			eventId,
			admitted,
			await reductionContextFor(eventId, screen, graphic, session.currentState, admitted),
			originConnectionId,
			{ publish: true },
		);

		await reconcileLiveSessionReferences(screen, result, session.currentState);

		return result;
	};

	/**
	 * Whether any Graphic Input this Broadcast Graphic binds is applied immediately.
	 *
	 * The authored half of the question, answered before any Event Data is loaded.
	 * A graphic with no live-policy bound input cannot be changed by re-resolution
	 * whatever Event Data does, so it never costs a query.
	 */
	function hasLiveBoundInput(graphic: BroadcastGraphicConfig): boolean {
		return (graphic.bindings ?? []).some(binding => (graphic.inputs ?? []).some(
			declaration => declaration.key === binding.inputKey && declaration.updatePolicy === 'live',
		));
	}

	/**
	 * Re-resolve the live-policy Graphic Input Bindings of every Broadcast Graphic on
	 * program in this Event, for Event Data that has just changed.
	 *
	 * ## Why the authoritative side does this at all
	 *
	 * "Relevant Realtime Event Session changes re-resolve affected Graphic Input
	 * Bindings" is a rule about the show, not about anybody's browser. A live On-air
	 * Update Policy exists precisely for the hands-free case — a lower third that
	 * renames itself while the operator is looking at a different graphic, or at none —
	 * so re-resolution cannot be woken by a Live Control watching one selected graphic.
	 * It has to happen where the acceptance happens, which is here: an on-air Broadcast
	 * Graphic on a Screen nobody has open, with every client disconnected, still says
	 * the new name.
	 *
	 * ## What it deliberately does not do
	 *
	 * It issues the ordinary `Resolve Bindings` command, so every rule that command
	 * already obeys is obeyed here without being restated: a staged input stays pending,
	 * an override is not overwritten, an unavailable binding does not fall back to the
	 * template default, and `acceptedRevision` is left alone so another operator's
	 * staged Update Graphic is not invalidated by a Player being renamed.
	 *
	 * ## Why it is filtered twice before it writes
	 *
	 * Event Data changes constantly and almost none of it reaches a Broadcast Graphic.
	 * The authored filter above costs nothing; the reduction is then computed against
	 * loaded Event Data and only committed when it would actually change what program
	 * shows, because a command that changes nothing still advances the authoritative
	 * sequence that every Live Control and Screen Output reloads against.
	 *
	 * Which Event Data moved is deliberately not part of the filter. A binding may reach
	 * an entity through a fixed relationship from another, so a change that looks
	 * irrelevant to one graphic's declared kinds may not be — and the failure of guessing
	 * wrong is a stale name on program, which is the thing this exists to prevent. The
	 * value comparison is the honest filter, and it is exact.
	 *
	 * ## Why it takes no originating connection
	 *
	 * The Event Data write that woke this has an origin, and the message announcing *that*
	 * change carries it so the browser which already applied it optimistically does not
	 * echo it back to itself. This command is not that change. Nobody issued it, no client
	 * predicted it, and the client whose operator renamed the Player is exactly as
	 * uninformed about the re-resolution as every other client — so forwarding the origin
	 * would make the one browser that caused the change the only one never told its
	 * graphics moved, leaving its Live Control behind until some later command produced a
	 * sequence gap and forced a reload. Taking no parameter at all is what makes that
	 * unforwardable rather than merely unforwarded.
	 *
	 * ## Why one Broadcast Graphic's failure is not the Event's
	 *
	 * Each graphic is attempted on its own. An epoch that ended under the sweep, a Screen
	 * whose Event Data cannot be loaded, or any other single failure would otherwise throw
	 * out of the whole function and be swallowed by the caller — and every *other* Screen
	 * in the Event would silently miss this Event Data change. A change that reaches some
	 * graphics is strictly better than one that reaches none, and the sweep is best-effort
	 * on the way out regardless.
	 */
	const refreshLiveBindings = async ({ eventId }: { eventId: number }): Promise<void> => {
		const sessions = await state.findActiveSessionsByEvent(eventId);
		if (sessions.length === 0)
			return;

		const screensById = new Map((await screens.findByEventId(eventId)).map(screen => [screen.id, screen]));

		for (const session of sessions) {
			const screen = screensById.get(session.screenId);
			if (!screen || screen.currentMode !== 'broadcast-graphics')
				continue;

			for (const graphic of authoredStack(screen).graphics) {
				if (!hasLiveBoundInput(graphic))
					continue;

				try {
					const command: BroadcastGraphicsCommand = {
						commandId: randomCommandId('resolve-bindings'),
						type: 'Resolve Bindings',
						payload: { graphicId: graphic.id },
					};
					// Judged against the epoch as it was read, which this sweep deliberately
					// does not re-read between graphics. A Resolve Bindings writes only the
					// Broadcast Graphic it names, so an acceptance for an earlier graphic
					// cannot change the answer for this one.
					//
					// Nothing here is what stops a write into an epoch that has since ended,
					// and nothing here needs to be. The sequenced live-state module loads the
					// aggregate itself and admits the command against it — this feature's
					// admission rejects a session that is not active — and it re-admits
					// against the reloaded aggregate on a merge retry, so neither attempt can
					// commit into an ended epoch. Beneath both, the compare-and-swap guard and
					// the projection's own WHERE require `status = 'active'`, so a write that
					// raced an epoch ending returns no row and fails rather than landing. A
					// staleness check out here could only ever be a fourth guard, checked
					// before the write and therefore able to go stale in the gap the other
					// three close.
					const context = await reductionContextFor(eventId, screen, graphic, session.currentState, command);
					const due = broadcastGraphicsResolveBindingsDue(
						recoveredBroadcastGraphicsLiveState(session.currentState),
						graphic.id,
						{ ...context, acceptedAt: Date.now() },
					);
					if (!due)
						continue;

					const result = await state.applyCommand(
						session.id,
						eventId,
						command,
						context,
						undefined,
						{ publish: true },
					);
					// Re-resolution is an acceptance like any other, so what it accepts is
					// published like any other. It skips itself when the media values did not
					// move, which for a binding sweep is every time but the exceptional one.
					await reconcileLiveSessionReferences(screen, result, session.currentState);
				}
				catch {
					console.error(JSON.stringify({
						message: 'broadcast_graphics_binding_refresh_failed',
						eventId,
						screenId: screen.id,
						graphicId: graphic.id,
					}));
				}
			}
		}
	};

	return {
		loadSession,
		applyCommand,
		refreshLiveBindings,
		republishLiveSessionReferences,
		resetLiveState,
		endSessionsForScreen,
		endEpochOnLeavingBroadcastGraphics,
	};
}

/**
 * Offer every Broadcast Graphic in one Event the chance to catch up with Event Data
 * that has just changed, and never let that failing break the change itself.
 *
 * The one entry point every trigger uses, so the swallow-and-log policy is stated
 * once and by the module that owns the work rather than copied into each caller. It
 * is best-effort in exactly the way realtime delivery already is: the Event Data
 * write has committed and its own notification has gone out, so a Broadcast Graphic
 * that fails to catch up must not turn a successful write into an apparent failure
 * that invites a retry of the write.
 */
export async function refreshBroadcastGraphicsBindings(eventId: number): Promise<void> {
	try {
		await broadcastGraphicsLiveSessionModule().refreshLiveBindings({ eventId });
	}
	catch {
		console.error(JSON.stringify({ message: 'broadcast_graphics_binding_refresh_failed', eventId }));
	}
}
