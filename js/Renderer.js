import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export class GameRenderer {
  constructor(container) {
    this.container = container;
    this.quality = 'high'; // 'high' | 'medium'

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060a13);
    // Volumetric-style dark urban night exponential fog
    this.scene.fog = new THREE.FogExp2(0x09101d, 0.0029);

    this.camera = new THREE.PerspectiveCamera(
      74,
      window.innerWidth / window.innerHeight,
      0.08,
      1150
    );

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this._buildNightSkyAndPMREM();
    this._buildBaseLights();
    this._buildComposer();

    window.addEventListener('resize', () => this.onResize());
  }

  getMaxAnisotropy() {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  _buildNightSkyAndPMREM() {
    // Generate rich procedural equirectangular night sky with urban sodium horizon glow & moon
    const w = 1024;
    const h = 512;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
    skyGrad.addColorStop(0.0, '#02050c');
    skyGrad.addColorStop(0.28, '#060d1c');
    skyGrad.addColorStop(0.45, '#111c30');
    skyGrad.addColorStop(0.505, '#2b2220'); // warm sodium horizon light pollution
    skyGrad.addColorStop(0.54, '#18141a');
    skyGrad.addColorStop(1.0, '#04060a');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h);

    // Subtle urban sodium glow pockets along the horizon for PMREM specular reflections on puddles & glass
    for (let i = 0; i < 16; i++) {
      const gx = (i / 16) * w + (i % 3) * 19;
      const gy = h * 0.505;
      const rad = ctx.createRadialGradient(gx, gy, 4, gx, gy, 72);
      if (i % 4 === 0) {
        rad.addColorStop(0, 'rgba(95, 170, 255, 0.34)');
      } else {
        rad.addColorStop(0, 'rgba(255, 162, 74, 0.36)');
      }
      rad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = rad;
      ctx.fillRect(gx - 72, gy - 72, 144, 144);
    }

    // Crisp distant night stars above horizon
    for (let s = 0; s < 320; s++) {
      const sx = ((s * 733) % w);
      const sy = ((s * 419) % Math.floor(h * 0.43));
      const alpha = 0.25 + ((s * 97) % 100) / 140;
      const size = (s % 9 === 0) ? 2 : 1;
      ctx.fillStyle = `rgba(215, 232, 255, ${alpha.toFixed(2)})`;
      ctx.fillRect(sx, sy, size, size);
    }

    // Cold moon halo in upper north-west sky (matches directional moonlight vector)
    const mx = w * 0.22;
    const my = h * 0.2;
    const moonHalo = ctx.createRadialGradient(mx, my, 4, mx, my, 92);
    moonHalo.addColorStop(0, 'rgba(225, 240, 255, 0.95)');
    moonHalo.addColorStop(0.12, 'rgba(155, 195, 255, 0.45)');
    moonHalo.addColorStop(0.45, 'rgba(72, 112, 175, 0.14)');
    moonHalo.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = moonHalo;
    ctx.beginPath();
    ctx.arc(mx, my, 92, 0, Math.PI * 2);
    ctx.fill();

    const envTex = new THREE.CanvasTexture(canvas);
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    envTex.colorSpace = THREE.SRGBColorSpace;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const envRT = pmrem.fromEquirectangular(envTex);
    this.scene.environment = envRT.texture;
    pmrem.dispose();

    // Sky dome mesh (fog disabled so stars & horizon stay sharp from 220m altitude)
    const skyGeo = new THREE.SphereGeometry(960, 32, 20);
    const skyMat = new THREE.MeshBasicMaterial({
      map: envTex,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false
    });
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.skyDome);
  }

  _buildBaseLights() {
    // Cool night sky zenith + subtle warm urban street bounce
    this.hemiLight = new THREE.HemisphereLight(0x567ab5, 0x2d2118, 0.68);
    this.scene.add(this.hemiLight);

    // Directional moonlight with dynamic player-tracking shadow frustum
    this.moonLight = new THREE.DirectionalLight(0x9bc0f5, 1.05);
    this.moonLight.position.set(-70, 140, 55);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.set(2048, 2048);
    this.moonLight.shadow.camera.near = 10;
    this.moonLight.shadow.camera.far = 360;
    const d = 58;
    this.moonLight.shadow.camera.left = -d;
    this.moonLight.shadow.camera.right = d;
    this.moonLight.shadow.camera.top = d;
    this.moonLight.shadow.camera.bottom = -d;
    this.moonLight.shadow.bias = -0.0005;
    this.moonLight.shadow.normalBias = 0.03;
    this.scene.add(this.moonLight);
    this.scene.add(this.moonLight.target);
  }

  _buildComposer() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    // Selective bloom: high threshold ensures only true emissive lamps/strobes/neon bloom (zero close-wall glare!)
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      0.50, // strength
      0.44, // radius
      1.18  // threshold
    );
    this.composer.addPass(this.bloomPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  setQuality(mode) {
    this.quality = mode === 'medium' ? 'medium' : 'high';
    if (this.quality === 'high') {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      this.moonLight.shadow.mapSize.set(2048, 2048);
      if (this.moonLight.shadow.map) {
        this.moonLight.shadow.map.dispose();
        this.moonLight.shadow.map = null;
      }
      this.bloomPass.enabled = true;
    } else {
      this.renderer.setPixelRatio(1.0);
      this.moonLight.shadow.mapSize.set(1024, 1024);
      if (this.moonLight.shadow.map) {
        this.moonLight.shadow.map.dispose();
        this.moonLight.shadow.map = null;
      }
      this.bloomPass.enabled = false;
    }
    this.onResize();
  }

  updateLightingForPlayer(playerPos) {
    // Keep sky dome centered on camera and shadow frustum tightly tracking the player
    this.skyDome.position.copy(playerPos);
    this.moonLight.target.position.set(playerPos.x, Math.max(0, playerPos.y - 4), playerPos.z);
    this.moonLight.position.set(
      playerPos.x - 65,
      Math.max(0, playerPos.y) + 125,
      playerPos.z + 55
    );
    this.moonLight.target.updateMatrixWorld();

    // Subtle atmospheric fog thinning slightly at extreme altitude so you can see the city far below!
    const alt = Math.max(0, playerPos.y);
    const targetDensity = alt < 20 ? 0.0031 : Math.max(0.00175, 0.0031 - (alt - 20) * 0.000007);
    this.scene.fog.density += (targetDensity - this.scene.fog.density) * 0.05;
  }

  render() {
    if (this.quality === 'high') {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
  }
}
