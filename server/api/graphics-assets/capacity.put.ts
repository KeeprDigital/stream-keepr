export default defineEventHandler(() => {
	throw createError({
		statusCode: 403,
		statusMessage: 'Forbidden',
		message: 'Only an installation administrator may change graphics capacity limits',
	});
});
