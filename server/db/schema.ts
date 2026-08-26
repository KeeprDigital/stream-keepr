import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { AnimationEffectSelection } from '~~/shared/animationEffects';
import type { PlayerSlotData } from '~~/shared/api';
import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type { BroadcastGraphicsLiveSessionStatus } from '~~/shared/types/broadcastGraphicsLiveSession';
import type { FeatureMatchSessionStatus, FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { PlayerGameData } from '~~/shared/types/game';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicStyleSetEntry } from '~~/shared/types/graphicStyleSet';
import type { FeatureMatchLayoutConfig, ModeConfigsMap, ScreenConfig } from '~~/shared/types/screenConfig';
import type { DeckTokenRequirement } from '~~/shared/utils/deckTokens';
import { relations, sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { BROADCAST_GRAPHICS_LIVE_SESSION_STATUS_VALUES } from '~~/shared/types/broadcastGraphicsLiveSession';
/* ENUMS — imported from shared, re-exported for backward compatibility */
import {
	CLOCK_TYPE_VALUES,
	DECK_COMPANION_SOURCE_VALUES,
	DECK_LIST_COMPARTMENT_VALUES,
	EXTERNAL_SOURCE_VALUES,
	FEATURE_MATCH_ORIENTATION_VALUES,
	GAME_VALUES,
	PLAYER_DISPLAY_MODE_VALUES,
	POINTS_SYSTEM_VALUES,
	POSITION_FORMAT_VALUES,
	RECORD_SEPARATOR_VALUES,
	ROUND_CONTROL_MODE_VALUES,
	SCREEN_MODE_VALUES,
	UNRESOLVED_DECK_ENTRY_TYPE_VALUES,
} from '~~/shared/types/enums';
import { FEATURE_MATCH_SESSION_STATUS_VALUES } from '~~/shared/types/featureMatchSession';

export {
	CLOCK_TYPE_VALUES,
	DECK_LIST_COMPARTMENT_VALUES,
	EXTERNAL_SOURCE_VALUES,
	FEATURE_MATCH_ORIENTATION_VALUES,
	GAME_VALUES,
	PLAYER_DISPLAY_MODE_VALUES,
	POINTS_SYSTEM_VALUES,
	POSITION_FORMAT_VALUES,
	RECORD_SEPARATOR_VALUES,
	SCREEN_MODE_VALUES,
};
export type {
	ClockType,
	DeckCompanionSource,
	DeckListCompartment,
	ExternalSource,
	FeatureMatchOrientation,
	Game,
	PlayerDisplayMode,
	PointsSystem,
	PositionFormat,
	RecordSeparator,
	RoundControlMode,
	ScreenMode,
} from '~~/shared/types/enums';

/* HELPER FOR TIMESTAMPS */
const timestamps = {
	createdAt: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(unixepoch() * 1000)`)
		.$onUpdateFn(() => new Date()),
};

/* TABLES */
export const events = sqliteTable('events', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	game: text('game', { enum: GAME_VALUES }).notNull(),
	featureMatchOrientation: text('feature_match_orientation', { enum: FEATURE_MATCH_ORIENTATION_VALUES }).notNull(),
	cardTimeout: integer('card_timeout').notNull().default(0),
	numFeatureMatches: integer('num_feature_matches').notNull().default(1),

	description: text('description'),
	holdingText: text('holding_text'),

	// eslint-disable-next-line ts/no-use-before-define -- circular FK: events ↔ eventTalents
	commentator1TalentId: integer('commentator1_talent_id').references((): AnySQLiteColumn => eventTalents.id, { onDelete: 'set null' }),
	// eslint-disable-next-line ts/no-use-before-define -- circular FK: events ↔ eventTalents
	commentator2TalentId: integer('commentator2_talent_id').references((): AnySQLiteColumn => eventTalents.id, { onDelete: 'set null' }),

	meleeEnabled: integer('melee_enabled', { mode: 'boolean' }).notNull().default(false),
	pointsSystem: text('points_system', { enum: POINTS_SYSTEM_VALUES }),
	meleeEventId: text('melee_event_id'),
	meleeClientId: text('melee_client_id'),
	meleeClientSecret: text('melee_client_secret'),
	initialSetupCompletedAt: integer('initial_setup_completed_at', { mode: 'timestamp_ms' }),
	lastEventSyncedAt: integer('last_event_synced_at', { mode: 'timestamp_ms' }),
	lastPlayersSyncedAt: integer('last_players_synced_at', { mode: 'timestamp_ms' }),
	lastDecklistsSyncedAt: integer('last_decklists_synced_at', { mode: 'timestamp_ms' }),
	lastSyncError: text('last_sync_error'),
	// Internal durable command lease; stripped from every API response.
	meleeSyncLeaseToken: text('melee_sync_lease_token'),
	meleeSyncLeaseCommand: text('melee_sync_lease_command'),
	meleeSyncLeaseExpiresAt: integer('melee_sync_lease_expires_at', { mode: 'timestamp_ms' }),

	// Display formatting options
	displayRecordSeparator: text('display_record_separator', { enum: RECORD_SEPARATOR_VALUES }).notNull().default('-'),
	displayHideZeroDraws: integer('display_hide_zero_draws', { mode: 'boolean' }).notNull().default(true),
	displayPositionFormat: text('display_position_format', { enum: POSITION_FORMAT_VALUES }).notNull().default('ordinal'),

	// Feature match defaults
	featureMatchDefaultBestOf: integer('feature_match_default_best_of').notNull().default(3),
	featureMatchDefaultStartingLife: integer('feature_match_default_starting_life').notNull().default(20),
	featureMatchDefaultClockType: text('feature_match_default_clock_type', { enum: CLOCK_TYPE_VALUES }).notNull().default('countdown'),
	featureMatchDefaultClockDuration: integer('feature_match_default_clock_duration').notNull().default(50), // minutes
	featureMatchDefaultCountUpAfterCountdown: integer('feature_match_default_count_up_after_countdown', { mode: 'boolean' }).notNull().default(false),
	featureMatchDefaultTurnTrackingEnabled: integer('feature_match_default_turn_tracking_enabled', { mode: 'boolean' }).notNull().default(false),
	featureMatchDefaultActivePlayerTrackingEnabled: integer('feature_match_default_active_player_tracking_enabled', { mode: 'boolean' }).notNull().default(false),
	featureMatchDefaultExtraTurnsEnabled: integer('feature_match_default_extra_turns_enabled', { mode: 'boolean' }).notNull().default(false),
	featureMatchDefaultExtraTurns: integer('feature_match_default_extra_turns').notNull().default(5),
	featureMatchDefaultExtraTurnsLabel: text('feature_match_default_extra_turns_label').notNull().default('Extra Turns'),
	featureMatchDefaultMulliganTrackingEnabled: integer('feature_match_default_mulligan_tracking_enabled', { mode: 'boolean' }).notNull().default(false),

	standingsEnabled: integer('standings_enabled', { mode: 'boolean' }).notNull().default(true),
	broadcastDeckListsEnabled: integer('broadcast_deck_lists_enabled', { mode: 'boolean' }).notNull().default(false),
	lgsEnabled: integer('lgs_enabled', { mode: 'boolean' }).notNull().default(false),
	pronounsEnabled: integer('pronouns_enabled', { mode: 'boolean' }).notNull().default(true),
	tableNumberEnabled: integer('table_number_enabled', { mode: 'boolean' }).notNull().default(false),

	...timestamps,
});

export const eventTalents = sqliteTable('event_talents', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	eventId: integer('event_id')
		.references(() => events.id, { onDelete: 'cascade' })
		.notNull(),
	name: text('name').notNull(),
	twitchHandle: text('twitch_handle'),
	youtubeHandle: text('youtube_handle'),
	xHandle: text('x_handle'),
	instagramHandle: text('instagram_handle'),
	tiktokHandle: text('tiktok_handle'),
	blueskyHandle: text('bluesky_handle'),
	...timestamps,
}, table => [
	index('talents_event_id_idx').on(table.eventId),
]);

export const players = sqliteTable('players', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	eventId: integer('event_id')
		.references(() => events.id, { onDelete: 'cascade' })
		.notNull(),

	name: text('name').notNull(),
	pronouns: text('pronouns'),

	externalId: text('external_id'),
	externalSource: text('external_source', { enum: EXTERNAL_SOURCE_VALUES }),
	externalStatus: integer('external_status'),
	isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
	lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),

	wins: integer('wins'),
	losses: integer('losses'),
	draws: integer('draws'),
	position: integer('position'),
	points: integer('points'),

	// eslint-disable-next-line ts/no-use-before-define -- circular FK: players ↔ archetypes
	archetypeId: integer('archetype_id').references((): AnySQLiteColumn => archetypes.id, { onDelete: 'set null' }),

	lgs: text('lgs'),
	gameData: text('game_data', { mode: 'json' }).$type<PlayerGameData>(),

	...timestamps,
}, table => [
	index('players_event_id_idx').on(table.eventId),
	index('players_event_active_idx').on(table.eventId, table.isActive),
	uniqueIndex('players_external_unique_idx').on(table.eventId, table.externalId, table.externalSource),
]);

export const phases = sqliteTable('phases', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	eventId: integer('event_id')
		.references(() => events.id, { onDelete: 'cascade' })
		.notNull(),

	name: text('name').notNull(),
	sortOrder: integer('sort_order').notNull().default(0),

	externalId: text('external_id'),
	externalSource: text('external_source', { enum: EXTERNAL_SOURCE_VALUES }),
	formatExternalId: text('format_external_id'),

	...timestamps,
}, table => [
	index('phases_event_id_idx').on(table.eventId),
	uniqueIndex('phases_external_unique_idx').on(table.eventId, table.externalId, table.externalSource),
]);

export const rounds = sqliteTable('rounds', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	eventId: integer('event_id')
		.references(() => events.id, { onDelete: 'cascade' })
		.notNull(),
	phaseId: integer('phase_id')
		.references(() => phases.id, { onDelete: 'cascade' })
		.notNull(),

	externalId: text('external_id'),
	externalSource: text('external_source', { enum: EXTERNAL_SOURCE_VALUES }),

	name: text('name').notNull(),
	roundNumber: integer('round_number').notNull(),
	controlMode: text('control_mode', { enum: ROUND_CONTROL_MODE_VALUES }).notNull().default('default'),
	lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' }),

	...timestamps,
}, table => [
	index('rounds_event_id_idx').on(table.eventId),
	index('rounds_phase_id_idx').on(table.phaseId),
	uniqueIndex('rounds_external_unique_idx').on(table.eventId, table.externalId, table.externalSource),
]);

export const matches = sqliteTable('matches', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	eventId: integer('event_id')
		.references(() => events.id, { onDelete: 'cascade' })
		.notNull(),
	roundId: integer('round_id')
		.references(() => rounds.id, { onDelete: 'cascade' })
		.notNull(),

	externalId: text('external_id'),
	externalSource: text('external_source', { enum: EXTERNAL_SOURCE_VALUES }),
	tableNumber: integer('table_number'),

	player1Id: integer('player1_id').references(() => players.id, { onDelete: 'set null' }),
	player2Id: integer('player2_id').references(() => players.id, { onDelete: 'set null' }),
	player1Data: text('player1_data', { mode: 'json' }).$type<PlayerSlotData>(),
	player2Data: text('player2_data', { mode: 'json' }).$type<PlayerSlotData>(),

	// Match result data
	hasResult: integer('has_result', { mode: 'boolean' }).notNull().default(false),
	player1GameWins: integer('player1_game_wins'),
	player2GameWins: integer('player2_game_wins'),
	gameDraws: integer('game_draws'),
	isBye: integer('is_bye', { mode: 'boolean' }).notNull().default(false),
	resultString: text('result_string'),

	sortOrder: integer('sort_order').notNull().default(0),

	...timestamps,
}, table => [
	index('matches_event_id_idx').on(table.eventId),
	index('matches_round_id_idx').on(table.roundId),
	uniqueIndex('matches_external_unique_idx').on(table.eventId, table.externalId, table.externalSource),
]);

export const playerLists = sqliteTable('player_lists', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	eventId: integer('event_id').references(() => events.id, { onDelete: 'cascade' }).notNull(),
	name: text('name').notNull(),
	...timestamps,
}, table => [
	index('player_lists_event_id_idx').on(table.eventId),
]);

export const playerListMembers = sqliteTable('player_list_members', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	listId: integer('list_id').references(() => playerLists.id, { onDelete: 'cascade' }).notNull(),
	playerId: integer('player_id').references(() => players.id, { onDelete: 'cascade' }).notNull(),
	sortOrder: integer('sort_order').notNull().default(0),
	...timestamps,
}, table => [
	uniqueIndex('player_list_members_unique').on(table.listId, table.playerId),
	index('player_list_members_list_id_idx').on(table.listId),
	index('player_list_members_player_id_idx').on(table.playerId),
]);

export const broadcastDeckLists = sqliteTable('broadcast_deck_lists', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	eventId: integer('event_id').references(() => events.id, { onDelete: 'cascade' }).notNull(),
	name: text('name').notNull(),
	normalizedName: text('normalized_name').notNull(),
	sourceText: text('source_text').notNull(),
	archetypeLabel: text('archetype_label'),
	colors: text('colors'),
	revision: integer('revision').notNull().default(1),
	/**
	 * Internal transaction stamp. A source replacement first advances the list
	 * with a revision compare-and-swap, then every entry statement is guarded by
	 * this stamp so a failed compare-and-swap makes the whole D1 batch a no-op.
	 */
	operationVersion: text('operation_version'),
	...timestamps,
}, table => [
	index('broadcast_deck_lists_event_id_idx').on(table.eventId),
	uniqueIndex('broadcast_deck_lists_event_name_idx').on(table.eventId, table.normalizedName),
]);

export const broadcastDeckListEntries = sqliteTable('broadcast_deck_list_entries', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	listId: integer('list_id').references(() => broadcastDeckLists.id, { onDelete: 'cascade' }).notNull(),
	compartment: text('compartment', { enum: ['mainboard', 'sideboard', 'companion'] }).notNull(),
	quantity: integer('quantity').notNull(),
	sortOrder: integer('sort_order').notNull(),
	canonicalName: text('canonical_name').notNull(),
	scryfallId: text('scryfall_id').notNull(),
	oracleId: text('oracle_id'),
	setCode: text('set_code').notNull(),
	collectorNumber: text('collector_number'),
	cardType: text('card_type'),
	colors: text('colors'),
	manaCost: text('mana_cost'),
	manaValue: real('mana_value'),
	deckCounterTypes: text('deck_counter_types', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
	...timestamps,
}, table => [
	index('broadcast_deck_list_entries_list_id_idx').on(table.listId),
	uniqueIndex('broadcast_deck_list_entries_order_idx').on(table.listId, table.compartment, table.sortOrder),
]);

export const playerRoundStandings = sqliteTable('player_round_standings', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	eventId: integer('event_id')
		.references(() => events.id, { onDelete: 'cascade' })
		.notNull(),
	playerId: integer('player_id')
		.references(() => players.id, { onDelete: 'cascade' })
		.notNull(),
	roundId: integer('round_id')
		.references(() => rounds.id, { onDelete: 'cascade' })
		.notNull(),

	wins: integer('wins'),
	losses: integer('losses'),
	draws: integer('draws'),
	position: integer('position'),
	points: integer('points'),

	...timestamps,
}, table => [
	uniqueIndex('player_round_standings_unique_idx').on(table.playerId, table.roundId),
	index('player_round_standings_event_id_idx').on(table.eventId),
	index('player_round_standings_round_id_idx').on(table.roundId),
]);

export const featureMatchSlots = sqliteTable('feature_match_slots', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	eventId: integer('event_id')
		.references(() => events.id, { onDelete: 'cascade' })
		.notNull(),

	matchId: integer('match_id').references(() => matches.id, { onDelete: 'set null' }),

	externalId: text('external_id'),
	externalSource: text('external_source', { enum: EXTERNAL_SOURCE_VALUES }),
	tableNumber: integer('table_number'),
	roundName: text('round_name'),
	formatName: text('format_name'),

	player1Id: integer('player1_id').references(() => players.id, { onDelete: 'set null' }),
	player2Id: integer('player2_id').references(() => players.id, { onDelete: 'set null' }),
	player1Data: text('player1_data', { mode: 'json' }).$type<PlayerSlotData>(),
	player2Data: text('player2_data', { mode: 'json' }).$type<PlayerSlotData>(),

	bestOf: integer('best_of').notNull().default(3),
	sortOrder: integer('sort_order').notNull().default(0),
	playerDisplayMode: text('player_display_mode', { enum: PLAYER_DISPLAY_MODE_VALUES }).notNull().default('score'),

	// eslint-disable-next-line ts/no-use-before-define -- circular FK: slots ↔ sessions
	activeSessionId: integer('active_session_id').references((): AnySQLiteColumn => featureMatchSessions.id, { onDelete: 'set null' }),

	...timestamps,
}, table => [
	index('feature_match_slots_event_id_idx').on(table.eventId),
	uniqueIndex('feature_match_slots_external_unique_idx').on(table.eventId, table.externalId, table.externalSource),
	// A Match occupies at most one Slot. Promotion clears the duplicates it read
	// before promoting, but two operators promoting one Match to two Slots at
	// once each read no duplicate, so only the database can be the arbiter.
	// Partial because an unoccupied Slot carries no Match and any number of them
	// may exist at once.
	uniqueIndex('feature_match_slots_match_unique_idx').on(table.eventId, table.matchId).where(sql`${table.matchId} is not null`),
]);

export const featureMatchAssignments = sqliteTable('feature_match_assignments', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	eventId: integer('event_id')
		.references(() => events.id, { onDelete: 'cascade' })
		.notNull(),
	roundId: integer('round_id')
		.references(() => rounds.id, { onDelete: 'cascade' })
		.notNull(),
	slotId: integer('slot_id')
		.references(() => featureMatchSlots.id, { onDelete: 'cascade' })
		.notNull(),
	matchId: integer('match_id')
		.references(() => matches.id, { onDelete: 'cascade' })
		.notNull(),
	note: text('note'),
	...timestamps,
}, table => [
	index('feature_match_assignments_event_id_idx').on(table.eventId),
	index('feature_match_assignments_round_idx').on(table.roundId),
	uniqueIndex('feature_match_assignments_slot_unique_idx').on(table.roundId, table.slotId),
	uniqueIndex('feature_match_assignments_match_unique_idx').on(table.roundId, table.matchId),
]);

export const featureMatchSessions = sqliteTable('feature_match_sessions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	eventId: integer('event_id')
		.references(() => events.id, { onDelete: 'cascade' })
		.notNull(),
	slotId: integer('slot_id')
		.references(() => featureMatchSlots.id, { onDelete: 'cascade' })
		.notNull(),

	status: text('status', { enum: FEATURE_MATCH_SESSION_STATUS_VALUES }).$type<FeatureMatchSessionStatus>().notNull().default('active'),
	sourceSnapshot: text('source_snapshot', { mode: 'json' }).$type<FeatureMatchSourceSnapshot>().notNull(),
	currentState: text('current_state', { mode: 'json' }).$type<FeatureMatchState>().notNull(),
	sequence: integer('sequence').notNull().default(0),
	closedAt: integer('closed_at', { mode: 'timestamp_ms' }),

	...timestamps,
}, table => [
	index('feature_match_sessions_event_id_idx').on(table.eventId),
	index('feature_match_sessions_slot_id_idx').on(table.slotId),
	uniqueIndex('feature_match_sessions_active_slot_idx').on(table.slotId).where(sql`${table.status} = 'active'`),
]);

/**
 * The playout epoch of one Broadcast Graphics Screen.
 *
 * Live state, not Screen configuration: the authored stack of Broadcast Graphics
 * lives in `screens.mode_configs`, while which of them an operator has taken on
 * air lives here with the authoritative sequence that ordered those decisions.
 * Keeping the row durable is what lets a reload, disconnect, or server restart
 * recover program exactly as the operator left it.
 *
 * Only one epoch is active per Screen. An ended epoch is retained rather than
 * deleted so a stale retry from it can be recognised and rejected.
 */
export const broadcastGraphicsLiveSessions = sqliteTable('broadcast_graphics_live_sessions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	eventId: integer('event_id')
		.references(() => events.id, { onDelete: 'cascade' })
		.notNull(),
	screenId: integer('screen_id')
		// eslint-disable-next-line ts/no-use-before-define -- screens is declared below
		.references((): AnySQLiteColumn => screens.id, { onDelete: 'cascade' })
		.notNull(),

	status: text('status', { enum: BROADCAST_GRAPHICS_LIVE_SESSION_STATUS_VALUES })
		.$type<BroadcastGraphicsLiveSessionStatus>()
		.notNull()
		.default('active'),
	currentState: text('current_state', { mode: 'json' }).$type<BroadcastGraphicsLiveState>().notNull(),
	sequence: integer('sequence').notNull().default(0),
	endedAt: integer('ended_at', { mode: 'timestamp_ms' }),

	...timestamps,
}, table => [
	index('broadcast_graphics_live_sessions_event_id_idx').on(table.eventId),
	index('broadcast_graphics_live_sessions_screen_id_idx').on(table.screenId),
	uniqueIndex('broadcast_graphics_live_sessions_active_screen_idx').on(table.screenId).where(sql`${table.status} = 'active'`),
]);

/**
 * Compact command receipts for every sequenced live-state aggregate.
 *
 * A receipt is deliberately not an event row. It answers only the two questions
 * the live-state module asks of history — has this command ID already been
 * committed, and was it the same command? — and it is retained only for a bounded
 * window of an aggregate's most recent commands rather than forever.
 *
 * Answering the second question needs the command's content, so `content_key`
 * holds it in canonical form rather than as a hash: a hash collision would
 * silently accept a different command as a retry and corrupt live state. Rows are
 * therefore no smaller than the event rows they replace, but there is a fixed
 * number of them per aggregate instead of one per command forever.
 */
export const liveStateCommandReceipts = sqliteTable('live_state_command_receipts', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	eventId: integer('event_id')
		.references(() => events.id, { onDelete: 'cascade' })
		.notNull(),

	/** Which family of live-state aggregates the receipt belongs to. */
	aggregateKind: text('aggregate_kind').notNull(),
	/** The aggregate's own primary key within that family. */
	aggregateId: integer('aggregate_id').notNull(),

	commandId: text('command_id').notNull(),
	commandType: text('command_type').notNull(),
	/** The accepted command's canonical content, for same-ID/different-content rejection. */
	contentKey: text('content_key').notNull(),
	/** Authoritative sequence the command committed at. */
	sequence: integer('sequence').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
}, table => [
	index('live_state_command_receipts_event_id_idx').on(table.eventId),
	index('live_state_command_receipts_aggregate_idx').on(table.aggregateKind, table.aggregateId, table.sequence),
	uniqueIndex('live_state_command_receipts_command_idx').on(table.aggregateKind, table.aggregateId, table.commandId),
]);

/**
 * The single-writer claim on one graphics authoring artifact.
 *
 * A Graphics Authoring Lease is session-scoped, not durable state, so this table
 * exists for atomicity rather than persistence: exclusivity is the entire point
 * of a lease, and only a relational conditional write can decide two simultaneous
 * acquisitions in one authoritative order. What keeps the row from outliving its
 * session is `expires_at` — every read treats a lapsed row as no lease at all, so
 * a browser that closes without releasing frees its artifact on its own, with no
 * cleanup sweep and no possibility of a restart resurrecting a stale claim.
 *
 * One row per artifact, enforced by the unique index rather than by convention.
 */
export const graphicsAuthoringLeases = sqliteTable('graphics_authoring_leases', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	/** Which kind of graphics authoring artifact is leased. */
	artifactKind: text('artifact_kind').notNull(),
	/** The artifact's own stable identity within that kind. */
	artifactId: text('artifact_id').notNull(),
	/**
	 * The owning Event, for artifacts that have one. Reusable-library artifacts are
	 * installation-scoped and carry none.
	 */
	eventId: integer('event_id').references(() => events.id, { onDelete: 'cascade' }),

	/** The Better Auth session — one browser — holding the lease (ADR-0010). */
	holderSessionId: text('holder_session_id').notNull(),
	acquiredAt: integer('acquired_at', { mode: 'timestamp_ms' }).notNull(),
	/**
	 * The deadline past which the lease counts as absent. Liveness is this column
	 * alone; a heartbeat is stored only as the deadline it bought, so there is no
	 * second timestamp to read or keep consistent with it.
	 */
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),

	...timestamps,
}, table => [
	uniqueIndex('graphics_authoring_leases_artifact_idx').on(table.artifactKind, table.artifactId),
	index('graphics_authoring_leases_event_id_idx').on(table.eventId),
]);

/**
 * The installation's library of reusable Broadcast Graphic Templates.
 *
 * Deliberately not Event-scoped. A template is a design an author reuses across
 * every show the installation runs, so it has no `event_id` at all — which is also
 * what makes it browsable across Events without anything having to aggregate per
 * Event. A Screen's authored stack lives in `screens.mode_configs`; nothing here is
 * ever live Screen state, and nothing here links to a placed copy.
 *
 * `revision` is the automatically managed revision the glossary requires: identity
 * is `id` and never changes, and every accepted edit to the stored document,
 * name, or description advances the revision by one. It exists so a future
 * Template Package and a Graphic Style Set update can name exactly which version
 * of a template they came from.
 *
 * `graphic_asset_reference_version` is the same one-shot token the Screen write
 * path uses: a write stamps it and every reference-index statement in the same
 * batch is conditional on still reading it, so a template's document and the
 * Graphic Asset References it publishes can never disagree.
 */
export const broadcastGraphicTemplates = sqliteTable('broadcast_graphic_templates', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description'),
	/** Automatically managed: advanced by one on every accepted edit. */
	revision: integer('revision').notNull().default(1),
	/** The saved Broadcast Graphic composition, exactly as a Screen would carry it. */
	document: text('document', { mode: 'json' }).$type<BroadcastGraphicConfig>().notNull(),
	graphicAssetReferenceVersion: text('graphic_asset_reference_version'),
	/**
	 * The one Graphic Style Set this template's inherited properties come from, and
	 * the published revision they were last reconciled to.
	 *
	 * Both are already inside `document`, and both are here anyway. The reason is the
	 * one question the Style Set library has to answer cheaply and completely: when an
	 * author publishes, which templates does this reach? That is a lookup by Style Set
	 * across the whole library, and answering it by parsing every stored document
	 * would make one publish cost the size of the library. There is no foreign key,
	 * because deleting a Style Set is an operation that rewrites every template it
	 * touches rather than a cascade that silently unlinks them.
	 */
	styleSetId: text('style_set_id'),
	styleSetRevision: integer('style_set_revision'),

	...timestamps,
}, table => [
	index('broadcast_graphic_templates_name_idx').on(table.name),
	index('broadcast_graphic_templates_style_set_idx').on(table.styleSetId),
]);

/**
 * The installation's library of reusable Feature Match Layout Templates.
 *
 * A separate table from `broadcast_graphic_templates`, and not a `kind` column on
 * it, because the two are separate artifacts that only share an envelope. Their
 * documents are different shapes validated by different schemas, their packages are
 * non-interchangeable, and each has its own library and workflows — one table would
 * make every read of either say which it wanted and every write able to get it
 * wrong.
 *
 * Installation-scoped for the same reason the Broadcast Graphic Template library
 * is: a layout is a design an author reuses across every show, and a Feature Match
 * Slot assignment is Screen state that never travels with it. `revision` and
 * `graphic_asset_reference_version` carry exactly the meanings they carry there.
 *
 * There is no Graphic Style Set link. A Feature Match Overlay's Frame and Source
 * Items are host-owned and its composition declares no Graphic Inputs, so nothing
 * in a layout is a linked Style Set property today; adding the columns before there
 * is anything to put in them would be an index over an empty question.
 */
export const featureMatchLayoutTemplates = sqliteTable('feature_match_layout_templates', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description'),
	/** Automatically managed: advanced by one on every accepted edit. */
	revision: integer('revision').notNull().default(1),
	/** The saved Feature Match Layout, exactly as a Screen would carry it. */
	document: text('document', { mode: 'json' }).$type<FeatureMatchLayoutConfig>().notNull(),
	graphicAssetReferenceVersion: text('graphic_asset_reference_version'),

	...timestamps,
}, table => [
	index('feature_match_layout_templates_name_idx').on(table.name),
]);

/**
 * The installation's library of named, host-neutral Animation Effect selections.
 *
 * Applying one copies `selection` into a host. No Screen or Event references this
 * row, so deleting or revising a preset cannot change anything already on air.
 */
export const animationEffectPresets = sqliteTable('animation_effect_presets', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	revision: integer('revision').notNull().default(1),
	selection: text('selection', { mode: 'json' }).$type<AnimationEffectSelection>().notNull(),

	...timestamps,
}, table => [
	index('animation_effect_presets_name_idx').on(table.name),
]);

/**
 * The installation's library of reusable Graphic Style Sets.
 *
 * Installation-scoped for the same reason the Broadcast Graphic Template library is:
 * a Style Set exists so a family of independently portable templates keeps one
 * visual language, and a per-Event one could not do that. Events consume Style Sets
 * through templates and never own them.
 *
 * ## Two entry lists, on purpose
 *
 * `draft` is where an author's edits accumulate and `published` is what every linked
 * template resolves against. They are separate columns rather than one list with a
 * dirty flag because the separation *is* the guarantee: an author can restructure a
 * palette all afternoon, leaving the draft referentially broken for most of it,
 * without one linked template seeing an available update. One atomic publish
 * validates the draft, copies it into `published`, and advances `revision`.
 *
 * `revision` starts at zero, which is a real state rather than a placeholder: it
 * means never published, and a template cannot link to a Style Set that has never
 * resolved to anything.
 */
export const graphicStyleSets = sqliteTable('graphic_style_sets', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description'),
	/** The published revision. Zero until the first publish. */
	revision: integer('revision').notNull().default(0),
	/**
	 * Advanced by one on every accepted write to the draft, its name, or its
	 * description, and the token every such write compare-and-swaps on.
	 *
	 * Separate from `revision` because they answer different questions. `revision` is
	 * what a linked template names as its provenance and only publish moves it;
	 * this one exists so two authors with the library open cannot silently overwrite
	 * each other's draft edits, which happens far more often than a publish does.
	 */
	draftRevision: integer('draft_revision').notNull().default(1),
	/** The working draft's entries. Always present, even before the first publish. */
	draft: text('draft', { mode: 'json' }).$type<GraphicStyleSetEntry[]>().notNull(),
	/** The entries at `revision`. Null until the first publish. */
	published: text('published', { mode: 'json' }).$type<GraphicStyleSetEntry[] | null>(),
	publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
	/**
	 * The token one library-wide operation stamps here so every other statement in the
	 * same batch can depend on it.
	 *
	 * Deleting an entry and deleting a Style Set both rewrite this row *and* every
	 * template the change reaches, and have to do all of it or none of it. A batch of
	 * statements each carrying its own precondition cannot promise that: a conditional
	 * `UPDATE` that matches no row is not an error, so a batch whose first statement
	 * found its row and whose second did not still commits the first. So the operation
	 * puts every precondition — this row's draft revision and each template's revision
	 * — on one statement, which stamps a fresh value here, and gives every later
	 * statement an `EXISTS` guard on that stamp. A failed precondition writes no stamp,
	 * and every statement behind it becomes a no-op.
	 *
	 * The same technique, for the same reason, as `screens.graphic_asset_reference_version`.
	 */
	operationVersion: text('operation_version'),

	...timestamps,
}, table => [
	index('graphic_style_sets_name_idx').on(table.name),
]);

export const featureMatches = featureMatchSlots;

export const archetypes = sqliteTable('archetypes', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	eventId: integer('event_id')
		.references(() => events.id, { onDelete: 'cascade' })
		.notNull(),
	name: text('name').notNull(),
	colors: text('colors'),

	...timestamps,
}, table => [
	index('archetypes_event_id_idx').on(table.eventId),
	uniqueIndex('archetypes_event_name_idx').on(table.eventId, table.name),
]);

/**
 * Global card catalog — one row per unique card name per game.
 * Populated during Melee deck sync. Scryfall metadata enriched at sync time.
 */
export const cards = sqliteTable('cards', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	game: text('game', { enum: GAME_VALUES }).notNull().default('mtg'),
	scryfallId: text('scryfall_id'),
	oracleId: text('oracle_id'),
	cardType: text('card_type'),
	colors: text('colors'),
	cmc: real('cmc'),
	manaCost: text('mana_cost'),
	deckCounterTypes: text('deck_counter_types', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
	deckTokens: text('deck_tokens', { mode: 'json' }).$type<DeckTokenRequirement[]>().notNull().default(sql`'[]'`),
	...timestamps,
}, table => [
	uniqueIndex('cards_name_game_idx').on(table.name, table.game),
	index('cards_game_idx').on(table.game),
]);

/** One submitted deck for a player. Melee's deck GUID is the stable identity. */
export const playerDecks = sqliteTable('player_decks', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	eventId: integer('event_id')
		.references(() => events.id, { onDelete: 'cascade' })
		.notNull(),
	playerId: integer('player_id')
		.references(() => players.id, { onDelete: 'cascade' })
		.notNull(),
	externalId: text('external_id').notNull(),
	externalSource: text('external_source', { enum: EXTERNAL_SOURCE_VALUES }).notNull(),
	formatExternalId: text('format_external_id').notNull(),
	name: text('name').notNull(),
	colors: text('colors').notNull().default(''),
	sortOrder: integer('sort_order').notNull().default(0),
	isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
	/** App-owned classification. Melee sync preserves it unless the submitted deck contents change. */
	archetypeId: integer('archetype_id').references(() => archetypes.id, { onDelete: 'set null' }),
	/** Non-null once this specific submitted deck has been reviewed. */
	reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' }),
	...timestamps,
}, table => [
	index('player_decks_event_id_idx').on(table.eventId),
	index('player_decks_player_sort_idx').on(table.playerId, table.sortOrder),
	index('player_decks_format_idx').on(table.eventId, table.formatExternalId),
	index('player_decks_archetype_idx').on(table.archetypeId),
	uniqueIndex('player_decks_external_unique_idx').on(table.eventId, table.externalId, table.externalSource),
	uniqueIndex('player_decks_primary_unique_idx').on(table.playerId).where(sql`${table.isPrimary} = 1`),
]);

/** Junction: cards contained in one submitted player deck. */
export const playerDeckCards = sqliteTable('player_deck_cards', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	deckId: integer('deck_id')
		.references(() => playerDecks.id, { onDelete: 'cascade' })
		.notNull(),
	cardId: integer('card_id')
		.references(() => cards.id, { onDelete: 'cascade' })
		.notNull(),
	quantity: integer('quantity').notNull(),
	compartment: text('compartment', { enum: DECK_LIST_COMPARTMENT_VALUES }).notNull(),
	sortOrder: integer('sort_order').notNull(),
}, table => [
	index('player_deck_cards_deck_sort_idx').on(table.deckId, table.sortOrder),
	index('player_deck_cards_card_idx').on(table.cardId),
]);

export const playerDeckCompanions = sqliteTable('player_deck_companions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	deckId: integer('deck_id')
		.references(() => playerDecks.id, { onDelete: 'cascade' })
		.notNull(),
	companionCardId: integer('companion_card_id')
		.references(() => cards.id, { onDelete: 'set null' }),
	source: text('source', { enum: DECK_COMPANION_SOURCE_VALUES }).notNull(),
	...timestamps,
}, table => [
	uniqueIndex('player_deck_companions_deck_idx').on(table.deckId),
	index('player_deck_companions_card_idx').on(table.companionCardId),
]);

export const eventCardNameOverrides = sqliteTable('event_card_name_overrides', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	eventId: integer('event_id')
		.references(() => events.id, { onDelete: 'cascade' })
		.notNull(),
	inputName: text('input_name').notNull(),
	normalizedInputName: text('normalized_input_name').notNull(),
	inputSetCode: text('input_set_code'),
	normalizedInputSetCode: text('normalized_input_set_code').notNull().default(''),
	resolvedCardId: integer('resolved_card_id')
		.references(() => cards.id, { onDelete: 'cascade' })
		.notNull(),
	...timestamps,
}, table => [
	index('event_card_name_overrides_event_idx').on(table.eventId),
	index('event_card_name_overrides_card_idx').on(table.resolvedCardId),
	uniqueIndex('event_card_name_overrides_event_input_idx').on(
		table.eventId,
		table.normalizedInputName,
		table.normalizedInputSetCode,
	),
]);

export const playerDeckUnresolvedCards = sqliteTable('player_deck_unresolved_cards', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	deckId: integer('deck_id')
		.references(() => playerDecks.id, { onDelete: 'cascade' })
		.notNull(),
	entryType: text('entry_type', { enum: UNRESOLVED_DECK_ENTRY_TYPE_VALUES }).notNull(),
	originalName: text('original_name').notNull(),
	normalizedOriginalName: text('normalized_original_name').notNull(),
	setCode: text('set_code'),
	normalizedSetCode: text('normalized_set_code').notNull().default(''),
	quantity: integer('quantity').notNull().default(1),
	compartment: text('compartment', { enum: DECK_LIST_COMPARTMENT_VALUES }),
	sortOrder: integer('sort_order').notNull().default(0),
	cardType: text('card_type'),
	...timestamps,
}, table => [
	index('player_deck_unresolved_cards_deck_idx').on(table.deckId),
	index('player_deck_unresolved_cards_lookup_idx').on(table.normalizedOriginalName, table.normalizedSetCode, table.entryType),
]);

/**
 * Junction: manually-curated key cards for an archetype (max 5).
 * Replaces the old archetypes.key_cards JSON array.
 */
export const archetypeCards = sqliteTable('archetype_cards', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	archetypeId: integer('archetype_id')
		.references(() => archetypes.id, { onDelete: 'cascade' })
		.notNull(),
	cardId: integer('card_id')
		.references(() => cards.id, { onDelete: 'cascade' })
		.notNull(),
	sortOrder: integer('sort_order').notNull().default(0),
}, table => [
	uniqueIndex('archetype_cards_unique_idx').on(table.archetypeId, table.cardId),
	index('archetype_cards_archetype_idx').on(table.archetypeId),
	index('archetype_cards_card_idx').on(table.cardId),
]);

export const screens = sqliteTable('screens', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	eventId: integer('event_id')
		.references(() => events.id, { onDelete: 'cascade' })
		.notNull(),

	name: text('name').notNull(),
	slug: text('slug').notNull(),

	currentMode: text('current_mode', { enum: SCREEN_MODE_VALUES }).notNull().default('background'),
	modeConfigs: text('mode_configs', { mode: 'json' }).$type<ModeConfigsMap>(),
	screenConfig: text('screen_config', { mode: 'json' }).$type<ScreenConfig>(),
	stateVersion: integer('state_version').notNull().default(0),
	/** Transaction marker keeping Screen configuration and its Graphic Asset usage index in lockstep. */
	graphicAssetReferenceVersion: text('graphic_asset_reference_version'),
	/** Internal derivation seed for the Screen Output's revocable asset capability. */
	assetCapabilitySeed: text('asset_capability_seed').notNull(),
	/** Rotation counter; changing it invalidates every previously derived capability. */
	assetCapabilityVersion: integer('asset_capability_version').notNull().default(1),
	/** One-way lookup identity used to authorize public Screen Output asset requests. */
	assetCapabilityDigest: text('asset_capability_digest').notNull(),
	/** Strongly-consistent source of truth; KV is only a derived display cache. */
	activeCard: text('active_card', { mode: 'json' }).$type<Record<string, unknown> | null>(),
	activeCardVersion: integer('active_card_version').notNull().default(0),

	...timestamps,
}, table => [
	index('screens_event_id_idx').on(table.eventId),
	uniqueIndex('screens_slug_idx').on(table.eventId, table.slug),
	uniqueIndex('screens_asset_capability_digest_idx').on(table.assetCapabilityDigest),
]);

/* RELATIONS */
export const eventsRelations = relations(events, ({ many }) => ({
	talents: many(eventTalents),
	players: many(players),
	phases: many(phases),
	rounds: many(rounds, { relationName: 'eventRounds' }),
	matches: many(matches),
	playerLists: many(playerLists),
	broadcastDeckLists: many(broadcastDeckLists),
	featureMatches: many(featureMatches),
	featureMatchAssignments: many(featureMatchAssignments),
	featureMatchSessions: many(featureMatchSessions),
	screens: many(screens),
	archetypes: many(archetypes),
	eventCardNameOverrides: many(eventCardNameOverrides),
	playerDecks: many(playerDecks),
}));

export const talentsRelations = relations(eventTalents, ({ one }) => ({
	event: one(events, {
		fields: [eventTalents.eventId],
		references: [events.id],
	}),
}));

export const phasesRelations = relations(phases, ({ one, many }) => ({
	event: one(events, {
		fields: [phases.eventId],
		references: [events.id],
	}),
	rounds: many(rounds),
}));

export const roundsRelations = relations(rounds, ({ one, many }) => ({
	event: one(events, {
		fields: [rounds.eventId],
		references: [events.id],
		relationName: 'eventRounds',
	}),
	phase: one(phases, {
		fields: [rounds.phaseId],
		references: [phases.id],
	}),
	matches: many(matches),
	standings: many(playerRoundStandings),
	featureMatchAssignments: many(featureMatchAssignments),
}));

export const matchesRelations = relations(matches, ({ one }) => ({
	event: one(events, {
		fields: [matches.eventId],
		references: [events.id],
	}),
	round: one(rounds, {
		fields: [matches.roundId],
		references: [rounds.id],
	}),
	player1: one(players, {
		fields: [matches.player1Id],
		references: [players.id],
		relationName: 'matchPlayer1',
	}),
	player2: one(players, {
		fields: [matches.player2Id],
		references: [players.id],
		relationName: 'matchPlayer2',
	}),
}));

export const playersRelations = relations(players, ({ one, many }) => ({
	event: one(events, {
		fields: [players.eventId],
		references: [events.id],
	}),
	archetype: one(archetypes, {
		fields: [players.archetypeId],
		references: [archetypes.id],
	}),
	listMemberships: many(playerListMembers),
	featureMatchesAsPlayer1: many(featureMatches, { relationName: 'featureMatchPlayer1' }),
	featureMatchesAsPlayer2: many(featureMatches, { relationName: 'featureMatchPlayer2' }),
	matchesAsPlayer1: many(matches, { relationName: 'matchPlayer1' }),
	matchesAsPlayer2: many(matches, { relationName: 'matchPlayer2' }),
	roundStandings: many(playerRoundStandings),
	decks: many(playerDecks),
}));

export const playerRoundStandingsRelations = relations(playerRoundStandings, ({ one }) => ({
	event: one(events, {
		fields: [playerRoundStandings.eventId],
		references: [events.id],
	}),
	player: one(players, {
		fields: [playerRoundStandings.playerId],
		references: [players.id],
	}),
	round: one(rounds, {
		fields: [playerRoundStandings.roundId],
		references: [rounds.id],
	}),
}));

export const playerListsRelations = relations(playerLists, ({ one, many }) => ({
	event: one(events, { fields: [playerLists.eventId], references: [events.id] }),
	members: many(playerListMembers),
}));

export const playerListMembersRelations = relations(playerListMembers, ({ one }) => ({
	list: one(playerLists, { fields: [playerListMembers.listId], references: [playerLists.id] }),
	player: one(players, { fields: [playerListMembers.playerId], references: [players.id] }),
}));

export const broadcastDeckListsRelations = relations(broadcastDeckLists, ({ one, many }) => ({
	event: one(events, {
		fields: [broadcastDeckLists.eventId],
		references: [events.id],
	}),
	entries: many(broadcastDeckListEntries),
}));

export const broadcastDeckListEntriesRelations = relations(broadcastDeckListEntries, ({ one }) => ({
	list: one(broadcastDeckLists, {
		fields: [broadcastDeckListEntries.listId],
		references: [broadcastDeckLists.id],
	}),
}));

export const featureMatchesRelations = relations(featureMatches, ({ one, many }) => ({
	event: one(events, {
		fields: [featureMatches.eventId],
		references: [events.id],
	}),
	match: one(matches, {
		fields: [featureMatches.matchId],
		references: [matches.id],
	}),
	player1: one(players, {
		fields: [featureMatches.player1Id],
		references: [players.id],
		relationName: 'featureMatchPlayer1',
	}),
	player2: one(players, {
		fields: [featureMatches.player2Id],
		references: [players.id],
		relationName: 'featureMatchPlayer2',
	}),
	activeSession: one(featureMatchSessions, {
		fields: [featureMatches.activeSessionId],
		references: [featureMatchSessions.id],
		relationName: 'featureMatchActiveSession',
	}),
	sessions: many(featureMatchSessions),
	assignments: many(featureMatchAssignments),
}));

export const featureMatchAssignmentsRelations = relations(featureMatchAssignments, ({ one }) => ({
	event: one(events, {
		fields: [featureMatchAssignments.eventId],
		references: [events.id],
	}),
	round: one(rounds, {
		fields: [featureMatchAssignments.roundId],
		references: [rounds.id],
	}),
	slot: one(featureMatches, {
		fields: [featureMatchAssignments.slotId],
		references: [featureMatches.id],
	}),
	match: one(matches, {
		fields: [featureMatchAssignments.matchId],
		references: [matches.id],
	}),
}));

export const featureMatchSessionsRelations = relations(featureMatchSessions, ({ one }) => ({
	event: one(events, {
		fields: [featureMatchSessions.eventId],
		references: [events.id],
	}),
	slot: one(featureMatches, {
		fields: [featureMatchSessions.slotId],
		references: [featureMatches.id],
	}),
	activeSlot: one(featureMatches, {
		fields: [featureMatchSessions.id],
		references: [featureMatches.activeSessionId],
		relationName: 'featureMatchActiveSession',
	}),
}));

export const broadcastGraphicsLiveSessionsRelations = relations(broadcastGraphicsLiveSessions, ({ one }) => ({
	event: one(events, {
		fields: [broadcastGraphicsLiveSessions.eventId],
		references: [events.id],
	}),
	screen: one(screens, {
		fields: [broadcastGraphicsLiveSessions.screenId],
		references: [screens.id],
	}),
}));

export const liveStateCommandReceiptsRelations = relations(liveStateCommandReceipts, ({ one }) => ({
	event: one(events, {
		fields: [liveStateCommandReceipts.eventId],
		references: [events.id],
	}),
}));

export const archetypesRelations = relations(archetypes, ({ one, many }) => ({
	event: one(events, {
		fields: [archetypes.eventId],
		references: [events.id],
	}),
	players: many(players),
	playerDecks: many(playerDecks),
	keyCards: many(archetypeCards),
}));

export const cardsRelations = relations(cards, ({ many }) => ({
	playerDeckCards: many(playerDeckCards),
	playerDeckCompanions: many(playerDeckCompanions),
	eventCardNameOverrides: many(eventCardNameOverrides),
	archetypeCards: many(archetypeCards),
}));

export const playerDecksRelations = relations(playerDecks, ({ one, many }) => ({
	event: one(events, {
		fields: [playerDecks.eventId],
		references: [events.id],
	}),
	player: one(players, {
		fields: [playerDecks.playerId],
		references: [players.id],
	}),
	archetype: one(archetypes, {
		fields: [playerDecks.archetypeId],
		references: [archetypes.id],
	}),
	cards: many(playerDeckCards),
	companion: one(playerDeckCompanions),
	unresolvedCards: many(playerDeckUnresolvedCards),
}));

export const playerDeckCardsRelations = relations(playerDeckCards, ({ one }) => ({
	deck: one(playerDecks, {
		fields: [playerDeckCards.deckId],
		references: [playerDecks.id],
	}),
	card: one(cards, {
		fields: [playerDeckCards.cardId],
		references: [cards.id],
	}),
}));

export const playerDeckCompanionsRelations = relations(playerDeckCompanions, ({ one }) => ({
	deck: one(playerDecks, {
		fields: [playerDeckCompanions.deckId],
		references: [playerDecks.id],
	}),
	card: one(cards, {
		fields: [playerDeckCompanions.companionCardId],
		references: [cards.id],
	}),
}));

export const eventCardNameOverridesRelations = relations(eventCardNameOverrides, ({ one }) => ({
	event: one(events, {
		fields: [eventCardNameOverrides.eventId],
		references: [events.id],
	}),
	card: one(cards, {
		fields: [eventCardNameOverrides.resolvedCardId],
		references: [cards.id],
	}),
}));

export const playerDeckUnresolvedCardsRelations = relations(playerDeckUnresolvedCards, ({ one }) => ({
	deck: one(playerDecks, {
		fields: [playerDeckUnresolvedCards.deckId],
		references: [playerDecks.id],
	}),
}));

export const archetypeCardsRelations = relations(archetypeCards, ({ one }) => ({
	archetype: one(archetypes, {
		fields: [archetypeCards.archetypeId],
		references: [archetypes.id],
	}),
	card: one(cards, {
		fields: [archetypeCards.cardId],
		references: [cards.id],
	}),
}));

export const screensRelations = relations(screens, ({ one, many }) => ({
	event: one(events, {
		fields: [screens.eventId],
		references: [events.id],
	}),
	broadcastGraphicsLiveSessions: many(broadcastGraphicsLiveSessions),
}));

/* DB TYPES */
export type DbEvent = typeof events.$inferSelect;
export type DbEventInsert = typeof events.$inferInsert;
export type DbEventTalent = typeof eventTalents.$inferSelect;
export type DbEventTalentInsert = typeof eventTalents.$inferInsert;
export type DbPlayer = typeof players.$inferSelect;
export type DbPlayerInsert = typeof players.$inferInsert;
export type DbPhase = typeof phases.$inferSelect;
export type DbPhaseInsert = typeof phases.$inferInsert;
export type DbRound = typeof rounds.$inferSelect;
export type DbRoundInsert = typeof rounds.$inferInsert;
export type DbMatch = typeof matches.$inferSelect;
export type DbMatchInsert = typeof matches.$inferInsert;
export type DbFeatureMatch = typeof featureMatches.$inferSelect;
export type DbFeatureMatchInsert = typeof featureMatches.$inferInsert;
export type DbFeatureMatchAssignment = typeof featureMatchAssignments.$inferSelect;
export type DbFeatureMatchAssignmentInsert = typeof featureMatchAssignments.$inferInsert;
export type DbFeatureMatchSlot = typeof featureMatchSlots.$inferSelect;
export type DbFeatureMatchSlotInsert = typeof featureMatchSlots.$inferInsert;
export type DbFeatureMatchSession = typeof featureMatchSessions.$inferSelect;
export type DbFeatureMatchSessionInsert = typeof featureMatchSessions.$inferInsert;
export type DbBroadcastGraphicsLiveSession = typeof broadcastGraphicsLiveSessions.$inferSelect;
export type DbBroadcastGraphicsLiveSessionInsert = typeof broadcastGraphicsLiveSessions.$inferInsert;
export type DbBroadcastGraphicTemplate = typeof broadcastGraphicTemplates.$inferSelect;
export type DbBroadcastGraphicTemplateInsert = typeof broadcastGraphicTemplates.$inferInsert;
export type DbFeatureMatchLayoutTemplate = typeof featureMatchLayoutTemplates.$inferSelect;
export type DbFeatureMatchLayoutTemplateInsert = typeof featureMatchLayoutTemplates.$inferInsert;
export type DbAnimationEffectPreset = typeof animationEffectPresets.$inferSelect;
export type DbAnimationEffectPresetInsert = typeof animationEffectPresets.$inferInsert;
export type DbGraphicStyleSet = typeof graphicStyleSets.$inferSelect;
export type DbGraphicStyleSetInsert = typeof graphicStyleSets.$inferInsert;
export type DbLiveStateCommandReceipt = typeof liveStateCommandReceipts.$inferSelect;
export type DbLiveStateCommandReceiptInsert = typeof liveStateCommandReceipts.$inferInsert;
export type DbScreen = typeof screens.$inferSelect;
export type DbScreenInsert = typeof screens.$inferInsert;
export type DbArchetype = typeof archetypes.$inferSelect;
export type DbArchetypeInsert = typeof archetypes.$inferInsert;
export type DbPlayerList = typeof playerLists.$inferSelect;
export type DbPlayerListInsert = typeof playerLists.$inferInsert;
export type DbPlayerListMember = typeof playerListMembers.$inferSelect;
export type DbPlayerListMemberInsert = typeof playerListMembers.$inferInsert;
export type DbBroadcastDeckList = typeof broadcastDeckLists.$inferSelect;
export type DbBroadcastDeckListInsert = typeof broadcastDeckLists.$inferInsert;
export type DbBroadcastDeckListEntry = typeof broadcastDeckListEntries.$inferSelect;
export type DbBroadcastDeckListEntryInsert = typeof broadcastDeckListEntries.$inferInsert;
export type DbPlayerRoundStandings = typeof playerRoundStandings.$inferSelect;
export type DbPlayerRoundStandingsInsert = typeof playerRoundStandings.$inferInsert;
export type DbCard = typeof cards.$inferSelect;
export type DbCardInsert = typeof cards.$inferInsert;
export type DbPlayerDeck = typeof playerDecks.$inferSelect;
export type DbPlayerDeckInsert = typeof playerDecks.$inferInsert;
export type DbPlayerDeckCard = typeof playerDeckCards.$inferSelect;
export type DbPlayerDeckCardInsert = typeof playerDeckCards.$inferInsert;
export type DbPlayerDeckCompanion = typeof playerDeckCompanions.$inferSelect;
export type DbPlayerDeckCompanionInsert = typeof playerDeckCompanions.$inferInsert;
export type DbEventCardNameOverride = typeof eventCardNameOverrides.$inferSelect;
export type DbEventCardNameOverrideInsert = typeof eventCardNameOverrides.$inferInsert;
export type DbPlayerDeckUnresolvedCard = typeof playerDeckUnresolvedCards.$inferSelect;
export type DbPlayerDeckUnresolvedCardInsert = typeof playerDeckUnresolvedCards.$inferInsert;
export type DbArchetypeCard = typeof archetypeCards.$inferSelect;
export type DbArchetypeCardInsert = typeof archetypeCards.$inferInsert;
