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

const definitions: Record<string, ApiSchema> = api.definitions

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
export const API_DEFINITIONS = api.definitions

export const text = (description: string) => ({ type: 'string' as const, description })
export const number = (description: string) => ({ type: 'number' as const, description })
export const integer = (description: string) => ({ type: 'integer' as const, description })
export const bool = (description: string) => ({ type: 'boolean' as const, description })
export const object = (properties: ParameterSchemaSpec) => ({ type: 'object' as const, additionalProperties: false, properties })
export const array = (items: ValueSchemaSpec) => ({ type: 'array' as const, items })
