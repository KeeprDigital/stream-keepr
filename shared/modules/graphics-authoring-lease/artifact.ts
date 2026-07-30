/**
 * The graphics authoring artifacts a Graphics Authoring Lease can cover.
 *
 * A Graphics Authoring Lease is the exclusive, session-scoped right to edit one
 * graphics authoring artifact, and the glossary names exactly two of them: a
 * Screen's complete graphics Edit workspace, and one reusable graphics Template.
 * Both kinds live here so the lease mechanism never learns what it is leasing —
 * only the Screen Edit workspace is wired to a route today, and the Broadcast
 * Graphic Template library adopts the second kind by addressing it.
 */

export type GraphicsAuthoringArtifactKind = 'screen-edit-workspace' | 'graphics-template';

/** One leasable graphics authoring artifact, identified within its kind. */
export interface GraphicsAuthoringArtifactRef {
	kind: GraphicsAuthoringArtifactKind;
	id: string;
}

/** The complete graphics Edit workspace of one Screen. */
export function screenEditWorkspaceArtifact(screenId: number): GraphicsAuthoringArtifactRef {
	return { kind: 'screen-edit-workspace', id: String(screenId) };
}

/** One reusable graphics Template in a template library. */
export function graphicsTemplateArtifact(templateId: string): GraphicsAuthoringArtifactRef {
	return { kind: 'graphics-template', id: templateId };
}

/** The artifact's stable key, for storage and for client-side cache identity. */
export function graphicsAuthoringArtifactKey(artifact: GraphicsAuthoringArtifactRef): string {
	return `${artifact.kind}:${artifact.id}`;
}
