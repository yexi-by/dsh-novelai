import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'

export function registerSkill(ctx: Context): void {
  const directory = fileURLToPath(new URL('../assets/novelai-v5-prompt/', import.meta.url)).replaceAll('\\', '/')
  const candidate = {
    name: 'novelai-v5-prompt',
    description: '使用 NovelAI 生成或编辑图片：V5 标签与自然语言提示词、多角色、文字与漫画；通过 novelai 工具完成图生图、局部重绘、Vibe、Precise Reference、Director Tools 和放大，并在回复正文插入图片。',
    invocation: { modelInvocable: true, userInvocable: true },
    provider: 'dsh-novelai', source: 'bundled' as const, rank: BUNDLED_SKILL_RANK,
    resourceBase: { kind: 'directory' as const, path: directory },
    path: `${directory}/SKILL.md`,
    locator: `${directory}/SKILL.md`,
  }
  ctx.skills.registerProvider(() => ({ name: 'dsh-novelai',
    list: async () => [candidate],
    get: async (_candidate, options) => {
      const { rank: _rank, locator: _locator, ...summary } = candidate
      const text = await readFile(candidate.path, { encoding: 'utf8', signal: options.signal })
      return { ...summary, content: text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, '') }
    },
  }))
}
