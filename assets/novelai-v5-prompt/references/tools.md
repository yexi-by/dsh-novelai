# DSH NovelAI 工具调用参考

## 标准分辨率速查

| 画幅场景 | 推荐 `width × height` | 像素总量 | 说明 |
| --- | --- | --- | --- |
| 竖图（立绘/单人全身/半身） | `832 × 1216` | 1,011,712 | 标准单图档位（≤ 1,048,576 px） |
| 横图（风景/双人同框/CG） | `1216 × 832` | 1,011,712 | 标准单图档位 |
| 方图（头像/对称构图） | `1024 × 1024` | 1,048,576 | 插件未传宽高时的默认值 |
| 快速草稿 / 低额度测试 | `512 × 512` / `512 × 768` | 262,144 / 393,216 | 适合快速验证构图或节省 Anlas |
| 大画幅（高细节壁纸） | `1024 × 1536` / `1536 × 1024` | 1,572,864 | 消耗更高 Anlas，按用户需求选用 |

所有 `width` 与 `height` 必须是 `64..2048` 之间的 64 倍数，`steps` 取值 `1..50`（常规默认 `28`）。

## 1. 文生图（`novelai_generate`）

基础竖图示例：

```json
{
  "prompt": "1girl, solo, silver hair, red scarf, winter park, snowing, soft morning light, anime illustration, high complexity, very aesthetic, best quality",
  "negative_prompt": "lowres, artistic error, scan artifacts, worst quality, jpeg artifacts, very displeasing",
  "parameters": {
    "width": 832,
    "height": 1216
  }
}
```

固定 `seed` 横图复现示例：

```json
{
  "prompt": "background dataset, no humans, lakeside cabin, pine forest, sunrise mist, watercolor illustration, high complexity, very aesthetic",
  "parameters": {
    "width": 1216,
    "height": 832,
    "seed": 123456
  }
}
```

## 2. 多角色与坐标（`novelai_generate`）

```json
{
  "prompt": "2girls, coffee shop, window seat, warm afternoon sunlight, high complexity, very aesthetic, best quality",
  "negative_prompt": "lowres, artistic error, worst quality, jpeg artifacts",
  "use_coords": true,
  "characters": [
    {
      "prompt": "girl, short black hair, blue eyes, white shirt, smiling, source#holding hands",
      "negative_prompt": "hat",
      "positions": [{ "x": 0.32, "y": 0.55 }]
    },
    {
      "prompt": "girl, long silver hair, green eyes, blue jacket, blushing, target#holding hands",
      "positions": [{ "x": 0.68, "y": 0.55 }]
    }
  ],
  "parameters": {
    "width": 1216,
    "height": 832
  }
}
```

## 3. 图生图、局部重绘与细节增强（`novelai_generate`）

图生图（`img2img`，默认 `strength: 0.7, noise: 0.2`）：

```json
{
  "action": "img2img",
  "image_path": "input.png",
  "prompt": "city street in watercolor, rain, soft neon reflections, high complexity, very aesthetic",
  "parameters": {
    "strength": 0.65,
    "noise": 0.15
  }
}
```

局部重绘（`infill`：`mask_path` 白色 `#FFFFFF` 区域重绘、黑色 `#000000` 区域保留；默认 `strength: 1`、`add_original_image: true`）：

```json
{
  "action": "infill",
  "image_path": "input.png",
  "mask_path": "mask.png",
  "prompt": "1girl, knitted red scarf, detailed wool texture, winter park, high complexity, very aesthetic"
}
```

提示词引导增强（`enhance`，默认 `strength: 0.2, noise: 0`）：

```json
{
  "action": "enhance",
  "image_path": "input.png",
  "prompt": "detailed landscape, crisp mountain ridges, golden sunset, high complexity, very aesthetic"
}
```

## 4. Vibe Transfer 与缓存编码（`novelai_encode_vibe` + `novelai_generate`）

先调用 `novelai_encode_vibe` 编码并落盘缓存（需 V4 / V4.5 基础模型）：

```json
{
  "image_path": "style.png",
  "model": "nai-diffusion-4-5-full",
  "information_extracted": 0.7
}
```

再调用 `novelai_generate` 复用返回的 `encoding_path`（也可首次直接在 `vibes` 传 `image_path` 自动编码并缓存）：

```json
{
  "model": "nai-diffusion-4-5-full",
  "prompt": "no humans, forest trail, dawn mist, watercolor, very aesthetic, best quality",
  "vibes": [
    {
      "encoding_path": "novelai-output/.vibe-cache/<hash>.nai-vibe.json",
      "information_extracted": 0.7,
      "strength": 0.6
    }
  ]
}
```

## 5. Precise Reference（`novelai_generate`，仅 V4.5）

```json
{
  "model": "nai-diffusion-4-5-full",
  "prompt": "1girl, solo, standing on city street, autumn leaves, very aesthetic, best quality",
  "references": [
    {
      "image_path": "character.png",
      "type": "character",
      "fidelity": 0.85,
      "strength": 1
    }
  ]
}
```

## 6. Director Tools（`novelai_augment`）

| `operation` | 功能 | 可选附加参数 |
| --- | --- | --- |
| `bg-removal` | 背景移除（保存全部返回图层版本） | — |
| `lineart` | 提取线稿 | — |
| `sketch` | 转为草图 | — |
| `colorize` | 线稿/黑白上色 | `prompt`（配色描述）、`defry`（`0..5`） |
| `emotion` | 修改人物表情 | `prompt`（如 `happy;; smiling`）、`defry`（`0..5`） |
| `declutter` | 清除画面文字或杂物 | — |

调用 `novelai_augment` 示例：

```json
{
  "image_path": "portrait.png",
  "operation": "emotion",
  "prompt": "happy;; smiling",
  "defry": 2
}
```

## 7. 独立 2 倍放大（`novelai_upscale`）

将输入图片宽高各放大为原来的 2 倍（如 `832×1216` → `1664×2432`），不改变原有构图细节；`declared_blur_sigma` 可选 `0`、`0.3`、`0.35`、`0.4`、`0.45`、`0.5`：

```json
{
  "image_path": "portrait.png",
  "declared_blur_sigma": 0.35
}
```

## 8. 辅助查询工具

- 标签补全查询 `novelai_suggest_tags`：
  ```json
  { "prompt": "sailor", "lang": "en" }
  ```
- 账户与 Anlas 余额查询 `novelai_account`：`{}`
- 模型能力与完整参数定义查询 `novelai_capabilities`：
  ```json
  { "include_parameters": false }
  ```

## 模型特定参数约束

- **V5 透明背景输出**：`novelai_generate` 设 `parameters: { "straight_alpha": true, "tag_hint_transparent_background": true }`，并在提示词写明 `transparent background`。V5 的 `noise_schedule` 必须为 `"karras"`。
- **互斥与版本边界**：`vibes` 与 `references` 不可同时传入；V5 暂不支持 Vibe Transfer、Precise Reference、SMEA（`sm` / `sm_dyn`）、Decrisper（`dynamic_thresholding`）、Variety+（`skip_cfg_above_sigma`）与 ControlNet。

## 官方参考链接

- [NovelAI Image API OpenAPI](https://image.novelai.net/docs/index.html)
- [NovelAI Models 文档](https://docs.novelai.net/en/image/models/)
- [Vibe Transfer 文档](https://docs.novelai.net/en/image/vibetransfer/)
- [Precise Reference 文档](https://docs.novelai.net/en/image/precisereference/)
- [Director Tools 文档](https://docs.novelai.net/en/image/directortools/)
