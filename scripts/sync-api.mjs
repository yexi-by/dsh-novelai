import { mkdir, writeFile } from 'node:fs/promises'

const url = 'https://image.novelai.net/docs/doc.json'
const response = await fetch(url)
if (!response.ok) throw new Error(`NovelAI OpenAPI: HTTP ${response.status}`)
const api = await response.json()
const roots = ['image.RequestParameters', 'image.AugmentImageRequest', 'image.UpscaleRequest', 'image.EncodeVibeRequest']
const definitions = {}
function collect(name) {
  if (definitions[name]) return
  const schema = api.definitions[name]
  if (!schema) throw new Error(`Missing definition ${name}`)
  definitions[name] = schema
  for (const ref of JSON.stringify(schema).matchAll(/"\$ref":"#\/definitions\/([^"]+)"/g)) collect(ref[1])
}
roots.forEach(collect)
await mkdir(new URL('../src/generated/', import.meta.url), { recursive: true })
await writeFile(new URL('../src/generated/api.json', import.meta.url), JSON.stringify({ source: url, definitions }, null, 2) + '\n')
console.log(`已同步 ${Object.keys(definitions).length} 个官方 API 定义`)
