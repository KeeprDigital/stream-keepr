export function formatSyncTimestamp(date: Date | string | null | undefined): string {
	if (!date) {
		return 'Never';
	}

	const value = new Date(date);
	const diffMs = Date.now() - value.getTime();
	const diffMinutes = Math.floor(diffMs / 60000);

	if (diffMinutes < 1) {
		return 'Just now';
	}

	if (diffMinutes < 60) {
		return `${diffMinutes}m ago`;
	}

	const diffHours = Math.floor(diffMinutes / 60);
	if (diffHours < 24) {
		return `${diffHours}h ago`;
	}

	return value.toLocaleDateString();
}
