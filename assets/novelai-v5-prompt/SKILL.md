---
name: novelai-v5-prompt
description: 使用 NovelAI 生成或编辑图片，编写 V5 标签与自然语言提示词、多角色与文字漫画提示词，并调用 DSH NovelAI 工具完成图生图、局部重绘、参考图、Director Tools、放大和正文插图。
---

# NovelAI 绘图与编辑

将用户的视觉需求转为 NovelAI 提示词，通过已安装的 `novelai_*` 工具生成或编辑真实图片，再把返回的图片插入回复正文。提示词写作参考 cheng1559/novelai-agent 的 novelai-v5-prompt；这里的执行流程适配 DSH。

## 默认使用工具配置

普通文生图使用插件默认配置，优先只传 `prompt`，按画面内容需要补充 `negative_prompt` 或 `characters`。省略 `model`、`action` 和 `parameters`，让工具填入默认值，无需把默认参数手写一遍。

只有用户提出特殊要求时才覆盖相关字段，例如横竖画幅、指定尺寸、多张图片、固定 seed、指定模型、参考图或编辑任务。其余参数继续省略。专注调整提示词，不因节省额度或自行追求画质而主动改变尺寸、步数、CFG、采样器、模型或开启放大。

默认配置为 V5 Full、1024×1024、28 steps、scale 6、单张、随机 seed，采样器为 k_euler_ancestral、噪声调度为 Karras；用户在插件设置中选择的模型优先。不为普通生图预查 Opus 使用条、等待其恢复或自动切换模型；用户要求查询账户时再使用 `novelai_account`。

## 选择工具与模型

- `novelai_generate`：文生图、`img2img`、`infill` 局部重绘、`enhance` 提示词引导增强；支持多角色与坐标、参考图及完整官方生成参数。
- `novelai_augment`：Director Tools 的背景移除、线稿、草图、上色、表情和清理杂物。
- `novelai_upscale`：独立 4 倍放大。需要根据提示词重画细节时使用 `enhance`。
- `novelai_encode_vibe`：编码并缓存 Vibe；复用返回的 `encoding_path` 可避免重复编码费用。
- `novelai_suggest_tags`：查询官方标签建议。
- `novelai_account`：查看订阅、Anlas 与使用限额。
- `novelai_capabilities`：查看模型能力；`include_parameters: true` 返回完整官方参数定义。

默认模型由插件设置决定。V5 Full/Curated 适合自然语言、多角色、文字、漫画和透明图片；V4.5 支持 Precise Reference；V4/V4.5/V3 支持 Vibe Transfer。V5 尚不支持 Vibe Transfer、Precise Reference、SMEA、Decrisper、Variety+ 与 ControlNet。需要更换模型才能满足用户要求时，说明选择原因，不把忽略参数当作功能成功。

Vibe Transfer 与 Precise Reference 当前不能同时使用。V5 Curated 的局部重绘由服务端当前支持的 V4.5 Curated inpainting 模型完成，工具结果会给出实际模型。V5 能使用约 22 个角色提示词；V4/V4.5 最多 6 个。使用特殊能力前查询工具当前提供的能力信息，避免依赖早期版本传闻。

## 提示词组织

先确定主体、构图、动作、镜头、光线和风格。精确外观用已知标签；复杂空间关系、对话和分镜用自然语言。V5 可组合标签与自然语言，并支持日语等多语言；选择能清晰表达用户意图的语言。

基础提示词包含主体数量、主体动作、场景、构图、媒介风格与适量质量/复杂度词。`fur dataset` 或 `background dataset` 需要时放最前。常规精细画面可使用 `high complexity`；低复杂度和极复杂画面按需求选择。

`{...}` 增强，`[...]` 减弱；`1.3::rain::` 是显式权重，`-1::hat::` 是负向权重。不要用互相矛盾的大量质量词代替具体描述。完整语法、示例和多角色交互标签见 [references/prompt-syntax.md](references/prompt-syntax.md)。

负向提示词放到 `negative_prompt`；按画面意图选择伪影、手部、杂物等排除项，不机械添加会排除用户所需内容的词。

多角色时，主体数量写入基础 `prompt`，每个角色独立写到 `characters`，角色提示词使用 `girl`/`boy`/`other`，不重复数量。各角色可以有自己的负向提示词和多个位置；使用坐标时 `x/y` 均为 0..1。不把角色框与 `|` 分隔语法混用。互动可使用 `source#hug`、`target#hug`、`mutual#hug` 等标签。

文字生成时，描述语言、文字内容与位置，把 `Text: ...` 放在基础提示词末尾；多段文字用空行分开。短文字不出现时，检查负向中的 `text` 和自动质量提示中的 `no text`；必要时将 `parameters.tag_hint_qt` 设为 0。不要承诺文字拼写或角色一致性必然准确。

## 参数与参考图

常用参数放在 `parameters`，如 `width`、`height`、`steps`、`scale`、`sampler`、`seed`、`n_samples`、`strength`、`noise`、`cfg_rescale`、`straight_alpha`、`upscale`。完整字段由官方 schema 提供，见 `novelai_capabilities`。这些是图像扩散参数，与聊天模型的生成参数无关。

普通文生图省略 `parameters`，使用上述默认配置。带源图的编辑任务默认沿用源图尺寸并对齐 64。只有用户要求特定画幅或尺寸时才填写 width/height；尺寸为 64 的倍数，常用竖图为 832×1216，横图为 1216×832。只有用户要求多图、固定 seed 或调整生成设置时才填写对应参数。

- 图生图和 Enhance：指定 `image_path`，默认 strength/noise 由工具提供；用户要求特定改动程度时再覆盖。Enhance 默认 strength 为 0.2，noise 为 0。
- 局部重绘：指定 `image_path` 和 `mask_path`；白色区域重绘、黑色保留，蒙版与源图对应。扩图可先准备扩展画布和蒙版，再使用同一 infill 流程。
- Vibe：在 `vibes` 中提供 `image_path` 或既有 `encoding_path`，strength/information_extracted 默认省略，用户有对应要求时再设置。V4+ 首次编码需要付费，插件按内容与设置缓存；更改提取参数会形成新编码。
- Precise Reference：在 `references` 中提供图像路径和需要的 `type`（character/style/character&style），fidelity/strength 默认省略。插件负责适配官方参考画布。只用于支持的 V4.5 模型。
- 控制图、旧模型专用参数及精确 API caption 可通过完整 `parameters` 对象使用；二进制字段需提供 Base64，普通图片输入优先使用路径字段。

具体调用示例与模型限制见 [references/tools.md](references/tools.md)。

## 图片交付

调用成功后读取返回的 `images`、`markdown`、`seed` 与 `metadata_path`。将返回的 Markdown 原样放入回复适当位置，可修改图片说明文字。多图按内容组织，可以与说明或故事段落交错。路径是 DSH Host 上真实保存的文件，不编造下载地址，也不把 API Base64 写入正文。

当用户只要求提示词时直接提供提示词，不调用付费生成。当用户要求生成或编辑图片时执行相应工具。一次请求失败或状态不明时说明情况；不要无条件反复重试已经提交的付费请求。

正文能够展示图片不代表当前聊天模型能看见它。需要视觉评估时使用当前环境实际可用的读图能力；没有读图结果时不声称已经检查具体画面。复现和迭代时保留 seed、提示词与实际模型，图片旁的 generation.json 保存了这些信息。
