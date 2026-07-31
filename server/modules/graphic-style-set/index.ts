import type { DbBroadcastGraphicTemplate, DbGraphicStyleSet } from '~~/server/db/schema';
import type { GraphicsTemplateRewrite } from '~~/server/services/graphicStyleSet';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type {
	AffectedGraphicsTemplate,
	GraphicStyleSetEntry,
	GraphicStyleSetPublishIssue,
} from '~~/shared/types/graphicStyleSet';
import {
	detachGraphicStyleRefs,
	graphicStyleEntryReferences,
	graphicStyleSetEntryIdsInDocument,
	graphicStyleUpdateAvailable,
	replaceGraphicStyleRefs,
	resolveGraphicStyleSet,
	validateGraphicStyleSetDraft,
} from '~~/shared/modules/graphic-style-sets';

/**
 * The Graphic Style Set operations that span more than one artifact.
 *
 * Publishing, deleting an entry, and deleting a Style Set all have the same shape:
 * work out what the change reaches, decide what each reached template becomes, and
 * hand the whole set of rewrites to storage as one operation. Keeping that decision
 * here — pure, on documents already read — is what lets the atomicity live entirely
 * in one database batch rather than in a sequence of writes with a recovery story.
 *
 * Nothing in here touches a Screen. Placed Broadcast Graphics and Screen-owned
 * compositions never receive Style Set changes automatically, and the way that is
 * guaranteed is that no operation here can name a Screen: the only rewrites it can
 * produce are template rewrites, because templates are the only artifact the library
 * knows about.
 */

/** What a publish or a deletion would reach, and whether each template actually moves. */
export function affectedTemplates(
	templates: readonly DbBroadcastGraphicTemplate[],
	entries: readonly GraphicStyleSetEntry[],
): AffectedGraphicsTemplate[] {
	const resolution = resolveGraphicStyleSet(entries);
	return templates.map(template => ({
		id: template.id,
		name: template.name,
		revision: template.revision,
		styleChanged: graphicStyleUpdateAvailable(template.document, resolution),
	}));
}

export interface GraphicStyleSetPublishPlan {
	issues: GraphicStyleSetPublishIssue[];
	affected: AffectedGraphicsTemplate[];
}

/**
 * Everything one publish would do, before it does any of it.
 *
 * Deliberately does not rewrite a single template. A published Style Set change
 * reaches a linked template as an *available* update that its author reviews and
 * applies as a new template revision — never as a write the publish performed on
 * their behalf. So the plan names the templates and stops.
 */
export function planGraphicStyleSetPublish(
	draft: readonly GraphicStyleSetEntry[],
	templates: readonly DbBroadcastGraphicTemplate[],
): GraphicStyleSetPublishPlan {
	const { issues } = validateGraphicStyleSetDraft(draft);
	if (issues.length > 0)
		return { issues, affected: [] };

	return { issues, affected: affectedTemplates(templates, draft) };
}

/** Why one entry cannot be deleted the way the author asked. */
export type GraphicStyleEntryDeletionRefusal
	= | { code: 'entry-not-found' }
		| { code: 'replacement-not-found' }
		| { code: 'replacement-kind-mismatch' }
		| { code: 'replacement-is-subject' }
		| { code: 'detach-would-break-entries'; entryIds: string[] };

export interface GraphicStyleEntryDeletionPlan {
	draft: GraphicStyleSetEntry[];
	published: GraphicStyleSetEntry[] | null;
	rewrites: GraphicsTemplateRewrite[];
}

/**
 * What deleting one entry does to the Style Set and to every template that reaches it.
 *
 * ## Why detach cannot always be offered
 *
 * Detaching a template's reference is free: the template already stores the value the
 * entry produced, so removing the reference changes nothing it renders. Detaching an
 * entry's* reference is not, because an entry has nowhere to put a literal — a
 * Graphic Fill preset stores a palette entry id and cannot store a colour. So an
 * entry other entries depend on can only be replaced, and asking to detach it is
 * refused by name rather than half-applied.
 */
export function planGraphicStyleEntryDeletion(
	styleSet: DbGraphicStyleSet,
	templates: readonly DbBroadcastGraphicTemplate[],
	entryId: string,
	mode: { mode: 'replace'; replacementEntryId: string } | { mode: 'detach' },
): GraphicStyleEntryDeletionPlan | GraphicStyleEntryDeletionRefusal {
	const subject = styleSet.draft.find(entry => entry.id === entryId);
	if (!subject)
		return { code: 'entry-not-found' };

	if (mode.mode === 'replace') {
		if (mode.replacementEntryId === entryId)
			return { code: 'replacement-is-subject' };
		const replacement = styleSet.draft.find(entry => entry.id === mode.replacementEntryId);
		if (!replacement)
			return { code: 'replacement-not-found' };
		// The replacement has to be the same kind, or every reference to it would land
		// in a slot that cannot hold it and the local overrides riding along would name
		// keys the new property group does not have.
		if (replacement.kind !== subject.kind)
			return { code: 'replacement-kind-mismatch' };
	}

	const dependants = styleSet.draft.filter(entry => entry.id !== entryId
		&& graphicStyleEntryReferences(entry).some(reference => reference.entryId === entryId));

	if (mode.mode === 'detach' && dependants.length > 0)
		return { code: 'detach-would-break-entries', entryIds: dependants.map(entry => entry.id) };

	const rewriteEntry = (entry: GraphicStyleSetEntry): GraphicStyleSetEntry =>
		mode.mode === 'replace' ? repointEntry(entry, entryId, mode.replacementEntryId) : entry;

	const nextDraft = styleSet.draft
		.filter(entry => entry.id !== entryId)
		.map(rewriteEntry);
	const nextPublished = styleSet.published === null
		? null
		: styleSet.published.filter(entry => entry.id !== entryId).map(rewriteEntry);

	const rewrites: GraphicsTemplateRewrite[] = [];
	for (const template of templates) {
		if (!graphicStyleSetEntryIdsInDocument(template.document).has(entryId))
			continue;
		rewrites.push({
			id: template.id,
			revision: template.revision,
			document: mode.mode === 'replace'
				? replaceGraphicStyleRefs(template.document, entryId, mode.replacementEntryId)
				: detachGraphicStyleRefs(template.document, [entryId]),
		});
	}

	return { draft: nextDraft, published: nextPublished, rewrites };
}

/**
 * Every template rewrite deleting a whole Style Set requires.
 *
 * Each linked template keeps exactly what it renders and loses only the provenance,
 * so an author who deletes a shared style loses the ability to update from it and
 * nothing else. That is what makes deletion recoverable in the only sense that
 * matters on a show day: nothing on air changes.
 */
export function planGraphicStyleSetDeletion(
	templates: readonly DbBroadcastGraphicTemplate[],
): GraphicsTemplateRewrite[] {
	return templates.map(template => ({
		id: template.id,
		revision: template.revision,
		document: detachGraphicStyleRefs(template.document, null),
	}));
}

/** One entry with every reference to `entryId` repointed at `replacementEntryId`. */
function repointEntry(
	entry: GraphicStyleSetEntry,
	entryId: string,
	replacementEntryId: string,
): GraphicStyleSetEntry {
	const swap = (id: string) => id === entryId ? replacementEntryId : id;

	switch (entry.kind) {
		case 'typography':
			return { ...entry, value: { ...entry.value, colorEntryId: swap(entry.value.colorEntryId) } };
		case 'fill':
			return entry.value.type === 'solid'
				? { ...entry, value: { ...entry.value, colorEntryId: swap(entry.value.colorEntryId) } }
				: {
						...entry,
						value: {
							...entry.value,
							stops: entry.value.stops.map(stop => ({ ...stop, colorEntryId: swap(stop.colorEntryId) })),
						},
					};
		case 'surface-style':
			return {
				...entry,
				value: {
					...entry.value,
					...(entry.value.fillEntryId === undefined ? {} : { fillEntryId: swap(entry.value.fillEntryId) }),
					...(entry.value.outline
						? { outline: { ...entry.value.outline, colorEntryId: swap(entry.value.outline.colorEntryId) } }
						: {}),
					...(entry.value.glow
						? { glow: { ...entry.value.glow, colorEntryId: swap(entry.value.glow.colorEntryId) } }
						: {}),
				},
			};
		case 'media-treatment':
			return entry.value.clipGeometryEntryId === undefined
				? entry
				: {
						...entry,
						value: { ...entry.value, clipGeometryEntryId: swap(entry.value.clipGeometryEntryId) },
					};
		default:
			return entry;
	}
}

/**
 * Whether one composition's Graphic Style Set references all resolve against a
 * published Style Set, and which do not.
 *
 * Checked when a template is written rather than when a Screen is, and the asymmetry
 * is deliberate. A template is the linked artifact — the thing that receives updates,
 * that a package carries, that a deletion has to find — so a reference in one that
 * names nothing is an integrity failure that would make every later operation report
 * on a template it cannot act on. A Screen's placed graphic never receives an update
 * at all, so its references are provenance for whoever later saves it as a template,
 * and this check is exactly where that provenance is proved.
 */
export function unresolvableGraphicStyleRefs(
	document: BroadcastGraphicConfig,
	published: readonly GraphicStyleSetEntry[] | null,
): string[] {
	const resolution = resolveGraphicStyleSet(published ?? []);
	return [...graphicStyleSetEntryIdsInDocument(document)]
		.filter(entryId => !resolution.resolved.has(entryId));
}
