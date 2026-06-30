# Dust Arena — Weapon Pickups (5 stvolov na karte)

**Status:** LOCKED CONTRACT — субагенты реализуют строго против этого файла. Менять цифры/имена полей нельзя без правки спеки.
**Scope:** `public/map.json` (data) + `server.js` (authority) + `public/index.html` (client). Сетевой слой/комнаты/раунды не переписываем.
**Предшественник:** `plans/v3-weapons/plan.html` — заложил «таблицу оружия как источник правды + поле `w`». Здесь это расширяется на пикапы.

---

## 1. Геймплей в терминах игрока

Игрок спавнится с дефолтным **rifle**. По карте разбросаны **5 точек-пикапов**, каждая выдаёт свой ствол. Наступил на точку → получил ствол (заменяет текущий, патроны полные), точка гаснет и респавнится через 20с (как медкит). Смерть/респавн/новый раунд → ствол сбрасывается обратно на rifle. Сервер — единственный источник правды по урону/дальности/скорострельности: он сам знает, какой ствол держит игрок (выдал на пикапе), клиентскому числу урона не верит.

## 2. Таблица оружия — ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ (server.js)

`id` = индекс в массиве. `id 0` = дефолт спавна (НЕ пикап). `id 1..5` = пикапы.

| id | name    | dmg | fireMs | range | mag | роль |
|----|---------|-----|--------|-------|-----|------|
| 0  | rifle   | 18  | 110    | 40    | 30  | дефолт, 6 хитов в кор (текущее поведение) |
| 1  | smg     | 12  | 70     | 30    | 40  | быстрый спрей, ближний бой |
| 2  | deagle  | 50  | 350    | 36    | 7   | 2 тяжёлых тапа, медленный |
| 3  | shotgun | 65  | 650    | 14    | 6   | ваншот в упор, мизерная дальность |
| 4  | awp     | 100 | 1500   | 62    | 5   | ваншот-килл, очень долгий, дальнобой |
| 5  | lmg     | 16  | 90     | 38    | 100 | пулемёт, огромный магазин, сустейн |

Серверная константа:
```js
const WEAPONS = [
  { id:0, name:'rifle',   dmg:18,  fireMs:110,  range:40, mag:30  },
  { id:1, name:'smg',     dmg:12,  fireMs:70,   range:30, mag:40  },
  { id:2, name:'deagle',  dmg:50,  fireMs:350,  range:36, mag:7   },
  { id:3, name:'shotgun', dmg:65,  fireMs:650,  range:14, mag:6   },
  { id:4, name:'awp',     dmg:100, fireMs:1500, range:62, mag:5   },
  { id:5, name:'lmg',     dmg:16,  fireMs:90,   range:38, mag:100 },
];
const WEAPON_RESPAWN_MS = 20000;
const RANGE_SLACK = 6; // дальность hit-чека = wpn.range + slack (запас на движение с прошлого state)
```
`const HIT_DMG = 18;` удаляется — заменяется чтением из `WEAPONS`.

## 3. map.json — схема пикапов

Добавить корневой ключ `weaponSpawns` — ровно 5 точек, по одной на каждый пикап-ствол (w = 1..5):
```json
"weaponSpawns": [ { "x": <num>, "z": <num>, "w": 1 }, ... { "w": 5 } ]
```
Правила размещения (MAP-агент считает по `boxes`/`medkits`/`spawns`):
- внутри игрового поля, |x|≤70, |z|≤70;
- точка не пересекается с footprint ни одного chest-high бокса (`b.h>=1.2 && b.c!=='#c2a96a'`), запас ≥2.5u по обеим осям;
- ≥6u от любого медкита и любого спавна;
- 5 точек разнесены по карте (не в одном углу), желательно тематически: `awp(4)` — на длинной простреливаемой оси; `shotgun(3)` — в тесном чоке/коридоре; `smg(1)`/`deagle(2)`/`lmg(5)` — на mid/контестед-зонах;
- y не указывать (дефолт 0).
- ВЕРИФИЦИРОВАТЬ node-скриптом: ни одна точка не внутри блокера и не ближе 6u к медкиту/спавну.

## 4. Протокол (дельта к текущему ws)

Сервер хранит `player.w` (дефолт 0). Авторитетность урона — по `player.w`, НЕ по `msg.w`.

| Сообщение | Направление | Изменение |
|-----------|-------------|-----------|
| `init` | S→C | + `weaponSpawns` (массив `{x,z,w}` для рендера) + `weapons` (массив 1/0 видимости, как `medkits`). В `publicPlayer` добавить `w`. |
| `weapon` | S→C broadcast | НОВОЕ: `{ t:'weapon', i, id, w }` — точка `i` подобрана игроком `id`, выдан ствол `w`. Зеркало `medkit`. |
| `weaponup` | S→C broadcast | НОВОЕ: `{ t:'weaponup', i }` — точка `i` респавнится. Зеркало `medkitup`. |
| `states` | S→C | в объект игрока добавить `w` (для модели ствола на ремоутах; дёшево). |
| `shoot` | C→S→C | сервер в broadcast добавляет `w: player.w` (авторитетно, для звука/трейсера ремоутов). Клиент шлёт `w` как косметику. |
| `hit` | C→S | урон/дальность/rate берутся из `WEAPONS[player.w]` (сервер игнорит `msg.w` для урона). |

Сброс ствола: на death-respawn (`setTimeout` в `hit`), и в round-lifecycle (`roundstart`) ставить `player.w = 0`. Клиент локально сбрасывает в `resetGun()`.

## 5. server.js — точки правки (anchors)

1. Константы (после `SPAWN_PROT_MS`): заменить `HIT_DMG` на `WEAPONS` + `WEAPON_RESPAWN_MS` + `RANGE_SLACK`. Добавить `const WEAPON_SPAWNS = MAP.weaponSpawns || [];`.
2. `getRoom()` room init: добавить `weapons: WEAPON_SPAWNS.map(() => ({ downUntil: 0 }))`.
3. join → player object: добавить `w: 0`.
4. `publicPlayer()`: добавить `w: p.w`.
5. `init` payload (оба места: spectator и игрок): добавить `weaponSpawns: WEAPON_SPAWNS.map(s=>({x:s.x,z:s.z,w:s.w}))` и `weapons: room.weapons.map(m=>m.downUntil>Date.now()?0:1)`.
6. `case 'state'`: ПОСЛЕ блока медкитов добавить аналогичный блок подбора оружия — для каждой точки `i`: если `!down` и `dx²+dz²<2.2`, то `mk.downUntil=now+WEAPON_RESPAWN_MS`, `player.w=WEAPON_SPAWNS[i].w`, `broadcast({t:'weapon',i,id:player.id,w:player.w})`, `break`. (Радиус 2.2 как у медкита; высоту можно не чекать — точки на земле.)
7. `case 'shoot'`: в broadcast добавить `w: player.w`.
8. `case 'hit'`: `const wpn = WEAPONS[player.w] || WEAPONS[0];` дальше `range`→`(wpn.range+RANGE_SLACK)²`, `nextHit += wpn.fireMs`, `target.hp -= wpn.dmg`.
9. death-respawn `setTimeout`: добавить `target.w = 0;` перед broadcast `respawn`.
10. round-lifecycle (`breakUntil` истёк → новый раунд): в цикле по игрокам добавить `p.w = 0;` и сбросить `room.weapons` (`for(const m of room.weapons) m.downUntil=0`).
11. main tick: после medkit-респавнов добавить аналогичный цикл по `room.weapons` → `broadcast({t:'weaponup',i})`.
12. `states` broadcast: в map игрока добавить `w: p.w`.

## 6. index.html — точки правки (anchors)

1. Клиентское зеркало `WEAPONS` (имя/mag/fireMs/range + косметика звука/спреда). dmg клиенту не нужен (сервер считает):
```js
const WEAPONS = [
  { name:'RIFLE',   mag:30,  fireMs:110,  range:40, sndRate:1.0,  sndVol:0.25, spreadMul:1.0, color:0xffce54 },
  { name:'SMG',     mag:40,  fireMs:70,   range:30, sndRate:1.25, sndVol:0.18, spreadMul:1.3, color:0x4fd0e0 },
  { name:'DEAGLE',  mag:7,   fireMs:350,  range:36, sndRate:0.8,  sndVol:0.4,  spreadMul:1.8, color:0xd8d8d8 },
  { name:'SHOTGUN', mag:6,   fireMs:650,  range:14, sndRate:0.55, sndVol:0.5,  spreadMul:2.2, color:0xff8a3a },
  { name:'AWP',     mag:5,   fireMs:1500, range:62, sndRate:0.45, sndVol:0.55, spreadMul:0.4, color:0x7CFC00 },
  { name:'LMG',     mag:100, fireMs:90,   range:38, sndRate:1.1,  sndVol:0.3,  spreadMul:1.4, color:0xff5544 },
];
let myW = 0; const curW = () => WEAPONS[myW];
```
2. `const RANGE = 34` → сделать переменной от текущего ствола. Ввести `let curRange = WEAPONS[0].range;` и пересчитывать на смене ствола. Все использования `RANGE` (aim ring радиус, aimLine clamp, hitscan `reach`/`flen`, tracer len) перевести на `curRange`. Aim-ring geometry строится один раз с фикс. радиусом — на смене ствола **пересобрать** geometry кольца (dispose+new `RingGeometry(curRange-0.5,curRange,64)`).
3. Рендер пикапов: по аналогии с `buildMedkits` сделать `buildWeaponSpawns(states)` из `MAP.weaponSpawns` — Group на точку, базовый ящик + цветной акцент `WEAPONS[w].color`, floating+rotate в tick-цикле (как медкиты). Видимость из `states`. Хранить `weaponMeshes[]`.
4. `init` обработчик: вызвать `buildWeaponSpawns(m.weapons||[])`; если `m.players` несут `w` — учесть (необяз. для v1).
5. Новые сообщения:
   - `case 'weapon'`: спрятать `weaponMeshes[m.i]`. Если `m.id===myId` → `myW=m.w`, обновить `curRange`, пересобрать кольцо, `ammo=curW().mag`, обновить HUD-имя ствола, проиграть пикап-звук (reuse `reload`/`medkit` sfx или `blip`). Если ремоут — опц. сменить ему модель ствола (можно пропустить в v1).
   - `case 'weaponup'`: показать `weaponMeshes[m.i]`.
6. `shoot()`: rate-gate `now-lastShot < curW().fireMs` (вместо 120). spread с учётом `curW().spreadMul`. reach/flen по `curRange`. В ws-сообщения `shoot`/`hit` добавить `w: myW` (косметика; сервер всё равно считает по `player.w`). `shotSound` вызвать с `curW().sndVol`/`sndRate` (расширить `shotSound`, чтобы принимать rate; сейчас рандомит вокруг 0.94–1.06 — умножать на `curW().sndRate`).
7. `reload()`: `ammo === 30` → `ammo === curW().mag`; цель перезарядки `ammo = curW().mag`. Длительность можно оставить 2000 (для awp/deagle ок).
8. `resetGun()`: `myW=0; curRange=WEAPONS[0].range; пересобрать кольцо; ammo=WEAPONS[0].mag;`. Вызывается на respawn/roundstart/die — там ствол откатывается на rifle.
9. `states` обработчик: если игрок несёт `w`, можно обновить модель ствола ремоута (опц. v1 — пропустить, не ломать).
10. HUD: `#ammo` показывает `${curW().name} ${ammo}/∞`. Аим-кольцо радиус = `curRange`.
11. tick-цикл: добавить анимацию `weaponMeshes` (rotate+bob, как медкиты).

## 7. Анти-чит / авторитетность

- Урон/дальность/скорострельность — ТОЛЬКО `WEAPONS[player.w]` на сервере. `msg.w` от клиента используется лишь как косметика в relay `shoot` (и сервер перезаписывает его на `player.w`).
- Подбор оружия валидируется сервером по позиции игрока (как медкит): клиент не может «выдать себе awp» — только дойти до точки.
- Rate-cap по `wpn.fireMs` остаётся серверным (leaky bucket), поэтому infinite-ammo чит не даёт burst выше скорострельности ствола.

## 8. Приёмка (verify)

1. `node --check server.js` — без синтаксических ошибок.
2. `node -e "require('./public/map.json')"` — валидный JSON, `weaponSpawns.length===5`, w ∈ {1,2,3,4,5} по одному разу, ни одна точка не в блокере и не ближе 6u к медкиту/спавну.
3. Интеграционная сверка протокола: имена полей и id стволов совпадают между server.js ↔ index.html (`weaponSpawns`, `weapons`, `weapon`/`weaponup`, `w`). WEAPONS server (6 записей) ↔ client (6 записей), mag/fireMs/range совпадают.
4. Поднять сервер локально (`PORT=3010 node server.js`), `curl -fsS localhost:3010/` 200, ws-init содержит `weaponSpawns`+`weapons`.
5. Не сломать существующее: медкиты, раунды, респавн, killfeed, тонты работают как раньше.

## 9. Вне scope этого среза (follow-up)

- Дробовик одной пулей (а не веером пеллет) — пеллет-спред в v2.
- Отдельные ElevenLabs SFX на каждый ствол (сейчас — playbackRate/volume по одному `shot.mp3`).
- Серверный учёт магазина (reload-событие в протоколе).
- Подсветка модели ствола на ремоут-игроках по `w`.
- **Туман войны** (видно только перед собой) — отдельная следующая фича, `plans/fog-of-war/`.
