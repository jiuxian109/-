/* DDD —— 弹射撞倒木块闯关（多关卡 · 水墨国风 · 评分星级） */
(function () {
  'use strict';

  // ---------- 基础常量 ----------
  const WORLD_W = 960, WORLD_H = 540;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const pvInfoEl = document.getElementById('pvInfo');   // 竖屏游玩时画面下方的 DOM 信息条

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
  let state = 'ready'; // ready | dragging | flying | settled | won | lost
  let settleTime = 0;
  let flightTime = 0;
  let shake = 0;
  let time = 0;

  // ---------- 拖拽手感 ----------
  const MIN_PULL = 30;               // 拉力低于这个值算误触：奶龙回弹归位、不扣发数
  const FOLLOW_TAU = 45;             // 奶龙阻尼跟随的时间常数（ms），不是硬跟指针
  let dragTarget = { x: 0, y: 0 };   // 指针算出来的目标点
  let maxPull = 0;
  let releaseFrom = { x: 0, y: 0 }, releaseTo = { x: 0, y: 0 }, releaseAt = 0;
  let returnFrom = { x: 0, y: 0 }, returnAt = 0;

  const birdSprite = new Image();
  birdSprite.src = 'assets/nailong_head.png';
  const SPR_W = 168, SPR_H = 144;

  // ---------- 音效（WebAudio 全合成，不依赖任何音频文件） ----------
  let audioCtx = null;
  let muted = false;
  let noiseBuf = null;
  let lastHitAt = -1;
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { }
      if (audioCtx) {
        const n = Math.floor(audioCtx.sampleRate * 0.4);
        noiseBuf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
  function tone(freq, dur, type, vol, delay, slideTo) {
    if (!audioCtx || muted) return;
    const t = audioCtx.currentTime + (delay || 0);
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t + dur + 0.03);
  }
  // 噪声 + 下滑低通 = 木头闷响的质感（撞击 / 击中 / 失败都靠它）
  function thud(vol, freq, dur, delay) {
    if (!audioCtx || !noiseBuf || muted) return;
    const t = audioCtx.currentTime + (delay || 0);
    const s = audioCtx.createBufferSource(); s.buffer = noiseBuf;
    const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.35), t + dur);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(audioCtx.destination);
    s.start(t); s.stop(t + dur + 0.02);
  }
  // 拨弦「嘣」：快速下滑的三角波 + 一点噪声
  function pluck(f0, f1, dur, vol) {
    if (!audioCtx || muted) return;
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t + dur + 0.03);
    thud(vol * 0.55, 1100, 0.09, 0);
  }
  // 磬：正弦 + 一个非整数倍泛音，尾巴长一点
  function bell(freq, dur, vol, delay) {
    tone(freq, dur, 'sine', vol, delay);
    tone(freq * 2.76, dur * 0.45, 'sine', vol * 0.22, delay);
  }

  // 拉弓：一条常驻的锯齿经过带通，力度越大音越高、越响
  let pullOsc = null, pullFilt = null, pullGain = null;
  function pullStart() {
    if (!audioCtx || muted || pullOsc) return;
    pullOsc = audioCtx.createOscillator(); pullOsc.type = 'sawtooth';
    pullFilt = audioCtx.createBiquadFilter(); pullFilt.type = 'bandpass'; pullFilt.Q.value = 7;
    pullGain = audioCtx.createGain(); pullGain.gain.value = 0;
    pullOsc.connect(pullFilt); pullFilt.connect(pullGain); pullGain.connect(audioCtx.destination);
    pullOsc.frequency.value = 90; pullFilt.frequency.value = 320;
    pullOsc.start();
  }
  function pullUpdate(t) {
    if (!pullOsc) return;
    const now = audioCtx.currentTime;
    pullOsc.frequency.setTargetAtTime(90 + 230 * t, now, 0.05);
    pullFilt.frequency.setTargetAtTime(320 + 1000 * t, now, 0.05);
    pullGain.gain.setTargetAtTime(muted ? 0 : 0.015 + 0.035 * t, now, 0.06);
  }
  function pullStop() {
    if (!pullOsc) return;
    const o = pullOsc, g = pullGain;
    g.gain.setTargetAtTime(0, audioCtx.currentTime, 0.04);
    pullOsc = null; pullFilt = null; pullGain = null;
    setTimeout(function () { try { o.stop(); } catch (e) { } }, 240);
  }

  function sLaunch() { pluck(680, 150, 0.22, 0.16); }
  // 撞击：按力度分级音高与音量，并做 60ms 节流，密集碰撞不会叠成噪音
  function sHit(k) {
    if (!audioCtx || muted) return;
    const now = audioCtx.currentTime;
    if (now - lastHitAt < 0.06) return;
    lastHitAt = now;
    const s = Math.max(0.25, Math.min(1, typeof k === 'number' ? k : 0.5));
    thud(0.05 + 0.15 * s, 420 + 620 * s, 0.08 + 0.10 * s, 0);
  }
  function sClear() { thud(0.15, 1200, 0.13, 0); tone(150, 0.10, 'square', 0.06, 0, 70); }
  function sWin() { bell(523, 0.5, 0.20, 0); bell(659, 0.5, 0.20, 0.13); bell(784, 0.5, 0.20, 0.26); bell(1046, 0.9, 0.22, 0.39); }
  function sLose() { tone(300, 0.30, 'sine', 0.13, 0, 150); tone(196, 0.55, 'sine', 0.13, 0.22, 110); thud(0.09, 320, 0.30, 0.04); }
  function sClick() { tone(880, 0.05, 'triangle', 0.09, 0); thud(0.05, 2200, 0.04, 0); }
  function sReturn() { pluck(220, 110, 0.16, 0.07); }

  // ---------- 关卡定义 ----------
  // islands: 浮空岛（静态），blocks 坐标即其中心（木块中心）。
  // 浮空岛不再固定贴底，分布在不同高度，木块随之抬升到中上部。
  const LEVELS = [
    {
      name: '第 1 关 · 云间初试',
      birds: 3,
      islands: [
        { cx: 150, top: 470, w: 320, h: 120 },
        { cx: 640, top: 390, w: 300, h: 100 }
      ],
      blocks: [
        { x: 596, y: 368, w: 44, h: 44 },
        { x: 640, y: 368, w: 44, h: 44 },
        { x: 684, y: 368, w: 44, h: 44 },
        { x: 618, y: 324, w: 44, h: 44 },
        { x: 662, y: 324, w: 44, h: 44 },
        { x: 640, y: 280, w: 44, h: 44 }
      ]
    },
    {
      name: '第 2 关 · 叠叠高',
      birds: 3,
      islands: [
        { cx: 150, top: 470, w: 320, h: 120 },
        { cx: 560, top: 440, w: 260, h: 100 },
        { cx: 880, top: 300, w: 180, h: 100 }
      ],
      blocks: [
        { x: 516, y: 418, w: 44, h: 44 },
        { x: 560, y: 418, w: 44, h: 44 },
        { x: 604, y: 418, w: 44, h: 44 },
        { x: 538, y: 374, w: 44, h: 44 },
        { x: 582, y: 374, w: 44, h: 44 },
        { x: 560, y: 330, w: 44, h: 44 },
        { x: 838, y: 278, w: 44, h: 44 },
        { x: 882, y: 278, w: 44, h: 44 },
        { x: 860, y: 234, w: 44, h: 44 }
      ]
    },
    {
      name: '第 3 关 · 一柱擎天',
      birds: 4,
      islands: [
        { cx: 150, top: 470, w: 320, h: 120 },
        { cx: 520, top: 300, w: 300, h: 100 }
      ],
      blocks: [
        { x: 454, y: 278, w: 44, h: 44 },
        { x: 498, y: 278, w: 44, h: 44 },
        { x: 542, y: 278, w: 44, h: 44 },
        { x: 586, y: 278, w: 44, h: 44 },
        { x: 476, y: 234, w: 44, h: 44 },
        { x: 520, y: 234, w: 44, h: 44 },
        { x: 564, y: 234, w: 44, h: 44 },
        { x: 498, y: 190, w: 44, h: 44 },
        { x: 542, y: 190, w: 44, h: 44 },
        { x: 520, y: 146, w: 44, h: 44 }
      ]
    },
    {
      name: '第 4 关 · 巅峰论道',
      birds: 5,
      islands: [
        { cx: 150, top: 470, w: 320, h: 120 },
        { cx: 500, top: 280, w: 240, h: 100 },
        { cx: 880, top: 350, w: 220, h: 100 }
      ],
      blocks: [
        { x: 456, y: 258, w: 44, h: 44 },
        { x: 500, y: 258, w: 44, h: 44 },
        { x: 544, y: 258, w: 44, h: 44 },
        { x: 478, y: 214, w: 44, h: 44 },
        { x: 522, y: 214, w: 44, h: 44 },
        { x: 500, y: 170, w: 44, h: 44 },
        { x: 814, y: 328, w: 44, h: 44 },
        { x: 858, y: 328, w: 44, h: 44 },
        { x: 902, y: 328, w: 44, h: 44 },
        { x: 946, y: 328, w: 44, h: 44 },
        { x: 836, y: 284, w: 44, h: 44 },
        { x: 880, y: 284, w: 44, h: 44 },
        { x: 924, y: 284, w: 44, h: 44 },
        { x: 858, y: 240, w: 44, h: 44 },
        { x: 902, y: 240, w: 44, h: 44 },
        { x: 880, y: 196, w: 44, h: 44 }
      ]
    }
  ];

  // ---------- 构建关卡 ----------
  function addIsland(cx, top, w, h) {
    const body = Bodies.rectangle(cx, top + h / 2, w, h, {
      isStatic: true, friction: 0.9, restitution: 0.1, label: 'island'
    });
    Composite.add(world, body);
    // top >= 460 的是贴底的发射台（各关都是 top:470），其余是浮空岛
    islands.push({ body, cx, top, w, h, pad: top >= 460 });
  }
  function addBlock(x, y, w, h) {
    const body = Bodies.rectangle(x, y, w, h, {
      density: 0.0008, friction: 0.5, restitution: 0.18, label: 'block'
    });
    const b = { body, w, h, x, y, x0: x, y0: y };
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
      addBlock(blk.x, blk.y, blk.w, blk.h);
    }
    settleTime = 0;
    flightTime = 0;
    shake = 0;
    spawnBird();
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
  Events.on(engine, 'collisionStart', function (evt) {
    for (let i = 0; i < evt.pairs.length; i++) {
      const pair = evt.pairs[i];
      const A = pair.bodyA, B = pair.bodyB;
      applyImpactBoost(A, B);
      const n = pair.collision.normal || { x: 0, y: -1 };
      const rel = { x: A.velocity.x - B.velocity.x, y: A.velocity.y - B.velocity.y };
      let vn = rel.x * n.x + rel.y * n.y;
      if (vn < 0) vn = -vn;
      if (vn <= 3) continue;
      const impact = Math.min(1, vn / 16);
      shake = Math.max(shake, impact * 7);
      const mid = { x: (A.position.x + B.position.x) / 2, y: (A.position.y + B.position.y) / 2 };
      spawnParticles(mid.x, mid.y, '#c29a6b', Math.round(4 + impact * 8));
      if (A._block || B._block) sHit(impact);
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
      const fell = p.y > b.y0 + 22;              // 掉落
      const tilted = Math.abs(body.angle) > 0.7;  // 倾倒约 40°
      const moved = Math.abs(p.x - b.x0) > 45;    // 被撞离原位
      if (fell || tilted || moved) {
        addScore(100, p.x, p.y);
        spawnParticles(p.x, p.y, '#9a7048', 14);
        sClear();
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
      state = 'settled';
      setTimeout(evaluate, 120);
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
    setTimeout(evaluate, 140);
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
    const p = toCanvas(e);
    // 触屏上这三个芯片不画（改由页面上的按钮条代劳），热区一并关掉
    if (!touchUI && insideRect(p, RESTART_RECT)) { restart(); sClick(); return; }
    if (!touchUI && insideRect(p, MUTE_RECT)) {
      muted = !muted;
      if (muted) pullStop();
      else { ensureAudio(); sClick(); }
      return;
    }
    if (!touchUI && insideRect(p, FULLSCREEN_RECT)) { ensureAudio(); toggleFullscreen(); sClick(); return; }
    if (state !== 'ready' || !bird) return;
    if (slingHit(p)) {
      state = 'movingSling';
      slingGrabDX = p.x - slingX;
      activePointer = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      ensureAudio();
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
    if (e.pointerId !== activePointer) return;
    if (state === 'movingSling') { setSlingX(toCanvas(e).x - slingGrabDX); return; }
    if (state !== 'dragging') return;
    const p = toCanvas(e);
    let dx = p.x - ANCHOR.x, dy = p.y - ANCHOR.y;
    const d = Math.hypot(dx, dy);
    if (d > MAX_DRAG) { dx = dx / d * MAX_DRAG; dy = dy / d * MAX_DRAG; }
    let tx = ANCHOR.x + dx, ty = ANCHOR.y + dy;
    ty = Math.min(ty, 470 - BIRD_R - 2);
    if (tx < 40) tx = 40;
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
    sLaunch();
  }
  function endDrag(e) {
    if (e.pointerId !== activePointer) return;
    if (state === 'movingSling') { state = 'ready'; activePointer = null; sClick(); return; }
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
  function chip(x, y, w, h, label) {
    if (touchUI) {                        // 触屏：芯片与字号一起放大，手机上才看得清
      const k = 1.25;
      x -= w * (k - 1) / 2; y -= h * (k - 1) / 2;
      w *= k; h *= k;
      if (x < 4) x = 4;
      if (y < 4) y = 4;
    }
    ctx.fillStyle = 'rgba(47,42,34,0.5)';
    roundRect(x, y, w, h,10); ctx.fill();
    ctx.strokeStyle = 'rgba(253,248,239,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fdf8ef';
    ctx.font = 'bold ' + (touchUI ? 21 : 17) + 'px "Segoe UI","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  }

  function drawBackground() {
    // 宣纸底（米白留白）
    const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    sky.addColorStop(0, '#faf5e8');
    sky.addColorStop(0.55, '#f4ecd9');
    sky.addColorStop(1, '#ece3cb');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    // 朱砂太阳（印章式 + 淡晕）
    const sx = 110, sy = 95;
    const glow = ctx.createRadialGradient(sx, sy, 8, sx, sy, 62);
    glow.addColorStop(0, 'rgba(192,57,43,0.28)');
    glow.addColorStop(1, 'rgba(192,57,43,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(sx, sy, 62, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(192,57,43,0.92)';
    ctx.beginPath(); ctx.arc(sx, sy, 30, 0, Math.PI * 2); ctx.fill();

    // 淡墨晕染云
    drawCloud(((time * 0.02 + 420) % (WORLD_W + 240)) - 120, 90, 1);
    drawCloud(((time * 0.014 + 660) % (WORLD_W + 240)) - 120, 150, 0.8);
    drawCloud(((time * 0.026 + 900) % (WORLD_W + 240)) - 120, 70, 1.2);

    // 浓淡墨远山（三层，由淡到浓）
    drawMountain('#b8b1a2', 0.55, 500, 62);
    drawMountain('#8a8374', 0.75, 516, 50);
    drawMountain('#5c574b', 0.9, 528, 38);
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
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 42);
    g.addColorStop(0, 'rgba(110,100,85,0.16)');
    g.addColorStop(1, 'rgba(110,100,85,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 42, 0, Math.PI * 2);
    ctx.arc(28, 8, 32, 0, Math.PI * 2);
    ctx.arc(-26, 8, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawIsland(isl) {
    const body = isl.body, w = isl.w, h = isl.h;
    const x = body.position.x, y = body.position.y;
    const top = y - h / 2;
    // 青绿山石（浮空岛为等宽长方形，发射台保持上宽下收的梯形）
    const rock = ctx.createLinearGradient(0, top, 0, top + h);
    rock.addColorStop(0, '#7a9c80');
    rock.addColorStop(0.55, '#5f8470');
    rock.addColorStop(1, '#3f5f52');
    // 山石顶部受光
    const hi = ctx.createLinearGradient(0, top, 0, top + h * 0.4);
    hi.addColorStop(0, 'rgba(240,220,170,0.22)');
    hi.addColorStop(1, 'rgba(240,220,170,0)');
    // 苔草
    const g = ctx.createLinearGradient(0, top, 0, top + 18);
    g.addColorStop(0, '#93ad76'); g.addColorStop(1, '#6d8a58');

    if (isl.pad) {
      // 发射台：保持原来的梯形，一点不动
      ctx.fillStyle = rock;
      ctx.beginPath();
      ctx.moveTo(x - w / 2, top);
      ctx.lineTo(x + w / 2, top);
      ctx.lineTo(x + w * 0.44, top + h);
      ctx.lineTo(x - w * 0.44, top + h);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = hi;
      ctx.beginPath();
      ctx.moveTo(x - w / 2, top);
      ctx.lineTo(x + w / 2, top);
      ctx.lineTo(x + w * 0.4, top + h * 0.4);
      ctx.lineTo(x - w * 0.4, top + h * 0.4);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = g;
      roundRect(x - w / 2, top, w, 18, 9); ctx.fill();
    } else {
      // 浮空岛：上下等宽的长方形，四个角小圆角
      const r = Math.min(12, h * 0.22);
      ctx.fillStyle = rock;
      roundRect(x - w / 2, top, w, h, r); ctx.fill();
      // 受光与苔草都裁在圆角长方形内，边线不会再收进去
      ctx.save();
      roundRect(x - w / 2, top, w, h, r); ctx.clip();
      ctx.fillStyle = hi;
      ctx.fillRect(x - w / 2, top, w, h * 0.4);
      ctx.fillStyle = g;
      roundRect(x - w / 2, top, w, 18, r); ctx.fill();
      ctx.restore();
    }
    // 草叶
    ctx.strokeStyle = 'rgba(80,110,70,0.55)'; ctx.lineWidth = 2;
    for (let i = 0; i < Math.floor(w / 22); i++) {
      const gx = x - w / 2 + 14 + i * 22;
      ctx.beginPath();
      ctx.moveTo(gx, top); ctx.lineTo(gx + 3, top - 8);
      ctx.moveTo(gx + 6, top); ctx.lineTo(gx + 9, top - 6);
      ctx.stroke();
    }
    // 苔点
    ctx.fillStyle = 'rgba(95,132,112,0.9)';
    ctx.beginPath(); ctx.arc(x - w * 0.26, top + h * 0.42, 6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + w * 0.3, top + h * 0.56, 4.5, 0, Math.PI * 2); ctx.fill();
    // 垂藤
    ctx.strokeStyle = 'rgba(74,95,82,0.7)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - w * 0.3, top + h); ctx.lineTo(x - w * 0.3 + 3, top + h + 16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w * 0.28, top + h); ctx.lineTo(x + w * 0.28 - 3, top + h + 20); ctx.stroke();
  }

  function drawBlock(b) {
    const body = b.body, w = b.w, h = b.h;
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    const grad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    grad.addColorStop(0, '#c29a6b'); grad.addColorStop(1, '#9a7048');
    ctx.fillStyle = grad;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = '#6f5438'; ctx.lineWidth = 2;
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
    ctx.restore();
  }

  // ---------- 水墨弹弓 ----------
  const INK = '#1e1b18';
  const INK_WASH = '#6f6a5f';
  const BAND_COLOR = '#f2736a';

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
    inkCurve(bx - 3, by - 8, bx - 7, by - 42, PRONG_L.x + 4, PRONG_L.y + 12, 7, 3, '#fdf8ef');
    inkCurve(bx + 3, by - 8, bx + 7, by - 42, PRONG_R.x - 4, PRONG_R.y + 12, 7, 3, '#fdf8ef');
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
    ctx.strokeStyle = BAND_COLOR; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(PRONG_L.x, PRONG_L.y); ctx.lineTo(bp.x, bp.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PRONG_R.x, PRONG_R.y); ctx.lineTo(bp.x, bp.y); ctx.stroke();
    // 兜住弹丸的红结
    ctx.fillStyle = BAND_COLOR;
    ctx.beginPath(); ctx.arc(bp.x, bp.y, 6.5, 0, Math.PI * 2); ctx.fill();
  }
  function drawBird(body) {
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    if (birdSprite.complete && birdSprite.naturalWidth > 0) {
      const dw = 54, dh = dw * SPR_H / SPR_W;
      ctx.fillStyle = 'rgba(60,55,45,0.18)';
      ctx.beginPath(); ctx.ellipse(0, dh / 2 - 3, dw * 0.42, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.drawImage(birdSprite, -dw / 2, -dh / 2, dw, dh);
    } else {
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath(); ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2); ctx.fill();
    }
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
        ctx.fillStyle = '#3c372d';
        ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }
  // 拖拽指示：一条从奶龙朝发射方向的渐变箭头（越长越粗越红 = 力度越大），
  // 外加奶龙身上一圈力度环。拉力不足 MIN_PULL 时整体变灰，
  // 并在锚点处画出虚线死区 —— 一眼看出「拉出这个圈才会发射」。
  function drawLaunchArrow() {
    const bx = bird.position.x, by = bird.position.y;
    const dx = ANCHOR.x - bx, dy = ANCHOR.y - by;
    const pull = Math.hypot(dx, dy);
    if (pull < 1) return;
    const t = Math.min(1, pull / MAX_DRAG);
    const ok = pull >= MIN_PULL;
    const ux = dx / pull, uy = dy / pull;
    const len = 46 + 150 * t;
    const w = 4 + 9 * t;
    const r = Math.round(95 + 97 * t), g = Math.round(132 - 75 * t), b = Math.round(112 - 69 * t);
    const col = ok ? 'rgba(' + r + ',' + g + ',' + b + ',0.92)' : 'rgba(120,115,105,0.45)';
    const ex = bx + ux * len, ey = by + uy * len;
    ctx.save();
    ctx.lineCap = 'round';
    // 杆身
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(bx + ux * (BIRD_R + 3), by + uy * (BIRD_R + 3));
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // 箭头
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(ex + ux * (12 + w), ey + uy * (12 + w));
    ctx.lineTo(ex + uy * w * 1.6, ey - ux * w * 1.6);
    ctx.lineTo(ex - uy * w * 1.6, ey + ux * w * 1.6);
    ctx.closePath();
    ctx.fill();
    // 力度环
    const rr = BIRD_R + 10;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(60,55,45,0.16)';
    ctx.beginPath(); ctx.arc(bx, by, rr, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = col;
    ctx.beginPath(); ctx.arc(bx, by, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t); ctx.stroke();
    ctx.restore();
    if (!ok) {
      ctx.save();
      ctx.setLineDash([5, 6]);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(120,115,105,0.35)';
      ctx.beginPath(); ctx.arc(ANCHOR.x, ANCHOR.y, MIN_PULL, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
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
      ctx.fillStyle = '#c0392b';
      ctx.font = 'bold 22px "Segoe UI","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(253,248,239,0.9)';
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
  function drawHUD() {
    // 竖屏游玩：画面只有屏幕宽度的 2/5，画布上的字小到看不清 —— 整条 HUD 交给下面的 DOM 信息条
    if (document.body.classList.contains('pv')) { syncPvInfo(); return; }
    chip(12, 12, 200, 34, 'DDD · ' + LEVELS[levelIndex].name);
    chip(12, 50, 130, 34, '得分 ' + score);
    if (touchUI) {
      // 触屏：右上角让给页面上的按钮条，剩余发数挪到左边一列，信息一样不缺
      chip(12, 88, 130, 34, '剩余 × ' + shotsLeft);
    } else {
      chip(WORLD_W - 150, 12, 140, 34, '剩余 × ' + shotsLeft);
      chip(RESTART_RECT.x, RESTART_RECT.y, RESTART_RECT.w, RESTART_RECT.h, '↻ 重来');
      chip(MUTE_RECT.x, MUTE_RECT.y, MUTE_RECT.w, MUTE_RECT.h, muted ? '🔇' : '🔊');
      chip(FULLSCREEN_RECT.x, FULLSCREEN_RECT.y, FULLSCREEN_RECT.w, FULLSCREEN_RECT.h,
           isFullscreen() ? '⤡' : '⛶');
    }
  }

  function render() {
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
      drawLaunchArrow();
    }
    drawParticles();
    drawPopups();
    ctx.restore();
    drawHUD();
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

  // ---------- 胜负与视频 ----------
  const startOverlay = document.getElementById('startOverlay');
  const loseOverlay = document.getElementById('loseOverlay');
  const levelOverlay = document.getElementById('levelOverlay');
  const levelTitle = document.getElementById('levelTitle');
  const levelStars = document.getElementById('levelStars');
  const levelScoreEl = document.getElementById('levelScore');
  const nextBtn = document.getElementById('nextBtn');
  const replayLevelBtn = document.getElementById('replayLevelBtn');
  const winVideo = document.getElementById('winVideo');
  const videoOverlay = document.getElementById('videoOverlay');
  const playHint = document.getElementById('playHint');
  const popup = document.getElementById('popup');

  function starsFor() {
    if (shotsLeft >= 2) return 3;
    if (shotsLeft === 1) return 2;
    return 1;
  }
  function renderStars(n) {
    let s = '';
    for (let i = 0; i < 3; i++) {
      // 亮星逐个弹出（面板弹入 0.30s 之后开始，每颗错开 0.13s）
      s += '<span class="' + (i < n ? 'on pop' : 'off') + '" style="animation-delay:' + (0.34 + i * 0.13).toFixed(2) + 's">★</span>';
    }
    levelStars.innerHTML = s;
  }

  function doWin() {
    state = 'won';
    sWin();
    const n = starsFor();
    const isLast = levelIndex >= LEVELS.length - 1;
    if (isLast) {
      showVideo();
    } else {
      levelTitle.textContent = LEVELS[levelIndex].name + ' 通过！';
      renderStars(n);
      levelScoreEl.textContent = '得分 ' + score + '（剩余奶龙 × ' + shotsLeft + '）';
      nextBtn.textContent = '▶ 下一关';
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
    restart();
  }

  // ---------- 按钮 ----------
  document.getElementById('startBtn').addEventListener('click', function () {
    ensureAudio();
    sClick();
    startOverlay.classList.add('hidden');
  });
  // 开始界面里的全屏按钮（画布上的 ⛶ 芯片在弹窗盖住时点不到）
  (function () {
    const fsBtn = document.getElementById('fsBtn');
    if (!fsBtn) return;
    if (!canFullscreen) { fsBtn.classList.add('hidden'); return; }   // iOS 上不支持，别留个点了没反应的按钮
    fsBtn.addEventListener('click', function () { ensureAudio(); toggleFullscreen(); sClick(); });
    const syncFsBtn = function () { fsBtn.textContent = isFullscreen() ? '⤡ 退出全屏' : '⛶ 全屏'; };
    document.addEventListener('fullscreenchange', syncFsBtn);
    document.addEventListener('webkitfullscreenchange', syncFsBtn);
    syncFsBtn();
  })();
  document.getElementById('retryBtn').addEventListener('click', function () { sClick(); restart(); });
  document.getElementById('replayBtn').addEventListener('click', function () { sClick(); restartGame(); });
  document.getElementById('popupClose').addEventListener('click', function () { sClick(); hideVideo(); });
  playHint.addEventListener('click', function () {
    winVideo.play().then(function () { playHint.classList.add('hidden'); }).catch(function () { });
  });
  nextBtn.addEventListener('click', function () {
    sClick();
    levelOverlay.classList.add('hidden');
    buildLevel(levelIndex + 1);
    state = 'ready';
  });
  replayLevelBtn.addEventListener('click', function () { sClick(); restart(); });

  // ---------- 触屏按钮条（手机上替代画布右上角的三个芯片）----------
  (function () {
    const bar = document.getElementById('touchBar');
    if (!bar) return;
    const bMute = document.getElementById('tbMute');
    const bFull = document.getElementById('tbFull');
    const bRestart = document.getElementById('tbRestart');
    if (bFull && !canFullscreen) bFull.classList.add('hidden');
    const syncBar = function () {
      if (bMute) bMute.textContent = muted ? '🔇' : '🔊';
      if (bFull) bFull.textContent = isFullscreen() ? '⤡' : '⛶';
    };
    if (bMute) bMute.addEventListener('click', function () {
      muted = !muted;
      if (muted) pullStop(); else { ensureAudio(); sClick(); }
      syncBar();
    });
    if (bFull) bFull.addEventListener('click', function () {
      ensureAudio(); toggleFullscreen(); sClick(); syncBar();
    });
    if (bRestart) bRestart.addEventListener('click', function () { sClick(); restart(); });
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
      ensureAudio(); sClick();
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

  // 启动
  buildLevel(0);
  requestAnimationFrame(loop);
})();
