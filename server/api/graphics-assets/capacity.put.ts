export default defineEventHandler(() => {
	throw createError({
		statusCode: 403,
		statusMessage: 'Forbidden',
		message: 'Only a Graphics Administrator may change Graphics Asset Library Capacity limits',
	});
});
