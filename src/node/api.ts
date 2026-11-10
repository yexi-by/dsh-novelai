import { unzipSync } from 'fflate'
import sharp from 'sharp'
import { API_ORIGIN } from '../shared.ts'

export interface GeneratedImage { data: Buffer; seed?: number }
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type ApiPayload = Record<string, Json>

export class NovelAIClient {
  private readonly token: () => Promise<string>
  private readonly timeoutSeconds: () => number
  private readonly origin: string
  constructor(
    token: () => Promise<string>,
    timeoutSeconds: () => number,
    origin = API_ORIGIN,
  ) { this.token = token; this.timeoutSeconds = timeoutSeconds; this.origin = origin }

  async request(path: string, payload: ApiPayload | undefined, signal: AbortSignal): Promise<Response> {
    const token = await this.token()
    const response = await fetch(new URL(path, this.origin), {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'dsh-novelai/0.1.0' },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutSeconds() * 1000)]),
      redirect: 'error',
    })
    if (!response.ok) {
      const body = (await response.text()).replaceAll(token, '[redacted]').slice(0, 2000)
      throw new Error(`NovelAI HTTP ${response.status}: ${body}`)
    }
    return response
  }

  async json(path: string, payload: ApiPayload | undefined, signal: AbortSignal): Promise<Json> {
    return await (await this.request(path, payload, signal)).json() as Json
  }

  async images(path: string, payload: ApiPayload, signal: AbortSignal): Promise<GeneratedImage[]> {
    const response = await this.request(path, payload, signal)
    const bytes = Buffer.from(await response.arrayBuffer())
    return decodeImages(bytes, response.headers.get('content-type') ?? '')
  }
}

export async function decodeImages(bytes: Buffer, contentType: string): Promise<GeneratedImage[]> {
  let images: GeneratedImage[]
  if (contentType.includes('json') || bytes[0] === 123) {
    const result: unknown = JSON.parse(bytes.toString('utf8'))
    if (!result || typeof result !== 'object' || !('images' in result) || !Array.isArray(result.images)) throw new Error('NovelAI 未返回 images 数组')
    images = result.images.map((item: unknown) => {
      if (!item || typeof item !== 'object' || !('image' in item) || typeof item.image !== 'string') throw new Error('NovelAI 图片结果格式错误')
      const seed = 'seed' in item && typeof item.seed === 'number' ? item.seed : undefined
      return { data: Buffer.from(item.image, 'base64'), ...(seed === undefined ? {} : { seed }) }
    })
  } else if (bytes[0] === 80 && bytes[1] === 75) {
    images = Object.entries(unzipSync(bytes)).filter(([name]) => /\.(?:png|webp|jpe?g)$/i.test(name))
      .map(([, data]) => ({ data: Buffer.from(data) }))
  } else images = [{ data: bytes }]
  if (!images.length) throw new Error('NovelAI 返回了空图片结果')
  for (const image of images) {
    const info = await sharp(image.data).metadata()
    if (!info.width || !info.height) throw new Error('NovelAI 返回的图片无法解码')
  }
  return images
}
