import type { ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import api from '../generated/api.json' with { type: 'json' }

interface ApiSchema {
  $ref?: string
  type?: string
  description?: string
  enum?: string[]
  properties?: Record<string, ApiSchema>
  items?: ApiSchema
  allOf?: ApiSchema[]
}

const definitions: Record<string, ApiSchema> = structuredClone(api.definitions)
delete definitions['image.RequestParameters'].properties!.steps

export function apiSchema(name: string): ValueSchemaSpec {
  return convert(definitions[name])
}

function convert(schema: ApiSchema): ValueSchemaSpec {
  if (schema.$ref) return convert(definitions[schema.$ref.replace('#/definitions/', '')])
  if (schema.allOf) return convert(schema.allOf[0])
  const description = schema.description ? { description: schema.description } : {}
  if (schema.type === 'object') return {
    type: 'object', additionalProperties: false,
    properties: Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, value]) => [key, convert(value)])),
    ...description,
  }
  if (schema.type === 'array') return { type: 'array', items: convert(schema.items!), ...description }
  if (schema.type === 'string') return { type: 'string', ...(schema.enum ? { enum: schema.enum } : {}), ...description }
  if (schema.type === 'integer' || schema.type === 'number' || schema.type === 'boolean') return { type: schema.type, ...description }
  throw new Error(`未支持的官方 schema：${JSON.stringify(schema)}`)
}

export const generationParameters = apiSchema('image.RequestParameters') as ValueSchemaSpec & { properties: ParameterSchemaSpec }
// 传输由插件处理；模型只传图片路径，实际图片字节不会进入工具参数或会话历史。
delete generationParameters.properties.stream
export const API_DEFINITIONS = definitions

const AGENT_PARAMETER_HINTS: Record<string, string> = {
  width: 'Canvas width, multiple of 64. width × height must stay ≤ 1,048,576 (Opus free range). Default 832.',
  height: 'Canvas height, multiple of 64. width × height must stay ≤ 1,048,576 (Opus free range). Default 1216.',
  seed: 'Reuse a returned seed to iterate on the same composition.',
  strength: 'img2img / Enhance / infill strength 0..1.',
  noise: 'img2img / Enhance / infill noise 0..1.',
  extra_noise_seed: 'Optional img2img noise seed.',
  add_original_image: 'Infill: overlay untouched original pixels outside the mask (default true).',
  color_correct: 'Infill color correction (default true).',
  image_format: 'Output format.',
}

/** Agent 可见的精简生成参数；采样器、步数、CFG 与预设由插件设置页统一控制。 */
export function agentGenerationParameters(keys: readonly string[]): ValueSchemaSpec & { properties: ParameterSchemaSpec } {
  const properties = Object.fromEntries(keys.map(key => {
    const base = generationParameters.properties[key]
    if (!base) throw new Error(`官方 schema 缺少参数 ${key}`)
    return [key, { ...base, description: AGENT_PARAMETER_HINTS[key] ?? (base as { description?: string }).description }]
  })) as ParameterSchemaSpec
  return { type: 'object', additionalProperties: false, properties }
}

export const text = (description: string) => ({ type: 'string' as const, description })
export const number = (description: string) => ({ type: 'number' as const, description })
export const integer = (description: string) => ({ type: 'integer' as const, description })
export const bool = (description: string) => ({ type: 'boolean' as const, description })
export const object = (properties: ParameterSchemaSpec) => ({ type: 'object' as const, additionalProperties: false, properties })
export const array = (items: ValueSchemaSpec) => ({ type: 'array' as const, items })
