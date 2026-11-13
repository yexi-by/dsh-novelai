# DSH NovelAI 工具调用参考

采样器、步数、Prompt Guidance、质量标签和 UC 预设由插件设置页统一控制，以下示例都不需要也不允许传这些参数。`parameters` 只接受 `width`、`height`、`seed`、`strength`、`noise`、`extra_noise_seed`、`add_original_image`、`color_correct`、`image_format`。

## Opus 免费画布

| 画幅场景 | `width × height` | 像素总量 |
| --- | --- | --- |
| 人物立绘、单人（默认） | `832 × 1216` | 1,011,712 |
| 多人同框、场景 CG、风景 | `1216 × 832` | 1,011,712 |
| 头像、对称构图 | `1024 × 1024` | 1,048,576 |
| 修长竖图、宽银幕横图 | `768 × 1344` / `1344 × 768` | 1,032,192 |

宽高必须是 64 的倍数，宽 × 高 ≤ 1,048,576；超出会在请求发出前被拒绝。

## 1. 文生图

```json
{
  "prompt": "1girl, solo, platinum blonde hair, bob cut, swept bangs, aqua eyes, blue witch hat, blue cape, white shirt, long sleeves, corset, brown gloves, cowboy shot, autumn forest, golden hour, visual novel sprite, high complexity\nShe smiles softly while adjusting the brim of her hat.",
  "parameters": { "width": 832, "height": 1216 }
}
```

固定 seed 微调：

```json
{
  "prompt": "background dataset, no humans, lakeside cabin, pine forest, sunrise mist, high complexity",
  "parameters": { "width": 1216, "height": 832, "seed": 123456 }
}
```

单图特有的排除项（追加在官方 UC 预设之后）：

```json
{ "prompt": "1girl, solo, witch, forest, -1::hat::", "negative_prompt": "glasses" }
```

## 2. 多角色、站位与中文台词

```json
{
  "prompt": "2girls, coffee shop, window seat, warm afternoon sunlight, speech bubble, text, chinese text, visual novel cg, high complexity\nThe black-haired girl on the left greets the silver-haired girl on the right.",
  "use_coords": true,
  "characters": [
    {
      "prompt": "girl, short black hair, blue eyes, white blouse, smiling, waving, saying “早上好！”",
      "negative_prompt": "hat",
      "positions": [{ "x": 0.3, "y": 0.55 }]
    },
    {
      "prompt": "girl, long silver hair, green eyes, navy jacket, sleepy, replying “再让我睡五分钟……”",
      "positions": [{ "x": 0.7, "y": 0.55 }]
    }
  ],
  "parameters": { "width": 1216, "height": 832 }
}
```

插件会把两句中文台词按官网规则追加为 `Text:` 段。英文文字需要手写：

```json
{
  "prompt": "1girl, solo, barista apron, holding coffee mug, speech bubble, text, english text, cozy cafe\nThe barista greets the viewer, saying \"Good morning!\"\nText: Good morning!"
}
```

## 3. 透明背景（V5）

```json
{
  "prompt": "1girl, solo, full body, standing, magical girl outfit, sparkles, alpha transparency",
  "transparent_background": true,
  "parameters": { "width": 832, "height": 1216 }
}
```

## 4. 图生图、Enhance 与局部重绘

```json
{ "action": "img2img", "image_path": "input.png", "prompt": "1girl, solo, watercolor, rain, soft neon reflections", "parameters": { "strength": 0.6, "noise": 0.1 } }
```

```json
{ "action": "enhance", "image_path": "novelai-output/<run>/01.png", "prompt": "<与原图相同的提示词，重复被忽略的部分>", "parameters": { "seed": 123456 } }
```

```json
{ "action": "infill", "image_path": "input.png", "mask_path": "mask.png", "prompt": "1girl, red knitted scarf, detailed wool texture" }
```

- img2img 默认 `strength 0.7, noise 0.2`；Enhance 默认 `strength 0.2, noise 0`；infill 默认 `strength 1, noise 0`，`add_original_image: true`。
- 源图会自动缩放到免费面积内的 64 倍数画布。
- 蒙版白色重绘、黑色保留（透明区域按黑色处理）；每次只修一处；蒙版外内容渗入时扩大蒙版。

## 5. Vibe Transfer 与 Precise Reference（仅 V4.5/V4，会消耗 Anlas，需用户明确要求）

```json
{ "image_path": "style.png", "model": "nai-diffusion-4-5-full", "information_extracted": 0.7 }
```

```json
{ "model": "nai-diffusion-4-5-full", "prompt": "no humans, forest trail, dawn mist", "vibes": [{ "encoding_path": "novelai-output/.vibe-cache/<hash>.nai-vibe.json", "strength": 0.6 }] }
```

```json
{ "model": "nai-diffusion-4-5-full", "prompt": "1girl, solo, city street, autumn leaves", "references": [{ "image_path": "character.png", "type": "character", "fidelity": 0.85, "strength": 0.9 }] }
```

- 多个 Vibe 的强度之和建议 ≤ 1；降低 `information_extracted` 会更多保留构图、更少保留纹理与画风。
- Precise Reference 的 `strength` 越高越像参考图，但表情和姿势也更容易被锁死；`fidelity` 越高越难被提示词覆盖。Vibe 与 Precise Reference 不能同时使用。

## 6. Director Tools（`novelai_augment`）

| `operation` | 功能 | 附加参数 |
| --- | --- | --- |
| `bg-removal` | 去背景（返回 masked / generated / blend 三个版本） | — |
| `lineart` | 线稿 | — |
| `sketch` | 草图 | — |
| `colorize` | 上色或换配色 | `prompt`（标签）、`defry` 0..5 |
| `emotion` | 修改表情 | `prompt`（如 `happy;; smiling`）、`defry` 0..5 |
| `declutter` | 清除文字、气泡和杂物 | — |

`emotion` 最适合用在正面、中性表情的单个动漫角色上；表情不中性时，先转成 `neutral` 再生成其他表情。

## 7. 2 倍放大（`novelai_upscale`）

```json
{ "image_path": "portrait.png", "declared_blur_sigma": 0.35 }
```

## 8. 辅助查询

- `novelai_suggest_tags`：`{ "prompt": "sailor", "lang": "en" }`
- `novelai_account`：`{}`
- `novelai_capabilities`：`{ "include_parameters": false }`（返回当前生成设置与免费范围）

## 官方参考

- [Image Generation 文档](https://docs.novelai.net/en/image/)
- [Tags](https://docs.novelai.net/en/image/tags/)、[Undesired Content](https://docs.novelai.net/en/image/undesiredcontent/)、[Multi-Character](https://docs.novelai.net/en/image/multiplecharacters/)、[Text Rendering](https://docs.novelai.net/en/image/textrendering/)
- [NovelAI Image API OpenAPI](https://image.novelai.net/docs/index.html)
