export default defineEventHandler(async () => {
  const configData = await getStore('config')

  return [configData]
})
