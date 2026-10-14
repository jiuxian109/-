/* DDD —— 弹射撞倒木块闯关（多关卡 · 水墨国风 · 评分星级） */
(function () {
  'use strict';

  // ---------- 基础常量 ----------
  const WORLD_W = 960, WORLD_H = 540;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

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

  const RESTART_RECT = { x: WORLD_W - 150, y: 50, w: 140, h: 34 };

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

  const birdSprite = new Image();
  birdSprite.src = 'assets/nailong_head.png';
  const SPR_W = 168, SPR_H = 144;

  // ---------- 音效 ----------
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
  function tone(freq, dur, type, vol, delay, slideTo) {
    if (!audioCtx) return;
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
  function sLaunch() { tone(260, 0.18, 'sawtooth', 0.10, 0, 900); }
  function sHit() { tone(170, 0.12, 'square', 0.12, 0, 110); }
  function sClear() { tone(140, 0.10, 'square', 0.16, 0, 60); tone(90, 0.16, 'sawtooth', 0.12, 0.02, 45); }
  function sWin() { tone(523, 0.16, 'sine', 0.22, 0); tone(659, 0.16, 'sine', 0.22, 0.13); tone(784, 0.16, 'sine', 0.22, 0.26); tone(1046, 0.4, 'sine', 0.24, 0.39); }
  function sLose() { tone(330, 0.2, 'sine', 0.18, 0, 180); tone(220, 0.35, 'sine', 0.18, 0.2, 120); }

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
    islands.push({ body, cx, top, w, h });
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

  // ---------- 碰撞反馈（不改血、不销毁，只给手感） ----------
  Events.on(engine, 'collisionStart', function (evt) {
    for (let i = 0; i < evt.pairs.length; i++) {
      const pair = evt.pairs[i];
      const A = pair.bodyA, B = pair.bodyB;
      const n = pair.collision.normal || { x: 0, y: -1 };
      const rel = { x: A.velocity.x - B.velocity.x, y: A.velocity.y - B.velocity.y };
      let vn = rel.x * n.x + rel.y * n.y;
      if (vn < 0) vn = -vn;
      if (vn <= 3) continue;
      const impact = Math.min(1, vn / 16);
      shake = Math.max(shake, impact * 7);
      const mid = { x: (A.position.x + B.position.x) / 2, y: (A.position.y + B.position.y) / 2 };
      spawnParticles(mid.x, mid.y, '#c29a6b', Math.round(4 + impact * 8));
      if (A._block || B._block) sHit();
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

  let activePointer = null;
  canvas.addEventListener('pointerdown', function (e) {
    const p = toCanvas(e);
    if (insideRect(p, RESTART_RECT)) { restart(); return; }
    if (state !== 'ready' || !bird) return;
    const dx = p.x - bird.position.x, dy = p.y - bird.position.y;
    if (Math.hypot(dx, dy) <= 70) {
      state = 'dragging';
      activePointer = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      ensureAudio();
    }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (state !== 'dragging' || e.pointerId !== activePointer) return;
    const p = toCanvas(e);
    let dx = p.x - ANCHOR.x, dy = p.y - ANCHOR.y;
    const d = Math.hypot(dx, dy);
    if (d > MAX_DRAG) { dx = dx / d * MAX_DRAG; dy = dy / d * MAX_DRAG; }
    let tx = ANCHOR.x + dx, ty = ANCHOR.y + dy;
    ty = Math.min(ty, 470 - BIRD_R - 2);
    if (tx < 40) tx = 40;
    Body.setPosition(bird, { x: tx, y: ty });
  });
  function endDrag(e) {
    if (state !== 'dragging' || e.pointerId !== activePointer) return;
    const pos = { x: bird.position.x, y: bird.position.y };
    const vx = (ANCHOR.x - pos.x) * LAUNCH_K;
    const vy = (ANCHOR.y - pos.y) * LAUNCH_K;
    Body.setStatic(bird, false);
    Body.setVelocity(bird, { x: vx, y: vy });
    state = 'flying';
    shotsLeft--;
    flightTime = 0;
    activePointer = null;
    sLaunch();
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
    ctx.fillStyle = 'rgba(47,42,34,0.5)';
    roundRect(x, y, w, h,10); ctx.fill();
    ctx.strokeStyle = 'rgba(253,248,239,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fdf8ef';
    ctx.font = 'bold 17px "Segoe UI","Microsoft YaHei",sans-serif';
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
    // 青绿山石（上平下收，悬空）
    const rock = ctx.createLinearGradient(0, top, 0, top + h);
    rock.addColorStop(0, '#7a9c80');
    rock.addColorStop(0.55, '#5f8470');
    rock.addColorStop(1, '#3f5f52');
    ctx.fillStyle = rock;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, top);
    ctx.lineTo(x + w / 2, top);
    ctx.lineTo(x + w * 0.44, top + h);
    ctx.lineTo(x - w * 0.44, top + h);
    ctx.closePath(); ctx.fill();
    // 山石顶部受光
    const hi = ctx.createLinearGradient(0, top, 0, top + h * 0.4);
    hi.addColorStop(0, 'rgba(240,220,170,0.22)');
    hi.addColorStop(1, 'rgba(240,220,170,0)');
    ctx.fillStyle = hi;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, top);
    ctx.lineTo(x + w / 2, top);
    ctx.lineTo(x + w * 0.4, top + h * 0.4);
    ctx.lineTo(x - w * 0.4, top + h * 0.4);
    ctx.closePath(); ctx.fill();
    // 苔草
    const g = ctx.createLinearGradient(0, top, 0, top + 18);
    g.addColorStop(0, '#93ad76'); g.addColorStop(1, '#6d8a58');
    ctx.fillStyle = g;
    roundRect(x - w / 2, top, w, 18, 9); ctx.fill();
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
      ctx.beginPath(); ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2); ctx.fill();
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
  //   每步 v = v * (1 - frictionAir) + gravity.y * gravity.scale * dt²   （不是 vel.y += gravity.y）
  function drawTrajectory() {
    const gravAcc = engine.gravity.y * (typeof engine.gravity.scale === 'number' ? engine.gravity.scale : 0.001);
    const baseDelta = (Matter.Common && Matter.Common._baseDelta) || STEP;
    const air = 1 - bird.frictionAir * (STEP / baseDelta);
    let px = bird.position.x, py = bird.position.y;
    let vx = (ANCHOR.x - px) * LAUNCH_K;
    let vy = (ANCHOR.y - py) * LAUNCH_K;
    const N = 40, ACC = gravAcc * STEP * STEP;
    ctx.save();
    for (let i = 0; i < N; i++) {
      vx *= air;
      vy = vy * air + ACC;
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
  function drawHUD() {
    chip(12, 12, 200, 34, 'DDD · ' + LEVELS[levelIndex].name);
    chip(WORLD_W - 150, 12, 140, 34, '剩余 × ' + shotsLeft);
    chip(12, 50, 130, 34, '得分 ' + score);
    chip(RESTART_RECT.x, RESTART_RECT.y, RESTART_RECT.w, RESTART_RECT.h, '↻ 重来');
  }

  function render() {
    ctx.save();
    if (shake > 0.3) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    drawBackground();
    for (let i = 0; i < islands.length; i++) drawIsland(islands[i]);
    for (let i = 0; i < blocks.length; i++) drawBlock(blocks[i]);
    drawSlingshot();
    if (state === 'ready' || state === 'dragging') drawBands();
    if (bird) drawBird(bird);
    if (state === 'dragging') drawTrajectory();
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
    for (let i = 0; i < 3; i++) s += '<span class="' + (i < n ? 'on' : 'off') + '">★</span>';
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
    startOverlay.classList.add('hidden');
  });
  document.getElementById('retryBtn').addEventListener('click', restart);
  document.getElementById('replayBtn').addEventListener('click', restartGame);
  document.getElementById('popupClose').addEventListener('click', hideVideo);
  playHint.addEventListener('click', function () {
    winVideo.play().then(function () { playHint.classList.add('hidden'); }).catch(function () { });
  });
  nextBtn.addEventListener('click', function () {
    levelOverlay.classList.add('hidden');
    buildLevel(levelIndex + 1);
    state = 'ready';
  });
  replayLevelBtn.addEventListener('click', restart);

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
  let last = performance.now();
  let acc = 0;
  const STEP = 1000 / 60;
  function loop(now) {
    const dt = now - last;
    last = now;
    acc += dt;
    if (acc > 250) acc = 250;
    while (acc >= STEP) {
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
