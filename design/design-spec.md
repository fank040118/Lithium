# Lithium 设计规范 v2（深色）

本规范描述 Lithium 新标签页的视觉与交互约定：颜色、排版、间距、尺寸、状态，以及它们在 `style.css` 里的对应变量。

| 字段 | 值 |
|---|---|
| 规范版本 | `2.0.0` |
| 取值来源 | [`design/tokens.json`](./tokens.json)，唯一来源 |
| 主题 | 仅深色；结构上为浅色预留（见 §2.4） |
| 单位 | 全部为 px；`style.css` 不使用 rem 表达字号与间距 |

---

## 1. 原则

1. **中性黑白玻璃**：表面几乎全部是黑 / 白 alpha 叠加，近乎 0 饱和。只有功能色带色：主按钮蓝、危险红、警告琥珀、焦点、链接与选中。
2. **浮起的元素叠白，压下去的元素叠黑**：深色表面上要「浮起」的元素（分组卡片、次要按钮、chip、输入框、卡片悬停）用白色 alpha；「凹下去」的元素（分段切换的槽、尺寸按钮底）用黑色 alpha。
3. **层级靠填充明度和轮廓线，不靠阴影**：深色背景上黑色阴影几乎看不见，阴影只负责氛围。控件不新增描边，现有描边只保留在输入框（含搜索栏）、面板轮廓、功能色条和语言切换上。
4. **不引入新色相**：除功能色外不再增加颜色。
5. **所有数值走档位**：间距是 4 的倍数，字号 6 档，圆角 6 档，阴影 8 档。代码里不写档外的字面值，由测试守住（见 §8）。
6. **可访问性**：文字对比度目标 >= 4.5，键盘焦点环对所在表面 >= 3。

---

## 2. Token 命名与结构

### 2.1 两层结构

| 层 | 内容 | 谁可以引用 | 是否随主题变化 |
|---|---|---|---|
| 原始层（`core`） | 实色与 alpha 字面值、尺寸阶梯（间距、尺寸、圆角、字号、字重、行高、描边粗细等） | 原始**颜色**只能被语义层引用；尺寸类 token 组件可以直接用 | 否 |
| 语义层（`theme/dark`） | 按用途命名的颜色与阴影，如 `color.text.muted`、`shadow.modal` | 组件、CSS 规则 | 是（每个主题一套取值） |

规则：

1. 组件与 CSS 规则**不直接引用原始颜色**，一律引用语义 token。
2. 间距、圆角、字号等尺寸 token 不分主题，组件直接引用（`--space-4`、`--radius-md`）。
3. 语义颜色只引用原始层，没有字面值例外。
4. `color.alpha.*` 是字面 rgba 值，不引用实色。所以只被 alpha 用到的底色（紫 600、蓝 900、纯黑）没有实色 token。

### 2.2 命名规则

| 规则 | 说明 | 例 |
|---|---|---|
| 层级分隔符 | token 名用 `.`；token set 名用 `/` | `color.text.muted`；`theme/dark` |
| 段内字符 | 只允许 `[a-z0-9]`，段内不出现连字符。能拆成层级的优先拆；不能自然拆开的复合词才合写 | `size.grid.max`、`color.text.onaccent`、`size.folder.minheight` |
| 叶子与分组不同名 | 一个名字不能既是 token 又是分组。有子状态时普通态叫 `default` | `color.action.primary.default` / `.hover` / `.pressed` |
| 第一段是类别 | `color`、`shadow`、`space`、`size`、`layout`、`radius`、`border`、`font`、`type`、`opacity`、`blur`、`motion`、`z` | |
| 原始色 | `color.<色系>.<阶>`；alpha 字面值是 `color.alpha.<底色>.<百分比两位>`，底色带阶号时合写 | `color.slate.300`、`color.alpha.white.10`、`color.alpha.blue500.15` |
| 语义色 | `color.<用途>.<部位或状态>`：第二段是用途（`surface`、`control`、`input`、`border`、`text` 等），第三段起是部位或状态。表面统一在 `color.surface.*`；控件与输入框的填充叫 `bg`，描边叫 `border` | `color.surface.glass.hover`、`color.input.border` |
| 阶号 | 色板沿用 Tailwind 的 50–950；插值色用三位数 | `color.blue.600`、`color.slate.425` |

### 2.3 CSS 变量的对应规则

**CSS 变量名 = `--` + token 名中的 `.` 全部换成 `-`。** 反向即去掉 `--`、把 `-` 全部换回 `.`。因为段内禁止连字符，这条规则双向唯一。

| token | CSS 变量 |
|---|---|
| `color.control.bg.hover` | `--color-control-bg-hover` |
| `color.alpha.blue500.15` | `--color-alpha-blue500-15` |
| `space.4` | `--space-4` |
| `type.body.md` | `--type-body-md`（值是 `font` 简写，见 §4.4） |

`tokens.json` 里的取值与 CSS 一致，唯一例外是 `font.family.ui`：设计工具（Penpot）里是 `Inter`，CSS 里是系统字体栈（`value.css`）。

`tokens.json` 的每条记录有两个标记：

| 字段 | 含义 |
|---|---|
| `only: "css"` | 只在 CSS 里有对应：设计工具无法表达（`motion.ease.*` 缓动曲线）或不画（`color.scrollbar.*`、`color.wallpaper.dim`） |
| `doc: true` | 设计工具里只作文档展示、不绑定图层：`blur.*`、`z.*`、`motion.duration.*` |

不属于设计 token 的变量：JS 运行时计算出的值（卡片尺寸、壁纸压暗强度、主网格宽度等）使用前缀 `--rt-`（runtime），不写入 `tokens.json`。

### 2.4 浅色主题如何预留

| 位置 | 深色（当前） | 浅色（以后） |
|---|---|---|
| token set | `core` + `theme/dark` | 新增 `theme/light`，token 名与 `theme/dark` 一一对应，只改取值 |
| CSS | `:root` 放原始层与尺寸；`:root, [data-theme="dark"]` 放语义色与阴影，并声明 `color-scheme: dark` | 新增 `[data-theme="light"] { … }`，只覆写语义变量 |
| 组件 | 只引用语义 token | 不改 |

§3.2 每个语义 token 都写明是叠黑、叠白、实色还是带色，浅色主题据此反转叠加方向。

---

## 3. 颜色

### 3.1 原始层（`core`）

**实色**

| token | 值 | 用途 |
|---|---|---|
| `color.white` | `#ffffff` | 正文、实心按钮文字、滑块拇指 |
| `color.slate.200` / `300` | `#e2e8f0` / `#cbd5e1` | 二级、三级文字 |
| `color.slate.425` | `#8b98ac` | 占位文字（slate 400 与 500 之间的插值；对输入框底的对比度 6.56） |
| `color.slate.900` | `#0f172a` | 页面底色 |
| `color.blue.400` / `500` / `600` | `#60a5fa` / `#3b82f6` / `#2563eb` | 链接与选中文字、焦点环 / 拖放指示 / 主按钮与选中分段 |
| `color.blue.700` / `800` | `#1d4ed8` / `#1e40af` | 主按钮悬停 / 按下 |
| `color.red.300` | `#fca5a5` | 侧栏危险按钮的文字 |
| `color.red.400` / `600` | `#f87171` / `#dc2626` | 危险文字与描边 / 危险实心按钮 |
| `color.red.700` / `800` | `#b91c1c` / `#991b1b` | 危险按钮悬停 / 按下 |
| `color.amber.300` / `500` | `#fcd34d` / `#f59e0b` | 警告文字 / 警告图标 |

**alpha**

| 系列 | token | 值（alpha） |
|---|---|---|
| 黑 | `color.alpha.black.{20, 29, 30, 40, 45, 50, 60, 70, 78, 85}` | `rgba(0, 0, 0, 0.20)` … `0.85` |
| 白 | `color.alpha.white.{05, 06, 10, 15, 18, 20, 22, 32, 45, 60, 96}` | `rgba(255, 255, 255, 0.05)` … `0.96` |
| 蓝 500 | `color.alpha.blue500.{10, 15, 20, 80}` | `rgba(59, 130, 246, …)` |
| 蓝 600 | `color.alpha.blue600.{20, 35}` | `rgba(37, 99, 235, …)` |
| 蓝 900 | `color.alpha.blue900.40` | `rgba(30, 58, 138, 0.4)` |
| 紫 600 | `color.alpha.purple600.{20, 35}` | `rgba(147, 51, 234, …)` |
| 红 500 | `color.alpha.red500.15` | `rgba(239, 68, 68, 0.15)` |
| 琥珀 500 | `color.alpha.amber500.{18, 45}` | `rgba(245, 158, 11, …)` |

末两位是百分比，例如 `white.06` 即 `rgba(255, 255, 255, 0.06)`。

### 3.2 语义层（`theme/dark`）

「方式」列说明 token 怎么作用在下层上：**叠黑** / **叠白** 是半透明黑 / 白盖在下层上；**替换** 是悬停态替换普通态的填充；**实色** 不透明；**带色** 是功能色的半透明叠加。

**页面、表面、遮罩**

| token | 取值 | 方式 | 用于 |
|---|---|---|---|
| `color.bg.page` | `slate.900` | 实色 | 无壁纸时的页面底 |
| `color.surface.panel` | `alpha.black.60` | 叠黑 | 侧栏底、文件夹弹窗底 |
| `color.surface.group` | `alpha.white.06` | 叠白 | 侧栏分组卡片；弹窗里的条目行（时钟条目、冲突对比卡） |
| `color.surface.glass.default` | `alpha.black.70` | 叠黑 | 直接压在壁纸上的玻璃：时钟、搜索栏、快捷方式卡片、加号卡、文件夹格、语言切换 |
| `color.surface.glass.hover` | `alpha.white.10` | 叠白；卡片、加号卡、语言切换上**替换** `glass.default`，引擎触发按钮上**叠在**搜索栏底上 | 卡片等悬停；搜索栏里引擎触发按钮的悬停 |
| `color.surface.dialog` | `alpha.black.85` | 叠黑 | 对话框卡片（叠在遮罩上，自身不模糊） |
| `color.surface.menu` | `alpha.black.78` | 叠黑 | 不在遮罩里的浮层：右键菜单、引擎下拉、toast、登录提示 |
| `color.surface.sunken` | `alpha.black.20` | 叠黑 | 凹槽：分段切换与登录页签的槽、右键菜单尺寸按钮底、裁剪舞台 |
| `color.scrim` | `alpha.black.29` | 叠黑 | 对话框遮罩 |
| `color.wallpaper.dim` | `alpha.black.85` | 叠黑 | 壁纸压暗层的底色；压暗强度由该层的 `opacity` 控制。**只在 CSS** |

**描边与分隔线**

| token | 取值 | 方式 | 用于 |
|---|---|---|---|
| `color.border.subtle` | `alpha.white.10` | 叠白 | 面板轮廓：侧栏右边线、分组卡片边框、条目行边框、toast 与登录提示边框、语言切换边框 |
| `color.border.strong` | `alpha.white.20` | 叠白 | 文件夹弹窗边框、语言切换悬停边框 |
| `color.border.highlight` | `alpha.white.06` | 叠白 | 分组卡片顶部 1px 内高光（经 `shadow.highlight`） |
| `color.border.menu` | `alpha.black.40` | 叠黑 | 右键菜单、引擎下拉的边框 |
| `color.divider` | `alpha.white.10` | 叠白 | 菜单分隔线、引擎下拉页脚顶边、搜索栏内引擎触发的右侧分隔线 |

**控件与输入**

| token | 取值 | 方式 | 用于 |
|---|---|---|---|
| `color.control.bg.default` / `.hover` / `.pressed` | `alpha.white.10` / `.20` / `.15` | 叠白 | 弹窗、菜单里的次要按钮；ghost 按钮的悬停与按下（普通态透明） |
| `color.control.panel.default` / `.hover` / `.pressed` | `alpha.white.15` / `.22` / `.18` | 叠白 | 侧栏分组卡片里的按钮 |
| `color.chip.bg` | `alpha.white.15` | 叠白 | 只读数值 chip、侧栏同步状态 pill 的默认态 |
| `color.input.bg` | `alpha.white.05` | 叠白 | 输入框、下拉选择、图标预览框 |
| `color.input.border` | `alpha.white.15` | 叠白 | 输入框、下拉选择、搜索栏的 1px 描边 |

**文字与图标**

| token | 取值 | 方式 | 用于 |
|---|---|---|---|
| `color.text.primary` | `white` | 实色 | 标题、正文、输入值、侧栏按钮文字、卡片名 |
| `color.text.secondary` | `slate.200` | 实色 | 菜单项、列表项、语言切换、弹窗正文 |
| `color.text.tertiary` | `slate.300` | 实色 | 次要按钮文字、弹窗辅助说明 |
| `color.text.muted` | `alpha.white.60` | 叠白 | 字段标签、说明、时间戳、ghost 图标、未选中的分段 |
| `color.text.placeholder` | `slate.425` | 实色 | 占位文字，只出现在 `input.bg` 和搜索栏上 |
| `color.text.onaccent` | `white` | 实色 | 实心主按钮、危险按钮、选中分段上的文字 |
| `color.text.accent` | `blue.400` | 实色 | 文字链接、选中项文字 |
| `color.text.danger` | `red.400` | 实色 | 危险与错误文字、危险图标（侧栏按钮上除外） |
| `color.text.dangeronfill` | `red.300` | 实色 | 侧栏危险按钮（`control.panel.*` 上）的文字 |
| `color.text.warning` | `amber.300` | 实色 | 警告文字 |
| `color.icon.warning` | `amber.500` | 实色 | 警告图标。其余图标跟随所在文字色（`currentColor`），不另设 token |

**功能色**

| token | 取值 | 方式 | 用于 |
|---|---|---|---|
| `color.action.primary.default` / `.hover` / `.pressed` | `blue.600` / `blue.700` / `blue.800` | 实色 | 主按钮 |
| `color.action.danger.default` / `.hover` / `.pressed` | `red.600` / `red.700` / `red.800` | 实色 | 危险实心按钮 |
| `color.selection.solid` | `blue.600` | 实色 | 分段切换、登录页签的选中段 |
| `color.selection.bg` | `alpha.blue500.15` | 带色 | 列表选中项、菜单项选中、尺寸按钮选中 |
| `color.menu.hover` | `alpha.blue500.20` | 带色 | 右键菜单项、尺寸按钮悬停 |
| `color.list.hover` | `alpha.blue500.15` | 带色 | 引擎下拉列表项悬停 |
| `color.danger.bg` | `alpha.red500.15` | 带色 | 危险 ghost 与菜单危险项的悬停、错误条底 |
| `color.danger.border` | `red.400` | 实色 | 输入框错误态、toast 错误态、错误条描边 |
| `color.warning.bg` / `.border` | `alpha.amber500.18` / `alpha.amber500.45` | 带色 | 冲突弹窗警告条、侧栏同步冲突 pill |
| `color.focus.ring` | `blue.400` | 实色 | 2px 键盘焦点环（§6.1） |
| `color.focus.border` | `blue.600` | 实色 | 输入框、搜索栏聚焦时的描边 |
| `color.focus.glow` | `alpha.blue600.20` | 带色 | 输入框聚焦时外圈 3px 光晕 |

**其他**

| token | 取值 | 方式 | 用于 |
|---|---|---|---|
| `color.range.track` / `color.range.thumb` | `alpha.white.96` / `white` | 叠白 / 实色 | 侧栏滑块的轨道 / 拇指 |
| `color.scrollbar.thumb` / `.hover` | `alpha.white.15` / `alpha.white.20` | 叠白 | 主网格滚动条。**只在 CSS** |
| `color.handle` | `alpha.white.32` | 叠白 | 侧栏把手的三条纹 |
| `color.drag.indicator` | `blue.500` | 实色 | 插入指示线、合并成文件夹时的 2px 外框 |
| `color.drag.target` | `alpha.blue900.40` | 带色 | 拖到主网格的目标底 |
| `color.drag.combine` | `alpha.blue500.10` | 带色 | 合并成文件夹时的卡片底 |
| `color.crop.mask` / `.grid` / `.line` | `alpha.black.45` / `alpha.white.45` / `white` | 叠黑 / 叠白 / 实色 | 图标裁剪：框外压暗、三分线、裁剪框与手柄 |
| `color.decoration.blob.blue` / `.purple` | `alpha.blue600.20` / `alpha.purple600.20` | 带色 | 页面背景光斑 |
| `color.decoration.preview.blue` / `.purple` | `alpha.blue600.35` / `alpha.purple600.35` | 带色 | 壁纸预览空态球 |

使用规则：

- 数值相同但语义不同的 token 不合并（例如 `control.panel.default`、`chip.bg`、`input.border` 同为白 15%；`text.primary` 与 `text.onaccent` 同为白；`action.primary.default`、`selection.solid`、`focus.border` 同为 `#2563eb`），浅色主题里它们可能取不同值。
- `text.muted` 和 `text.accent` 放在玻璃、侧栏分组、弹窗、菜单上（对比度均 >= 6.4）。不放在叠白控件的悬停态上（`text.muted` 在 `control.panel.hover` 上只有 4.36）。
- 对话框卡片和文件夹弹窗**不自带背景模糊**，模糊由遮罩层提供：嵌套的 `backdrop-filter` 不生效。只有不在遮罩里的浮层（菜单、下拉、toast、登录提示）自带 `blur.menu`。

### 3.3 对比度

表面缩写：分组 = 侧栏黑 60% 上的白 6% 分组卡片；玻璃 = 黑 70%；弹窗 = 遮罩黑 29% 上的黑 85%；菜单 = 黑 78%。

| 前景 / 底 | 对比度 |
|---|---|
| `text.primary` / 分组、玻璃、弹窗 | 17.8、20.2、20.7 |
| `text.muted` / 分组、玻璃、弹窗 | 7.0、7.3、7.4 |
| `text.accent` / 分组、弹窗 | 7.0、8.1 |
| `text.danger` / 分组、弹窗 | 6.4、7.5 |
| `text.dangeronfill` / `control.panel.default`、`.hover` | 5.9、4.6 |
| `text.placeholder` / `input.bg` | 6.6 |
| `text.onaccent` / 主按钮默认、悬停、按下 | 5.2、6.7、8.7 |
| `text.onaccent` / 危险按钮默认、悬停、按下 | 4.8、6.5、8.3 |
| `text.onaccent` / `selection.solid` | 5.2 |
| 焦点环 `blue.400` / 页面、分组、玻璃、弹窗、菜单 | 7.0、7.0、7.9、8.1、8.0 |

层与层之间的明度差普遍较小（侧栏对页面 1.11，玻璃对页面 1.13），因此区分不靠明度本身：靠背景模糊、`border.subtle` 轮廓（对侧栏 1.25–1.5）、阴影和内容本身。

---

## 4. 排版

### 4.1 字体

| token | 设计工具 | CSS |
|---|---|---|
| `font.family.ui` | `Inter` | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` |

`style.css` 在最前面写了 `button, input, select, textarea { font: inherit; }`，避免表单控件落回浏览器默认字体。`body` 的 `font-family` 引用 `var(--font-family-ui)`，字体栈的唯一来源是 token。

### 4.2 字号（6 档）

| token | px | 用于 |
|---|---|---|
| `font.size.xs` | 12 | 脚注、时间戳、时区标签、尺寸按钮 |
| `font.size.sm` | 13 | 次要正文、小按钮、chip、语言切换 |
| `font.size.md` | 14 | 正文、按钮、菜单项、字段标签 |
| `font.size.lg` | 16 | 搜索输入、侧栏标题 |
| `font.size.xl` | 20 | 弹窗标题、文件夹名、拖到主网格的提示 |
| `font.size.clock` | 60 | 时钟 |

- 12 / 13 / 14 分别承担辅助、次要正文、正文三种角色，不再合并。
- 弹窗标题只用 `xl` 一个字号。
- 快捷方式卡片、文件夹格里没有图标时显示的首字母（30px / 10px）是内容尺寸，不属于字号档，写成固定尺寸的 `.icon-letter`、`.icon-letter-sm` 类。
- 用 px 而非 rem：网格尺寸计算用 px，浏览器缩放对 px 同样生效（WCAG 1.4.4）；代价是浏览器「默认字号」设置不影响 Lithium。

### 4.3 字重、行高、字间距

| token | 值 | 用于 |
|---|---|---|
| `font.weight.light` / `regular` / `medium` / `semibold` | 300 / 400 / 500 / 600 | 不使用 700 |
| `font.leading.none` | 1 | 单行控件文字（按钮、chip、菜单项） |
| `font.leading.tight` | 1.25 | 标题 |
| `font.leading.normal` | 1.5 | 多行正文 |
| `font.tracking.none` | 0 | |
| `font.tracking.clock` | 3px | 只给时钟 |
| `font.tracking.wide` | 2px | 只给拖到主网格的大提示 |

### 4.4 排版角色（`type.*`）

每个 `type.*` token 是一组字号 / 字重 / 行高（时钟另含字间距）的组合：

| token | 字号 / 字重 / 行高 | 用于 |
|---|---|---|
| `type.clock` | 60 / 300 / none，字间距 `tracking.clock` | 时钟 |
| `type.title.lg` | 20 / 600 / tight | 弹窗标题、文件夹名、拖到主网格提示 |
| `type.title.md` | 16 / 600 / tight | 侧栏标题、裁剪弹窗标题、分组标题 |
| `type.body.lg` | 16 / 400 / normal | 搜索输入、冲突卡片的时间 |
| `type.body.md` | 14 / 400 / normal | 弹窗正文、说明、输入值 |
| `type.body.sm` | 13 / 400 / normal | 次要正文、错误提示、文字链接、紧凑表单里的输入框 |
| `type.label.md` | 14 / 500 / none | 按钮、菜单项、页签、字段标签 |
| `type.label.sm` | 13 / 500 / none | 小按钮、chip 数值、语言切换 |
| `type.label.xs` | 12 / 500 / none | 时区标签、尺寸按钮 |
| `type.caption` | 12 / 400 / normal | 脚注、时间戳、卡片名 |

「添加搜索引擎」小表单（`.engine-form-input`、`.engine-form-save`、`.engine-form-cancel`）与编辑快捷方式弹窗里的 `.icon-upload-btn`、`.icon-clear-btn` 是紧凑表单，按钮取 13 档（`type.label.sm`），不随按钮 `md` 取 14。

CSS 写法：

```css
--type-body-md: var(--font-weight-regular) var(--font-size-md)/var(--font-leading-normal) var(--font-family-ui);
.x { font: var(--type-body-md); }
```

`font` 简写会重置 `font-variant-*`（含 `font-variant-numeric`），所以 `tabular-nums` 必须写在 `font` 之后。`letter-spacing` 不受影响。字号、字重、行高的原始 token 同时导出，供个别需要单独覆写的地方使用。

---

## 5. 间距、尺寸、圆角、描边、阴影、模糊、层级、动效

### 5.1 间距

4 的倍数，12 档：

| token | px | token | px |
|---|---|---|---|
| `space.0` | 0 | `space.6` | 24 |
| `space.1` | 4 | `space.8` | 32 |
| `space.2` | 8 | `space.10` | 40 |
| `space.3` | 12 | `space.12` | 48 |
| `space.4` | 16 | `space.16` | 64 |
| `space.5` | 20 | `space.20` | 80 |

单行控件的高度由 `size.control.*` 决定，垂直 padding 为 0，不用 padding 撑高度。

### 5.2 尺寸

控件与图标：

| token | px | 用于 |
|---|---|---|
| `size.control.xs` | 24 | 只读数值 chip、右键菜单尺寸按钮 |
| `size.control.sm` | 28 | 语言切换、图标按钮、小按钮 |
| `size.control.md` | 36 | 按钮、输入框、下拉 |
| `size.control.lg` | 56 | 搜索栏（显式写 `height`，不依赖字体） |
| `size.icon.sm` / `md` / `lg` | 16 / 20 / 24 | 图标 |
| `size.range.thumb` / `track` | 20 / 4 | 侧栏滑块的拇指 / 轨道 |

布局：

| token | px | 用于 |
|---|---|---|
| `size.content.max` | 800 | 主内容区最大宽度 |
| `size.grid.max` | 752 | 主网格最大宽度（8 列 × 80 + 7 × 16） |
| `size.search.max` | 672 | 搜索栏最大宽度 |
| `size.sidebar.width` | 400 | 侧栏展开宽度 |
| `size.sidebar.peek` | 18 | 侧栏收起时露出的宽度 |
| `size.sidebar.preview` | 176 | 侧栏里壁纸预览的宽度 |
| `size.card.base` | 64 | 1×1 卡片的基准边长 |
| `size.card.icon` | 40 | 卡片预览图标 |
| `size.folder.max` / `minheight` | 800 / 400 | 文件夹弹窗最大宽度 / 最小高度 |
| `size.dialog.md` / `lg` / `login` | 384 / 448 / 360 | 普通对话框 / 宽对话框 / 登录弹窗最大宽度 |
| `size.menu.min` | 200 | 右键菜单最小宽度 |
| `size.toast.min` | 448 | toast 最小宽度 |
| `layout.columns.main` / `folder` | 8 / 8 | 主网格与文件夹网格的列数 |

### 5.3 圆角

| token | px | 用于 |
|---|---|---|
| `radius.xs` | 4 | 文件夹迷你格、分段切换内的段 |
| `radius.sm` | 8 | 按钮、输入框、菜单项、页签、分段切换的槽 |
| `radius.md` | 12 | 右键菜单、下拉、toast |
| `radius.lg` | 16 | 卡片、侧栏分组卡片、对话框、登录提示 |
| `radius.xl` | 24 | 文件夹弹窗、侧栏右侧圆角 |
| `radius.full` | 9999 | chip、搜索栏、滑块、语言切换 |

嵌套圆角遵循「内 = 外 - 内边距」：菜单 12、内边距 4 时，菜单项 8。文件夹迷你格的圆角由 JS 按卡片尺寸计算，写入运行时变量 `--rt-folder-mini-radius`，不绑 token。

### 5.4 描边

| token | px | 用于 |
|---|---|---|
| `border.width.thin` | 1 | 输入框、搜索栏、面板轮廓、警告条 |
| `border.width.thick` | 2 | 焦点环、拖放合并态外框 |

### 5.5 阴影

阴影只负责氛围，层级由填充明度和轮廓线承担（§1）。

| token | 值 | 用于 |
|---|---|---|
| `shadow.thumb` | `0 2 8 0 alpha.black.20` | 滑块拇指、裁剪手柄 |
| `shadow.card` | `0 4 12 0 alpha.black.30` | 主页卡片、加号卡、文件夹格 |
| `shadow.panel` | `0 8 24 0 alpha.black.30` | 侧栏、搜索栏 |
| `shadow.popover` | `0 8 32 0 alpha.black.40` | 菜单、下拉、toast、登录提示、文件夹弹窗 |
| `shadow.modal` | `0 16 48 0 alpha.black.50` | 对话框 |
| `shadow.drag` | `0 0 8 0 alpha.blue500.80` | 拖放指示线 |
| `shadow.text` | `0 1 6 0 alpha.black.70`（CSS `text-shadow`） | 压在卡片图上的大卡片名、拖到主网格的提示 |
| `shadow.highlight` | `inset 0 1 0 0 border.highlight` | 侧栏分组卡片顶部内高光 |

输入框聚焦的光晕不建 token：直接写 `box-shadow: 0 0 0 3px var(--color-focus-glow)`，它是状态样式，不是层级。

### 5.6 模糊（CSS 专用）

| token | px | 用于 |
|---|---|---|
| `blur.scrim` | 4 | 对话框遮罩、拖到文件夹时的压暗 |
| `blur.sidebar` | 8 | 侧栏 |
| `blur.glass` | 12 | `surface.glass.*`：时钟、搜索栏、卡片、加号卡、文件夹格、语言切换 |
| `blur.menu` | 16 | `surface.menu`：右键菜单、引擎下拉、toast、登录提示 |
| `blur.backdrop` | 24 | 文件夹弹窗的透明遮罩 |
| `blur.decoration` | 120 | 背景光斑（`filter: blur`） |

### 5.7 z-index 分层（CSS 专用）

全局层（挂在 `body` 下、`position: fixed` 的元素）：

| token | 值 | 成员 |
|---|---|---|
| `z.wallpaper` | -2 | 壁纸 |
| `z.dim` | -1 | 壁纸压暗层 |
| `z.content` | 0 | 主内容区（显式 `isolation: isolate`，形成层叠上下文） |
| `z.sidebar` | 100 | 左侧栏 |
| `z.modal.base` | 300 | 文件夹弹窗、登录弹窗 |
| `z.modal.nested` | 310 | 编辑、时钟设置（可以从文件夹弹窗里打开） |
| `z.floating` | 315 | 语言切换 |
| `z.modal.confirm` | 320 | 删除、删除账户、登录同意、裁剪 |
| `z.modal.critical` | 330 | 同步冲突 |
| `z.notice` | 350 | 登录提示 |
| `z.menu` | 400 | 右键菜单（可在弹窗内打开） |
| `z.toast` | 500 | toast |

模态层之间留 10 的间隔，方便插入新层。局部层（各自层叠上下文内的先后，例如主内容区里网格与搜索栏）不进 token，只用小的相对整数。

### 5.8 动效

| token | 值 | 用于 |
|---|---|---|
| `motion.duration.fast` | 150ms | 悬停、按下的颜色变化 |
| `motion.duration.base` | 200ms | 描边、焦点、透明度 |
| `motion.duration.slow` | 260ms | 侧栏滑动、重排动画、弹窗与文件夹关闭 |
| `motion.duration.slower` | 340ms | 弹窗 / 文件夹打开、登录提示滑入 |
| `motion.ease.standard` | `ease` | 默认 |
| `motion.ease.exit` | `ease-in` | 关闭 |
| `motion.ease.enter` | `cubic-bezier(0.22, 1, 0.36, 1)` | 打开 |
| `motion.ease.move` | `cubic-bezier(0.25, 0.46, 0.45, 0.94)` | 重排、登录提示 |

规则：

- 禁止 `transition: all`，必须列出属性。
- `@media (prefers-reduced-motion: reduce)` 把全部 `--motion-duration-*` 覆写为 `0ms`。JS 驱动的动画不在这条规则的覆盖范围内。

### 5.9 不透明度

| token | 值 | 用于 |
|---|---|---|
| `opacity.disabled` | 0.5 | 禁用态，配 `cursor: not-allowed` |
| `opacity.dragging` | 0.4 | 被拖动的卡片 |

---

## 6. 交互状态

### 6.1 通用规则

| 规则 | 内容 |
|---|---|
| 层级与边界 | 控件靠填充明度与所在表面区分（叠白），不新增描边 |
| 键盘焦点：外扩（默认） | `:focus-visible` 时 `outline: 2px solid var(--color-focus-ring); outline-offset: 2px`。要求元素四周有 >= 4px 空间。用 `outline` 而不是 `box-shadow`，Windows 高对比模式下仍可见 |
| 键盘焦点：内缩 | `outline: 2px solid var(--color-focus-ring); outline-offset: -2px`，环画在元素内侧，不会被父容器裁掉 |
| 实心按钮只用外扩 | 内缩环画在 `blue.600` 上对比度只有 2.03，几乎看不见 |
| 文本输入聚焦 | 描边换成 `focus.border`，加 3px `focus.glow` 光晕，不另画 `outline` |
| 悬停 | 只改填充与文字色，不改尺寸；时长 `motion.duration.fast` |
| 按下 | 实心按钮更暗（`*.pressed`）；叠白控件回落到普通与悬停之间的一档（`control.bg.pressed` 15%、`control.panel.pressed` 18%） |
| 禁用 | 整体 `opacity.disabled` + `cursor: not-allowed`，不响应悬停和按下（CSS 写成 `:not(:disabled):hover`，`:active` 排在 `:hover` 之后） |
| 文字 | 弹窗次要按钮 `text.tertiary`，侧栏按钮 `text.primary`，侧栏危险按钮 `text.dangeronfill`；ghost 按钮悬停时文字改为 `text.primary` |

焦点环取 `blue.400`（`#60a5fa`）而不是主按钮的 `#2563eb`：对深色表面的对比度高一倍（7.0 对 3.5），且与实心蓝区分得开。

**需要内缩环的场合**（外扩环会被裁掉或压到邻居）：

| 容器 | 处理 |
|---|---|
| `.grid-scroll-region`（`overflow: auto`） | 容器四周至少 `space.1` 内边距，卡片用外扩环 |
| `.search-bar`（`overflow: hidden`） | 搜索栏整体按文本输入聚焦（`:focus-within` 描边 `focus.border`）；内部的引擎触发按钮用内缩环 |
| 引擎下拉、右键菜单、分段切换的槽 | 列表项、菜单项、段用内缩环 |
| 相邻间距 4px 的 chip、尺寸按钮 | 内缩环 |
| 侧栏把手（贴在侧栏边缘） | 内缩环 |

### 6.2 按钮

变体：`variant = primary | secondary | ghost`，`tone = default | danger`，`surface = default | panel`（只有 secondary 用到 `panel`），`size = sm | md`。

| variant × tone（× surface） | 状态 | 填充 | 文字 |
|---|---|---|---|
| primary × default | 普通 / 悬停 / 按下 | `action.primary.default` / `.hover` / `.pressed` | `text.onaccent` |
| primary × danger | 普通 / 悬停 / 按下 | `action.danger.default` / `.hover` / `.pressed` | `text.onaccent` |
| secondary × default × default（弹窗、菜单里） | 普通 / 悬停 / 按下 | `control.bg.default` / `.hover` / `.pressed` | `text.tertiary` |
| secondary × default × panel（侧栏分组卡片里） | 普通 / 悬停 / 按下 | `control.panel.default` / `.hover` / `.pressed` | `text.primary` |
| secondary × danger × panel | 同上 | 同上 | `text.dangeronfill` |
| ghost × default | 普通 | 透明 | `text.muted` |
| | 悬停 / 按下 | `control.bg.hover` / `.pressed` | `text.primary` |
| ghost × danger | 普通 | 透明 | `text.muted` |
| | 悬停 / 按下 | `danger.bg` | `text.danger` |
| 全部 | 键盘焦点 | 普通态 + 焦点环 | |
| 全部 | 禁用 | 普通态 + `opacity.disabled` | |

所有按钮**无描边**。尺寸：`md` = `size.control.md`（36）、水平 padding `space.4`、`type.label.md`、`radius.sm`；`sm` = `size.control.sm`（28）、水平 padding `space.3`、`type.label.sm`。

| 代码里的按钮 | 变体 |
|---|---|
| `.btn-primary`、`.engine-form-save` | primary × default |
| `.btn-danger` | primary × danger |
| `.btn-secondary`、`.icon-upload-btn`、`.engine-form-cancel` | secondary × default × default |
| `.sidebar-action-btn` | secondary × default × panel |
| `.sidebar-action-btn-danger`、`.sync-delete-btn` | secondary × danger × panel |
| `.close-btn`、`.folder-rename-btn`、`.add-engine-btn` | ghost × default |
| `.clock-remove-btn`、`.engine-delete-btn`、`.icon-clear-btn` | ghost × danger |
| 右键菜单「删除」 | 菜单项 danger（§6.5） |

**语言切换**直接浮在壁纸上，保留 1px 轮廓：`surface.glass.default` + 1px `border.subtle` + `blur.glass`，文字 `text.secondary`；悬停 `surface.glass.hover` + `border.strong` + `text.primary`；焦点用外扩环。

**文字链接**：`text.accent`、`type.body.sm`；悬停加下划线，按下保持下划线；焦点外扩环；禁用 `opacity.disabled`。

### 6.3 输入框

| 状态 | 填充 | 描边 | 文字 |
|---|---|---|---|
| 普通 | `input.bg` | `input.border` | 值 `text.primary`，占位 `text.placeholder` |
| 聚焦 | 同上 | `focus.border` + 3px `focus.glow` | |
| 错误 | 同上 | `danger.border`（聚焦时保持） | 下方提示 `text.danger`、`type.body.sm` |
| 禁用 | 同上，整体 `opacity.disabled` | | |

普通输入框高 36（`size.control.md`），`radius.sm`，水平 padding `space.3`，`type.body.md`。

**搜索栏**是浮动的大号输入框：填充 `surface.glass.default`（不是 `input.bg`）、`blur.glass`、`shadow.panel`、高 `size.control.lg`、`radius.full`、`type.body.lg`；描边 `input.border`，`:focus-within` 时描边 `focus.border`（不加光晕）；占位文字 `text.placeholder`。

**下拉选择**同输入框。

**分段切换**（`.type-toggle`、`.auth-tab`）：槽 = `surface.sunken`，`radius.sm`，内边距 `space.1`，无描边；段 `radius.xs`，内缩焦点环。选中段 `selection.solid` + `text.onaccent`；未选中段透明 + `text.muted`，悬停 `text.primary`。

### 6.4 chip 与尺寸按钮

| 类型 | 状态 | 填充 | 文字 |
|---|---|---|---|
| 只读数值 chip（`.sidebar-value`） | 唯一 | `chip.bg` | `text.primary`，`type.label.sm` + `tabular-nums`，高 `size.control.xs`，`radius.full` |
| 右键菜单尺寸按钮（`.ctx-size-btn`） | 普通 | `surface.sunken` | `text.muted` |
| | 悬停 / 按下 | `menu.hover` | `text.secondary` |
| | 选中 | `selection.bg` | `text.accent` |
| | 选中 + 悬停 / 按下 | `menu.hover` | `text.accent` |
| | 焦点 / 禁用 | 内缩环 / `opacity.disabled` | |

chip 是 `radius.full` 的小胶囊，无悬停反馈，只出现在分组标题行右侧；侧栏按钮是 `radius.sm`、整行宽，二者靠形状与位置区分。

### 6.5 菜单项、列表项

| 状态 | 右键菜单项 | 引擎下拉列表项 | 文字 |
|---|---|---|---|
| 普通 | 透明 | 透明 | `text.secondary` |
| 悬停 / 键盘高亮 / 按下 | `menu.hover` | `list.hover` | 同上 |
| 选中（当前项） | `selection.bg` | `selection.bg` | `text.accent` |
| 危险项 普通 / 悬停 / 按下 | 透明 / `danger.bg` / `danger.bg` | 无 | `text.danger` |
| 焦点 | 内缩环 | 内缩环 | |

分隔线用 `color.divider`。

### 6.6 状态条与提示

| 组件 | 填充 | 描边 | 文字 / 图标 |
|---|---|---|---|
| 状态条 · warning（冲突弹窗的账号提示） | `warning.bg` | `warning.border` | `text.warning` / `icon.warning` |
| 状态条 · danger（冲突弹窗的错误态） | `danger.bg` | `danger.border` | `text.danger` |
| 状态 pill · default（侧栏同步状态） | `chip.bg` | 无 | `text.primary` |
| 状态 pill · warning（同步冲突） | `warning.bg` | `warning.border`（内描边） | `text.warning` |
| toast · default / danger | `surface.menu` + `blur.menu` | `border.subtle` / `danger.border` | `text.primary` / `text.danger` |

### 6.7 卡片、滑块、侧栏把手、滚动条

| 元素 | 普通 | 悬停 | 按下 / 拖动 | 焦点 |
|---|---|---|---|---|
| 主页卡片、加号卡、文件夹格 | `surface.glass.default` + `blur.glass` + `shadow.card`，无描边 | `surface.glass.hover`（替换底色） | 拖动时 `opacity.dragging`；合并态 2px `drag.indicator` 外框 + `drag.combine` 底 | 外扩环 |
| 文件夹内的链接卡片 | 透明 | `surface.glass.hover` | 同上 | 同上 |
| 滑块 | 轨道 `range.track` 4px，拇指 `range.thumb` 20px + `shadow.thumb` | 拇指外加 4px `control.panel.hover` 光圈（时长 `fast`），尺寸不变 | 同悬停 | 拇指外扩环 |
| 侧栏把手 | 三条纹 `handle`，用间距表达三条 | 不变 | | 内缩环 |
| 滚动条 | thumb `scrollbar.thumb`，轨道透明 | `scrollbar.hover` | 同悬停 | |

拖到主网格的目标区域底色用 `drag.target`。

---

## 7. 主要组件的 token 映射

| 组件 | 填充 / 模糊 | 描边 | 圆角 | 阴影 | 文字 |
|---|---|---|---|---|---|
| 页面 | `bg.page`，壁纸之上叠 `wallpaper.dim` | | | | |
| 时钟 | `surface.glass.default` + `blur.glass` | 无 | `radius.lg` | 无 | `type.clock`，`text.primary` |
| 搜索栏 | `surface.glass.default` + `blur.glass` | `input.border` | `radius.full` | `shadow.panel` | `type.body.lg`，占位 `text.placeholder` |
| 快捷方式卡片 / 加号卡 / 文件夹格 | `surface.glass.default` + `blur.glass` | 无 | `radius.lg` | `shadow.card` | 卡片名 `type.caption`、`text.primary` |
| 侧栏 | `surface.panel` + `blur.sidebar` | 右边线 `border.subtle` | 右侧 `radius.xl` | `shadow.panel` | 标题 `type.title.md` |
| 侧栏分组卡片 | `surface.group` | `border.subtle` | `radius.lg` | `shadow.highlight` | |
| 对话框 | `surface.dialog`，遮罩 `scrim` + `blur.scrim`，卡片自身不模糊 | 无 | `radius.lg` | `shadow.modal` | 标题 `type.title.lg`，正文 `type.body.md` |
| 文件夹弹窗 | `surface.panel`，遮罩 `blur.backdrop`，自身不模糊 | `border.strong` | `radius.xl` | `shadow.popover` | 文件夹名 `type.title.lg` |
| 右键菜单 / 引擎下拉 | `surface.menu` + `blur.menu` | `border.menu` | `radius.md` | `shadow.popover` | `type.label.md`，`text.secondary` |
| toast / 登录提示 | `surface.menu` + `blur.menu` | `border.subtle` | `radius.md` / `radius.lg` | `shadow.popover` | `text.primary` |
| 输入框 / 下拉选择 | `input.bg` | `input.border` | `radius.sm` | 无 | `type.body.md` |
| 按钮 | 见 §6.2 | 无 | `radius.sm` | 无 | `type.label.md` / `type.label.sm` |
| chip | `chip.bg` | 无 | `radius.full` | 无 | `type.label.sm` |
| 分段切换 | 槽 `surface.sunken` | 无 | 槽 `radius.sm`，段 `radius.xs` | 无 | `type.label.md` |

---

## 8. 如何修改 token

**`design/tokens.json` 是唯一来源。** `style.css` 里的 `:root` 变量块都由它派生，不要只改其中一处。

### 8.1 文件格式

`tokens.json` 是一个数组，每条记录：

```json
{"name": "color.focus.ring", "type": "color", "set": "theme/dark", "value": "{color.blue.400}", "only": null, "doc": false}
```

| 字段 | 说明 |
|---|---|
| `name` | token 名，规则见 §2.2 |
| `type` | `color`、`spacing`、`sizing`、`borderRadius`、`borderWidth`、`fontSizes`、`fontWeights`、`fontFamilies`、`letterSpacing`、`typography`、`shadow`、`dimension`、`number`、`opacity`、`duration`、`cubicBezier` |
| `set` | `core` 或 `theme/dark` |
| `value` | 字面值，或用 `{token.name}` 引用另一个 token；`typography` 是字段对象，`shadow` 是层数组 |
| `only` | `null` 或 `"css"`，见 §2.3 |
| `doc` | 是否仅作文档展示，见 §2.3 |

### 8.2 修改步骤

1. 在 `tokens.json` 里改取值，或新增 token。语义颜色只能引用原始层；需要新的 alpha 档位时先在 `core` 里加。
2. 在 `style.css` 对应的 `:root` 块里同步改变量。块内的声明可用测试辅助模块 `test/helpers/designTokens.js` 的 `renderCss` 渲染后粘贴，不必手写。
3. 在组件规则里只引用变量（`var(--color-…)`），不写颜色、间距、字号的字面值。
4. 运行 `npm test`。

### 8.3 测试守护的内容

- `test/design.tokens.test.js`：`tokens.json` 自身的结构（命名规则、唯一性、引用可解析、各类 token 的数量与抽样取值）。
- `test/style.tokens.test.js`：`style.css` 的 `:root` 块与 `tokens.json` 逐条一致，字体栈只来自 token。
- `test/style.components.test.js`：逐个元素断言最终生效的颜色、状态与描边。
- `test/style.dimensions.test.js`、`test/style.typography.test.js`、`test/style.layers.test.js`：间距、尺寸、圆角、阴影、模糊、字号、z-index、动效全部改用 token。
- `test/style.lint.test.js`：颜色字面值等 lint，防止组件规则绕过 token。

`tokens.json` 与 CSS 不一致时测试失败；以 `tokens.json` 为准修 CSS。

### 8.4 约定

- token 变更与对应的 CSS 变更放在同一次提交里。
- 改视觉取值（颜色、字号、间距）后，用浅色壁纸和深色壁纸各抽查一次焦点环与文字对比度。
- 本文档描述取值的意图与用途；取值本身以 `tokens.json` 为准，两者不一致时以后者为准并更新本文档。
