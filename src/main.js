import * as THREE from '../vendor/three.module.js';
import { W, D, SEA, WATER_Y, generate, initChunks, rebuildDirty } from './world.js';
import { initEffects, updateEffects, updateVisuals, fx, fireCount } from './effects.js';
import { initUnitMeshes, updateUnits, renderUnits } from './units.js';
import { setupNations, updateNations, nations } from './nations.js';
import { GodCam } from './camera.js';
import { TOOLS, initPowers, updatePowers, setTool, setSpeed, isPossessing, input } from './powers.js';
import { updateRoads } from './roads.js';
import { eraState } from './economy.js';
import { initUI, updateUI, setProsperityUI, toast } from './ui.js';
import { initMinimap, updateMinimap } from './minimap.js';
import { initAudio, updateAudio, setListener, setMuted, isMuted } from './audio.js';
import { makeSnapshot, restoreSnapshot, encodeSnapshot, decodeSnapshot, saveToStorage, hasSave, readSave, queueLoad, takePendingLoad } from './save.js';
import { game } from './nations.js';

function setProsperity(p) { game.prosperity = p; setProsperityUI(p); }

const params = new URLSearchParams(location.search);
// a queued load (from the save buttons) restores a snapshot instead of founding new nations
let snap = null;
const pendingLoad = takePendingLoad();
if (pendingLoad) {
  try { snap = await decodeSnapshot(pendingLoad); } catch (e) { console.warn('Could not read the save:', e); }
}
const seed = snap ? snap.seed : (+params.get('seed') || Math.floor(Math.random() * 1e9));
if (snap) history.replaceState(null, '', `?seed=${seed}`);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc4dcec, 170, 400);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 1000);

const hemi = new THREE.HemisphereLight(0xd8ecff, 0x6b5a45, 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.3);
sun.position.set(W / 2 - 70, 120, D / 2 - 55);
sun.target.position.set(W / 2, 0, D / 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 10, far: 320 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

const water = new THREE.Mesh(
  new THREE.PlaneGeometry(W * 4, D * 4),
  new THREE.MeshPhongMaterial({ color: 0x2f74c4, transparent: true, opacity: 0.78, shininess: 90, specular: 0x8fb8ff, depthWrite: false }),
);
water.rotation.x = -Math.PI / 2;
water.position.set(W / 2, WATER_Y, D / 2);
water.receiveShadow = true;
scene.add(water);

generate(seed);
initChunks(scene);
initEffects(scene);
initUnitMeshes(scene);

const godCam = new GodCam(camera);
initPowers({ camera, godCam, canvas: renderer.domElement, scene });
initUI(TOOLS, setTool, setSpeed, setProsperity, () => { location.search = `?seed=${Math.floor(Math.random() * 1e9)}`; });
if (snap) restoreSnapshot(snap); else setupNations();
godCam.focus(nations.reduce((a, n) => a + n.capital.x, 0) / nations.length, nations.reduce((a, n) => a + n.capital.z, 0) / nations.length);
godCam.goal.dist = godCam.dist = 85;
if (snap && snap.cam) {
  godCam.focus(snap.cam.x, snap.cam.z);
  godCam.goal.dist = godCam.dist = snap.cam.dist;
  godCam.goal.yaw = godCam.yaw = snap.cam.yaw;
  godCam.goal.pitch = godCam.pitch = snap.cam.pitch;
}
if (params.get('pause')) setSpeed(0);
if (snap) document.getElementById('intro').classList.add('gone');
rebuildDirty(1000);
document.getElementById('seed').textContent = `seed ${seed}`;

initMinimap(godCam);
setListener(() => (isPossessing() ? camera.position : godCam.target));
const camState = () => ({ x: godCam.target.x, z: godCam.target.z, dist: godCam.goal.dist, yaw: godCam.goal.yaw, pitch: godCam.goal.pitch });
const $ = id => document.getElementById(id);
$('begin').addEventListener('click', initAudio);
addEventListener('pointerdown', initAudio, { once: true });
$('b-mute').textContent = isMuted() ? '🔇' : '🔊';
$('b-mute').onclick = () => { setMuted(!isMuted()); $('b-mute').textContent = isMuted() ? '🔇' : '🔊'; initAudio(); };
$('b-save').onclick = async () => {
  try { await saveToStorage(camState()); toast('World saved'); } catch (e) { console.warn(e); toast('Could not save here: try the ⬇ export instead.'); }
};
$('b-load').onclick = () => { if (hasSave()) queueLoad(readSave()); else toast('No saved world yet. Press 💾 first.'); };
$('b-export').onclick = async () => {
  const enc = await encodeSnapshot(makeSnapshot(camState()));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([enc], { type: 'text/plain' }));
  a.download = `worldsmith-${seed}-year${game.year}.wsave`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('World exported');
};
$('b-import').onclick = () => $('file-import').click();
$('file-import').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  const txt = (await f.text()).trim();
  try { await decodeSnapshot(txt); queueLoad(txt); } catch { toast('That file is not a Worldsmith save.'); }
  e.target.value = '';
};
$('b-share').onclick = async () => {
  const url = `${location.origin}${location.pathname}?seed=${seed}`;
  try { await navigator.clipboard.writeText(url); toast('Link to this world copied'); } catch { toast(url); }
};

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
let uiT = 0, time = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  const simDt = dt * input.speed;
  time += dt;
  if (simDt > 0) {
    // small fixed substeps keep movement and collisions stable at high speed
    const steps = Math.ceil(simDt / 0.05), h = simDt / steps;
    for (let i = 0; i < steps; i++) {
      updateNations(h);
      updateUnits(h);
      updateRoads(h);
      updateEffects(h);
    }
  }
  updatePowers(dt, simDt, time);
  updateMinimap(dt);
  updateAudio(fireCount(), godCam.dist);
  if (!isPossessing()) godCam.update(dt, input.keys, fx.shake);
  else if (fx.shake > 0.01) camera.position.y += (Math.random() - 0.5) * fx.shake * 0.4;
  rebuildDirty(14);
  renderUnits(time);
  updateVisuals(dt, simDt);
  sun.color.copy(eraState.sun); sun.intensity = eraState.si;
  hemi.color.copy(eraState.hemi); hemi.intensity = eraState.hi;
  water.material.opacity = 0.76 + Math.sin(time * 0.8) * 0.03;
  uiT -= dt;
  if (uiT <= 0) { uiT = 0.4; updateUI(); }
  renderer.render(scene, camera);
}
frame();
