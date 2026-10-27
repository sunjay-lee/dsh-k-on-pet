# dsh-k-on-pet

把《轻音少女》的五位角色请进 **DeepSeek Harness** 的 Web 界面：任意方位走动、出界回绕、
待机/单击/双击各有动作，茶桌可以拖动，角色在外溜达久了会自己走回座位。

素材取自 2012 年原版 Windows 桌宠《轻音! DTA》，行为按原版录像逐行校对。

![预览](docs/preview.png)

## 特性

- **五名角色**：平泽唯 / 秋山澪 / 田井中律 / 琴吹䌷 / 中野梓，可单选或全开
- **任意方位行走**：朝任意角度走，四边都能出界回绕（往下走没了从上面下来）
- **待机**：每个角色自己的原地小动作（张手晃、站立、闭眼唱……）
- **单击**：随机播该角色的反应动作，3 秒后恢复
- **双击**：跳舞，跳完回待机，1.5–3.5 秒后自己走起来
- **拖拽 / 甩出**：拎起、抛物线、落地弹跳，位置自动记忆
- **茶桌**：默认停在输入框上方，可拖动、可固定；把角色拖到桌上会自动入座
- **自动回位**：角色在外溜达超过设定时长，会自己走到座位坐下（时长可调，0 = 关闭）
- **语音**：点击/双击播放原版语音，可静音
- **关怀提醒**：每 50 分钟提醒喝水/起身；闲置 4 分钟打瞌睡
- **不挡操作**：只有宠物本体接收指针事件，其余区域点击穿透
- **本地存储**：偏好存在浏览器 `localStorage`，支持导出/导入 JSON

## 安装

要求：DSH `0.2.x` 的 **Web** profile（桌面端或 `dsh web`）。

### 方式一：从 GitHub 安装

```bash
dsh plugin --profile web add github:<你的用户名>/dsh-k-on-pet
```

装完把 `"dsh-k-on-pet"` 加进 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles`，重启 DSH。

> 桌面端用的是 `desktop` profile，把命令里的 `web` 换成 `desktop` 即可。

### 方式二：本地目录安装

```bash
git clone https://github.com/<你的用户名>/dsh-k-on-pet.git
dsh plugin --profile web add file:<仓库绝对路径>
```

同样需要把包名加进 `dsh.profile.bundles`，然后重启。

## 设置

`设置 → K-ON! 桌宠`：

| 分组 | 项 | 说明 |
| --- | --- | --- |
| 显示角色 | 五人开关 / 全部显示 / 全部隐藏 | 可同时显示，各自独立坐标 |
| 桌子 | 显示桌子 | 茶桌开关；关掉同时清空座位 |
| | 自动回位 | 0–30 分钟；在外超过这个时长会自己走回座位，0 = 不回位 |
| | 重置桌子位置 | 桌子回到默认位置并清空座位 |
| 外观与行为 | 大小 | 1.0–2.4×，统一缩放 |
| | 语音 | 点击/双击是否播放原版语音 |
| | 随机闲聊 | 待机时每 2.5–5 分钟说一句 |
| | 溜达 | 是否自己走动（待机 2–5 秒就走） |
| | 朝向反转 | 走路时脸和前进方向相反就打开，切换左右步态素材 |
| | 关怀提醒 | 每 50 分钟提醒喝水/休息 |
| 备份与恢复 | 导出 / 导入 | 偏好存为 JSON，可跨浏览器迁移 |
| 位置与重置 | 初始化 | 清空位置、座位、桌子位置，朝向复位，运行状态归零 |
| | 重置所有位置 | 只清坐标 |
| | 恢复默认设置 | 回到只显示唯、1.5×、右下角 |

右键角色：隐藏这只 / 回到右下角。

## 工作原理

- **宿主半**（`lib/index.js`）：把 `assets/` 挂到只读路由 `/dsh-k-on-pet/*`，`GET/HEAD`，
  做了 `resolve` + `startsWith` 的目录穿越防护，不读写工作区、不联网。
- **浏览器半**（`lib/client.js`）：通过 `shell.overlay` 挂浮层、`settings.section` 挂设置页；
  每个角色一块 Canvas，自绘精灵图；所有角色共享一条 `requestAnimationFrame` 时间线。
- **纯逻辑**（`src/core.cjs`）：走路规划、出界回绕、抛物线物理、设置归一化、动画帧推进都放在这里，
  可以在 Node 里直接单测，不依赖 DOM。

## 目录结构

```text
dsh-k-on-pet/
├── package.json          # DSH bundle patch + 客户端注入声明
├── cordis.patch.yml      # 把插件挂进 profile
├── src/
│   ├── core.cjs          # 纯逻辑：走路/回绕/物理/设置
│   └── client.js         # 浏览器半：React 浮层 + Canvas + WebAudio
├── lib/
│   ├── index.js          # 宿主半：只读静态资源路由
│   ├── client.js         # 由 scripts/build-client.mjs 生成，勿手改
│   └── types/            # 类型声明
├── assets/
│   ├── characters/       # 5 套图集 + meta.json（含 actions 行号表）+ 语音
│   └── table/            # 茶桌与坐姿
├── scripts/
│   ├── build-client.mjs  # 把 core.cjs 内联进 lib/client.js
│   └── check.mjs         # 静态自检
└── test/
    └── core.test.mjs     # 纯逻辑单测（node:test）
```

## 开发

```bash
npm run build        # 重建 lib/client.js（改完 src/ 必须跑）
npm run check        # 静态自检：清单、素材、行号、构建同步
npm run test:unit    # 纯逻辑单测
npm test             # build + check + 单测
```

改了 `src/` 却忘了 `npm run build`，DSH 读到的还是旧的 `lib/client.js` —— 自检会直接报错。

## 兼容性

| 项 | 说明 |
| --- | --- |
| DSH | `0.2.0-rc.1` / `0.2.0-rc.2` / `0.2.1-rc.2` |
| profile | `web`（桌面端或浏览器） |
| 平台 | 依赖 Canvas 2D、WebAudio、Pointer Events、`localStorage` |
| 不适用 | TUI / headless profile |

## 已知限制

- 角色只朝**左右**两套步态，斜走/上下走时按水平分量选边，接近竖直时沿用上一次朝向
- 回位是直线走，不做寻路，可能贴着桌边穿过
- 茶桌的座位顺序固定：澪、律、唯、䌷、梓
- 素材版权状态见 `THIRD_PARTY_NOTICES.md`，不可商用

## 版权

- 代码：MIT，见 `LICENSE`
- 角色图像、语音、茶桌：**不属于 MIT**，详见 `THIRD_PARTY_NOTICES.md`

本项目是非官方同人作品，与京都动画、芳文社、原作者及原版程序作者均无关联。
