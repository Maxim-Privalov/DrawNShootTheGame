// Бот: преследование с обходом препятствий, минимальное уклонение, выстрелы с телеграфом.
import { dist, isFree, slide, type Pt, type Gfx } from './map';
import type { Player, PlayerShot } from './player';

const SPEED = 190;            // базовая скорость (на экране умножается на замедление)
const DODGE_SIGHT = 170;      // снаряд замечается только вплотную
const DODGE_SPEED = 0.5;      // уклоняется вполсилы
const KEEP_MIN = 200, KEEP_MAX = 300; // желаемая дистанция до игрока
const FIRE_EVERY = 2.5, TELEGRAPH = 0.4, FIRE_RANGE = 500, SHOT_SPEED = 500;

export interface BotShot { x: number; y: number; dx: number; dy: number; speed: number; r: number; dead: boolean }

export interface Bot {
  x: number; y: number; r: number; hp: number;
  timer: number;   // время до выстрела, сек (реальное)
  tele: boolean;   // идёт телеграф выстрела
  ang: number;     // последнее направление движения (для плавности)
}

export const newBot = (): Bot => ({ x: 1180, y: 380, r: 16, hp: 10, timer: 0, tele: false, ang: 0 });

export function updateBot(b: Bot, player: Player, playerShots: PlayerShot[], botShots: BotShot[], dt: number, sdt: number) {
  const dodgeDir = dodge(b, playerShots);
  const dir = dodgeDir ?? chase(b, player);
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

/**
 * Преследование: дальше KEEP_MAX — идёт к игроку, ближе KEEP_MIN — отступает, между — кружит.
 * Из 16 направлений берёт то, куда свободно впереди и которое ближе к желаемому.
 */
function chase(b: Bot, p: Pt): Pt {
  const tx = p.x - b.x, ty = p.y - b.y, d = Math.hypot(tx, ty) || 1;
  const toPlayer = Math.atan2(ty, tx);
  const want = d > KEEP_MAX ? toPlayer : d < KEEP_MIN ? toPlayer + Math.PI : toPlayer + Math.PI / 2;
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

export function drawBot(g: Gfx, b: Bot, p: Pt, shots: BotShot[], now: number, active: boolean) {
  g.fillStyle(0xff4455, 1); shots.forEach(s => g.fillCircle(s.x, s.y, s.r));
  if (b.tele && active) {
    g.lineStyle(2, 0xff2244, 0.5 + 0.5 * Math.sin(now / 40));
    g.lineBetween(b.x, b.y, p.x, p.y);
    g.strokeCircle(b.x, b.y, b.r + 6);
  }
  g.fillStyle(0xff5577, 1); g.fillCircle(b.x, b.y, b.r);
}
