# Worldsmith: 3D models and new god powers (sub-project 1)

Date: 2026-10-03
Status: draft for review

## Goal

Make Worldsmith feel more like Theoria, a stylized god sim where you wreck a living
world. This sub-project covers two things:

1. Replace box-built buildings and people with real 3D models.
2. Add new god powers, starting with a tidal wave, then hurling buildings, earthquake,
   tornado and volcano.

Out of scope here, planned as later sub-projects: dragon form and aircraft (2),
roads, villages and kingdom politics (3), voxel look and persistent-destruction
polish (4). Trees and terrain stay as they are.

## Constraints

- Plain Three.js 0.160, static files, runs with `npx serve .`. No build step.
- Models are free CC0 assets committed to the repo under `assets/`.
- The game must never break because an asset failed to load.
- Frame rate must hold on a large village (existing `test/perf*.mjs` scripts).

## Verified asset sources

All from the public Kenney mirror (https://github.com/ETdoFresh/kenney.nl), CC0:

| Need | Pack | Format |
|---|---|---|
| Buildings | `fantasy-town-kit-1.0` | 153 modular `.glb` pieces (walls, roofs, doors, windows, windmill, watermill, stalls) |
| People | `animated-characters-1` | rigged `characterMedium.fbx` plus `idle`, `run`, `jump` animations and PNG skins |

Not found in the mirror: a dragon, aircraft, and a walk or attack animation for people.
Dragon and aircraft belong to sub-project 2 and will be sourced then (Quaternius is
the candidate, unverified). Until then nothing here needs them.

## Design

### 1. Asset layer (`src/assets.js`)

- Loads `.glb` (GLTFLoader) and `.fbx` (FBXLoader), caches by name, and hands out clones.
- Both loaders and `fflate` are vendored from the `three@0.160.0` npm package into
  `vendor/`. Their bare `import 'three'` is resolved by an `importmap` in `index.html`
  pointing at `vendor/three.module.js`.
- Every lookup has a code-built fallback (a simple box or cylinder) so a missing file
  degrades the look, not the game.
- Preloads before the first frame, behind the existing start screen.

### 2. Buildings that shatter

Today a house is a voxel structure: builders place its blocks one at a time, and
fire, damage and capacity all read the structure's block counts. To avoid rewriting
the economy, **the voxel structure stays as the simulation layer and the model is the
visual layer**:

- While under construction, blocks render as now (reads as scaffolding).
- When a house is completed, its blocks are hidden from the terrain mesh and a model
  assembled from town-kit pieces is shown in their place. Pieces are chosen per
  nation (stone or wood walls, roof style), matching the existing `housePlan` footprint.
- When a house is destroyed, or when fewer than 60% of its blocks are still alive
  (the threshold is a single constant, tunable in play), the model is replaced by
  its pieces as separate rigid bodies that fly apart, settle, and remain as rubble.
  Modular pieces make this natural: each wall or roof piece is one fragment.
- Fire keeps spreading through the hidden wood blocks, so burning behaviour is unchanged.

**Consequence the user accepted:** damage is no longer block-exact. A house is
intact, or it shatters. Persistent block-level destruction returns in sub-project 4.

### 3. People

- Replace the box-built bodies in `units.js` with the rigged character model.
- Skins are tinted per nation and role (soldier armor, king crown kept as an attached piece).
- Animations: `idle`, `run` (used for walking, scaled by speed) and `jump` (used when
  thrown or flying). The pack has no attack animation, so attacks are a procedural
  lunge on the model.
- Performance: rigged meshes cannot use today's `InstancedMesh` boxes directly. Only
  people near the camera get a full animated model; distant people use a cheap
  static pose, and the cutoff is tuned against the perf scripts.

### 4. Tidal wave

- New tool in `powers.js`: click and drag to set a direction; a wall of water travels
  across the terrain, knocking over people, flooding low ground and extinguishing fire.
- Water surfaces and spray live in `effects.js`, reusing the existing splash code.
- Buildings in its path take damage and shatter if they cross the threshold in section 2.

### 5. More god powers

Each of these is independent and can be cut without affecting the others. They are
ordered by how much they reuse existing code.

- **Hurl a building.** The Hand of God can grab a whole house model and throw it. On
  impact it shatters into its pieces (section 2) and damages whatever it lands on.
  Builds directly on the shatter system, so it comes first.
- **Earthquake.** Hold to shake the world: the camera trembles, terrain blocks crack
  and drop, and houses in the zone take damage and shatter. Uses existing `set()` voxel
  edits for the terrain.
- **Tornado.** A moving funnel you place and steer. It lifts people and loose fragments
  into the air and flings them out, reusing the throw physics from the Hand of God.
- **Volcano.** Click to raise a cone of terrain that erupts, firing lava bombs that use
  the meteor and fire effects and leave burning ground.

The existing powers (meteor, lightning, wildfire, raise and lower land) stay as they
are, apart from interacting with the new building models.

## Build order

1. Asset layer with fallbacks, plus importmap and vendored loaders.
2. People.
3. Buildings and shatter.
4. Tidal wave.
5. Hurl a building, then earthquake, tornado and volcano, each shippable on its own.

Each step ends with the game still running.

## Testing

- Extend `test/smoke.mjs` to assert no console errors with models on, and with every
  asset deliberately missing (fallback path).
- Run `test/perf.mjs` and `test/perf2.mjs` before and after steps 2 and 3, and record
  frame time on a large village.
- Add a test that builds a house, destroys it, and checks the fragments exist and
  the nation's house count drops.
- The existing tests hardcode a macOS Chrome path; make it configurable so they run here
  (Chromium is at `/opt/pw-browsers/chromium`).

## Risks

- **People performance** is the main risk (section 3); the near/far split is the mitigation.
- **Hiding voxel blocks under a model** needs a change in how `world.js` meshes
  structure-owned blocks. If that proves invasive, fall back to leaving the blocks
  visible under a smaller model.
- **FBX character** needs its textures and scale checked; the skins are separate PNGs.
- **Licenses:** each Kenney pack ships a CC0 `License.txt`; copy it next to the assets.
