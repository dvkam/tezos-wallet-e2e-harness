import { z } from 'zod'

const consumerConfig = z.discriminatedUnion('picker', [
  z.object({ picker: z.literal('default') }),
  z.object({ picker: z.literal('custom'), extensionId: z.string().regex(/^[a-p]{32}$/) })
])

export function parseConsumerConfig(parameters: URLSearchParams) {
  return consumerConfig.parse({
    picker: parameters.get('picker') ?? 'default',
    extensionId: parameters.get('extensionId') ?? undefined
  })
}
