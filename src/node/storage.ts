import { realpathSync, statSync } from 'node:fs'
import type { BigIntStats } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import sharp from 'sharp'
import type { GeneratedImage } from './api.ts'
import type { ImageResult } from '../shared.ts'

export function formatImageMarkdown(label: string, filePath: string): string {
  const encoded = filePath.replaceAll('\\', '/').replace(/[%#?<>]/gu, ch => encodeURIComponent(ch))
  return `![${label}](<${encoded}>)`
}

export async function saveImages(
  images: GeneratedImage[],
  cwd: string,
  directory: string,
  metadata: Record<string, unknown>,
  signal: AbortSignal,
  policy?: SandboxExecutionPolicy,
): Promise<ImageResult> {
  if (!directory.trim()) throw new Error('outputDirectory 不能为空')
  const folder = resolve(cwd, directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`)
  await assertWritablePaths([folder], policy)
  await mkdir(folder, { recursive: true })
  const saved = []
  for (const [index, image] of images.entries()) {
    const info = await sharp(image.data).metadata()
    const path = join(folder, `${String(index + 1).padStart(2, '0')}.${info.format === 'webp' ? 'webp' : info.format === 'jpeg' ? 'jpg' : 'png'}`)
    await writeFile(path, image.data, { signal, flag: 'wx' })
    saved.push({
      path,
      width: info.width!,
      height: info.height!,
      ...(image.seed === undefined ? {} : { seed: image.seed }),
      markdown: formatImageMarkdown(`NovelAI 图片 ${index + 1}`, path),
    })
  }
  const metadata_path = join(folder, 'generation.json')
  const result = { images: saved, metadata_path, ...(typeof metadata.model === 'string' ? { model: metadata.model } : {}) }
  await writeFile(metadata_path, JSON.stringify({ created_at: new Date().toISOString(), ...metadata, ...result }, null, 2) + '\n', { signal, flag: 'wx' })
  return result
}

export function safeMetadata(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(safeMetadata)
  if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key, value]) =>
    [key, /^(?:image|mask|reference_image|reference_image_multiple|director_reference_images|controlnet_condition)$/u.test(key) ? '[binary omitted]' : safeMetadata(value)]))
  return input
}

function canonicalTargetSync(targetPath: string): string {
  const absolute = resolve(targetPath)
  const suffix: string[] = []
  let cursor = absolute
  while (true) {
    try {
      const physical = realpathSync.native(cursor)
      return suffix.length ? join(physical, ...suffix.reverse()) : physical
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return absolute
      const parent = dirname(cursor)
      if (parent === cursor) return absolute
      suffix.push(cursor.slice(parent.endsWith(sep) ? parent.length : parent.length + 1))
      cursor = parent
    }
  }
}

function resolveAdditionalRoot(root: string): string {
  const physical = realpathSync.native(root)
  if (!statSync(physical).isDirectory()) throw new Error(`无效的额外可写目录 ${root}：目标不是目录`)
  if (physical !== resolve(root)) throw new Error(`无效的额外可写目录 ${root}：不支持符号链接目录授权`)
  return physical
}

async function statIfPresent(path: string): Promise<BigIntStats | undefined> {
  try { return await stat(path, { bigint: true }) }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
    throw error
  }
}

async function isPathUnder(target: string, root: string): Promise<boolean> {
  const caseSensitive = process.platform !== 'win32'
  const left = caseSensitive ? target : target.toLowerCase()
  const right = caseSensitive ? root : root.toLowerCase()
  if (left === right || left.startsWith(right.endsWith(sep) ? right : right + sep)) return true
  const rootStat = await statIfPresent(root)
  if (!rootStat) return false
  let cursor = target
  while (true) {
    const info = await statIfPresent(cursor)
    if (info && info.dev === rootStat.dev && info.ino === rootStat.ino) return true
    const parent = dirname(cursor)
    if (parent === cursor) return false
    cursor = parent
  }
}

export async function assertWritablePaths(paths: readonly string[], policy?: SandboxExecutionPolicy): Promise<void> {
  if (!policy || policy.mode === 'danger-full-access') return
  if (policy.mode === 'read-only') {
    throw new Error('[sandbox: read-only] 当前会话处于只读（read-only）模式，禁止保存生成的图片或缓存文件。请先切换会话权限后再执行。')
  }
  const roots = [
    canonicalTargetSync(policy.workspaceRoot),
    ...(policy.additionalWritableRoots ?? []).map(resolveAdditionalRoot),
    canonicalTargetSync(tmpdir()),
    ...(process.platform === 'win32' ? [] : [canonicalTargetSync('/tmp')]),
  ]
  for (const rawPath of paths) {
    const canonical = canonicalTargetSync(rawPath)
    let allowed = false
    for (const root of roots) {
      if (await isPathUnder(canonical, root)) { allowed = true; break }
    }
    if (!allowed) {
      throw new Error(`[sandbox: workspace-write] 输出目录 "${rawPath}" 超出当前会话允许写入的工作区范围（${policy.workspaceRoot}）。`)
    }
  }
}
