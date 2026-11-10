import { registerHooks } from 'node:module'

export const harness = new URL('../../../deepseek-harness/', import.meta.url)
const entries = {
  '@deepseek-ai/cordis': 'vendor/cordis/lib/index.js',
  '@deepseek-ai/schemastery': 'vendor/schemastery/lib/index.mjs',
  '@deepseek-ai/dsh-tools': 'packages/core/tools/lib/index.js',
  '@deepseek-ai/dsh-skill': 'packages/skill/skill/lib/index.js',
  '@deepseek-ai/dsh-credentials': 'packages/credentials/credentials/lib/index.js',
}
registerHooks({ resolve(specifier, context, next) {
  return entries[specifier] ? { url: new URL(entries[specifier], harness).href, shortCircuit: true } : next(specifier, context)
} })

export async function credentialToken() {
  if (process.env.NOVELAI_API_TOKEN) return process.env.NOVELAI_API_TOKEN
  const { Context } = await import('@deepseek-ai/cordis')
  const { credentialRef } = await import('@deepseek-ai/dsh-credentials')
  const { default: LocalCredentials } = await import(new URL('packages/credentials/credentials-local/lib/index.js', harness))
  const ctx = new Context()
  const fiber = ctx.plugin(LocalCredentials, { watch: false })
  await fiber
  try {
    const value = await ctx.credentials.resolve(credentialRef('NOVELAI_API_TOKEN'))
    if (!value) throw new Error('未配置 NOVELAI_API_TOKEN')
    return value.value
  } finally { await fiber.dispose() }
}

export async function toolRig(client, cwd, directory = 'novelai-output') {
  const { Context } = await import('@deepseek-ai/cordis')
  const { default: LocalFs } = await import(new URL('packages/fs/fs-local/lib/index.js', harness))
  const { registerTools } = await import('../src/node/tools.ts')
  const ctx = new Context()
  const fiber = ctx.plugin(LocalFs, {})
  await fiber
  const definitions = new Map()
  registerTools({ tools: { register(definition) { definitions.set(definition.name, definition) } },
    fs: ctx.fs, workingDirectory: { ensure: async () => cwd } }, client,
  () => ({ model: 'nai-diffusion-5-full', outputDirectory: directory, timeoutSeconds: 300 }))
  return {
    definitions,
    async call(name, args = {}, signal = new AbortController().signal) {
      const definition = definitions.get(name)
      if (!definition) throw new Error(`Unknown test tool ${name}`)
      return definition.execute(args, { agent: {}, signal, callId: 'test', rootCallId: 'test', name, arguments: args, deferContext() {} })
    },
    dispose: () => fiber.dispose(),
  }
}
