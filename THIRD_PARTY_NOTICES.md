# Third-party notices

本仓库的**代码**以 MIT 发布（见 `LICENSE`）。以下内容**不属于** MIT 授权范围。

## 1. 角色图像、语音与茶桌素材（非 MIT）

| 内容 | 文件 | 来源 | 权利状态 |
| --- | --- | --- | --- |
| 5 套角色图集 | `assets/characters/{yui,mio,ritsu,tsumugi,azusa}/sheet.png` | 原版 Windows 桌宠《轻音! DTA》（ELEMENTAL SOFT，2012 年发布）各 `Mascot*.exe` 内嵌的 `*01.el` 图集，按 EL01 容器格式解码重建 | 版权归原作者及《轻音少女》相关权利方所有，原分发未见明确再分发许可 |
| 每格包围盒 / 动作行 | `assets/characters/*/meta.json` | 由上述图集计算，`actions` 字段记录每个动作用第几行 | 事实性数据，随图集提供 |
| 语音 | `assets/characters/*/voices/*.mp3` | 原版程序 `voice/*.wav`，转码为单声道 MP3 | 同上；表演者与录音权利方未单独授权 |
| 茶桌与五人坐姿 | `assets/table/*.png` | 原版 `MascotTable.exe` 的解包资源 | 同上 |
| 插件图标 | `assets/icon.png` | 由唯的图集裁切、缩放并加圆角底 | 同角色图像 |

角色名称「平泽唯」「秋山澪」「田井中律」「琴吹䌷」「中野梓」及《轻音少女》相关名称、形象，
版权归 Kakifly / 芳文社 / 京都动画及各自权利方所有。

本项目是**非官方同人移植**，与上述权利方无关联，也未获其背书。素材仅用于**个人学习与同人欣赏**；
如需商用、公开再分发或二次创作，请自行取得授权。权利方若要求下架，维护者会删除对应素材或整包。

## 2. 素材是怎么来的

1. 从原版安装包中取出各 `Mascot*.exe`；
2. 解析 PE 资源的 `ARCHIVEX` 项，得到 `IDX2` 容器；
3. 从容器里取出 `*01.el`（EL01 格式：RGB 子图 + Alpha 子图，RLE 压缩 + 横/纵 delta 滤波），
   解码后竖直翻转（扫描线自下而上存储）；
4. 按 96×96 网格切成图集；䌷与梓的原始单元格为 112 宽，居中裁到 96；
5. 原版行为（哪一行是待机、哪一行是左右步态、点击/双击播什么）由人工逐行比对原版录像确认，
   记录在 `meta.json` 的 `actions` 里。

仓库**不包含**原版可执行文件、`ARCHIVEX` 容器、`.el`/`.sd` 素材，也不包含原版代码。

## 3. 运行时依赖

以下依赖由 DSH profile 提供，不随本仓库捆绑：

| 包 | 许可 | 用途 |
| --- | --- | --- |
| `@deepseek-ai/dsh`（含 `dsh-client-ui-layout`、`dsh-host-webserver`） | MIT | 插件宿主、`shell.overlay` 槽位、静态路由 API |
| `@deepseek-ai/cordis` | MIT | 插件上下文 |
| `react` / `react-dom` | MIT | 浮层渲染（由 DSH 提供） |
