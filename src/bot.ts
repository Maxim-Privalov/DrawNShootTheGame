// Бот. Фаза 1: преследование с обходом препятствий, минимальное уклонение, выстрелы с телеграфом.
// Фаза 2: стрельба прекращается, бот вырастает и таранит игрока резкими выпадами.
import { dist, dirTo, isFree, slide, pushOut, disc, type Pt, type Gfx } from './map';
import type { Player, PlayerShot } from './player';
import { BOT } from './config';

const S1 = BOT.stage1, S2 = BOT.stage2;

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
  x: BOT.start.x, y: BOT.start.y, r: BOT.radius, hp: BOT.hp, maxHp: BOT.hp, stage: 1, contactCd: 0, timer: 0, tele: false, ang: 0,
  mode: 'chase', modeT: 1, lunge: { x: 0, y: 0 },
});

export function updateBot(b: Bot, player: Player, playerShots: PlayerShot[], botShots: BotShot[], dt: number, sdt: number) {
  if (b.stage === 1) updateStage1(b, player, playerShots, botShots, dt, sdt);
  else updateStage2(b, player, dt, sdt);
}

/** Шаг бота в направлении dir со скоростью speed (стены учитываются). */
const moveAlong = (b: Bot, dir: Pt, speed: number, sdt: number) => slide(b, dir.x * speed * sdt, dir.y * speed * sdt, b.r);

// ---------- фаза 1 ----------
function updateStage1(b: Bot, player: Player, playerShots: PlayerShot[], botShots: BotShot[], dt: number, sdt: number) {
  const dodgeDir = dodge(b, playerShots);
  moveAlong(b, dodgeDir ?? keepDistance(b, player), dodgeDir ? S1.speed * S1.dodgeSpeed : S1.speed, sdt);
  shoot(b, player, botShots, dt);
}

/**
 * Единственное правило уклонения: если ближайший снаряд летит прямо в бота —
 * шаг перпендикулярно ему в свободную сторону. Null — уклоняться не нужно.
 * Если с обеих сторон стена — возвращает нулевой вектор (бот стоит и получает урон).
 */
function dodge(b: Bot, shots: PlayerShot[]): Pt | null {
  let nearest: PlayerShot | undefined, best = S1.dodgeSight;
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
  const open = (s: number) => isFree(b.x + px * s * BOT.sidestep, b.y + py * s * BOT.sidestep, b.r);
  const s = open(side) ? side : open(-side) ? -side : 0;
  return { x: px * s, y: py * s };
}

/** Дальше keepMax — идёт к игроку, ближе keepMin — отступает, между — кружит. */
function keepDistance(b: Bot, p: Pt): Pt {
  const d = dist(b, p), toPlayer = Math.atan2(p.y - b.y, p.x - b.x);
  return steer(b, d > S1.keepMax ? toPlayer : d < S1.keepMin ? toPlayer + Math.PI : toPlayer + Math.PI / 2);
}

/** Из 16 направлений берёт то, куда свободно впереди и которое ближе к желаемому углу `want`. */
function steer(b: Bot, want: number): Pt {
  let bestAng = b.ang, bestScore = -Infinity;
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8, c = Math.cos(a), s = Math.sin(a);
    if (!isFree(b.x + c * BOT.probeNear, b.y + s * BOT.probeNear, b.r) || !isFree(b.x + c * BOT.probeFar, b.y + s * BOT.probeFar, b.r)) continue;
    const score = Math.cos(a - want) + 0.35 * Math.cos(a - b.ang); // второй член — инерция
    if (score > bestScore) { bestScore = score; bestAng = a; }
  }
  b.ang = bestAng;
  return { x: Math.cos(bestAng), y: Math.sin(bestAng) };
}

/** Выстрел раз в 2.5 с, если игрок в радиусе; снаряд летит в позицию игрока на момент выстрела. */
function shoot(b: Bot, p: Pt, botShots: BotShot[], dt: number) {
  const inRange = dist(b, p) <= S1.fireRange;
  if (!inRange) b.timer = 0;
  else {
    b.timer += dt;
    if (b.timer >= S1.fireEvery) {
      b.timer = 0;
      const u = dirTo(b, p);
      botShots.push({ x: b.x, y: b.y, dx: u.x, dy: u.y, speed: S1.shotSpeed, r: S1.shotRadius, dead: false });
    }
  }
  b.tele = inRange && b.timer >= S1.fireEvery - S1.telegraph;
}

// ---------- фаза 2 ----------
/** Курс всегда на игрока: погоня → замах (стоит, целится) → резкий выпад → короткая пауза → снова погоня. */
function updateStage2(b: Bot, p: Pt, dt: number, sdt: number) {
  b.r += (S2.radius - b.r) * Math.min(1, dt * 5); // плавно вырастает
  pushOut(b, b.r);                                  // не застревает в стенах при росте
  b.modeT -= dt;
  b.tele = b.mode === 'windup';
  const toward = dirTo(b, p);

  if (b.mode === 'windup') {
    if (b.modeT <= 0) { b.mode = 'lunge'; b.modeT = S2.lungeTime; b.lunge = toward; } // направление фиксируется здесь
  } else if (b.mode === 'lunge') {
    moveAlong(b, b.lunge, S2.lungeSpeed, sdt);
    if (b.modeT <= 0) { b.mode = 'chase'; b.modeT = S2.lungePause; }
  } else {
    moveAlong(b, steer(b, Math.atan2(toward.y, toward.x)), S2.chaseSpeed, sdt);
    if (b.modeT <= 0 && dist(b, p) < S2.lungeRange) { b.mode = 'windup'; b.modeT = S2.windup; }
  }
}

// ---------- отрисовка ----------
export function drawBot(g: Gfx, b: Bot, p: Pt, shots: BotShot[], now: number, active: boolean) {
  shots.forEach(s => disc(g, s, 0xff4455));
  if (b.tele && active) {
    g.lineStyle(2, 0xff2244, 0.5 + 0.5 * Math.sin(now / 40));
    g.lineBetween(b.x, b.y, p.x, p.y);
    g.strokeCircle(b.x, b.y, b.r + 6);
  }
  disc(g, b, b.stage === 2 ? 0xe01030 : 0xff5577);
}
