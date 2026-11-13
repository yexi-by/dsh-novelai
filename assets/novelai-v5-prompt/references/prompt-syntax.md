# NovelAI V5 提示词语法参考

依据 docs.novelai.net 官方文档（Tags、Strengthening & Weakening、Quality Tags、Undesired Content、Multi-Character、Text Rendering、Character Creation Tutorial）整理。

## 1. 标签与自然语言

V5 同时理解 Danbooru 风格的英文标签和自然语言（英文、日文及其他语言）。推荐**混合写法**：用标签精确锁定人数、外貌、服装、取景和画风，再用一两句英文句子交代动作、视线、空间关系和因果。

```text
1girl, solo, platinum blonde hair, bob cut, swept bangs, aqua eyes, blue witch hat, blue cape, white shirt, corset, cowboy shot, from side, forest path, dappled sunlight, high complexity
She glances back over her shoulder while holding a glowing lantern.
```

标签的官方推荐顺序为 `1boy, 1girl, 角色名, 作品名, 其余任意`。V3 越靠前的标签权重越高；V4 及以上对顺序更宽容，但把核心主体放在前面仍有助于构图稳定。

## 2. 特殊标签

| 类别 | 标签 | 说明 |
| --- | --- | --- |
| 质量 | `best quality` › `amazing quality` › `great quality` › `normal quality` › `bad quality` › `worst quality` | 插件已按设置自动追加，无需手写 |
| 美学 | `masterpiece`（V4.5+）、`top aesthetic`（V4+）、`very aesthetic`、`aesthetic`、`displeasing`、`very displeasing` | 同上 |
| 复杂度（仅 V5） | `low complexity`、`medium complexity`、`high complexity`、`ultra complexity` | 常规精美图用 high；风格化图用 low 或 ultra |
| 年代 | `year 2014` 等 | 让画风接近该年份的主流风格 |
| 数据集 | `fur dataset`（V4+）、`background dataset`（V4.5+） | 必须放在基础提示词最开头 |
| 透明（仅 V5） | `transparent background`、`has alpha`、`alpha transparency` | 背景透明用工具参数 `transparent_background`；半透明物体用 `alpha transparency` |
| V5 专属 | `depthness`、`attractive male`、`meta:novel era`、`meta:golden era`、`visual novel art`、`visual novel bg`、`visual novel cg`、`visual novel chibi`、`visual novel sprite` | 视觉小说风格非常适合 RP |
| 其他 | `location` | 等同于室内或室外，表示需要场景背景 |

**改名标签**（`|` 是分隔符，已不可用）：`v` → `peace sign`，`double v` → `double peace`，`|_|` → `bar eyes`，`\||/` → `open \m/`，`:|` / `;|` → `neutral face`，`eyepatch bikini` → `square bikini`，`tachi-e` → `character image`。

## 3. 角色外观标签速查（官方教程）

- **人数**：`1girl`、`1boy`、`1other`、`2girls` … `6+girls`、`multiple girls`；单人加 `solo`。
- **发长**：`very short hair`、`short hair`、`medium hair`、`long hair`、`very long hair`、`absurdly long hair`。
- **发型**：`bob cut`、`braid`、`french braid`、`ponytail`（`high ponytail` / `side ponytail`）、`twintails`、`half updo`；刘海：`blunt bangs`、`swept bangs`、`hair between eyes`、`hair over one eye`、`sidelocks`；头顶：`ahoge`、`hair pulled back`；质感：`curly hair`、`messy hair`、`straight hair`、`wavy hair`。
- **发色**：`black / blonde / platinum blonde / blue / brown / green / grey / orange / pink / purple / red / white hair`；复合发色：`multicolored hair`、`gradient hair`、`streaked hair`、`two-tone hair`、`colored inner hair`。
- **瞳色**：`aqua / blue / brown / green / grey / purple / red / yellow eyes`、`heterochromia`；瞳孔：`slit pupils`、`heart-shaped pupils`。不想要异色瞳时，在 UC 中加入 `heterochromia`。
- **肤色**：`pale skin`、`tan`、`dark skin`；多人时用 `dark-skinned female`；非自然肤色用 `colored skin` 加颜色。
- **面部**：`freckles`、`mole under eye`、`lipstick`、`scar on face`。
- **体型**：`skinny`、`petite`、`tall`、`curvy`、`plump`、`toned`、`muscular`、`flat chest` … `huge breasts`；画布越高，角色越显高。
- **取景**：`close-up` → `portrait` → `upper body` → `cowboy shot` → `feet out of frame` → `full body` → `wide shot` → `very wide shot`。注意 `boots` 之类的标签会暗示脚部出镜。
- **视角**：`facing viewer`、`from above`、`from below`、`from side`、`from behind`、`profile`、`dutch angle`、`upside-down`。
- **多视图**：`multiple views`、`turnaround`、`reference sheet`、`expressions`。

**一致性要点**：服装要按头饰、上衣、下装、腿部、鞋、手套、配饰逐项写出并带颜色；只写 `witch hat, robe` 这类笼统描述会每次都不一样。找到稳定的标签块后，跨图原样复用。

## 4. 强化、弱化与负权重

- `{tag}`：每层 ×1.05（`{{{tag}}}` ≈ 1.158）；`[tag]`：每层 ÷1.05。在 UC 中，`{}` 表示更强烈地避免。
- 数值权重（V4+）：`1.5::rain, night::`，用不带数字的 `::` 结束；`::` 也会关闭所有未配对的括号。
- **负权重**（V4.5+）：
  - 定向去除：`-1::hat::`，去不掉时用 `-3::hat::`。
  - 反转概念：`-1::monochrome::` 恢复色彩，`-2.5::flat color::` 或 `-6::simple illustration::` 增加细节，`-1::simple background::` 摆脱纯色背景。
  - 经验法则：负权重擅长定向去除和反转；UC 适合列出一长串需要整体回避的概念。

## 5. Undesired Content

插件会自动加上设置中的官方 UC 预设（默认 Heavy）。`negative_prompt` 只追加本图特有的排除项：

- 不想要的元素：`hat`、`glasses`、`extra people`；
- 伪影的连带抑制（官方示例：`freckles` 产生怪异斑点时，在 UC 中加入 `{{tattoo, facial mark}}`）；
- 需要文字时不要把 `text`、`speech bubble`、`signature` 放进 UC；需要颗粒或素描风时不要排除 `film grain`、`sketch`；
- 除非用户明确要求，不要加入 `nsfw`、`rating:*` 之类的分级词。

## 6. 多角色（V5 最多 22 人，V4/V4.5 最多 6 人）

- 基础 `prompt`：人数标签、公共场景、光线、画风，以及描述站位和互动的自然语言。
- `characters[]`：每人一个，以 `girl` / `boy` / `other` 开头，**不写**数量词。
- 不传坐标时按角色顺序摆放（上→下、左→右）；配合 `side-by-side` 时，第一个角色通常在左边。
- `positions`：`x` 0（左）→ 1（右），`y` 0（上）→ 1（下）。V5 可自由定位；V4/V4.5 会被吸附到 5×5 网格（0.1/0.3/0.5/0.7/0.9）。坐标顺序应与角色顺序一致，并用自然语言强化。坐标也可以用来定位物体。
- 互动：`source#<动作>`、`target#<动作>`、`mutual#<动作>`（如 `hug`、`kiss`、`holding hands`、`pointing`、`feeding`、`patting`）。
- 串味：在受影响角色的 `negative_prompt` 中排除该特征。
- 使用 `characters` 时不要再用 `|` 分隔语法。

## 7. 文字渲染（V5：英文、日文、中文）

1. 在提示词中加入 `text` 与语言标签，对白加 `speech bubble`，漫画加 `comic` / `4koma`；用自然语言描述谁在说、文字颜色和位置（官方示例：`The blonde girl is excitedly asking "…" in yellow text`）。
2. **中文台词**：写在 `“…”` 或 `「…」` 中即可，插件按官网 autoText 规则收集基础提示词与角色提示词中的中文引号内容（有坐标时按阅读顺序排列），追加为 `Text:` 段。
3. **英文、日文或需要精确控制**：在基础 `prompt` **最末尾**手写：
   ```text
   2girls, text, english text, speech bubble, park, cowboy shot. The blonde girl asks "Ready?" and the other answers "Always."
   Text: Ready?

   Always.
   ```
   `Text:` 必须放在最后，否则之后的标签也会被画成文字；多段文字之间空一行。`Text:` 也可以写在角色提示词里，但放在基础提示词最可靠。
4. 长度上限：V5 Full 750 字符，V5 Curated 374 字符，V4/V4.5 118 字符（仅英文）。
5. 含 `Text:` 时插件会自动从质量标签中去掉 `no text`；如果短文字仍不出现，可以把质量标签预设切换为"不追加"。
