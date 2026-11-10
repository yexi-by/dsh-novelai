import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { GeneratedImage } from './api.ts'
import type { ImageResult } from '../shared.ts'

export async function saveImages(images: GeneratedImage[], cwd: string, directory: string, metadata: Record<string, unknown>, signal: AbortSignal): Promise<ImageResult> {
  const folder = resolve(cwd, directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`)
  await mkdir(folder, { recursive: true })
  const saved = []
  for (const [index, image] of images.entries()) {
    const info = await sharp(image.data).metadata()
    const path = join(folder, `${String(index + 1).padStart(2, '0')}.${info.format === 'webp' ? 'webp' : info.format === 'jpeg' ? 'jpg' : 'png'}`)
    await writeFile(path, image.data, { signal, flag: 'wx' })
    saved.push({ path, width: info.width!, height: info.height!, ...(image.seed === undefined ? {} : { seed: image.seed }),
      markdown: `![NovelAI 图片 ${index + 1}](<${path.replaceAll('\\', '/') }>)` })
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
