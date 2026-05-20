# Lithium Design Spec — v1.1 (normalized)

> Figma 端规范化的设计体系。代码现状（v1.0）→ Figma 规范（v1.1）的映射记录在 [§9](#9-代码--figma-映射表)。

---

## §0 文档说明

| 字段 | 值 |
|---|---|
| 规格版本 | `1.1.0 (normalized)` |
| 上一版本 | `1.0.0 (code-exact)` — 见 git 历史 / §9 映射表 |
| 对应代码 | `commit 0071ac7` (main) — 本期**代码侧不动**，仅 Figma 规范化 |
| 项目 | [Lithium](https://github.com/fank040118/Lithium) — Chrome/Firefox MV3 新标签页扩展 |
| **Figma 文件** | [Lithium Design System](https://www.figma.com/design/3Xg7SoouWETqkML24ZR5Jc) — file_key `3Xg7SoouWETqkML24ZR5Jc`（建议在 Figma UI 里把文件名改为 `Lithium Design System v1.1.0`） |
| 阅读对象 | 设计师 / AI 协作者 / 后续做"代码 token 收敛 PR"的前端开发者 |
| 单位约定 | 全部按 px。所有 token 值已按 4px 步长规范化 |
| 范围 | 仅深色单主题；不含 UI 视觉升级、浅色模式、Code Connect |
| Figma 落地状态 | ✅ **重构后 7 个干净页面**：00 Cover / 01 Foundations / **02 Components (合并 atoms+composites+icons+states，27 master)** / 03 Dialogs / **04 Pages (16 frame 全部含完整 home base)** / 05 Patterns / 06 Changelog · 127 Variables · 8 Text Styles · 11 Effect Styles · 10 Icon components · 9 Atoms · 8 Composites (含 sidebar 3-state / clock 2-count) · 16 Page mockups |
| 与代码的差异 | 代码侧仍是 v1.0 的散乱值。要把代码对齐到 v1.1，参考 [§9 映射表](#9-代码--figma-映射表) 单独开 PR |

---

## §1 设计目标与原则

1. **深色毛玻璃为底色** — 卡片用半透明黑 + `backdrop-filter: blur()`，叠加在用户壁纸或装饰球之上。
2. **内容优先** — 时钟 / 搜索 / 网格三件套居中放置，侧栏默认收起到 16 px 露边（v1.0 是 18 px，规范化到 4 的倍数）。
3. **单主题、单 mode** — 当前仅深色；Figma Variables 仍预留空 `Light` mode 占位。
4. **规范化** — 全部 token 走严格阶梯：spacing 4 px 步长、type scale 1.25 倍比、6 档 radius、5 档 elevation、6 档 black-alpha、6 档 white-alpha。
5. **可追溯** — 任何 token 都能在 [§9 映射表](#9-代码--figma-映射表) 找到代码侧对应的原始值。

---

## §2 Foundations

### 2.1 Color

#### 2.1.1 Primitive — 36 个（v1.0 是 58）

**Brand 系（Tailwind 标准阶梯）**

| Token | Value |
|---|---|
| `color/blue/400` | `#60a5fa` |
| `color/blue/500` | `#3b82f6` |
| `color/blue/600` | `#2563eb` |
| `color/blue/900` | `#1e3a8a` |
| `color/purple/600` | `#9333ea` |
| `color/red/400` | `#f87171` |
| `color/red/500` | `#ef4444` |
| `color/red/600` | `#dc2626` |
| `color/slate/200` | `#e2e8f0` |
| `color/slate/300` | `#cbd5e1` |
| `color/slate/400` | `#94a3b8` |
| `color/slate/500` | `#64748b` |
| `color/slate/600` | `#475569` |
| `color/slate/900` | `#0f172a` |
| `color/white` | `#ffffff` |
| `color/black` | `#000000` |

**Black Alpha 6 档**（v1.0 是 13 档，→ §9 映射）

| Token | Value |
|---|---|
| `color/black-alpha/05` | `rgba(0,0,0,0.05)` |
| `color/black-alpha/20` | `rgba(0,0,0,0.20)` |
| `color/black-alpha/30` | `rgba(0,0,0,0.30)` |
| `color/black-alpha/40` | `rgba(0,0,0,0.40)` |
| `color/black-alpha/60` | `rgba(0,0,0,0.60)` |
| `color/black-alpha/80` | `rgba(0,0,0,0.80)` |

**White Alpha 6 档**（v1.0 是 14 档）

| Token | Value |
|---|---|
| `color/white-alpha/05` | `rgba(255,255,255,0.05)` |
| `color/white-alpha/10` | `rgba(255,255,255,0.10)` |
| `color/white-alpha/15` | `rgba(255,255,255,0.15)` |
| `color/white-alpha/25` | `rgba(255,255,255,0.25)` |
| `color/white-alpha/60` | `rgba(255,255,255,0.60)` |
| `color/white-alpha/100` | `rgba(255,255,255,1.00)` |

**State 4 个 + Decoration 4 个**

| Token | Value |
|---|---|
| `color/state/blue-15` | `rgba(59,130,246,0.15)` |
| `color/state/blue-30` | `rgba(59,130,246,0.30)` |
| `color/state/red-15` | `rgba(239,68,68,0.15)` |
| `color/state/blue-deep-40` | `rgba(30,58,138,0.40)` — 拖拽到主网格态 |
| `color/decoration/blob-blue` | `rgba(37,99,235,0.20)` |
| `color/decoration/blob-purple` | `rgba(147,51,234,0.20)` |
| `color/decoration/preview-blue` | `rgba(37,99,235,0.36)` |
| `color/decoration/preview-purple` | `rgba(147,51,234,0.34)` |

#### 2.1.2 Semantic — 38 个（v1.0 是 44）

组件层只引用 Semantic。Semantic 全部 alias 到 Primitive，未来加浅色模式只改 alias。

**Surface (7)**

| Semantic | → Primitive |
|---|---|
| `surface/bg` | `color/black-alpha/60` |
| `surface/bg-hover` | `color/black-alpha/80` |
| `surface/dialog-bg` | `color/black-alpha/80` |
| `surface/scrim` | `color/black-alpha/60` |
| `surface/border-soft` | `color/white-alpha/10` |
| `surface/border-strong` | `color/white-alpha/25` |
| `surface/divider` | `color/black-alpha/40` |

**Panel (6)**

| Semantic | → Primitive |
|---|---|
| `panel/sidebar` | `color/white-alpha/15` |
| `panel/sidebar-chip` | `color/white-alpha/15` |
| `panel/sidebar-button` | `color/white-alpha/15` |
| `panel/sidebar-button-hover` | `color/white-alpha/25` |
| `panel/login-tab` | `color/black-alpha/60` |
| `panel/clock-wrap` | `color/black-alpha/30` |

**Action (6)**

| Semantic | → Primitive |
|---|---|
| `action/primary` | `color/blue/600` |
| `action/primary-hover` | `color/blue/500` |
| `action/danger` | `color/red/600` |
| `action/danger-hover` | `color/red/500` |
| `action/secondary` | `color/black-alpha/60` |
| `action/secondary-hover` | `color/black-alpha/80` |

**Text (7)**

| Semantic | → Primitive |
|---|---|
| `text/primary` | `color/white` |
| `text/secondary` | `color/slate/200` |
| `text/tertiary` | `color/slate/300` |
| `text/quaternary` | `color/slate/400` |
| `text/placeholder` | `color/slate/500` |
| `text/accent` | `color/blue/400` |
| `text/danger` | `color/red/400` |

**Bg (2)**

| Semantic | → Primitive |
|---|---|
| `bg/page` | `color/slate/900` |
| `bg/input` | `color/black` |

**State (6)**

| Semantic | → Primitive |
|---|---|
| `state/focus-ring` | `color/state/blue-30` |
| `state/hover-blue` | `color/state/blue-15` |
| `state/active-blue` | `color/state/blue-30` |
| `state/danger-soft` | `color/state/red-15` |
| `state/drag-indicator` | `color/blue/500` |
| `state/drag-folder-bg` | `color/state/blue-deep-40` |

**Decoration (4)** — 直接 alias 到对应 primitive，组件层只引用 semantic。

---

### 2.2 Typography — 8 Text Styles（v1.0 是 14）

#### 2.2.1 Font Family

| Token | Value |
|---|---|
| `font-family/figma` | `Inter` — Figma 端实际渲染字体 |
| `font-family/css` | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` — 代码侧 system stack（仅记录，不绑 figma 节点） |

#### 2.2.2 Type Scale（base 14 px，1.25 倍比）

7 档：12 / 14 / 16 / 20 / 24 / 32 / 60

#### 2.2.3 Text Styles

| Style | Font | Size | Weight | Line-height | Letter | Case |
|---|---|---|---|---|---|---|
| `text/clock` | Inter | 60 | Light (300) | 100% | +5% | — |
| `text/h1` | Inter | 32 | Semi Bold (600) | 100% | 0 | — |
| `text/h2` | Inter | 24 | Semi Bold (600) | 100% | 0 | — |
| `text/h3` | Inter | 20 | Medium (500) | 100% | 0 | — |
| `text/h4` | Inter | 16 | Semi Bold (600) | 100% | 0 | — |
| `text/body` | Inter | 14 | Regular (400) | 150% | 0 | — |
| `text/label` | Inter | 14 | Medium (500) | 100% | 0 | — |
| `text/caption` | Inter | 12 | Regular (400) | 100% | 0 | — |

废弃的 v1.0 styles（合并到上表）：`text/title-xl/lg/md`、`text/value-chip`、`text/body-secondary`、`text/button`、`text/toast`、`text/error`、`text/tz`、`text/mini-letter`、`text/sm-1/2/3`。

---

### 2.3 Spacing & Layout

#### 2.3.1 Spacing Scale — 11 档（4 px 步长）

| Token | px | 等同 rem |
|---|---|---|
| `size/0` | 0 | — |
| `size/1` | 4 | 0.25rem |
| `size/2` | 8 | 0.5rem |
| `size/3` | 12 | 0.75rem |
| `size/4` | 16 | 1rem |
| `size/5` | 20 | 1.25rem |
| `size/6` | 24 | 1.5rem |
| `size/8` | 32 | 2rem |
| `size/10` | 40 | 2.5rem |
| `size/16` | 64 | 4rem |
| `size/20` | 80 | 5rem |

去掉的代码侧零碎值（→ 最近 4 的倍数）：
- 2.88 / 5.12 / 5.6 / 8.8 → 4 或 8
- 10 / 11.2 → 12
- 13.6 / 14 / 14.4 → 12 或 16
- 14 (像素) / 36 / 44 / 48 → 16 / 32 / 40 / 48

#### 2.3.2 Layout Tokens — 21 个

| Token | Value | 用途 |
|---|---|---|
| `layout/grid-card-base` | 64 | 主网格 1×1 卡片基准（与代码 `--base-card-size` 一致；代码运行时 56–128 动态算，Figma 固化在默认值 64） |
| `layout/grid-gap` | 16 | 网格间距（与 `size/4` 等） |
| `layout/grid-cols-main` | 8 | 主网格列数（运行时 6–12） |
| `layout/grid-cols-folder` | 8 | 文件夹内网格列数 |
| `layout/main-grid-max-w` | 752 | 主网格最大宽度 |
| `layout/main-content-max-w` | 800 | 主内容容器最大宽度 |
| `layout/sidebar-min-w` | 320 | 展开侧栏最小宽度 |
| `layout/sidebar-peek` | 16 | 收起侧栏露边宽度（代码 18 → 规范化到 16） |
| `layout/sidebar-preview-w` | 176 | 壁纸预览宽度 |
| `layout/sidebar-actions-min-w` | 112 | 侧栏按钮最小宽度 |
| `layout/search-max-w` | 672 | 搜索框最大宽度 |
| `layout/folder-modal-max-w` | 768 | 文件夹弹层最大宽度 |
| `layout/folder-modal-min-h` | 400 | 文件夹弹层最小高度 |
| `layout/dialog-max-w` | 384 | 窄对话框最大宽度 |
| `layout/dialog-wide-max-w` | 448 | 宽对话框最大宽度 |
| `layout/login-card-max-w` | 360 | 登录卡片最大宽度 |
| `layout/ctx-menu-min-w` | 200 | 右键菜单最小宽度 |
| `layout/toast-min-w` | 448 | toast 最小宽度 |
| `layout/preview-icon` | 40 | 卡片内 favicon 尺寸 |
| `layout/range-thumb` | 20 | 滑块拇指直径（与 `size/5` 等） |
| `layout/range-track-h` | 4 | 滑块轨道高度（与 `size/1` 等） |

---

### 2.4 Radius — 6 档（v1.0 是 12 档）

| Token | px | 用途 |
|---|---|---|
| `radius/xs` | 4 | folder mini cell（代码 2 → 4） |
| `radius/sm` | 8 | form input、auth-tab、close-btn 内部 |
| `radius/md` | 12 | button、toast、context menu container |
| `radius/lg` | 16 | grid card、sidebar panel、dialog（代码 14/16 合并到 16） |
| `radius/xl` | 24 | folder modal、sidebar 右半圆角 |
| `radius/full` | 9999 | chip / range / drag indicator / close btn outer |

---

### 2.5 Elevation — 5 档 + 2 specials（v1.0 是 9 档）

| Token | Spec | 用途 |
|---|---|---|
| `elevation/sm` | `0 2 8 / α0.20` | slider thumb、小型控件 |
| `elevation/md` | `0 4 12 / α0.30` | card 标准浮起 |
| `elevation/lg` | `0 8 24 / α0.30` | search bar、sidebar |
| `elevation/xl` | `0 12 32 / α0.40` | modal、context menu、toast |
| `elevation/2xl` | `0 16 48 / α0.50` | dialog |
| `elevation/drag-glow` | `0 0 8 / blue α0.80` | 拖拽指示线外发光 |
| `elevation/sidebar-inset` | `inset 0 1 0 / white α0.06` | 侧栏面板顶部高光 |

---

### 2.6 Blur — 4 档（v1.0 是 5 档）

| Token | px | 用途 |
|---|---|---|
| `glass/sm` | 8 | scrim 遮罩（代码 4 → 8，更通透） |
| `glass/md` | 16 | card / sidebar / search 标准玻璃（代码 12 → 16） |
| `glass/lg` | 24 | clock / engine dropdown / folder overlay / toast（代码 16 → 24） |
| `decoration/blob-blur` | 80 | 装饰球 layer blur（代码 CSS 120 → Figma 80，视觉等效） |

去掉 `preview-28` — 壁纸预览空态球的 blur 直接在节点层硬写。

---

### 2.7 Motion — 4 档 duration + 5 个 easing（v1.0 是 7 + 5）

#### 2.7.1 Duration

| Token | ms | 合并自代码 |
|---|---|---|
| `motion/duration/instant` | 150 | 150 ✓ |
| `motion/duration/fast` | 200 | 180 / 200 → 200 |
| `motion/duration/normal` | 280 | 240 / 260 → 280 |
| `motion/duration/emphasized` | 340 | 340 ✓ |

去掉 `pulse: 2000`（动画循环时长，直接硬写）。

#### 2.7.2 Easing

| Token | Curve |
|---|---|
| `motion/ease/standard` | `ease` |
| `motion/ease/in` | `ease-in` |
| `motion/ease/in-out` | `ease-in-out` |
| `motion/ease/emphasized` | `cubic-bezier(0.22, 1, 0.36, 1)` |
| `motion/ease/flip` | `cubic-bezier(0.25, 0.46, 0.45, 0.94)` |

---

### 2.8 Iconography — 10 components from code

✅ **已建为 Figma component**。直接 `createNodeFromSvg()` 把代码里 10 个 inline SVG 1:1 导入为 24×24 master：

| Component | viewBox | 用途 | 代码来源 |
|---|---|---|---|
| `icon/chevron-down` | 24×24 | search engine trigger 箭头 | `newtab.html:126` |
| `icon/search` | 24×24 | search bar 放大镜 | `newtab.html:129` |
| `icon/close-x` | 24×24 | modal/dialog 关闭按钮 | `newtab.html:163, 191, 235` |
| `icon/trash` | 24×24 | 删除（dialog 标题 + ctx menu 删除项） | `newtab.html:173` + `app.js:1412 SVG_TRASH` |
| `icon/edit` | 24×24 | 编辑 / 时钟设置 | `app.js:1411 SVG_EDIT` |
| `icon/external-link` | 24×24 | "在新标签页中打开" | `app.js:1410 SVG_EXTERNAL_LINK` |
| `icon/plus` | 24×24 | 添加快捷方式 | `app.js:1413 SVG_PLUS` |
| `icon/image` | 24×24 | 更换壁纸 | `app.js:1414 SVG_IMAGE` |
| `icon/x-circle` | 24×24 | 移除壁纸（danger） | `app.js:1415 SVG_X_CIRCLE` |
| `icon/folder` | 24×24 | 文件夹卡片图标 / mini preview | `app.js:733-734, 798 FOLDER_PREVIEW_ICON*` |

**所有 component**：
- viewBox `0 0 24 24`，master 尺寸 24×24
- stroke-width 2、stroke-linecap/linejoin round（与代码 SVG 属性一致）
- 默认 stroke bound to **`text/secondary`** variable
- instance 用 `inst.rescale(targetSize / 24)` 缩放到 16 / 18 / 20 / 22 / 24 / 40 等任意尺寸
- 颜色 override：找 instance 内 vector，重新 `setBoundVariableForPaint('color', byName['text/danger'])` 即可（如 ctx menu 删除项的红色 trash）

**已应用 instance 的地方**：
- 06 Icons 页：10 个 component 的展示卡（40×40 instance）
- S-10 ctx menu：external-link / edit / trash 三个 item icon（16×16，trash 用 text/danger）

**待应用 instance 的地方**（占位还是手画 rect/rotated bar）：
- Close button atoms：当前用 2 条 rotated rectangle 模拟 X，应换 `icon/close-x` instance
- Search bar：放大镜当前用 ellipse + stroke 模拟，应换 `icon/search` instance
- Engine trigger 箭头：当前用 polygon 模拟，应换 `icon/chevron-down` instance
- Add card：当前用 2 个 rectangle 拼 +，应换 `icon/plus` instance（grid-card master 也是）
- S-07 Delete dialog 标题旁的 trash：当前 inline 画的，应换 `icon/trash` + text/danger override
- 各模态 close 按钮：同上，换 `icon/close-x`

这些 placeholder 替换工作量不大但分散，按需补。代码侧无需任何改动。

---

## §3 Components — 25 个，使用 v1.1 token

> 完整字段表参见 v1.0 spec git 历史。此节列规范化版本的 token 引用变化。

| 组件 | v1.1 token 引用关键 |
|---|---|
| **Button** | bg: `action/primary` / `action/secondary` / `action/danger` (+ `-hover`)；radius: `radius/md` (12)；padding: 统一 `size/2`(10) × `size/4`(16)（v1.0 primary 用 24 → 规范化为 16）；font: `text/label` |
| **Sidebar Action Button** | bg: `panel/sidebar-button` → hover `panel/sidebar-button-hover`；radius: `radius/sm`(8)（v1.0 13 → 8）；padding `size/2-3` |
| **Form Input** | bg: `bg/input`；border: `color/black-alpha/60` → focus `state/focus-ring`；radius: `radius/sm`(8) |
| **Value Chip** | bg: `panel/sidebar-chip`；radius: `radius/full`；padding `size/1` × `size/3`；font: `text/h4` (default) / `text/body` (sm) |
| **Range Slider** | track: `color/white-alpha/100` (4 px)；thumb: white circle 20×20 + `elevation/sm` |
| **Sidebar Panel** | bg: `panel/sidebar`；border: `surface/border-soft`；radius: `radius/lg`(16)；inset `elevation/sidebar-inset` |
| **Sidebar Wallpaper Block** | preview width: `layout/sidebar-preview-w`(176)、aspect 16:9、radius `radius/lg`；空态装饰球: `decoration/preview-blue` + `decoration/preview-purple`，blur 28 (硬写) |
| **Left Sidebar Shell** | bg: `surface/bg`；blur: `glass/md`(16)；peek: `layout/sidebar-peek`(16) — v1.0 18 → 规范化 16；shadow: `elevation/lg` |
| **Clock** | wrap: `panel/clock-wrap`；blur: `glass/lg`(24)；font: `text/clock` (60/Light/+5%)；副字: `text/body` + `text/caption` |
| **Search Box** | bg: `surface/bg`；blur: `glass/md`；radius: `radius/full`；border focus `state/focus-ring`；shadow: `elevation/lg` |
| **Search Engine Dropdown** | bg: `surface/dialog-bg`；blur: `glass/lg`；radius: `radius/lg`；item radius `radius/sm`；hover `state/hover-blue`、selected `state/active-blue` + `text/accent` |
| **Grid Card** ⭐ | base **64×64** (`layout/grid-card-base`)；radius `radius/lg` (16)；shadow `elevation/md`；blur `glass/md`；**name 改为显式 layout（VERTICAL auto-layout + gap `size/1`(4)）**，不再用 absolute 浮空 — v1.0 那个 grid 间隙不齐就是这里的隐式重叠导致的<br>**type=link**: icon 完全填充整个 card (64×64)，radius `radius/lg` 与 card 一致 — 整张卡就是一张 favicon，没有"卡 bg + 居中 icon"的双层结构<br>**type=folder**: 2×2 mini grid，cells 各 30×30，gap `size/1`(4)，cells radius `radius/xs`(4)，无外 padding（30+4+30 = 64 恰好充满）<br>**type=add**: 20×20 "+" 居中（卡 bg 可见） |
| **Grid Slot** ⭐ | 每个 grid 单元用 **80×N slot** 包裹 card（grid card 是 card+caption 的整体 wrap），slot 内 card 水平居中。slot 间 `grid-gap = 16` (`layout/grid-gap`)。这一层对应代码 `.grid-item-wrap { grid-column: span 1 }` + `min(100%, 64px)` 居中的视觉效果。**视觉上 card-to-card 间距 = 32 px**（slot 两侧空白 8×2 + slot gap 16）。<br>主网格 8 cols：8 × 80 + 7 × 16 = 752 ≡ `main-grid-max-w`。<br>文件夹 modal 8 cols：同 752 grid，modal 总宽规范化到 800（代码 768，body inner 720 + 16 = 752 → 让 Figma 略宽 32 让 8-cols 视觉对齐主网格） |
| **Add Card** | type=add 变体，见上 |
| **Folder Preview Grid (Mini 2×2)** | 即 type=folder 内部结构。grid 2×2，gap `size/1`(4)，cell 30×30，radius `radius/xs`(4)（v1.0 代码 gap 2 / radius 2 → 规范化到 4） |
| **Folder Slot Grid (Big)** | 各 layout 同 v1.0；slot 用 surface 系列 |
| **Folder Popover** | bg `surface/dialog-bg`；border `surface/border-strong`；radius `radius/xl`(24)；shadow `elevation/xl` |
| **Dialog Shell** | bg `surface/dialog-bg`；border `color/black-alpha/60`；radius `radius/lg`(16)；shadow `elevation/2xl` |
| **Dialog · Delete / Edit / Clock / Login** | 用 Dialog Shell + 内容；按钮统一 padding；type-toggle bg `bg/input` radius `radius/sm`；inner btn radius `radius/xs`(4) |
| **Context Menu** | bg `surface/dialog-bg`；blur `glass/lg`；radius `radius/md`(12)；item radius `radius/sm`(8)；hover `state/active-blue`、active `state/hover-blue` + `text/accent`、danger `text/danger` + hover `state/danger-soft`<br>**Item 顺序严格跟代码 `app.js:1417-1462` (`showContextMenu`)**：<br>① link card 右键（主网格）：在新标签页中打开 / 编辑 / sep / size-grid (1x1~4x2 六按钮) / sep / 删除<br>② folder card 右键：编辑 / sep / size-grid / sep / 删除（无"打开"）<br>③ 文件夹内子项右键：编辑 / sep / 删除（无 size-grid）<br>④ 空白区右键（主网格）：添加快捷方式 / 更换壁纸 / (移除壁纸 if wallpaper)<br>⑤ 时钟右键：时钟设置 |
| **Toast** | bg `surface/dialog-bg`；blur `glass/lg`；border default `surface/border-soft` / error `text/danger`；radius `radius/md`(12)；shadow `elevation/xl` |
| **Close Button** | radius `radius/full`；hover bg `surface/bg-hover`；icon 用 2 个 rotated rectangles |
| **Drag Indicator** | width 4 px；radius `radius/full`；color `state/drag-indicator`；shadow `elevation/drag-glow` |
| **Wallpaper Background Layer** | blob: `decoration/blob-blue` / `decoration/blob-purple` + `decoration/blob-blur`(80) |

**变化点速览**：
- Grid card base: **64×64**（与代码 `--base-card-size` 一致，不再用 88）
- Link card icon: **充满整个 card**（v1.0/代码侧是 40 居中，规范化改为整张卡 = 一张 favicon）
- Folder card inner: **2×2 grid + gap 4 + cells 30×30**，无外 padding（代码侧 gap 2 / radius 2 → 规范化到 4）
- **Grid Slot 80 + card 64 居中**：与代码 `repeat(8, minmax(0,1fr))` + `min(100%, 64px) margin: 0 auto` 1:1 等价。Card-to-card 视觉间距 = 32 px
- 网格列数：默认 8，代码运行时 6-12；card 64 + gap 16 恒定，列数变多视觉间距递减
- Button: padding 不再区分 primary/secondary
- Grid card name: absolute → 显式 layout（修了 v1.0 间隙不齐 bug）
- Sidebar peek: 18 → 16
- Inner dialog buttons / type-toggle inner: 用 `radius/xs`(4) 替代代码 `0.375rem`(6)
- Folder modal 总宽: 768 → 800（让 body inner 752 = 主网格同尺寸，8 slot × 80 + 7 × 16）

---

## §4 Patterns

P-01 ~ P-06 同 v1.0：

- **P-01 拖拽四态**：normal / dragging (α0.4, scale 0.95) / combine (outline + bg + scale 1.05) / before/after (drag indicator) / move-to-main (bg `state/drag-folder-bg`)
- **P-02 文件夹动画**：open 340ms `motion/ease/emphasized`，close 260ms `motion/ease/in`（duration token 命名变了，效果同）
- **P-03 FLIP 拖拽重排**：260ms `motion/ease/flip`
- **P-04 / 05 / 06 空状态 / 登录多阶段 / 同步状态** 同 v1.0

---

## §5 Pages

Figma `04 Pages` 全套 16 个 frame：

**主页**
- ✅ S-01 Home Default
- ✅ S-02 Home with Wallpaper（渐变壁纸 + dim 层）
- ✅ S-03 Home with Sidebar Open（sidebar/atom open 实例）

**文件夹**
- ✅ S-04 Folder Open

**对话框**
- ✅ S-05 Dialog · Edit (Link type)
- ✅ S-06 Dialog · Edit (Folder type)
- ✅ S-07 Dialog · Delete
- ✅ S-08 Dialog · Clock Settings（3 时区 entry + 添加按钮）
- ✅ S-09a Dialog · Login (login pane)
- ✅ S-09b Dialog · Login (signup pane)
- ✅ S-09c Dialog · Login (verify pane)

**Context Menu**（5 个变体严格按 `app.js:1417-1462`）
- ✅ S-10 Link card 主网格：在新标签页中打开 · 编辑 · sep · size-grid · sep · 删除
- ✅ S-11 Folder card 主网格：编辑 · sep · size-grid · sep · 删除
- ✅ S-12 文件夹内子项：编辑 · sep · 删除
- ✅ S-13 空白区：添加快捷方式 · 更换壁纸 · 移除壁纸(danger)
- ✅ S-14 时钟：时钟设置

---

## §6 Figma 文件组织 + 命名规范

### 6.1 Pages 结构（重构后 · 7 个干净页面）

```
00 Cover            — Logo / 版本 / 缩略图
01 Foundations      — color / typo / spacing / radius / elevation / glass / motion 展示
02 Components ⭐    — 全部 master 集中（30 个）+ 分类展示（用 instance）：
                       MASTER SOURCE: 全部 master 一行平铺
                       ICONS: 10 个 icon component (chevron-down / search / close-x / trash / edit / external-link / plus / image / x-circle / folder)
                       ATOMS: button × 6 / input × 2 / chip × 2 / close × 2 / drag × 2 / add-card / toast × 2 / ctx-menu-item × 5
                       COMPOSITES:
                          · grid-card/1x1 (link/folder/add 3 types)
                          · **grid-card/1x2 (link/folder, card 160×64, 2col×1row, wide)**
                          · **grid-card/2x1 (link/folder, card 64×160, 1col×2row, tall)**
                          · **grid-card/2x2 (link/folder, card 160×160)**
                          · **grid-card/2x4 (link/folder, card 160×352, tall banner)**
                          · **grid-card/4x2 (link/folder, card 352×160, wide banner)**
                          · 大尺寸严格按代码公式（`app.js:873-884 getGridItemMetrics`）：<br>
                          &nbsp;&nbsp;`wrap = N×80 + (N-1)×16`, `card = (N-1)×96 + 64` (8 px margin 各边)<br>
                          &nbsp;&nbsp;Link 大 card: card 内 64×64 link-preview 居中（**不是 icon 填满 card**，留大量 surface 空间）<br>
                          &nbsp;&nbsp;Folder 大 card: N×M slot grid，`(N×M − 1)` normal slots + 最后 1 个 mini-group (2×2 mini icons)
                          · sidebar/atom (collapsed/open/open-signed-in 3 states, 400 wide)
                          · clock/atom (count=1/count=2 2 variants)
                          · search-box/atom (含真实 chevron + search icon)
                          · engine-dropdown/atom
                          · form-field/atom
                          · dialog-shell/atom (narrow/wide 2 sizes)
                          · folder-popover/atom
                       背景色 `#1a1f2e` 与主页 bg/page 区分
03 Dialogs          — 7 个 dialog showcase（edit link/folder · delete · clock-settings · login × 3 panes）紧凑展示，不含 1440×900 page bg。看 dialog 本身视觉的最快入口
04 Pages ⭐         — **17 个完整 page mockup**。所有 frame 都含 home base（sidebar collapsed + clock + search + grid 8 cards）+ overlay（dialog / ctx menu / folder modal）。从代码视角真实模拟"用户打开 newtab → 触发某操作"的画面。**S-15 Home Mixed Sizes** 展示 2×2 / 2×4 / 4×2 大 card 与 1×1 混合的真实布局
05 Patterns         — Drag 4-state showcase + Folder open storyboard
06 Changelog        — （留作后续记录）
```

**已删除旧页**（重构清理）：
- 旧 02 Atoms / 03 Composites / 06 Icons / 08 States → 全部合并到新 02 Components
- 旧 09 Dialogs → 重命名为 03 Dialogs
- 旧 07 Changelog → 重命名为 06 Changelog

**用法约定**：
- 改组件视觉 → 去 02 Components 内对应 master 改一处 → 02 Components 自身 gallery + 04 Pages 里所有 instance 自动同步
- 看一个组件所有 state 一眼扫完 → 02 Components 内 ATOMS / COMPOSITES section
- 看 dialog 本身视觉 → 03 Dialogs
- 看完整页面 mockup（含 wallpaper / blob / home base / overlay）→ 04 Pages
- **04 Pages 所有 frame 都是完整 mockup**：dialog frame 显示 dialog 居中 + 后面隐约可见的 home base；ctx menu frame 显示 menu 浮在 home grid 上；不再有"空白 bg + 中间一个组件"的孤立显示

### 6.2 命名规范

| 类别 | 模式 | 示例 |
|---|---|---|
| Variable Collection | 单一 | `Lithium` |
| Variable Mode | `Dark`（默认）+ 空 `Light` 占位 | — |
| Variable | `category/subcategory/name` | `color/blue/500` / `surface/bg` / `radius/lg` / `motion/duration/fast` |
| Text Style | `text/role` | `text/clock` / `text/body` / `text/h2` |
| Effect Style | `category/role` | `elevation/md` / `glass/lg` / `decoration/blob-blur` |
| Component | `name/atom` 或 `name/1x1` | `button/atom` / `grid-card/1x1` |
| Variant Property | camelCase | `tone` / `state` / `size` / `type` |
| Frame in Pages | `[Code] - [Page Name] - [Detail]` | `S-01 - Home - Default` |
| Icon | `icon/name` | `icon/close-x` / `icon/folder` |

---

## §6.3 Instance vs Inline 复用模式

**v1.1 当前状态**：
- Pages 里所有 grid card 都用 **instance of `grid-card/1x1`** master（不再 inline 重建）
- 每个 page 的 card 通过 `instance.children[0].children[0].fills = [...]` override icon 颜色
- caption 通过 `instance.children[1].characters = '...'` override 文字
- 改 master（如改 base 64→其他、加 hover state 等）会自动传播到所有 instance

**带来的好处**：
1. 改 `layout/grid-card-base` Variable → master card 跟着变 → 所有 page instance 自动同步
2. 改 master 的 icon 默认 radius / shadow → page 视觉一次性更新
3. Figma 端 component count 准确（不会出现"看起来一样的 card 实际是 8 个独立 frame"）

**仍是 inline 的部分**（master 没建组件，page 直接画）：
- Search Box / Clock / Sidebar / Folder Popover / Dialogs / Context Menu
- 这些 Composite 没抽成 master，因为它们在 page mockup 里出现频次低（1-2 次），重做 master 收益小

**Page 背景**：每个非 Pages 页（02 Atoms / 03 Composites / 04 Pages / 05 Patterns / 06 Icons / 00 Cover）现在用 **wrapper frame** 模式 — 一个 `bg/page` 填充的 frame 包含该 page 所有组件。这样：
- 截图整页时背景跟组件一起显示（之前 bg 是 sibling rect，screenshot 拍 bg 看不到组件）
- 深色组件在深色背景上视觉准确，避免在 Figma 默认浅灰画布上看不清

---

## §7 MCP 落地操作手册

阶段 B 已完成。如需再次重建或追加新组件，工作流：

```
Step 0 — 用户确认 Figma 文件 URL（已有：3Xg7SoouWETqkML24ZR5Jc）
Step 1 — Skill(figma:figma-use) + use_figma：inspect 现有 Variables/Styles
Step 2 — 增量创建（不要重复已存在的 token）
Step 3 — 验证：get_metadata / get_screenshot
```

强制前置每次必做：
- 调 `use_figma` 之前 → `Skill(figma:figma-use)`
- 调 `create_new_file` 之前 → `Skill(figma:figma-create-new-file)`

### 7.1 已踩过的坑（记录避免再犯）

| 错误 | 原因 | 解法 |
|---|---|---|
| `layoutSizingHorizontal = 'FILL'` 报错 | 节点未 append 到 auto-layout 父级前调用 | 先 `parent.appendChild(child)`，再设置 sizing |
| `counterAxisSizingMode = 'HUG'` 报错 | 该属性只接受 FIXED/AUTO，新 API 用 `layoutSizingHorizontal/Vertical` 才用 HUG | 用新 API `layoutSizingX = 'HUG'`（append 后） |
| `figma.root.name = ...` 报错 | Plugin API 不支持改文件名 | 用户在 Figma UI 手动改 |
| 多重 shadow 阴影叠加 | `effects = [shadow1, shadow2]` 顺序敏感 | 在 Effect Style 里一次定义多 effect |

---

## §8 验证清单

### 8.1 Token 计数

- [x] Primitive Color：36 (Brand 16 + Black-α 6 + White-α 6 + State 4 + Decoration 4)
- [x] Semantic Color：38 (Surface 7 + Panel 6 + Action 6 + Text 7 + Bg 2 + State 6 + Decoration 4)
- [x] Number：46 (size 11 + radius 6 + blur 4 + motion 4 + layout 21)
- [x] String：7 (font-family 2 + easing 5)
- [x] Text Style：8
- [x] Effect Style：11 (elevation 5 + drag-glow + sidebar-inset + glass 3 + decoration blur 1)

**总计：127 Variables + 19 Styles**（v1.0 是 168 + 31，分别减少 24% 和 39%）

### 8.2 组件清单

- [x] Atoms (9): Button × 6 / Input × 2 / Chip × 2 / Close × 2 / Drag × 2 / Add Card / Slider / Toast × 2 / CtxItem × 5
- [x] Composites (1): Grid Card 1x1 × 3 type variants

### 8.3 视觉 spot-check（5 帧建议）

| # | 帧 | 用户截图 | Figma 截图 | 签字 |
|---|---|---|---|---|
| 1 | Home Default 整页 | 待截 | S-01 待导 | ☐ |
| 2 | Folder Open | 待截 | S-04 待导 | ☐ |
| 3 | Edit Dialog | 待截 | S-05 待导 | ☐ |
| 4 | Login Verify pane | 待截 | S-09c 待导 | ☐ |
| 5 | Drag State Showcase | 待截 | Patterns 页待导 | ☐ |

---

## §9 代码 ↔ Figma 映射表

代码侧仍是 v1.0 散乱值。要把代码对齐到 v1.1，按此表逐项修改 `style.css :root` + 组件块。

### 9.1 Spacing 映射

| 代码现状 | v1.1 Figma | 改动位置（style.css 行号示例） |
|---|---|---|
| `0.18rem` (2.88px) | `size/1` (4px) | `.sidebar-value-sm` padding |
| `0.32rem` / `0.35rem` (5.12 / 5.6px) | `size/2` (8px) | `.sidebar-value` padding |
| `0.55rem` (8.8px) | `size/2` (8px) | `.sidebar-action-btn` padding |
| `0.625rem` (10px) | `size/3` (12px) | `.btn-*` padding-vertical |
| `0.7rem` (11.2px) | `size/3` (12px) | `.sidebar-action-btn` padding-horizontal |
| `0.85rem` (13.6px) | — | font-size，进 §9.2 |
| `0.875rem` (14px) | `size/4` (16px) | form gap |
| `0.9rem` (14.4px) | `size/4` (16px) | sidebar gap、toast padding |
| `0.25 / 0.5 / 0.75 / 1 / 1.25 / 1.5 / 2 / 2.5 / 4 / 5 rem` | `size/1 ~ size/20` | ✓ 直接对应 |

### 9.2 Typography 映射

| 代码 font-size | v1.1 字号 | text style |
|---|---|---|
| `3.75rem` (60px) | 60 | `text/clock` |
| `1.5rem` (24px) | 24 | `text/h2` |
| `1.25rem` (20px) | 20 | `text/h3` |
| `1rem` (16px) | 16 | `text/h4` |
| `0.9rem` (14.4px) | 14 | `text/body` |
| `0.88rem` (14.08px) | 14 | `text/body` / `text/label` |
| `0.875rem` (14px) | 14 | `text/body` / `text/label` |
| `0.85rem` (13.6px) | 12 (合并下沉) | `text/caption` |
| `0.82rem` (13.12px) | 12 | `text/caption` |
| `0.8125rem` (13px) | 12 | `text/caption` |
| `0.8rem` (12.8px) | 12 | `text/caption` |
| `0.75rem` (12px) | 12 | `text/caption` |
| `0.7rem` (11.2px) | 12 | `text/caption` |

**font-weight**：300 / 500 / 600 / 700 全保留；去掉无用档。

### 9.3 Color 映射

#### Black α

| 代码 | v1.1 | 受影响组件 |
|---|---|---|
| 0.22 / 0.25 / 0.28 / 0.30 | `black-alpha/30` (0.30) | clock-wrap / modal-header / wallpaper-preview-label / engine-form-input |
| 0.40 / 0.48 | `black-alpha/40` (0.40) | modal-header border / wallpaper-preview-label filled |
| 0.50 / 0.60 / 0.62 | `black-alpha/60` (0.60) | search-bar border / surface/bg / folder-modal-bg / btn-secondary |
| 0.70 / 0.78 / 0.80 / 0.82 | `black-alpha/80` (0.80) | dialog-card / context-menu / surface/bg-hover / toast |

#### White α

| 代码 | v1.1 | 受影响组件 |
|---|---|---|
| 0.06 / 0.08 | `white-alpha/10` (0.10) | sidebar-panel inset / surface/border-soft / folder-link hover / toast border |
| 0.12 / 0.14 / 0.16 / 0.18 | `white-alpha/15` (0.15) | handle-stripe / sidebar-panel-bg / sidebar-chip-bg / sidebar-button-bg |
| 0.20 / 0.24 | `white-alpha/25` (0.25) | folder-modal border / sidebar-button-hover |
| 0.32 / 0.42 | (可保留为单独，或) `white-alpha/25` | handle-stripe core / handle focus outline |
| 0.62 / 0.72 / 0.75 | `white-alpha/60` (0.60) | range labels / sidebar note / effect label |
| 0.96 | `white-alpha/100` (1.00) | range track |

#### 实色

| 代码 | v1.1 | 备注 |
|---|---|---|
| `#ff5f5f` | `color/red/400` (#f87171) | sidebar 危险按钮文本 — 颜色合并 |
| `#dc2626 / #ef4444 / #f87171` | 同名 red/600/500/400 | 已对应 |
| `#2563eb / #3b82f6 / #60a5fa` | 同名 blue/600/500/400 | 已对应 |
| `#0f172a` | `slate/900` | bg/page |
| `#475569` | `slate/600` | icon-preview border |
| `#94a3b8` | `slate/400` | placeholder / chevron |
| `#64748b` | `slate/500` | clock-entry index / placeholder |
| `#cbd5e1` | `slate/300` | btn-secondary text / mini letter |
| `#e2e8f0` | `slate/200` | clock-entry select text |
| `#ffe0e0` | (删除) | toast error text，用 `text/danger` (`red/400`) 替代 |

### 9.4 Radius 映射

| 代码 | v1.1 |
|---|---|
| `2px` | `radius/xs` (4) — 微调更明显 |
| `6px` | `radius/sm` (8) — 合并 |
| `8px` | `radius/sm` (8) ✓ |
| `0.375rem` (6) / `0.5rem` (8) | `radius/sm` (8) |
| `0.625rem` (10) | `radius/md` (12) |
| `0.75rem` (12) | `radius/md` (12) ✓ |
| `0.8rem` (12.8) | `radius/md` (12) |
| `0.9rem` (14.4) | `radius/lg` (16) |
| `1rem` (16) | `radius/lg` (16) ✓ |
| `18px` (clocks-wrap) | `radius/lg` (16) — 微调 |
| `1.5rem` (24) | `radius/xl` (24) ✓ |
| `9999px` | `radius/full` ✓ |

### 9.5 Shadow 映射

| 代码 shadow | v1.1 elevation |
|---|---|
| `0 2px 10px α0.28` (slider thumb) | `elevation/sm` |
| `0 4px 6px -1px α0.30` (surface-shadow) | `elevation/md` |
| `0 8px 24px α0.30` (search) | `elevation/lg` |
| `0 12px 32px α0.35` (sidebar) | `elevation/lg` |
| `0 12px 32px α0.36` (toast) | `elevation/xl` |
| `0 8px 32px α0.40` (folder modal) | `elevation/xl` |
| `0 8px 32px α0.50` (ctx menu) | `elevation/xl` |
| `0 16px 48px α0.50` (dialog) | `elevation/2xl` |
| `0 0 8px blue α0.80` (drag indicator) | `elevation/drag-glow` |
| `inset 0 1px 0 white α0.06` (sidebar panel) | `elevation/sidebar-inset` |
| `0 1px 6px α0.70` (text-shadow card name) | （直接硬写在 text，无 elevation） |
| `0 2px 8px α0.50` (text-shadow hint) | （同上） |
| handle 三条纹 multi-shadow | （改为 3 个独立 rect，见 §9.7） |

### 9.6 Blur 映射

| 代码 backdrop-filter | v1.1 |
|---|---|
| `blur(4px)` (overlay scrim, drag-over-folder) | `glass/sm` (8px) — 略加强通透 |
| `blur(12px)` (surface-blur 各处) | `glass/md` (16px) — 加强玻璃感 |
| `blur(16px)` (clocks-wrap, engine-dropdown, folder overlay, ctx menu, toast) | `glass/lg` (24px) — 加强 |
| `blur(28px)` (preview empty balls) | (硬写在节点，不入 token) |
| `filter: blur(120px)` (blob) | `decoration/blob-blur` (80px in Figma) |

### 9.7 组件层面要修的具体代码点

> 这部分是在 §9.1-9.6 token 收敛之外，额外需要的代码改动。

| 文件:行号 | 现状代码 | 建议改动 |
|---|---|---|
| `style.css:138-145` | sidebar handle 三条纹用 `box-shadow: -6px 0 0 white-α/18, -12px 0 0 white-α/12` hack | 改用 3 个独立 `<rect>`（拖入 newtab.html DOM） |
| `style.css:937-952` | `.grid-item-name { position: absolute; top: calc(var(--card-h) + 2px) }` 绝对定位浮在 wrap 外 | 改为 `position: static; margin-top: 4px`，wrap 自然增高 |
| `style.css:817-820` | `.grid-item-wrap` 用 `::before { padding-bottom: 100% }` 制造 1:1 aspect | 改为 `aspect-ratio: 1` 或固定 height |
| `style.css:1010-1040` | `.folder-preview-grid` 用 `gap: 2px`、cell radius `--folder-mini-radius: 2px` | 改为 `gap: 4px` (size/1)、`--folder-mini-radius: 4px`（对齐 4px 步长） |
| `style.css:780` (`renderIcon` 等) | link card 的 favicon 是 `--preview-icon-size: 40` 居中 | 改为 `width: 100%; height: 100%; border-radius: 1rem`（整张卡 = icon），与 Figma v1.1 视觉一致 |

### 9.9 Card / Grid 间距关系（备查）

代码 `--grid-gap: 16` 是 CSS grid 的**名义间距**，但因 `.grid-item-wrap` 用 `minmax(0, 1fr)` 自适应 + card `min(100%, 64px) margin: 0 auto` 居中，card 视觉间距随列数动态变化：

| 列数 | wrap 宽 | card | 视觉 card-to-card |
|---|---|---|---|
| 6 | 112 | 64 | 16 + 48 = **64** |
| 8（默认） | **80** | **64** | 16 + 16 = **32** |
| 9 | 69 | 64 | 16 + 5 = 21 |
| 10+ | < 64 | 缩水 | **16**（card 占满 wrap） |

**Figma v1.1 固化在 8 cols 默认状态**：slot 80 × card 64 居中 × gap 16，视觉间距 32 px。其他列数情景的 mockup 没做（需要时按此公式手工算 slot 宽）。
| `style.css:1213-1223` | `.btn-primary { padding: 0.625rem 1.5rem }` (10×24) | 统一 `padding: 0.625rem 1rem` (10×16) 与 secondary/danger 一致 |
| `style.css:43` | `--sidebar-peek: 18px` | 改 `16px`（对齐 size scale） |
| `style.css:24-44` | `:root` 一堆零碎透明度变量 | 按 §9.3 收敛到 6 档黑透明度 + 6 档白透明度 |

### 9.8 Icon 清单（不变）

代码内联 SVG 的 9 个图标在 v1.1 不变。详见 spec v1.0 §2.8.2 或 Figma `06 Icons` 页。

---

## 附录 · 文档版本记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-05-17 | 1.0.0 | 初版 — 1:1 复刻代码 v1.0.0 |
| 2026-05-17 | 1.1.0 | 规范化：token 总量从 199 降到 146（-27%）；spacing 4px 步长 / type 1.25 比例 / 6 档 radius / 5 档 elevation；Grid Card name 改显式 layout 修间隙问题；代码侧不改，§9 提供映射 |
