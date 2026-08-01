/**
 * Every route an acceptance harness asks for, written once.
 *
 * Harnesses address the installation the way any client does, so the paths
 * they build are part of what they prove. Building the same path in two places
 * lets a run pass while exercising something other than the route it names, so
 * provisioning, the fault modes, and every call a harness makes come here.
 *
 * The acceptance *pages* cannot: they are static assets served to a browser,
 * with no way to import this module, so the few routes they call are spelled
 * out inline and marked as the deliberate duplication they are.
 */

export const acceptanceRoutes = {
	events: () => '/api/events',
	event: eventId => `/api/events/${eventId}`,
	screens: eventId => `/api/events/${eventId}/screens`,
	screenModeConfig: (eventId, screenId, mode) =>
		`/api/events/${eventId}/screens/${screenId}/config/${mode}`,
	screenAssetCapability: (eventId, screenId) =>
		`/api/events/${eventId}/screens/${screenId}/asset-capability`,
	featureMatchLayoutPackage: (eventId, screenId) =>
		`/api/events/${eventId}/screens/${screenId}/template-packages/feature-match-layout`,

	/** The document an unattended Screen Output loads. */
	screenOutputDocument: (eventId, slug) => `/event/${eventId}/screen/${slug}`,
	capabilitySession: screenId =>
		`/api/screen-output/screens/${screenId}/asset-capability-session`,
	capabilityContent: (screenId, assetId, revisionId) =>
		`/api/screen-output/screens/${screenId}/assets/${assetId}/revisions/${revisionId}/content`,

	graphicsAssets: () => '/api/graphics-assets',
	editorContent: (assetId, revisionId) =>
		`/api/graphics-assets/${assetId}/revisions/${revisionId}/content`,
	assetLifecycleActions: assetId => `/api/graphics-assets/${assetId}/lifecycle-actions`,
	installedTemplate: templateId => `/api/graphics-assets/installed-templates/${templateId}`,

	ingestionOperations: () => '/api/graphics-assets/ingestion-operations',
	ingestionOperation: operationId =>
		`/api/graphics-assets/ingestion-operations/${operationId}`,
	ingestionContent: operationId =>
		`/api/graphics-assets/ingestion-operations/${operationId}/content`,
	ingestionStagedSource: operationId =>
		`/api/graphics-assets/ingestion-operations/${operationId}/staged-source`,
	fontBrowserEvidence: operationId =>
		`/api/graphics-assets/ingestion-operations/${operationId}/font-browser-evidence`,
	templatePackageConfirmation: operationId =>
		`/api/graphics-assets/ingestion-operations/${operationId}/template-package-confirmation`,
	templatePackageInstallation: operationId =>
		`/api/graphics-assets/ingestion-operations/${operationId}/template-package-installation`,
};

/**
 * One pinned Graphic Asset Revision, and the two public routes it is reachable
 * through.
 *
 * Provisioning builds these and a fault run rebuilds them from a file written
 * hours earlier; both need the same pair of accessors, so neither writes them
 * out. Everything else about a representation — how it was made, what capability
 * reaches it — belongs to whoever built it.
 */
export function screenOutputRepresentation(fields) {
	return {
		...fields,
		capabilityContentPath: () =>
			acceptanceRoutes.capabilityContent(fields.screenId, fields.assetId, fields.revisionId),
		editorContentPath: () => acceptanceRoutes.editorContent(fields.assetId, fields.revisionId),
	};
}
