import { mkdir, writeFile } from 'node:fs/promises'

const commit = '7a069039978fe0ca08042885c8b251455900478b'
const source = `https://raw.githubusercontent.com/cheng1559/novelai-agent/${commit}/skills/novelai-v5-prompt/references/prompt-syntax.md`
const response = await fetch(source)
if (!response.ok) throw new Error(`Skill reference: HTTP ${response.status}`)
const destination = new URL('../assets/novelai-v5-prompt/references/prompt-syntax.md', import.meta.url)
await mkdir(new URL('.', destination), { recursive: true })
await writeFile(destination, `<!-- 来源：${source}；由 scripts/sync-skill.mjs 同步，请勿手工修改。 -->\n\n${await response.text()}`)
console.log('已同步 NovelAI V5 提示词参考资料')
