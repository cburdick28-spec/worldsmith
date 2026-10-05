import * as THREE from '../vendor/three.module.js';
import { W, D, SEA, WATER_Y, generate, initChunks, rebuildDirty } from './world.js';
import { initEffects, updateEffects, updateVisuals, fx } from './effects.js';
import { initUnitMeshes, updateUnits, renderUnits } from './units.js';
import { setupNations, updateNations, nations } from './nations.js';
import { GodCam } from './camera.js';
import { TOOLS, initPowers, updatePowers, setTool, setSpeed, isPossessing, input } from './powers.js';
import { updateRoads } from './roads.js';
import { initUI, updateUI, setProsperityUI } from './ui.js';
import { game } from './nations.js';

function setProsperity(p) { game.prosperity = p; setProsperityUI(p); }

const params = new URLSearchParams(location.search);
const seed = +params.get('seed') || Math.floor(Math.random() * 1e9);

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

scene.add(new THREE.HemisphereLight(0xd8ecff, 0x6b5a45, 1.15));
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
setupNations();
godCam.focus(nations.reduce((a, n) => a + n.capital.x, 0) / nations.length, nations.reduce((a, n) => a + n.capital.z, 0) / nations.length);
godCam.goal.dist = godCam.dist = 85;
rebuildDirty(1000);
document.getElementById('seed').textContent = `seed ${seed}`;

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
  if (!isPossessing()) godCam.update(dt, input.keys, fx.shake);
  else if (fx.shake > 0.01) camera.position.y += (Math.random() - 0.5) * fx.shake * 0.4;
  rebuildDirty(14);
  renderUnits(time);
  updateVisuals(dt, simDt);
  water.material.opacity = 0.76 + Math.sin(time * 0.8) * 0.03;
  uiT -= dt;
  if (uiT <= 0) { uiT = 0.4; updateUI(); }
  renderer.render(scene, camera);
}
frame();
