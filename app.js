const FRUITS = ['🍎', '🍌', '🍇', '🍓', '🍊', '🍉', '🍑', '🍒', '🍍', '🥝', '🍐', '🍋'];
const SPARKS = ['⭐', '✨', '🌟', '💖'];

// モードごとの設定
//  lives : 下に落とせる回数（0になったらおしまい）
//  easy/ramp : 最初の easy 秒は一定、その後 ramp 秒かけて少しずつ速くなり、頭打ちになる
//  spawnStart/spawnMin : くだものが出る間隔(ms)。難しくなるほど spawnMin に近づく
//  dur : 画面の上から下まで落ちる時間(ms) = base + random*range。cut は最高難度での短縮率
//  size : くだものの大きさ(px) = base + random*range
//  bomb : 爆弾が混ざる確率（さわるとおしまい）
const MODES = {
  kid: {
    bestKey: 'kudamono-catch-best',
    lives: 5,
    easy: 30, ramp: 120,
    spawnStart: 1200, spawnMin: 450,
    dur: { base: 7000, range: 3000, cut: 0.5 },
    size: { base: 80, range: 40 },
    bomb: 0,
  },
  adult: {
    bestKey: 'kudamono-catch-best-adult',
    lives: 3,
    easy: 0, ramp: 150,
    spawnStart: 800, spawnMin: 160,
    dur: { base: 3800, range: 1800, cut: 0.55 },
    size: { base: 56, range: 30 },
    bomb: 0.15,
  },
};

let mode = MODES.kid;
let score = 0;
let best = 0;
let lives = 0;
let combo = 0;
let maxCombo = 0;
let running = false;
let elapsed = 0;
let untilSpawn = 0;
let lastTs = 0;
let audio = null;

const $ = (id) => document.getElementById(id);
const scoreEl = $('score');
const bestEl = $('best');
const livesEl = $('lives');
const comboEl = $('combo');
const startEl = $('start');
const overEl = $('over');
const overScoreEl = $('overScore');
const overBestEl = $('overBest');
const overComboEl = $('overCombo');
const newRecordEl = $('newRecord');
const retryEl = $('retry');
const changeEl = $('change');

function loadBest(key) {
  try {
    const v = parseInt(localStorage.getItem(key), 10);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch (e) { return 0; }
}

function saveBest(key, v) {
  try { localStorage.setItem(key, String(v)); } catch (e) { /* 保存できなくても遊べる */ }
}

function showBest() { bestEl.textContent = '🏆 ' + best; }
function showLives() { livesEl.textContent = '❤️'.repeat(lives) + '🖤'.repeat(Math.max(0, mode.lives - lives)); }

function beep(freq, slide = 2, vol = .25, type = 'sine') {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, audio.currentTime);
    o.frequency.exponentialRampToValueAtTime(freq * slide, audio.currentTime + .25);
    g.gain.setValueAtTime(vol, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .3);
    o.connect(g);
    g.connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + .3);
  } catch (e) { /* 音が出なくてもゲームは続ける */ }
}

// 振動（Android等。iPhoneのSafariは非対応なので何も起きないだけ）
function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* 振動できなくても遊べる */ }
}

// つづけて とるほど 音が高くなる（ドレミ）
const SCALE = [262, 294, 330, 349, 392, 440, 494, 523];
function catchSound() { beep(SCALE[Math.min(combo, SCALE.length - 1)] * 1.5, 1.05, .25); }

function burst(x, y, emojis, n = 8) {
  for (let i = 0; i < n; i++) {
    const p = document.createElement('div');
    p.className = 'p';
    p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    document.body.appendChild(p);
    const a = Math.random() * Math.PI * 2;
    const d = 50 + Math.random() * 90;
    requestAnimationFrame(() => {
      p.style.transform = `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) rotate(${Math.random() * 360}deg)`;
      p.style.opacity = 0;
    });
    setTimeout(() => p.remove(), 750);
  }
}

function showCombo() {
  if (combo >= 5 && combo % 5 === 0) {
    comboEl.textContent = '🔥 ' + combo + ' れんぞく！';
    comboEl.classList.remove('show');
    void comboEl.offsetWidth;
    comboEl.classList.add('show');
  }
}

// 0（やさしい）〜 1（いちばん むずかしい）
function level() {
  return Math.min(1, Math.max(0, (elapsed - mode.easy) / mode.ramp));
}

function spawn() {
  const isBomb = Math.random() < mode.bomb;
  const f = document.createElement('div');
  f.className = 'f';
  f.textContent = isBomb ? '💣' : FRUITS[Math.floor(Math.random() * FRUITS.length)];
  f.dataset.bomb = isBomb ? '1' : '';
  const size = mode.size.base + Math.random() * mode.size.range;
  f.style.fontSize = size + 'px';
  const w = size * 1.5;
  f.style.left = Math.random() * Math.max(0, innerWidth - w) + 'px';
  document.body.appendChild(f);

  const duration = (mode.dur.base + Math.random() * mode.dur.range) * (1 - mode.dur.cut * level());
  const swing = (Math.random() - .5) * 40;
  f.animate(
    [
      { transform: `translate(0, ${-w}px) rotate(${-swing}deg)` },
      { transform: `translate(0, ${innerHeight + w}px) rotate(${swing * 3}deg)` },
    ],
    { duration, easing: 'linear', fill: 'forwards' }
  );

  f.addEventListener('pointerdown', (e) => {
    if (!running) return;
    e.preventDefault();
    const r = f.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    f.remove();
    if (f.dataset.bomb) {
      burst(cx, cy, ['💥', '🔥', '💨']);
      buzz(300);
      gameOver();
      return;
    }
    burst(cx, cy, SPARKS);
    buzz(25);
    combo++;
    maxCombo = Math.max(maxCombo, combo);
    catchSound();
    score++;
    scoreEl.textContent = '⭐ ' + score;
    showCombo();
  });
}

function missed(f) {
  const r = f.getBoundingClientRect();
  f.remove();
  if (f.dataset.bomb) return; // 爆弾は落としてOK
  const m = document.createElement('div');
  m.className = 'miss';
  m.textContent = '💦';
  m.style.left = r.left + r.width / 2 - 20 + 'px';
  m.style.top = innerHeight - 60 + 'px';
  document.body.appendChild(m);
  requestAnimationFrame(() => { m.style.transform = 'translateY(-40px)'; m.style.opacity = 0; });
  setTimeout(() => m.remove(), 750);
  beep(220, 0.6, .25, 'triangle');
  buzz([40, 40, 40]);
  combo = 0;
  lives--;
  showLives();
  if (lives <= 0) gameOver();
}

function tick(ts) {
  if (!running) return;
  const dt = Math.min(ts - lastTs, 100); // タブを離れていた間は進めない
  lastTs = ts;
  elapsed += dt / 1000;

  untilSpawn -= dt;
  if (untilSpawn <= 0) {
    spawn();
    untilSpawn = mode.spawnStart - (mode.spawnStart - mode.spawnMin) * level();
  }

  // 画面の下まで落ちたら ミス
  for (const f of document.querySelectorAll('.f')) {
    if (f.getBoundingClientRect().bottom >= innerHeight) {
      missed(f);
      if (!running) return;
    }
  }
  requestAnimationFrame(tick);
}

function gameOver() {
  if (!running) return;
  running = false;
  document.getAnimations().forEach((a) => a.pause());
  beep(400, 0.4, .3);

  const isNew = score > best;
  if (isNew) {
    best = score;
    saveBest(mode.bestKey, best);
    showBest();
  }
  overScoreEl.textContent = '⭐ ' + score;
  overBestEl.textContent = '🏆 ' + best;
  overComboEl.textContent = '🔥 さいだい ' + maxCombo + ' れんぞく';
  newRecordEl.hidden = !(isNew && score > 0);
  retryEl.disabled = true;
  changeEl.disabled = true;
  overEl.style.display = 'flex';
  setTimeout(() => { retryEl.disabled = false; changeEl.disabled = false; }, 700); // 連打で すぐ再開しないように
}

function clearField() {
  document.querySelectorAll('.f, .p, .miss').forEach((el) => el.remove());
}

function begin(name) {
  if (name) {
    mode = MODES[name];
    best = loadBest(mode.bestKey);
    showBest();
    document.body.dataset.mode = name;
  }
  clearField();
  score = 0;
  combo = 0;
  maxCombo = 0;
  lives = mode.lives;
  elapsed = 0;
  untilSpawn = 0;
  scoreEl.textContent = '⭐ 0';
  showLives();
  startEl.style.display = 'none';
  overEl.style.display = 'none';
  running = true;
  beep(440);
  lastTs = performance.now();
  requestAnimationFrame(tick);
}

function backToStart() {
  clearField();
  overEl.style.display = 'none';
  startEl.style.display = 'flex';
}

document.addEventListener('visibilitychange', () => {
  if (!running) return;
  document.getAnimations().forEach((a) => (document.hidden ? a.pause() : a.play()));
});

document.querySelectorAll('.modeBtn').forEach((btn) => {
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    begin(btn.dataset.mode);
  });
});
retryEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!retryEl.disabled) begin();
});
changeEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!changeEl.disabled) backToStart();
});

lives = mode.lives;
showLives();
best = loadBest(mode.bestKey);
showBest();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
