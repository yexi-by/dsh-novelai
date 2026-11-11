# dsh-novelai

用于 DeepSeek Harness 的 NovelAI 图像生成与编辑插件，支持 Web 和 Desktop。

## 安装

需要 Node.js >=24.5.0 和 DSH >=0.2.0-rc.2 <0.2.3-0。

    dsh plugin --profile web add github:yexi-by/dsh-novelai#v0.1.0

桌面端使用客户端内置 CLI，将 --profile web 改为 --profile desktop。安装后重启 DSH，在插件设置中填写 NovelAI Persistent API Token。

## 使用

直接让 Agent 使用 NovelAI 生成或编辑图片。插件随附提示词 Skill，生成结果可显示在回复正文中。

| 工具 | 功能 |
| --- | --- |
| novelai_generate | 文生图、图生图、局部重绘、Enhance、多角色、Vibe Transfer、Precise Reference、透明图和多图 |
| novelai_augment | Director Tools：背景移除、线稿、草图、上色、表情修改和清理杂物 |
| novelai_upscale | 2 倍放大 |
| novelai_encode_vibe | Vibe 编码与缓存 |
| novelai_suggest_tags | 标签建议 |
| novelai_account | 查询订阅、V5 血条与 Anlas 余额 |
| novelai_capabilities | 查询模型能力和可用参数 |

支持 V5、V4.5、V4 和 V3。各模型开放的功能不同，可通过 novelai_capabilities 查询。

插件设置可调整默认模型、生成步数（默认 28）、输出目录和请求超时。图片默认保存在当前会话工作目录的 novelai-output/ 下。首页和生图会话显示 V5 血条与剩余点数。

## 许可证

[MIT](LICENSE)
