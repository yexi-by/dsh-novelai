---
name: novelai-v5-prompt
description: 使用 NovelAI 生成或编辑图片：编写 V5/V4.5 标签与自然语言提示词、多角色坐标与文字漫画提示词，调用 novelai_* 工具执行文生图、图生图、局部重绘、Vibe、Precise Reference、Director Tools 与 2 倍放大，并将生成图片嵌入回复正文。
---

# NovelAI 绘图与编辑

将用户的视觉需求转化为高质量 NovelAI 提示词，通过已安装的 `novelai_*` 工具生成或编辑真实图片，并将返回的 Markdown 图片嵌入回复正文。

无特殊要求时优先使用合理默认参数；需要特定构图比例时从标准画布尺寸中选择。

## 选择工具与模型

- `novelai_generate`：文生图、`img2img` 图生图、`infill` 局部重绘、`enhance` 提示词引导细节增强；支持多角色与坐标、Vibe Transfer、Precise Reference、透明背景及完整官方生成参数。
- `novelai_augment`：Director Tools（`bg-removal` 背景移除、`lineart` 线稿、`sketch` 草图、`colorize` 上色、`emotion` 表情修改、`declutter` 清理文字/杂物）。
- `novelai_upscale`：独立 **2 倍放大**（宽高各 ×2，忠实保留原画，不走扩散重绘；需按提示词重绘细节时用 `novelai_generate` 的 `action: "enhance"`）。
- `novelai_encode_vibe`：编码并本地缓存 V4/V4.5 Vibe；后续复用返回的 `encoding_path` 免除重复编码开销。
- `novelai_suggest_tags`：查询官方标签建议与识别度（不确定作品名、角色名或服饰标签拼写时先查）。
- `novelai_account`：查询订阅状态与可用 Anlas 余额。
- `novelai_capabilities`：查询各模型能力矩阵；传入 `include_parameters: true` 获取完整官方 OpenAPI 参数定义。

默认模型由插件设置决定（默认 `nai-diffusion-5-full`）：
- **V5 Full / Curated**：适合标签与自然语言混排、多角色（最多 22 人）、画面内文字与漫画分镜、透明 PNG/WebP；**尚不支持** Vibe Transfer、Precise Reference、SMEA、Decrisper、Variety+ 与 ControlNet。
- **V4.5 Full / Curated**：支持 Precise Reference（角色/画风锁定）与 Vibe Transfer，最多 6 个角色提示词。
- **V4 Full / Curated**：支持 Vibe Transfer 与最多 6 个角色提示词。
- **V3 Anime / Furry**：支持原图 Vibe Transfer、SMEA / SMEA DYN 等旧版采样选项，不支持独立角色提示词框。

Vibe Transfer 与 Precise Reference 当前互斥。V5 Curated 的 `infill` 沿用官方当前对应的 `nai-diffusion-4-5-curated-inpainting`（V4.5 规格，最多 6 角色），工具返回 `model` 会标明实际执行模型。需要切换模型才能满足用户需求时明确告知原因，绝不静默忽略受限参数。

## 标准画布尺寸

宽高必须为 64..2048 之间的 64 倍数。NovelAI 标准单图档位（≤ 1,048,576 像素）常用尺寸：
- **竖图（人像/立绘）**：`832 × 1216`
- **横图（风景/双人场景）**：`1216 × 832`
- **方图（头像/构图居中）**：`1024 × 1024`
- **低消耗快速草稿/验证**：`512 × 512`、`512 × 768`、`768 × 512`

## 提示词组织

先明确主体数量、外貌服饰、动作互动、场景构图、镜头光影与媒介画风。精确属性（发色、瞳色、服装、镜头角度）优先使用标准英文标签；复杂空间关系、因果互动、漫画分镜与台词描述结合自然语言（支持英文、日文等）。

基础提示词按「数据集前缀（需要时置顶 `fur dataset` 或 `background dataset`）→ 主体数量与核心主体 → 动作与场景 → 镜头构图与光影 → 媒介风格 → 复杂度与质量美学词」组织。V5 常规精细画面推荐加入 `high complexity, very aesthetic, best quality`。

权重语法：`{tag}` 每层增强 ×1.05，`[tag]` 每层减弱 ÷1.05；V4+ 支持显式数值权重 `1.3::rain, wet street::`；V4.5+/V5 支持负向局部权重 `-1::hat::`。完整标签语法、多角色互动与排版细节见 [references/prompt-syntax.md](references/prompt-syntax.md)。

`negative_prompt` 仅按画面需要排除低质与伪影（如 `lowres, artistic error, scan artifacts, worst quality, jpeg artifacts, very displeasing`）或特定多余元素（如 `bad hands, extra digits`）。**未经用户明确要求，不要默认加入 `nsfw`、`rating:sensitive` 等内容分级词**；画面需要文字时不要在负向中放入 `text`。

多角色时：总人数写在基础 `prompt`（如 `2girls`），每个角色拆入 `characters` 数组，单角色提示词以 `girl`、`boy`、`other` 开头且不带数量词。坐标 `positions` 取值 `0..1`，搭配 `use_coords: true` 控制站位；双人动作可用 `source#hug`、`target#hug`、`mutual#hug` 等标签。不要混用 `characters` 与旧版 `|` 分隔语法。

画面文字排版：在基础提示词写明语言标签（如 `text, english text`）、说话者或文字位置，并在 `prompt` 末尾放置 `Text: 具体文字`；多段文字之间用空行分隔。短词不出现时可将 `parameters.tag_hint_qt` 设为 `0`。不要向用户保证复杂长句拼写一次完全无误。

## 编辑、重绘与参考图

常用扩散参数位于 `parameters`（如 `width`、`height`、`scale`、`sampler`、`seed`、`n_samples`、`strength`、`noise`、`cfg_rescale`、`straight_alpha`、`upscale`）。

- **图生图与 Enhance**：传入 `image_path`，未指定宽高时自动对齐源图比例与 64 倍数（支持自动识别 EXIF 旋转）。`img2img` 默认 `strength: 0.7, noise: 0.2`；`enhance` 默认 `strength: 0.2, noise: 0`。
- **局部重绘（`infill`）**：传入 `image_path` 与 `mask_path`（白色 `#FFFFFF` 重绘、黑色 `#000000` 保留，透明背景按黑色保留处理）。插件默认开启 `add_original_image: true` 保护未遮罩区域原貌，`strength` 默认 `1`。若用户只指定了要修改的部位而未提供现成蒙版文件，先按源图尺寸生成黑白 PNG 蒙版再调用 `infill`；扩图同理先拼接扩展画布与对应白色扩展区蒙版。
- **Vibe Transfer**：在 `vibes` 中提供 `image_path` 或已缓存的 `encoding_path`，可调 `strength`（默认 0.6）与 `information_extracted`（默认 1）。
- **Precise Reference**：仅 V4.5 支持，在 `references` 中提供 `image_path`、`type`（`character` / `style` / `character&style`）、`fidelity` 与 `strength`；插件自动缩放并黑边填充到官方参考画布。

各工具的完整参数调用示例见 [references/tools.md](references/tools.md)。

## 图片交付与视觉复核

工具成功后读取返回的 `images[].markdown`、`images[].path`、`images[].seed` 与 `metadata_path`。将 `markdown` 原样嵌入回复正文的合适段落（可按语境调整方括号内的图片说明文字）。路径对应本机真实落盘文件，严禁编造外部链接或把 Base64 贴入正文。

用户仅索要提示词时直接交付提示词，不调用付费生成。已提交的付费请求失败或超时时如实说明错误，不盲目循环重试以免重复扣费。

在正文嵌入 Markdown 图片并不等于聊天模型自己已经“看见”画面。需要对成图做构图、手部、文字或重绘效果自检时，若当前环境提供 `read_image` 且当前聊天模型支持视觉输入，先调用 `read_image` 查看落盘文件再给出视觉判断；未读图时不要声称已目视核对画面细节。迭代微调时保留 `seed`、提示词与实际模型（均记录在同目录 `generation.json` 中）。
