# DDD · 开发日志

弹弓弹射 / 撞倒木块 / 四关闯关的水墨国风小游戏。
仓库：<https://github.com/jiuxian109/->

---

## 1. 怎么跑

纯静态，没有任何构建步骤 —— 直接用浏览器打开 `ggame/index.html` 即可。

```
ggame/
├── index.html                  页面骨架 + DOM 覆盖层（开始/通关/失败/选关弹窗）+ 触屏按钮条
├── style.css                   覆盖层、按钮、弹窗、星级动画、横竖屏布局
├── levels.js                   四关的岛与木块（纯数据，改摆放只动这里）
├── game.js                     全部游戏逻辑与渲染（单文件，约 1430 行）
├── lib/matter.min.js           Matter.js 物理引擎（离线内联，无 CDN 依赖）
├── assets/                     奶龙精灵图、通关视频
├── design-scene.html           场景重设计图（水墨国风）
├── design-levels.html          四关布局设计图
└── design-collision-l3.html    第 3 关碰撞体积图纸
```

> 注：`file://` 下由于画过 `assets/` 里的图片，canvas 会被标记为「已污染」，
> 调试脚本里的 `getImageData` 会抛 `SecurityError`。这只影响调试探针，不影响游戏本身。

## 2. 玩法

拖动奶龙往后拉，松手发射；把浮空岛上的木块**全部击倒**即通关。
每关给定奶龙发数（3 / 3 / 4 / 6），**剩余奶龙数决定星级**；通关进度存在浏览器里，下次打开可以接着打。
木块没有血量 —— 被撞得掉下岛、翻倒或挪位超过阈值就算「击倒」。

---

## 3. 提交时间线

| 时间 | 提交 | 内容 |
|---|---|---|
| 2026-10-13 17:46 | `bb94b2c` | Initial commit（原始单关版） |
| 2026-10-13 23:15 | `d74029b` | 重设计为多关卡击倒玩法并修复弹射 bug |
| 2026-10-14 10:50 | `5c69e38` | 更名 DDD、水墨国风视觉、四关重排与弹道修正 |
| 2026-10-14 10:54 | `798b970` | 用 .gitattributes 固定行尾为 LF |
| 2026-10-14 12:24 | `bda0fd6` | 奶龙下坠阶段额外增加 30% 重力 |
| 2026-10-14 17:10 | `43ebd64` | 撞击威力 200%、弹弓可平移、拖拽手感与音效体验优化 |
| 2026-10-14 20:35 | `d607e08` | 适配手机：竖屏提示、触屏按钮条、热区放大、iOS 全屏降级 |
| 2026-10-14 21:02 | `3462a9e` | 竖屏可玩选项（画面贴顶铺满，留白改操作区） |
| 2026-10-15 16:28 | `547a50f` | 关卡数据抽到 levels.js、加选关面板与进度存档 |

---

## 4. 开发日志

### 阶段 1 · 三个问题与整体重做（→ `d74029b`）

**起因**：原始版本有三个硬伤 ——
1. 奶龙飞出屏幕外之后，游戏卡住无法切换到下一只；
2. 木块带血条、需要反复击打直到「摧毁」，手感拖沓；
3. 整体不好玩，要求重新设计得有趣生动。

**做法**：
- 改为「**击倒**」判定取代血条。每帧检查三件事，满足任一即算击倒：
  ```js
  fell   = body.position.y > b.y0 + 22;   // 掉下去了
  tilted = Math.abs(body.angle) > 0.7;    // 翻了（约 40°）
  moved  = Math.abs(body.position.x - b.x0) > 45;  // 被推开了
  ```
  `b.x0 / b.y0` 是**关卡的原始坐标**，不随击飞更新 —— 所以多次轻推的位移会累积。
- 击倒后立刻移出 `blocks` 列表（立刻算通关进度），500ms 后才从物理世界移除（保留飞出去的视觉效果）。
- 一发的结束条件做全：奶龙出界（`y > 720` / `x > 1140` / `x < -140`）、所有非静态物体速度 ≤ 0.4 持续 400ms、或飞行超过 6000ms。
- 分成四关，奶龙数固定，剩余发数换算星级。

### 阶段 2 · 更名 DDD 与水墨国风（→ `5c69e38`）

**起因**：先做了一版「云端恐龙乐园」晨光卡通风的设计图，用户不满意，要求换风格。
给了三个方向，用户选定**水墨国风**。

**做法**：渲染层整层重写，全部用 canvas 手绘（没有引入任何位图素材）：

| 元素 | 处理 |
|---|---|
| 底色 | 宣纸渐变 `#faf5e8 → #f4ecd9 → #ece3cb` |
| 太阳 | 朱砂 `rgb(192,57,43)` 实心圆 + 径向光晕 |
| 远山 | 三层淡墨剪影 `#b8b1a2` / `#8a8374` / `#5c574b` |
| 浮空岛 | 青绿山石 `#7a9c80 → #5f8470 → #3f5f52`，带苔草、苔点、垂藤 |
| 木块 | 赭木 `#c29a6b → #9a7048` + 木纹 |
| 弹弓 | 墨笔 Y 形：变宽笔触 `inkCurve()` 逐段采样二次贝塞尔成一条闭合路径；珊瑚红皮筋 `#f2736a`；固定种子的墨点飞溅 |

同时把木块**从贴底抬到画面中上部**（用户要求「木块位置可以在界面上面，不一定在界面最下面」），
浮空岛由 `top = 470` 上移到 280～440，逼出真正的抛物线射击。

**弹道预演的 bug（重点）**：
用户反馈「轨迹线和实际不一样」。根因是预演循环里写了 `vel.y += engine.gravity.y`（= 1.0），
而 Matter 每步真实的冲量是：

```
gravity.y × gravity.scale × dt²  =  1.0 × 0.001 × (1000/60)²  =  0.2778
```

**约 3.6 倍过大**，而且完全忽略了 `frictionAir`。改成照引擎公式积分：

```js
const gravAcc   = engine.gravity.y * engine.gravity.scale;
const baseDelta = Matter.Common._baseDelta || STEP;
const air       = 1 - bird.frictionAir * (STEP / baseDelta);
// 每步：
vx *= air;
vy = vy * air + gravAcc * STEP * STEP;
```

修正后与真实飞行路径对跑 **8 种拉法，最大偏差 0.000px**（原来是 420～675px）。

### 阶段 3 · 行尾统一（→ `798b970`）

加 `.gitattributes`，内容 `* text=auto eol=lf`，避免 Windows 上 CRLF 污染 diff。

### 阶段 4 · 奶龙下坠加重力（→ `bda0fd6`）

**起因**：用户说「修改奶龙加速度（增大）」，追问两轮后确认 —— 要的其实是**重力**，
并且只在**奶龙开始下坠（vy > 0）之后**额外加 **30%**，木块与四关难度一律不碰。

**做法**：
```js
const FALL_GRAVITY_BOOST = 0.3;
// 在 Engine.update 之前：
if (bird.velocity.y > 0) bird.force.y += bird.mass * engine.gravity.y * gravity.scale * FALL_GRAVITY_BOOST;
```
刻意**不去改 `engine.gravity`** —— 那样木块会跟着一起变重，关卡手感会整体走样。
`drawTrajectory()` 同步加了下坠分支，保证预演虚线依然和实际一致。

实测：同一次拉法，第 34 帧奶龙比原来低 **27px**，长弧线最大差 **131px**；
短射几乎无感，需要打高抛时才明显「压下来」。

### 阶段 5 · 撞击威力（+100% → +150% → +200%）

**起因**：用户要「增大奶龙下落时威力」。追问确认三点：
含义 = 撞得更狠、生效时机 = **只在撞到木块那一瞬间**（飞行过程完全不变）、力度从 +100% 起。

**做法**：在 `collisionStart` 里插手，对**木块**补一份冲量：
```js
const IMPACT_BOOST = 2.0;   // +200%（用户最终要求）
```
三道门：① 必须处于 `flying` 且有奶龙；② 碰撞对里必须一个是 `bird`、一个是 `block`；
③ 用 `bird._preVy > 0` 只认「下坠中命中」。

两个关键点：

- **必须用 `Body.setVelocity()`**。Matter 是 Verlet 积分，直接写 `body.velocity` 会在下一步被 `Body.update` 覆盖掉，等于没改。
- **只推木块、从不碰奶龙** —— 这样出手弧线、落点、预演虚线**完全不变**，兑现「轨迹和落点都不变」这条要求。

**踩的坑**：第一版直接沿奶龙的速度方向推，结果木块坐在岛面上、被**往岛里面按**，
总位移反而从 35px 掉到 29px。改成「把竖向分量翻成往上掀一小份」后，总位移 35 → 138px（约 4 倍）。

### 阶段 6 · 四关通关性验证

用**真实的 Matter 引擎**离线复现整个游戏（关卡数据、夹取规则、出手公式、结束条件、击倒判定全部照抄），
再做束搜索。拉法参数严格按游戏的可达集合：**相对 `ANCHOR` 的偏移** `hypot ≤ 130`，且 `ty ≤ 442`、`tx ≥ 40`。

| 关卡 | 奶龙上限 | 原版 | +150% | +200% |
|---|---|---|---|---|
| 第 1 关 云间初试 | 3 | 1 发 | 1 发 | 1 发 |
| 第 2 关 叠叠高 | 3 | 2 发 | 2 发 | 2 发 |
| 第 3 关 一柱擎天 | 4 | 3 发 | 2 发 | 2 发 |
| 第 4 关 巅峰论道 | 5 | ✗ 打不完（剩 4 块） | 3 发 | 3 发 |

> ⚠️ **本表已过期**：它算的是 `43ebd64` 时的关卡数据。阶段 13 把第 3 关木块 10 → 12、
> 第 4 关木块 16 → 18 且奶龙 5 → 6，**这张表不能再当作当前关卡的难度依据**，
> 要拿新的 `levels.js` 重跑一遍束搜索。

**结论**：撞击威力真正救活的是**第 4 关** —— 没有它这关在 5 发内打不完。
而 +200% 相比 +150% 只是**温和加强**（平均每发多击倒 0.03～0.05 块），不是翻倍。

### 阶段 7 · 浮空岛改长方形

**起因**：用户三次修正需求（椭圆 → 椭圆长方形 → 长方形），最后确认四个细节：
四角小圆角 / 只把斜边拉直 / 苔草苔点垂藤全保留 / **只改浮空岛，发射台保持梯形**。

**做法**：`addIsland()` 里标记 `pad: top >= 460`（发射台都是 `top: 470`），绘制时分两支 ——
浮空岛走 `roundRect`（半径 `min(12, h*0.22)`，`h=100` → 12px），顶部受光带与苔草带用 `ctx.clip()` 裁在圆角矩形内。
**碰撞体完全没动**（仍是 `Bodies.rectangle`），所以物理和通关性都不受影响。

### 阶段 8 · 第 3 关碰撞体积图纸

输出 `design-collision-l3.html`：960×540 世界 + 20/100 网格标尺，画出两座岛的碰撞矩形、
10 块木块（B1–B10）、奶龙圆、**拖拽可达范围**（以 `ANCHOR` 为心 `r = 130`，被 `y ≤ 442` 切掉下半），
外加一张 13 行「全部碰撞体清单」表（构造方式 / label / 中心 / 尺寸 / 面积 / 质量 / 物理参数）。

### 阶段 9 · 弹弓可以在发射台上平移

**需求确认**：直接拖弹弓（拖叉尖或手柄）来移位 · 中心限定在岛内留边距 `x ∈ [70, 300]` ·
只要在**瞄准状态**就能移 · 拖奶龙仍然是发射。

**做法**：
```js
const SLING_MIN_X = 70, SLING_MAX_X = 300, SLING_HOME_X = 185, PRONG_DX = 33;
let slingX = SLING_HOME_X;

function setSlingX(v) {
  slingX = Math.max(SLING_MIN_X, Math.min(SLING_MAX_X, v));
  SLING_BASE.x = slingX;
  PRONG_L.x = slingX - PRONG_DX;  PRONG_R.x = slingX + PRONG_DX;
  ANCHOR.x  = slingX;
  POCKET.x  = slingX;
  if (bird && (state === 'ready' || state === 'movingSling'))
    Body.setPosition(bird, { x: POCKET.x, y: POCKET.y });   // 奶龙跟着皮兜走
}
```
- 热区 `slingHit(p)`：横向 `|p.x - slingX| ≤ 61`，纵向分两段 —— 叉尖 `y ∈ [326, 360]`、手柄 `y ∈ [408, 486]`，中间那段留给奶龙本体。
- `pointerdown` 的判定顺序：重开按钮 → 弹弓 → 奶龙。
- 发射台画一条墨绿虚线导轨（`y = 477`，从 70 到 300）提示边界；每关开局 `setSlingX(SLING_HOME_X)` 归位。
- 墨点飞溅是固定种子的绝对坐标，绘制时整体偏移 `slingX - SLING_HOME_X` 使其跟着走。

**踩的坑**：第一版 `setSlingX` 里只写了 `state === 'ready'`，可拖弹弓时状态已经变成 `'movingSling'`，
结果奶龙留在原地、皮筋被拉成一条斜线 —— 截图一眼就看出来了。

### 阶段 10 · 拖拽手感与音效（→ `43ebd64`）

- **拖拽可视化**：新增渐变箭头（从奶龙朝**发射方向**，长度 46→196px、粗细 4→13px 随力度增长，
  颜色由青绿 `rgb(95,132,112)` 渐变到朱砂 `rgb(192,57,43)`）+ 奶龙身上的力度环；
  力度不足时箭头变灰，并在锚点画出虚线**死区圈**。
- **阻尼跟随**：奶龙不再硬跟指针，改用 `FOLLOW_TAU = 45ms` 的一阶阻尼，有「皮筋绷住」的橡胶感，微调角度也更稳。
- **最小力度 `MIN_PULL = 30`**：拉不到就松手 → 取消发射，奶龙 180ms 缓动弹回皮兜，**不扣奶龙数**。
- **松手过渡**：松手后先花 90ms 缓动滑到指针最后指的位置，再交给物理，减少手滑误发射。
- **修掉一个真 bug**：力度判定原来看奶龙的**实际位置**，而奶龙是阻尼跟随、会落后指针，
  于是一次**一帧内完成的快速甩手**会被误判成「拉太短」而取消。改成按**指针最后指的位置**判定：
  ```js
  const pull = Math.hypot(dragTarget.x - ANCHOR.x, dragTarget.y - ANCHOR.y);
  ```
- **弹窗动画**：失败弹窗弹入（`scale 0.86 → 1.03 → 1`）+ 懊恼地左右晃两下；星级逐个弹出；覆盖层淡入。
- **音效**：重写音频层 —— 用**噪声音源 + 低通 + 快速衰减**做木质闷响、用**扫频拨弦**做发射、
  用**四音琶音**（C5-E5-G5-C6）做通关；撞击音按力度分档并 **60ms 节流**（避免密集碰撞炸成噪音）；
  HUD 新增 🔊 / 🔇 静音开关。

### 阶段 11 · 适配手机（→ `d607e08`）

**起因**：手机上基本没法玩 —— 画布挤在屏幕中间一小条，画布右上角那三个指甲盖大的芯片点不中，
手指按在奶龙身上却抓到了弹弓。

**做法**：

- **热区按 CSS 像素算，不按世界坐标**。世界固定 960 宽，手机上可能只显示 390 ——
  同一个「26px 半径」到手上只剩 10 个 CSS px。于是加一个换算 + 一个下限函数：

  ```js
  function cssPx(n) {                        // 世界长度 → CSS 像素长度
    const r = cv.getBoundingClientRect();
    return r.width > 0 ? n * (WORLD_W / r.width) : n;
  }
  function touchHit(px, base) { return touchUI ? Math.max(base, cssPx(px)) : base; }
  ```

  三处热区全部改走它：奶龙抓取半径 `touchHit(52, 70)`（`game.js:541`）、
  弹弓横向 `touchHit(34, PRONG_DX + 28)`（`game.js:294`）、
  奶龙与弹弓之间那条「奶龙专属竖带」`Math.max(BIRD_R, cssPx(17))`（`game.js:299`）。
  **桌面端 `touchUI === false`，取的全是原来的 `base` 值，一点没变** —— 这是刻意留的，
  手机上放大热区绝不能反过来影响桌面手感。

- **触屏判定**：`matchMedia('(hover: none) and (pointer: coarse)')`，外面套 `try/catch`
  （老浏览器不认这语法会抛），失败再回落 `'ontouchstart' in window && navigator.maxTouchPoints > 0`。

- **按钮从画布搬到 DOM**：画布上那三个芯片在手机上太小，新增 `#touchBar`
  （🔊 / ⛶ / ↻ / ☰ 四个 `<button>`，各 46×46 CSS px）。触屏下画布上的芯片**不再绘制、热区一并关掉**，
  否则两层重叠、点击范围打架。发数信息挪到左上角一列。

- **iOS 全屏降级**：iPhone 上 `body.requestFullscreen` 根本不存在，与其留个点了没反应的按钮，不如不显示：

  ```js
  const canFullscreen = !!(document.body.requestFullscreen || document.body.webkitRequestFullscreen);
  ```

  不支持时隐藏开始界面的 `#fsBtn` 和按钮条里的 `#tbFull`。

- **禁掉浏览器手势**：`html/body` 上禁页面滚动、下拉刷新、双击缩放，长按不弹系统菜单
  （`contextmenu` 只在 `touchUI` 时才 `preventDefault` —— 桌面右键还是要有反应）；
  按钮单独给 `touch-action: manipulation`，去掉 300ms 点击延迟。

- **竖屏提示**：新增 `#rotateOverlay`，CSS 三重限定 `(orientation: portrait) and (hover: none) and (pointer: coarse)`。
  加后两条是因为**只用 `orientation: portrait` 会让桌面用户把窗口拉窄就误触发**。

### 阶段 12 · 竖屏可玩（→ `3462a9e`）

**需求确认**：光提示「请把手机横过来」不够，用户要一个「仍要竖屏玩」的选项。
追问后确认：**不记住** —— 下次进来还要再问一次。

**做法**：

- `#portraitPlay` 按钮 → `document.body.classList.add('pv')`，代码注释里专门写死「不写 localStorage」。
- 用 `matchMedia('(orientation: portrait)')` 的 change 事件：转回横屏就 `remove('pv')`，
  再转回竖屏重新弹提示 —— 正好兑现「不记住」。
- `.pv` 下画面贴顶铺满宽度（390 宽的手机上得到 **390×219**），`#game` 去掉圆角和阴影，
  剩下的留白全变成操作区。
- **画布 HUD 不画了**：竖屏画面只有屏幕宽度的 2/5，画布上的字缩到看不清。
  新增 `#pvInfo` DOM 信息条紧贴画面下方显示「关卡 · 剩余 × N · 得分 N」，
  并且**只在字符串真的变了才写 DOM**：

  ```js
  const s = LEVELS[levelIndex].name + ' · 剩余 × ' + shotsLeft + ' · 得分 ' + score;
  if (s !== lastPvInfo) { lastPvInfo = s; pvInfoEl.textContent = s; }
  ```

- 按钮条在 `.pv` 下从画面右侧移到**画面底部居中**，46×46 → **56×56**，落进拇指区。

**踩的坑**：竖屏下画面被压扁，奶龙和弹弓在屏幕上的距离变小，
那条「奶龙专属竖带」按世界坐标算（26px）会窄到只剩几像素 —— 手指点在奶龙身上被判成抓弹弓。
改成 `.pv` 下按 CSS 尺寸撑开至少 34 CSS px；横屏手机与桌面端取值不变。

### 阶段 13 · 关卡数据外置 + 选关 + 进度存档（→ `547a50f`）

**起因**：三件互相咬合的事 —— 关卡数据埋在 `game.js` 的 `LEVELS` 数组里，改个木块摆放要翻代码；
四关只能从头顺着打；星级只在当次会话里，关掉就没了。

**做法**：

- **数据外置**：四关的岛与木块搬到 `ggame/levels.js`，挂成 `window.DDD_LEVELS`。
  文件顶部写了 46 行注释：坐标系、每个字段的含义、「放到岛面 `y = 岛.top − h/2`」这类摆放规律，
  以及五条「别踩的坑」（`y < 96` 是 HUD 区、木块别贴出岛沿、别放到弹弓能平移的 `x < 300` 区域……）。
  `index.html` 里 **`levels.js` 必须排在 `game.js` 之前**；`game.js:202` 拿到后还会校验一次，
  缺了就把页面换成一句中文报错再 `throw`，免得白屏。

- **选关面板**：开始界面加「☰ 选关」，四张卡片各写关卡名 / 奶龙数 / 木块数 / 本关星级。渐进解锁：

  ```js
  function isUnlocked(i) { return i === 0 || !!progress.cleared[i - 1]; }
  ```

  未解锁的卡片 `disabled`、变灰、带 🔒。**卡片 `disabled` 只挡鼠标，不是安全边界** ——
  所以真正的闸门只有一处，`startLevel(i)` 里的 `if (!isUnlocked(n)) return;`，
  「下一关」按钮也走这个函数。

- **进度存档**：`localStorage` 键 `ddd.progress.v1`，只存两样 —— 通没通关、最好成绩几星
  （`Math.max(旧, 新)`，**只增不减**）。读的时候整个 `try/catch` 兜住，
  隐私模式 / 被禁用时**静默降级成只在内存里记**，绝不因为存档失败把游戏卡住。

- 有进度时开始界面主按钮明写「**▶ 继续第 N 关**」（N = 第一个没通关的关）。

**这个提交里还顺手改了两关的关卡数据**（和上面三件事混在一起了，事后看应该拆开）：
第 3 关木块 10 → 12，第 4 关木块 16 → 18、奶龙 5 → 6，第 4 关又加了一座岛。
**旧日志「阶段 6 · 四关通关性验证」的结论从这一刻起失效**，那套束搜索得拿新的 `levels.js` 重跑。

**踩的坑（重要）**：第 1 关的 `islands` 里多了两条看着像「隐形挡板」的东西 ——

```js
{ cx: 756, top: 104, w: 0,    h: 100 },
{ cx: 556, top: 110, w: 2200, h: 100 }
```

`w: 2200` 比整个世界（960）还宽一倍多，`w: 0` 干脆没有宽度。本意大概是「不显示出来的墙」，
但 `drawIsland()` 是照**真实的 w** 画的：

```js
roundRect(x - w / 2, top, w, h, r);   // game.js:728
```

结果 `w: 2200` 那条**被画成一整条横贯全屏的色带**（无头 Edge 截图一眼可见），
`w: 0` 那条只剩一撮浮在空中的草。而且它们是真的静态刚体 —— **会挡住高抛的奶龙**。
要隐形挡板必须另加一个 `hidden` 标志位让绘制跳过，不能靠宽度取巧。

---

## 5. 关键常量总表

```js
// 世界
const WORLD_W = 960, WORLD_H = 540, STEP = 1000 / 60;
engine.gravity = { x: 0, y: 1, scale: 0.001 };

// 弹弓（x 随 slingX 平移）
SLING_BASE = (185, 470)   PRONG_L = (152, 350)   PRONG_R = (218, 350)
ANCHOR     = (185, 360)   POCKET  = (185, 384)
SLING_MIN_X = 70   SLING_MAX_X = 300   SLING_HOME_X = 185   PRONG_DX = 33

// 发射
MAX_DRAG = 130   LAUNCH_K = 0.25   BIRD_R = 26
MIN_PULL = 30    FOLLOW_TAU = 45
v = (ANCHOR - pos) × LAUNCH_K

// 力度增益
FALL_GRAVITY_BOOST = 0.3    // 奶龙 vy > 0 时额外 30% 重力
IMPACT_BOOST       = 2.0    // 下坠中命中木块时补两份冲量（+200%）

// 触屏（桌面端 touchUI === false，下面一律取 base 原值，手感毫不受影响）
touchUI            = matchMedia('(hover: none) and (pointer: coarse)')  // try/catch 后回落 ontouchstart
cssPx(n)           = n × (WORLD_W / canvas 的 CSS 宽度)      // 世界长度 → CSS 像素长度
touchHit(px, base) = touchUI ? max(base, cssPx(px)) : base
// 热区：奶龙抓取 touchHit(52, 70) · 弹弓横向 touchHit(34, PRONG_DX + 28)
//       奶龙竖带 touchUI ? max(BIRD_R, cssPx(17)) : BIRD_R

// 存档
PROGRESS_KEY = 'ddd.progress.v1'   // { cleared: [bool], stars: [0..3] }
```

| 物体 | 构造 | 物理参数 | 质量 |
|---|---|---|---|
| 奶龙 | `Bodies.circle(POCKET.x, POCKET.y, 26)` | `density 0.0025, friction 0.6, frictionAir 0.008, restitution 0.35` | 5.309 |
| 木块 | `Bodies.rectangle(x, y, 44, 44)` | `density 0.0008, friction 0.5, restitution 0.18` | 1.549 |
| 岛 | `Bodies.rectangle(cx, top + h/2, w, h)` | `isStatic, friction 0.9, restitution 0.1` | ∞ |

| 关卡 | 名称 | 奶龙 | 木块 | 浮空岛（cx, top, w×h） |
|---|---|---|---|---|
| 1 | 云间初试 | 3 | 6 | (640, 390, 300×100) · (756, 104, 0×100)⚠️ · (556, 110, 2200×100)⚠️ |
| 2 | 叠叠高 | 3 | 9 | (560, 440, 260×100) · (880, 300, 180×100) |
| 3 | 一柱擎天 | 4 | 12 | (522, 310, 300×100) |
| 4 | 巅峰论道 | 6 | 18 | (588, 280, 240×100) · (880, 350, 220×100) · (124, 100, 300×100) |

关卡数据现在住在 `ggame/levels.js`（`window.DDD_LEVELS`），**改摆放只动那个文件，上面这张表要与它保持一致**。

四关的发射台都是 `(cx 150, top 470, 320×120)`，**别动**：弹弓常量 `SLING_BASE / ANCHOR / POCKET`
写死在 `(185, 470) / (185, 360) / (185, 384)`，不跟着岛的 `top` 走，改了发射台高度弹弓就浮空了。

⚠️ 带 ⚠️ 的两条见阶段 13 的踩坑 —— 它们很可能是笔误而不是设计。

**世界边界**：没有地面、也没有墙 —— 岛是唯一支撑体，没接住的东西会直接掉出画面。

---

## 6. 踩坑记录

| 坑 | 教训 |
|---|---|
| 预演弹道用 `vel.y += gravity.y` | Matter 每步冲量是 `gravity.y × gravity.scale × dt²`，还要乘 `frictionAir` 阻尼；**预演必须照引擎公式积分** |
| 撞击威力第一版把木块往岛里按 | 推力的竖向分量要翻成「往上掀一小份」，绝不能顺着速度往地面按 |
| 直接写 `body.velocity` | Matter 是 Verlet 积分，**必须用 `Body.setVelocity()`** |
| 拖动弹弓时奶龙不跟 | `setSlingX` 的同步条件漏了 `'movingSling'` 状态 |
| 一帧内快速甩手被误判取消 | 力度判定要用**指针目标位置**，不能用阻尼跟随的奶龙实际位置 |
| Windows PowerShell 5.1 读写源文件 | 默认按 ANSI(GBK) 处理无 BOM 的 UTF-8 文件 → 中文乱码、注释里的「。」吃掉换行引发 `SyntaxError`。**读用 `-Encoding UTF8`，写用 `[System.IO.File]::WriteAllText(..., UTF8Encoding($false))`** |
| `file://` 页面里跨文件脚本报错 | 错误被遮蔽成 `Script error. @0:0`。调试时必须把 `style.css` / `matter.min.js` / `game.js` **全部内联**进页面副本 |
| `--dump-dom` 里 grep 标记 | 内联的 `matter.min.js` 是**一整行**，`Select-String` 会匹配到十几万字符。要改用正则抽取探针 `div` 的文本 |
| 想用 `w: 0` / `w: 2200` 的岛做「隐形挡板」 | `drawIsland()` 照**真实 w** 画：`w: 2200` 横贯全屏成了一条色带，`w: 0` 只剩一撮浮空的草。**要隐形就加绘制标志位，别靠宽度取巧** |
| 手机上手指抓错了目标 | 世界固定 960 宽、手机只显示 390 —— 同一个 26px 半径到手上只有 10 个 CSS px。**热区一律按 CSS 像素定下限**（`cssPx` + `touchHit`），并且让桌面端原样取 `base` 值 |
| 竖屏下点奶龙被判成抓弹弓 | 画面被压扁后，「奶龙专属竖带」按世界坐标算只剩几像素；要在 `.pv` 下按 CSS 尺寸撑开 |
| 竖屏提示在桌面误触发 | 只用 `(orientation: portrait)` 不够 —— 桌面把窗口拉窄就会弹；必须再加 `(hover: none) and (pointer: coarse)` |
| 靠选关卡片的 `disabled` 当关卡锁 | 它只挡鼠标，不是边界。真正的闸门要放在 `startLevel()` 里，因为「下一关」按钮绕过了卡片 |
| `localStorage` 在隐私模式会抛 | 读写全部 `try/catch`，失败就静默退回内存 —— **存档失败不能把游戏卡住** |

---

## 7. 调试方法（可复用）

没有依赖任何浏览器自动化框架 —— 直接用无头 Edge + 截图 + 一个探针 `div`：

```powershell
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
& $edge --headless=new --no-sandbox --disable-gpu --hide-scrollbars `
        --user-data-dir=$dir\_edgeprof --window-size=960,540 `
        --virtual-time-budget=2500 --screenshot=out.png "file:///.../page.html"
```

几个要点：

1. **内联一切**，否则跨源脚本错误解不开。
2. **CSS 视口 ≠ 窗口尺寸**（Windows 显示缩放 135% 时 `--window-size=960,540` 得到的是 707.55×398 的视口）。
   游戏坐标 → 客户端坐标换算必须走 `getBoundingClientRect()`：
   ```js
   function toClient(gx, gy) {
     const r = cv.getBoundingClientRect();
     return { x: r.left + gx * (r.width / 960), y: r.top + gy * (r.height / 540) };
   }
   ```
   否则合成的 `PointerEvent` 会落到错误的地方（这个坑排查了很久）。
3. 预览某一关：把硬编码的入口 `buildLevel(0);` 换成 `buildLevel(N);`
   （注意 `restart()` 用的是 `buildLevel(levelIndex)`、下一关用的是 `buildLevel(levelIndex + 1)`，别改错）。
4. **想截某个特定界面**（开始页 / 选关面板 / 打进某一关）：把 `index.html` 复制一份，
   在 `</body>` 前插一段自动点击：

   ```html
   <script>window.addEventListener('load', function () {
     setTimeout(function () { document.getElementById('startBtn').click(); }, 400);
   });</script>
   ```

   `startBtn` / `selectBtn` / `nextBtn` 都能这么点。**这一招比合成 `PointerEvent` 靠谱得多** ——
   完全不受上面「CSS 视口 ≠ 窗口尺寸」那个坑的影响。
5. 探针只报 `frames` 和 `window.onerror` —— **不要取像素**，`file://` 下 canvas 已污染。

物理/数值验证则不碰浏览器：用 Node 直接 `require` 真实的 `matter.min.js`，
把 `game.js` 里的函数体按花括号配对抽出来 `new Function()` 还原，就能对着同一个引擎离线跑成千上万次。

---

## 8. 已知限制 / 后续可做

- ~~关卡数据硬编码在 `game.js` 的 `LEVELS` 数组里~~ → 已抽到 `ggame/levels.js`（阶段 13）。
  改摆放只动那个文件；但它仍然是**手写坐标**，配套的图形化编辑器 `editor.html`
  没有进版本库（`.gitignore` 里忽略了 `editor/` 目录）。
- `game.js` 是约 1430 行的单文件，物理、渲染、输入、音频、UI、选关、存档全在一起；再长就该拆模块了。
- ~~没有存档 / 最高分记录~~ → 已有 `localStorage` 进度（阶段 13），
  但**只存「通没通关」和「最好几星」，不存分数**，也没有全局最高分 / 排行榜。
- **关卡的通关性没有重新验证过**。阶段 13 改了第 3、4 关的木块数和第 4 关的奶龙数，
  而阶段 6 那张表算的是旧数据 —— 改动后是否仍在合理发数内可通关，目前是未知的，
  要用新的 `levels.js` 重跑一遍束搜索。
- **第 1 关那两条岛（`w: 2200` / `w: 0`）很可能不是有意设计**（见阶段 13 的踩坑）：
  `w: 2200` 横贯全屏而且是真挡板，`w: 0` 只剩一撮浮空的草。要么给绘制加 `hidden` 标志，要么删掉。
- 竖屏玩法是**妥协方案**：画面只有 390×219，HUD 靠 DOM 信息条补，体验明显不如横屏。
  真正的竖屏适配（重排关卡、改世界比例）没做。
- 通关视频 `assets/video_20261012_175751.mp4` 约 2MB，目前只在通关弹窗里播；可以考虑换成更短的片段或压一压。
