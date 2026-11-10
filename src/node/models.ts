export const MODELS = [
  { id: 'nai-diffusion-5-full', label: 'V5 Full', family: 5, characters: 22, vibe: false, precise: false, inpaint: 'nai-diffusion-5-full-inpainting', alpha: true },
  { id: 'nai-diffusion-5-curated', label: 'V5 Curated', family: 5, characters: 22, vibe: false, precise: false, inpaint: 'nai-diffusion-4-5-curated-inpainting', alpha: true },
  { id: 'nai-diffusion-4-5-full', label: 'V4.5 Full', family: 4.5, characters: 6, vibe: true, precise: true, inpaint: 'nai-diffusion-4-5-full-inpainting', alpha: false },
  { id: 'nai-diffusion-4-5-curated', label: 'V4.5 Curated', family: 4.5, characters: 6, vibe: true, precise: true, inpaint: 'nai-diffusion-4-5-curated-inpainting', alpha: false },
  { id: 'nai-diffusion-4-full', label: 'V4 Full', family: 4, characters: 6, vibe: true, precise: false, inpaint: 'nai-diffusion-4-full-inpainting', alpha: false },
  { id: 'nai-diffusion-4-curated-preview', label: 'V4 Curated', family: 4, characters: 6, vibe: true, precise: false, inpaint: 'nai-diffusion-4-curated-inpainting', alpha: false },
  { id: 'nai-diffusion-3', label: 'V3 Anime', family: 3, characters: 0, vibe: true, precise: false, inpaint: 'nai-diffusion-3-inpainting', alpha: false },
  { id: 'nai-diffusion-furry-3', label: 'V3 Furry', family: 3, characters: 0, vibe: true, precise: false, inpaint: 'nai-diffusion-furry-3-inpainting', alpha: false },
] as const

export function modelInfo(id: string) {
  const model = MODELS.find(model => model.id === id || model.inpaint === id)
  if (!model) throw new Error(`未知模型 ${id}。使用 novelai_capabilities 查询支持的模型。`)
  return model
}
