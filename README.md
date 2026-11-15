# dsh-novelai

用于 DeepSeek Harness（DSH）的 NovelAI 图像生成与编辑插件，支持 Web 和 Desktop。

## 安装

使用 Desktop `0.2.1-rc.5` 或官方发布 tag `dsh-v0.2.2-rc.3` 时，请在对应 profile 的 `cordis.patch.yml` 给 `connection` 行补充以下依赖，已有配置保留在同一行。

```yaml
- id: connection
  inject: [webStartup, webServer]
```

需要 Node.js `>=24.5.0`、DSH `>=0.2.0-rc.2 <0.2.3-0`。

```sh
dsh plugin --profile web add github:yexi-by/dsh-novelai#v0.2.1
```

桌面端使用客户端内置 CLI，将 `--profile web` 改为 `--profile desktop`；本地目录安装可将包地址换为 `file:D:/work/dsh/plugin/novelai`。安装后重启 DSH，在「设置 → 插件 → NovelAI 生图」中保存 NovelAI Persistent API Token（或设置环境变量 `NOVELAI_API_TOKEN`）。

## 使用

直接让 Agent 使用 NovelAI 生成或编辑图片。插件随附按官方指南编写的 `novelai-v5-prompt` Skill，生成图片可嵌入回复正文，并在同目录写入脱敏后的 `generation.json` 元数据。

| 工具 | 功能 |
| --- | --- |
| `novelai_generate` | 文生图、图生图（`img2img`）、局部重绘（`infill`）、细节增强（`enhance`）、多角色与站位、透明背景、Vibe Transfer、Precise Reference |
| `novelai_augment` | Director Tools：背景移除、线稿、草图、上色、表情修改和清理杂物 |
| `novelai_upscale` | 2 倍放大（宽高各 ×2，不做扩散重绘） |
| `novelai_encode_vibe` | V4/V4.5 Vibe 编码与本机缓存复用 |
| `novelai_suggest_tags` | 官方标签建议与模型认知度查询 |
| `novelai_account` | 查询订阅档位、V5 血条与 Anlas 余额 |
| `novelai_capabilities` | 查询模型能力、当前生成设置与免费范围 |

支持 V5（默认 `nai-diffusion-5-full`）、V4.5、V4 和 V3；局部重绘自动切换到对应 `-inpainting` 模型。各模型开放能力可通过 `novelai_capabilities` 查询。

## 设置与免费范围

插件设置页可配置默认模型、输出目录（默认会话工作目录下的 `novelai-output/`，遵守会话 `sandboxPolicy`）、请求超时（默认 `300` 秒），以及对所有生图请求统一生效的生成配置（Agent 无法修改，默认值对齐 NovelAI 官网）：

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| 采样器 | `Euler Ancestral` | 可选 `Euler Ancestral`、`DPM++ 2M`、`Euler`、`DPM++ 2S Ancestral`、`DPM++ SDE`、`DPM2`；V5 不发送噪声调度，旧模型按采样器自动推导 |
| 生成步数 | `23` | `1..28`（Opus 免费上限 28 步） |
| Prompt Guidance / Rescale | `7` / `0` | CFG 范围 `0..10`，Rescale 范围 `0..1` |
| 质量标签 | `Standard` | 可选 `Standard` / `Light` / 不追加；追加在基础提示词末尾、`Text:` 段之前，画面含文字时自动去掉 `no text` |
| 负面预设 | `Heavy` | 可选 `Heavy` / `Light` / `Human Focus` / `Furry Focus` / 不使用；作为负向提示词前缀 |
| 中文台词转文字 | 开启 | V5 下自动提取提示词中 `“…”`、`「…」` 内的中文（有坐标时按阅读顺序排列），追加为 `Text:` 段 |

`novelai_generate` 固定单次生成 1 张，画布宽高为 64 的倍数且面积不超过 `1024×1024`（默认 `832×1216`，具体比例由 Agent 按场景选择；图生图/重绘源图自动等比缩放适配），始终处于 Opus 免费生图范围内。Precise Reference、Vibe 新编码、Director Tools 与 2 倍放大按官网规则消耗 Anlas。首页与执行过生图工具的会话会在输入框上方展示 V5 血条与剩余点数。

## 开发与验证

```sh
pnpm install
pnpm check
```

## 许可证

[MIT](LICENSE)
