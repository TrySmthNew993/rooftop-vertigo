import * as THREE from 'three';

function createCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

// Deterministic fast hash for repeatable high-frequency noise
function hash2D(x, y, seed = 1337) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, y, period, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const aa = hash2D(x0, y0, seed);
  const ba = hash2D(x1, y0, seed);
  const ab = hash2D(x0, y1, seed);
  const bb = hash2D(x1, y1, seed);
  const xLerp1 = aa + (ba - aa) * u;
  const xLerp2 = ab + (bb - ab) * u;
  return xLerp1 + (xLerp2 - xLerp1) * v;
}

function fbmTileable(u, v, baseFreq, octaves, seed) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = baseFreq;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(u * freq, v * freq, freq, seed + i * 31) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function heightToNormalTexture(heightData, size, strength = 2.0, repeat = 1) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;

  const sample = (x, y) => {
    const wx = ((x % size) + size) % size;
    const wy = ((y % size) + size) % size;
    return heightData[wy * size + wx];
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      let nx = -dx * strength;
      let ny = -dy * strength;
      let nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;

      const idx = (y * size + x) * 4;
      d[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      d[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      d[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  return tex;
}

function finalizeTexture(canvas, { repeatX = 1, repeatY = 1, srgb = false, anisotropy = 8 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

export class MaterialLibrary {
  constructor(maxAnisotropy = 8) {
    this.aniso = Math.min(8, maxAnisotropy);
    this.mats = {};
    this.textures = {};
    this._buildAll();
  }

  _buildAll() {
    this._buildWetAsphalt();
    this._buildConcrete();
    this._buildSteel();
    this._buildRustedIron();
    this._buildTarGravelRoof();
    this._buildHazardStripes();
    this._buildBuildingFacade();
    this._buildSkyscraperGlass();
    this._buildSafetyNet();
    this._buildLadderMaterials();
    this._buildSignageAndGlows();
    this._buildLootMaterials();
  }

  _buildWetAsphalt() {
    const size = 256;
    const albedoC = createCanvas(size, size);
    const roughC = createCanvas(size, size);
    const aCtx = albedoC.getContext('2d');
    const rCtx = roughC.getContext('2d');
    const aImg = aCtx.createImageData(size, size);
    const rImg = rCtx.createImageData(size, size);
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const puddleMacro = fbmTileable(u, v, 3, 4, 101);
        const grain = fbmTileable(u, v, 24, 3, 211);
        const micro = hash2D(x, y, 777) * 0.14;

        // Smooth wet puddle mask where puddleMacro > 0.56
        const puddle = THREE.MathUtils.smoothstep(puddleMacro, 0.53, 0.63);
        const dampEdge = THREE.MathUtils.smoothstep(puddleMacro, 0.44, 0.56);

        // Asphalt color darkens strongly when wet
        const baseLum = 28 + grain * 26 + micro * 24;
        const wetDarken = 1 - dampEdge * 0.42 - puddle * 0.25;
        const lum = Math.max(8, Math.min(255, baseLum * wetDarken));

        // Roughness: puddles near mirror-smooth (0.04), damp asphalt ~0.35, drier grain ~0.82
        const rough = (0.82 - dampEdge * 0.44) * (1 - puddle) + 0.045 * puddle + micro * 0.15 * (1 - puddle);

        // Height flattens completely inside puddles so normal reflections stay crisp
        height[y * size + x] = (grain * 0.7 + micro * 0.5) * (1 - puddle * 0.96);

        const i = (y * size + x) * 4;
        aImg.data[i] = lum * 0.96;
        aImg.data[i + 1] = lum * 0.99;
        aImg.data[i + 2] = lum * 1.08;
        aImg.data[i + 3] = 255;

        const rv = Math.max(8, Math.min(255, Math.round(rough * 255)));
        rImg.data[i] = rv;
        rImg.data[i + 1] = rv;
        rImg.data[i + 2] = rv;
        rImg.data[i + 3] = 255;
      }
    }
    aCtx.putImageData(aImg, 0, 0);
    rCtx.putImageData(rImg, 0, 0);

    const map = finalizeTexture(albedoC, { repeatX: 16, repeatY: 16, srgb: true, anisotropy: this.aniso });
    const roughnessMap = finalizeTexture(roughC, { repeatX: 16, repeatY: 16, anisotropy: this.aniso });
    const normalMap = heightToNormalTexture(height, size, 2.8, 16);
    normalMap.anisotropy = this.aniso;

    this.mats.wetAsphalt = new THREE.MeshPhysicalMaterial({
      map,
      roughnessMap,
      normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 1.0,
      metalness: 0.14,
      clearcoat: 0.36,
      clearcoatRoughness: 0.22,
      envMapIntensity: 1.4
    });

    // Dedicated reflective puddle decal overlay for hero alley puddles
    this.mats.puddle = new THREE.MeshPhysicalMaterial({
      color: 0x0a0f18,
      roughness: 0.08,
      metalness: 0.2,
      clearcoat: 0.85,
      clearcoatRoughness: 0.09,
      transparent: true,
      opacity: 0.72,
      envMapIntensity: 2.0,
      depthWrite: false
    });
  }

  _buildConcrete() {
    const size = 256;
    const albedoC = createCanvas(size, size);
    const roughC = createCanvas(size, size);
    const aCtx = albedoC.getContext('2d');
    const rCtx = roughC.getContext('2d');
    const aImg = aCtx.createImageData(size, size);
    const rImg = rCtx.createImageData(size, size);
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const macro = fbmTileable(u, v, 4, 4, 303);
        const streaks = fbmTileable(u * 3.0, v * 0.5, 4, 3, 407);
        const fine = hash2D(x, y, 509) * 0.15;

        // Horizontal concrete panel seams every 64px
        const seamY = (y % 64 < 2) ? 0.35 : 0;
        const seamX = (x % 128 < 2) ? 0.25 : 0;
        const seam = Math.max(seamY, seamX);

        // Form tie bolt holes
        const bx = ((x + 32) % 64) - 32;
        const by = ((y + 32) % 64) - 32;
        const bolt = (bx * bx + by * by < 9) ? 0.4 : 0;

        const base = 76 + macro * 42 - streaks * 22 + fine * 20 - seam * 38 - bolt * 35;
        const lum = Math.max(18, Math.min(220, base));
        const rough = 0.78 + macro * 0.18 - streaks * 0.22;

        height[y * size + x] = macro * 0.65 + fine * 0.4 - seam * 0.7 - bolt * 0.8;

        const i = (y * size + x) * 4;
        aImg.data[i] = lum * 0.96;
        aImg.data[i + 1] = lum * 0.98;
        aImg.data[i + 2] = lum * 1.03;
        aImg.data[i + 3] = 255;

        const rv = Math.max(60, Math.min(250, Math.round(rough * 255)));
        rImg.data[i] = rv;
        rImg.data[i + 1] = rv;
        rImg.data[i + 2] = rv;
        rImg.data[i + 3] = 255;
      }
    }
    aCtx.putImageData(aImg, 0, 0);
    rCtx.putImageData(rImg, 0, 0);

    const map = finalizeTexture(albedoC, { repeatX: 3, repeatY: 3, srgb: true, anisotropy: this.aniso });
    const roughnessMap = finalizeTexture(roughC, { repeatX: 3, repeatY: 3, anisotropy: this.aniso });
    const normalMap = heightToNormalTexture(height, size, 2.2, 3);

    this.mats.concrete = new THREE.MeshStandardMaterial({
      map,
      roughnessMap,
      normalMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughness: 0.92,
      metalness: 0.05,
      envMapIntensity: 0.9
    });

    // Damp basement shelter concrete (cooler tint, slightly wetter streaks)
    const shelterMap = map.clone();
    shelterMap.needsUpdate = true;
    shelterMap.repeat.set(4, 2);
    this.mats.shelterConcrete = new THREE.MeshStandardMaterial({
      color: 0x8ea0ae,
      map: shelterMap,
      roughnessMap,
      normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.72,
      metalness: 0.1,
      envMapIntensity: 1.15
    });
  }

  _buildSteel() {
    const size = 256;
    const albedoC = createCanvas(size, size);
    const roughC = createCanvas(size, size);
    const aCtx = albedoC.getContext('2d');
    const rCtx = roughC.getContext('2d');
    const aImg = aCtx.createImageData(size, size);
    const rImg = rCtx.createImageData(size, size);
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const brush = fbmTileable(u * 0.5, v * 6.0, 4, 3, 613);
        const grime = fbmTileable(u, v, 5, 4, 619);
        const seam = (x % 128 < 2 || y % 128 < 2) ? 0.35 : 0;

        // Corner rivets along panel seams
        const rx = x % 32;
        const ry = y % 32;
        const isEdge = (x % 128 < 12 || x % 128 > 116) || (y % 128 < 12 || y % 128 > 116);
        const distRivet = Math.hypot(rx - 6, ry - 6);
        const rivet = (isEdge && distRivet < 3.2) ? (1 - distRivet / 3.2) * 0.65 : 0;

        const base = 92 + brush * 34 - grime * 28 - seam * 45 + rivet * 28;
        const lum = Math.max(24, Math.min(210, base));
        const rough = 0.28 + grime * 0.38 - brush * 0.08;

        height[y * size + x] = brush * 0.25 - seam * 0.8 + rivet * 0.9;

        const i = (y * size + x) * 4;
        aImg.data[i] = lum * 0.92;
        aImg.data[i + 1] = lum * 0.98;
        aImg.data[i + 2] = lum * 1.07;
        aImg.data[i + 3] = 255;

        const rv = Math.max(40, Math.min(220, Math.round(rough * 255)));
        rImg.data[i] = rv;
        rImg.data[i + 1] = rv;
        rImg.data[i + 2] = rv;
        rImg.data[i + 3] = 255;
      }
    }
    aCtx.putImageData(aImg, 0, 0);
    rCtx.putImageData(rImg, 0, 0);

    const map = finalizeTexture(albedoC, { repeatX: 2, repeatY: 2, srgb: true, anisotropy: this.aniso });
    const roughnessMap = finalizeTexture(roughC, { repeatX: 2, repeatY: 2, anisotropy: this.aniso });
    const normalMap = heightToNormalTexture(height, size, 2.4, 2);

    this.mats.galvanizedSteel = new THREE.MeshStandardMaterial({
      map,
      roughnessMap,
      normalMap,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.72,
      metalness: 0.84,
      envMapIntensity: 1.45
    });

    // Dark structural I-beam / skyscraper girder steel
    this.mats.structuralSteel = new THREE.MeshStandardMaterial({
      color: 0x4b5766,
      map,
      roughnessMap,
      normalMap,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughness: 0.65,
      metalness: 0.86,
      envMapIntensity: 1.5
    });

    // Tower red-and-white aviation painted truss steel
    this.mats.towerRedSteel = new THREE.MeshStandardMaterial({
      color: 0xb52b26,
      map,
      roughnessMap,
      normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.58,
      metalness: 0.68,
      envMapIntensity: 1.35
    });

    this.mats.towerWhiteSteel = new THREE.MeshStandardMaterial({
      color: 0xd4dde6,
      map,
      roughnessMap,
      normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.55,
      metalness: 0.62,
      envMapIntensity: 1.35
    });

    // Crane yellow industrial painted steel
    this.mats.craneYellow = new THREE.MeshStandardMaterial({
      color: 0xd6961e,
      map,
      roughnessMap,
      normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.54,
      metalness: 0.65,
      envMapIntensity: 1.3
    });
  }

  _buildRustedIron() {
    const size = 256;
    const albedoC = createCanvas(size, size);
    const roughC = createCanvas(size, size);
    const aCtx = albedoC.getContext('2d');
    const rCtx = roughC.getContext('2d');
    const aImg = aCtx.createImageData(size, size);
    const rImg = rCtx.createImageData(size, size);
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const rustMask = fbmTileable(u, v, 5, 4, 821);
        const fine = hash2D(x, y, 827) * 0.2;
        const rust = THREE.MathUtils.smoothstep(rustMask, 0.42, 0.68);

        const r = 52 * (1 - rust) + (112 + fine * 45) * rust;
        const g = 58 * (1 - rust) + (56 + fine * 22) * rust;
        const b = 64 * (1 - rust) + (34 + fine * 14) * rust;

        const rough = 0.42 * (1 - rust) + 0.88 * rust;
        height[y * size + x] = rust * 0.6 + fine * 0.35;

        const i = (y * size + x) * 4;
        aImg.data[i] = Math.min(255, r);
        aImg.data[i + 1] = Math.min(255, g);
        aImg.data[i + 2] = Math.min(255, b);
        aImg.data[i + 3] = 255;

        const rv = Math.round(rough * 255);
        rImg.data[i] = rv;
        rImg.data[i + 1] = rv;
        rImg.data[i + 2] = rv;
        rImg.data[i + 3] = 255;
      }
    }
    aCtx.putImageData(aImg, 0, 0);
    rCtx.putImageData(rImg, 0, 0);

    const map = finalizeTexture(albedoC, { repeatX: 2, repeatY: 2, srgb: true, anisotropy: this.aniso });
    const roughnessMap = finalizeTexture(roughC, { repeatX: 2, repeatY: 2, anisotropy: this.aniso });
    const normalMap = heightToNormalTexture(height, size, 2.6, 2);

    this.mats.rustedIron = new THREE.MeshStandardMaterial({
      map,
      roughnessMap,
      normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.85,
      metalness: 0.68,
      envMapIntensity: 1.2
    });
  }

  _buildTarGravelRoof() {
    const size = 256;
    const albedoC = createCanvas(size, size);
    const roughC = createCanvas(size, size);
    const aCtx = albedoC.getContext('2d');
    const rCtx = roughC.getContext('2d');
    const aImg = aCtx.createImageData(size, size);
    const rImg = rCtx.createImageData(size, size);
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const tarPatch = fbmTileable(u, v, 3, 4, 911);
        const gravel = hash2D(x, y, 919);
        const wet = THREE.MathUtils.smoothstep(tarPatch, 0.58, 0.72);
        const lum = (30 + gravel * 38) * (1 - wet * 0.45);
        const rough = (0.9 - wet * 0.76);
        height[y * size + x] = gravel * (1 - wet * 0.85);

        const i = (y * size + x) * 4;
        aImg.data[i] = lum * 0.96;
        aImg.data[i + 1] = lum * 0.98;
        aImg.data[i + 2] = lum * 1.04;
        aImg.data[i + 3] = 255;

        const rv = Math.max(18, Math.round(rough * 255));
        rImg.data[i] = rv;
        rImg.data[i + 1] = rv;
        rImg.data[i + 2] = rv;
        rImg.data[i + 3] = 255;
      }
    }
    aCtx.putImageData(aImg, 0, 0);
    rCtx.putImageData(rImg, 0, 0);

    const map = finalizeTexture(albedoC, { repeatX: 5, repeatY: 5, srgb: true, anisotropy: this.aniso });
    const roughnessMap = finalizeTexture(roughC, { repeatX: 5, repeatY: 5, anisotropy: this.aniso });
    const normalMap = heightToNormalTexture(height, size, 3.0, 5);

    this.mats.tarRoof = new THREE.MeshStandardMaterial({
      map,
      roughnessMap,
      normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 1.0,
      metalness: 0.08,
      envMapIntensity: 1.25
    });
  }

  _buildHazardStripes() {
    const size = 256;
    const c = createCanvas(size, size);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#c89216';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#181b20';
    for (let i = -size; i < size * 2; i += 48) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 24, 0);
      ctx.lineTo(i + 24 - size, size);
      ctx.lineTo(i - size, size);
      ctx.closePath();
      ctx.fill();
    }
    // Subtle weathering speckles
    ctx.fillStyle = 'rgba(10,12,16,0.22)';
    for (let n = 0; n < 380; n++) {
      ctx.fillRect(hash2D(n, 1, 7) * size, hash2D(n, 2, 7) * size, 3, 3);
    }
    const map = finalizeTexture(c, { repeatX: 2, repeatY: 1, srgb: true, anisotropy: this.aniso });
    this.mats.hazard = new THREE.MeshStandardMaterial({
      map,
      roughness: 0.58,
      metalness: 0.35,
      envMapIntensity: 1.1
    });
  }

  _buildBuildingFacade() {
    const size = 512;
    const albedoC = createCanvas(size, size);
    const emisC = createCanvas(size, size);
    const roughC = createCanvas(size, size);
    const aCtx = albedoC.getContext('2d');
    const eCtx = emisC.getContext('2d');
    const rCtx = roughC.getContext('2d');

    // Concrete facade base
    aCtx.fillStyle = '#252b35';
    aCtx.fillRect(0, 0, size, size);
    eCtx.fillStyle = '#000000';
    eCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#d8d8d8';
    rCtx.fillRect(0, 0, size, size);

    // Subtle floor bands
    const cols = 8;
    const rows = 8;
    const cw = size / cols;
    const ch = size / rows;
    for (let r = 0; r < rows; r++) {
      aCtx.fillStyle = '#1b2029';
      aCtx.fillRect(0, r * ch, size, 6);
      for (let c = 0; c < cols; c++) {
        const wx = c * cw + 10;
        const wy = r * ch + 12;
        const ww = cw - 20;
        const wh = ch - 24;

        // Window glass roughness (glossy)
        rCtx.fillStyle = '#1e1e1e';
        rCtx.fillRect(wx, wy, ww, wh);

        const rnd = hash2D(c, r, 419);
        if (rnd > 0.72) {
          // Warm interior apartment/office glow
          const warm = rnd > 0.86 ? '#ffd48a' : (rnd > 0.79 ? '#9ccfff' : '#ffab52');
          aCtx.fillStyle = warm;
          aCtx.fillRect(wx, wy, ww, wh);
          eCtx.fillStyle = warm;
          eCtx.fillRect(wx, wy, ww, wh);
          // Blinds silhouette
          aCtx.fillStyle = 'rgba(15,18,26,0.38)';
          aCtx.fillRect(wx, wy, ww, wh * 0.3);
          eCtx.fillStyle = 'rgba(0,0,0,0.45)';
          eCtx.fillRect(wx, wy, ww, wh * 0.3);
        } else {
          // Dark reflective window glass
          aCtx.fillStyle = '#0e1520';
          aCtx.fillRect(wx, wy, ww, wh);
        }
        // Mullion frame
        aCtx.strokeStyle = '#38414e';
        aCtx.lineWidth = 3;
        aCtx.strokeRect(wx, wy, ww, wh);
      }
    }

    const map = finalizeTexture(albedoC, { repeatX: 2, repeatY: 2, srgb: true, anisotropy: this.aniso });
    const emissiveMap = finalizeTexture(emisC, { repeatX: 2, repeatY: 2, srgb: true, anisotropy: this.aniso });
    const roughnessMap = finalizeTexture(roughC, { repeatX: 2, repeatY: 2, anisotropy: this.aniso });

    this.mats.buildingFacade = new THREE.MeshStandardMaterial({
      map,
      emissive: new THREE.Color(0xffffff),
      emissiveMap,
      emissiveIntensity: 0.78,
      roughnessMap,
      roughness: 1.0,
      metalness: 0.25,
      envMapIntensity: 1.3
    });

    // Distant skyline high-rise material (higher emissive contrast for horizon glow)
    const skyMap = map.clone();
    skyMap.needsUpdate = true;
    skyMap.repeat.set(1, 3);
    const skyEmis = emissiveMap.clone();
    skyEmis.needsUpdate = true;
    skyEmis.repeat.set(1, 3);
    this.mats.skylineTower = new THREE.MeshStandardMaterial({
      color: 0x1a2130,
      map: skyMap,
      emissive: new THREE.Color(0xffdfa8),
      emissiveMap: skyEmis,
      emissiveIntensity: 1.1,
      roughness: 0.55,
      metalness: 0.45,
      envMapIntensity: 0.8
    });
  }

  _buildSkyscraperGlass() {
    const size = 256;
    const c = createCanvas(size, size);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0f1c2b';
    ctx.fillRect(0, 0, size, size);
    // Steel mullion grid
    ctx.strokeStyle = '#2c3948';
    ctx.lineWidth = 8;
    ctx.strokeRect(0, 0, size, size);
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.stroke();

    const map = finalizeTexture(c, { repeatX: 3, repeatY: 3, srgb: true, anisotropy: this.aniso });
    this.mats.curtainGlass = new THREE.MeshPhysicalMaterial({
      map,
      color: 0x1b3348,
      roughness: 0.09,
      metalness: 0.65,
      transmission: 0.0,
      transparent: true,
      opacity: 0.78,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      envMapIntensity: 2.2,
      side: THREE.DoubleSide
    });
  }

  _buildSafetyNet() {
    const size = 128;
    const c = createCanvas(size, size);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = '#22c985';
    ctx.lineWidth = 5;
    // Crisp diamond nylon catch-net mesh
    const step = 32;
    for (let i = -size; i <= size * 2; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + size, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i - size, size);
      ctx.stroke();
    }
    const map = finalizeTexture(c, { repeatX: 8, repeatY: 4, srgb: true, anisotropy: this.aniso });
    this.mats.safetyNet = new THREE.MeshStandardMaterial({
      map,
      color: 0x35e09b,
      emissive: 0x0b4a30,
      emissiveIntensity: 0.55,
      transparent: true,
      alphaTest: 0.15,
      roughness: 0.75,
      metalness: 0.1,
      side: THREE.DoubleSide
    });
  }

  _buildLadderMaterials() {
    this.mats.ladderRail = new THREE.MeshStandardMaterial({
      color: 0x8ea0b2,
      roughness: 0.38,
      metalness: 0.88,
      envMapIntensity: 1.5
    });

    // Subtle high-visibility worn yellow rungs so climbers can read ladders cleanly in night lighting
    this.mats.ladderRung = new THREE.MeshStandardMaterial({
      color: 0xdcb342,
      emissive: 0x261d06,
      emissiveIntensity: 0.5,
      roughness: 0.42,
      metalness: 0.72,
      envMapIntensity: 1.35
    });

    this.mats.ladderCage = new THREE.MeshStandardMaterial({
      color: 0x566474,
      roughness: 0.5,
      metalness: 0.82,
      envMapIntensity: 1.2
    });

    this.mats.ziplineCable = new THREE.MeshStandardMaterial({
      color: 0xb8cadb,
      emissive: 0x1e4a5e,
      emissiveIntensity: 0.65,
      roughness: 0.25,
      metalness: 0.92
    });
  }

  _buildSignageAndGlows() {
    // Scrap Buyer neon sign canvas
    const sc = createCanvas(512, 128);
    const sctx = sc.getContext('2d');
    sctx.fillStyle = '#0d121a';
    sctx.fillRect(0, 0, 512, 128);
    sctx.strokeStyle = '#ff9d28';
    sctx.lineWidth = 6;
    sctx.strokeRect(8, 8, 496, 112);
    sctx.fillStyle = '#ffb84d';
    sctx.font = 'bold 46px monospace';
    sctx.textAlign = 'center';
    sctx.textBaseline = 'middle';
    sctx.fillText('SCRAP BUYER', 256, 48);
    sctx.fillStyle = '#42ebff';
    sctx.font = 'bold 22px monospace';
    sctx.fillText('NIGHT SALVAGE // GEAR UPGRADES', 256, 92);

    const signTex = finalizeTexture(sc, { srgb: true, anisotropy: this.aniso });
    this.mats.traderSign = new THREE.MeshStandardMaterial({
      map: signTex,
      emissiveMap: signTex,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 1.45,
      roughness: 0.3,
      metalness: 0.2
    });

    // Shelter warning sign
    const fc = createCanvas(512, 128);
    const fctx = fc.getContext('2d');
    fctx.fillStyle = '#14191f';
    fctx.fillRect(0, 0, 512, 128);
    fctx.strokeStyle = '#38e4ff';
    fctx.lineWidth = 6;
    fctx.strokeRect(8, 8, 496, 112);
    fctx.fillStyle = '#c8f8ff';
    fctx.font = 'bold 38px monospace';
    fctx.textAlign = 'center';
    fctx.textBaseline = 'middle';
    fctx.fillText('FALLOUT SHELTER B-04', 256, 48);
    fctx.fillStyle = '#ffaa33';
    fctx.font = 'bold 20px monospace';
    fctx.fillText('AUTHORIZED PERSONNEL ONLY', 256, 92);
    const shelterSignTex = finalizeTexture(fc, { srgb: true, anisotropy: this.aniso });
    this.mats.shelterSign = new THREE.MeshStandardMaterial({
      map: shelterSignTex,
      emissiveMap: shelterSignTex,
      emissive: new THREE.Color(0xbceeff),
      emissiveIntensity: 1.15,
      roughness: 0.35,
      metalness: 0.2
    });

    // Emissive bloom bulb materials (high emissiveIntensity triggers selective UnrealBloom)
    this.mats.sodiumBulb = new THREE.MeshStandardMaterial({
      color: 0xffc366,
      emissive: new THREE.Color(0xff9a2e),
      emissiveIntensity: 3.4,
      roughness: 0.1
    });

    this.mats.fluorescentBulb = new THREE.MeshStandardMaterial({
      color: 0xdffbff,
      emissive: new THREE.Color(0x9beeff),
      emissiveIntensity: 3.0,
      roughness: 0.1
    });

    this.mats.strobeRed = new THREE.MeshStandardMaterial({
      color: 0xff3b47,
      emissive: new THREE.Color(0xff1e2d),
      emissiveIntensity: 4.5,
      roughness: 0.1
    });

    this.mats.greenBeacon = new THREE.MeshStandardMaterial({
      color: 0x38ff9c,
      emissive: new THREE.Color(0x22f088),
      emissiveIntensity: 2.6,
      roughness: 0.15
    });

    this.mats.amberBeacon = new THREE.MeshStandardMaterial({
      color: 0xffbe42,
      emissive: new THREE.Color(0xff9c1c),
      emissiveIntensity: 2.5,
      roughness: 0.15
    });

    // Smooth Fresnel-faded volumetric mist cone for sodium streetlamps (no sharp edges!)
    this.mats.sodiumCone = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xffb055) },
        uOpacity: { value: 0.22 }
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        void main() {
          vUv = uv;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormalView = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        void main() {
          float fresnel = pow(abs(dot(normalize(vNormalView), normalize(vViewDir))), 2.2);
          float vertical = smoothstep(0.0, 0.72, vUv.y) * smoothstep(1.0, 0.88, vUv.y);
          float alpha = fresnel * vertical * uOpacity;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide
    });

    // Soft radial glow texture for strobe halos
    const glowC = createCanvas(128, 128);
    const gCtx = glowC.getContext('2d');
    const rad = gCtx.createRadialGradient(64, 64, 2, 64, 64, 62);
    rad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    rad.addColorStop(0.25, 'rgba(255, 255, 255, 0.55)');
    rad.addColorStop(0.6, 'rgba(255, 255, 255, 0.12)');
    rad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    gCtx.fillStyle = rad;
    gCtx.fillRect(0, 0, 128, 128);
    this.textures.glowSprite = new THREE.CanvasTexture(glowC);
  }

  _buildLootMaterials() {
    this.mats.copperCoil = new THREE.MeshStandardMaterial({
      color: 0xd4763c,
      roughness: 0.28,
      metalness: 0.92,
      emissive: 0x3b1806,
      emissiveIntensity: 0.45,
      envMapIntensity: 1.7
    });

    this.mats.titaniumCase = new THREE.MeshStandardMaterial({
      color: 0xaab9c8,
      roughness: 0.24,
      metalness: 0.9,
      emissive: 0x102536,
      emissiveIntensity: 0.45,
      envMapIntensity: 1.8
    });

    this.mats.relayUnit = new THREE.MeshStandardMaterial({
      color: 0x2a3b4c,
      roughness: 0.35,
      metalness: 0.8,
      emissive: 0x164f68,
      emissiveIntensity: 0.75,
      envMapIntensity: 1.6
    });

    this.mats.apexCore = new THREE.MeshStandardMaterial({
      color: 0xffd060,
      roughness: 0.18,
      metalness: 0.92,
      emissive: new THREE.Color(0xff9520),
      emissiveIntensity: 1.8,
      envMapIntensity: 2.0
    });

    this.mats.milCapacitor = new THREE.MeshStandardMaterial({
      color: 0x3a523c,
      roughness: 0.30,
      metalness: 0.85,
      emissive: 0x0e2a16,
      emissiveIntensity: 0.65,
      envMapIntensity: 1.65
    });

    this.mats.techKit = new THREE.MeshStandardMaterial({
      color: 0xc8461c,
      roughness: 0.32,
      metalness: 0.62,
      emissive: 0x3b1206,
      emissiveIntensity: 0.55,
      envMapIntensity: 1.5
    });

    this.mats.gyroCore = new THREE.MeshStandardMaterial({
      color: 0x3cd6ff,
      roughness: 0.16,
      metalness: 0.94,
      emissive: new THREE.Color(0x0b759e),
      emissiveIntensity: 1.45,
      envMapIntensity: 1.95
    });

    this.mats.quantumDish = new THREE.MeshStandardMaterial({
      color: 0xc470ff,
      roughness: 0.18,
      metalness: 0.9,
      emissive: new THREE.Color(0x6e22b5),
      emissiveIntensity: 1.6,
      envMapIntensity: 2.0
    });
  }
}
