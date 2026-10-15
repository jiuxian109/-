# DDD 全站视觉重绘 · 方案与改动清单

> 状态：**待评审，未落盘改动**（本轮只出方案）
> 依据：`ggame/index.html`、`ggame/style.css`、`ggame/game.js`、`ggame/levels.js`、
> `ggame/design-*.html`、`README.md`、`ggame/DEVELOPMENT-LOG.md`、`docs/screenshot1.png`、
> `docs/screenshot2.png`、`_pbshot_full.png`、`_pbshot_select.png`
> 工具：taste-skill v2 `lint.mjs`（已运行，见附录 A）；`inspect.mjs` 在本会话**无法运行**（沙箱
> `spawn EPERM`，见附录 B），因此下文一切「测量」均为我从源码常量与截图逐像素反推的**计算值**，
> 已逐条标注；需要真机复核的项已写进 §8。

---

## 0. 结论摘要

| # | 结论 |
|---|---|
| 1 | **最大的廉价感来源不是配色，是「两套设计语言并存」**：画布是暖宣纸（`#faf5e8`～`#ece3cb`），DOM 是冷白卡（`#fff`）+ 蓝黑遮罩（`rgba(15,23,42,.55)` / `#0b1020`）+ 琥珀金果冻按钮（`#fbbf24→#f59e0b` + `0 6px 0 #b45309`）。三者互不承认对方。 |
| 2 | **第二来源是「每处都用了默认值」**：12 档字号、8 种圆角、6 种阴影、4 个互不相干的强调色、14 处 emoji 当图标。没有一处是「决定」，全是「顺手」。 |
| 3 | **主按钮文字对比度 1.70:1**（白字 on `#f59e0b`），HUD 芯片文字 **3.22:1**（计算值）。前者严重不合格，后者达不到 WCAG AA 的 4.5:1。 |
| 4 | **画布 backing store 写死 960×540**（`index.html:12`）而被 CSS 拉伸到 >960 CSS px（估算 1.16×，高 DPI 下更高），**HUD 文字与墨线在所有真实窗口里都是位图放大**——这是「糊 = 廉价」的物理原因，也是优先级最高的单一技术修复。 |
| 5 | **奶龙是像素画，世界是矢量平涂**——唯一的 IP 角色和整个世界的渲染语言互斥。这是美术层面最刺眼的一处。 |
| 6 | **三份 `design-*.html` 不能当设计契约**：`design-collision-l3.html:139-148` 硬编码了一份和第 3 关**已经不是一个关卡**的数据（岛 top 300 vs 实际 310，木块 10 块金字塔 vs 实际 12 块三行）；`design-levels.html` 的块数（6/9/10/16）与 `levels.js`（6/9/12/18）不符；`README.md:15-20` 又与两者都不符。 |
| 7 | **推荐方向：《墨档》**——以「木块的 44px 栅格」为全站设计模数、以「墨分五色」为唯一层级手段、以「朱砂」为唯一强调色的**界画式仪器感水墨**。它同时满足「去 AI 廉价感」与「零网络 / 零构建」两条硬约束。 |
| 8 | **Tailwind 建议不用**（理由见 §4.0）：CDN 版需要网络，本地编译版需要构建步骤，两者都撞硬约束；本地预编译产物则会让日后无人能改。 |
| 9 | **HUD 拆半**：静态信息（关卡名/得分/发数）与力度条搬进 DOM；世界内元素（弹道点、飘分）留在 canvas；并且**无论怎么拆都必须先修 DPI**（§6）。 |
| 10 | **竖屏操作区必须一起重绘**（§5）：它是全站唯一还在用深蓝底 + `1px` 描边 + 半透明浮层的地方，不重绘就等于留了一处反例。 |

---

## 1. ① 现状审计：具体问题 + 为什么显廉价

### A. 架构级：两套设计语言并存（最贵的一处）

| 位置 | 事实 | 为什么显廉价 |
|---|---|---|
| 画布 | `game.js:636-638` 天空 `#faf5e8 → #f4ecd9 → #ece3cb`（暖） | — |
| 页面底 | `style.css:7` `radial-gradient(1200px 700px at 50% 30%, #1e3a5f, #0f172a)`（冷蓝黑） | 16:9 画布左右露出的两条深蓝边（见 `_pbshot_full.png` 左右各约 70px）与暖宣纸直接对接。这不是「对比」，是两块不相干的布拼在一起。 |
| 遮罩 | `style.css:68` `rgba(15,23,42,.55)` | 蓝黑遮罩盖在暖米白画面上 → 画面变脏灰，且提示「这是另一个 app 的弹窗」 |
| 弹窗 | `style.css:75` `background: #fff` | 纯白比画布（`#f4ecd9`）更亮更冷。弹窗像贴在画面上的另一张纸 |
| 视频小窗 | `style.css:178-192` `#0b1020` + `#1e293b→#0f172a` + 标题 `#fde68a` | 同一页面内第三套色系（深蓝 + 亮黄） |
| 竖屏提示层 | `style.css:299` 复用 `.overlay` 的深蓝径向渐变 | 第四处冷暖对撞 |
| 导航按钮 | `style.css:152` `linear-gradient(180deg,#fbbf24,#f59e0b)` + `box-shadow: 0 6px 0 #b45309` | 「金色渐变胶囊 + 向下 6px 实心硬阴影」是休闲手游模板的指纹；在暖纸画面上是一块异物 |

> redesign skill 把这一条直接命名为「Random dark sections in a light mode page … looks like a copy-paste accident」，并给出处方：「Either commit to a full dark mode or keep a consistent background tone throughout.」

### B. 色彩：没有一个被角色化

- 全站同时存在 **4 个互相竞争的红/橙/黄系强调色**：朱砂 `#c0392b`（`game.js:649`、`style.css:123/130`、星标文字）、珊瑚粉 `#f2736a`（`game.js:783` 皮筋）、琥珀金 `#fbbc24/#f59e0b/#b45309`（`style.css:152/155` 按钮）、亮黄 `#fde68a`（`style.css:191` 弹窗标题）。加上 `game.js:951` 弹道点的灰褐 `#3c372d`、`game.js:1025` 飘分的 `#c0392b`、力度条底 `#5f8470`（青绿）——**至少 7 色**，且没有一色被规定「只能用在什么上」。
- **冷暖灰混用**：`style.css:96` 未点亮星用 `#e5e7eb`（冷灰），而同文件 `style.css:134` 锁定卡用 `rgba(240,235,224,.8)`（暖灰），`style.css:90` 提示文字 `#9ca3af`（冷灰），`game.js:748` 苔点是青绿灰。redesign skill：「Stick to one gray family.」
- **青绿漏进 UI**：`game.js:835` 弹弓导轨 `rgba(63,95,82,.34)`、`game.js:988` 力度条底 `#5f8470`。青绿在这个项目里的语义是「岛石/植被」（世界材质），出现在 HUD 上会让「世界」与「界面」的边界消失。
- **力度条是青绿→砖红的渐变**（`game.js:987-990`）：把两个语义色混在一根条上，等于放弃「一色一义」。

### C. 字体：只有 UI 兜底字体，没有排版决策

- `style.css:8` 与 `game.js:628/1026` 同一套：`"Segoe UI","Microsoft YaHei",sans-serif`。全局只有这一套，且它是浏览器兜底栈而不是选择的结果。
- **纯中文界面用 Segoe UI 打头** → 中文全部落到 Microsoft YaHei（Windows）/ 系统默认（macOS 上 Segoe UI 不存在，落到 PingFang）。跨平台观感不同，且没有任何「国风」气质。
- **数值用比例字**：得分、剩余发数、星级全部没有 `font-variant-numeric: tabular-nums`，数字变化时宽度跳动。
- **字号 12 档**：`style.css` 的 12.5 / 13.5 / 14 / 15 / 16 / 17 / 18 / 22 / 28 / 34 / 38 / 44，canvas 另有 17 / 21 / 22。taste v2 的上限是「Five sizes on a page」。
- 关卡名四字（云间初试 / 叠叠高 / 一柱擎天 / 巅峰论道）是最有可塑性的排版资产，现在只是 17px 的普通标签（`game.js:1044`、`style.css:128`）。

### D. 形状与阴影：全是默认值

- **圆角 8 档**：3（`game.js:765` 木块）· 4 · 10（`game.js:625` 芯片）· 12（`style.css:30/116/263/333`）· 14（`style.css:351`）· 16（`style.css:179`）· 18（`style.css:76`）· 999（`style.css:154/309`）。taste v2 指出 9–16px 的「软圆角」正是弱站默认值；redesign skill 要求「Vary the radius: tighter on inner elements, softer on containers」——现在是**inner 反而更圆、container 反而更方**，方向是反的。
- **阴影 6 档、全黑、光向不一致**：`0 12px 48px rgba(0,0,0,.55)`（全向）、`0 20px 60px rgba(0,0,0,.4)`（全向）、`0 24px 70px rgba(0,0,0,.65)`（全向）、`0 6px 0 #b45309`（正下，硬）、`0 2px 6px rgba(245,158,11,.5)`（glow）、`0 6px 16px rgba(47,42,34,.14)`（暖，唯一正确的一处）。
- **glow 两处**：`style.css:95` 星标 `text-shadow` 光晕、`game.js:644-648` 朱砂太阳的径向淡晕。taste v2 禁 glow（「No shadows on things at rest. No glows.」）。
- **线性渐变 4 处进 UI**：`style.css:7 / 152 / 192`、`game.js:635-638/694-704/762-763/987-990`。taste v2：「No gradients. Not as backgrounds, not on buttons, not in text.」

### E. 图标：emoji 当图标（14 处）

`lint.mjs` 实测 14 处：`index.html:17 🔊 / :18 ⛶ / :20 ☰ / :35 ☰ / :36 ⛶ / :45 ★ / :49 🔄 / :56 😢 / :58 🔄 / :68 ✕ / :75 🏆 / :82 🔄 / :89 📱 / :92` 等。

为什么这是最直接的「廉价」证据：
1. taste v2 house rules 明令禁止；
2. **跨平台渲染不可控**——Windows 走 Segoe UI Emoji（彩色）、Android 走 Noto Color Emoji、部分 Linux 缺字直接出豆腐块。同一份代码在不同机器上是不同的 logo；
3. 描边粗细、光学重量、基线各不相同（`🔊` 与 `☰` 并排时大小与视觉中心不齐），无法做一套对齐；
4. `#touchBar` 四个按钮只有 emoji，可访问名仅有 `title`（`index.html:17-20`）。

### F. 动效

- 3 个 keyframes（`style.css:42-60`）+ canvas 抖动（`game.js:1061-1063`）+ 竖屏无限循环（`style.css:302` `rotHint 1.8s infinite`）。
- `cubic-bezier(0.2, 1.5, 0.45, 1)`（`style.css:81`）过冲 1.5 → 果冻感；`panelShake`（`style.css:48-55`）失败时「左右晃两下」是模板化情绪表达，且用 `rotate` 制造了**光向混乱**。
- **全站没有 `prefers-reduced-motion`**。三处无限/大幅位移动画对前庭敏感用户不友好。
- **全站没有 `:focus-visible`**。键盘用户看不到焦点（`style.css` 356 行内零处）。
- 面板进入只有 `scale`，没有「内容分层进入」；星级用了 stagger（`game.js:1156` 0.34+i*0.13）——这是全站唯一一处有节奏的动效，方向是对的。

### G. 可访问性与可用性（按当前代码可判定）

| 项 | 事实 | 判定 |
|---|---|---|
| HUD 芯片文字 | `game.js:627` `#fdf8ef` on `game.js:624` `rgba(47,42,34,.5)` 叠在天空 `#f4ecd9` 上 → 合成底约 `#918b7d`。**计算对比度 3.22:1** | ✗ 17px bold 不算 large text（阈值 4.5:1） |
| 主按钮 | `style.css:151-152` 白字 on `#f59e0b`。**计算对比度 1.70:1** | ✗✗ 严重不合格 |
| 锁定关卡卡 | `style.css:133` `opacity: .55` 连同文字一起混合 → `#6b6353` 有效对比度约 2.5:1 | ✗ |
| 提示文字 | `style.css:90` `#9ca3af` on `#fff` | ✗ 2.4:1 |
| 画布 HUD | 5 个 chip + 4 个命中矩形（`game.js:40-43`）全在 canvas 内 | 无文本可选中、读屏完全不可达、无法键盘操作 |
| 触屏按钮 | `#touchBar` 46×46（`style.css:256`） | ✓ 达到 44px 目标 |
| 竖屏按钮 | 56×56（`style.css:351`） | ✓ |
| `.lvcard` 内 `span` 堆叠 | `style.css:108-120` 用 `flex-direction: column` 在 `<button>` 上 | 语义可用，但 `renderLevelList`（`game.js:1244-1250`）拼字符串写 innerHTML，无 `aria-*`、无可访问名描述「已通关 / 未解锁」 |

### H. 资产与数据漂移

1. **奶龙**：`game.js:90-91` 载入 `assets/nailong_head.png`（像素画），`game.js:920` 以 54px 宽绘制。像素画 + 非整数缩放 + DPR 拉伸 → 糊；且与世界的矢量平涂完全异质。`drawBird` 的兜底分支（`game.js:925-926`）是**一个纯黄圆**——加载失败时主角变成一个圆，这是「未完成」的直接证据。
2. **`levels.js:54-55` 两个可疑岛**：
   - `{ cx: 756, top: 104, w: 0, h: 100 }` → `w = 0`，`drawIsland`（`game.js:724-737`）会画一个 0 宽矩形，草叶循环 `Math.floor(0/22) = 0` 次。纯冗余数据。
   - `{ cx: 556, top: 110, w: 2200, h: 100 }` → 横跨 x ∈ [-544, 1656]，会在 y=110 画出一条贯穿全屏的岛体。`addIsland`（`game.js:212-219`）/ `buildLevel`（`game.js:253-256`）**没有任何 w 下限过滤**，所以它在代码路径上必然被创建并绘制。`_pbshot_full.png` 在 y≈120（经 540→625 换算）处**确实可见一条极淡的横带**，与之一致（估算，见 §8 待核实）。
3. **第 4 关左上角的岛会侵入 HUD**：`levels.js:115` `{ cx: 124, top: 100, w: 300, h: 100 }` → 占 x ∈ [-26, 274]、y ∈ [100, 200]。而 `levels.js:38` 自己的注释写着「y < 96 是 HUD 芯片区」；更关键的是 `drawIsland` 的草叶会画到 `top - 8 = 92`（`game.js:743`），**直接进入第一枚芯片的 y 区间（12–46）之下但与第二枚（50–84）相邻**。这是**代码上可证**的视觉冲突。
4. **文档三方不一致**：

   | 关卡 | `README.md:15-20` | `levels.js` | `design-levels.html` | `design-collision-l3.html` |
   |---|---|---|---|---|
   | 1 | 6 块 | 6 块（`levels.js:57-64`） | 6 块 | — |
   | 2 | 9 块 | 9 块（`:74-84`） | 9 块 | — |
   | 3 | **10 块** | **12 块**（`:93-106`） | **10 块** | **10 块（4-3-2-1 金字塔，`design-collision-l3.html:143-148`）** |
   | 3 岛 | — | `cx 522, top 310` | `top 300` | **`cx 520, top 300`（`:141`）** |
   | 4 | 奶龙 5 / 16 块 | **奶龙 6 / 18 块**（`:110,117-136`） | 5 / 16 | — |

   选关卡片与 HUD 都从 `levels.js` 取值（`game.js:1038`、`game.js:1248`），所以**游戏是对的，文档和图纸是错的**。
5. **三份设计稿各写一套排版**：`design-scene.html:9-150`（`#ece8de` 底 + `#fbf8f0` 卡 + 20px 圆角 + `#e3dcc9` 描边 + KaiTi + 🐉）；`design-levels.html:9-97`（与前者近乎逐行重复，连 `.tag` / `.sheet` 都一样）；`design-collision-l3.html:8-49`（第三套：`--paper:#fbf8f2` / `--line:#d8d2c4` / PingFang 优先 / 圆角 12–14）。三份稿的「红」也各不相同（`#c0392b` / `#c0392b` / `#b03a2e`）。
6. **`design-scene.html` 的形态已落后于代码**：`:82` 用 `clip-path` 画梯形山石为默认，`:89` 才用 `.island.float` 覆盖成长方形；而 `game.js:724-737` 里**长方形才是默认**、梯形只留给发射台（`pad: top >= 460`，`game.js:218`）。`:190` 发射台写 `top:452 h:88`，实际 `levels.js:52` 是 `top:470 h:120`（矮了 32px）。

---

## 2. ② 选定美术方向与理由

### 2.1 素材清单（方向的原料，全部来自项目自身）

不是我编的意象，是项目里**已经存在**的东西：44×44 的木块与 44 的坐标栅格（`levels.js:28`、`levels.js:33-35`）；「倒」是唯一动词（40° / 45px / 掉出画面，`design-collision-l3.html:92`）；4 个**四字**关卡名；岛与木块之间的「空」（没有地面也没有墙，`README.md:84`）；弹道预演与真实轨迹偏差 `0.000px`（`README.md:87-88`）；力度条上那条 `MIN_PULL` 死区线（`game.js:995-1005`）；音效全合成、材质是「木」与「弦」（`README.md:93-94`）；朱砂日 / 淡墨云 / 三层远山 / 苔草苔点垂藤 / 印章（`design-scene.html:169-259`）。

### 2.2 四个候选方向

| | A《墨档》界画式仪器水墨 ★推荐 | B《夜观》暗色科技 | C《素纸》高级极简 | D《字志》编辑排版 |
|---|---|---|---|---|
| 一句话 | 把水墨当作**一套可验证的仪器语言**：宣纸=面板，墨分五色=层级，朱砂=唯一行动色，44 栅格=全站模数 | 宣纸换墨夜 `#0d0f12`，朱砂与石青作荧光，等宽字 + 扫描线 | 近乎无 chrome，HUD 退成边缘细字，无面板无按钮 | 四字关卡名做成大字标题，HUD 像杂志页眉，关卡名竖排 |
| 与现有世界观 | 同源，只是把「水墨贴图」提升为「水墨系统」 | 断裂：需要连 canvas 一起重绘 | 断裂：需要删掉画布内的装饰层次 | 互补：可作 A 的标题子系统，不宜独立 |
| 与像素奶龙 | 可解：给奶龙一层纸白留白 + 朱砂描边，作「年画贴纸」处理，与水墨同源（木版套色） | 冲突：暗底荧光像素像另一款游戏 | 冲突最小但角色会更显突兀 | 无关 |
| 离线可行性 | 100%：纯 CSS 变量 + canvas 常量，零字体零依赖 | 100% | 100% | 需要一款有笔意的中文字（见 §3.1） |
| **AI 廉价风险** | **低**——反廉价规则（禁渐变/禁静置阴影/禁 emoji/禁 glass）与水墨的「墨分五色靠浓淡不靠描边」天然同向 | **最高**——暗底 + 荧光 + 发光正是 taste v2 点名的 AI 指纹（violet/indigo + glow），最容易被一眼认出 | 中——极简很容易变成「空页面」，而 taste v2 明确警告「a page that has lost its labels … and gained nothing in their place reads as thin」 | 低，但要让「大字」成立必须有真字体 |
| 工作量 | 中（token 层重写 + canvas 调色 + DOM 重做） | 大（canvas 全重绘 + 角色重做） | 小但收益也小，且会削弱 HUD 可读性 | 中，作为 A 的子集 |
| 建议 | **采纳** | **本轮不采纳**（可作为「夜战模式」的远期彩蛋） | 只借用其**选关面板的克制程度** | 作为 A 的标题子系统**吸收** |

**为什么淘汰 B 而不是因为它「不好看」**：`redesign-existing-projects` 把「Purple/blue 'AI gradient' aesthetic」列为**最常见的 AI 设计指纹**，`design-taste-frontend` 把「violet or indigo」写进 house rules 的禁用表。B 的核心手段（暗底 + 荧光 + glow）恰好是这两条禁令的交集，方向本身就与「去掉 AI 廉价感」这一目标反向。除非用户接受连 canvas 一起重绘并且愿意承担这个风险，否则不应选。

**为什么 C 不足**：这个游戏的关键信息（剩余发数、得分、死区线）**必须一眼读到**。极简要求把 chrome 删到只剩留白，而留白无法承载「剩余 × 2」这种需要被立刻捕捉的数值。它的正确用法是「面板内部再删一层」，不是全局策略。

### 2.3 选定方向的「创意句」（idea sentence）

> **在这个界面上，木块的 44 像素栅格成为整站的设计模数，墨的浓淡成为唯一的层级手段。**

为什么这句能过「竞品测试」：任何一款游戏都可以做「干净的水墨 UI」，但**把木块边长 44 当作 spacing / radius / 动效时长的派生基数**只有这一款游戏做得到——它来自 `levels.js` 里那串 44、44、44 的坐标。

### 2.4 方向的五条硬规则（贯穿全部改动）

1. **纸是底，墨是字，朱砂是动作。** 全站只有 4 个色族：paper（4 阶）、ink（5 阶）、cinnabar（3 阶）、世界材质（jade / wood，**只许出现在画布内的岛与木块，不许进 UI**）。
2. **层级用浓淡，不用描边、不用阴影。** 面板靠「比背景亮一阶的纸」浮起；只有真浮层（弹窗、选关面板）允许一条投影。
3. **圆角只有两档**：`2px`（纸被裁切的直角）与 `999px`（印章/圆形按钮）。中间 6 档全删。
4. **动效是运笔**：入笔快、收笔慢、飞白、洇开。禁用果冻过冲与左右晃动。
5. **动词与数值优先。** 「剩余 × 3」和「得分 120」是 HUD 的主角，字号高于说明文字，并用 tabular-nums。

---

## 3. ③ 设计系统（token）

建议**单一真源放在 `style.css` 的 `:root`**，`game.js` 启动时读一次（§4.1 的第 1 步）。这样 DOM 与 canvas 永远同色，「统一设计系统」才有技术保障。

### 3.1 字体

硬约束：零网络、零构建。因此**不能**用 Google Fonts。分两步走：

**P0（本轮就做，零风险）——系统字栈，三档角色**

```css
--font-title: "Kaiti SC","STKaiti",KaiTi,"Songti SC",SimSun,"Noto Serif SC",serif;
--font-ui:    "PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,"Segoe UI",sans-serif;
--font-num:   var(--font-ui);   /* 只加 font-variant-numeric: tabular-nums */
```

- `--font-title` 用于：关卡题名、结算标题、「DDD」字标、印章内文。Windows 一定有 `KaiTi`（`simkai.ttf`/`STKAITI.TTF` 已在本机确认存在），macOS 一定有 `Kaiti SC`。**跨平台都能拿到「楷」的笔意**，这正是水墨需要的性格。
- `--font-ui` 用于：按钮、HUD 数值、说明文字。`PingFang SC` / `Microsoft YaHei` 是两岸三地桌面 Web 的事实标准，清楚、易读。
- **不要**在这套栈里出现 `Segoe UI` 打头（现 `style.css:8`、`game.js:628/1026`）——中文界面让拉丁字体打头，等于放弃对中文的控制权；`Segoe UI` 只作为最后的拉丁兜底。

**P2（可选增强，需要用户点头 + 一次性联网）——把「笔意」钉死**

系统栈的问题：`KaiTi` 在不同版本的 Windows 上字重与字形略有差异，macOS 的 `Kaiti SC` 与 Windows 的 `KaiTi` 观感也不同。若要做到「任何人双击都一模一样」，唯一的离线解法是**自带字体**：

- 选 **霞鹜文楷 LXGW WenKai**（SIL OFL 1.1，楷体，天生水墨气质；`LXGW WenKai Screen` 更适合屏幕）。
- **必须子集化**：全站用到的汉字约 120 个（4 关名 16 字 + 界面文案 + 数字 + 标点），用 `pyftsubset`（fonttools）或 `fontmin` 产出一个 **woff2，预计 15–40KB**（估算，需实测）。
- 落到 `ggame/assets/fonts/lxgw-wenkai-subset.woff2` + `OFL.txt`，`@font-face` 用相对路径引用。**必须 commit 进仓库**，否则破离线。
- 风险：①需要一次联网下载字体源 + 一个 Python/Node 子集化工具（本会话不具备，需用户在自己机器上执行）；②OFL 要求分发时保留许可文本 → `OFL.txt` 必须同目录；③`font-display: swap` 会造成首屏换字，游戏是本地文件所以加载极快，可接受。
- **本轮不自动执行**，等用户确认。

### 3.2 色板（墨分五色 + 朱砂一点）

```
纸 paper  —— 一个暖色族，H≈38°，全部 4 阶
--paper-0  #FBF7EE   面板 / 弹窗面 / 卡片面（比画布亮一阶，浮起）
--paper-1  #F5EFE1   画布天光 / 页面底（画布与页面同色，16:9 黑边消失）
--paper-2  #EBE3D2   次级面：力度条轨道 / 竖屏操作区底 / 锁定卡
--paper-3  #DCD2BC   按压态 / 分隔（取代 1px 描边）

墨 ink  —— 一个暖灰族，H≈35°，全部 5 阶（对应焦/浓/重/淡/清）
--ink-0    #14120F   焦墨：关卡题名、关键数值、字标
--ink-1    #2E2A24   浓墨：正文、主按钮底、芯片底
--ink-2    #5A5245   重墨：次级文字、说明
--ink-3    #8C8271   淡墨：标签、未解锁、单位
--ink-4    #C6BCA6   清墨：分隔、轨道、未点亮星

朱砂 cinnabar —— 唯一强调色系，H≈8°
--cinnabar      #B23A2E   行动 / 星级 / 印章 / 死区线
--cinnabar-deep #8E2C22   按下 / 描边 / 暗部
--cinnabar-wash rgba(178,58,46,.12)   洇色填充（印章底、失败洇开）

世界材质 —— 只许出现在画布内的岛与木块，禁止进 UI
--jade-0 #8FA98C  --jade-1 #63836C  --jade-2 #3E5A4E  --jade-3 #2A3F37
--wood-0 #C7A377  --wood-1 #A87F52  --wood-2 #7A5A38
```

**对比度验算（我按 WCAG 2.x 相对亮度公式手算，可复核）**

| 组合 | 比值 | 判定 | 用途 |
|---|---|---|---|
| `--ink-1` on `--paper-0` | **13.3:1** | ✓ AAA | 正文 |
| `--ink-2` on `--paper-0` | **7.2:1** | ✓ AAA | 次级文字 |
| `--ink-3` on `--paper-0` | 3.54:1 | △ | 仅 ≥19px bold 或非关键标签 |
| `--ink-4` on `--paper-0` | 1.76:1 | ✗ | **只能做分隔与轨道，不得承载文字** |
| 纸白 `#FBF7EE` on `--cinnabar` | **5.95:1** | ✓ AA | 主按钮（对比现状 1.70:1） |
| `--cinnabar` on `--paper-0` | **5.56:1** | ✓ AA | 朱砂文字/图标 |
| 现状对照：`#fdf8ef` on chip 合成底 | 3.22:1 | ✗ | 需改为不透明 `--ink-1` 底 |

> 关键改动：**HUD 芯片从「半透明深灰 + 1.5px 米白描边」改为「不透明 `--ink-1` 底」**——一举同时解决对比度、"glass" 禁令与「描边即廉价」。

### 3.3 栅格与间距（从 44 派生）

```css
--u: 4px;                                  /* 基本单位 */
--s1: 4px;   --s2: 8px;   --s3: 12px;
--s4: 20px;  --s5: 32px;
--s6: 44px;  /* = 一块木块的边长：面板内边距、HUD 芯片高度、按钮高度 */
--s7: 72px;  /* = 44 + 28：面板之间、区块之间 */
```

- HUD 芯片高度 = `44px`（现在 34px，`game.js:1044-1055`），与木块等高 → 「44 是模数」这句话在画面上被看见。
- 面板内边距 = `--s5`(32) / `--s6`(44)，不再是现在的 `34px 42px`（`style.css:77`）。
- 圆角：`--r-flat: 2px`（默认，纸的裁切）、`--r-seal: 999px`（印章 / 圆形图标按钮）。

### 3.4 阴影（只留两种，且带色相）

```css
--lift-paper: 0 1px 0 rgba(46,42,36,.10);                      /* 纸的厚度，不是投影 */
--lift-float: 0 18px 44px -12px rgba(46,42,36,.28);            /* 唯一的真浮层投影 */
```

删除：`rgba(0,0,0,.4/.55/.65)` 三处全向黑影、`0 6px 0 #b45309` 硬阴影、`0 2px 6px rgba(245,158,11,.5)` 星芒 glow、`game.js:644-648` 太阳淡晕。

### 3.5 字号（5 档封顶）

```css
--t-display: clamp(40px, 7vw, 72px);  /* 四字关卡题名、通关印章；weight 900, ls .06em, lh 1.0 */
--t-title:   28px;                     /* 面板标题；weight 800, ls .02em */
--t-body:    17px;                     /* 正文与 HUD 数值；weight 500, lh 1.6, tabular-nums */
--t-label:   13px;                     /* 次级标签、单位；weight 600, ls .08em（不用 uppercase） */
--t-micro:   11px;                     /* 仅用于「未解锁」这类状态字 */
```

把现有 12 档（含 canvas 的 17/21/22）压到 5 档，是单笔收益最大的一刀。

### 3.6 动效 token

```css
--ease-ink:   cubic-bezier(.22,.61,.36,1);   /* 运笔：入笔快、收笔慢 —— 所有进入 */
--ease-press: cubic-bezier(.2,.9,.3,1);      /* 按压回弹（替代 1.5 过冲的果冻曲线） */
--dur-1: 120ms;   /* 悬停 / 按下反馈 */
--dur-2: 220ms;   /* 面板进出 */
--dur-3: 320ms;   /* 印章落下、飞白、洇开 */
```

**签名动效（the one signature move）：「落印」**
关卡题名与通关印章出现时：`scale(.96) → 1` + `filter: blur(6px) → 0` + `opacity 0 → 1`，`--dur-3`，`--ease-ink`，一次，不循环。
失败时**不用**「左右晃两下」（现 `style.css:48-55`），改为「朱砂洇开」：`--cinnabar-wash` 的径向扩散一次，200ms 后收回——同一个动作语言（墨的行为），而不是两套情绪。

**动效预算**：`design-taste-frontend` 对**网页**要求 ≥8 个真实移动元素。这是个游戏，动效主力应该在**画布内**（那才是产品）：出手的笔锋拖尾、木块被击倒时「墨点飞溅 + 朱砂『倒』字弹出」、浮空岛的极缓上下浮动（±2px / 4s）。DOM 侧只承担面板进出 + 按钮反馈 + 星标 stagger。
**必须补 `@media (prefers-reduced-motion: reduce)`**：保留内容、去掉位移（把 `transform` 位移改成纯 opacity，循环动画停下）。

---

## 4. ④ 按优先级的分文件改动方案

### 4.0 先回答 Tailwind

**建议不用。** 三条理由：

1. **Play CDN 版需要网络** → 直接违反「双击即可运行 / 可离线打开」。这是硬约束，没有讨论空间。
2. **本地编译版需要 Node + 构建步骤**（`npx tailwindcss -i … -o …`）→ 违反「无构建步骤」。你可以把产物 commit 进去当静态 CSS，但那就等于「一次性生成、之后没人改得动」的一坨产物，且 `README.md:51-58` 承诺的「纯静态、不需要任何构建步骤」会变成一句需要解释的话。
3. 更重要的是**内容层面的风险**：Tailwind 的 utility 组合天然把设计推向「卡片 + 圆角 + 阴影」的默认样式，而这正是本次要清掉的东西。**用 token + 语义类**（`.chip` / `.panel` / `.seal-btn`）才能让「一色一义」被强制住。

**如果用户仍希望保留 Tailwind 的选择**：可行路径只有一条——把 Tailwind 编译产物作为**静态 CSS 文件**落到 `ggame/lib/tailwind.css` 并 commit，同时**自定义 config 只暴露本方案的 token**（`theme.extend` 里禁止 `gradient` / `shadow-*` / `rounded-md~2xl`），并且**每次改样式都要重新联网编译**。我不推荐，但如果选它，必须同时接受这两条。

### 4.1 P0 —— 先做，收益最大、风险最低（建议第一批）

| # | 文件 | 位置 | 改动 |
|---|---|---|---|
| P0-1 | `style.css` | 新增 `:root` 块（置于文件最前，`style.css:1` 之前） | 落地 §3 全部 token；这是唯一真源 |
| P0-2 | `game.js` | 顶部常量区（`game.js:6` 之后） | 新增 `const T = readTokens()`：用 `getComputedStyle(document.documentElement).getPropertyValue('--ink-1')` 读一次，把 §3.2 的颜色、§3.3 的尺寸、§3.5 的字号换成 `T.ink1` 形式。**之后 canvas 里不再出现任何字面颜色值** |
| P0-3 | `game.js` | `game.js:616-631` `chip()` | 底改不透明 `T.ink1`；**删掉 `game.js:626` 的 1.5px 描边**；字号改 `T.tLabel/tBody`；高度参数由调用处传 `--s6`(44)；`touchUI` 的 ×1.25 缩放（`game.js:617-623`）改为按 token 取两套尺寸，不再乘法 |
| P0-4 | `game.js` | `game.js:624` / `973-979` | 同一处 `rgba(47,42,34,.5)` 与 `rgba(253,248,239,.35)` 出现在芯片与力度条两处 → 统一走 token，禁止重复字面值 |
| P0-5 | `game.js` | `game.js:1041-1057` `drawHUD()` | 芯片几何改用 `--s6` 与 `--s3`；「DDD · 关卡名」芯片宽度由**测量文字**决定（`ctx.measureText`）而不是写死 200px（现 `game.js:1044`）——`第 4 关 · 巅峰论道` 与第 1 关同宽但空高亮不同，写死宽度有溢出风险（**待实测确认**，见 §8） |
| P0-6 | `index.html` | `:12` | `canvas` 保持 `width="960" height="540"` 作为**世界尺寸声明**，DPI 修复在 JS 侧做（见 P0-7），不在 HTML 里写死 backing store |
| P0-7 | `game.js` | `game.js:8-9` + 新增 `resize()` | **DPI 修复（最高优先级的单一技术修复）**：设 `canvas.width = 960 * dpr; canvas.height = 540 * dpr; ctx.setTransform(dpr,0,0,dpr,0,0)`；监听 `resize` 与 `matchMedia('(resolution)')` 变化。世界坐标、`cssPx()`（`game.js:57-60`，基于 `getBoundingClientRect`）逻辑不变，**不会影响物理与命中测试**；但 `drawImage`（`game.js:923`）会把像素奶龙放大得更明显 → **必须与 P0-8 同批做** |
| P0-8 | `game.js` | `game.js:89-91`、`915-929` `drawBird()` | 奶龙改用 `ctx.imageSmoothingEnabled = false` + **整数倍缩放**（54 → 推荐 56 或 108），并加一圈 `T.paper0` 的 2px 纸白留白 + `T.cinnabar` 1px 外沿（「年画贴纸」处理）。**兜底分支（`game.js:925-926` 的纯黄圆）必须换掉**——改为墨笔圆 + 朱砂眼，最低限度不能是一个圆 |
| P0-9 | `index.html` | `:17-20`、`:34-36`、`:49`、`:56`、`:58`、`:68`、`:75`、`:82`、`:89` | **14 处 emoji 全部替换为内联 SVG 墨线图标**。⚠️ **必须内联 `<symbol>` 到 `index.html`**（或直接内联 `<svg>`），**不能**用 `<use href="assets/icons.svg#id">` —— `file://` 下 Chrome 会以 CORS 拦掉对外部 SVG 的引用，这会**直接破坏「双击即可运行」**。统一 `stroke-width: 1.75`、`stroke-linecap: round`、`fill: none`、`stroke: currentColor` |
| P0-10 | `style.css` | `:68`、`:75`、`:79` | 遮罩 `rgba(15,23,42,.55)` → `rgba(20,18,15,.42)`（墨色）；`.panel` 底 `#fff` → `var(--paper-0)`；阴影 → `var(--lift-float)`；圆角 `18px` → `var(--r-flat)` |
| P0-11 | `style.css` | `:146-169` | `.btn` 整块重做：删 `linear-gradient`（`:152`）、删 `box-shadow: 0 6px 0`（`:155`）、圆角 `999px` → `var(--r-flat)`、底 `var(--cinnabar)`、字 `var(--paper-0)`、`--dur-1` + `--ease-press`。`.btn.ghost` 从「透明灰字」改为「纸面 + `--ink-2` 字 + `--paper-3` 按压态」 |
| P0-12 | `style.css` | `:7`、`:299` | 页面底与竖屏提示层的深蓝径向渐变 → **`var(--paper-1)` 平色 + 纸纹**（见 P0-14）。16:9 黑边随之消失，画布与页面连成一张纸 |
| P0-13 | `style.css` | 全局新增 | `:focus-visible { outline: 2px solid var(--cinnabar); outline-offset: 2px; }`，并补 `@media (prefers-reduced-motion: reduce)` 块（内容保留、位移取消、`rotHint` 停止） |
| P0-14 | `style.css` + `index.html` | 新增 | **纸纹**：`body::after`（`position: fixed; inset: 0; pointer-events: none; z-index: 1`）叠一层极淡噪点（内联 SVG `feTurbulence` 的 data-URI 或 2×2 px 的重复渐变，透明度 ≈ 3%）。这是「flat design with zero texture」的处方，也是「宣纸」这个词唯一能被**看见**的方式。⚠️ 按 `high-end-visual-design` 的护栏：噪点**只能挂在 fixed + pointer-events-none 的伪元素上**，绝不能挂到滚动容器 |
| P0-15 | `levels.js` | `:54-55`、`:115` | **先核实再动**（§8-1/8-2）：`{cx:756,top:104,w:0,h:100}` 与 `{cx:556,top:110,w:2200,h:100}` 看起来是误留数据；`{cx:124,top:100,w:300,h:100}` 的苔草会画进 HUD 区（`game.js:743` 的 `top-8`）。三处的去留**需要用户确认关卡语义**（`levels.js` 是纯数据，改它等于改关卡） |

### 4.2 P1 —— 设计系统铺开

| # | 文件 | 位置 | 改动 |
|---|---|---|---|
| P1-1 | `style.css` | `:74-96` | `.panel` / `.title` / `.sub` / `.hint` 全部重设：字号走 `--t-title/--t-body/--t-label`，色走 `--ink-0/1/2/3`，间距走 `--s4/--s5`；`.hint` 的 `#9ca3af`（2.4:1）→ `--ink-2` |
| P1-2 | `style.css` | `:92-96` | `.stars` 重做：`.on` = `--cinnabar`（去 `text-shadow` glow，`:95`）；`.off` = `--ink-4`（去冷灰 `#e5e7eb`）；字号进 5 档体系；`letter-spacing` 用于「印章排布」而非均匀拉宽 |
| P1-3 | `style.css` | `:108-137` | `.lvcard` 重做：底 `--paper-0`、圆角 `--r-flat`、**去 1.5px 描边**（`:115`）改用「比面板亮/暗一阶的纸」；`hover` 状态去掉 `box-shadow`（`:124`）改用 `--paper-3` 或朱砂左边缘；`.locked` 的 `opacity:.55`（`:133`）→ **不整体降透明**，改为 `--ink-3` 字 + `--paper-2` 底，保证状态字仍可读 |
| P1-4 | `style.css` | `:241-284` | `#touchBar` / `.tbtn` 重做：去 1.5px 描边（`:262`）、底 `--ink-1`、圆角 `--r-flat`、图标走内联 SVG；**保持 46×46 命中盒**（用 padding 而非视觉尺寸保证 44px） |
| P1-5 | `style.css` | `:172-226` | 视频小窗去第三套色系：`#0b1020` → `--ink-0`、标题渐变（`:192`）→ `--ink-1` 平色、`#fde68a` → `--paper-0`、圆角 `--r-flat`、阴影 `--lift-float` |
| P1-6 | `game.js` | `:633-687` | `drawBackground` 去掉天空线性渐变（`:635-638`）改 `T.paper1` 平色；太阳去掉径向淡晕（`:644-648`）改实心朱砂 + 外沿一档纸白（印章感）；云（`:675-687`）保留但透明度与半径进 token |
| P1-7 | `game.js` | `:662-674` | 三层远山按「墨分五色」重新取值：现在 `#b8b1a2 / #8a8374 / #5c574b`（三个独立灰）→ 映射到 `--ink-4 / --ink-3 / --ink-2` 三阶，让远山与 UI 共享同一套灰 |
| P1-8 | `game.js` | `:689-755` | 浮空岛去掉三处线性渐变（`:694-704`）改为**平色 + 一档浓淡**；「苔点」（`:748`）与「垂藤」（`:752`）保留（它们是有信息的），但颜色统一到 `--jade-*`；发射台的梯形（`:706-723`）与浮空岛长方形（`:724-737`）之间的形态差异要写清是**有意为之**（现在 `design-scene.html:82/89` 与代码方向相反，是漂移，见 P1-12） |
| P1-9 | `game.js` | `:757-778` | 木块：去 `createLinearGradient`（`:762-763`）+ 去 `#6f5438` 描边（`:766-767`）→ 平色 `--wood-1` + 顶面 `--wood-0` + 底面 `--wood-2` 的两条浓淡台阶（这就是「墨分五色」用在木头上）；木纹线（`:769-776`）保留但透明度进 token |
| P1-10 | `game.js` | `:962-1007` | 力度条重做：去掉青绿→砖红渐变（`:987-990`）；轨道 = `--paper-2`（不透明，不再半透明灰）；填充 = `--ink-2`，**只有越过死区线（`MIN_PULL`）之后才转为 `--cinnabar`** —— 让「够不够力」这个信息由**颜色**承担；死区线（`:995-1005`）保留虚线但改用 `--cinnabar-deep` |
| P1-11 | `game.js` | `:933-956` | 弹道点：`#3c372d`（`:951`）→ `--ink-2`；半径由固定 4（`:952`）改为「随 i 递减」以表达「预演越远越虚」；末端一颗朱砂点标出落点 |
| P1-12 | `game.js` | `:1152-1159` `renderStars()` | 星标 glyph 从 `★/☆`（`game.js:1156`）换成内联 SVG 或 CSS 绘制的「印章方点」，`renderLevelList`（`:1243`）里的 `★/☆/🔒` 同步替换 |
| P1-13 | `game.js` | `:1232-1253` `renderLevelList()` | 卡片结构改语义化 + 可访问：`<button aria-label="第 3 关 一柱擎天，已通关，3 星">`；`disabled` 同时给 `aria-disabled`；`lvno/lvname/lvmeta/lvstar` 是 `<span>` 堆叠（`style.css:108-114` 用 flex 列）→ 加 `aria-hidden` 到纯装饰部分 |
| P1-14 | `ggame/design-*.html` | 三份 | **评审结论：不能当契约用**（§1-H-4/5/6）。处置建议：①`design-levels.html` → 它画的四关布局已过时且块数与 `levels.js` 不符，且 `editor/editor.html` 已经取代它的功能 → **建议删除**（或改写为从 `levels.js` 生成的校验页）；②`design-scene.html` → 意象与调色板有价值，**吸收进新的 `DESIGN.md` + 一张 token 展示页**，原文件降级为历史稿（文件头加一行「已归档，token 以 style.css 的 :root 为准」）；③`design-collision-l3.html` → **保留**（它是技术图纸，独立风格合理），但**:139-148 的硬编码数据必须改为运行时读 `levels.js`**，否则它永远是错的 |
| P1-15 | `README.md` | `:15-20`、`:42-49` | 关卡表改为与 `levels.js` 一致（第 3 关 12 块、第 4 关奶龙 6 / 18 块）；补一节「设计系统」指向 `style.css` 的 `:root` |
| P1-16 | `index.html` | `:6` | `<title>DDD</title>` → 具体标题；补 `<meta name="description">`、`<meta name="theme-color" content="#F5EFE1">`、内联 SVG favicon（现在没有 favicon —— `redesign-existing-projects` 把它列为必查项） |

### 4.3 P2 —— 增强与探索

| # | 项 | 说明 |
|---|---|---|
| P2-1 | 自带子集化楷体 | §3.1 的 P2；需要用户点头 + 一次联网 + 一个子集化工具 |
| P2-2 | 奶龙矢量重绘 | 用现成的 `inkCurve`（`game.js:803-829`）画一只墨笔圆头小兽，眼睛用朱砂。风险：画得不好比像素更糟。**只在用户授权改角色设定时做** |
| P2-3 | 画布内动效层 | 出手笔锋拖尾、击倒时「墨点飞溅 + 朱砂『倒』字弹出」（现在 `drawParticles`（`:1008-1019`）只是方格，`drawPopups`（`:1020-1034`）只是描边红字，都很"系统默认"） |
| P2-4 | 「倒」的视觉语言 | 判定是 40° / 45px（`design-collision-l3.html:92`）；可以在木块翻倒的瞬间画一道墨弧表示「倾覆」——这是把玩法信息变成美术语言，而不是加装饰 |
| P2-5 | 用 `inspect.mjs` 建闸门 | 见附录 B：本会话跑不了，但在用户机器上（有 Edge + Node 24）可以直接跑，把「无 FAIL」变成发布前的机械检查 |
| P2-6 | 夜战模式 | 方向 B 的降级版：仅把 `--paper-*` 与 `--ink-*` 对调，不改 canvas 结构。作为远期彩蛋，不作为本轮方向 |

---

## 5. ⑤ 竖屏操作区是否一并重绘

**建议：一并重绘，而且优先级是 P1（不是 P2）。** 四条理由：

1. **它是全站最后一处「临时补丁」形态。** `style.css:326-342`：`rgba(253,248,239,.1)` 半透明底 + `border: 1px solid rgba(253,248,239,.22)`。这两条**同时命中** taste v2 的两条禁令（no glass、no 1px outlined box），`lint.mjs` 也确实在 `style.css:335` 报了 `outlined-box`（附录 A）。
2. **深蓝底与暖宣纸的对撞在这里最刺眼。** `body.pv` 下方那一大块用 `style.css:299` 的深蓝径向渐变，而画布是米白。这正是 `redesign-existing-projects` 说的「a sudden jump to `#111` in the middle of a cream page」。
3. **竖屏是唯一的兜底路径**（`README.md:45`），而且它**不写 localStorage**、每次转回竖屏都会重新问一次 → 用户会**反复看到这个界面**。只做横屏设计系统 = 把最常被重复看到的那个界面留在旧语言里。
4. 成本很低：它只有一行信息条 + 一排 4 个按钮（`style.css:326-351`），比选关面板小得多。

**具体做法（建议）**：把这块留白当成一张「题签」而不是一条浮层——
- 整块区域底 = `--paper-2`，与画布 `--paper-1` 形成**一个 tone step** 的分界（不用线、不用阴影，就是 §2.4 规则 2 的用法）；
- 上方居中：竖排或横排的关卡题名，用 `--t-display` 的 60%（`clamp` 已经处理）；
- 中间一行：`剩余 × 3` 用 `--t-body` + `tabular-nums`，紧邻三颗朱砂星（`--t-label` 的「得分」）；
- 底部一排 56×56 的**方角**墨底图标按钮（`--ink-1` 底 + `--paper-0` 描边图标），间距 `--s5`；命中盒仍保证 ≥44px —— 因为改方角后视觉变小，要用 padding 补足，不能让触控面积跟着缩水。

**代价与风险**：`body.pv #stage { width: 100vw }`（`style.css:322`）会把 960 世界压到手机宽度（390px 上约 2.46× 缩小），**HUD 若留在 canvas 会更糊**——这条正是 §6 判断的直接输入。

---

## 6. ⑥ Canvas 内绘制 vs DOM HUD 的取舍

### 6.1 判断结论

| 元素 | 现状 | 建议 | 理由 |
|---|---|---|---|
| 关卡名 / 得分 / 剩余发数（3 枚芯片） | canvas（`game.js:1044-1048`） | **搬进 DOM** | ① 它们是**文字**，DOM 有排版、有 `tabular-nums`、可选中、可被读屏；② 改文案不必碰渲染循环；③ 竖屏模式下 canvas 被缩到 2.46×，DOM 不受影响 |
| 力度条 + 死区线 | canvas（`game.js:962-1007`） | **搬进 DOM**（`transform: scaleY` 驱动） | ① 它本来就是屏幕空间常量（`BAR_X/BAR_TOP/BAR_BOT`），不跟世界坐标；② 每帧只改一个 `scaleY`，`transform` + `will-change` 完全够 60fps（符合 GPU 护栏）；③ 死区线需要精确像素与可能的文字标注，DOM 更合适 |
| 选关 / 重来 / 静音 / 全屏 四个按钮 | 桌面端是 canvas 命中矩形（`game.js:40-43`），触屏端是 DOM（`#touchBar`） | **统一为 DOM** | 现在两套实现（`game.js:1049-1056` 与 `game.js:1322-1353`）维护同一件事，是 bug 温床；DOM 还能白得键盘可达与 `:focus-visible` |
| 弹道预演点 | canvas（`game.js:933-956`） | **留在 canvas** | 锚定世界坐标、必须与物理帧同步、且会随 shake（`game.js:1061-1063`）一起抖。搬去 DOM 要每帧写 transform，反而更贵且易撕裂 |
| 飘分 popup | canvas（`game.js:1020-1034`） | **留在 canvas** | 它是世界坐标里的向上漂移（`updateFX` 里 `p.y -= 1.2`，`game.js:1095`），与弹道同一坐标系 |
| 粒子 / 飞溅 | canvas（`game.js:1008-1019`） | **留在 canvas** | 同上，且数量大 |
| 太阳 / 云 / 远山 / 岛 / 木块 / 弹弓 / 皮筋 / 奶龙 | canvas | **留在 canvas** | 这就是游戏本体 |

**一句话原则**：**屏幕空间的文字与控件 → DOM；世界空间的物件与特效 → canvas。**

### 6.2 前置依赖：DPI 修复（无论怎么取舍都要做）

现状事实：`index.html:12` 的 `canvas width="960" height="540"` 既是世界尺寸**也是** backing store 尺寸；`style.css:25-27` 让 `#game { width: 100% }`。结果是 960 的位图被浏览器双线性放大到任意 CSS 宽度。

在该探测截图（`_pbshot_full.png`，窗口 1250×625，画布左右各留约 70px 深蓝边）里，画布被渲染到约 **1111 CSS px** 宽 → **1.157× 非整数放大**（由像素反推，**估算**）。在 DPR=2 的屏幕上，1112 CSS px 对应 2224 物理像素，而 backing store 仍是 960 → **约 2.3× 放大**。HUD 的 17px 字与 1.5px 描边在这个倍率下会明显发虚、描边变得忽粗忽细。

修复：`canvas.width = 960 * dpr; canvas.height = 540 * dpr; ctx.setTransform(dpr,0,0,dpr,0,0)`。世界坐标不变，物理与命中测试（`cssPx()`，`game.js:57-60`）不受影响。

**但它有一个必须一起处理的副作用**：`drawImage`（`game.js:923`）会把像素奶龙放大得更明显。所以 **DPI 修复（P0-7）必须与奶龙处理（P0-8）同批上线**，不能拆开。这一条是本次方案里唯一的硬依赖。

---

## 7. 执行顺序建议（三轮）

| 轮次 | 内容 | 判据 |
|---|---|---|
| 第一轮（P0） | token 层 + 去 emoji + 去渐变/黑影/1px 描边 + 修 DPI + 奶龙处理 + 修对比度 | `lint.mjs` 输出 **0 FAIL**（现在 29 FAIL）；主按钮对比度 ≥4.5:1；HUD 芯片文字 ≥4.5:1 |
| 第二轮（P1） | 设计系统铺到面板/卡片/触屏条/视频窗/竖屏操作区 + canvas 调色对齐 + 文档修正 | 全站颜色只来自 `:root`（`game.js` 与 `style.css` 里字面颜色值归零）；三份 `design-*.html` 与 `levels.js` 不再矛盾 |
| 第三轮（P2） | 字体子集化 / 画布内动效层 / 角色重绘（需授权） | 用户确认方向后单独评估 |

---

## 8. 必须由用户确认 / 需要真机复核的事项

1. **`levels.js:54-55` 的两个岛是误留数据还是有意为之？** `{cx:756,top:104,w:0,h:100}`（w=0）与 `{cx:556,top:110,w:2200,h:100}`（横跨全屏）。代码路径（`game.js:212-219` → `:253-256` → `:724-737`）**没有 w 下限过滤**，所以它们必然被创建并绘制；`_pbshot_full.png` 在 y≈120 处**可见一条贯穿全屏的极淡横带**，与之吻合（**这是我基于截图像素的估算，需真机核实**）。改 `levels.js` 等于改关卡语义，**我不会擅自动**。
2. **`levels.js:115` 第 4 关左上角的岛是否压到 HUD？** `x ∈ [-26,274]`、`y ∈ [100,200]`，而 `game.js:743` 的草叶会画到 `top-8 = 92`。`levels.js:38` 自己的注释写着「y < 96 是 HUD 芯片区」。**建议真机开第 4 关看一眼**。
3. **`game.js:1044` 写死 200px 宽的关卡名芯片是否溢出？** 最长名 `第 4 关 · 巅峰论道` 与第 1 关等长；在 960px 截图上文字看起来已经贴到胶囊右缘。**这是估算，需要 `ctx.measureText` 实测**。
4. **P2-1 字体子集化是否要做？** 需要用户提供一次联网 + 一个字体子集化工具（本会话无网络、无 fonttools）。
5. **P2-2 是否允许改奶龙的角色设定**（改成矢量墨笔造型）？这超出「视觉重绘」进入「IP 资产重做」，需要明确授权。
6. **画布内世界是否允许一起改？** 本方案默认改（P1-6～P1-11 都在 canvas 内），因为「两套设计语言并存」的另一半就在画布里。如果用户只想改 DOM 界面，方案的 60% 需要重写。
7. **`design-levels.html` 是否同意删除？**（它的功能已被 `editor/editor.html` 取代，且数据已过时）

---

## 附录 A：`lint.mjs` 实测输出（本会话真实运行）

```
$ node <skill>/scripts/lint.mjs ggame/index.html ggame/style.css
TASTESKILL · LINT   2 file(s)

FAIL
  [emoji] Emoji used as UI.  (14×)
      ggame/index.html:17  🔊
      ggame/index.html:18  ⛶
      ggame/index.html:20  ☰
      ggame/index.html:35  ☰
      ggame/index.html:36  ⛶
      ggame/index.html:45  ★
      … 8 more
  [gradient] Gradient fill.  (4×)
      ggame/style.css:7    radial-gradient(
      ggame/style.css:152  linear-gradient(
      ggame/style.css:192  linear-gradient(
      ggame/style.css:299  radial-gradient(
  [shadow] Shadow.  (11×)
      ggame/style.css:31   box-shadow:
      ggame/style.css:38   box-shadow:
      ggame/style.css:79   box-shadow:
      ggame/style.css:95   text-shadow:
      ggame/style.css:124  box-shadow:
      ggame/style.css:155  box-shadow:
      … 5 more

WARN
  [outlined-box] A 1px outlined box.  (1×)
      ggame/style.css:335  border: 1px solid

RESULT: 29 FAIL, 1 WARN
```

注：`lint.mjs` 是**静态文本扫描**，它看得到 DOM/CSS，**看不到 canvas 内部的渐变与描边**。所以 `game.js:635-638 / 694-704 / 762-763 / 987-990` 的四处渐变、`game.js:626` 的芯片描边、`game.js:766-767` 的木块描边**都不在这 29 条里**——真实的问题面比这份报告更大。

## 附录 B：本会话无法运行的检查（诚实声明）

> **本节结论已被附录 C 取代。** 沙箱放宽到 `danger-full-access` 后，真实浏览器测量已经跑通，下面的待测清单全部完成。保留本节是为了保留「为什么当时测不了」的记录。

`node <skill>/scripts/inspect.mjs ggame/index.html` **失败**：

```
Error: spawn EPERM
    at Browser.launch (.../scripts/lib/cdp.mjs:58:18)
    at .../scripts/inspect.mjs:59:31
  errno: -4048, code: 'EPERM', syscall: 'spawn'
```

原因：本会话的文件沙箱禁止子进程通过命名管道捕获 stdio，而 `inspect.mjs` 需要 spawn 浏览器并通过 pipe 读 CDP。这是已文档化的沙箱边界，**不应重试规避**。

因此本方案中**没有**以下测量（都只能由用户在自己机器上跑）：
- 真实渲染后的 headline 行数 / 实际加载的字体 / 真实对比度 / overflow；
- 三档视口（1440 / 768 / 390）的截图。

用户机器上有 Edge（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，已确认存在）与 Node v24.18.1，**可以直接跑** `inspect.mjs`，把它当作发布前的机械闸门（见 P2-5）。

---

# 附录 C：真实浏览器实测校验（已跑通，取代附录 B）

## C.0 方法与可复现命令

沙箱放宽到 `danger-full-access` 后，原来的 `spawn EPERM` 消失。但 taste-skill 自带的 `scripts/lint.mjs` / `scripts/inspect.mjs` **没有随技能落盘进本仓库**，所以在 `editor/` 下重建了两个等价工具：

- `editor/lint.mjs` — 静态扫描。**扫描面比附录 A 更大**：覆盖 `ggame/game.js`。
- `editor/inspect.mjs` — CDP 驱动无头 Edge 做真实渲染测量：5 档视口 × 4 个界面状态，量真实对比度（含透明度/渐变合成后的实际背景）、几何、溢出、`scrollHeight`、emoji 文本节点清单；产出 `editor/_shots/report.json` + `summary.txt` + 15 张截图。

```
node editor/lint.mjs ggame      # 37 FAIL / 161 WARN
node editor/inspect.mjs         # 约 20-30s，产出 editor/_shots/
```

**踩坑记录（供后人）**：CDP 客户端必须在**构造函数里**就挂上 `ws.onmessage` 分发；否则 `send()` 返回的 Promise 永远不 resolve，脚本会**静默挂死**（不报错、不超时、无输出）。这是第一次运行卡住两分钟的真正原因，不是沙箱问题。

## C.1 视口矩阵与画布实测值

| 视口 | 触摸 | canvas backing | canvas CSS | 位图放大 (CSS px) | 位图放大 (device px) |
|---|---|---|---|---|---|
| 1440×900 dpr1 | 否 | 960×540 | 1440×810 | **1.500×** | 1.500× |
| 1440×900 dpr2 | 否 | 960×540 | 1440×810 | **1.500×** | **3.000×** |
| 1920×1080 dpr1 | 否 | 960×540 | 1920×1080 | **2.000×** | 2.000× |
| 844×390 dpr3 | 是 | 960×540 | 693.328×389.984 | 0.722×（缩小） | **2.167×** |
| 390×844 dpr3 | 是 | 960×540 | 390×219.375 | 0.406×（缩小） | 1.219× |

「位图放大 > 1」= 一个 backing 像素被铺到多于一个屏幕像素 = 必然发虚。`canvas` 盒子：`border-radius: 12px`（`style.css:30`）+ `box-shadow: 0 12px 48px rgba(0,0,0,0.55)`（`style.css:31`）。另外 `style.css:20` 的 `width: min(100vw, calc(100vh * 16 / 9))` 就是横屏手机那 150.7px 死区的来源（844×390 视口按 16:9 只能得到 693.3px 宽）。

## C.2 专家声称 vs 实测：逐条判定

| # | 方案里的声称 | 实测结果 | 判定 |
|---|---|---|---|
| 1 | backing 写死 960 被 CSS 拉伸 **≈1.157×**，DPR2 下约 2.3× | **1.500×**（1440）/ **3.000×**（1440 @dpr2）/ **2.000×**（1920）/ **2.167×**（844×390 @dpr3） | **修正**：方向对，**量级严重低估**。1920+dpr2 未测，按同式推算 4.0× |
| 2 | 主按钮白字 on `#f59e0b` = **1.70:1** | **1.00:1（最差）– 2.15:1（最好）**；静态 lint 另算 1.67:1（渐变顶 `#fbbf24`） | **修正**：1.70 甚至不在实测区间内。三处按钮同病（开始游戏 / 下一关 / 继续） |
| 3 | 未点亮星 **≈1.2:1** | **1.24:1**（`#e5e7eb` on 白） | **验证通过** |
| 4 | 锁定卡 `opacity:.55` → **≈2.5:1** | 锁定卡名称 **3.43:1**（`#8a7f6b` on `#f3efe6`，16px/700） | **修正**：机制与数值都不同。真凶是「次要灰棕文字」配色本身，不是整体不透明度 |
| 5 | 共 **14 处** emoji | 真实 DOM **20 个文本节点**：彩色 emoji **7 处 / 5 种**（🔊、🔄×3、😢、🏆、📱），单色字形 **13 处**（▶×3、☰×2、⛶×2、↻、✕×2、★×3） | **修正**：口径不同。真问题是**同一面板内彩色与单色混排** |
| 6 | `levels.js:54-55` 的 `w=0` / `w=2200` 岛画出贯穿横带 | 代码路径确认存在；**横带的肉眼可见性未量化** | **几何成立，视觉结论仍未验证** |
| 7 | 过关面板高 347 / 内容 396 / **溢出 49px** | 5 档视口：`越界元素 = 0`、`文档溢出 = 无`；`#levelOverlay .panel` 的 `scrollHeight ≤ clientHeight`。唯一 scrollH>clientH 的是星级行盒（51 vs 44，`overflow-y: visible`，不裁剪） | **推翻**（已测 5 档 + 已打开 3 个面板范围内不成立） |
| 8 | HUD 芯片字 **3.22:1** | **DOM 探针测不到**（HUD 画在 canvas 内部，不是 DOM 节点） | **仍未验证**，只能参考 C.5 目视 |
| 9 | 静态 lint **29 FAIL / 1 WARN** | 重建版覆盖 `game.js` 后：**37 FAIL / 161 WARN** | **口径不同**：附录 A 只扫了 `index.html` + `style.css`。分类见下 |

重建版 lint 分类：FAIL = 彩色 emoji 12、`shadow-ui` 10、静态对比度 6、`gradient-ui` 4、`easing-overshoot` 3、`missing-focus-visible` 1、`missing-reduced-motion` 1；WARN = `hardcoded-canvas-color` 45、`emoji-icon-glyph` 27、`outlined-box` 4，其余为 token 漂移逐项（15 档 font-size / 6 档 border-radius / 7 档 box-shadow）。

## C.3 实测确认的对比度问题

**不合格（8 处，全部为真实渲染 + 真实合成背景实测）**

| 元素 | 前景 | 实测背景 | 比值 | 字号 | 位置 |
|---|---|---|---|---|---|
| 开始界面提示 | `#9ca3af` | `#ffffff` | **2.54:1** | 12–14px/400 | `style.css:90` |
| 主按钮 开始游戏 | `#ffffff` | 渐变 `#fbbf24→#f59e0b` | **1.00–2.15:1** | 17–18px/700 | `style.css:151-152` |
| 过关主按钮 下一关 | `#ffffff` | 同上 | **1.00–2.15:1** | 17px/700 | 同上（`index.html:48`） |
| 视频窗按钮 从头开始 | `#ffffff` | 同上 | 同上 | 15px/700 | 同上（`index.html:82`） |
| 点亮星 ★ | `#f59e0b` | `#ffffff` | **2.15:1** | 38–44px | `style.css:95` |
| 未点亮星 ★ | `#e5e7eb` | `#ffffff` | **1.24:1** | 38–44px | `style.css:96` |
| 关卡卡序号 | `#8a7f6b` | `#fdf9f0` | **3.74:1** | 12.5px/700 | `style.css:127` |
| 锁定卡名称 / 星 | `#8a7f6b` | `#f3efe6`（`opacity:.55` 合成后） | **3.43:1** | 16px/700 · 13.5px | `style.css:136-137` + `:133` |

**通过（说明不是全站不可读，问题集中在这几处）**：开始标题 14.68:1、说明 7.56:1、次按钮 4.83:1、关卡卡名称 13.52:1、元信息 5.64:1、卡星 5.16:1、触屏按钮 15.29:1、竖屏提示主/副文案 16.87:1 / 6.96:1、竖屏仍要玩按钮 12.11:1。

**探针伪阳性（不要当成缺陷）**：`开始界面遮罩 1.18:1`、`触屏按钮条 1.18:1` —— 这两个容器自身没有文字，探针读到的是继承来的 `color:#000` 与深蓝背景。

## C.4 方案里没有、实测新发现的问题（全部带精确坐标）

1. **竖屏信息条被开始面板压住 14.4px**（390×844，点过「仍要竖屏玩」之后）：`#pvInfo` y=233.375 h=44 → 占 233.4–277.4；`#startOverlay .panel` y=263 h=318 → 占 263–581。**重叠 263–277.4**。截图 `mobile-portrait-390x844-play.png` 里信息条文字被白面板横向切断。
2. **横屏触控条压在画布上**（844×390）：canvas CSS 横跨 x=75.3–768.7；`#touchBar` x=620–834、y=10–56 → **与画布水平重叠 148.7px、垂直完全落在画布内**，且向右越出画布 65.3px。
3. **横屏手机上有 150.7px 横向死区**（视口 844 / 画布 693.3，左右各 75.3px）。配合 12px 圆角 + 重阴影，观感是「一张贴在深蓝底上的卡片」，不像游戏画面。
4. **触控条在同一台设备上跳位**：竖屏提示态 `x=166 y=10`、46px 按钮（右上角）；进入竖屏游玩后 `x=59 y=770`、56px 按钮（底部居中）。位置、尺寸、锚点三样全变。
5. **竖屏纵深有 189px 死区**：canvas 0–219.4 → 开始面板 263–581 → **空白 581–770** → 触控条 770–826 → 空白到 844。

## C.5 截图目视结论（真实帧，非估算）

- **奶龙**：`editor/_shots/desktop-1440x900-play.png` 里能直接看到「方块像素的黄头」嵌在「完美抗锯齿的黑粉矢量茧壳」中，外围还有柔边矢量飞溅点。**这是全站最刺眼的造型矛盾**，直接支持把它统一成单一绘画语言（用户决定 #2）。
- **画布发虚**：1.5× 位图放大下，草叶排线、木块边缘、角色像素块全部发虚；到 844×390 的 2.167× 时，角色已退化成「一个黑色 V 形 + 一张小脸」。
- **平台绘制残留**：右侧浮空平台内部有一条水平接缝，下方悬着两条细灰「腿」（`desktop-1440x900-play.png` 中 x≈1080 与 x≈1225），观感像未清理的中间态。
- **色板**：奶白天空 + 青绿/鼠尾草平台 + 暖棕木块 + 砖红太阳 + 琥珀 CTA；而 DOM 侧的幽灵按钮用 `#6b7280`（**冷灰偏蓝**，`style.css:164`），再叠加本身就是蓝色的彩色 `🔄`，在暖色面板上读起来就是「一颗蓝按钮」——canvas 美术里不存在这个蓝。这是「DOM 与画布两套语言」最直接的证据。
- **HUD 质感不一致**：「剩余 × 3」带灰色浮雕感（`text-shadow`），「得分 0」是平的，同一排两种质感。
- **触控条按钮**：4 个按钮中 `🔊` 渲染成蓝银配色的 3D 彩色 emoji，`⛶ ↻ ☰` 是白色单色字形 —— 同一条按钮里两种风格。

## C.6 对 §7 执行顺序的修正建议

P0 除了原有 15 条，**追加 3 条实测新增项**（都在 DOM 层，成本低）：

| 追加 | 内容 | 判据 |
|---|---|---|
| P0-16 | 修竖屏 `#pvInfo` 与 `#startOverlay .panel` 的 14.4px 重叠（改为文档流顺序或加安全间距） | 390×844 下两者矩形不相交 |
| P0-17 | 横屏触控条改为**不压画布**：要么让它进画布外的死区，要么给画布加安全内边距 | 844×390 下 `#touchBar` 与 canvas 矩形不相交 |
| P0-18 | 触控条定位稳定化：同一设备不同状态用同一锚点与同一按钮尺寸 | 竖屏两态下 `#touchBar` rect 一致 |

P1 追加一条：

| 追加 | 内容 |
|---|---|
| P1-12 | 画布尺寸策略：把 backing store 从写死 960 改为按 `clientWidth × devicePixelRatio` 动态分配（上限 2×，避免移动端显存爆掉），使 1440/1920 的 1.5×–2.0× 降回 1.0× |

**未验证、仍待确认的项**（不要当成已知结论）：`levels.js` 横带的肉眼可见性、HUD 芯片字的真实对比度（canvas 内无法用 DOM 探针测）、1920+dpr2 的 4.0× 推算值、`videoOverlay`/`loseOverlay` 两个未被打开过的面板的布局。

## C.7 工具本身的局限（诚实声明）

- 对比度探针测的是**元素自身的 `color`**，不是每一段文字的实际颜色；卡片类元素（`.lvcard`）读的是卡片的继承色，所以 C.3 表里锁定卡名称用的是它的子选择器 `#levelList .lvcard.locked .lvname`。
- **canvas 内部的一切都测不到**：HUD 芯片、emoji 图标、渐变、描边都在 `game.js` 里用 `ctx` 画，DOM 探针看不见。canvas 侧的问题只能靠**静态扫描 `game.js`（45 处 `hardcoded-canvas-color`）+ 截图目视**两条路。
- 溢出检测用的是「元素 rect 是否越出视口」，**不是**「父容器是否裁剪了子内容」；两者都做了，但都在已打开的界面状态下。
