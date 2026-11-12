/**
 * What a committed write tells the operator when this browser then failed to
 * reload what it changed: the write's own success, marked "Reload Needed" as a
 * Melee operation's is, so they reload the page rather than retry the write.
 */
export function reloadNeededToast(committed: { title: string; description: string }) {
	return {
		title: `${committed.title} — Reload Needed`,
		description: `${committed.description.replace(/\.$/, '')}. The change was saved, but this browser could not reload all affected data. Reload the page before continuing.`,
		color: 'warning' as const,
	};
}
