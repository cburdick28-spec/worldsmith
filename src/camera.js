// Orbiting god camera: right-drag to rotate, middle-drag or WASD to pan, wheel to zoom.
import * as THREE from '../vendor/three.module.js';
import { W, D, SEA, topAt } from './world.js';

export class GodCam {
  constructor(cam) {
    this.cam = cam;
    this.target = new THREE.Vector3(W / 2, SEA + 4, D / 2);
    this.goal = { dist: 110, yaw: -0.7, pitch: 0.85 };
    this.dist = 110; this.yaw = -0.7; this.pitch = 0.85;
  }
  rotate(dx, dy) {
    this.goal.yaw -= dx * 0.006;
    this.goal.pitch = Math.min(1.45, Math.max(0.2, this.goal.pitch + dy * 0.005));
  }
  pan(dx, dy) {
    const k = this.dist * 0.0018;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    this.target.x += (-dx * c - dy * s) * k;
    this.target.z += (dx * s - dy * c) * k;
  }
  zoom(delta) {
    this.goal.dist = Math.min(220, Math.max(9, this.goal.dist * Math.pow(1.0015, delta)));
  }
  focus(x, z) { this.target.x = x; this.target.z = z; }
  update(dt, keys, shake) {
    const sp = this.dist * 0.9 * dt;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    let fx = 0, fz = 0;
    if (keys.KeyW || keys.ArrowUp) fz -= 1;
    if (keys.KeyS || keys.ArrowDown) fz += 1;
    if (keys.KeyA || keys.ArrowLeft) fx -= 1;
    if (keys.KeyD || keys.ArrowRight) fx += 1;
    // forward = (-sin, -cos), right = (cos, -sin)
    this.target.x += (fx * c + fz * s) * sp;
    this.target.z += (-fx * s + fz * c) * sp;
    if (keys.KeyQ) this.goal.yaw += dt * 1.6;
    if (keys.KeyE) this.goal.yaw -= dt * 1.6;
    this.target.x = Math.min(W, Math.max(0, this.target.x));
    this.target.z = Math.min(D, Math.max(0, this.target.z));
    const ground = Math.max(SEA + 1, topAt(this.target.x, this.target.z) + 1);
    this.target.y += (ground - this.target.y) * Math.min(1, dt * 3);

    const k = 1 - Math.exp(-dt * 10);
    this.dist += (this.goal.dist - this.dist) * k;
    this.yaw += (this.goal.yaw - this.yaw) * k;
    this.pitch += (this.goal.pitch - this.pitch) * k;

    const cp = Math.cos(this.pitch);
    this.cam.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    this.cam.lookAt(this.target);
    if (shake > 0.01) {
      this.cam.position.x += (Math.random() - 0.5) * shake;
      this.cam.position.y += (Math.random() - 0.5) * shake;
      this.cam.position.z += (Math.random() - 0.5) * shake;
    }
  }
}
