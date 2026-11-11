import { existsSync, readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'

const SKILL_NAME = 'novelai-v5-prompt'
const REQUIRED_FILES = ['SKILL.md', 'references/prompt-syntax.md', 'references/tools.md'] as const

function resolveSkillDirectory(): string {
  for (const rel of ['../assets/novelai-v5-prompt', '../../assets/novelai-v5-prompt']) {
    const candidate = fileURLToPath(new URL(rel, import.meta.url))
    if (existsSync(join(candidate, 'SKILL.md'))) return candidate
  }
  return fileURLToPath(new URL('../assets/novelai-v5-prompt', import.meta.url))
}

function parseSkillDocument(raw: string, filePath: string): { name: string; description: string; content: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
  if (!match?.[1]) throw new Error(`dsh-novelai: ${filePath} 缺少 YAML frontmatter`)
  const fields: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/u)) {
    const entry = /^([A-Za-z0-9_-]+):\s*(.+?)\s*$/u.exec(line)
    if (!entry) continue
    fields[entry[1]] = entry[2].replace(/^(['"])([\s\S]*)\1$/u, '$2')
  }
  if (!fields.name) throw new Error(`dsh-novelai: ${filePath} 缺少 name 字段`)
  if (!fields.description) throw new Error(`dsh-novelai: ${filePath} 缺少 description 字段`)
  return {
    name: fields.name,
    description: fields.description,
    content: raw.slice(match[0].length).trimStart(),
  }
}

export function registerSkill(ctx: Context): void {
  const directoryNative = resolveSkillDirectory()
  for (const rel of REQUIRED_FILES) {
    const target = join(directoryNative, rel)
    if (!statSync(target).isFile()) throw new Error(`dsh-novelai: 缺少内置 Skill 资源文件 ${target}`)
  }
  const directory = directoryNative.replaceAll('\\', '/').replace(/\/+$/u, '')
  const skillPath = `${directory}/SKILL.md`
  const parsed = parseSkillDocument(readFileSync(join(directoryNative, 'SKILL.md'), 'utf8'), skillPath)
  if (parsed.name !== SKILL_NAME) throw new Error(`dsh-novelai: SKILL.md 名称不匹配 (${parsed.name})`)

  const candidate = {
    name: parsed.name,
    description: parsed.description,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: 'dsh-novelai',
    source: 'bundled' as const,
    rank: BUNDLED_SKILL_RANK,
    resourceBase: { kind: 'directory' as const, path: directory },
    path: skillPath,
    locator: skillPath,
  }
  ctx.skills.registerProvider(() => ({
    name: 'dsh-novelai',
    list: async () => [candidate],
    get: async (_candidate, options) => {
      const { rank: _rank, locator: _locator, ...summary } = candidate
      const text = await readFile(join(directoryNative, 'SKILL.md'), { encoding: 'utf8', signal: options.signal })
      return { ...summary, content: parseSkillDocument(text, skillPath).content }
    },
  }))
}
