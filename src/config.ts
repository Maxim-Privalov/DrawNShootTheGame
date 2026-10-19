// Основные игровые константы: размеры, скорости, урон, тайминги. Всё, что правится при настройке баланса.
// Скорости — «базовые»: на экране движение умножается на TIME_SCALE.
import type { Rect } from './map';

// ---------- окно, арена, время ----------
export const W = 1280, H = 720;
export const AX = 40, AY = 60, AW = 1200, AH = 640; // арена: левый верхний угол и размеры
export const TIME_SCALE = 0.4;                       // замедление времени (влияет на движение, не на кулдауны)

export const OBSTACLES: Rect[] = [
  { x: 200, y: 300, w: 50, h: 160 }, { x: 1030, y: 300, w: 50, h: 160 }, { x: 590, y: 320, w: 100, h: 120 },
  { x: 560, y: 140, w: 160, h: 30 }, { x: 560, y: 590, w: 160, h: 30 },
];

// ---------- игрок ----------
export const PLAYER = {
  hp: 3, radius: 14, speed: 220,
  start: { x: 100, y: 380 },
  invulnerability: 0.5,   // неуязвимость после урона, сек
};

// ---------- заклинания ----------
export const SPELL = {
  cooldown: 0.6,          // общий кулдаун запуска, сек
  maxPoints: 8,           // максимум точек траектории
  line: { radius: 8, damage: 1, speed: 900 },
  volley: { radius: 4, damage: 0.5, speed: 700 },
  wall: { radius: 6, life: 3, spacing: 60 }, // мины: живут life сек, ставятся через spacing px
};

// ---------- бот ----------
export const BOT = {
  hp: 10, radius: 16,
  start: { x: 1180, y: 380 },
  stage2At: 0.5,          // доля здоровья, при которой начинается фаза 2
  contactCooldown: 1,     // кулдаун урона от столкновения, сек
  ramDamage: 1,           // урон тарана в фазе 1
  ramDamageStage2: 2,     // урон тарана в фазе 2
  probeNear: 22, probeFar: 50, // на сколько вперёд проверяется свободное место при выборе курса
  sidestep: 30,           // на сколько вбок проверяется место при уклонении

  stage1: {
    speed: 190,
    dodgeSight: 170,      // снаряд замечается только вплотную
    dodgeSpeed: 0.5,      // уклоняется вполсилы (доля от speed)
    keepMin: 200, keepMax: 300, // желаемая дистанция до игрока
    fireEvery: 2.5, telegraph: 0.4, fireRange: 500,
    shotSpeed: 500, shotRadius: 7,
  },
  stage2: {
    radius: 30,           // размер бота во второй фазе
    chaseSpeed: 200,      // погоня между выпадами
    lungeSpeed: 900, lungeRange: 240, // скорость выпада и дистанция, с которой начинается замах
    windup: 0.5, lungeTime: 0.5, lungePause: 0.8, // замах, выпад, пауза — сек
  },
};

// ---------- счёт и события ----------
export const SCORE = { hit: 10, nearMiss: 3, nearMissDistance: 40 };
export const STAGE_BANNER_TIME = 3; // сколько показывать «STAGE 2», сек
