# Dust Arena — Усилялки / бафф-пикапы (фича-реквест)

**Status:** BACKLOG — зафиксировано как задача. В очереди после weapon-pickups (готово), fog-of-war, hp-bars.

## Идея (со слов фаундера)
Точки-усилялки на карте: например **броня** и какая-то **ускорялка** (буст скорости). Категория временных баффов, поднимаемых как медкит/оружие.

## Переиспользуем готовую инфраструктуру пикапов
Уже есть ДВА паттерна пикапов в коде — копировать третий тип:
- медкиты: `map.json.medkits` → server `room.medkits[i].downUntil` → broadcast `medkit`/`medkitup` → client `buildMedkits`.
- оружие: `map.json.weaponSpawns` → server `room.weapons[i].downUntil` + `player.w` → broadcast `weapon`/`weaponup` → client `buildWeaponSpawns` + `WEAPONS`.
- усилялки: `map.json.powerups: [{x,z,kind}]` → server `room.powerups[i].downUntil` + поле баффа на игроке с истечением → broadcast `powerup`/`powerupup` → client `buildPowerups`.

## Два баффа для старта (kind)

### 1. armor (броня) — СЕРВЕРНЫЙ (авторитетный)
- Урон считается на сервере (`server.js` case 'hit': `target.hp -= wpn.dmg`). Броня обязана жить на сервере, иначе читерится.
- Модель: отдельный пул `player.armor` (например 50), поглощает урон ПЕРЕД hp. В `case 'hit'`: сначала снять с armor, остаток — с hp. Бар брони отдельно от hp.
  - Альтернатива попроще: множитель урона `player.dmgMul=0.5` на N секунд. Решить на старте — пул честнее и нагляднее.
- Поле(я) на игроке: `armor` (или `dmgMul` + `buffUntil`). Сбрасывать на death-respawn и round-lifecycle (как `player.w`).
- Транслировать armor в `states`/`publicPlayer`, чтобы клиент рисовал бар брони.

### 2. speed (ускорялка) — в основном КЛИЕНТСКИЙ feel
- Скорость движения чисто клиентская: `index.html` tick: `const sp = (keys['ShiftLeft'] ? P.walk : P.speed) * (now < slowUntil ? 0.55 : 1)`. Сервер НЕ валидирует скорость (только клампит позицию в ±72.5). Значит буст скорости — клиентский множитель на время.
- Реализация: `let speedBoostUntil=0; ... * (now < speedBoostUntil ? 1.5 : 1)`. На событие `powerup kind:speed` для своего id выставить таймер.
- Анти-чит-нюанс: т.к. сервер скорость не чекает, буст не эксплойтится сверх того, что и так возможно (позиционная валидация уже грубая). Серверный speed-enforcement — отдельная большая тема, НЕ в scope этого баффа.

## Открытые вопросы (решить перед стартом)
- Длительность баффов (армор — до смерти или таймер? скорость — 8–10с?).
- Сколько точек усилялок и где (тематика: armor — у спорных проходов, speed — на флангах).
- Визуал баффа на игроке: свечение/иконка над головой + бар брони (связано с фичей hp-bars).
- Звук подбора (reuse `medkit.mp3` или новый ElevenLabs-сэмпл).

## Файлы правок (предв.)
- `public/map.json` — `powerups` массив.
- `server.js` — armor-логика в case 'hit', пул на игроке, room.powerups, broadcast, сброс на respawn/round.
- `public/index.html` — рендер точек, speed-boost таймер, armor-бар, обработчики `powerup`/`powerupup`.

## Не начинать, пока не подняты приоритеты выше в очереди.
