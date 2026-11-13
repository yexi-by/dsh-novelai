---
name: novelai-v5-prompt
description: 使用 NovelAI 生成或编辑图片：按官方指南编写 V5 标签与自然语言提示词、角色一致性外观、多角色站位与中文台词文字渲染，调用 novelai_* 工具执行文生图、图生图、局部重绘、Enhance、透明背景、Vibe、Precise Reference、Director Tools 与 2 倍放大，并将生成图片嵌入回复正文。
---

# NovelAI 绘图与编辑

将用户或剧情中的视觉需求转化为符合 NovelAI 官方指南的提示词，通过 `novelai_*` 工具生成真实图片，并把返回的 Markdown 图片嵌入回复正文。

## 插件已自动处理（不要重复书写）

- **采样器、步数、Prompt Guidance、Rescale** 由插件设置页统一控制（默认与官网一致：Euler Ancestral、23 步、CFG 7），工具不接受这些参数。
- **官方质量标签**（V5 Standard：`very aesthetic, masterpiece, no text`）会自动追加到基础提示词末尾、`Text:` 段之前；画面含文字时会自动去掉 `no text`。**不要**在 `prompt` 中再写 `masterpiece`、`best quality`、`very aesthetic`、`no text` 等预设词。
- **官方 Undesired Content 预设**（默认 Heavy）会自动作为负向前缀。`negative_prompt` 只写这张图特有的排除项（例如不想出现的配饰、多余人物），不要粘贴通用的低质量词表。
- **中文台词自动转画面文字**（V5）：提示词或角色提示词中用 `“…”`、`「…」` 包裹的中文内容，会按官网规则自动追加为 `Text:` 段。
- 每次请求固定生成 1 张，且必须在 Opus 免费范围内（面积 ≤ 1,048,576 像素、步数 ≤ 28）。

## 工具

- `novelai_generate`：文生图、`img2img`、`infill` 局部重绘、`enhance` 提示词引导精修、多角色与坐标、`transparent_background` 透明背景。
- `novelai_augment`：Director Tools（`bg-removal`、`lineart`、`sketch`、`colorize`、`emotion`、`declutter`）。
- `novelai_upscale`：2 倍放大（宽高各 ×2，不做扩散重绘）。
- `novelai_encode_vibe`：编码并缓存 V4/V4.5 Vibe。
- `novelai_suggest_tags`：查询官方标签与模型认知度（不确定角色名、作品名、服饰标签拼写时先查）。
- `novelai_account`：查询订阅、V5 血条与 Anlas。
- `novelai_capabilities`：查询模型能力、当前生成设置与免费范围。

> [!IMPORTANT]
> Precise Reference（每张额外约 5 Anlas）、Vibe 编码（每次 2 Anlas，超过 4 个 Vibe 时每个再加 2 Anlas）、Director Tools 和 2 倍放大都可能消耗 Anlas。只有在用户明确要求时才使用，不要为了"效果更好"而主动调用。

## 模型

默认模型为 **V5 Full**（`nai-diffusion-5-full`）：数据集最全；理解自然语言与多语言提示词；最多 22 个角色、自由站位；可渲染英文、日文、中文文字（最多 750 字符）；支持透明背景；基础提示词上限约 1471 token。V5 **不支持** Vibe Transfer 与 Precise Reference；只有在用户需要参考图锁定角色或画风时，才显式切换到 `nai-diffusion-4-5-full`，并说明原因。V5 Curated 的局部重绘由 V4.5 Curated inpainting 执行。

## 画布（由你选择，必须在免费范围内）

| 场景 | 尺寸 |
| --- | --- |
| 人物立绘、单人、半身或全身（默认） | `832×1216` |
| 双人或多人同框、场景 CG、风景 | `1216×832` |
| 头像、对称构图 | `1024×1024` |
| 更修长的竖图或宽银幕横图 | `768×1344` / `1344×768` |

宽高必须是 64 的倍数，且宽 × 高 ≤ 1,048,576。画布比例本身会影响构图：竖图更容易出全身和高个角色，横图更适合多人并排。

## 提示词组织（官方推荐顺序）

```text
[数据集标签] , 人数 , 角色名 , 作品名 , 外貌 , 服装 , 表情动作 , 取景与视角 , 场景/时间/光线 , 媒介画风 , 复杂度
```

1. **数据集标签**（按需放在最开头）：`fur dataset`（兽人/Furry）、`background dataset`（无人物的写实风景、静物）。
2. **人数**：`1girl` / `1boy` / `1other` / `2girls` / `multiple girls`；单人加 `solo` 可减少背景杂人。
3. **角色与作品**：官方顺序为 `1girl, 角色名 (作品名), 作品名, 其他标签`；先用 `novelai_suggest_tags` 确认拼写。
4. **外貌**：发长（`short hair` … `very long hair`）+ 发型（`bob cut`、`twintails`、`swept bangs`、`ahoge`）+ 发色、瞳色、肤色、体型。
5. **服装逐部位写全并带颜色**（如 `blue witch hat, blue cape, white shirt, long sleeves, corset, leather belt, blue frilled skirt, black pantyhose, brown gloves, knee boots`）。官方教程证明：服装写得越完整，跨图一致性越好。
6. **表情、动作、姿势**；复杂互动、视线方向、因果关系用一两句**英文自然语言**补充。
7. **取景**（从近到远）：`close-up`、`portrait`、`upper body`、`cowboy shot`、`full body`、`wide shot`、`very wide shot`；**视角**：`from above`、`from below`、`from side`、`from behind`、`dutch angle`。
8. **场景**：地点、时间、天气、光线；需要有背景但不指定室内外时用 `location`。
9. **画风与媒介**：画师名、`watercolor`、`visual novel cg` 等。
10. **复杂度**（V5 专属）：`high complexity` 适合常规精美插画；`low complexity` 或 `ultra complexity` 适合风格化画面；`medium complexity` 介于两者之间。

V5 常用的专属标签：`visual novel sprite`（立绘）、`visual novel cg`（事件 CG）、`visual novel bg`（背景）、`visual novel chibi`、`visual novel art`、`depthness`（阴影更有层次）、`attractive male`、`meta:novel era` / `meta:golden era`（更复古或更现代）、`year 2014`（年代画风）。

权重：`{tag}` ×1.05、`[tag]` ÷1.05、`1.3::tag::` 数值权重。**负权重**适合精准去除或反转某个概念：`-1::hat::`（不够时用 `-3::hat::`）、`-1::monochrome::`、`-2.5::flat color::`、`-1::simple background::`。完整语法见 [references/prompt-syntax.md](references/prompt-syntax.md)。

## 多角色

- 人数标签写在基础 `prompt`（如 `2girls`）；每个角色写入 `characters`，以 `girl` / `boy` / `other` 开头，不写数量词。
- 不传坐标时，模型通常按角色顺序摆放（上→下、左→右）。传 `positions` 时，坐标应与角色顺序一致，并在基础提示词里用自然语言强化站位（如 `the black-haired girl on the left`）。
- 互动标签：`source#hug`（发起方）、`target#hug`（承受方）、`mutual#holding hands`（双方），不保证每次生效。
- 一个角色的特征串到另一个角色身上时，在后者的角色 `negative_prompt` 中排除该特征。

## 画面文字与台词

- 加上 `text` 和语言标签（`chinese text` / `english text` / `japanese text`），对白场景加 `speech bubble`；用自然语言说明谁在说、文字的位置和颜色。
- **中文台词**：直接在描述中写 `saying “早上好！”`，插件会自动转为 `Text:`。
- **英文、日文或需要精确控制时**：在基础 `prompt` 最末尾手写 `Text: 内容`，多段之间空一行。`Text:` 之后的任何内容都会被画成文字。
- 在自然语言里重复一遍文字内容，可以提高渲染可靠性。长度上限：V5 Full 750 字符，V5 Curated 374 字符，V4/V4.5 118 字符。
- 不要承诺长句拼写一次完全正确。

## 透明背景

V5 设置 `transparent_background: true` 即可（插件会追加官方标签与提示）。需要半透明效果（魔法、火焰、雨伞等）时，在提示词中加入 `alpha transparency` 或 `has alpha`；背景去不干净时可加强为 `2.1::transparent background::`。

## 角色一致性（RP / 连续剧情）

1. 首次出场时，按「外貌 + 逐部位服装」写出该角色的完整标签块，之后每次原样复用，只改表情、动作、场景和取景。
2. 角色更换服装时，同样一次写全新服装块，再固定复用。
3. 构图满意后保留 `seed`，用同一 seed 微调提示词。
4. 立绘表情差分：先用 `novelai_augment` 的 `emotion` 把立绘转成 neutral 表情，再以它为底生成其他表情（需要用户同意使用 Director Tools）。

## RP 每轮生图流程

1. 从本轮叙事中提取：在场角色（复用各自的标签块）、动作与表情、镜头与取景、地点、时间与光线、关键道具。
2. 单人立绘用 `832×1216` 加 `visual novel sprite` 或 `cowboy shot`；多人互动或事件场景用 `1216×832` 加 `visual novel cg`。
3. 有对白时把中文台词写在引号里，并加上 `speech bubble, text, chinese text`。
4. 生成后把图片嵌入叙事中合适的位置。

## 编辑与精修

- **img2img**（默认 `strength 0.7, noise 0.2`）：传 `image_path`，画布自动适配到免费范围。
- **Enhance**（默认 `strength 0.2, noise 0`）：官方建议先选定满意的构图，再用 Enhance 精修；可以在提示词里重复画面中被忽略的部分。
- **infill**：传 `image_path` 与 `mask_path`（白色重绘、黑色保留）；用户只说明要改的部位时，先按源图尺寸生成黑白蒙版。每次只修一处；蒙版外的内容渗入时扩大蒙版；`strength` 调低可以保留原有大致形状。
- **Vibe / Precise Reference**：仅限 V4.5（会消耗 Anlas）。Character Reference 最好使用干净背景、中性站姿的全身图，并在角落加一张脸部特写；多张角色参考会被融合成一个角色，不会被当作多个角色。

各工具的调用示例见 [references/tools.md](references/tools.md)。

## 交付与复核

把工具返回的 `images[].markdown` 原样嵌入回复正文（可以修改方括号内的说明文字）。路径都是本机真实文件，严禁编造链接或粘贴 Base64。用户只要提示词时直接给提示词，不调用生成工具。已提交的请求失败或超时时，如实说明错误，不要盲目重试。

嵌入图片不等于你已经看过画面。需要检查构图、手部或文字时，若环境提供 `read_image` 且当前模型支持视觉输入，先读取图片再下判断；没有读图就不要声称已核对细节。迭代时保留 `seed`、提示词和实际模型（都记录在同目录的 `generation.json` 中）。
