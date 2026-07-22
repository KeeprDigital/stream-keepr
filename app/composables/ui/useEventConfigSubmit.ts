import type { UpdateEventInput } from '~/types';

export function useEventConfigSubmit() {
	const eventStore = useEventStore();
	const { runRequest } = useRequestFeedback();

	async function handleSubmit(data: UpdateEventInput) {
		if (!eventStore.event)
			return;

		await runRequest(
			async () => {
				const updated = await eventStore.updateEvent(data);
				return updated === null ? null : updated ?? true;
			},
			{
				success: {
					title: 'Success',
					description: 'Event configuration updated successfully',
					color: 'success',
				},
				error: {
					title: 'Error',
					description: 'Failed to update event configuration',
					color: 'error',
				},
				onFailure: ({ error }) => {
					console.error('Failed to update event:', error);
				},
			},
		);
	}

	return { handleSubmit };
}
