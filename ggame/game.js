/* 奶龙弹射 —— 撞落木块闯关（多关卡 · 把木块撞下浮空岛 · 评分星级） */
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
  const PRONG_L = { x: 166, y: 355 };
  const PRONG_R = { x: 204, y: 355 };
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
  const LEVELS = [
    {
      name: '第 1 关 · 初出茅庐',
      birds: 3,
      islands: [
        { cx: 150, top: 470, w: 320, h: 120 },
        { cx: 640, top: 470, w: 300, h: 100 }
      ],
      blocks: [
        { x: 596, y: 448, w: 44, h: 44 },
        { x: 640, y: 448, w: 44, h: 44 },
        { x: 684, y: 448, w: 44, h: 44 },
        { x: 618, y: 404, w: 44, h: 44 },
        { x: 662, y: 404, w: 44, h: 44 },
        { x: 640, y: 360, w: 44, h: 44 }
      ]
    },
    {
      name: '第 2 关 · 叠叠高',
      birds: 3,
      islands: [
        { cx: 150, top: 470, w: 320, h: 120 },
        { cx: 560, top: 470, w: 260, h: 100 },
        { cx: 860, top: 470, w: 180, h: 100 }
      ],
      blocks: [
        { x: 516, y: 448, w: 44, h: 44 },
        { x: 560, y: 448, w: 44, h: 44 },
        { x: 604, y: 448, w: 44, h: 44 },
        { x: 538, y: 404, w: 44, h: 44 },
        { x: 582, y: 404, w: 44, h: 44 },
        { x: 560, y: 360, w: 44, h: 44 },
        { x: 838, y: 448, w: 44, h: 44 },
        { x: 882, y: 448, w: 44, h: 44 },
        { x: 860, y: 404, w: 44, h: 44 }
      ]
    },
    {
      name: '第 3 关 · 双塔阵',
      birds: 4,
      islands: [
        { cx: 150, top: 470, w: 320, h: 120 },
        { cx: 540, top: 470, w: 300, h: 100 },
        { cx: 880, top: 470, w: 200, h: 100 }
      ],
      blocks: [
        { x: 474, y: 448, w: 44, h: 44 },
        { x: 518, y: 448, w: 44, h: 44 },
        { x: 562, y: 448, w: 44, h: 44 },
        { x: 606, y: 448, w: 44, h: 44 },
        { x: 496, y: 404, w: 44, h: 44 },
        { x: 540, y: 404, w: 44, h: 44 },
        { x: 584, y: 404, w: 44, h: 44 },
        { x: 518, y: 360, w: 44, h: 44 },
        { x: 562, y: 360, w: 44, h: 44 },
        { x: 540, y: 316, w: 44, h: 44 },
        { x: 858, y: 448, w: 44, h: 44 },
        { x: 902, y: 448, w: 44, h: 44 },
        { x: 880, y: 404, w: 44, h: 44 }
      ]
    },
    {
      name: '第 4 关 · 金字塔之巅',
      birds: 5,
      islands: [
        { cx: 150, top: 470, w: 320, h: 120 },
        { cx: 470, top: 470, w: 240, h: 100 },
        { cx: 880, top: 470, w: 220, h: 100 }
      ],
      blocks: [
        { x: 426, y: 448, w: 44, h: 44 },
        { x: 470, y: 448, w: 44, h: 44 },
        { x: 514, y: 448, w: 44, h: 44 },
        { x: 448, y: 404, w: 44, h: 44 },
        { x: 492, y: 404, w: 44, h: 44 },
        { x: 470, y: 360, w: 44, h: 44 },
        { x: 814, y: 448, w: 44, h: 44 },
        { x: 858, y: 448, w: 44, h: 44 },
        { x: 902, y: 448, w: 44, h: 44 },
        { x: 946, y: 448, w: 44, h: 44 },
        { x: 836, y: 404, w: 44, h: 44 },
        { x: 880, y: 404, w: 44, h: 44 },
        { x: 924, y: 404, w: 44, h: 44 },
        { x: 858, y: 360, w: 44, h: 44 },
        { x: 902, y: 360, w: 44, h: 44 },
        { x: 880, y: 316, w: 44, h: 44 }
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
      spawnParticles(mid.x, mid.y, '#d9a05b', Math.round(4 + impact * 8));
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
        spawnParticles(p.x, p.y, '#8a5a2b', 14);
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
    ctx.fillStyle = 'rgba(15,23,42,0.45)';
    roundRect(x, y, w, h, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 17px "Segoe UI","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    sky.addColorStop(0, '#6ec3f5');
    sky.addColorStop(0.5, '#a9dff7');
    sky.addColorStop(1, '#e6f5fc');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    // 太阳（带旋转光芒）
    const sx = 110, sy = 95;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(time * 0.0002);
    ctx.strokeStyle = 'rgba(255,208,90,0.5)';
    ctx.lineWidth = 5; ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 46, Math.sin(a) * 46);
      ctx.lineTo(Math.cos(a) * 58, Math.sin(a) * 58);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath(); ctx.arc(sx, sy, 40, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd25e';
    ctx.beginPath(); ctx.arc(sx, sy, 32, 0, Math.PI * 2); ctx.fill();

    // 飘动的云
    drawCloud(((time * 0.02 + 420) % (WORLD_W + 240)) - 120, 90, 1);
    drawCloud(((time * 0.014 + 660) % (WORLD_W + 240)) - 120, 150, 0.8);
    drawCloud(((time * 0.026 + 900) % (WORLD_W + 240)) - 120, 70, 1.2);

    // 远山
    ctx.fillStyle = '#a7d48b';
    ctx.beginPath();
    ctx.moveTo(0, 520);
    ctx.quadraticCurveTo(160, 440, 320, 520);
    ctx.quadraticCurveTo(480, 430, 640, 520);
    ctx.quadraticCurveTo(800, 455, 960, 520);
    ctx.lineTo(960, 560); ctx.lineTo(0, 560);
    ctx.closePath(); ctx.fill();
  }
  function drawCloud(x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.arc(24, 6, 16, 0, Math.PI * 2);
    ctx.arc(-22, 6, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawIsland(isl) {
    const body = isl.body, w = isl.w, h = isl.h;
    const x = body.position.x, y = body.position.y;
    const top = y - h / 2;
    // 泥土
    ctx.fillStyle = '#b0783f';
    roundRect(x - w / 2, top, w, h, 14); ctx.fill();
    ctx.strokeStyle = '#7a4d24'; ctx.lineWidth = 2;
    roundRect(x - w / 2, top, w, h, 14); ctx.stroke();
    // 草地
    const g = ctx.createLinearGradient(0, top, 0, top + 18);
    g.addColorStop(0, '#8fce5b'); g.addColorStop(1, '#5aa839');
    ctx.fillStyle = g;
    roundRect(x - w / 2, top, w, 18, 14); ctx.fill();
    // 草叶
    ctx.strokeStyle = 'rgba(70,140,50,0.5)'; ctx.lineWidth = 2;
    for (let i = 0; i < Math.floor(w / 22); i++) {
      const gx = x - w / 2 + 14 + i * 22;
      ctx.beginPath();
      ctx.moveTo(gx, top); ctx.lineTo(gx + 3, top - 8);
      ctx.moveTo(gx + 6, top); ctx.lineTo(gx + 9, top - 6);
      ctx.stroke();
    }
  }

  function drawBlock(b) {
    const body = b.body, w = b.w, h = b.h;
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    const grad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    grad.addColorStop(0, '#c9925b'); grad.addColorStop(1, '#9a6637');
    ctx.fillStyle = grad;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = '#7a4d24'; ctx.lineWidth = 2;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    // 木纹
    ctx.strokeStyle = 'rgba(122,77,36,0.35)'; ctx.lineWidth = 1;
    const lines = Math.max(1, Math.floor(h / 16));
    for (let i = 1; i < lines; i++) {
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 3, -h / 2 + i * (h / (lines + 1)));
      ctx.lineTo(w / 2 - 3, -h / 2 + i * (h / (lines + 1)));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSlingshot() {
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#6b4423'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(SLING_BASE.x - 4, SLING_BASE.y); ctx.lineTo(PRONG_L.x, PRONG_L.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(SLING_BASE.x + 4, SLING_BASE.y); ctx.lineTo(PRONG_R.x, PRONG_R.y); ctx.stroke();
    ctx.strokeStyle = '#5a3720'; ctx.lineWidth = 13;
    ctx.beginPath(); ctx.moveTo(SLING_BASE.x, SLING_BASE.y - 4); ctx.lineTo(SLING_BASE.x, SLING_BASE.y + 8); ctx.stroke();
    ctx.fillStyle = '#4a2e18';
    ctx.beginPath(); ctx.ellipse(SLING_BASE.x, SLING_BASE.y, 18, 8, 0, 0, Math.PI * 2); ctx.fill();
  }
  function drawBands() {
    const bp = bird ? { x: bird.position.x, y: bird.position.y } : { x: POCKET.x, y: POCKET.y };
    ctx.strokeStyle = '#3a2410'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(PRONG_L.x, PRONG_L.y); ctx.lineTo(bp.x, bp.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PRONG_R.x, PRONG_R.y); ctx.lineTo(bp.x, bp.y); ctx.stroke();
  }
  function drawBird(body) {
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    if (birdSprite.complete && birdSprite.naturalWidth > 0) {
      const dw = 54, dh = dw * SPR_H / SPR_W;
      ctx.drawImage(birdSprite, -dw / 2, -dh / 2, dw, dh);
    } else {
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath(); ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  function drawTrajectory() {
    let pos = { x: bird.position.x, y: bird.position.y };
    let vel = {
      x: (ANCHOR.x - pos.x) * LAUNCH_K,
      y: (ANCHOR.y - pos.y) * LAUNCH_K
    };
    const g = engine.gravity.y;
    for (let i = 0; i < 34; i++) {
      vel.y += g;
      pos.x += vel.x;
      pos.y += vel.y;
      if (i % 2 === 0) {
        ctx.globalAlpha = 1 - i / 34;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
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
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px "Segoe UI","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(15,23,42,0.6)';
      ctx.strokeText(p.txt, p.x, p.y);
      ctx.fillText(p.txt, p.x, p.y);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  function drawHUD() {
    chip(12, 12, 200, 34, '🐉 奶龙弹射 · ' + LEVELS[levelIndex].name);
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
