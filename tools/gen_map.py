#!/usr/bin/env python3
"""dust-arena map v3 generator — top-down de_dust2 homage (Brawl-Stars camera).

Emits public/map.json {boxes, spawns, medkits} consumed by BOTH client and server.
WARNING: public/map.json also carries `weaponSpawns`, `armor`, and `boosts` arrays that
are added BY HAND (not emitted by this script's emit()). Re-running this generator
overwrites public/map.json and WILL WIPE those manual fields — re-add them after
regenerating, or patch emit() first if they need to become generator-managed.
Top-down rules (from research):
  - walkable walls cap at 2.2 (1.2x player height) so a 60-deg camera reads the map
  - buildings = solid 2.4-high "roof" blocks players can never climb
  - hard cover 1.5-2.2 blocks walk+shots; soft cover 0.9-1.0 blocks walk only
    (bullets fly at chest height 1.2)
  - elevation simplified: T spawn +1.5 plateau (suicide drop), catwalk/A site +2,
    lower tunnels collapsed into a flat link corridor (CS2D approach)

Frame: 150x150, center (0,0). X=east, Z=south. North = -z = top of radar.
T spawn south, CT north-center, B site NW, A site NE, long east, tunnels west.
Player: 1.8 tall, radius 0.4, step-up 0.55, jump ~1.3.
"""
import json
import math
import os

# palette
SAND = '#c9b074'   # ground (client floor)
WALL = '#b8995f'   # generic walls
STONE = '#a89a78'  # stone accents, stairs, low cover
DARK = '#b09a5e'   # building roofs (unwalkable massifs)
CR_A = '#9b7b48'   # crates
CR_B = '#7e6238'
PLAT = '#c2a96a'   # raised walkable plateaus
DOOR = '#6e4f2a'   # wooden door slabs (long doors / mid doors / B doors)
BLUE = '#3f5f8a'   # the blue crate at long / car silhouettes
MARK = '#e8dfc8'   # painted floor letters (radar-style site marks)

ARENA = 150
HALF = 73

B = []


def box(name, x, z, w, h, d, c, y=0.0):
    B.append(dict(name=name, x=x, z=z, w=w, h=h, d=d, c=c, y=y))


def slab(name, x0, x1, z0, z1, h=2.2, c=WALL, y=0.0):
    """axis-aligned slab given by edges"""
    box(name, (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, h, z1 - z0, c, y)


def stairs(name, x, z, w, d, axis, h1, steps=4, y0=0.0):
    """staircase rising to h1 along axis; first step <=0.55 above y0"""
    for i in range(steps):
        h = y0 + (h1 - y0) * (i + 1) / steps
        if axis in ('z+', 'z-'):
            sd = d / steps
            sz = z - d / 2 + sd * (i + 0.5) if axis == 'z+' else z + d / 2 - sd * (i + 0.5)
            box(f'{name}{i+1}', x, sz, w, h - 0 if True else h, sd, STONE)
            B[-1]['h'] = h  # absolute top
        else:
            sw = w / steps
            sx = x - w / 2 + sw * (i + 0.5) if axis == 'x+' else x + w / 2 - sw * (i + 0.5)
            box(f'{name}{i+1}', sx, z, sw, h, d, STONE)


def build_map():
    # ---- perimeter (low — the camera must read over it; occlusion fade covers rest)
    box('perimN', 0, -74, 150, 2.6, 2, WALL)
    box('perimS', 0, 74, 150, 2.6, 2, WALL)
    box('perimW', -74, 0, 2, 2.6, 150, WALL)
    box('perimE', 74, 0, 2, 2.6, 150, WALL)

    # =========================================================== T SPAWN (S)
    # raised plaza +1.5 with the iconic suicide drop into top mid
    slab('tSpawnPlat', -24, 10, 52, 73, h=1.5, c=PLAT)     # flush to perimeter (no trap strip)
    stairs('tStW', -27, 58, 6, 8, 'x+', 1.5)               # west: down to tunnels yard
    stairs('tStE', 13, 58, 6, 8, 'x-', 1.5)                # east: down toward long
    slab('tWallW', -24, -10, 48, 52, h=2.4, c=DARK)        # frame; suicide gap x -10..2
    slab('tWallE', 2, 10, 48, 52, h=2.4, c=DARK)

    # =========================================================== WEST MASSES
    slab('wMass', -68, -46, -2, 40, h=2.4, c=DARK)         # between tunnels & perimeter
    slab('midWestMass', -36, -12, 24, 48, h=2.4, c=DARK)   # tunnels-yard / mid divider
    slab('bDoorMass', -36, -12, -8, 16, h=2.4, c=DARK)     # B-corridor / mid divider

    # ============================================================ TUNNELS (W)
    # yard: x -48..-26, z 40..66 (below west mass, reached by T west stairs)
    box('tyCrate1', -42, 48, 2.6, 1.6, 2.6, CR_A)
    box('tyCrate2', -42, 48, 2.6, 1.2, 2.6, CR_B, 1.6)
    box('tyCrate3', -34, 56, 2.2, 1.5, 2.2, CR_B)
    # upper tunnel corridor: x -46..-38, z -8..40
    slab('tunE_N', -38, -36, -8, 16, h=2.2, c=WALL)        # east wall, north part
    slab('tunE_S', -38, -36, 24, 40, h=2.2, c=WALL)        # east wall, south part
    slab('tunMouthE', -36, -26, 38, 40, h=2.2, c=WALL)     # frames yard->tunnel mouth
    box('tunCrate', -44.6, 33, 2.2, 1.6, 2.2, CR_B)        # bend cover inside tunnel
    # flat "lower tunnels" link: x -36..-12, z 16..24, tunnels <-> mid
    box('linkCrate', -24, 20, 2.2, 0.95, 2.2, STONE)       # soft cover in the link

    # ============================================================== B SITE (NW)
    # yard: x -68..-28, z -66..-10 (north & west = perimeter, like the real back walls)
    slab('bEastWall', -28, -24, -66, -32, h=2.4, c=DARK)   # vs CT spawn, with window:
    box('bWindowSill', -26, -30, 4, 1.1, 4, STONE)         # sill: bullets pass, jump-vault
    slab('bEastWallS', -28, -24, -28, -18, h=2.4, c=DARK)
    # B south wall with tunnel exit gap x -46..-38
    slab('bSouthW', -68, -46, -10, -8, h=2.2, c=WALL)
    slab('bSouthE', -38, -28, -10, -8, h=2.2, c=WALL)
    # B doors corridor: x -28..-14, z -16..-8 (CT mid <-> B yard), arch pillar + slab
    slab('bDoorsN', -28, -14, -18, -16, h=2.2, c=WALL)
    box('bDoorsPillar', -21, -12, 2.2, 2.2, 2.4, WALL)
    box('bDoorSlab', -17.4, -14.6, 0.8, 2.1, 2.6, DOOR)
    # furniture
    box('bStack1', -48, -34, 3, 2.0, 3, CR_A)              # double-stack, site center
    box('bStack2', -48, -34, 3, 1.4, 3, CR_B, 2.0)
    box('bBoxLow', -43.8, -31, 2.4, 0.95, 2.4, CR_B)       # soft cover
    box('bCar', -33, -13, 5, 1.5, 2.6, BLUE)               # car near doors
    slab('bPlat', -66, -44, -66, -58, h=1.2, c=PLAT)       # plat along back (north) wall
    stairs('bPlatSt', -50, -56.5, 4, 3, 'z-', 1.2, steps=3)
    box('bCloset', -64, -54, 4, 1.6, 4, CR_A)              # west wall closet crates

    # ====================================================== CT MID / CT SPAWN
    # CT mid: x -14..4, z -30..-8 | CT spawn plaza: x -8..24, z -60..-32
    slab('ctMidE', 4, 6, -30, -8, h=2.2, c=WALL)           # vs catwalk-ground pocket
    box('ctMidCrate', -11.4, -26, 2.4, 1.6, 2.4, CR_A)
    box('ctCover1', 2, -50, 7, 0.95, 1.6, STONE)
    box('ctCover2', 14, -44, 1.6, 0.95, 6, STONE)
    box('ctCrate', -4, -56, 2.2, 1.6, 2.2, CR_B)

    # ============================================================== MID (center)
    # corridor x -12..4 between the west masses and the east building
    slab('midEastBldg', 4, 20, 8, 48, h=2.4, c=DARK)       # mid / long-yard divider
    box('xbox', 1, 5.6, 2.6, 1.5, 2.6, CR_A)               # the mid crate
    box('midLow', -8.6, 16, 2.4, 0.95, 2.4, STONE)         # soft cover
    box('tmCrate', -10.6, 38, 2.4, 1.6, 2.4, CR_B)         # top mid corner
    # mid doors: two arches + pillar + half-open slabs (z -8..-6)
    slab('midDoorsW', -14, -8, -8, -6, h=2.2, c=WALL)
    box('midDoorsPillar', -2, -7, 3, 2.2, 2, WALL)
    slab('midDoorsE', 4, 14, -8, -6, h=2.2, c=WALL)        # seals the catwalk-pocket bypass
    box('ctPocketCrate', 9, -24, 2.4, 1.6, 2.4, CR_B)      # cover in the under-short pocket
    box('midDoorSlabL', -7.2, -7, 1.6, 2.1, 0.8, DOOR)
    box('midDoorSlabR', 3.2, -7, 1.6, 2.1, 0.8, DOOR)

    # ============================================================== LONG (E)
    # big building west of long corridor; pit notch at its SE (x 52..56, z 20..30)
    slab('longBldgN', 36, 56, -18, 20, h=2.4, c=DARK)
    slab('longBldgS', 36, 52, 20, 32, h=2.4, c=DARK)
    box('pitLip', 54, 21, 4, 0.95, 2, STONE)               # shoot-over lip of the pit
    # long doors across the corridor (z 30..32): gaps x 58..62 and 64..68
    slab('longDoorsW', 56, 58, 30, 32, h=2.2, c=WALL)
    box('longDoorsPillar', 63, 31, 2, 2.2, 2, WALL)
    slab('longDoorsE', 68, 73, 30, 32, h=2.2, c=WALL)
    box('longDoorSlabL', 58.8, 31, 1.6, 2.1, 0.8, DOOR)
    box('longDoorSlabR', 67.2, 31, 1.6, 2.1, 0.8, DOOR)
    # outside long yard: x 36..70, z 32..58
    box('blueCrate', 44, 42, 3, 2.0, 3, BLUE)              # the blue crate
    box('blueCrateLow', 47.4, 42, 2.2, 0.95, 2.6, CR_A)
    slab('olSouthBldg', 36, 68, 58, 68, h=2.4, c=DARK)     # yard south frame
    # long corridor x 56..70, z -18..30
    box('longCrate', 67.4, -4, 2.6, 1.6, 2.6, CR_A)

    # ============================================================== A SITE (NE)
    # plateau +2: x 36..68, z -68..-38; cross below: x 34..70, z -36..-18
    slab('aSite', 36, 73, -73, -38, h=2.0, c=PLAT)         # flush to NE corner (no trap strips)
    stairs('aStairsS', 52, -36, 8, 4, 'z-', 2.0)           # from cross, south face
    stairs('aRampW', 34, -46, 4, 8, 'x+', 2.0)             # CT-side ramp, west face
    slab('aWestBldg', 26, 36, -73, -50, h=2.4, c=DARK)     # CT spawn / site divider
    box('aCar', 41, -32, 5, 1.5, 2.6, BLUE)                # car at the cross
    box('aCrate1', 60, -60, 2.6, 1.6, 2.6, CR_A, 2.0)      # site hard cover
    box('aCrate2', 60, -60, 2.6, 1.2, 2.6, CR_B, 3.6)
    box('aBoxLow', 47, -54, 2.4, 0.95, 2.4, CR_B, 2.0)     # site soft cover
    # goose pocket on site NE (open from the south = from the site)
    box('gooseW', 64, -66, 1.6, 2.2, 13, STONE, 2.0)       # west wall of the alcove

    # ========================================================= CATWALK / SHORT
    stairs('catSt', 6, 3, 4, 6, 'x+', 2.0)                 # up from mid at xbox
    slab('cat1', 8, 18, 0, 6, h=2.0, c=PLAT)               # landing
    slab('cat2', 14, 22, -30, 0, h=2.0, c=PLAT)            # the walkway over CT pocket
    slab('catShort', 22, 40, -38, -30, h=2.0, c=PLAT)      # short, lands on A site
    box('catRail', 13.2, -15, 0.8, 0.9, 26, STONE, 2.0)    # low rail (soft cover)

    # ======================================================= extra lane cover
    box('crossCrate', 56, -26, 2.6, 1.6, 2.6, CR_B)        # cross cover
    box('olCrate', 38, 54, 2.4, 1.5, 2.4, CR_B)            # yard corner
    box('tRampCrate', 22, 52, 2.4, 1.6, 2.4, CR_A)         # T->long route cover

    # =========================================== painted site letters (radar)
    def letter_A(cx, cz, y):
        s, t = 7.0, 1.3                                    # height, stroke
        box('mkA_l', cx - 2.2, cz, t, 0.06, s, MARK, y)
        box('mkA_r', cx + 2.2, cz, t, 0.06, s, MARK, y)
        box('mkA_top', cx, cz - s / 2 + t / 2, 5.7, 0.06, t, MARK, y)
        box('mkA_mid', cx, cz + 0.8, 3.2, 0.06, t, MARK, y)

    def letter_B(cx, cz, y):
        s, t = 7.0, 1.3
        box('mkB_l', cx - 2.2, cz, t, 0.06, s, MARK, y)
        box('mkB_top', cx + 0.3, cz - s / 2 + t / 2, 3.8, 0.06, t, MARK, y)
        box('mkB_mid', cx + 0.3, cz, 3.8, 0.06, t, MARK, y)
        box('mkB_bot', cx + 0.3, cz + s / 2 - t / 2, 3.8, 0.06, t, MARK, y)
        box('mkB_r1', cx + 2.4, cz - 1.6, t, 0.06, 2.2, MARK, y)
        box('mkB_r2', cx + 2.4, cz + 1.6, t, 0.06, 2.2, MARK, y)

    letter_A(55, -51, 2.0)
    letter_B(-52, -38, 0.0)


SPAWNS_T = [
    (-18, 1.5, 58), (-12, 1.5, 62), (-6, 1.5, 57), (0, 1.5, 62),
    (5, 1.5, 58), (-15, 1.5, 55), (-2, 1.5, 55), (7, 1.5, 64),
]
SPAWNS_CT = [
    (-4, 0, -46), (2, 0, -52), (8, 0, -44), (14, 0, -50),
    (18, 0, -42), (-2, 0, -38), (10, 0, -58), (20, 0, -48),
]
MEDKITS = [
    (-4, 16),     # mid
    (-25, -12),   # B doors, yard-side mouth
    (-50, -42),   # B site
    (50, -28),    # A cross
    (63, 8),      # long
    (-42, 12),    # upper tunnels
]


# ---------------------------------------------------------------- validation

def dist_pt_box(px, pz, b):
    dx = max(b['x'] - b['w'] / 2 - px, 0, px - (b['x'] + b['w'] / 2))
    dz = max(b['z'] - b['d'] / 2 - pz, 0, pz - (b['z'] + b['d'] / 2))
    return math.hypot(dx, dz)


def surface_height(px, pz):
    h = 0.0
    for b in B:
        if (b['x'] - b['w'] / 2 <= px <= b['x'] + b['w'] / 2
                and b['z'] - b['d'] / 2 <= pz <= b['z'] + b['d'] / 2):
            top = b['y'] + b['h']
            if top > h:
                h = top
    return h


def build_walk_grid(cell=0.5, max_stand=2.1):
    """surface height field; None = unwalkable (inside tall structure)."""
    n = int(ARENA / cell)
    grid = [[None] * n for _ in range(n)]
    for iz in range(n):
        for ix in range(n):
            px = -75 + (ix + 0.5) * cell
            pz = -75 + (iz + 0.5) * cell
            if abs(px) > 72.0 or abs(pz) > 72.0:
                continue
            h = surface_height(px, pz)
            if h <= max_stand:
                grid[iz][ix] = h
    return grid, cell, n


def connectivity(points, step_up=0.55, drop_max=3.0):
    grid, cell, n = build_walk_grid()

    def to_cell(px, pz):
        return int((pz + 75) / cell), int((px + 75) / cell)

    from collections import deque
    start = to_cell(*points[0])
    if grid[start[0]][start[1]] is None:
        return ['START CELL BLOCKED ' + str(points[0])], grid, cell, n, None
    seen = [[False] * n for _ in range(n)]
    q = deque([start])
    seen[start[0]][start[1]] = True
    while q:
        iz, ix = q.popleft()
        h = grid[iz][ix]
        for dz, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            jz, jx = iz + dz, ix + dx
            if not (0 <= jz < n and 0 <= jx < n) or seen[jz][jx]:
                continue
            h2 = grid[jz][jx]
            if h2 is None:
                continue
            if h2 - h > step_up or h - h2 > drop_max:
                continue
            seen[jz][jx] = True
            q.append((jz, jx))
    bad = []
    for px, pz in points[1:]:
        iz, ix = to_cell(px, pz)
        if grid[iz][ix] is None or not seen[iz][ix]:
            bad.append((px, pz))
    return bad, grid, cell, n, seen


def validate():
    errs = []
    spawns = SPAWNS_T + SPAWNS_CT

    for b in B:
        if b['name'].startswith('perim'):
            continue
        if abs(b['x']) + b['w'] / 2 > HALF + 1e-9 or abs(b['z']) + b['d'] / 2 > HALF + 1e-9:
            errs.append(f"bounds {b['name']}")
        if b['w'] <= 0 or b['h'] <= 0 or b['d'] <= 0:
            errs.append(f"degenerate {b['name']}")

    # spawn clearance: T spawns live ON the plateau — standing surface must match y
    for sx, sy, sz in spawns:
        h = surface_height(sx, sz)
        if abs(h - sy) > 0.55:
            errs.append(f'spawn ({sx},{sz}) surface {h:.2f} != y {sy}')
        for b in B:
            top = b['y'] + b['h']
            if top <= sy + 0.55:
                continue
            d = dist_pt_box(sx, sz, b)
            if d < 1.2 and not (b['x'] - b['w'] / 2 <= sx <= b['x'] + b['w'] / 2
                                and b['z'] - b['d'] / 2 <= sz <= b['z'] + b['d'] / 2
                                and abs((b['y'] + b['h']) - sy) < 0.1):
                errs.append(f"spawn ({sx},{sz}) clipped by {b['name']}")

    for mx, mz in MEDKITS:
        h = surface_height(mx, mz)
        if h > 2.21:
            errs.append(f'medkit ({mx},{mz}) on structure h={h}')

    pts = [(s[0], s[2]) for s in spawns] + list(MEDKITS)
    bad, grid, cell, n, seen = connectivity(pts)
    for p in bad:
        errs.append(f'unreachable {p}')

    return errs, grid, cell, n, seen


# ------------------------------------------------------------------ preview

def render_preview(path, grid=None, seen=None, cell=0.5, n=None):
    from PIL import Image, ImageDraw
    S = 6  # px per unit
    img = Image.new('RGB', (ARENA * S, ARENA * S), SAND)
    dr = ImageDraw.Draw(img)

    def rect(b, fill, outline=None):
        x0 = int((b['x'] - b['w'] / 2 + 75) * S)
        z0 = int((b['z'] - b['d'] / 2 + 75) * S)
        x1 = int((b['x'] + b['w'] / 2 + 75) * S)
        z1 = int((b['z'] + b['d'] / 2 + 75) * S)
        dr.rectangle([x0, z0, x1, z1], fill=fill, outline=outline)

    order = sorted(B, key=lambda b: b['y'] + b['h'])
    for b in order:
        top = b['y'] + b['h']
        c = b['c']
        if top > 2.21:
            c = '#8a7848'  # roofs darker
        rect(b, c, outline='#6b5a36')

    # unreachable-but-walkable cells tint (dead space check) — drawn over boxes
    if grid is not None and seen is not None:
        for iz in range(n):
            for ix in range(n):
                if grid[iz][ix] is not None and not seen[iz][ix]:
                    px = int((ix + 0.5) * cell * S)
                    pz = int((iz + 0.5) * cell * S)
                    dr.rectangle([px - 1, pz - 1, px + 1, pz + 1], fill='#cc2222')

    for sx, _, sz in SPAWNS_T:
        dr.ellipse([(sx + 75) * S - 5, (sz + 75) * S - 5, (sx + 75) * S + 5, (sz + 75) * S + 5], fill='#d9a24b', outline='#000')
    for sx, _, sz in SPAWNS_CT:
        dr.ellipse([(sx + 75) * S - 5, (sz + 75) * S - 5, (sx + 75) * S + 5, (sz + 75) * S + 5], fill='#4b8bd9', outline='#000')
    for mx, mz in MEDKITS:
        dr.rectangle([(mx + 75) * S - 4, (mz + 75) * S - 4, (mx + 75) * S + 4, (mz + 75) * S + 4], fill='#d1342f')

    img.save(path)
    print('preview ->', path)


def emit(out_path):
    out = dict(
        boxes=[{k: v for k, v in b.items() if k != 'name' and not (k == 'y' and v == 0)}
               for b in B],
        spawns=[list(s) for s in SPAWNS_T + SPAWNS_CT],
        # carry surface height so elevated medkits render & pick up correctly
        medkits=[[mx, mz, round(surface_height(mx, mz), 2)] for mx, mz in MEDKITS],
    )
    with open(out_path, 'w') as f:
        json.dump(out, f, indent=1)
    print(f'emitted {len(out["boxes"])} boxes -> {out_path}')


if __name__ == '__main__':
    build_map()
    print(f'boxes={len(B)}')
    errs, grid, cell, n, seen = validate()
    here = os.path.dirname(os.path.abspath(__file__))
    render_preview(os.path.join(here, 'map-preview.png'), grid, seen, cell, n)
    if errs:
        print('ERRORS:')
        for e in errs:
            print('  -', e)
    else:
        print('ERRORS: none')
        emit(os.path.join(here, '..', 'public', 'map.json'))
