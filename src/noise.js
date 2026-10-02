// Small deterministic RNG + 2D Perlin noise.

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function makeNoise(seed) {
  const R = rng(seed);
  const perm = new Uint8Array(512);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const G = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const dot = (h, x, y) => { const g = G[h & 7]; return g[0] * x + g[1] * y; };

  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
    const u = fade(xf), v = fade(yf);
    const x1 = dot(aa, xf, yf) + u * (dot(ba, xf - 1, yf) - dot(aa, xf, yf));
    const x2 = dot(ab, xf, yf - 1) + u * (dot(bb, xf - 1, yf - 1) - dot(ab, xf, yf - 1));
    return x1 + v * (x2 - x1);
  }

  function fbm(x, y, oct = 5) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * noise(x * f, y * f);
      n += a; a *= 0.5; f *= 2;
    }
    return s / n;
  }

  return { noise, fbm };
}

export function hash3(x, y, z) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
