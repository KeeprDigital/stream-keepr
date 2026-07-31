import type { GraphicFocalPosition, MediaGraphicItemFit } from '../../types/graphicItem';
import type {
	GraphicFill,
	GraphicGlow,
	GraphicOutline,
	ShapeGeometry,
} from '../../types/graphics';
import type {
	AnimationRecipeGraphicStyleEntryValue,
	GraphicStyleAnimationProperties,
	GraphicStyleEntryKind,
	GraphicStyleSetEntry,
	GraphicStyleSetPublishIssue,
	GraphicStyleTypographyProperties,
} from '../../types/graphicStyleSet';
import { GRAPHIC_STYLE_ENTRY_SCHEMA_VERSION } from '../../types/graphicStyleSet';
import { GRAPHIC_FONT_IDS } from '../graphics/typography';

/**
 * Resolving one Graphic Style Set's entries into the values a graphics document
 * can actually hold.
 *
 * An entry is not a value. A typography preset stores a *palette entry id* for its
 * colour, a Graphic Fill preset stores one or more of them, and a Graphic Surface
 * Style preset stores a Graphic Fill preset's id — so reading any of them means
 * walking a small reference graph that can be broken in four ways: a reference to
 * nothing, a reference to an entry of the wrong kind, a cycle, and an entry stored
 * in a schema version this build does not read.
 *
 * Resolution is where all four are found, and it is a pure function of the entry
 * list alone. That is what lets publish validate a draft without writing anything,
 * lets an editor show an author exactly which entry is broken, and lets the update
 * comparison work from two entry lists rather than from stored history.
 *
 * ## Partial resolution is deliberate
 *
 * A broken entry does not stop the rest of the set resolving. Publish refuses on any
 * issue, so an unpublishable draft never reaches a template — but an editor
 * rendering a half-built palette still shows every colour that *is* defined, and a
 * detach operation still freezes every value it can reach. A resolver that threw
 * would make both of those all-or-nothing for no gain.
 */

/** A Graphic Surface Style preset's resolved value. */
export interface ResolvedGraphicStyleSurface {
	/**
	 * Absent when the preset references no Graphic Fill preset, in which case the
	 * consuming property keeps whatever fill it already had — a Graphic Surface Style
	 * always has a fill, so there is nothing to clear it to.
	 */
	fill?: GraphicFill;
	fillOpacity: number;
	outline?: GraphicOutline;
	glow?: GraphicGlow;
}

/** A media treatment preset's resolved value. */
export interface ResolvedGraphicStyleMediaTreatment {
	fit: MediaGraphicItemFit;
	focalPosition: GraphicFocalPosition;
	opacity: number;
	clipGeometry?: ShapeGeometry;
	playbackRate?: number;
	loop?: boolean;
}

export type ResolvedGraphicStyleValue
	= | { kind: 'palette'; value: string }
		| { kind: 'typography'; value: GraphicStyleTypographyProperties }
		| { kind: 'fill'; value: GraphicFill }
		| { kind: 'surface-style'; value: ResolvedGraphicStyleSurface }
		| { kind: 'media-treatment'; value: ResolvedGraphicStyleMediaTreatment }
		| { kind: 'shape-geometry'; value: ShapeGeometry }
		| { kind: 'animation-recipe'; value: GraphicStyleAnimationProperties };

export interface GraphicStyleSetResolution {
	byId: Map<string, GraphicStyleSetEntry>;
	/** Only the entries that resolved completely. */
	resolved: Map<string, ResolvedGraphicStyleValue>;
	issues: GraphicStyleSetPublishIssue[];
}

/** One reference an entry makes, and the entry kind it is only meaningful against. */
export interface GraphicStyleEntryReference {
	entryId: string;
	requiredKind: GraphicStyleEntryKind;
}

/**
 * Every entry this entry references, with the kind each reference demands.
 *
 * One function rather than a check scattered through resolution, because three
 * separate readers need exactly this list: resolution walks it, publish validates
 * it, and deletion asks which entries would break if a subject disappeared.
 */
export function graphicStyleEntryReferences(entry: GraphicStyleSetEntry): GraphicStyleEntryReference[] {
	switch (entry.kind) {
		case 'typography':
			return [{ entryId: entry.value.colorEntryId, requiredKind: 'palette' }];
		case 'fill':
			return entry.value.type === 'solid'
				? [{ entryId: entry.value.colorEntryId, requiredKind: 'palette' }]
				: entry.value.stops.map(stop => ({ entryId: stop.colorEntryId, requiredKind: 'palette' as const }));
		case 'surface-style': {
			const references: GraphicStyleEntryReference[] = [];
			if (entry.value.fillEntryId !== undefined)
				references.push({ entryId: entry.value.fillEntryId, requiredKind: 'fill' });
			if (entry.value.outline)
				references.push({ entryId: entry.value.outline.colorEntryId, requiredKind: 'palette' });
			if (entry.value.glow)
				references.push({ entryId: entry.value.glow.colorEntryId, requiredKind: 'palette' });
			return references;
		}
		case 'media-treatment':
			return entry.value.clipGeometryEntryId === undefined
				? []
				: [{ entryId: entry.value.clipGeometryEntryId, requiredKind: 'shape-geometry' }];
		case 'palette':
		case 'shape-geometry':
		case 'animation-recipe':
			return [];
	}
}

/**
 * The Graphic Animation Recipe an animation preset resolves to.
 *
 * `delay` defaults to zero rather than staying absent because every recipe has one:
 * an optional delay in the preset means "the author did not set one", and the value
 * that means is zero. `pause` and `repeat` are left as the preset stored them — they
 * are on-screen-only, and the slot that receives them decides whether they apply.
 */
function resolveAnimationRecipe(value: AnimationRecipeGraphicStyleEntryValue): GraphicStyleAnimationProperties {
	return {
		duration: value.duration,
		easing: value.easing,
		delay: value.delay ?? 0,
		...(value.fade ? { fade: { ...value.fade } } : {}),
		...(value.slide ? { slide: { ...value.slide } } : {}),
		...(value.scale ? { scale: { ...value.scale } } : {}),
		...(value.reveal ? { reveal: { ...value.reveal } } : {}),
		pause: value.pause ?? 0,
		repeat: value.repeat ?? 1,
	};
}

function issue(
	code: GraphicStyleSetPublishIssue['code'],
	entry: GraphicStyleSetEntry,
	message: string,
	referencedEntryId?: string,
): GraphicStyleSetPublishIssue {
	return {
		code,
		entryId: entry.id,
		entryName: entry.name,
		...(referencedEntryId === undefined ? {} : { referencedEntryId }),
		message,
	};
}

/**
 * Resolve every entry of one Graphic Style Set.
 *
 * The walk is depth-first with memoisation and an explicit in-progress set, so a
 * cycle is reported once against the entry that closed it rather than as a stack
 * overflow. An entry whose reference is broken does not resolve, and neither does
 * anything that referenced it — which is exactly the transitive dependency rule an
 * available update is judged by.
 */
export function resolveGraphicStyleSet(
	entries: readonly GraphicStyleSetEntry[],
): GraphicStyleSetResolution {
	const byId = new Map(entries.map(entry => [entry.id, entry]));
	const resolved = new Map<string, ResolvedGraphicStyleValue>();
	const issues: GraphicStyleSetPublishIssue[] = [];
	const failed = new Set<string>();
	const inProgress = new Set<string>();

	function resolveEntry(entry: GraphicStyleSetEntry): ResolvedGraphicStyleValue | null {
		const memoised = resolved.get(entry.id);
		if (memoised)
			return memoised;
		if (failed.has(entry.id))
			return null;
		if (inProgress.has(entry.id)) {
			issues.push(issue(
				'entry-reference-cycle',
				entry,
				`“${entry.name}” takes part in a cycle of Graphic Style Set entry references`,
			));
			failed.add(entry.id);
			return null;
		}

		inProgress.add(entry.id);
		const value = resolveValue(entry);
		inProgress.delete(entry.id);

		if (!value) {
			failed.add(entry.id);
			return null;
		}
		resolved.set(entry.id, value);
		return value;
	}

	/** One reference followed, with every way it can be broken reported once. */
	function follow(
		entry: GraphicStyleSetEntry,
		reference: GraphicStyleEntryReference,
	): ResolvedGraphicStyleValue | null {
		const target = byId.get(reference.entryId);
		if (!target) {
			issues.push(issue(
				'entry-reference-missing',
				entry,
				`“${entry.name}” references a Graphic Style Set entry that does not exist`,
				reference.entryId,
			));
			return null;
		}
		if (target.kind !== reference.requiredKind) {
			issues.push(issue(
				'entry-reference-kind-mismatch',
				entry,
				`“${entry.name}” references “${target.name}”, which is a ${target.kind} entry rather than a ${reference.requiredKind} entry`,
				reference.entryId,
			));
			return null;
		}
		return resolveEntry(target);
	}

	function followPalette(entry: GraphicStyleSetEntry, entryId: string): string | null {
		const value = follow(entry, { entryId, requiredKind: 'palette' });
		return value?.kind === 'palette' ? value.value : null;
	}

	function resolveValue(entry: GraphicStyleSetEntry): ResolvedGraphicStyleValue | null {
		if (entry.schemaVersion !== GRAPHIC_STYLE_ENTRY_SCHEMA_VERSION) {
			issues.push(issue(
				'entry-schema-unsupported',
				entry,
				`“${entry.name}” is stored in schema version ${entry.schemaVersion}, which this installation does not read`,
			));
			return null;
		}

		switch (entry.kind) {
			case 'palette':
				return { kind: 'palette', value: entry.value.color };

			case 'shape-geometry':
				return { kind: 'shape-geometry', value: structuredClone(entry.value) };

			case 'animation-recipe':
				return { kind: 'animation-recipe', value: resolveAnimationRecipe(entry.value) };

			case 'typography': {
				if (!(GRAPHIC_FONT_IDS as readonly string[]).includes(entry.value.fontId)) {
					issues.push(issue(
						'entry-font-unavailable',
						entry,
						`“${entry.name}” names a font this installation does not have`,
					));
					return null;
				}
				const color = followPalette(entry, entry.value.colorEntryId);
				if (color === null)
					return null;
				const { colorEntryId: _linked, ...typography } = entry.value;
				return { kind: 'typography', value: { ...typography, color } };
			}

			case 'fill': {
				if (entry.value.type === 'solid') {
					const color = followPalette(entry, entry.value.colorEntryId);
					return color === null ? null : { kind: 'fill', value: { type: 'solid', color } };
				}
				const stops = entry.value.stops.map(stop => ({
					color: followPalette(entry, stop.colorEntryId),
					position: stop.position,
					opacity: stop.opacity,
				}));
				if (stops.some(stop => stop.color === null))
					return null;
				return {
					kind: 'fill',
					value: {
						type: 'linear-gradient',
						angle: entry.value.angle,
						stops: stops.map(stop => ({ ...stop, color: stop.color as string })),
					},
				};
			}

			case 'surface-style': {
				const surface: ResolvedGraphicStyleSurface = { fillOpacity: entry.value.fillOpacity };

				if (entry.value.fillEntryId !== undefined) {
					const fill = follow(entry, { entryId: entry.value.fillEntryId, requiredKind: 'fill' });
					if (fill?.kind !== 'fill')
						return null;
					surface.fill = structuredClone(fill.value);
				}
				if (entry.value.outline) {
					const color = followPalette(entry, entry.value.outline.colorEntryId);
					if (color === null)
						return null;
					surface.outline = { color, width: entry.value.outline.width };
				}
				if (entry.value.glow) {
					const color = followPalette(entry, entry.value.glow.colorEntryId);
					if (color === null)
						return null;
					surface.glow = { color, size: entry.value.glow.size, opacity: entry.value.glow.opacity };
				}
				return { kind: 'surface-style', value: surface };
			}

			case 'media-treatment': {
				const treatment: ResolvedGraphicStyleMediaTreatment = {
					fit: entry.value.fit,
					focalPosition: { ...entry.value.focalPosition },
					opacity: entry.value.opacity,
					...(entry.value.playbackRate === undefined ? {} : { playbackRate: entry.value.playbackRate }),
					...(entry.value.loop === undefined ? {} : { loop: entry.value.loop }),
				};
				if (entry.value.clipGeometryEntryId !== undefined) {
					const geometry = follow(entry, {
						entryId: entry.value.clipGeometryEntryId,
						requiredKind: 'shape-geometry',
					});
					if (geometry?.kind !== 'shape-geometry')
						return null;
					treatment.clipGeometry = structuredClone(geometry.value);
				}
				return { kind: 'media-treatment', value: treatment };
			}
		}
	}

	for (const entry of entries)
		resolveEntry(entry);

	return { byId, resolved, issues };
}

/**
 * Every entry inside this Style Set that references the given entry.
 *
 * What deletion asks first. An entry other entries depend on cannot simply be
 * detached — a Graphic Fill preset has nowhere to put a literal colour — so this is
 * what makes the difference between a deletion that can offer both modes and one
 * that can only offer replacement.
 */
export function graphicStyleEntriesReferencing(
	entries: readonly GraphicStyleSetEntry[],
	entryId: string,
): GraphicStyleSetEntry[] {
	return entries.filter(entry =>
		graphicStyleEntryReferences(entry).some(reference => reference.entryId === entryId),
	);
}
