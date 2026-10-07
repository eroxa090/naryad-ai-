import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod'

// LLM вызывается, только если AI_MOCK=false и есть ключ. Иначе модули работают на правилах и шаблонах
// (детерминированные проверки, антифрод и статистика выполняются всегда — они бесплатные).
export const llmEnabled = () => process.env.AI_MOCK === 'false' && Boolean(process.env.ANTHROPIC_API_KEY)
export const modelFast = () => process.env.AI_MODEL_FAST || 'claude-haiku-4-5'
export const modelSmart = () => process.env.AI_MODEL_SMART || 'claude-haiku-4-5'

let client: Anthropic | null = null
const anthropic = () => (client ??= new Anthropic())

// Один структурированный запрос: ответ валидируется по zod-схеме.
// Системный промпт кэшируется (справочники одинаковые между вызовами).
export async function askJson<S extends z.ZodType>(opts: {
  tag: string
  model: string
  system: string
  content: string | Anthropic.ContentBlockParam[]
  schema: S
  maxTokens?: number
}): Promise<z.infer<S>> {
  // Haiku 4.5 не поддерживает effort; на Sonnet/Opus экономим токены низким effort.
  const effort = opts.model.startsWith('claude-haiku') ? {} : { effort: 'low' as const }
  const res = await anthropic().messages.parse({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 3000,
    system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: opts.content }],
    output_config: { format: zodOutputFormat(opts.schema), ...effort },
  })
  const u = res.usage
  console.log(`[ai:${opts.tag}] ${res.model} in=${u.input_tokens} out=${u.output_tokens} cache_read=${u.cache_read_input_tokens ?? 0}`)
  if (res.stop_reason === 'refusal') throw new Error('LLM отказался отвечать')
  if (!res.parsed_output) throw new Error('LLM вернул ответ не по схеме')
  return res.parsed_output as z.infer<S>
}

export function imageBlock(bytes: Uint8Array): Anthropic.ImageBlockParam {
  return {
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(bytes).toString('base64') },
  }
}
