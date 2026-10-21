import type { GraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import {
	assertGraphicsTemplateReferencesSelectable,
	assertGraphicsTemplatesReferencesSelectable,
} from '~~/server/utils/graphicsTemplateReferences';
import { broadcastGraphicsGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';

/**
 * What a Broadcast Graphic Template is allowed to reference: the graphics Template
 * rule (#614), over the same walk a Broadcast Graphics Screen's stack is discovered
 * by, so a template and the copy placed from it agree on what they pin.
 */
export async function assertBroadcastGraphicTemplateReferencesSelectable(
	library: Pick<GraphicsAssetLibrary, 'inspectGraphicAssetRevisions'>,
	document: BroadcastGraphicConfig,
): Promise<void> {
	await assertGraphicsTemplateReferencesSelectable(
		library,
		broadcastGraphicsGraphicAssetReferences({ graphics: [document] }),
		'Broadcast Graphic Template',
	);
}

/**
 * The same rule over every Broadcast Graphic Template one Graphic Style Set
 * operation rewrites, each refusal naming its template.
 */
export async function assertBroadcastGraphicTemplatesReferencesSelectable(
	library: Pick<GraphicsAssetLibrary, 'inspectGraphicAssetRevisions'>,
	templates: ReadonlyArray<{ name: string; document: BroadcastGraphicConfig }>,
): Promise<void> {
	await assertGraphicsTemplatesReferencesSelectable(
		library,
		templates.map(template => ({
			name: template.name,
			references: broadcastGraphicsGraphicAssetReferences({ graphics: [template.document] }),
		})),
		'Broadcast Graphic Template',
	);
}
