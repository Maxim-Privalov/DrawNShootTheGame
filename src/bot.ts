// Бот. Фаза 1: преследование с обходом препятствий, минимальное уклонение, выстрелы с телеграфом.
// Фаза 2: стрельба прекращается, бот вырастает и таранит игрока резкими выпадами.
import { dist, isFree, slide, pushOut, type Pt, type Gfx } from './map';
import type { Player, PlayerShot } from './player';

// --- фаза 1 ---
const SPEED = 190;            // базовая скорость (на экране умножается на замедление)
const DODGE_SIGHT = 170;      // снаряд замечается только вплотную
const DODGE_SPEED = 0.5;      // уклоняется вполсилы
const KEEP_MIN = 200, KEEP_MAX = 300; // желаемая дистанция до игрока
const FIRE_EVERY = 2.5, TELEGRAPH = 0.4, FIRE_RANGE = 500, SHOT_SPEED = 500;

// --- фаза 2 ---
const RAM_RADIUS = 30;        // размер бота во второй фазе
const RAM_CHASE_SPEED = 200;  // преследование между выпадами
const LUNGE_SPEED = 900;      // скорость выпада
const LUNGE_RANGE = 240;      // с какой дистанции начинает замах
const WINDUP = 0.5;           // замах: стоит и целится (реальное время)
const LUNGE_TIME = 0.5;       // длительность выпада
const LUNGE_PAUSE = 0.8;      // пауза после выпада

export interface BotShot { x: number; y: number; dx: number; dy: number; speed: number; r: number; dead: boolean }

export interface Bot {
  x: number; y: number; r: number; hp: number; maxHp: number;
  stage: 1 | 2;
  contactCd: number; // кулдаун урона от столкновения, сек
  timer: number;     // фаза 1: время до выстрела, сек
  tele: boolean;     // идёт телеграф (выстрела или замаха)
  ang: number;       // последнее направление движения (для плавности)
  mode: 'chase' | 'windup' | 'lunge'; // фаза 2
  modeT: number;     // сколько осталось до смены режима, сек
  lunge: Pt;         // направление текущего выпада
}

export const newBot = (): Bot => ({
  x: 1180, y: 380, r: 16, hp: 10, maxHp: 10, stage: 1, contactCd: 0, timer: 0, tele: false, ang: 0,
  mode: 'chase', modeT: 1, lunge: { x: 0, y: 0 },
});

export function updateBot(b: Bot, player: Player, playerShots: PlayerShot[], botShots: BotShot[], dt: number, sdt: number) {
  if (b.stage === 1) updateStage1(b, player, playerShots, botShots, dt, sdt);
  else updateStage2(b, player, dt, sdt);
}

// ---------- фаза 1 ----------
function updateStage1(b: Bot, player: Player, playerShots: PlayerShot[], botShots: BotShot[], dt: number, sdt: number) {
  const dodgeDir = dodge(b, playerShots);
  const dir = dodgeDir ?? keepDistance(b, player);
  const speed = dodgeDir ? SPEED * DODGE_SPEED : SPEED;
  slide(b, dir.x * speed * sdt, dir.y * speed * sdt, b.r);
  shoot(b, player, botShots, dt);
}

/**
 * Единственное правило уклонения: если ближайший снаряд летит прямо в бота —
 * шаг перпендикулярно ему в свободную сторону. Null — уклоняться не нужно.
 * Если с обеих сторон стена — возвращает нулевой вектор (бот стоит и получает урон).
 */
function dodge(b: Bot, shots: PlayerShot[]): Pt | null {
  let nearest: PlayerShot | undefined, best = DODGE_SIGHT;
  for (const s of shots) {
    if (s.mine || s.dead) continue;
    const d = dist(s, b);
    if (d < best) { best = d; nearest = s; }
  }
  if (!nearest) return null;
  const rx = b.x - nearest.x, ry = b.y - nearest.y;
  const along = rx * nearest.dx + ry * nearest.dy;   // снаряд приближается, если > 0
  const cross = nearest.dx * ry - nearest.dy * rx;   // расстояние до линии полёта (со знаком)
  if (along <= 0 || Math.abs(cross) >= b.r + nearest.r) return null;

  const px = -nearest.dy, py = nearest.dx, side = cross >= 0 ? 1 : -1;
  const open = (s: number) => isFree(b.x + px * s * 30, b.y + py * s * 30, b.r);
  const s = open(side) ? side : open(-side) ? -side : 0;
  return { x: px * s, y: py * s };
}

/** Дальше KEEP_MAX — идёт к игроку, ближе KEEP_MIN — отступает, между — кружит. */
function keepDistance(b: Bot, p: Pt): Pt {
  const tx = p.x - b.x, ty = p.y - b.y, d = Math.hypot(tx, ty) || 1;
  const toPlayer = Math.atan2(ty, tx);
  return steer(b, d > KEEP_MAX ? toPlayer : d < KEEP_MIN ? toPlayer + Math.PI : toPlayer + Math.PI / 2);
}

/** Из 16 направлений берёт то, куда свободно впереди и которое ближе к желаемому углу `want`. */
function steer(b: Bot, want: number): Pt {
  let bestAng = b.ang, bestScore = -Infinity;
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8, c = Math.cos(a), s = Math.sin(a);
    if (!isFree(b.x + c * 22, b.y + s * 22, b.r) || !isFree(b.x + c * 50, b.y + s * 50, b.r)) continue;
    const score = Math.cos(a - want) + 0.35 * Math.cos(a - b.ang); // второй член — инерция
    if (score > bestScore) { bestScore = score; bestAng = a; }
  }
  b.ang = bestAng;
  return { x: Math.cos(bestAng), y: Math.sin(bestAng) };
}

/** Выстрел раз в 2.5 с, если игрок в радиусе; снаряд летит в позицию игрока на момент выстрела. */
function shoot(b: Bot, p: Pt, botShots: BotShot[], dt: number) {
  const inRange = dist(b, p) <= FIRE_RANGE;
  if (!inRange) b.timer = 0;
  else {
    b.timer += dt;
    if (b.timer >= FIRE_EVERY) {
      b.timer = 0;
      const d = dist(b, p) || 1;
      botShots.push({ x: b.x, y: b.y, dx: (p.x - b.x) / d, dy: (p.y - b.y) / d, speed: SHOT_SPEED, r: 7, dead: false });
    }
  }
  b.tele = inRange && b.timer >= FIRE_EVERY - TELEGRAPH;
}

// ---------- фаза 2 ----------
/** Курс всегда на игрока: погоня → замах (стоит, целится) → резкий выпад → короткая пауза → снова погоня. */
function updateStage2(b: Bot, p: Pt, dt: number, sdt: number) {
  b.r += (RAM_RADIUS - b.r) * Math.min(1, dt * 5); // плавно вырастает
  pushOut(b, b.r);                                  // не застревает в стенах при росте
  b.modeT -= dt;
  b.tele = b.mode === 'windup';

  const d = dist(b, p) || 1;
  const toward = { x: (p.x - b.x) / d, y: (p.y - b.y) / d };

  if (b.mode === 'windup') {
    if (b.modeT <= 0) { b.mode = 'lunge'; b.modeT = LUNGE_TIME; b.lunge = toward; } // направление фиксируется здесь
  } else if (b.mode === 'lunge') {
    slide(b, b.lunge.x * LUNGE_SPEED * sdt, b.lunge.y * LUNGE_SPEED * sdt, b.r);
    if (b.modeT <= 0) { b.mode = 'chase'; b.modeT = LUNGE_PAUSE; }
  } else {
    const dir = steer(b, Math.atan2(toward.y, toward.x));
    slide(b, dir.x * RAM_CHASE_SPEED * sdt, dir.y * RAM_CHASE_SPEED * sdt, b.r);
    if (b.modeT <= 0 && d < LUNGE_RANGE) { b.mode = 'windup'; b.modeT = WINDUP; }
  }
}

// ---------- отрисовка ----------
export function drawBot(g: Gfx, b: Bot, p: Pt, shots: BotShot[], now: number, active: boolean) {
  g.fillStyle(0xff4455, 1); shots.forEach(s => g.fillCircle(s.x, s.y, s.r));
  if (b.tele && active) {
    g.lineStyle(2, 0xff2244, 0.5 + 0.5 * Math.sin(now / 40));
    g.lineBetween(b.x, b.y, p.x, p.y);
    g.strokeCircle(b.x, b.y, b.r + 6);
  }
  g.fillStyle(b.stage === 2 ? 0xe01030 : 0xff5577, 1); g.fillCircle(b.x, b.y, b.r);
}