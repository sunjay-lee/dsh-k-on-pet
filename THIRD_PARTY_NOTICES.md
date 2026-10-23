# Third-party notices

`dsh-k-on-pet` 的**代码**以 MIT 发布。以下内容不属于 MIT 授权范围。

## 1. 角色图像与语音（非 MIT）

| 内容 | 文件 | 来源 | 权利状态 |
| --- | --- | --- | --- |
| 5 张角色精灵图集 | `assets/characters/{yui,mio,ritsu,tsumugi,azusa}/sheet.png` | 原版 Windows 桌宠 `k-on-pet` 的 `Mascot*.arc` 资源包，经 `.el` 解码重建 | 版权归原作者及《K-ON!》相关权利方；原分发未见明确再分发许可 |
| 每帧包围盒 / 动作分组 | `assets/characters/*/meta.json` | 由上述图集计算、按原版动作行分组 | 事实性数据；随图集一并提供 |
| 137 条语音 | `assets/characters/*/voices/*.mp3` | 原版 `k-on-pet` 资源包内 WAV，转码为单声道 MP3 | 同上；语音表演者与录音权利方未单独授权 |
| 茶桌与五人坐姿 | `assets/table/*.png`（`desk00.png`、`desk01.png`、`*-frames.png`、`*.png`、`notes.png`、`yui-dance.png`） | 原版 `MascotTable.exe` 的 `MascotTable_d` 资源，以及 `main.sd` 中的图层/座位数据；经 `.el` 解码、翻转、裁切与 4×2 拼表 | 版权归原作者及《K-ON!》相关权利方；原分发未见明确再分发许可 |
| 茶桌座位/图层数据 | `assets/table/characters.json` | 从 `main.sd` 还原的座位顺序、桌宽、帧宽/帧数与动画帧列表 | 事实性数据；随茶桌素材一并提供 |
| 插件图标 | `assets/icon.png` | 从 `assets/characters/yui/sheet.png` 的待机帧裁切、缩放并加圆角底 | 同角色图像；不属于 MIT |
| README 截图 | `docs/*.png`（`preview.png`、`in-dsh.png`、`in-dsh-settings.png`、`table.png`、`settings.png`） | 插件在 DSH / 本地夹具中的实际渲染截图，画面含上述角色与茶桌素材 | 截图本身由本项目制作，但画面中的角色/茶桌素材权利状态同上；不属于 MIT |

角色名称「平泽唯」「秋山澪」「田井中律」「琴吹䌷」「中野梓」及《K-ON! 轻音少女》相关名称、形象，版权归
Kakifly / 芳文社 / 京都动画及各自权利方所有。本项目是**非官方同人移植**，与上述权利方无关联，也未获其背书。

原版程序为 Windows 免费桌宠，分发目录中未附带 LICENSE / README 授权文本。因此本仓库不把这些资产视为
可自由再分发；它们随插件提供，仅用于**个人学习、同人欣赏**。如需商用、公开再分发或二次创作，请自行联系
权利方取得授权。

权利方若要求下架，请开 issue 或联系维护者；维护者会删除对应资产或整包，不做额外争辩。

## 2. 反向工程说明

图集、茶桌与语音由 `scripts/extract-el.py` 等脚本从原版资源容器中解码：

- `ARCC` 容器：文件表 + 偏移表；
- `ELSC` 图像：调色板 + RLE + 水平/垂直 delta 滤波；
- 茶桌：从 `MascotTable.exe` / `MascotTable_d` 解出 `desk00`、`desk01`、五人坐姿与音符，按 `main.sd` 的座位顺序重排；坐姿动画按 4 列 × 2 行切片，仅保留有效帧；
- 语音：容器内 WAV，转码为 MP3 以减小体积。

这些脚本只包含格式解析、图像翻转/裁切与拼表逻辑，不包含原版可执行代码。原版 `.exe` / `.arc` / `.sd` 未收录在本仓库。

## 3. 运行时依赖（不随包捆绑）

插件把以下包声明为 peer dependency，由 DSH profile 提供，不复制其源码：

| 包 | 许可证 | 用途 |
| --- | --- | --- |
| `@deepseek-ai/dsh`（含 `dsh-client-ui-layout`、`dsh-host-webserver`） | MIT | 插件宿主、`shell.overlay` 槽位、静态路由 API |
| `@deepseek-ai/cordis` | MIT | 插件上下文类型 |
| `react` / `react-dom` | MIT | 客户端浮层渲染（由 DSH 提供） |

### 测试夹具中的 React UMD

`test/vendor/react.production.min.js` 与 `test/vendor/react-dom.production.min.js` 是
React / ReactDOM 18.3.1 的 UMD 生产构建，版权归 Meta Platforms, Inc. 及其关联方，
以 MIT 授权。它们只被 `test/harness.html` 和 `scripts/smoke.mjs` 使用，不进入插件运行时；
版本、来源与 SHA-256 见 `test/vendor/README.md`。

## 4. 实现参考

槽位注册与 profile bundle 的写法参考了 DSH 自带客户端插件以及已安装的 `dsh-pet` 的公开 API 用法；
未复制其源代码。`dsh-pet` 以 MIT 发布，特此致谢。

## 5. 开发工具（不随包分发）

- Node.js（MIT 等）用于自检与冒烟测试；
- Python 3 + Pillow（HPND）用于图集解码与 bbox 计算；
- FFmpeg（LGPL/GPL，视构建而定）用于 WAV → MP3 转码；
- Chromium / Google Chrome 用于无头冒烟测试。

这些工具只在开发时使用，不进入 npm 包。
