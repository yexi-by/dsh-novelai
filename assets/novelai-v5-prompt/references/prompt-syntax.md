# NovelAI V5 / V4.5 提示词语法参考

本参考基于 NovelAI 官方文档整理，适用于 `novelai-v5-prompt` Skill 在编写 V5、V4.5、V4 与 V3 图像提示词时查阅。

## 1. 标签与自然语言混排

NovelAI V5 同时理解 Danbooru 风格英文标签与自然语言句子（支持英文、日文等多语言）：

- **标签形式（精确控制属性与画风）**：
  ```text
  1girl, solo, silver hair, blue eyes, pleated skirt, sailor collar, city street, night, rain, neon lights, reflections, high complexity, very aesthetic, best quality
  ```
- **自然语言形式（空间方位、因果动作、分镜与文字描述）**：
  ```text
  A silver-haired girl stands under a transparent umbrella on a rain-soaked neon street at night, looking back over her shoulder at a glowing vending machine.
  ```
- **混合写法（V5 推荐）**：前段用精炼标签锁定人数、关键外观与媒介画风，中段用一两句自然语言交代复杂动作、视线或空间构图，末尾放复杂度与质量词（及可选 `Text:`）。不确定角色名、作品名或专有服装标签时，先调用 `novelai_suggest_tags` 查询官方词库。

## 2. 提示词推荐顺序

```text
[数据集前缀] , [人数/主体类别] , [角色/作品/外观细节] , [动作与互动] , [场景/背景/时间天气] , [镜头/构图/光影] , [媒介与画风] , [复杂度/质量/美学词]
```

- **数据集前缀**（仅需要特定风格领域时放在基础提示词最开头）：
  - `fur dataset`：兽人 / Furry 题材
  - `background dataset`：纯背景、建筑或无人物自然风光（常配合 `no humans`）
- V3 对词序敏感（越靠前权重越高）；V4+ / V5 对词序宽容度更高，但将核心主体放在前段仍有助于稳定构图。

## 3. 复杂度、质量与美学标签

### V5 复杂度标签
- `low complexity`：极简背景、留白、单色或轻插画风
- `high complexity`：常规精细插画推荐默认值
- `ultra complexity`：高密度建筑、繁复机械、大场景细节画面

### 质量梯度标签
- 正向常用：`best quality`、`amazing quality`、`great quality`
- 中性/特定质感：`normal quality`
- 负向排除：`bad quality`、`worst quality`

### 美学梯度标签
- 正向常用：`very aesthetic`、`aesthetic`
- 负向排除：`displeasing`、`very displeasing`

不要堆砌数十个同义质量词；两到三个质量/美学/复杂度词搭配具体光影与材质描述效果更稳。

## 4. 权重强化、弱化与负向权重

### 括号权重（全版本通用）
- `{...}`：每嵌套一层将词条权重乘以 `1.05`（如 `{{{watercolor}}}` ≈ 1.158x）
- `[...]`：每嵌套一层将词条权重除以 `1.05`（如 `[[depth of field]]` ≈ 0.907x）

### 数值权重（V4 / V4.5 / V5）
以 `数字::内容::` 形式书写，必须用裸 `::` 闭合：
```text
1girl, 1.4::rain, wet clothes::, 0.6::streetlights::, night
```
- `> 1` 强化，`< 1` 且 `> 0` 弱化；建议控制在 `0.4` 至 `1.8` 之间，过高易导致色彩过曝或纹理碎裂。

### 负向数值权重（V4.5 / V5）
支持在正向或角色提示词中使用负数权重精确抑制局部概念：
```text
1girl, witch, -1::hat::, -1::monochrome::
```

## 5. 负向提示词（`negative_prompt`）分层原则

按画面目标按需组合，避免无脑套用与用户意图冲突的词条：

- **基础画质与伪影排除（通用默认）**：
  ```text
  lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration
  ```
- **人体结构与版式杂项排除（人物图按需补充）**：
  ```text
  bad anatomy, bad hands, extra digits, fewer digits, multiple views, variant set, watermark, signature, username, logo
  ```
- **内容分级过滤词（仅当用户明确要求全年龄/过滤敏感内容时添加，切勿默认注入）**：
  ```text
  nsfw, explicit, rating:questionable, rating:sensitive
  ```
- **防冲突检查**：
  - 需要生成文字、海报标题或漫画对白时，检查并移除负向中的 `text`、`watermark`、`signature`。
  - 需要复古胶片、铅笔素描或颗粒感画风时，不要在负向中排除 `film grain` 或 `sketch`。

## 6. 多角色与站位互动（V4+ 最多 6 人，V5 最多 22 人）

使用 `novelai_generate` 的顶层 `characters` 数组，**不要**与旧版 `|` 文本分隔符混用：

- **基础 `prompt`**：声明总人数、公共环境与整体光影，例如：
  ```text
  2girls, indoor cafe, wooden table, afternoon sunlight, warm atmosphere, high complexity, very aesthetic, best quality
  ```
- **`characters` 数组**：每个元素描述单个角色，以 `girl`、`boy` 或 `other` 开头，**不写** `1girl` / `1boy` 数量词：
  - 角色 1：`girl, short black hair, blue eyes, white blouse, smiling, source#holding hands`
  - 角色 2：`girl, long blonde hair, green eyes, beige cardigan, blushing, target#holding hands`
- **角色互动标签**：
  - `source#<动作>`：动作发起方（如 `source#hug`、`source#kiss`、`source#feeding`、`source#patting`）
  - `target#<动作>`：动作承受方（如 `target#hug`、`target#kiss`、`target#feeding`、`target#patting`）
  - `mutual#<动作>`：双方互做（如 `mutual#hug`、`mutual#holding hands`、`mutual#eye contact`）
- **角色坐标（`positions` + `use_coords: true`）**：
  - `x`（左 `0` → 右 `1`）与 `y`（上 `0` → 下 `1`）指定角色主体中心点，例如左中 `{ "x": 0.28, "y": 0.55 }`、右中 `{ "x": 0.72, "y": 0.55 }`。
  - 每个角色也可单独设置 `negative_prompt`（如在戴帽角色与不戴帽角色同框时，给不戴帽角色单独填 `hat`）。

## 7. 文字渲染与漫画排版（V5）

V5 支持画面招牌、标题字与漫画气泡台词渲染：

1. 在基础提示词前中段加入文字相关标签与自然语言描述，例如 `text, english text, speech bubble`（或 `comic, 4koma`），并用句子指明是谁在说话、文字颜色或版面位置。
2. 在基础 `prompt` 的**最末尾**使用 `Text:` 声明精确文本：
   ```text
   1girl, solo, cafe apron, smiling, holding coffee cup, speech bubble, text, english text, high complexity, very aesthetic
   The girl holds up a steaming mug and greets the customer with a cheerful speech bubble.
   Text: Good morning!
   ```
3. 画面包含多处文字或多格对白时，每段 `Text:` 之间用**空行**分隔，单段长度建议不超过 120 个字符：
   ```text
   Text: Good morning!

   Text: Fresh coffee is ready.
   ```
4. 若极短单词未显示，检查 `negative_prompt` 是否误含 `text`，并可在 `parameters` 中设置 `"tag_hint_qt": 0` 关闭自动质量标签中的无字倾向。
