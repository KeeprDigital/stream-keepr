export default defineEventHandler(async () => {
  const local = useStorage('local')
  const configData = await local.getItem<ConfigData>('config')

  if (!configData) {
    return defaultConfigData
  }

  return [configData]
})
