# 工具调用示例

## 普通文生图

```json
{"prompt":"landscape, lakeside cabin, pine forest, sunrise, watercolor illustration, high complexity"}
```

## 多角色

```json
{
  "prompt": "2girls, coffee shop, window seat, warm afternoon light, high complexity, very aesthetic",
  "negative_prompt": "lowres, artistic error, jpeg artifacts",
  "characters": [
    {"prompt": "girl, black hair, blue eyes, white shirt"},
    {"prompt": "girl, silver hair, green eyes, blue jacket"}
  ]
}
```

横图和固定 seed 示例：

```json
{"prompt":"landscape, lakeside cabin, watercolor","parameters":{"width":1216,"height":832,"seed":123456}}
```

## 图生图、局部重绘、增强

```json
{"action":"img2img","image_path":"input.png","prompt":"city street in watercolor, rain, soft lighting"}
```

```json
{"action":"infill","image_path":"input.png","mask_path":"mask.png","prompt":"red umbrella, detailed fabric"}
```

```json
{"action":"enhance","image_path":"input.png","prompt":"detailed landscape, crisp mountains, sunset"}
```

## Vibe Transfer 与 Precise Reference

```json
{"model":"nai-diffusion-4-5-full","prompt":"landscape, lakeside cabin, watercolor","vibes":[{"image_path":"style.png"}]}
```

再次生成时用 `novelai_encode_vibe` 返回的缓存路径：

```json
{"model":"nai-diffusion-4-5-full","prompt":"landscape, forest, dawn","vibes":[{"encoding_path":"novelai-output/.vibe-cache/<hash>.nai-vibe.json"}]}
```

```json
{"model":"nai-diffusion-4-5-full","prompt":"1girl, standing, city street","references":[{"image_path":"character.png"}]}
```

## Director Tools

调用 `novelai_augment`，operation 可选：

| 值 | 功能 | 其他参数 |
| --- | --- | --- |
| bg-removal | 背景移除，保存所有返回版本 | image_path |
| lineart | 线稿 | image_path |
| sketch | 草图 | image_path |
| colorize | 上色 | prompt、defry（0..5） |
| emotion | 表情修改 | prompt（例如 `happy;; smiling`）、defry（0..5） |
| declutter | 清除杂物或文字 | image_path |

```json
{"image_path":"portrait.png","operation":"emotion","prompt":"happy;; smiling","defry":3}
```

## 模型约束

V5 的透明输出可使用 `parameters.straight_alpha: true` 与 `tag_hint_transparent_background: true`，结合透明背景提示词。V5 的 noise_schedule 为 karras。

V4.5 的 Precise Reference 与 Vibe 互斥。V3 不支持独立角色框，支持 SMEA/SMEA DYN 和相应旧模型功能。ControlNet 必须使用服务端仍支持的模型及控制图，模型未开放的能力不能通过参数强行启用。

独立放大使用 `novelai_upscale`。V5 的生成内增强可以通过官方 `parameters.upscale`、`upscaled_enhance` 调整；`declared_blur_sigma` 取 0、0.30、0.35、0.40、0.45、0.50。

## 来源

- [原始 Skill](https://github.com/cheng1559/novelai-agent/tree/7a069039978fe0ca08042885c8b251455900478b/skills/novelai-v5-prompt)
- [NovelAI 官方接口](https://image.novelai.net/docs/index.html)
- [官方模型说明](https://docs.novelai.net/en/image/models/)
- [Vibe Transfer](https://docs.novelai.net/en/image/vibetransfer/)
- [Precise Reference](https://docs.novelai.net/en/image/precisereference/)
- [Director Tools](https://docs.novelai.net/en/image/directortools/)
