/* DDD —— 弹射撞倒木块闯关（多关卡 · 水墨国风 · 评分星级） */
(function () {
  'use strict';

  // ---------- 基础常量 ----------
  const WORLD_W = 960, WORLD_H = 540;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const pvInfoEl = document.getElementById('pvInfo');   // 竖屏游玩时画面下方的 DOM 信息条

  // ---------- 视觉 token ----------
  // 与 style.css 的 :root 一一对应。画布上只许出现这几支颜色 ——
  // 纸、墨、朱砂、石绿、木、远山。别处不要再写裸色值。
  const C = {
    paper:    '#faf5e8',
    paper2:   '#f2e9d6',
    paper3:   '#e8dcc3',
    ink:      '#1e1b18',   // 浓墨
    ink2:     '#4a4438',   // 中墨
    ink3:     '#6b6353',   // 淡墨
    wash:     '#6f6a5f',   // 墨晕（罩染用）
    seal:     '#b23a2e',   // 朱砂
    sealDeep: '#8f2c22',
    jade:     '#5f8470',
    jadeMid:  '#7a9c80',
    jadeDeep: '#3f5f52',
    moss:     '#93ad76',
    mossDeep: '#6d8a58',
    wood:     '#9a7048',
    woodLite: '#c29a6b',
    dragon:   '#f6c044',   // 奶龙的身体：暖黄（纸面世界里唯一的一抹兽色）
    hill1:    '#b8b1a2',
    hill2:    '#8a8374',
    hill3:    '#5c574b'
  };
  // 画布字体。HUD 用黑体：17px 的小字上宋体发糊，宋体只用在 CSS 那侧的大标题上。
  const FONT_UI = '"Microsoft YaHei","PingFang SC","Segoe UI",sans-serif';

  // ---------- 画布分辨率 ----------
  // 原来 canvas 的 width/height 写死在 index.html 里（960×540），再由 CSS 拉满容器：
  // 1440 宽的窗口就是拿 960 像素去铺 1440 个 CSS 像素，dpr=2 时实际拉到 3 倍，
  // 整幅画面（以及贴在上面的位图奶龙）都是糊的。
  // 现在后备缓冲按「实际显示尺寸 × devicePixelRatio」分配，再把 ctx 整体缩放回去，
  // 所有绘制代码继续用 960×540 的世界坐标，一行都不用改。
  const MAX_BACKING_W = 2560;   // 上限：再大只是白烧显存，肉眼已经分不出来
  let viewScale = 1;            // 世界坐标 → 后备像素的倍率

  function resizeCanvas() {
    const r = canvas.getBoundingClientRect();
    if (!(r.width > 0)) return;
    const dpr = window.devicePixelRatio || 1;
    let w = Math.round(r.width * dpr);
    if (w > MAX_BACKING_W) w = MAX_BACKING_W;
    if (w < 320) w = 320;
    const h = Math.round(w * WORLD_H / WORLD_W);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;      // 改 width 会清空画布并重置 ctx 状态，所以只在真变了的时候写
      canvas.height = h;
    }
    // 高度写死成 px：否则 CSS 的 height:auto 会跟着后备缓冲的比例走，
    // 后备尺寸取整后比例差一点点，可能反过来触发 ResizeObserver 来回震荡。
    const wantH = (r.width * WORLD_H / WORLD_W).toFixed(2) + 'px';
    if (canvas.style.height !== wantH) canvas.style.height = wantH;
    viewScale = w / WORLD_W;
  }
  // 观察回调里直接改尺寸会踩到 "ResizeObserver loop" 警告，统一推迟到下一帧
  let resizeQueued = false;
  function queueResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(function () { resizeQueued = false; resizeCanvas(); });
  }
  resizeCanvas();
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(queueResize).observe(canvas);   // 弹窗、全屏、竖屏切换全都能兜住
  }
  window.addEventListener('resize', queueResize);
  window.addEventListener('orientationchange', queueResize);
  document.addEventListener('fullscreenchange', queueResize);
  document.addEventListener('webkitfullscreenchange', queueResize);

  // ---------- Matter 初始化 ----------
  const { Engine, Bodies, Body, Composite, Events } = Matter;
  const engine = Engine.create();
  engine.gravity.y = 1.0;
  engine.gravity.x = 0;
  const world = engine.world;

  // ---------- 弹弓 ----------
  const SLING_BASE = { x: 185, y: 470 };
  const PRONG_L = { x: 152, y: 350 };
  const PRONG_R = { x: 218, y: 350 };
  const ANCHOR = { x: 185, y: 360 };
  const POCKET = { x: 185, y: 384 };
  const MAX_DRAG = 130;
  const LAUNCH_K = 0.25;
  const BIRD_R = 26;
  // 弹弓能在发射台（I1，x = -10 … 310）上左右平移：中心 x 限制在这个区间内，两端都不会滑出岛面。
  const SLING_MIN_X = 70, SLING_MAX_X = 300;
  const SLING_HOME_X = 185;    // 每关开局回到发射台正中
  const PRONG_DX = 33;         // 两个叉尖相对弹弓中心的横向偏移
  let slingX = SLING_HOME_X;   // 弹弓当前中心 x
  // 奶龙「开始下坠」之后额外追加的重力比例：上升段完全不变，只有 vy > 0 的那一段掉得更快。
  // 木块不吃这个加成（改的是 bird 自身的受力，不是 engine.gravity）。
  const FALL_GRAVITY_BOOST = 0.3;
  // 奶龙「下坠中砸中木块」那一下的额外冲量：按撞击时的动量，再给木块补一份。
  // 1.0 = 补一份（冲击翻倍），1.5 = 补一份半，2.0 = 补两份（冲击三倍）。只推木块、不动奶龙 —— 出手弧线、落点、预演虚线全都不变。
  const IMPACT_BOOST = 2.0;

  const RESTART_RECT = { x: WORLD_W - 150, y: 50, w: 140, h: 34 };
  const MUTE_RECT = { x: WORLD_W - 198, y: 12, w: 40, h: 34 };
  const FULLSCREEN_RECT = { x: WORLD_W - 246, y: 12, w: 40, h: 34 };
  const SELECT_RECT = { x: WORLD_W - 324, y: 12, w: 70, h: 34 };

  // ---------- 触屏适配 ----------
  // 触屏（手机/平板）走另一套 UI：画布右上角的三个小芯片换成页面上的大按钮条，
  // 芯片整体放大；奶龙抓取半径与弹弓热区按「至少 52 CSS px」放大，免得手指点不中。
  const touchUI = (function () {
    try {
      if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return true;
    } catch (err) { /* 老浏览器不支持带参数的 matchMedia */ }
    return ('ontouchstart' in window) && (navigator.maxTouchPoints > 0);
  })();
  // iOS Safari 的 requestFullscreen 只对 <video> 有效，没有就干脆别显示全屏按钮
  const canFullscreen = !!(document.body.requestFullscreen || document.body.webkitRequestFullscreen);
  // 把「想要的 CSS 像素」换算成世界单位（960 宽的世界被缩放到 r.width 个 CSS 像素）
  function cssPx(n) {
    const r = canvas.getBoundingClientRect();
    return (r.width > 0) ? n * (WORLD_W / r.width) : n;
  }
  // 至少 base、触屏上至少 px 个 CSS 像素
  function touchHit(px, base) { return touchUI ? Math.max(base, cssPx(px)) : base; }

  // ---------- 状态 ----------
  let bird = null;
  let blocks = [];
  let knockedBodies = [];
  let islands = [];
  let particles = [];
  let popups = [];
  let levelIndex = 0;
  let shotsLeft = 0;
  let levelShots = 0;
  let score = 0;
  // 星级只看剩余发数，阈值在 levels.js 每关的 stars 里 —— 这里不再有任何判据统计。
  let shotIndex = 0;          // 本关已出手的发数（含当前正在飞的那发）
  let goalHint = '';          // 底部「还差几发才保得住三星」的提示文本
  let goalHintAt = 0;         // 这条提示出现的时刻（淡出从它开始算）
  let goalHintTier = 0;       // 提示的是第几星（0 = 不提示）
  // ---------- 教学卡（第 1 关用；数据在 levels.js 的 teach 里） ----------
  let paused = false;         // 教学卡展示中：物理与计时全部冻结，等玩家点按钮
  let teachQueue = [];        // 这一发里排进来的卡片（可能连出两张，逐张关）
  let teachArmed = {};        // 条件已成真的 when（成立过就不撤销）
  let teachDone = {};         // 本关已经出过的 when（每个整局只弹一次）
  const teachDoneAll = {};    // 上面的东西按关卡存一份：重来不重放，重新进关才从头教
  let shotTouched = { protect: false, seal: false };   // 这一发里特殊块有没有被碰过
  let state = 'ready'; // ready | dragging | flying | settled | won | lost
  let settleTime = 0;
  let flightTime = 0;
  let shake = 0;
  let time = 0;

  // ---------- 拖拽手感 ----------
  const MIN_PULL = 30;               // 拉力低于这个值算误触：奶龙回弹归位、不扣发数
  const LONG_PULL = 100;             // 「长引」阈值：拉弓 ≥ 这个距离才算长引（MAX_DRAG=130，约 0.77）
  const FOLLOW_TAU = 45;             // 奶龙阻尼跟随的时间常数（ms），不是硬跟指针
  let dragTarget = { x: 0, y: 0 };   // 指针算出来的目标点
  let maxPull = 0;
  let releaseFrom = { x: 0, y: 0 }, releaseTo = { x: 0, y: 0 }, releaseAt = 0;
  let returnFrom = { x: 0, y: 0 }, returnAt = 0;

  // 奶龙以前是一张位图（assets/nailong_head.png），现在整个是矢量的，
  // 位图加载器和那张图都不再需要 —— 见 drawBird()。

  // ---------- 音效（WebAudio 全合成，不依赖任何音频文件） ----------
  // 与「墨档」视觉同源：纸是底（静默）、墨是层级（响度+亮度）、朱砂是唯一行动声（落印）。
  // 全链不加混响 —— 水墨是「近、干、纸上的墨」，磬靠自身长尾提供空间感。
  let audioCtx = null;
  let muted = false;
  let noiseBuf = null;
  let master = null;              // 总线：masterGain → compressor → destination
  let reducedMotion = false;
  try { reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { }

  function out() { return master || (audioCtx && audioCtx.destination); }
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { }
      if (audioCtx) {
        const n = Math.floor(audioCtx.sampleRate * 1.0);   // 1s 白噪，覆盖最长的「洇开」0.6s
        noiseBuf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        master = audioCtx.createGain();
        const comp = audioCtx.createDynamicsCompressor();
        comp.threshold.value = -12; comp.ratio.value = 4; comp.knee.value = 12;
        comp.attack.value = 0.003; comp.release.value = 0.25;
        master.connect(comp); comp.connect(audioCtx.destination);
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }

  // ---- 原语 ----
  // 纯音：5ms 软起音 + 指数慢收尾（运笔包络）
  function tone(freq, dur, type, vol, delay, slideTo) {
    if (!audioCtx || muted) return;
    const t = audioCtx.currentTime + (delay || 0);
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol || 0.2, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out());
    o.start(t); o.stop(t + dur + 0.03);
  }
  // 低通噪声 + 下滑（木「闷」：落地、墨点）
  function thud(vol, freq, dur, delay) {
    if (!audioCtx || !noiseBuf || muted) return;
    const t = audioCtx.currentTime + (delay || 0);
    const s = audioCtx.createBufferSource(); s.buffer = noiseBuf;
    const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.35), t + dur);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out());
    s.start(t); s.stop(t + dur + 0.02);
  }
  // 高通噪声短「啪」（皮筋、裂、簌）
  function snap(vol, hpFreq, delay) {
    if (!audioCtx || !noiseBuf || muted) return;
    const t = audioCtx.currentTime + (delay || 0);
    const s = audioCtx.createBufferSource(); s.buffer = noiseBuf;
    const f = audioCtx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hpFreq || 2500;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    s.connect(f); f.connect(g); g.connect(out());
    s.start(t); s.stop(t + 0.06);
  }
  // 带通/高通噪声「涌」（翻页、破空、运笔）
  function swish(vol, freq, dur, delay, type) {
    if (!audioCtx || !noiseBuf || muted) return;
    const t = audioCtx.currentTime + (delay || 0);
    const s = audioCtx.createBufferSource(); s.buffer = noiseBuf;
    const f = audioCtx.createBiquadFilter();
    f.type = type || 'bandpass';
    f.frequency.value = freq; f.Q.value = 1.2;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out());
    s.start(t); s.stop(t + dur + 0.02);
  }
  // 磬：正弦基频 + 非整数倍泛音（2.76×、5.4×）+ 轻微 detune「晕」，指数长尾
  function bell(freq, dur, vol, delay) {
    if (!audioCtx || muted) return;
    const t = audioCtx.currentTime + (delay || 0);
    const parts = [[1, vol || 0.2], [2.76, (vol || 0.2) * 0.22], [5.4, (vol || 0.2) * 0.08]];
    for (let i = 0; i < parts.length; i++) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq * parts[i][0] * (1 + (Math.random() - 0.5) * 0.0015), t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(parts[i][1], t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(out());
      o.start(t); o.stop(t + dur + 0.05);
    }
  }
  // 木鱼：带通噪声短「嗒」+ 低频正弦木体
  function wood(freq, dur, vol, q, delay, bodyFreq) {
    if (!audioCtx || !noiseBuf || muted) return;
    const t = audioCtx.currentTime + (delay || 0);
    const s = audioCtx.createBufferSource(); s.buffer = noiseBuf;
    const f = audioCtx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = freq; f.Q.value = q || 3;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol || 0.1, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out());
    s.start(t); s.stop(t + dur + 0.02);
    tone(bodyFreq || 200, dur * 1.2, 'sine', (vol || 0.1) * 0.7, delay);
  }
  // 拨弦「嘣」：三角波快速下滑
  function pluck(f0, f1, dur, vol) {
    if (!audioCtx || muted) return;
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out());
    o.start(t); o.stop(t + dur + 0.03);
  }
  // 落印（签名动作）：木鱼「嗒」+ 延迟 15ms 的磬，磬经低通「洇开」bloom
  function seal(vol, bellFreq, delay) {
    if (!audioCtx || muted) return;
    wood(300, 0.06, (vol || 0.13) * 0.9, 3, delay, 200);
    const b = audioCtx.currentTime + (delay || 0) + 0.015;
    const o = audioCtx.createOscillator(); o.type = 'sine';
    o.frequency.value = bellFreq || 1046.5;
    const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1;
    f.frequency.setValueAtTime(500, b);
    f.frequency.exponentialRampToValueAtTime(4000, b + 0.12);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, b);
    g.gain.linearRampToValueAtTime(vol || 0.13, b + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, b + 0.5);
    o.connect(f); f.connect(g); g.connect(out());
    o.start(b); o.stop(b + 0.55);
  }
  // 洇开（失败，墨散）：噪声床低通 2000→300Hz + 慢正弦下滑 220→147Hz
  function bleed() {
    if (!audioCtx || !noiseBuf || muted) return;
    const t = audioCtx.currentTime;
    const s = audioCtx.createBufferSource(); s.buffer = noiseBuf;
    const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1;
    f.frequency.setValueAtTime(2000, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.6);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    s.connect(f); f.connect(g); g.connect(out());
    s.start(t); s.stop(t + 0.65);
    tone(220, 0.6, 'sine', 0.06, 0, 147);
    wood(220, 0.07, 0.07, 3, 0, 150);
  }

  // ---- 常驻声 ----
  // 拉弓：皮带绷紧 —— 带通噪声（拉伸的皮）+ 低频正弦（皮筋张力）+ 满弦 8Hz 颤音
  let pullNodes = null, minTickDone = false, longTickDone = false;
  function pullStart() {
    if (!audioCtx || muted || pullNodes) return;
    minTickDone = false;
    longTickDone = false;
    const ns = audioCtx.createBufferSource(); ns.buffer = noiseBuf; ns.loop = true;
    const bp = audioCtx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 8; bp.frequency.value = 220;
    const ng = audioCtx.createGain(); ng.gain.value = 0;
    ns.connect(bp); bp.connect(ng); ng.connect(out());
    ns.start();
    const o = audioCtx.createOscillator(); o.type = 'sine'; o.frequency.value = 82;
    const og = audioCtx.createGain(); og.gain.value = 0;
    o.connect(og); og.connect(out());
    o.start();
    // 满弦颤音：8Hz LFO 调噪声增益幅度（暗示极限）
    const lfo = audioCtx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 8;
    const lg = audioCtx.createGain(); lg.gain.value = 0;
    lfo.connect(lg); lg.connect(ng.gain);
    lfo.start();
    pullNodes = { ns: ns, bp: bp, ng: ng, o: o, og: og, lfo: lfo, lg: lg };
  }
  function pullUpdate(t) {
    if (!pullNodes) return;
    const now = audioCtx.currentTime;
    pullNodes.bp.frequency.setTargetAtTime(220 + 580 * t, now, 0.05);
    pullNodes.ng.gain.setTargetAtTime(muted ? 0 : 0.010 + 0.030 * t, now, 0.06);
    pullNodes.o.frequency.setTargetAtTime(82 + 40 * t, now, 0.05);
    pullNodes.og.gain.setTargetAtTime(muted ? 0 : 0.012, now, 0.06);
    pullNodes.lg.gain.setTargetAtTime((!reducedMotion && t > 0.85) ? 0.006 : 0, now, 0.05);
    const crossed = t >= MIN_PULL / MAX_DRAG;
    if (crossed && !minTickDone) { minTickDone = true; wood(900, 0.03, 0.05, 3, 0, 200); }
    else if (!crossed) minTickDone = false;
    // 「长引」阈值（pull ≥ LONG_PULL）：越线时再响一枚高音木点 —— 听到「嗒」就是拉满了。
    // 用的还是 wood 原语，不加新音色；闩锁与上面 minTick 同构。
    const longCrossed = t >= LONG_PULL / MAX_DRAG;
    if (longCrossed && !longTickDone) { longTickDone = true; wood(520, 0.05, 0.35, 4, 0, 200); }
    else if (!longCrossed) longTickDone = false;
  }
  function pullStop() {
    if (!pullNodes) return;
    const p = pullNodes;
    p.ng.gain.setTargetAtTime(0, audioCtx.currentTime, 0.04);
    p.og.gain.setTargetAtTime(0, audioCtx.currentTime, 0.04);
    p.lg.gain.setTargetAtTime(0, audioCtx.currentTime, 0.04);
    pullNodes = null;
    setTimeout(function () { try { p.ns.stop(); p.o.stop(); p.lfo.stop(); } catch (e) { } }, 240);
  }
  // 弹弓平移摩擦：低通+带通噪声常驻，很轻
  let slideNodes = null;
  function slideStart() {
    if (!audioCtx || muted || slideNodes) return;
    const ns = audioCtx.createBufferSource(); ns.buffer = noiseBuf; ns.loop = true;
    const lp = audioCtx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
    const bp = audioCtx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 180; bp.Q.value = 1;
    const g = audioCtx.createGain(); g.gain.value = 0;
    ns.connect(lp); lp.connect(bp); bp.connect(g); g.connect(out());
    ns.start();
    g.gain.setTargetAtTime(0.02, audioCtx.currentTime, 0.05);
    slideNodes = { ns: ns, g: g };
  }
  function slideStop() {
    if (!slideNodes) return;
    const p = slideNodes;
    p.g.gain.setTargetAtTime(0, audioCtx.currentTime, 0.04);
    slideNodes = null;
    setTimeout(function () { try { p.ns.stop(); } catch (e) { } }, 240);
  }

  // ---- 一次性音效 ----
  let lastHitAt = -1, lastLandAt = -1, lastClearAt = -1;
  function sLaunch(f) {
    const k = typeof f === 'number' ? Math.max(0, Math.min(1, f)) : 0.5;
    snap(0.05 + 0.05 * k, 2500);                       // 皮筋「啪」
    pluck(620 + 180 * k, 160, 0.18, 0.10 + 0.06 * k);  // 弦振「嘣」
    if (!reducedMotion) swish(0.03 + 0.03 * k, 1200, 0.25, 0, 'bandpass'); // 破空「嗖」
  }
  // 撞击：按力度分级音高与音量，并做 50ms 节流，密集碰撞不会叠成噪音
  function sHit(k) {
    if (!audioCtx || muted) return;
    const now = audioCtx.currentTime;
    if (now - lastHitAt < 0.05) return;
    lastHitAt = now;
    const s = Math.max(0.25, Math.min(1, typeof k === 'number' ? k : 0.5));
    wood(500 + 400 * s, 0.06 + 0.08 * s, 0.06 + 0.12 * s, 3, 0, 180 + 120 * s);
    if (s > 0.7) snap(0.04, 2000);                     // 硬击「裂」
  }
  function sLand() {
    if (!audioCtx || muted) return;
    const now = audioCtx.currentTime;
    if (now - lastLandAt < 0.08) return;
    lastLandAt = now;
    thud(0.07, 300, 0.12, 0);                          // 纸墨闷响
    tone(90, 0.1, 'sine', 0.05, 0);
  }
  function sClear(kind) {
    if (!audioCtx || muted) return;
    const now = audioCtx.currentTime;
    if (now - lastClearAt < 0.08) return;              // 80ms 连倒合并
    lastClearAt = now;
    if (kind === 'seal') {                             // 落印：朱砂印压平 —— 用项目的签名动作音
      seal(0.5);
      return;
    }
    if (kind === 'protect') {                          // 护心：更低更闷的木鱼，与普通块区分开
      wood(150, 0.22, 0.5, 4, 0, 160);
      wood(150, 0.22, 0.4, 4, 0.05, 160);
      return;
    }
    wood(800, 0.07, 0.09, 3, 0, 200);                  // 「嗒」
    wood(800, 0.07, 0.09, 3, 0.04, 200);               // 「嗒」（40ms）
    bell(659.3, 0.3, 0.05, 0.08);                      // 磬确认（角 E5）
  }
  function sPage() {
    if (reducedMotion) return;
    swish(0.03, 1800, 0.1, 0, 'bandpass');             // 翻页 / 展纸
    wood(500, 0.05, 0.04, 3, 0, 200);
  }
  function sWin(n, unlock) {
    bell(392, 0.5, 0.16, 0);                           // 徵 G4
    bell(440, 0.5, 0.16, 0.11);                        // 羽 A4
    bell(523.25, 0.5, 0.16, 0.22);                     // 宫 C5
    if (reducedMotion) { bell(1046.5, 0.3, 0.07, 0.34); }
    else {
      const starF = [659.3, 784, 1046.5];              // 角 E5 → 徵 G5 → 宫 C6
      for (let i = 0; i < n; i++) bell(starF[i], 0.3, 0.07, 0.34 + i * 0.13);
    }
    seal(0.14, 1046.5, 0.85);                          // 落印收尾
    if (unlock) { wood(500, 0.05, 0.06, 3, 1.3, 200); bell(1046.5, 0.2, 0.06, 1.35); }
  }
  function sLose() { bleed(); }
  function sClick() {                                  // 淡墨点（次要）
    wood(850, 0.04, 0.06, 2.5, 0, 200);
  }
  function sClickPrimary() {                           // 朱砂落印·轻（主按钮）
    wood(850, 0.04, 0.06, 2.5, 0, 200);
    bell(1318.5, 0.12, 0.04, 0.015);
  }
  function sReturn() {                                 // 取消发射：皮筋松弛
    pluck(220, 110, 0.15, 0.05);
    snap(0.02, 3000);
  }
  function setMuted(m) {
    muted = m;
    if (master && audioCtx) {
      const t = audioCtx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(m ? 0 : 1, t, 0.05);
    }
    if (m) { pullStop(); slideStop(); }
  }
  function toggleMute() {
    setMuted(!muted);
    if (!muted) { ensureAudio(); sClick(); }           // 开音：淡墨点；静音本身不发声
  }

  // ---------- 关卡定义 ----------
  // 数据抽在 levels.js（window.DDD_LEVELS），调木块摆放不用动这个文件。
  // 坐标规则（木块 x/y 是中心、岛 top 是岛面）见 levels.js 顶部注释。
  const LEVELS = window.DDD_LEVELS;
  if (!Array.isArray(LEVELS) || !LEVELS.length) {
    document.body.innerHTML =
      '<div style="font:15px/1.8 ui-monospace,Consolas,monospace;color:#b23a2e;padding:28px">' +
      '关卡数据没加载成功。<br>请确认 <b>ggame/levels.js</b> 存在，' +
      '并且 index.html 里它排在 <b>game.js</b> 之前。</div>';
    throw new Error('DDD: window.DDD_LEVELS 缺失');
  }

  // ---------- 构建关卡 ----------
  function addIsland(cx, top, w, h) {
    const body = Bodies.rectangle(cx, top + h / 2, w, h, {
      isStatic: true, friction: 0.9, restitution: 0.1, label: 'island'
    });
    Composite.add(world, body);
    // top >= 460 的是贴底的发射台（各关都是 top:470），其余是浮空岛
    islands.push({ body, cx, top, w, h, pad: top >= 460 });
  }
  function addBlock(x, y, w, h, kind) {
    const body = Bodies.rectangle(x, y, w, h, {
      density: 0.0008, friction: 0.5, restitution: 0.18, label: 'block'
    });
    // kind: 'plain'（默认）| 'protect' 护心（连锁撞不倒，只认奶龙直击）| 'seal' 落印（必须压平）
    const b = { body, w, h, x, y, x0: x, y0: y, kind: kind || 'plain', hit: false };
    body._block = b;
    Composite.add(world, body);
    blocks.push(b);
    return b;
  }

  function clearLevel() {
    const all = Composite.allBodies(world).slice();
    for (let i = 0; i < all.length; i++) {
      if (all[i].label === 'block' || all[i].label === 'island' || all[i].label === 'bird') {
        Composite.remove(world, all[i]);
      }
    }
    blocks = [];
    knockedBodies = [];
    islands = [];
    particles = [];
    popups = [];
    bird = null;
    // 星级用的统计全部取消：星级只看剩余发数，阈值在 levels.js 的 stars 里
    goalHint = '';
    goalHintTier = 0;
  }

  function buildLevel(i) {
    clearLevel();
    setSlingX(SLING_HOME_X);   // 每一关开局弹弓回到发射台正中
    levelIndex = i;
    const L = LEVELS[i];
    shotsLeft = L.birds;
    levelShots = L.birds;
    for (let k = 0; k < L.islands.length; k++) {
      const isl = L.islands[k];
      addIsland(isl.cx, isl.top, isl.w, isl.h);
    }
    for (let k = 0; k < L.blocks.length; k++) {
      const blk = L.blocks[k];
      addBlock(blk.x, blk.y, blk.w, blk.h, blk.kind);
    }
    settleTime = 0;
    flightTime = 0;
    shake = 0;
    spawnBird();
    // 开局先亮一次本关的星级线（星级只看剩余发数，这条提示就是「还剩几发能用」）
    goalHintAt = time - 3200;   // 开局就显示，但只留 0.4s 就淡出，不挡第一发瞄准
    goalHintTier = 0;
    goalHint = '';
    refreshGoalHint();
    // 教学卡状态：重来不重放（teachDone 按关卡存在 teachDoneAll 里），
    // 从选关/开始按钮重新进关才会清空重教 —— 见 restart() 与 startLevel()。
    paused = false;
    teachQueue = [];
    teachArmed = {};
    shotTouched = { protect: false, seal: false };
    teachDone = teachDoneAll[i] || (teachDoneAll[i] = {});
    hideTeachCard();
    sPage();                   // 展纸：每一关开局的一声翻页
    // 第 1 关的第一课：levels.js 里 when:'start' 那张，开局立刻上，整局顶住等玩家关掉
    if (L.teach) {
      for (let k = 0; k < L.teach.length; k++) {
        if (L.teach[k].when === 'start' && !teachDone.start) {
          teachDone.start = true;
          showTeachCard(L.teach[k]);
          break;
        }
      }
    }
  }

  // ---------- 奶龙 ----------
  function spawnBird() {
    bird = Bodies.circle(POCKET.x, POCKET.y, BIRD_R, {
      density: 0.0025, friction: 0.6, frictionAir: 0.008, restitution: 0.35, label: 'bird'
    });
    Body.setStatic(bird, true);
    Composite.add(world, bird);
    settleTime = 0;
    flightTime = 0;
  }

  // ---------- 弹弓平移 ----------
  // 叉尖 / 锚点 / 皮兜 / 底座是一组联动坐标，整体一起挪，物理与绘制就都自动跟上。
  function setSlingX(v) {
    const nx = Math.max(SLING_MIN_X, Math.min(SLING_MAX_X, v));
    if (nx === slingX) return;
    slingX = nx;
    SLING_BASE.x = slingX;
    PRONG_L.x = slingX - PRONG_DX;
    PRONG_R.x = slingX + PRONG_DX;
    ANCHOR.x = slingX;
    POCKET.x = slingX;
    if (bird && (state === 'ready' || state === 'movingSling')) Body.setPosition(bird, { x: POCKET.x, y: POCKET.y });
  }
  // 热区：抓「奶龙上方的叉尖」或「奶龙下方的手柄」都是要挪弹弓，
  // 中间那块留给奶龙自己 —— 拖它才是发射，两边不会抢。
  function slingHit(p) {
    if (Math.abs(p.x - slingX) > touchHit(34, PRONG_DX + 28)) return false;
    const pad = touchUI ? 12 : 0;   // 触屏上下各放宽一点，手指没那么准
    // 奶龙自己那条「专属竖带」：屏幕越小越要按 CSS 尺寸撑开 ——
    // 竖屏游玩时画面只有屏幕宽度的 2/5，不撑开的话手指点在奶龙身上会抓到弹弓。
    // 横屏手机算出来还是 26，桌面端完全不变。
    const band = touchUI ? Math.max(BIRD_R, cssPx(17)) : BIRD_R;
    const aboveProng = p.y >= PRONG_L.y - 24 - pad && p.y <= POCKET.y - band + 2;
    const belowBird = p.y >= POCKET.y + band - 2 && p.y <= SLING_BASE.y + 16 + pad;
    return aboveProng || belowBird;
  }

  // ---------- 撞击威力：奶龙下坠中砸到木块的那一下，额外再给木块一份冲量 ----------
  // 只改木块、不改奶龙，所以奶龙的出手弧线和落点保持原样。
  // 推力方向顺着奶龙「撞击前」压过去的势头算（见下面 px / py），比直接用碰撞法线更符合手感。
  // 速度必须用 Body.setVelocity 写回去：Matter 是 Verlet 积分，直接改 body.velocity 下一步会被覆盖。
  function applyImpactBoost(A, B) {
    if (state !== 'flying' || !bird) return;
    if (A.label !== 'bird' && B.label !== 'bird') return;   // 必须是奶龙撞上去的
    const blk = (A.label === 'block') ? A : ((B.label === 'block') ? B : null);
    if (!blk) return;
    // 护心块（kind:'protect'）免疫「连锁」的落点在这里：
    // 本函数只会因「奶龙撞木块」被调用，所以若另一侧不是奶龙本尊、而是被奶龙撞飞的
    // 普通木块，那就是连锁 —— 一律不给冲量。奶龙直击则照常生效。
    const byBird = (A === bird) || (B === bird);
    if (!byBird && blk._block && blk._block.kind === 'protect') return;
    const vx = (typeof bird._preVx === 'number') ? bird._preVx : bird.velocity.x;
    const vy = (typeof bird._preVy === 'number') ? bird._preVy : bird.velocity.y;
    if (vy <= 0) return;                                    // 只算「下坠中」的撞击
    const sp = Math.sqrt(vx * vx + vy * vy);
    if (sp < 0.01) return;
    // 推力方向：顺着奶龙整条弧线压过去的势头。竖直分量不往下按 ——
    // 木块就坐在岛面上，往岛里按会被卡死、一点都飞不起来，所以改成往上掀一小份。
    let px = vx, py = -vy * 0.35;
    if (Math.abs(px) < 0.01) px = (blk.position.x >= bird.position.x) ? 1 : -1;  // 垂直直落时朝木块那一侧掀
    const pl = Math.sqrt(px * px + py * py);
    // 按动量分配：奶龙越重、砸得越快，木块被打飞得越远
    const push = IMPACT_BOOST * sp * (bird.mass / (bird.mass + blk.mass));
    Body.setVelocity(blk, {
      x: blk.velocity.x + (px / pl) * push,
      y: blk.velocity.y + (py / pl) * push
    });
  }

  // ---------- 碰撞反馈（不改血、不销毁，只给手感） ----------
  // 教学记账：护心块 / 落印块被「碰过」就记一笔（直击与连锁都算）。
  // 只决定第 1 关那张教学卡什么时候弹，不参与任何击倒判定。
  function markSpecialTouched(blk) {
    if (!blk || state !== 'flying') return;
    const k = blk.kind || 'plain';
    if (k === 'protect' || k === 'seal') shotTouched[k] = true;
  }
  Events.on(engine, 'collisionStart', function (evt) {
    for (let i = 0; i < evt.pairs.length; i++) {
      const pair = evt.pairs[i];
      const A = pair.bodyA, B = pair.bodyB;
      // 奶龙「直击」记账：护心块的解锁全指望这个标记（见下方击倒判定的 protect 分支）。
      // 必须放在 applyImpactBoost 之前 —— 它在护心块上会提前 return。
      const birdIsA = (A.label === 'bird'), birdIsB = (B.label === 'bird');
      if (birdIsA || birdIsB) {
        const other = birdIsA ? B : A;
        if (other.label === 'block' && other._block) {
          other._block.hit = true;
          markSpecialTouched(other._block);
        }
      }
      applyImpactBoost(A, B);
      const n = pair.collision.normal || { x: 0, y: -1 };
      const rel = { x: A.velocity.x - B.velocity.x, y: A.velocity.y - B.velocity.y };
      let vn = rel.x * n.x + rel.y * n.y;
      if (vn < 0) vn = -vn;
      if (vn <= 3) continue;
      // 连锁撞击也算「碰过」：护心块被别的木块砸中，正是该讲「连锁对它无效」的时候。
      // 放在 vn 阈值之后：静止贴着岛面的接触（vn≈0）不会被误记。
      markSpecialTouched(A._block);
      markSpecialTouched(B._block);
      const impact = Math.min(1, vn / 16);
      shake = Math.max(shake, impact * 7);
      const mid = { x: (A.position.x + B.position.x) / 2, y: (A.position.y + B.position.y) / 2 };
      spawnParticles(mid.x, mid.y, C.woodLite, Math.round(4 + impact * 8));
      const birdHit = (A.label === 'bird' || B.label === 'bird');
      const islandHit = (A.label === 'island' || B.label === 'island');
      if (birdHit && islandHit) sLand();        // 奶龙砸到岛面/地面
      if (A._block || B._block) sHit(impact);   // 撞木块
    }
  });

  // ---------- 粒子 / 飘分 ----------
  function spawnParticles(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x: x, y: y,
        vx: (Math.random() - 0.5) * 7, vy: -Math.random() * 6 - 2,
        life: 1, size: 3 + Math.random() * 6,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        color: color
      });
    }
  }
  function addScore(n, x, y) {
    score += n;
    popups.push({ x: x, y: y, txt: '+' + n, life: 1 });
  }

  // ---------- 更新逻辑 ----------
  function update(dt) {
    time += dt;

    // 拖拽手感：三段时间线动画
    if (state === 'dragging' && bird) {
      // 阻尼跟随：奶龙比指针慢一点，皮筋才有「绷住」的感觉
      const k = Math.min(1, dt / FOLLOW_TAU);
      const nx = bird.position.x + (dragTarget.x - bird.position.x) * k;
      const ny = bird.position.y + (dragTarget.y - bird.position.y) * k;
      Body.setPosition(bird, { x: nx, y: ny });
      const pull = Math.hypot(nx - ANCHOR.x, ny - ANCHOR.y);
      if (pull > maxPull) maxPull = pull;
      pullUpdate(Math.min(1, pull / MAX_DRAG));
    } else if (state === 'releasing' && bird) {
      // 松手过渡：约 90ms 滑到指针最后指的位置，然后才交给物理
      releaseAt += dt;
      const t = Math.min(1, releaseAt / 90);
      const e2 = 1 - Math.pow(1 - t, 3);
      Body.setPosition(bird, {
        x: releaseFrom.x + (releaseTo.x - releaseFrom.x) * e2,
        y: releaseFrom.y + (releaseTo.y - releaseFrom.y) * e2
      });
      if (t >= 1) fireBird();
    } else if (state === 'returning' && bird) {
      // 取消发射：奶龙弹回皮兜，这一发不算数
      returnAt += dt;
      const t = Math.min(1, returnAt / 180);
      const e2 = 1 - Math.pow(1 - t, 3);
      Body.setPosition(bird, {
        x: returnFrom.x + (POCKET.x - returnFrom.x) * e2,
        y: returnFrom.y + (POCKET.y - returnFrom.y) * e2
      });
      if (t >= 1) state = 'ready';
    }

    // 击倒判定：木块被撞倒/掉落/撞离原位即算击倒（无需打到岛下）
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const body = b.body;
      const p = body.position;
      const kind = b.kind || 'plain';
      // 护心块（protect）：奶龙没直击过它就完全不参与判定 —— 连锁撞它等于白撞。
      // 这条 continue 是「护心」二字的**全部实现**，别删。
      // b.hit 由 collisionStart 里的直击记账置位（game.js:657）。
      if (kind === 'protect' && !b.hit) continue;
      // 判据按块种分档：
      //  plain   —— 老规矩：掉 22 / 倾 0.7rad / 平推 45
      //  protect 护心 —— 只有奶龙直击才给得出足够冲量；阈值同步收紧，连锁蹭一下不算
      //  seal    落印  —— 必须真的被「压平」：要么姿态明显改变，要么平移得足够远，
      //                   单靠 45px 平推不算（那只是被推着走，印还没落）
      let fell, tilted, moved;
      if (kind === 'seal') {
        fell = p.y > b.y0 + 30;
        tilted = Math.abs(body.angle) > 0.5;
        moved = Math.abs(p.x - b.x0) > 60;
        if (moved && !fell && !tilted) { moved = false; }   // 平推不算落印
      } else if (kind === 'protect') {
        fell = p.y > b.y0 + 30;
        tilted = Math.abs(body.angle) > 0.5;
        moved = Math.abs(p.x - b.x0) > 60;
      } else {
        fell = p.y > b.y0 + 22;
        tilted = Math.abs(body.angle) > 0.7;
        moved = Math.abs(p.x - b.x0) > 45;
      }
      if (fell || tilted || moved) {
        addScore(100, p.x, p.y);
        spawnParticles(p.x, p.y, C.wood, 14);
        sClear(kind);
        if (kind === 'protect' || kind === 'seal') shotTouched[kind] = true;
        blocks.splice(i, 1);
        i--;
        knockedBodies.push({ body: body, t: 0 });
      }
    }

    // 被击倒的木块延迟移除：先让其倒下/飞出，再消失
    for (let i = 0; i < knockedBodies.length; i++) {
      const kb = knockedBodies[i];
      kb.t += dt;
      const p = kb.body.position;
      if (kb.t > 500 || p.y > WORLD_H + 140 || p.x < -160 || p.x > WORLD_W + 160) {
        Composite.remove(world, kb.body);
        knockedBodies.splice(i, 1);
        i--;
      }
    }

    // 移除飞出屏幕的奶龙 —— 包括当前奶龙（修复 bug1：出屏后无法切换下一只）
    const all = Composite.allBodies(world);
    let currentRemoved = false;
    for (let i = 0; i < all.length; i++) {
      const b = all[i];
      if (b.label !== 'bird') continue;
      const p = b.position;
      if (p.y > WORLD_H + 180 || p.x > WORLD_W + 180 || p.x < -140) {
        Composite.remove(world, b);
        if (b === bird) { bird = null; currentRemoved = true; }
      }
    }
    if (currentRemoved && state === 'flying') {
      // 必须走 onSettle 这一条结算路径：它会排教学卡、再 evaluate。
      // （原来这里直接 state='settled' + setTimeout(evaluate,120)，绕过了 onSettle ——
      //   奶龙飞出屏幕是这种高抛打法最常见的收场，结果就是"这一发碰过护心/落印"永远不上课。）
      onSettle();
      return;
    }

    // 飞行后静止判定
    if (state === 'flying') {
      flightTime += dt;
      if (flightTime > 6000) { onSettle(); }
      else if (allSlow()) { settleTime += dt; if (settleTime > 400) onSettle(); }
      else settleTime = 0;
    }
  }

  function allSlow() {
    const all = Composite.allBodies(world);
    for (let i = 0; i < all.length; i++) {
      const b = all[i];
      if (b.isStatic) continue;
      if (Math.hypot(b.velocity.x, b.velocity.y) > 0.4) return false;
    }
    return true;
  }
  function onSettle() {
    if (state !== 'flying') return;
    state = 'settled';
    refreshGoalHint();
    // 教学：这一发碰过护心/落印，就把对应的卡排进来 —— 先上课，再打下一发。
    // 清台的那一发不排课（该收尾了），教学留给下一局；页面里没有教学卡节点时也不排（否则会卡在 settled）。
    const cards = (blocks.length === 0 || !teachOverlay) ? [] : pickTeachCards();
    if (cards.length) {
      teachQueue = cards;
      setTimeout(function () { showTeachCard(teachQueue.shift()); }, 140);
      return;
    }
    setTimeout(evaluate, 140);
  }
  // 教学卡触发判定：每次结算后按 levels.js 里 teach 的顺序检查，条件成立且没出过就排进队列。
  //   'shot1'        第一发结算之后
  //   'protectTouch' 护心块被碰过（直击 / 连锁 / 被击倒都算）
  //   'sealTouch'    落印块被碰过；或它被平推着滑走却没翻（慢接触碰撞记账会漏，这里补一道位移检查）
  function pickTeachCards() {
    const L = LEVELS[levelIndex];
    if (!L || !L.teach) return [];
    teachArmed.shot1 = true;                       // 走到这里必然已经打过一发
    if (shotTouched.protect) teachArmed.protectTouch = true;
    if (shotTouched.seal || sealShoved()) teachArmed.sealTouch = true;
    const out = [];
    for (let i = 0; i < L.teach.length; i++) {
      const t = L.teach[i];
      if (t.when === 'start') continue;            // start 那张在 buildLevel 里就发了
      if (!teachArmed[t.when] || teachDone[t.when]) continue;
      teachDone[t.when] = true;
      out.push(t);
    }
    return out;
  }
  // 落印块被推着滑走（挪了位或歪了）但还没到击倒线：平推不算落印，这一课正是要讲这个
  function sealShoved() {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if ((b.kind || 'plain') !== 'seal') continue;
      const p = b.body.position;
      if (Math.abs(p.x - b.x0) > 6 || Math.abs(p.y - b.y0) > 6 || Math.abs(b.body.angle) > 0.1) return true;
    }
    return false;
  }
  // 每发结束报一次「还差几发才保得住三星」。星级只看剩余发数，玩家自己也能数出来 ——
  // 这条提示只是把「还能花几发」算好递到眼前（文字在底部停几秒，不遮挡战场）。
  function refreshGoalHint() {
    const r = starRule();
    const to3 = shotsLeft - r.three, to2 = shotsLeft - r.two;
    if (to3 >= 1) { goalHint = '三星：接下来最多再花 ' + to3 + ' 发'; goalHintTier = 3; }
    else if (to2 >= 1) { goalHint = '二星：接下来最多再花 ' + to2 + ' 发'; goalHintTier = 2; }
    else { goalHint = ''; goalHintTier = 0; }
    goalHintAt = time;
  }
  function goalHintAlpha() {
    if (!goalHint || goalHintTier === 0 || state === 'won' || state === 'lost') return 0;
    const age = time - goalHintAt;
    if (age < 0) return 0;
    const HOLD = 3600, FADE = 700;      // 停留 3.6s，末尾 0.7s 淡出
    if (age > HOLD + FADE) return 0;
    return age < HOLD ? 1 : 1 - (age - HOLD) / FADE;
  }
  function drawGoalHint() {
    const a = goalHintAlpha();
    if (a <= 0.01) return;
    const k = touchUI ? 1.25 : 1;
    ctx.save();
    ctx.globalAlpha = a * 0.94;
    ctx.font = 'bold ' + (touchUI ? 19 : 16) + 'px ' + FONT_UI;
    const text = goalHint;
    const w = Math.min(WORLD_W - 48, ctx.measureText(text).width + CHIP_PAD * 2 * k);
    const h = CHIP_H * k;
    const x = (WORLD_W - w) / 2, y = WORLD_H - h - 12;
    ctx.fillStyle = C.ink;
    roundRect(x, y, w, h, h * 0.22);
    ctx.fill();
    ctx.fillStyle = C.paper;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, WORLD_W / 2, y + h / 2 + 1);
    ctx.restore();
  }
  function evaluate() {
    if (state !== 'settled') return;
    if (blocks.length === 0) { doWin(); }
    else if (shotsLeft > 0) { state = 'ready'; spawnBird(); }
    else { doLose(); }
  }

  // ---------- 输入 ----------
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (WORLD_W / r.width),
      y: (e.clientY - r.top) * (WORLD_H / r.height)
    };
  }
  function insideRect(p, r) {
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }

  // ---------- 全屏 ----------
  // 让整个页面（document.body）全屏，而不是只让 #stage 全屏 ——
  // 开始/通关/失败/视频四个覆盖层是 #stage 的兄弟节点，只全屏 #stage 的话它们会看不见。
  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  function toggleFullscreen() {
    if (isFullscreen()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) {
        const r = exit.call(document);
        if (r && r.catch) r.catch(function () {});
      }
    } else {
      const el = document.body;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) {
        const r = req.call(el);
        if (r && r.catch) r.catch(function () {});
      }
    }
  }

  let activePointer = null;
  let slingGrabDX = 0;
  canvas.addEventListener('pointerdown', function (e) {
    if (paused) return;        // 教学卡盖着：画布上的任何输入（含四枚芯片）都不响应
    const p = toCanvas(e);
    // 触屏上这几枚芯片不画（改由页面上的按钮条代劳），热区一并关掉。
    // 命中区取 HUD（由 hudLayout 按文字实际宽度算出），不再用源码里写死的矩形 ——
    // 芯片宽度现在跟着文字走，写死的矩形会出现「看得到、点不到」。
    if (!touchUI && insideRect(p, HUD.restart)) { restart(); sClickPrimary(); return; }
    if (!touchUI && insideRect(p, HUD.select)) { if (state === 'ready') openSelect(true); return; }
    if (!touchUI && insideRect(p, HUD.mute)) { toggleMute(); return; }
    if (!touchUI && insideRect(p, HUD.full)) { ensureAudio(); toggleFullscreen(); sClick(); return; }
    if (state !== 'ready' || !bird) return;
    if (slingHit(p)) {
      state = 'movingSling';
      slingGrabDX = p.x - slingX;
      activePointer = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      ensureAudio();
      slideStart();
      return;
    }
    const dx = p.x - bird.position.x, dy = p.y - bird.position.y;
    if (Math.hypot(dx, dy) <= touchHit(52, 70)) {
      state = 'dragging';
      activePointer = e.pointerId;
      dragTarget = { x: bird.position.x, y: bird.position.y };
      maxPull = 0;
      canvas.setPointerCapture(e.pointerId);
      ensureAudio();
      pullStart();
    }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (paused) return;        // 教学卡盖着：拖拽/挪弹弓一并冻结
    if (e.pointerId !== activePointer) return;
    if (state === 'movingSling') { setSlingX(toCanvas(e).x - slingGrabDX); return; }
    if (state !== 'dragging') return;
    const p = toCanvas(e);
    let dx = p.x - ANCHOR.x, dy = p.y - ANCHOR.y;
    const d = Math.hypot(dx, dy);
    if (d > MAX_DRAG) { dx = dx / d * MAX_DRAG; dy = dy / d * MAX_DRAG; }
    let tx = ANCHOR.x + dx, ty = ANCHOR.y + dy;
    // 蓄力方案 A：力度只由「相对 ANCHOR 的位移」决定，用 MAX_DRAG 封顶（上面已按 |d| 封过）。
    // 不再把拖动点 clamp 到屏幕左缘（tx >= 40）—— 那会截断拉弓位移：
    // 弹弓移到左侧（slingX 变小）时，向左拉弓的空间被压到只剩 30px，永远蓄不满力。
    ty = Math.min(ty, 470 - BIRD_R - 2);   // 保留：不让奶龙被拖进发射台岛面（岛 top = 470）
    // 只更新目标点，奶龙在 update() 里阻尼跟随（回弹手感的来源）
    dragTarget = { x: tx, y: ty };
  });
  // 真正出手：奶龙从静态转动态并赋初速
  function fireBird() {
    const pos = { x: bird.position.x, y: bird.position.y };
    Body.setStatic(bird, false);
    Body.setVelocity(bird, {
      x: (ANCHOR.x - pos.x) * LAUNCH_K,
      y: (ANCHOR.y - pos.y) * LAUNCH_K
    });
    state = 'flying';
    shotsLeft--;
    flightTime = 0;
    shotIndex++;                 // 本关第几发：教学卡（'shot1'）靠它判断
    shotTouched = { protect: false, seal: false };   // 这一发的特殊块接触记账清零
    pullStop(); slideStop();
    sLaunch(Math.min(1, maxPull / MAX_DRAG));
  }
  function endDrag(e) {
    if (e.pointerId !== activePointer) return;
    if (state === 'movingSling') { state = 'ready'; activePointer = null; slideStop(); sClick(); return; }
    if (state !== 'dragging') return;
    pullStop();
    activePointer = null;
    // 力度按「指针最后指的位置」判：奶龙是阻尼跟随、会落后指针，
    // 若用奶龙当前位置，一次极快的甩手会被误判成「拉得太短」而取消。
    const pull = Math.hypot(dragTarget.x - ANCHOR.x, dragTarget.y - ANCHOR.y);
    if (pull < MIN_PULL) {
      // 误触 / 拉过又推回弹弓：奶龙回弹归位，不发、也不扣奶龙数
      state = 'returning';
      returnAt = 0;
      returnFrom = { x: bird.position.x, y: bird.position.y };
      sReturn();
      return;
    }
    // 松手过渡：先把奶龙滑到指针最后指的位置再交给物理，避免「手一滑就飞出去」
    state = 'releasing';
    releaseAt = 0;
    releaseFrom = { x: bird.position.x, y: bird.position.y };
    releaseTo = { x: dragTarget.x, y: dragTarget.y };
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---------- 绘制 ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // 画布上的小图标：和 index.html 里那组 <symbol> 是同一套线稿（24 视框、线性描边）。
  // 这里直接用几何图形画，不引外部 SVG 文件 —— 双击本地打开时 <img src="*.svg"> 会被 CORS 拦掉。
  function drawIcon(name, cx, cy, size, color, lw) {
    ctx.save();
    ctx.translate(cx, cy);
    const k = size / 24;                 // 按 24 视框设计，这里缩到实际尺寸
    ctx.scale(k, k);
    ctx.strokeStyle = color;
    ctx.lineWidth = (lw || 2) / k;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    switch (name) {
      case 'menu':
        ctx.moveTo(-7, -5); ctx.lineTo(7, -5);
        ctx.moveTo(-7, 0);  ctx.lineTo(7, 0);
        ctx.moveTo(-7, 5);  ctx.lineTo(7, 5);
        break;
      case 'restart':
        ctx.arc(0, 1, 7, -2.35, 1.05);
        ctx.moveTo(-4.4, -6.6); ctx.lineTo(-7, -2.6); ctx.lineTo(-2.6, -2.2);
        break;
      case 'sound':
      case 'mute':
        ctx.moveTo(-7, -3.5); ctx.lineTo(-3.5, -3.5); ctx.lineTo(0.5, -7);
        ctx.lineTo(0.5, 7); ctx.lineTo(-3.5, 3.5); ctx.lineTo(-7, 3.5);
        ctx.closePath();
        if (name === 'sound') {
          ctx.moveTo(4, -4); ctx.quadraticCurveTo(7, 0, 4, 4);
          ctx.moveTo(7.5, -6.5); ctx.quadraticCurveTo(11, 0, 7.5, 6.5);
        } else {
          ctx.moveTo(4.5, -3.5); ctx.lineTo(9.5, 3.5);
          ctx.moveTo(9.5, -3.5); ctx.lineTo(4.5, 3.5);
        }
        break;
      case 'expand':
        ctx.moveTo(-7, -2); ctx.lineTo(-7, -7); ctx.lineTo(-2, -7);
        ctx.moveTo(7, -2);  ctx.lineTo(7, -7);  ctx.lineTo(2, -7);
        ctx.moveTo(-7, 2);  ctx.lineTo(-7, 7);  ctx.lineTo(-2, 7);
        ctx.moveTo(7, 2);   ctx.lineTo(7, 7);   ctx.lineTo(2, 7);
        break;
      case 'collapse':
        ctx.moveTo(-2, -7); ctx.lineTo(-2, -2); ctx.lineTo(-7, -2);
        ctx.moveTo(2, -7);  ctx.lineTo(2, -2);  ctx.lineTo(7, -2);
        ctx.moveTo(-2, 7);  ctx.lineTo(-2, 2);  ctx.lineTo(-7, 2);
        ctx.moveTo(2, 7);   ctx.lineTo(2, 2);   ctx.lineTo(7, 2);
        break;
    }
    ctx.stroke();
    ctx.restore();
  }

  const CHIP_H = 34, CHIP_PAD = 13, CHIP_ICON = 18;

  // 芯片 = 纸面上的一块墨。原来那版是半透明底 + 1.5px 亮描边：
  // 底色只有 50% 不透明，压在米白天空上等于灰糊糊一片，再描一圈浅边更是看不出边。
  // 现在实心墨、不描边，宽度按文字自动撑开 —— 「剩余 × 3」也不用手工留宽了。
  // 返回值是实际宽度，右对齐的那几枚芯片靠它自己算左边缘。
  function chip(x, y, label, icon) {
    const k = touchUI ? 1.25 : 1;
    ctx.font = 'bold ' + (touchUI ? 21 : 17) + 'px ' + FONT_UI;
    const pad = CHIP_PAD * k;
    const iconBox = icon ? (CHIP_ICON + 7) * k : 0;
    const w = pad * 2 + ctx.measureText(label).width + iconBox;
    const h = CHIP_H * k;
    ctx.save();
    ctx.globalAlpha = 0.88;              // 留一点透，纸纹能透上来
    ctx.fillStyle = C.ink;
    roundRect(x, y, w, h, h / 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = C.paper;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let tx = x + pad;
    if (icon) {
      drawIcon(icon, tx + CHIP_ICON * k / 2, y + h / 2, CHIP_ICON * k, C.paper, 2);
      tx += iconBox;
    }
    ctx.fillText(label, tx, y + h / 2 + 1);
    return w;
  }

  function drawBackground() {
    // 纸。原来这里是垂直三段渐变（米白→浅褐），看上去像塑料面板不像纸；
    // 宣纸的层次靠远山和留白给，底色就应该是平的一块。
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    // 地平线附近压一层极淡的暖调，免得下半张完全飘着
    ctx.fillStyle = C.paper3;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(0, 430, WORLD_W, WORLD_H - 430);
    ctx.globalAlpha = 1;

    // 朱砂日（印章式：实心圆 + 焦墨边，不再用一圈大范围径向晕）
    const sx = 110, sy = 95;
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = C.seal;
    ctx.beginPath(); ctx.arc(sx, sy, 48, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = C.seal;
    ctx.beginPath(); ctx.arc(sx, sy, 30, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.sealDeep; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, 30, 0, Math.PI * 2); ctx.stroke();

    // 淡墨晕染云
    drawCloud(((time * 0.02 + 420) % (WORLD_W + 240)) - 120, 90, 1);
    drawCloud(((time * 0.014 + 660) % (WORLD_W + 240)) - 120, 150, 0.8);
    drawCloud(((time * 0.026 + 900) % (WORLD_W + 240)) - 120, 70, 1.2);

    // 浓淡墨远山（三层，由淡到浓）
    drawMountain(C.hill1, 0.55, 500, 62);
    drawMountain(C.hill2, 0.75, 516, 50);
    drawMountain(C.hill3, 0.9, 528, 38);
  }
  function drawMountain(color, alpha, baseY, amp) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    ctx.quadraticCurveTo(180, baseY - amp, 360, baseY);
    ctx.quadraticCurveTo(540, baseY - amp * 0.9, 720, baseY);
    ctx.quadraticCurveTo(860, baseY - amp * 0.8, 960, baseY);
    ctx.lineTo(960, WORLD_H); ctx.lineTo(0, WORLD_H);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function drawCloud(x, y, s) {
    // 云是一团淡墨，不是一盏灯：去掉径向渐变，改成三个圆一次填充的低透明度墨团
    // （同一个 path 一次 fill，重叠处不会叠深）
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = 'rgba(90,80,64,0.09)';
    ctx.beginPath();
    ctx.arc(0, 0, 42, 0, Math.PI * 2);
    ctx.arc(28, 8, 32, 0, Math.PI * 2);
    ctx.arc(-26, 8, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawIsland(isl) {
    const body = isl.body, w = isl.w, h = isl.h;
    if (!(w > 0) || !(h > 0)) return;      // levels.js 里有一条 w:0 的废数据，当它没有岛体
    const x = body.position.x, y = body.position.y;
    const top = y - h / 2;
    const r = Math.min(12, h * 0.22);

    ctx.save();
    // 岛体一律裁到关卡可视范围内。levels.js 里有一条 {cx:556, w:2200}，
    // 不裁的话会画出一条横跨 x∈[-544,1656] 的石带，把整个画面压平。
    ctx.beginPath(); ctx.rect(0, 0, WORLD_W, WORLD_H); ctx.clip();

    // 山石 = 三层平涂（界画的分层），不再是自上而下的渐变
    if (isl.pad) {
      // 发射台：保持原来的梯形，一点不动
      ctx.fillStyle = C.jade;
      ctx.beginPath();
      ctx.moveTo(x - w / 2, top);
      ctx.lineTo(x + w / 2, top);
      ctx.lineTo(x + w * 0.44, top + h);
      ctx.lineTo(x - w * 0.44, top + h);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = C.jade;
      roundRect(x - w / 2, top, w, h, r); ctx.fill();
    }

    // 受光带 / 影带 / 苔草，全部裁在石体轮廓内，边线不会收进去
    ctx.save();
    if (isl.pad) {
      ctx.beginPath();
      ctx.moveTo(x - w / 2, top);
      ctx.lineTo(x + w / 2, top);
      ctx.lineTo(x + w * 0.44, top + h);
      ctx.lineTo(x - w * 0.44, top + h);
      ctx.closePath(); ctx.clip();
    } else {
      roundRect(x - w / 2, top, w, h, r); ctx.clip();
    }
    ctx.fillStyle = C.jadeMid;
    ctx.fillRect(x - w / 2, top, w, h * 0.42);
    ctx.fillStyle = C.jadeDeep;
    ctx.fillRect(x - w / 2, top + h * 0.72, w, h * 0.28 + 2);
    ctx.fillStyle = C.moss;
    roundRect(x - w / 2, top, w, 18, r); ctx.fill();
    ctx.restore();

    // 草叶（只画落在可视范围内的那一段）
    const gx0 = Math.max(x - w / 2 + 14, 0);
    const gx1 = Math.min(x + w / 2 - 20, WORLD_W);
    ctx.strokeStyle = 'rgba(80,110,70,0.55)'; ctx.lineWidth = 2;
    for (let gx = gx0; gx <= gx1; gx += 22) {
      ctx.beginPath();
      ctx.moveTo(gx, top); ctx.lineTo(gx + 3, top - 8);
      ctx.moveTo(gx + 6, top); ctx.lineTo(gx + 9, top - 6);
      ctx.stroke();
    }
    // 苔点
    ctx.fillStyle = C.jade;
    ctx.beginPath(); ctx.arc(x - w * 0.26, top + h * 0.42, 6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + w * 0.3, top + h * 0.56, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawBlock(b) {
    const body = b.body, w = b.w, h = b.h;
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    // 平涂木色 + 上沿受光、下沿压暗，两条都是硬边。
    // 原来那版是自上而下的线性渐变，木块看起来像塑料。
    ctx.fillStyle = C.wood;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = C.woodLite;
    ctx.fillRect(-w / 2, -h / 2, w, Math.max(2, h * 0.14));
    ctx.fillStyle = 'rgba(90,66,40,0.30)';
    ctx.fillRect(-w / 2, h / 2 - Math.max(2, h * 0.12), w, Math.max(2, h * 0.12));
    ctx.strokeStyle = 'rgba(60,44,26,0.85)'; ctx.lineWidth = 2;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    // 木纹
    ctx.strokeStyle = 'rgba(90,66,40,0.35)'; ctx.lineWidth = 1;
    const lines = Math.max(1, Math.floor(h / 16));
    for (let i = 1; i < lines; i++) {
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 3, -h / 2 + i * (h / (lines + 1)));
      ctx.lineTo(w / 2 - 3, -h / 2 + i * (h / (lines + 1)));
      ctx.stroke();
    }
    const kind = b.kind || 'plain';
    // ---- 护心：木鱼纹（同心圆 + 一道穿线）。曲线是墨，实心是纸/木，都是既有色 ----
    if (kind === 'protect') {
      const r = Math.min(w, h) * 0.30;
      ctx.strokeStyle = C.ink3; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.58, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();                       // 穿线：过圆心的一道横线，两端伸出圆外
      ctx.moveTo(-r * 1.30, 0); ctx.lineTo(r * 1.30, 0); ctx.stroke();
      ctx.fillStyle = C.ink3;
      ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    // ---- 落印：朱砂方印 + 阴文（纸色笔画）。朱砂是动作色，只用在「印」上 ----
    if (kind === 'seal') {
      const s2 = Math.min(w, h) * 0.34;
      ctx.fillStyle = C.seal;
      ctx.fillRect(-s2, -s2, s2 * 2, s2 * 2);
      ctx.fillStyle = C.paper;               // 阴文：竖一 + 横一，读起来是个「印」字骨架
      const t = Math.max(2, s2 * 0.22);
      ctx.fillRect(-t / 2, -s2 * 0.62, t, s2 * 1.24);
      ctx.fillRect(-s2 * 0.62, -t / 2, s2 * 1.24, t);
    }
    ctx.restore();
  }

  // ---------- 水墨弹弓 ----------
  const INK = C.ink;
  const INK_WASH = C.wash;
  const BAND_COLOR = C.seal;   // 原来是珊瑚粉 #f2736a，和朱砂是两个红，现在是同一支朱砂

  // 固定种子的飞溅墨点（避免逐帧随机闪烁）
  const INK_SPLATTER = (function () {
    const arr = [];
    let s = 20261012;
    function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
    for (let i = 0; i < 15; i++) {
      arr.push({
        x: 116 + rnd() * 148,
        y: 328 + rnd() * 154,
        r: 0.9 + rnd() * 3.1,
        a: 0.12 + rnd() * 0.38
      });
    }
    return arr;
  })();

  // 变宽墨笔：采样二次贝塞尔得到左右边界，整条一次填充成笔锋
  // （半透明层必须一次填充，否则逐段叠加会渗出珠点）
  function inkCurve(x0, y0, cx, cy, x1, y1, w0, w1, color) {
    const N = 18;
    const Ls = [], Rs = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, mt = 1 - t;
      const x = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
      const y = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
      const w = (w0 + (w1 - w0) * t) / 2;
      const dx = 2 * mt * (cx - x0) + 2 * t * (x1 - cx);
      const dy = 2 * mt * (cy - y0) + 2 * t * (y1 - cy);
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      Ls.push([x + nx * w, y + ny * w]);
      Rs.push([x - nx * w, y - ny * w]);
    }
    const a0 = Math.atan2(cy - y0, cx - x0);   // 起点切线
    const a1 = Math.atan2(y1 - cy, x1 - cx);   // 终点切线
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(Ls[0][0], Ls[0][1]);
    for (let i = 1; i <= N; i++) ctx.lineTo(Ls[i][0], Ls[i][1]);
    ctx.arc(x1, y1, w1 / 2, a1 + Math.PI / 2, a1 - Math.PI / 2, true);
    for (let i = N; i >= 0; i--) ctx.lineTo(Rs[i][0], Rs[i][1]);
    ctx.arc(x0, y0, w0 / 2, a0 - Math.PI / 2, a0 + Math.PI / 2, true);
    ctx.closePath();
    ctx.fill();
  }

  // 发射台上的「导轨」：暗示弹弓可以左右挪，两端就是活动边界
  function drawSlingRail() {
    const y = SLING_BASE.y + 7;
    ctx.save();
    ctx.strokeStyle = 'rgba(63,95,82,0.34)';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 7]);
    ctx.beginPath(); ctx.moveTo(SLING_MIN_X, y); ctx.lineTo(SLING_MAX_X, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(SLING_MIN_X, y - 6); ctx.lineTo(SLING_MIN_X, y + 6);
    ctx.moveTo(SLING_MAX_X, y - 6); ctx.lineTo(SLING_MAX_X, y + 6);
    ctx.stroke();
    ctx.restore();
  }

  function drawSlingshot() {
    const bx = SLING_BASE.x, by = SLING_BASE.y;
    const splitY = by - 62;                    // Y 形分叉点
    // 1) 湿墨洇染底层
    ctx.save();
    ctx.globalAlpha = 0.26;
    inkCurve(bx, by - 2, bx - 3, by - 40, PRONG_L.x, PRONG_L.y + 8, 32, 17, INK_WASH);
    inkCurve(bx, by - 2, bx + 3, by - 40, PRONG_R.x, PRONG_R.y + 8, 32, 17, INK_WASH);
    ctx.restore();
    // 2) 浓墨主体（Y 形，上细下粗）
    inkCurve(bx, by + 12, bx - 2, by - 32, PRONG_L.x, PRONG_L.y, 30, 15, INK);
    inkCurve(bx, by + 12, bx + 2, by - 32, PRONG_R.x, PRONG_R.y, 30, 15, INK);
    inkCurve(bx, by + 20, bx, by - 22, bx, splitY - 2, 34, 28, INK);
    // 3) 笔锋挑白
    ctx.save();
    ctx.globalAlpha = 0.16;
    inkCurve(bx - 3, by - 8, bx - 7, by - 42, PRONG_L.x + 4, PRONG_L.y + 12, 7, 3, C.paper);
    inkCurve(bx + 3, by - 8, bx + 7, by - 42, PRONG_R.x - 4, PRONG_R.y + 12, 7, 3, C.paper);
    ctx.restore();
    // 4) 底部积墨
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = INK_WASH;
    ctx.beginPath(); ctx.ellipse(bx, by + 2, 21, 24, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // 5) 飞溅墨点
    for (let i = 0; i < INK_SPLATTER.length; i++) {
      const sp = INK_SPLATTER[i];
      ctx.save();
      ctx.globalAlpha = sp.a;
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.arc(sp.x + (slingX - SLING_HOME_X), sp.y, sp.r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawBands() {
    const bp = bird ? { x: bird.position.x, y: bird.position.y } : { x: POCKET.x, y: POCKET.y };
    const bx = SLING_BASE.x;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 松弛的皮筋（仅待发射时）：绕在叉尖上，沿 Y 外侧垂下到柄底
    if (state !== 'dragging') {
      const lx = PRONG_L.x - 7, ly = PRONG_L.y + 5;
      const rx = PRONG_R.x + 7, ry = PRONG_R.y + 5;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = BAND_COLOR; ctx.lineWidth = 5;
      ctx.beginPath();                       // 顶部横跨的一股
      ctx.moveTo(lx, ly);
      ctx.quadraticCurveTo(bx, PRONG_L.y + 16, rx, ry);
      ctx.stroke();
      ctx.beginPath();                       // 外侧松垂的大环
      ctx.moveTo(lx, ly);
      ctx.quadraticCurveTo(PRONG_L.x - 24, SLING_BASE.y - 74, bx - 19, SLING_BASE.y - 6);
      ctx.quadraticCurveTo(bx, SLING_BASE.y + 22, bx + 19, SLING_BASE.y - 6);
      ctx.quadraticCurveTo(PRONG_R.x + 24, SLING_BASE.y - 74, rx, ry);
      ctx.stroke();
      ctx.restore();
    }
    // 两股皮筋：叉尖 → 弹丸
    // 拉满「长引」区（pull ≥ LONG_PULL）时皮筋转朱砂 —— 朱砂在设计语言里就是「动作色」，
    // 不是新色相；同时皮筋加粗一点，读起来就是「绷到底了」。松手后自然回到 BAND_COLOR。
    const curPull = bp.x === POCKET.x && bp.y === POCKET.y
      ? 0 : Math.hypot(bp.x - ANCHOR.x, bp.y - ANCHOR.y);
    const longPull = (state === 'dragging' || state === 'releasing') && curPull >= LONG_PULL;
    ctx.strokeStyle = longPull ? C.seal : BAND_COLOR;
    ctx.lineWidth = longPull ? 8.5 : 7;
    ctx.beginPath(); ctx.moveTo(PRONG_L.x, PRONG_L.y); ctx.lineTo(bp.x, bp.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PRONG_R.x, PRONG_R.y); ctx.lineTo(bp.x, bp.y); ctx.stroke();
    // 兜住弹丸的红结
    ctx.fillStyle = longPull ? C.sealDeep : BAND_COLOR;
    ctx.beginPath(); ctx.arc(bp.x, bp.y, 6.5, 0, Math.PI * 2); ctx.fill();
  }
  // 奶龙：矢量重绘。
  // 原来是把 assets/nailong_head.png 这张像素画直接贴上去 —— 一张几十像素的小位图，
  // 放大之后是硬邦邦的方块边，而周围的山石曲线全是抗锯齿的矢量，两种画法贴在一起
  // 是全站最刺眼的一处矛盾；图没加载完时还会退化成一只纯黄的圆。
  // 现在它和其他物件一样是矢量，永远画得出来，也不再需要那张位图。
  function drawBird(body) {
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    const u = BIRD_R / 24;              // 以物理半径为准缩放，改 BIRD_R 也不会走形
    ctx.scale(u, u);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 2;
    ctx.strokeStyle = C.ink;

    // 尾羽
    ctx.fillStyle = C.dragon;
    ctx.beginPath();
    ctx.moveTo(-12, 1);
    ctx.quadraticCurveTo(-25, -3, -21, -15);
    ctx.quadraticCurveTo(-16, -8, -9, -8);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    // 身体
    ctx.beginPath(); ctx.ellipse(0, 1, 15.5, 13.5, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    // 肚皮留白 + 翅膀（都裁在身体轮廓里）
    ctx.save();
    ctx.beginPath(); ctx.ellipse(0, 1, 15.5, 13.5, 0, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = C.paper;
    ctx.beginPath(); ctx.ellipse(-1, 6, 10, 8.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(30,27,24,0.55)'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(-3, 1, 9, 0.35, 2.0); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2;

    // 角（两枚小锥角，先画，让头压住下半截）
    ctx.fillStyle = C.dragon;
    ctx.beginPath();
    ctx.moveTo(-4, -18);
    ctx.quadraticCurveTo(-5, -23, -2, -27);
    ctx.quadraticCurveTo(0, -23, 3, -18);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(16, -18);
    ctx.quadraticCurveTo(17, -23, 14, -27);
    ctx.quadraticCurveTo(12, -23, 9, -18);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    // 头
    ctx.beginPath(); ctx.arc(6, -9, 12.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    // 腮红
    ctx.fillStyle = 'rgba(178,58,46,0.40)';
    ctx.beginPath(); ctx.ellipse(0.5, -5, 3.4, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(13.5, -5, 3.4, 2.2, 0, 0, Math.PI * 2); ctx.fill();

    // 眼（两颗墨点）
    ctx.fillStyle = C.ink;
    ctx.beginPath(); ctx.arc(2.2, -10.5, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(11, -10.5, 2.2, 0, Math.PI * 2); ctx.fill();

    // 嘴
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.7;
    ctx.beginPath(); ctx.moveTo(5, -4.2); ctx.lineTo(8.6, -4.2); ctx.stroke();
    ctx.restore();
  }
  // 抛射预览。必须复刻 Matter 的积分，否则和真实弹道对不上：
  //   每步 v = v * (1 - frictionAir) + 重力加速度 * dt²   （不是 vel.y += gravity.y）
  //   下坠段（进入这一步时 vy > 0）和 applyFallBoost() 一样多加 FALL_GRAVITY_BOOST 倍重力。
  function drawTrajectory() {
    const gravAcc = engine.gravity.y * (typeof engine.gravity.scale === 'number' ? engine.gravity.scale : 0.001);
    const baseDelta = (Matter.Common && Matter.Common._baseDelta) || STEP;
    const air = 1 - bird.frictionAir * (STEP / baseDelta);
    let px = bird.position.x, py = bird.position.y;
    let vx = (ANCHOR.x - px) * LAUNCH_K;
    let vy = (ANCHOR.y - py) * LAUNCH_K;
    const N = 40, ACC = gravAcc * STEP * STEP;
    const ACC_FALL = ACC * (1 + FALL_GRAVITY_BOOST);
    ctx.save();
    for (let i = 0; i < N; i++) {
      const falling = vy > 0; // 与 applyFallBoost 同口径：看进入这一步时的垂直速度
      vx *= air;
      vy = vy * air + (falling ? ACC_FALL : ACC);
      px += vx; py += vy;
      if (px < -40 || px > WORLD_W + 40 || py > WORLD_H + 40) break;
      if (i % 2 === 0) {
        ctx.globalAlpha = 0.8 * (1 - i / N);
        ctx.fillStyle = C.ink3;
        ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }
  // 蓄力条：屏幕左侧一条竖直的力度条，只在拉弓时出现、松手即消失。
  // 从底部向上填充，颜色沿条身由绿(底)渐变到红(顶)；条上那道横线是 MIN_PULL 死区，
  // 拉到线以上才算有效发射。力度取「指针位置」dragTarget —— 与 endDrag 判定发射用的是同一个量，
  // 所以条上读到的就是实际发射力度（奶龙是阻尼跟随、会落后指针，用奶龙位置会偏低）。
  // 旧的「发射方向箭头 + 力度环」已移除，瞄准交给 drawTrajectory 的虚线弹道。
  const BAR_X = 8, BAR_W = 24, BAR_TOP = 150, BAR_BOT = 460, BAR_PAD = 3, BAR_R = 10;
  function drawPowerBar() {
    const pull = Math.hypot(dragTarget.x - ANCHOR.x, dragTarget.y - ANCHOR.y);
    const t = Math.max(0, Math.min(1, pull / MAX_DRAG));
    const ok = pull >= MIN_PULL;

    const innerX = BAR_X + BAR_PAD, innerW = BAR_W - BAR_PAD * 2;
    const innerTop = BAR_TOP + BAR_PAD, innerBot = BAR_BOT - BAR_PAD;
    const innerH = innerBot - innerTop;

    ctx.save();
    // 轨道：和 HUD 芯片同一块墨（实底、不描边、胶囊圆角）
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = C.ink;
    roundRect(BAR_X, BAR_TOP, BAR_W, BAR_BOT - BAR_TOP, BAR_R);
    ctx.fill();
    ctx.globalAlpha = 1;

    // 填充：从底部往上长。原来是绿→红整条渐变，现在按死区分色 ——
    // 线下是还没拉开的青绿，过了线才是能发射的朱砂，颜色本身就是「够没够」的读数。
    const fh = innerH * t;
    if (fh > 0.5) {
      ctx.fillStyle = ok ? C.seal : C.jade;
      roundRect(innerX, innerBot - fh, innerW, fh, Math.min(BAR_R - BAR_PAD, fh / 2));
      ctx.fill();
    }

    // MIN_PULL 死区线：拉到这条线以上才会发射
    const deadY = innerBot - innerH * (MIN_PULL / MAX_DRAG);
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = ok ? C.paper : 'rgba(250,245,232,0.45)';
    ctx.beginPath();
    ctx.moveTo(BAR_X - 4, deadY);
    ctx.lineTo(BAR_X + BAR_W + 4, deadY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  function drawParticles() {
    for (let i = 0; i < particles.length; i++) {
      const pt = particles[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, pt.life);
      ctx.translate(pt.x, pt.y); ctx.rotate(pt.rot);
      ctx.fillStyle = pt.color;
      ctx.fillRect(-pt.size / 2, -pt.size / 2, pt.size, pt.size);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  function drawPopups() {
    for (let i = 0; i < popups.length; i++) {
      const p = popups[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = C.seal;
      ctx.font = 'bold 22px ' + FONT_UI;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = C.paper;
      ctx.strokeText(p.txt, p.x, p.y);
      ctx.fillText(p.txt, p.x, p.y);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  let lastPvInfo = '';
  function syncPvInfo() {
    if (!pvInfoEl || !document.body.classList.contains('pv')) return;
    const s = LEVELS[levelIndex].name + ' · 剩余 × ' + shotsLeft + ' · 得分 ' + score;
    if (s !== lastPvInfo) { lastPvInfo = s; pvInfoEl.textContent = s; }
  }
  // 右侧那几枚芯片的实际命中区。芯片宽度现在由文字量决定，所以绘制和热区必须走同一份计算，
  // 先用原来写死的矩形兜底（第一帧之前如果就被点到，也不会炸）。
  const HUD = {
    restart: RESTART_RECT, select: SELECT_RECT, mute: MUTE_RECT, full: FULLSCREEN_RECT
  };
  function chipW(text, icon) {
    const k = touchUI ? 1.25 : 1;
    return CHIP_PAD * 2 * k + ctx.measureText(text).width + (icon ? (CHIP_ICON + 7) * k : 0);
  }
  // 从右往左排：剩余发数 / 全屏 / 音效 / 选关 在第一行，重来在第二行，右边缘对齐
  function hudLayout() {
    const k = touchUI ? 1.25 : 1;
    const h = CHIP_H * k, gap = 8 * k, right0 = WORLD_W - 12;
    ctx.save();
    ctx.font = 'bold ' + (touchUI ? 21 : 17) + 'px ' + FONT_UI;
    let right = right0;
    function place(name, y, text, icon) {
      const w = chipW(text, icon);
      HUD[name] = { x: right - w, y: y, w: w, h: h };
      right -= w + gap;
    }
    const full = isFullscreen();
    place('select', 12, '选关', 'menu');
    place('mute', 12, '音效', muted ? 'mute' : 'sound');
    place('full', 12, full ? '退出' : '全屏', full ? 'collapse' : 'expand');
    place('shots', 12, '剩余 × ' + shotsLeft, null);
    right = right0;
    place('restart', 12 + h + gap, '重来', 'restart');
    ctx.restore();
    return HUD;
  }

  function drawHUD() {
    // 竖屏游玩：画面只有屏幕宽度的 2/5，画布上的字小到看不清 —— 整条 HUD 交给下面的 DOM 信息条
    if (document.body.classList.contains('pv')) { syncPvInfo(); return; }
    const k = touchUI ? 1.25 : 1;
    const rowH = CHIP_H * k, gap = 8 * k;
    hudLayout();
    // 左上角两枚：关卡名 / 得分
    chip(12, 12, 'DDD · ' + LEVELS[levelIndex].name, null);
    chip(12, 12 + rowH + gap, '得分 ' + score, null);
    if (touchUI) {
      // 触屏：右上角让给页面上的按钮条，剩余发数挪到左边一列，信息一样不缺
      chip(12, 12 + (rowH + gap) * 2, '剩余 × ' + shotsLeft, null);
    } else {
      chip(HUD.shots.x, HUD.shots.y, '剩余 × ' + shotsLeft, null);
      chip(HUD.restart.x, HUD.restart.y, '重来', 'restart');
      chip(HUD.mute.x, HUD.mute.y, '音效', muted ? 'mute' : 'sound');
      chip(HUD.select.x, HUD.select.y, '选关', 'menu');
      chip(HUD.full.x, HUD.full.y, isFullscreen() ? '退出' : '全屏',
           isFullscreen() ? 'collapse' : 'expand');
    }
  }

  function render() {
    // 后备缓冲是「显示尺寸 × dpr」，这里把坐标系缩回 960×540 的世界坐标，
    // 下面所有绘制代码继续用原来的数值，一行都不用改。
    ctx.setTransform(viewScale, 0, 0, viewScale, 0, 0);
    ctx.save();
    if (shake > 0.3) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    drawBackground();
    for (let i = 0; i < islands.length; i++) drawIsland(islands[i]);
    for (let i = 0; i < blocks.length; i++) drawBlock(blocks[i]);
    drawSlingRail();
    drawSlingshot();
    if (state === 'ready' || state === 'dragging' || state === 'movingSling' ||
        state === 'releasing' || state === 'returning') drawBands();
    if (bird) drawBird(bird);
    if (state === 'dragging' || state === 'releasing') {
      drawTrajectory();
    }
    if (state === 'dragging') drawPowerBar();
    drawParticles();
    drawPopups();
    ctx.restore();
    drawHUD();
    drawGoalHint();
  }

  // ---------- 粒子/飘分更新 ----------
  function updateFX(dt) {
    shake = Math.max(0, shake - dt * 0.02);
    for (let i = 0; i < particles.length; i++) {
      const pt = particles[i];
      pt.vy += 0.4;
      pt.x += pt.vx; pt.y += pt.vy;
      pt.rot += pt.vr;
      pt.life -= 0.03;
    }
    particles = particles.filter(function (p) { return p.life > 0; });
    for (let i = 0; i < popups.length; i++) {
      const p = popups[i];
      p.y -= 1.2;
      p.life -= 0.02;
    }
    popups = popups.filter(function (p) { return p.life > 0; });
  }

  // ---------- 关卡进度（localStorage 长期记住；写不进去就退回只在内存里记）----------
  const PROGRESS_KEY = 'ddd.progress.v1';
  const progress = { cleared: [], stars: [] };
  (function () {
    for (let i = 0; i < LEVELS.length; i++) { progress.cleared[i] = false; progress.stars[i] = 0; }
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (!o) return;
      for (let i = 0; i < LEVELS.length; i++) {
        progress.cleared[i] = !!(o.cleared && o.cleared[i]);
        progress.stars[i] = Math.max(0, Math.min(3, (o.stars && o.stars[i]) | 0));
      }
    } catch (e) { /* 隐私模式 / 禁用 localStorage：静默降级为只在内存里记 */ }
  })();
  function saveProgress() {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify({ cleared: progress.cleared, stars: progress.stars })); }
    catch (e) { }
  }
  // 渐进解锁：第 1 关永远开着，之后每关都要先通关前一关
  function isUnlocked(i) { return i === 0 || !!progress.cleared[i - 1]; }
  function firstUncleared() {
    for (let i = 0; i < LEVELS.length; i++) { if (!progress.cleared[i]) return i; }
    return 0;
  }

  // ---------- 胜负与视频 ----------
  const startOverlay = document.getElementById('startOverlay');
  const loseOverlay = document.getElementById('loseOverlay');
  const levelOverlay = document.getElementById('levelOverlay');
  const levelTitle = document.getElementById('levelTitle');
  const levelStars = document.getElementById('levelStars');
  const levelScoreEl = document.getElementById('levelScore');
  const nextBtn = document.getElementById('nextBtn');
  const replayLevelBtn = document.getElementById('replayLevelBtn');
  const selectOverlay = document.getElementById('selectOverlay');
  const levelList = document.getElementById('levelList');
  const startBtn = document.getElementById('startBtn');
  const selectBtn = document.getElementById('selectBtn');
  const selectClose = document.getElementById('selectClose');
  const winVideo = document.getElementById('winVideo');
  const videoOverlay = document.getElementById('videoOverlay');
  const playHint = document.getElementById('playHint');
  const popup = document.getElementById('popup');
  // 教学卡（第 1 关）：DOM 元素跟上面几块面板一样是页面里写好的静态节点
  const teachOverlay = document.getElementById('teachOverlay');
  const teachTitle = document.getElementById('teachTitle');
  const teachLinesEl = document.getElementById('teachLines');
  const teachHintEl = document.getElementById('teachHint');
  const teachBtn = document.getElementById('teachBtn');

  // DOM 侧的图标：取自 index.html 里那组内联 <symbol>。
  // 全站不再出现一个 emoji —— 彩色 emoji 是系统字体画出来的，同一排按钮里
  // 彩色字形和单色字形混在一起，而且换台机器就换一副脸。
  // 图标跟着 currentColor 走，所以按钮是什么色，图标就是什么色。
  function ico(name) {
    return '<svg class="ico" aria-hidden="true"><use href="#' + name + '"/></svg>';
  }

  // ---------- 星级：只看【剩余发数】（阈值写在 levels.js 每关的 stars 里） ----------
  //   { three: 2, two: 1 } → 打完还剩 ≥2 发 = 三星，剩 ≥1 发 = 二星，一发不剩 = 一星。
  // 通关至少要用掉一发，所以「通关必定 ≥ 一星」，星级只区分 3 / 2 / 1。
  // 旧版的判据系统（goals + evalGoal：十来个判据原子 + all/any/not 组合）连同
  // 「首发击倒数 / 长引发数」两项统计一起删掉了 —— 一条规则，玩家在 HUD 上数发数就能自己算星。
  function starRule() {
    const L = LEVELS[levelIndex] || {};
    const s = L.stars || {};
    const three = (typeof s.three === 'number') ? s.three : 2;
    const two = (typeof s.two === 'number') ? s.two : 1;
    return { three: three, two: Math.min(two, three) };
  }
  // ---------- 教学卡（第 1 关；数据在 levels.js 的 teach 里，触发判定见 pickTeachCards） ----------
  // 卡片出现时 paused = true：loop 里把物理与计时整个冻住，画布输入也一起关掉，必须手动关掉才继续。
  // 样式复用既有的纸面板 + 落印动效（.overlay.shake → .panel::after 的 sealBleed），没有新造弹窗。
  function showTeachCard(t) {
    if (!t || !teachOverlay) { paused = false; return; }
    paused = true;
    teachTitle.textContent = t.title || '教学';
    let html = '';
    const lines = t.lines || [];
    for (let i = 0; i < lines.length; i++) html += '<div class="sub">' + lines[i] + '</div>';
    teachLinesEl.innerHTML = html;
    teachHintEl.textContent = t.hint || '';
    teachHintEl.style.display = t.hint ? '' : 'none';
    teachBtn.textContent = t.btn || '知道了';
    teachOverlay.classList.remove('hidden');
    // 重放一次落印动效：先摘 shake、强制重排、再加回去（同一张卡连出两次时第二张才会洇）
    teachOverlay.classList.remove('shake');
    void teachOverlay.offsetWidth;
    teachOverlay.classList.add('shake');
    sPage();                       // 展纸声：和过关面板用同一条音效，不新增音色
  }
  function hideTeachCard() {
    if (teachOverlay) { teachOverlay.classList.add('hidden'); teachOverlay.classList.remove('shake'); }
    paused = false;
  }
  function closeTeachCard() {
    if (!paused) return;
    sClickPrimary();               // 朱砂落印·轻：既有音效
    if (teachQueue.length) { showTeachCard(teachQueue.shift()); return; }   // 还排着下一张，接着上
    hideTeachCard();
    // 教学卡把这一次结算顶住了：关掉之后补上（state 还是 settled 才会真的结算）
    if (state === 'settled') evaluate();
  }
  function starsFor() {
    const r = starRule();
    if (shotsLeft >= r.three) return 3;
    if (shotsLeft >= r.two) return 2;
    return 1;
  }
  // 结算面板说人话：差的那一星还差几发，别让玩家自己反推
  function nextStarHint() {
    const r = starRule();
    if (shotsLeft >= r.three) return '';
    if (shotsLeft >= r.two) return '三星：通关时还要剩 ' + r.three + ' 发';
    return '二星：通关时还要剩 ' + r.two + ' 发';
  }
  function renderStars(n) {
    let s = '';
    for (let i = 0; i < 3; i++) {
      // 亮星逐个弹出（面板弹入 0.30s 之后开始，每颗错开 0.13s）
      s += '<span class="' + (i < n ? 'on pop' : 'off') + '" style="animation-delay:' + (0.34 + i * 0.13).toFixed(2) + 's">' +
           ico('i-star') + '</span>';
    }
    levelStars.innerHTML = s;
  }

  function doWin() {
    state = 'won';
    const n = starsFor();
    const unlock = !progress.cleared[levelIndex] && levelIndex < LEVELS.length - 1;
    sWin(n, unlock);
    // 记进度：通关打勾 + 记录最好星级（只增不减），并写进 localStorage
    progress.cleared[levelIndex] = true;
    progress.stars[levelIndex] = Math.max(progress.stars[levelIndex] || 0, n);
    saveProgress();
    syncStartLabel();
    const isLast = levelIndex >= LEVELS.length - 1;
    if (isLast) {
      showVideo();
    } else {
      levelTitle.textContent = LEVELS[levelIndex].name + ' 通过！';
      renderStars(n);
      const hint = nextStarHint();
      levelScoreEl.textContent = '得分 ' + score + '（用 ' + (levelShots - shotsLeft) + ' 发 · 剩 ' +
        shotsLeft + ' 发）' + (hint ? '　' + hint : '');
      nextBtn.innerHTML = ico('i-play') + '<span>下一关</span>';
      levelOverlay.classList.remove('hidden');
    }
  }
  function doLose() {
    state = 'lost';
    sLose();
    loseOverlay.classList.remove('hidden');
  }
  function showVideo() {
    popup.style.left = '50%';
    popup.style.top = '50%';
    popup.style.transform = 'translate(-50%,-50%)';
    videoOverlay.classList.remove('hidden');
    winVideo.currentTime = 0;
    const p = winVideo.play();
    if (p && p.then) {
      p.then(function () { playHint.classList.add('hidden'); })
       .catch(function () { playHint.classList.remove('hidden'); });
    }
  }
  function hideVideo() {
    winVideo.pause();
    videoOverlay.classList.add('hidden');
  }

  function restart() {
    hideVideo();
    loseOverlay.classList.add('hidden');
    levelOverlay.classList.add('hidden');
    score = 0;
    buildLevel(levelIndex);
    state = 'ready';
  }
  function restartGame() {
    levelIndex = 0;
    teachDoneAll[0] = {};   // 「从头开始」：第 1 关的教学重新教一遍
    restart();
  }

  // 从选关卡片或「下一关」进入某一关：把各个弹窗都收掉再重建关卡
  function startLevel(i) {
    const n = Math.max(0, Math.min(LEVELS.length - 1, i | 0));
    // 保险：唯一的一道闸门。选关卡片的 disabled 只挡鼠标点击，
    // 「下一关」按钮和以后新增的入口都从这里过，没解锁就一律进不去。
    if (!isUnlocked(n)) return;
    hideVideo();
    loseOverlay.classList.add('hidden');
    levelOverlay.classList.add('hidden');
    startOverlay.classList.add('hidden');
    if (selectOverlay) selectOverlay.classList.add('hidden');
    // 重新进关 = 从头教：把这一关的教学卡记忆清掉（点「重来」不清，重来不重放已经看过的卡）
    teachDoneAll[n] = {};
    score = 0;
    buildLevel(n);
    state = 'ready';
  }

  function renderLevelList() {
    if (!levelList) return;
    let h = '';
    for (let i = 0; i < LEVELS.length; i++) {
      const L = LEVELS[i];
      const short = L.name.split('·').pop().trim();
      const open = isUnlocked(i);
      const got = progress.stars[i] || 0;
      let right;
      if (!open) right = ico('i-lock') + '<span>未解锁</span>';
      else if (!progress.cleared[i]) right = '<span>未通关</span>';
      else {
        right = '';
        for (let s = 0; s < 3; s++) right += '<span class="st' + (s < got ? ' on' : '') + '">' + ico('i-star') + '</span>';
      }
      h += '<button class="lvcard' + (open ? '' : ' locked') + '" data-i="' + i + '"' +
           (open ? '' : ' disabled') + '>' +
           '<span class="lvno">第 ' + (i + 1) + ' 关</span>' +
           '<span class="lvname">' + short + '</span>' +
           '<span class="lvmeta">奶龙 × ' + L.birds + ' · 木块 × ' + L.blocks.length + '</span>' +
           '<span class="lvstar">' + right + '</span>' +
           '</button>';
    }
    levelList.innerHTML = h;
  }

  // 开始界面的主按钮：有进度时明写「继续第 N 关」，指向哪一关不藏着
  function syncStartLabel() {
    if (!startBtn) return;
    const any = progress.cleared.some(function (v) { return v; });
    startBtn.innerHTML = ico('i-play') +
      '<span>' + (any ? ('继续第 ' + (firstUncleared() + 1) + ' 关') : '开始游戏') + '</span>';
  }

  // ---------- 按钮 ----------
  startBtn.addEventListener('click', function () {
    ensureAudio();
    sClickPrimary();
    startLevel(firstUncleared());
  });
  syncStartLabel();
  // 开始界面里的全屏按钮（画布上的 ⛶ 芯片在弹窗盖住时点不到）
  (function () {
    const fsBtn = document.getElementById('fsBtn');
    if (!fsBtn) return;
    if (!canFullscreen) { fsBtn.classList.add('hidden'); return; }   // iOS 上不支持，别留个点了没反应的按钮
    fsBtn.addEventListener('click', function () { ensureAudio(); toggleFullscreen(); sClick(); });
    const syncFsBtn = function () {
      fsBtn.innerHTML = isFullscreen()
        ? ico('i-collapse') + '<span>退出全屏</span>'
        : ico('i-expand') + '<span>全屏</span>';
    };
    document.addEventListener('fullscreenchange', syncFsBtn);
    document.addEventListener('webkitfullscreenchange', syncFsBtn);
    syncFsBtn();
  })();
  document.getElementById('retryBtn').addEventListener('click', function () { sClickPrimary(); restart(); });
  document.getElementById('replayBtn').addEventListener('click', function () { sClickPrimary(); restartGame(); });
  // 教学卡：唯一出口就是这个按钮（卡片盖着时画布与其它按钮都不响应）
  if (teachBtn) teachBtn.addEventListener('click', function () { closeTeachCard(); });
  document.getElementById('popupClose').addEventListener('click', function () { sClick(); hideVideo(); });
  playHint.addEventListener('click', function () {
    ensureAudio(); sClick();
    winVideo.play().then(function () { playHint.classList.add('hidden'); }).catch(function () { });
  });
  nextBtn.addEventListener('click', function () {
    sClickPrimary();
    startLevel(levelIndex + 1);
  });
  replayLevelBtn.addEventListener('click', function () { sClickPrimary(); restart(); });

  // ---------- 选关（开始界面 + 关卡内都能进）----------
  // selectFromGame 记录这次选关面板是从「开始界面」还是「关卡内」打开的，
  // 关掉面板时据此决定回到关卡（原地继续）还是回到开始界面。
  let selectFromGame = false;
  function openSelect(fromGame) {
    ensureAudio();
    sClick();
    renderLevelList();
    selectFromGame = !!fromGame;
    startOverlay.classList.add('hidden');
    selectOverlay.classList.remove('hidden');
  }
  function closeSelect() {
    sClick();
    selectOverlay.classList.add('hidden');
    if (selectFromGame) {
      selectFromGame = false; // 从关卡内打开的：只收起面板，原地继续
    } else {
      startOverlay.classList.remove('hidden'); // 从开始界面打开的：回到开始界面
    }
  }
  if (selectBtn) selectBtn.addEventListener('click', function () { openSelect(false); });
  if (selectClose) selectClose.addEventListener('click', closeSelect);
  if (levelList) levelList.addEventListener('click', function (e) {
    const card = (e.target && e.target.closest) ? e.target.closest('.lvcard') : null;
    if (!card || card.disabled) return;
    sClickPrimary();
    startLevel(parseInt(card.getAttribute('data-i'), 10) || 0);
  });

  // ---------- 触屏按钮条（手机上替代画布右上角的三个芯片）----------
  (function () {
    const bar = document.getElementById('touchBar');
    if (!bar) return;
    const bMute = document.getElementById('tbMute');
    const bFull = document.getElementById('tbFull');
    const bRestart = document.getElementById('tbRestart');
    const bSelect = document.getElementById('tbSelect');
    if (bFull && !canFullscreen) bFull.classList.add('hidden');
    const syncBar = function () {
      if (bMute) bMute.innerHTML = ico(muted ? 'i-mute' : 'i-sound');
      if (bFull) bFull.innerHTML = ico(isFullscreen() ? 'i-collapse' : 'i-expand');
    };
    if (bMute) bMute.addEventListener('click', function () {
      toggleMute();
      syncBar();
    });
    if (bFull) bFull.addEventListener('click', function () {
      ensureAudio(); toggleFullscreen(); sClick(); syncBar();
    });
    if (bRestart) bRestart.addEventListener('click', function () { sClickPrimary(); restart(); });
    // 关卡内选关：只在奶龙待发射（state==='ready'）时生效，飞行中不打断
    if (bSelect) bSelect.addEventListener('click', function () {
      if (state === 'ready') openSelect(true);
    });
    document.addEventListener('fullscreenchange', syncBar);
    document.addEventListener('webkitfullscreenchange', syncBar);
    syncBar();
    // 手机上禁掉长按弹出的系统菜单（选择/分享），免得拉弓拉到一半被打断
    if (touchUI) document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  })();

  // ---------- 竖屏游玩（点了「仍要竖屏玩」之后给 body 加 .pv）----------
  (function () {
    const ro = document.getElementById('rotateOverlay');
    const btn = document.getElementById('portraitPlay');
    if (!ro || !btn) return;
    btn.addEventListener('click', function () {
      document.body.classList.add('pv');
      ensureAudio(); sClickPrimary();
    });
    // 转回横屏就把状态清掉 —— 按「不记住」的要求，再转回竖屏时会重新问一次
    let mq = null;
    try { mq = window.matchMedia('(orientation: portrait)'); } catch (err) { mq = null; }
    if (mq) {
      const onChange = function () { if (!mq.matches) document.body.classList.remove('pv'); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  })();

  // 小窗拖拽
  (function () {
    const title = document.getElementById('popupDrag');
    let dragging = false, offX = 0, offY = 0;
    title.addEventListener('pointerdown', function (e) {
      dragging = true;
      title.setPointerCapture(e.pointerId);
      const r = popup.getBoundingClientRect();
      offX = e.clientX - r.left;
      offY = e.clientY - r.top;
      popup.style.left = r.left + 'px';
      popup.style.top = r.top + 'px';
      popup.style.transform = 'none';
    });
    title.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      popup.style.left = (e.clientX - offX) + 'px';
      popup.style.top = (e.clientY - offY) + 'px';
    });
    title.addEventListener('pointerup', function () { dragging = false; });
    title.addEventListener('pointercancel', function () { dragging = false; });
  })();

  // ---------- 主循环 ----------
  // 奶龙下坠加速：Matter 在 Engine.update() 内部先给每个 body 加上
  // mass * gravity.y * gravity.scale 的重力，再积分、最后清空 force。
  // 所以我们在 Engine.update() 之前，把同样口径的 30% 额外加到 bird.force.y 上，
  // 它就会被同一帧一起积分进去；且只对 state==='flying' 且 vy>0 的奶龙生效。
  function applyFallBoost() {
    if (state !== 'flying' || !bird) return;
    // 记下「进入这一步」的速度：碰撞解算会改写速度，撞击威力判定要用撞击前的原速度。
    bird._preVx = bird.velocity.x;
    bird._preVy = bird.velocity.y;
    if (bird._preVy <= 0) return;
    const gScale = (typeof engine.gravity.scale === 'number') ? engine.gravity.scale : 0.001;
    bird.force.y += bird.mass * engine.gravity.y * gScale * FALL_GRAVITY_BOOST;
  }

  let last = performance.now();
  let acc = 0;
  const STEP = 1000 / 60;
  function loop(now) {
    const dt = now - last;
    last = now;
    // 教学卡展示中：整个世界冻结 —— 物理、计时、粒子全部不走，只继续刷画面。
    // last 照样更新，所以关掉卡片之后不会有时间跳变、把物理一次补跑一大截。
    if (paused) { render(); requestAnimationFrame(loop); return; }
    acc += dt;
    if (acc > 250) acc = 250;
    while (acc >= STEP) {
      applyFallBoost();
      Engine.update(engine, STEP);
      acc -= STEP;
    }
    update(dt);
    updateFX(dt);
    render();
    requestAnimationFrame(loop);
  }

  // 调试钩子：只在地址栏带 #debug 时挂出来（editor/ 里的端到端自检脚本用得上），
  // 正常打开游戏不会有这个全局变量，也不影响任何行为。
  if (location.hash === '#debug') {
    window.__DDD_DEBUG = function () {
      return {
        state: state, paused: paused, shotsLeft: shotsLeft, score: score,
        blocks: blocks.length, bird: !!bird, teachDone: teachDone,
        teachQueue: teachQueue.length, level: levelIndex,
        // 飞行中的奶龙位置/速度：端到端自检要拿它跟离线弹道对照
        birdAt: bird ? {
          x: Math.round(bird.position.x), y: Math.round(bird.position.y),
          vx: Math.round(bird.velocity.x * 10) / 10, vy: Math.round(bird.velocity.y * 10) / 10
        } : null,
        // 台面上还活着的块（含 kind / 姿态 / 有没有被奶龙直击过）
        live: blocks.map(function (b) {
          return {
            kind: b.kind || 'plain', x: Math.round(b.body.position.x), y: Math.round(b.body.position.y),
            ang: Math.round(b.body.angle * 100) / 100, hit: !!b.hit
          };
        })
      };
    };
  }

  // 启动
  buildLevel(0);
  requestAnimationFrame(loop);
})();
