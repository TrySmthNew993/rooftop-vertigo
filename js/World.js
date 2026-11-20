import * as THREE from 'three';

export class World {
  constructor(scene, materials) {
    this.scene = scene;
    this.mats = materials.mats;
    this.textures = materials.textures;

    // Collision & gameplay registries
    this.colliders = [];   // { minX, maxX, minY, maxY, minZ, maxZ, type: 'solid'|'safetynet', surface }
    this.ramps = [];       // { minX, maxX, minZ, maxZ, yAtMin, yAtMax, axis: 'x'|'z' }
    this.ladders = [];     // { id, x, z, yBottom, yTop, normalX, normalZ, dismountX, dismountY, dismountZ, label }
    this.ziplines = [];    // { id, start: Vector3, end: Vector3, label, anchorPos: Vector3 }
    this.lootSpawns = [];  // Definitions passed to Interaction manager
    this.interactables = []; // Trader kiosk & other static stations
    this.ventGrates = [];  // Air Vent / Crawl Tube grates ({ id, promptPos, targetPos, targetYaw, enterCrawl, title, subtitle, toastMsg })
    this.crawlZones = [];  // Low-headroom AABB volumes ({ minX, maxX, minY, maxY, minZ, maxZ, label })
    this.anchorPoints = []; // Explicit structural Carabiner Anchor Bolts ({ x, y, z, radius })

    // Spatial Grid for fast O(1) collision & ramp queries (16m x 16m cells)
    this.gridCellSize = 16.0;
    this.colliderGrid = new Map();
    this.rampGrid = new Map();

    // Tiered Sector Groups & Culling Registries (60+ FPS altitude/distance culling)
    this.undergroundGroup = new THREE.Group();
    this.streetDetailGroup = new THREE.Group();
    this.midRiseDetailGroup = new THREE.Group();
    this.scene.add(this.undergroundGroup);
    this.scene.add(this.streetDetailGroup);
    this.scene.add(this.midRiseDetailGroup);
    this._currentSectorTarget = this.scene;
    this.managedLights = []; // { light, baseIntensity, x, y, z, sector: 'underground'|'street'|'high' }

    // Animated scene elements
    this.strobes = [];
    this.flickerLights = [];
    this.windStreaks = null;
    this.windStreakData = [];
    this._windDummy = new THREE.Object3D();

    // Instanced collectors (flushed at end of build for 60+ FPS low draw calls)
    this._boxPools = new Map(); // key -> { material, castShadow, receiveShadow, parentGroup, matrices: [] }
    this._anchorBoltMatrices = [];
    this._anchorRingMatrices = [];
    this._rungMatrices = [];
    this._cageMatrices = [];
    this._steelBeamMatrices = [];
    this._towerRedMatrices = [];
    this._towerWhiteMatrices = [];

    this._buildAll();
  }

  _buildAll() {
    this._currentSectorTarget = this.streetDetailGroup;
    this._buildGroundAndAlleyHub();

    this._currentSectorTarget = this.undergroundGroup;
    this._buildFalloutShelter();

    this._currentSectorTarget = this.midRiseDetailGroup;
    this._buildMidRiseBlocks();

    this._currentSectorTarget = this.scene;
    this._buildSkyscraper();
    this._buildBrutalistScaffoldTower();
    this._buildTwinSpireSkyscraper();
    this._buildBroadcastTower();
    this._buildZiplines();
    this._buildDistantCitySkyline();
    this._flushInstancedGeometry();
    this._buildSpatialGrid();
    this._buildWindParticles();
  }

  // ---------- Utility Helpers ----------

  _registerLight(light, baseIntensity, x, y, z, sector = 'street') {
    this.managedLights.push({ light, baseIntensity, x, y, z, sector });
    return light;
  }

  _addAnchorPoint(x, y, z, radius = 2.4) {
    this.anchorPoints.push({ x, y, z, radius });
    const mat = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion(),
      new THREE.Vector3(0.24, 0.24, 0.24)
    );
    this._anchorBoltMatrices.push(mat);
    const ringMat = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y + 0.16, z),
      new THREE.Quaternion(),
      new THREE.Vector3(1, 1, 1)
    );
    this._anchorRingMatrices.push(ringMat);
  }

  hasNearbyAnchorPoint(pos) {
    // 1. Check explicit glowing Anchor Bolts / Lanyard Tie-Off Posts
    for (const a of this.anchorPoints) {
      if (Math.abs(pos.y - a.y) < 2.4) {
        const d = Math.hypot(pos.x - a.x, pos.z - a.z);
        if (d <= a.radius) return true;
      }
    }
    // 2. Check proximity to structural guardrails, parapets, scaffolding poles, crane beams, or narrow catwalks
    const nearby = this.getNearbyColliders(pos.x, pos.z);
    for (const box of nearby) {
      if (box.type === 'safetynet') continue;
      const w = box.maxX - box.minX;
      const d = box.maxZ - box.minZ;
      const h = box.maxY - box.minY;
      // Waist-level guardrail/parapet, vertical column/mast, or narrow balance plank/bridge (<3.6m wide)
      const isStructuralRailOrBeam = (w < 3.6 || d < 3.6) || (h >= 0.7 && h <= 3.0 && box.maxY > pos.y + 0.35 && box.minY < pos.y + 1.8);
      if (!isStructuralRailOrBeam) continue;
      if (pos.y + 1.8 < box.minY || pos.y - 0.5 > box.maxY) continue;
      const cx = THREE.MathUtils.clamp(pos.x, box.minX, box.maxX);
      const cz = THREE.MathUtils.clamp(pos.z, box.minZ, box.maxZ);
      if (Math.hypot(pos.x - cx, pos.z - cz) <= 1.85) {
        return true;
      }
    }
    return false;
  }

  _addSolidBox(x, y, z, w, h, d, material, { castShadow = true, receiveShadow = true, collider = true, surface = 'concrete', type = 'solid', uniqueMesh = false, parent = null } = {}) {
    if (collider) {
      this.colliders.push({
        minX: x - w / 2,
        maxX: x + w / 2,
        minY: y - h / 2,
        maxY: y + h / 2,
        minZ: z - d / 2,
        maxZ: z + d / 2,
        type,
        surface
      });
    }

    const targetGroup = parent || this._currentSectorTarget || this.scene;

    // Ground slabs that mutate UVs or explicit unique meshes stay as individual THREE.Mesh
    if (uniqueMesh || material === this.mats.wetAsphalt) {
      const geo = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      this.scene.add(mesh);
      return mesh;
    }

    // Major building/tower cores & outer structural masses stay in root scene so they remain visible from 220m altitude
    const isMacroStructure = (w >= 7.0 && d >= 7.0) || h >= 14.0 || y >= 30.0 || type === 'safetynet';
    const poolParent = isMacroStructure ? this.scene : targetGroup;
    // Only cast directional shadows from large structural masses & roofs to keep shadow-map vertex budget crisp
    const poolCastShadow = castShadow && (w >= 2.2 || h >= 2.2 || d >= 2.2);

    const poolKey = `${material.uuid}_${poolCastShadow ? 1 : 0}_${receiveShadow ? 1 : 0}_${poolParent.uuid}`;
    let pool = this._boxPools.get(poolKey);
    if (!pool) {
      pool = {
        material,
        castShadow: poolCastShadow,
        receiveShadow,
        parentGroup: poolParent,
        matrices: []
      };
      this._boxPools.set(poolKey, pool);
    }

    const mat4 = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion(),
      new THREE.Vector3(w, h, d)
    );
    pool.matrices.push(mat4);
    return null;
  }

  _pushStrut(list, p1, p2, radius) {
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = dir.length();
    if (len < 0.001) return;
    const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.normalize()
    );
    const mat = new THREE.Matrix4().compose(
      mid,
      quat,
      new THREE.Vector3(radius, len, radius)
    );
    list.push(mat);
  }

  _addLadder({ id, x, z, yBottom, yTop, normalX, normalZ, dismountX, dismountY, dismountZ, hasCage = false, label = 'Exterior Ladder' }) {
    const height = yTop - yBottom;
    const midY = (yBottom + yTop) / 2;

    // Facing quaternion: ladder front faces along (normalX, 0, normalZ)
    const yaw = Math.atan2(normalX, normalZ);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    // Side rails (two sleek cylindrical/square rails)
    const railGeo = new THREE.BoxGeometry(0.06, height + 0.85, 0.07);
    for (const side of [-0.32, 0.32]) {
      const rail = new THREE.Mesh(railGeo, this.mats.ladderRail);
      rail.position.set(x + rightX * side, midY + 0.35, z + rightZ * side);
      rail.rotation.y = yaw;
      rail.castShadow = true;
      this.scene.add(rail);
    }

    // Instanced rungs spaced every 0.36m
    const rungStep = 0.36;
    const rungQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    for (let ry = yBottom + 0.32; ry <= yTop - 0.1; ry += rungStep) {
      const mat = new THREE.Matrix4().compose(
        new THREE.Vector3(x, ry, z),
        rungQuat,
        new THREE.Vector3(0.64, 0.045, 0.045)
      );
      this._rungMatrices.push(mat);
    }

    // Optional industrial safety cage hoops every 1.6m starting 2.4m above base
    if (hasCage && height > 4) {
      const cageQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      for (let cy = yBottom + 2.4; cy <= yTop + 0.4; cy += 1.75) {
        const cx = x + normalX * 0.42;
        const cz = z + normalZ * 0.42;
        const mat = new THREE.Matrix4().compose(
          new THREE.Vector3(cx, cy, cz),
          cageQuat,
          new THREE.Vector3(1, 1, 1)
        );
        this._cageMatrices.push(mat);
      }
      // Vertical cage back-strap bars
      const strapGeo = new THREE.BoxGeometry(0.04, Math.max(1, height - 2.0), 0.04);
      for (const ang of [-0.7, 0, 0.7]) {
        const bx = x + normalX * (0.42 + Math.cos(ang) * 0.46) + rightX * Math.sin(ang) * 0.46;
        const bz = z + normalZ * (0.42 + Math.cos(ang) * 0.46) + rightZ * Math.sin(ang) * 0.46;
        const strap = new THREE.Mesh(strapGeo, this.mats.ladderCage);
        strap.position.set(bx, yBottom + 2.4 + (height - 2.0) / 2, bz);
        this.scene.add(strap);
      }
    }

    // Subtle green LED marker strips at base & top so ladders read cleanly in night fog
    const markerGeo = new THREE.BoxGeometry(0.7, 0.08, 0.08);
    const botMarker = new THREE.Mesh(markerGeo, this.mats.greenBeacon);
    botMarker.position.set(x + normalX * 0.05, yBottom + 1.1, z + normalZ * 0.05);
    botMarker.rotation.y = yaw;
    this.scene.add(botMarker);

    const topMarker = new THREE.Mesh(markerGeo, this.mats.amberBeacon);
    topMarker.position.set(x + normalX * 0.05, yTop + 0.65, z + normalZ * 0.05);
    topMarker.rotation.y = yaw;
    this.scene.add(topMarker);

    this.ladders.push({
      id,
      x,
      z,
      yBottom,
      yTop,
      normalX,
      normalZ,
      dismountX,
      dismountY,
      dismountZ,
      hasCage,
      label
    });
  }

  _addStrobe(x, y, z, { phase = 0, addLight = false, scale = 5.5 } = {}) {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), this.mats.strobeRed.clone());
    bulb.position.set(x, y, z);
    this.scene.add(bulb);

    const spriteMat = new THREE.SpriteMaterial({
      map: this.textures.glowSprite,
      color: 0xff2233,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.9
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(x, y, z);
    sprite.scale.set(scale, scale, 1);
    this.scene.add(sprite);

    let light = null;
    if (addLight) {
      light = new THREE.PointLight(0xff2030, 14, 38, 1.8);
      light.position.set(x, y, z);
      this.scene.add(light);
    }

    this.strobes.push({ bulb, sprite, light, phase, baseScale: scale });
  }

  _addStreetLamp(x, z, rotY = 0, addPointLight = true) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotY;

    // Steel pole
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 6.8, 10), this.mats.structuralSteel);
    pole.position.y = 3.4;
    pole.castShadow = true;
    group.add(pole);

    // Bracket arm
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.5), this.mats.structuralSteel);
    arm.position.set(0, 6.65, 0.65);
    group.add(arm);

    // Lamp hood
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.62), this.mats.rustedIron);
    hood.position.set(0, 6.62, 1.25);
    group.add(hood);

    // Emissive warm sodium bulb (triggers selective UnrealBloom)
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.44), this.mats.sodiumBulb);
    bulb.position.set(0, 6.53, 1.25);
    group.add(bulb);

    // Soft volumetric light cone
    const cone = new THREE.Mesh(new THREE.ConeGeometry(3.4, 6.4, 16, 1, true), this.mats.sodiumCone);
    cone.position.set(0, 3.35, 1.25);
    group.add(cone);

    if (addPointLight) {
      const light = new THREE.PointLight(0xffa445, 22, 26, 1.6);
      light.position.set(0, 6.1, 1.25);
      group.add(light);
      const wx = x + Math.sin(rotY) * 1.25;
      const wz = z + Math.cos(rotY) * 1.25;
      this._registerLight(light, 22, wx, 6.1, wz, 'street');
    }

    this.scene.add(group);
  }

  _addLootSpawn(id, itemKey, x, y, z, zoneName) {
    this.lootSpawns.push({
      id,
      itemKey,
      position: new THREE.Vector3(x, y, z),
      zoneName
    });
  }

  // ---------- 1. Central Safe Hub / Wet Urban Alley ----------

  _buildGroundAndAlleyHub() {
    // Split wet asphalt ground around the Fallout Shelter stairwell opening: x in [-13, -7], z in [14, 22]
    const buildGroundSlab = (minX, maxX, minZ, maxZ) => {
      const w = maxX - minX;
      const d = maxZ - minZ;
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      const mesh = this._addSolidBox(cx, -0.5, cz, w, 1.0, d, this.mats.wetAsphalt, {
        castShadow: false,
        receiveShadow: true,
        collider: true,
        surface: 'asphalt'
      });
      // Adjust UV scale to match slab dimensions so puddles stay proportional
      const uv = mesh.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * (w / 45), uv.getY(i) * (d / 45));
      }
    };

    buildGroundSlab(-95, 95, -115, 14);
    buildGroundSlab(-95, 95, 22, 75);
    buildGroundSlab(-95, -13, 14, 22);
    buildGroundSlab(-7, 95, 14, 22);

    // Hero reflective puddles in the alley hub (catch warm sodium lamps & neon sign)
    const puddles = [
      [0.5, 2.0, 5.2, 3.4, 0.2],
      [-3.8, -5.5, 4.6, 2.8, -0.4],
      [4.2, -13.0, 6.0, 3.2, 0.15],
      [-1.5, 10.5, 4.2, 2.4, 0.5],
      [15.0, -32.0, 7.0, 4.0, -0.2]
    ];
    for (const [px, pz, pw, pd, rot] of puddles) {
      const pMesh = new THREE.Mesh(new THREE.CircleGeometry(1, 24), this.mats.puddle);
      pMesh.rotation.x = -Math.PI / 2;
      pMesh.rotation.z = rot;
      pMesh.scale.set(pw * 0.5, pd * 0.5, 1);
      pMesh.position.set(px, 0.014, pz);
      this.scene.add(pMesh);
    }

    // Perimeter concrete alley boundary walls (keeps hub cozy & cinematic, opens toward all zones)
    this._addSolidBox(-14.5, 2.2, 3.5, 1.0, 4.4, 19.0, this.mats.concrete);
    this._addSolidBox(14.5, 2.2, 6.0, 1.0, 4.4, 26.0, this.mats.concrete);
    this._addSolidBox(12, 2.2, 24.0, 38.0, 4.4, 1.0, this.mats.concrete);

    // Warm Sodium Streetlamps illuminating the alley & approach corridors
    this._addStreetLamp(-12.5, -4.5, Math.PI / 2, true);
    this._addStreetLamp(12.5, 5.0, -Math.PI / 2, true);
    this._addStreetLamp(-11.5, -26.0, Math.PI / 2, true);
    this._addStreetLamp(24.0, -34.0, Math.PI / 4, false); // Visual lamp near broadcast tower road

    // Scrap Buyer Trader Kiosk at (-10.8, 0, 2) facing +X
    const kx = -11.2;
    const kz = 2.0;
    this._addSolidBox(kx, 1.7, kz, 4.2, 3.4, 5.4, this.mats.rustedIron, { surface: 'metal' });
    // Awning overhang
    this._addSolidBox(kx + 2.4, 3.15, kz, 1.5, 0.18, 5.6, this.mats.structuralSteel, { collider: false });
    // Service counter ledge
    this._addSolidBox(kx + 2.35, 1.02, kz, 0.8, 0.14, 3.8, this.mats.galvanizedSteel, { collider: true });
    // Glowing recessed window screen
    const counterWin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.25, 3.4), this.mats.sodiumBulb);
    counterWin.position.set(kx + 2.12, 1.9, kz);
    this.scene.add(counterWin);
    // Neon "SCRAP BUYER" Signboard
    const signMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.0, 4.4), this.mats.traderSign);
    signMesh.position.set(kx + 2.35, 3.72, kz);
    this.scene.add(signMesh);
    // Warm kiosk light
    const kioskLight = new THREE.PointLight(0xffb454, 18, 18, 1.6);
    kioskLight.position.set(kx + 3.2, 2.6, kz);
    this.scene.add(kioskLight);
    this._registerLight(kioskLight, 18, kx + 3.2, 2.6, kz, 'street');

    // Register Scrap Buyer interaction station
    this.interactables.push({
      id: 'scrap_buyer',
      type: 'trader',
      position: new THREE.Vector3(kx + 2.7, 1.4, kz),
      radius: 3.4,
      title: 'SCRAP BUYER KIOSK',
      subtitle: 'Sell Salvage • Buy Climbing Gear • Advance Night'
    });

    // Alley Props: Industrial dumpster, crates, road barriers
    this._addSolidBox(11.8, 0.85, -3.5, 2.2, 1.7, 3.4, this.mats.rustedIron, { surface: 'metal' });
    this._addSolidBox(-11.5, 0.65, 8.8, 1.5, 1.3, 1.5, this.mats.hazard, { surface: 'metal' });
    this._addSolidBox(-6.5, 0.5, -28.0, 4.4, 1.0, 0.5, this.mats.hazard, { surface: 'concrete' });
    this._addSolidBox(6.5, 0.5, -28.0, 4.4, 1.0, 0.5, this.mats.hazard, { surface: 'concrete' });

    // Zipline Landing Cushion Pad in the alley at (6, 0, 5)
    this._addSolidBox(6.0, 0.15, 5.0, 5.4, 0.3, 5.4, this.mats.hazard, { surface: 'metal' });
    const padNet = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.1, 4.6), this.mats.safetyNet);
    padNet.position.set(6.0, 0.34, 5.0);
    this.scene.add(padNet);
  }

  // ---------- 2. Underground Fallout Shelter (y = -6m) ----------

  _buildFalloutShelter() {
    // Concrete ramp descending from z=14 (y=0) to z=22 (y=-6) along x in [-13, -7]
    const rampLen = Math.hypot(8, 6);
    const rampPitch = Math.atan2(6, 8);
    const rampMesh = new THREE.Mesh(
      new THREE.BoxGeometry(6.0, 0.5, rampLen),
      this.mats.shelterConcrete
    );
    rampMesh.position.set(-10.0, -3.25, 18.0);
    rampMesh.rotation.x = rampPitch;
    rampMesh.receiveShadow = true;
    this.scene.add(rampMesh);

    this.ramps.push({
      minX: -13.0,
      maxX: -7.0,
      minZ: 14.0,
      maxZ: 22.2,
      yAtMin: 0.0,
      yAtMax: -6.0,
      axis: 'z'
    });

    // Concrete retaining walls beside stairwell & entrance bunker hood
    this._addSolidBox(-13.4, -2.5, 18.0, 0.8, 7.6, 9.2, this.mats.concrete);
    this._addSolidBox(-6.6, -2.5, 18.0, 0.8, 7.6, 9.2, this.mats.concrete);
    // Entrance concrete canopy & glowing Fallout Shelter sign at z = 14.2
    this._addSolidBox(-10.0, 2.7, 14.4, 7.6, 0.9, 1.6, this.mats.concrete);
    this._addSolidBox(-13.3, 1.35, 14.4, 0.9, 2.7, 1.4, this.mats.hazard);
    this._addSolidBox(-6.7, 1.35, 14.4, 0.9, 2.7, 1.4, this.mats.hazard);
    const shelterSign = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.0, 0.2), this.mats.shelterSign);
    shelterSign.position.set(-10.0, 2.7, 13.52);
    this.scene.add(shelterSign);

    // Heavy Blast Door Frame at z = 22.0, y = -6.. -1.2 (swung partially open for entry)
    this._addSolidBox(-12.2, -3.6, 22.0, 1.8, 4.8, 0.9, this.mats.hazard);
    this._addSolidBox(-7.8, -3.6, 22.0, 1.8, 4.8, 0.9, this.mats.hazard);
    // Swung-open heavy steel blast door leaf with locking wheel
    const doorGroup = new THREE.Group();
    doorGroup.position.set(-11.2, -3.8, 22.5);
    doorGroup.rotation.y = 1.15;
    const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(2.4, 4.1, 0.45), this.mats.rustedIron);
    doorLeaf.position.x = 1.2;
    doorGroup.add(doorLeaf);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 18), this.mats.galvanizedSteel);
    wheel.position.set(1.75, 0.0, 0.3);
    doorGroup.add(wheel);
    this.scene.add(doorGroup);

    // Underground Concrete Basement Hall: x in [-19, -1], z in [22, 36], floor y = -6, ceiling y = -1.2
    this._addSolidBox(-10.0, -6.4, 29.0, 19.0, 0.8, 15.0, this.mats.shelterConcrete, { castShadow: false, surface: 'concrete' });
    this._addSolidBox(-10.0, -0.8, 29.0, 19.0, 0.8, 15.0, this.mats.shelterConcrete, { castShadow: false });
    this._addSolidBox(-19.4, -3.6, 29.0, 0.8, 5.6, 15.0, this.mats.shelterConcrete);
    this._addSolidBox(-0.6, -3.6, 29.0, 0.8, 5.6, 15.0, this.mats.shelterConcrete);
    // Split South wall at z=36.4 around expanded Bunker Storage Wing doorway (x in [-11.8, -8.2])
    this._addSolidBox(-15.65, -3.6, 36.4, 7.7, 5.6, 0.8, this.mats.shelterConcrete);
    this._addSolidBox(-4.35, -3.6, 36.4, 7.7, 5.6, 0.8, this.mats.shelterConcrete);
    // Heavy hazard header above South doorway
    this._addSolidBox(-10.0, -1.5, 36.4, 3.8, 1.4, 0.9, this.mats.hazard);
    // Front chamber walls flanking the blast door opening
    this._addSolidBox(-16.1, -3.6, 22.0, 6.2, 5.6, 0.8, this.mats.shelterConcrete);
    this._addSolidBox(-3.9, -3.6, 22.0, 6.2, 5.6, 0.8, this.mats.shelterConcrete);

    // Structural pillars & industrial racks inside the fallout shelter
    for (const [px, pz] of [[-14.5, 26.5], [-5.5, 26.5], [-14.5, 32.0], [-5.5, 32.0]]) {
      this._addSolidBox(px, -3.6, pz, 1.1, 4.8, 1.1, this.mats.concrete);
    }
    this._addSolidBox(-17.8, -4.8, 29.0, 1.6, 2.4, 5.0, this.mats.rustedIron, { surface: 'metal' });
    this._addSolidBox(-2.2, -4.8, 30.5, 1.6, 2.4, 5.5, this.mats.structuralSteel, { surface: 'metal' });

    // Harsh cold flickering fluorescent lighting (entrance + basement center)
    const addFluorescent = (fx, fy, fz, flickerSpeed, addPoint = true) => {
      const targetGrp = fy < 0 ? this.undergroundGroup : this.streetDetailGroup;
      const tube = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 0.22), this.mats.fluorescentBulb.clone());
      tube.position.set(fx, fy, fz);
      targetGrp.add(tube);
      if (addPoint) {
        const light = new THREE.PointLight(0xa2ecff, 18, 22, 1.5);
        light.position.set(fx, fy - 0.35, fz);
        targetGrp.add(light);
        const sector = fy < 0 ? 'underground' : 'street';
        this._registerLight(light, 18, fx, fy - 0.35, fz, sector);
        this.flickerLights.push({ light, mesh: tube, baseIntensity: 18, speed: flickerSpeed, offset: fx * 1.7 + fz * 0.4, sector });
      }
    };
    addFluorescent(-10.0, 1.9, 14.8, 7.5);
    addFluorescent(-10.0, -1.45, 25.5, 11.2);
    addFluorescent(-10.0, -1.45, 32.5, 5.3);

    // Flickering amber warning beacon inside shelter
    const warnLight = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 10), this.mats.amberBeacon);
    warnLight.position.set(-10.0, -1.7, 22.6);
    this.undergroundGroup.add(warnLight);

    // 4 Underground Shelter Main Hall Loot Caches (starter salvage run)
    this._addLootSpawn('shelter_1', 'titanium_fasteners', -16.8, -5.5, 24.4, 'Fallout Shelter');
    this._addLootSpawn('shelter_2', 'coaxial_copper', -16.4, -5.5, 34.4, 'Fallout Shelter');
    this._addLootSpawn('shelter_3', 'titanium_fasteners', -3.6, -5.5, 24.4, 'Fallout Shelter');
    this._addLootSpawn('shelter_4', 'transmitter_relay', -3.4, -5.5, 34.6, 'Fallout Shelter');

    // ---------- 2B. Expanded Bunker Wing: 2 Interconnected Dark Storage Corridors & Blast Doors ----------
    this._buildBunkerExpansionAndVents(addFluorescent);
  }

  _buildBunkerExpansionAndVents(addFluorescent) {
    // Helper to build a heavy rusty open blast door with handwheel
    const addBlastDoorLeaf = (hx, hy, hz, rotY) => {
      const grp = new THREE.Group();
      grp.position.set(hx, hy, hz);
      grp.rotation.y = rotY;
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(2.1, 3.8, 0.42), this.mats.rustedIron);
      leaf.position.x = 1.05;
      grp.add(leaf);
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.055, 8, 16), this.mats.galvanizedSteel);
      wheel.position.set(1.45, 0.0, 0.28);
      grp.add(wheel);
      const wheelBack = wheel.clone();
      wheelBack.position.z = -0.28;
      grp.add(wheelBack);
      this.undergroundGroup.add(grp);
    };

    // Helper to build industrial multi-tier shelving units
    const addShelvingRack = (rx, rz, rw, rd, rotY = 0) => {
      const grp = new THREE.Group();
      grp.position.set(rx, -6.0, rz);
      grp.rotation.y = rotY;
      // 3 horizontal steel shelves
      for (const sy of [0.35, 1.25, 2.15]) {
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.08, rd), this.mats.galvanizedSteel);
        shelf.position.y = sy;
        grp.add(shelf);
      }
      // 4 corner angle-iron posts
      const postGeo = new THREE.BoxGeometry(0.08, 2.45, 0.08);
      for (const px of [-rw / 2 + 0.05, rw / 2 - 0.05]) {
        for (const pz of [-rd / 2 + 0.05, rd / 2 - 0.05]) {
          const post = new THREE.Mesh(postGeo, this.mats.rustedIron);
          post.position.set(px, 1.225, pz);
          grp.add(post);
        }
      }
      this.undergroundGroup.add(grp);
      // Solid AABB collider for the rack
      const cW = Math.abs(Math.cos(rotY)) * rw + Math.abs(Math.sin(rotY)) * rd;
      const cD = Math.abs(Math.sin(rotY)) * rw + Math.abs(Math.cos(rotY)) * rd;
      this.colliders.push({
        minX: rx - cW / 2,
        maxX: rx + cW / 2,
        minY: -6.0,
        maxY: -3.55,
        minZ: rz - cD / 2,
        maxZ: rz + cD / 2,
        type: 'solid',
        surface: 'metal'
      });
    };

    // Helper for flickering amber emergency bulkhead cage lamp (mesh only or localized light)
    const addBulkheadLamp = (bx, by, bz) => {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.16), this.mats.rustedIron);
      base.position.set(bx, by, bz);
      this.undergroundGroup.add(base);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), this.mats.amberBeacon);
      bulb.position.set(bx, by, bz);
      this.undergroundGroup.add(bulb);
    };

    // Blast door #2 at z = 36.4 entrance into Corridor 1
    addBlastDoorLeaf(-11.8, -4.0, 36.75, 1.18);
    addBulkheadLamp(-10.0, -2.0, 36.9);

    // --- Corridor 1: South Axial Storage Corridor (x in [-13.2, -6.8], z in [36.0, 52.0], floor y=-6, ceil y=-1.4) ---
    this._addSolidBox(-10.0, -6.4, 44.0, 7.2, 0.8, 16.4, this.mats.shelterConcrete, { castShadow: false, surface: 'concrete' });
    this._addSolidBox(-10.0, -1.0, 44.0, 7.2, 0.8, 16.4, this.mats.shelterConcrete, { castShadow: false });
    // West wall of Corridor 1 (z = 36..52 at x = -13.4)
    this._addSolidBox(-13.4, -3.7, 44.0, 0.8, 5.4, 16.4, this.mats.shelterConcrete);
    // East wall of Corridor 1: z = 36..44.8 solid, then open from z = 44.8..50.8 into Corridor 2!
    this._addSolidBox(-6.6, -3.7, 40.4, 0.8, 5.4, 8.8, this.mats.shelterConcrete);
    // South end wall of Corridor 1 at z = 52.0
    this._addSolidBox(-10.0, -3.7, 52.0, 7.2, 5.4, 0.8, this.mats.shelterConcrete);

    // Overhead rusted steam & air pipes along Corridor 1 ceiling
    const mainPipe1 = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 15.5, 10), this.mats.rustedIron);
    mainPipe1.rotation.x = Math.PI / 2;
    mainPipe1.position.set(-11.8, -1.75, 44.0);
    this.scene.add(mainPipe1);

    // Shelving units along Corridor 1
    addShelvingRack(-12.35, 39.5, 1.1, 3.2, 0);
    addShelvingRack(-12.35, 45.5, 1.1, 3.2, 0);
    addShelvingRack(-7.65, 40.8, 1.1, 3.2, 0);

    // --- Interconnecting Blast Door Frame between Corridor 1 & Corridor 2 at x = -6.6, z in [44.8, 50.8] ---
    this._addSolidBox(-6.6, -3.7, 45.3, 0.9, 5.4, 1.2, this.mats.hazard);
    this._addSolidBox(-6.6, -3.7, 50.9, 0.9, 5.4, 1.2, this.mats.hazard);
    this._addSolidBox(-6.6, -1.6, 48.1, 0.9, 1.2, 4.6, this.mats.hazard);
    addBlastDoorLeaf(-6.2, -4.0, 45.85, -0.45);
    addBulkheadLamp(-6.1, -2.05, 48.1);

    // --- Corridor 2: East Ordnance & Tech Vault Wing (x in [-6.6, 13.6], z in [43.5, 52.0], floor y=-6, ceil y=-1.4) ---
    this._addSolidBox(3.5, -6.4, 47.75, 20.6, 0.8, 9.2, this.mats.shelterConcrete, { castShadow: false, surface: 'concrete' });
    this._addSolidBox(3.5, -1.0, 47.75, 20.6, 0.8, 9.2, this.mats.shelterConcrete, { castShadow: false });
    // North wall of Corridor 2 (z = 43.35)
    this._addSolidBox(3.5, -3.7, 43.35, 20.2, 5.4, 0.8, this.mats.shelterConcrete);
    // South wall of Corridor 2 (z = 52.0)
    this._addSolidBox(3.5, -3.7, 52.0, 20.2, 5.4, 0.8, this.mats.shelterConcrete);
    // East end wall of Corridor 2 (x = 13.6) - split around the Bunker Air Vent Crawl Tube Entrance at z in [46.85, 48.65], y in [-6.0, -4.75]!
    this._addSolidBox(13.6, -3.7, 45.0, 0.8, 5.4, 3.7, this.mats.shelterConcrete);
    this._addSolidBox(13.6, -3.7, 50.5, 0.8, 5.4, 3.7, this.mats.shelterConcrete);
    this._addSolidBox(13.6, -3.05, 47.75, 0.8, 3.4, 1.8, this.mats.shelterConcrete);

    // Overhead pipes along Corridor 2
    const mainPipe2 = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 19.5, 10), this.mats.rustedIron);
    mainPipe2.rotation.z = Math.PI / 2;
    mainPipe2.position.set(3.5, -1.75, 45.0);
    this.scene.add(mainPipe2);

    // Shelving units & industrial crates inside Corridor 2
    addShelvingRack(-1.5, 44.45, 3.6, 1.1, 0);
    addShelvingRack(5.2, 44.45, 3.6, 1.1, 0);
    addShelvingRack(0.5, 50.9, 3.6, 1.1, 0);
    addShelvingRack(7.5, 50.9, 3.6, 1.1, 0);

    // Localized flickering fluorescent lights (1 in Corridor 1, 1 in Corridor 2 — zero FPS regression!)
    addFluorescent(-10.0, -1.55, 44.2, 9.4, true);
    addFluorescent(3.8, -1.55, 47.75, 13.1, true);

    // 5 High-Value Salvage Spawns in the Expanded Bunker Wing
    this._addLootSpawn('bunker_wing_1', 'military_capacitor', -11.6, -5.5, 39.5, 'Bunker Storage Corridor A (-6m)');
    this._addLootSpawn('bunker_wing_2', 'coaxial_copper', -10.0, -5.5, 50.2, 'Bunker Storage Corridor A (-6m)');
    this._addLootSpawn('bunker_wing_3', 'emergency_tech_kit', -1.5, -5.5, 45.3, 'Bunker Tech Vault B (-6m)');
    this._addLootSpawn('bunker_wing_4', 'military_capacitor', 5.2, -5.5, 45.3, 'Bunker Tech Vault B (-6m)');
    this._addLootSpawn('bunker_wing_5', 'emergency_tech_kit', 9.2, -5.5, 50.1, 'Bunker Tech Vault B (-6m)');

    // ---------- 2C. Ventilation Shafts, Rusted Pipes & Crawl Tubes (Connecting Surface Alley <-> Bunker) ----------
    // Helper to build a detailed open metal louver vent grate with glowing cyan/green framing
    const buildOpenVentGrate = (gx, gy, gz, rotY) => {
      const grp = new THREE.Group();
      grp.position.set(gx, gy, gz);
      grp.rotation.y = rotY;

      // Outer bolted galvanized steel duct frame (1.45m wide x 1.25m tall)
      const frameThick = 0.12;
      const w = 1.45;
      const h = 1.25;
      const topBar = new THREE.Mesh(new THREE.BoxGeometry(w, frameThick, 0.24), this.mats.galvanizedSteel);
      topBar.position.y = h / 2;
      grp.add(topBar);
      const botBar = new THREE.Mesh(new THREE.BoxGeometry(w, frameThick, 0.24), this.mats.galvanizedSteel);
      botBar.position.y = -h / 2;
      grp.add(botBar);
      for (const sx of [-w / 2 + frameThick / 2, w / 2 - frameThick / 2]) {
        const sideBar = new THREE.Mesh(new THREE.BoxGeometry(frameThick, h, 0.24), this.mats.galvanizedSteel);
        sideBar.position.x = sx;
        grp.add(sideBar);
      }

      // Swung-open metal grate door hanging to the right side with louver slats
      const grateDoor = new THREE.Group();
      grateDoor.position.set(w / 2 - 0.05, 0, 0.12);
      grateDoor.rotation.y = 2.15; // Swung wide open!
      const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.18, 1.02, 0.06), this.mats.rustedIron);
      doorFrame.position.x = -0.59;
      grateDoor.add(doorFrame);
      for (let sy = -0.36; sy <= 0.36; sy += 0.18) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.04, 0.09), this.mats.galvanizedSteel);
        slat.position.set(-0.59, sy, 0.02);
        slat.rotation.x = 0.35;
        grateDoor.add(slat);
      }
      grp.add(grateDoor);

      // Subtle green/cyan indicator beacon on top of duct frame so players spot the vent in the dark
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.07, 0.09), this.mats.greenBeacon);
      led.position.set(0, h / 2 + 0.1, 0.1);
      grp.add(led);

      this.scene.add(grp);
    };

    // 1) Surface Ventilation Duct & Rusted Pipe Complex in Rear Service Alley behind Block B (x = 19.5..31.5, z = -7.0)
    // Walk-in square galvanized steel crawl duct on the ground behind Block B South wall:
    // Interior x in [19.5, 29.0], z in [-7.9, -6.1] (width 1.8m), floor y = 0.0, ceiling y = 1.22m (forces 0.8m crawl state!)
    // Low duct roof slab (bottom at y = 1.22m -> triggers crawl headroom check!)
    this._addSolidBox(24.25, 1.34, -7.0, 9.6, 0.24, 2.1, this.mats.galvanizedSteel, { surface: 'metal' });
    // South duct side wall (z = -5.95)
    this._addSolidBox(24.25, 0.65, -5.95, 9.6, 1.3, 0.22, this.mats.galvanizedSteel, { surface: 'metal' });
    // East duct end bulkhead wall (x = 29.1) leading down into vertical shaft housing
    this._addSolidBox(29.1, 0.65, -7.0, 0.24, 1.3, 2.1, this.mats.rustedIron, { surface: 'metal' });
    // Vertical rusted ventilation riser tower & cylindrical pipe stack diving underground at x = 30.2, z = -7.0
    this._addSolidBox(30.3, 2.4, -7.0, 2.2, 4.8, 2.2, this.mats.rustedIron, { surface: 'metal' });
    const riserCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 9.5, 14), this.mats.rustedIron);
    riserCyl.position.set(30.3, 4.5, -5.6);
    this.scene.add(riserCyl);
    // Overhead horizontal duct connecting riser into Block B wall
    const upperDuct = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 1.2), this.mats.galvanizedSteel);
    upperDuct.position.set(30.3, 6.5, -7.4);
    this.scene.add(upperDuct);

    // Open Vent Grate at West Mouth of Surface Crawl Duct (x = 19.45, y = 0.65, z = -7.0, facing West -X)
    buildOpenVentGrate(19.45, 0.65, -7.0, -Math.PI / 2);
    // Open Vent Grate inside East End of Surface Crawl Duct (x = 28.85, y = 0.65, z = -7.0, facing West -X)
    buildOpenVentGrate(28.85, 0.65, -7.0, -Math.PI / 2);

    // Register Surface Crawl Zone AABB so crawling inside the surface duct automatically drops player height to 0.8m!
    this.crawlZones.push({
      minX: 19.2,
      maxX: 29.2,
      minY: -0.2,
      maxY: 1.3,
      minZ: -8.0,
      maxZ: -5.9,
      label: 'SURFACE VENTILATION DUCT (CRAWL)'
    });

    // 2) Underground Ventilation Crawl Tube extending East from Corridor 2 (x in [13.6, 22.8], z in [46.85, 48.65], floor y = -6.0, ceiling y = -4.78)
    // Floor slab of underground crawl tube
    this._addSolidBox(18.2, -6.4, 47.75, 9.6, 0.8, 2.2, this.mats.galvanizedSteel, { castShadow: false, surface: 'metal' });
    // Low ceiling of underground crawl tube (bottom at y = -4.78m -> forces 0.8m crawl state!)
    this._addSolidBox(18.2, -4.66, 47.75, 9.6, 0.24, 2.2, this.mats.galvanizedSteel, { castShadow: false, surface: 'metal' });
    // North & South galvanized duct walls of underground crawl tube
    this._addSolidBox(18.2, -5.35, 46.74, 9.6, 1.3, 0.22, this.mats.galvanizedSteel, { surface: 'metal' });
    this._addSolidBox(18.2, -5.35, 48.76, 9.6, 1.3, 0.22, this.mats.galvanizedSteel, { surface: 'metal' });
    // East bulkhead riser termination wall at x = 22.9
    this._addSolidBox(22.9, -5.35, 47.75, 0.24, 1.3, 2.2, this.mats.rustedIron, { surface: 'metal' });
    // Cylindrical vertical rusted air shaft rising from the East end of the underground crawl tube
    const bunkerShaftCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 7.0, 14), this.mats.rustedIron);
    bunkerShaftCyl.position.set(23.1, -2.5, 47.75);
    this.scene.add(bunkerShaftCyl);

    // Open Vent Grate at Corridor 2 Mouth of Underground Crawl Tube (x = 13.25, y = -5.35, z = 47.75, facing West -X)
    buildOpenVentGrate(13.25, -5.35, 47.75, -Math.PI / 2);
    // Open Vent Grate at East Shaft Terminus inside Underground Crawl Tube (x = 22.65, y = -5.35, z = 47.75, facing West -X)
    buildOpenVentGrate(22.65, -5.35, 47.75, -Math.PI / 2);

    // Register Underground Crawl Zone AABB
    this.crawlZones.push({
      minX: 13.1,
      maxX: 23.0,
      minY: -6.2,
      maxY: -4.6,
      minZ: 46.7,
      maxZ: 48.8,
      label: 'BUNKER VENTILATION CRAWL TUBE (-6m)'
    });

    // Register Interactive Vent Grate Prompts ("[E] Enter Air Vent / Crawl")
    // 1. Surface West Mouth -> Places player directly inside the surface crawl duct in 0.8m crawl state
    this.ventGrates.push({
      id: 'vent_surface_mouth',
      promptPos: new THREE.Vector3(19.35, 0.75, -7.0),
      radius: 2.9,
      targetPos: new THREE.Vector3(21.4, 0.05, -7.0),
      targetYaw: -Math.PI / 2,
      enterCrawl: true,
      title: 'Enter Air Vent / Crawl',
      subtitle: 'Surface Ventilation Duct (0.8m Crawl State → Bunker Shaft)',
      toastMsg: 'Entered Surface Air Vent (0.8m Crawl). Proceed East to descend into Bunker Wing.'
    });

    // 2. Surface East Shaft Terminus -> Descends through vertical vent shaft into Underground Bunker Crawl Tube!
    this.ventGrates.push({
      id: 'vent_surface_to_bunker',
      promptPos: new THREE.Vector3(28.7, 0.65, -7.0),
      radius: 2.8,
      targetPos: new THREE.Vector3(20.6, -5.95, 47.75),
      targetYaw: Math.PI / 2,
      enterCrawl: true,
      title: 'Enter Air Vent / Crawl',
      subtitle: 'Descend Vertical Shaft → Bunker Storage Wing (-6m)',
      toastMsg: 'Crawled through Ventilation Shaft into Underground Bunker Wing (-6m).'
    });

    // 3. Bunker Corridor 2 Mouth -> Places player inside the underground crawl tube in 0.8m crawl state
    this.ventGrates.push({
      id: 'vent_bunker_mouth',
      promptPos: new THREE.Vector3(13.15, -5.25, 47.75),
      radius: 2.9,
      targetPos: new THREE.Vector3(15.2, -5.95, 47.75),
      targetYaw: -Math.PI / 2,
      enterCrawl: true,
      title: 'Enter Air Vent / Crawl',
      subtitle: 'Bunker Exhaust Crawl Tube (0.8m Crawl State → Surface Alley)',
      toastMsg: 'Entered Bunker Exhaust Crawl Tube (0.8m Crawl). Proceed East to ascend to Surface Alley.'
    });

    // 4. Bunker East Shaft Terminus -> Ascends through vertical vent shaft into Surface Rear Alley Crawl Duct!
    this.ventGrates.push({
      id: 'vent_bunker_to_surface',
      promptPos: new THREE.Vector3(22.5, -5.35, 47.75),
      radius: 2.8,
      targetPos: new THREE.Vector3(26.6, 0.05, -7.0),
      targetYaw: Math.PI / 2,
      enterCrawl: true,
      title: 'Enter Air Vent / Crawl',
      subtitle: 'Ascend Vertical Shaft → Rear Service Alley (0m)',
      toastMsg: 'Crawled up Ventilation Shaft to Rear Service Alley (0m).'
    });
  }

  // ---------- 3. Low/Mid Residential & Office Blocks (~24m & 28m) ----------

  _buildMidRiseBlocks() {
    // --- Block A (West Industrial Block, y = 24m): x in [-32, -14], z in [-26, -8] ---
    this._addSolidBox(-23.0, 12.0, -17.0, 18.0, 24.0, 18.0, this.mats.buildingFacade, { surface: 'concrete' });
    // Gravel / tar roof cap
    this._addSolidBox(-23.0, 24.05, -17.0, 17.6, 0.14, 17.6, this.mats.tarRoof, { collider: false });

    // Parapet walls with clean openings for ladders, rooftop bridge & West Skybridge to Brutalist Tower (z in [-18.8, -15.2])
    this._addSolidBox(-23.0, 24.55, -25.8, 18.0, 1.1, 0.45, this.mats.concrete); // North
    this._addSolidBox(-31.8, 24.55, -22.4, 0.45, 1.1, 7.2, this.mats.concrete); // West North half
    this._addSolidBox(-31.8, 24.55, -11.6, 0.45, 1.1, 7.2, this.mats.concrete); // West South half
    // South parapet split around direct ladder at x = -20
    this._addSolidBox(-27.0, 24.55, -8.2, 9.8, 1.1, 0.45, this.mats.concrete);
    this._addSolidBox(-16.1, 24.55, -8.2, 4.2, 1.1, 0.45, this.mats.concrete);
    // East parapet split around bridge (z in [-19, -16]) & fire escape ladder (z = -10.5)
    this._addSolidBox(-14.2, 24.55, -22.5, 0.45, 1.1, 6.4, this.mats.concrete);
    this._addSolidBox(-14.2, 24.55, -14.0, 0.45, 1.1, 4.0, this.mats.concrete);

    // Block A Rooftop props (HVAC units, skylight, water tank)
    this._addSolidBox(-27.5, 25.1, -21.0, 3.6, 2.2, 2.8, this.mats.galvanizedSteel, { surface: 'metal' });
    this._addSolidBox(-27.0, 25.0, -12.5, 2.6, 2.0, 2.6, this.mats.rustedIron, { surface: 'metal' });

    // Exterior Metal Fire Escape Stairs on Block A East Face (y = 0 -> 12m)
    const addFireEscapeFlight = (cx, zStart, yStart, zEnd, yEnd) => {
      const steps = 20;
      const treadGeo = new THREE.BoxGeometry(1.7, 0.08, 0.38);
      for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps;
        const tread = new THREE.Mesh(treadGeo, this.mats.galvanizedSteel);
        tread.position.set(cx, THREE.MathUtils.lerp(yStart, yEnd, t), THREE.MathUtils.lerp(zStart, zEnd, t));
        this.scene.add(tread);
      }
      // Twin diagonal structural steel stringers + outer safety handrail
      for (const ox of [-0.84, 0.84]) {
        this._pushStrut(
          this._steelBeamMatrices,
          new THREE.Vector3(cx + ox, yStart, zStart),
          new THREE.Vector3(cx + ox, yEnd, zEnd),
          0.075
        );
      }
      // Outer handrail bar + vertical balusters
      this._pushStrut(
        this._steelBeamMatrices,
        new THREE.Vector3(cx + 0.84, yStart + 1.0, zStart),
        new THREE.Vector3(cx + 0.84, yEnd + 1.0, zEnd),
        0.04
      );
      for (let p = 0; p <= 4; p++) {
        const t = p / 4;
        const py = THREE.MathUtils.lerp(yStart, yEnd, t);
        const pz = THREE.MathUtils.lerp(zStart, zEnd, t);
        this._pushStrut(
          this._steelBeamMatrices,
          new THREE.Vector3(cx + 0.84, py, pz),
          new THREE.Vector3(cx + 0.84, py + 1.0, pz),
          0.032
        );
      }
    };

    // Flight 1: x in [-14.0, -12.2], z from -9 (y=0) to -16 (y=6)
    addFireEscapeFlight(-13.1, -9.0, 0.0, -16.0, 6.0);
    this.ramps.push({ minX: -14.0, maxX: -12.2, minZ: -16.2, maxZ: -8.8, yAtMin: 6.0, yAtMax: 0.0, axis: 'z' });

    // Landing at y = 6m
    this._addSolidBox(-12.2, 5.9, -17.6, 3.6, 0.25, 3.0, this.mats.galvanizedSteel, { surface: 'metal' });
    this._addSolidBox(-10.45, 6.6, -17.6, 0.12, 1.1, 3.0, this.mats.rustedIron);

    // Flight 2: x in [-12.2, -10.4], z from -16 (y=6) to -9 (y=12)
    addFireEscapeFlight(-11.3, -16.0, 6.0, -9.0, 12.0);
    this.ramps.push({ minX: -12.2, maxX: -10.4, minZ: -16.2, maxZ: -8.8, yAtMin: 6.0, yAtMax: 12.0, axis: 'z' });

    // Upper Fire Escape Landing at y = 12m
    this._addSolidBox(-12.2, 11.9, -8.2, 3.6, 0.25, 3.4, this.mats.galvanizedSteel, { surface: 'metal' });
    this._addSolidBox(-10.45, 12.6, -8.2, 0.12, 1.1, 3.4, this.mats.rustedIron);

    // Block A Ladders:
    // 1) Fire escape upper ladder y=12 -> y=24 on east wall (aligned squarely on the y=12m landing z in [-9.9, -6.5])
    this._addLadder({
      id: 'blockA_fire_ladder',
      x: -13.65,
      z: -9.1,
      yBottom: 12.0,
      yTop: 24.0,
      normalX: 1,
      normalZ: 0,
      dismountX: -15.4,
      dismountY: 24.05,
      dismountZ: -9.1,
      hasCage: true,
      label: 'Block A Fire-Escape Ladder (24m)'
    });
    // 2) Direct street-to-roof access ladder on south wall
    this._addLadder({
      id: 'blockA_south_ladder',
      x: -20.0,
      z: -7.65,
      yBottom: 0.0,
      yTop: 24.0,
      normalX: 0,
      normalZ: 1,
      dismountX: -20.0,
      dismountY: 24.05,
      dismountZ: -9.5,
      hasCage: false,
      label: 'Block A Direct Access Ladder (24m)'
    });

    // --- Rooftop Catwalk / Industrial Pipe Bridge across the alley at y = 24m ---
    this._addSolidBox(0.0, 23.85, -17.5, 28.0, 0.3, 2.8, this.mats.galvanizedSteel, { surface: 'metal' });
    // Bridge side girders / waist railings
    this._addSolidBox(0.0, 24.6, -18.85, 28.0, 0.95, 0.12, this.mats.rustedIron);
    this._addSolidBox(0.0, 24.6, -16.15, 28.0, 0.95, 0.12, this.mats.rustedIron);
    // Overhead industrial utility pipe spanning the bridge
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 28.4, 12), this.mats.rustedIron);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0.0, 26.8, -18.4);
    this.scene.add(pipe);

    // --- Block B (East Office Block, y = 28m): x in [14, 32], z in [-26, -8] ---
    this._addSolidBox(23.0, 14.0, -17.0, 18.0, 28.0, 18.0, this.mats.buildingFacade, { surface: 'concrete' });
    this._addSolidBox(23.0, 28.05, -17.0, 17.6, 0.14, 17.6, this.mats.tarRoof, { collider: false });

    // Block B Parapets with cutouts at west ladders (z = -17.5 and z = -11)
    this._addSolidBox(23.0, 28.55, -25.8, 18.0, 1.1, 0.45, this.mats.concrete);
    this._addSolidBox(23.0, 28.55, -8.2, 18.0, 1.1, 0.45, this.mats.concrete);
    this._addSolidBox(31.8, 28.55, -17.0, 0.45, 1.1, 18.0, this.mats.concrete);
    this._addSolidBox(14.2, 28.55, -22.5, 0.45, 1.1, 6.4, this.mats.concrete);
    this._addSolidBox(14.2, 28.55, -14.2, 0.45, 1.1, 3.6, this.mats.concrete);

    // Block B rooftop machinery & comms mast
    this._addSolidBox(26.5, 29.2, -21.5, 4.2, 2.4, 3.2, this.mats.structuralSteel, { surface: 'metal' });
    this._addSolidBox(27.5, 29.0, -12.0, 2.4, 2.0, 2.4, this.mats.galvanizedSteel, { surface: 'metal' });

    // Short ladder from bridge (y=24) onto Block B roof (y=28)
    this._addLadder({
      id: 'blockB_bridge_ladder',
      x: 13.65,
      z: -17.5,
      yBottom: 24.0,
      yTop: 28.0,
      normalX: -1,
      normalZ: 0,
      dismountX: 15.5,
      dismountY: 28.05,
      dismountZ: -17.5,
      hasCage: false,
      label: 'Block B Bridge Step-Up (28m)'
    });
    // Direct alley-to-roof ladder on Block B west wall
    this._addLadder({
      id: 'blockB_west_ladder',
      x: 13.65,
      z: -11.0,
      yBottom: 0.0,
      yTop: 28.0,
      normalX: -1,
      normalZ: 0,
      dismountX: 15.5,
      dismountY: 28.05,
      dismountZ: -11.0,
      hasCage: true,
      label: 'Block B West Exterior Ladder (28m)'
    });

    // Block A & B Loot Caches (6 mid-tier rooftop caches)
    this._addLootSpawn('blockA_1', 'coaxial_copper', -24.5, 24.45, -22.0, 'Block A Rooftop (24m)');
    this._addLootSpawn('blockA_2', 'titanium_fasteners', -28.0, 24.45, -16.0, 'Block A Rooftop (24m)');
    this._addLootSpawn('bridge_1', 'coaxial_copper', 0.0, 24.45, -17.5, 'Rooftop Pipe Bridge (24m)');
    this._addLootSpawn('blockB_1', 'transmitter_relay', 24.0, 28.45, -22.5, 'Block B Rooftop (28m)');
    this._addLootSpawn('blockB_2', 'coaxial_copper', 28.5, 28.45, -15.5, 'Block B Rooftop (28m)');
    this._addLootSpawn('blockB_3', 'strobe_beacon', 19.5, 28.45, -10.5, 'Block B Rooftop (28m)');
  }

  // ---------- 4. Unfinished Skyscraper (~130m + 136m Crane) ----------

  _buildSkyscraper() {
    const cx = 0;
    const cz = -48;
    const half = 14; // 28m x 28m footprint: x in [-14, 14], z in [-62, -34]

    // Central reinforced concrete elevator core rising 130m
    this._addSolidBox(cx, 65.0, cz, 10.5, 130.0, 10.5, this.mats.concrete, { surface: 'concrete' });

    // Walkable floor decks at 26m, 52m, 78m, 104m, 130m
    const decks = [26, 52, 78, 104, 130];
    for (const dy of decks) {
      this._addSolidBox(cx, dy - 0.35, cz, 28.0, 0.7, 28.0, this.mats.concrete, { surface: 'concrete' });

      // Hazard warning edge trim on south & east edges
      const trimS = new THREE.Mesh(new THREE.BoxGeometry(28.0, 0.12, 0.55), this.mats.hazard);
      trimS.position.set(cx, dy + 0.06, cz + half - 0.3);
      this.scene.add(trimS);

      // Subtle work lamp emissive bars on each resting floor so players see progress up the facade
      const bar = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.14, 0.2), this.mats.fluorescentBulb);
      bar.position.set(cx, dy + 3.8, cz + half - 0.8);
      this.scene.add(bar);
    }

    // Instanced structural steel I-beam columns & perimeter girders (high architectural detail!)
    const colOffsets = [-13.6, -6.8, 0, 6.8, 13.6];
    for (const ox of colOffsets) {
      for (const oz of colOffsets) {
        const isPerimeter = Math.abs(ox) > 13 || Math.abs(oz) > 13;
        if (!isPerimeter) continue;
        // Full 130m vertical perimeter I-beam
        this._pushStrut(
          this._steelBeamMatrices,
          new THREE.Vector3(cx + ox, 0, cz + oz),
          new THREE.Vector3(cx + ox, 130.4, cz + oz),
          0.32
        );
      }
    }

    // Horizontal intermediate steel floor beams every 6.5m + exposed top-floor diagonal wind braces
    for (let y = 6.5; y <= 130; y += 6.5) {
      this._pushStrut(this._steelBeamMatrices, new THREE.Vector3(cx - 13.6, y, cz + 13.6), new THREE.Vector3(cx + 13.6, y, cz + 13.6), 0.22);
      this._pushStrut(this._steelBeamMatrices, new THREE.Vector3(cx - 13.6, y, cz - 13.6), new THREE.Vector3(cx + 13.6, y, cz - 13.6), 0.22);
      this._pushStrut(this._steelBeamMatrices, new THREE.Vector3(cx - 13.6, y, cz - 13.6), new THREE.Vector3(cx - 13.6, y, cz + 13.6), 0.22);
      this._pushStrut(this._steelBeamMatrices, new THREE.Vector3(cx + 13.6, y, cz - 13.6), new THREE.Vector3(cx + 13.6, y, cz + 13.6), 0.22);
    }

    // Diagonal structural steel bracing on unfinished upper skeleton (78m - 130m)
    for (let y = 78; y < 130; y += 26) {
      this._pushStrut(this._steelBeamMatrices, new THREE.Vector3(cx - 13.6, y, cz - 13.6), new THREE.Vector3(cx + 13.6, y + 26, cz - 13.6), 0.16);
      this._pushStrut(this._steelBeamMatrices, new THREE.Vector3(cx + 13.6, y, cz - 13.6), new THREE.Vector3(cx - 13.6, y + 26, cz - 13.6), 0.16);
      this._pushStrut(this._steelBeamMatrices, new THREE.Vector3(cx - 13.6, y, cz - 13.6), new THREE.Vector3(cx - 13.6, y + 26, cz + 13.6), 0.16);
    }

    // Partial dark reflective glass curtain walls on lower/mid floors (y = 0..78, leaving climbing bays open!)
    const glassPanels = [
      // North wall glass (full lower 78m)
      [cx, 39, cz - 13.85, 27.2, 78, 0.2],
      // West wall glass (lower 78m)
      [cx - 13.85, 39, cz, 0.2, 78, 27.2],
      // South wall partial glass (west half 0..52, east half 52..78)
      [cx - 7.0, 26, cz + 13.85, 13.0, 52, 0.2],
      [cx + 7.5, 65, cz + 13.85, 12.2, 26, 0.2]
    ];
    for (const [gx, gy, gz, gw, gh, gd] of glassPanels) {
      const gMesh = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, gd), this.mats.curtainGlass);
      gMesh.position.set(gx, gy, gz);
      this.scene.add(gMesh);
    }

    // 3 Functional Protruding Suspended Safety Nets (catch falling players safely!)
    const netHeights = [24, 64, 98];
    for (const ny of netHeights) {
      // South protruding catch net (7m deep outward!)
      this._addSolidBox(cx, ny, cz + half + 3.6, 30.0, 0.35, 7.2, this.mats.safetyNet, {
        castShadow: false,
        receiveShadow: false,
        collider: true,
        type: 'safetynet',
        surface: 'net'
      });
      // East protruding catch net (7m deep outward!)
      this._addSolidBox(cx + half + 3.6, ny, cz, 7.2, 0.35, 30.0, this.mats.safetyNet, {
        castShadow: false,
        receiveShadow: false,
        collider: true,
        type: 'safetynet',
        surface: 'net'
      });
      // Steel outrigger arms supporting the nets
      for (const ox of [-12, 0, 12]) {
        this._pushStrut(this._steelBeamMatrices, new THREE.Vector3(cx + ox, ny - 2.0, cz + half), new THREE.Vector3(cx + ox, ny, cz + half + 7.2), 0.09);
      }
      for (const oz of [-12, 0, 12]) {
        this._pushStrut(this._steelBeamMatrices, new THREE.Vector3(cx + half, ny - 2.0, cz + oz), new THREE.Vector3(cx + half + 7.2, ny, cz + oz), 0.09);
      }
    }

    // Cantilevered exterior steel access balconies at the base of stages 2–5 so players can safely walk onto & step off every exterior ladder
    this._addSolidBox(cx + half + 1.2, 26 - 0.175, cz, 2.4, 0.35, 3.4, this.mats.galvanizedSteel, { surface: 'metal' });
    this._addSolidBox(-7.0, 52 - 0.175, cz + half + 1.2, 3.4, 0.35, 2.4, this.mats.galvanizedSteel, { surface: 'metal' });
    this._addSolidBox(cx + half + 1.2, 78 - 0.175, cz + 7.0, 2.4, 0.35, 3.4, this.mats.galvanizedSteel, { surface: 'metal' });
    this._addSolidBox(0.0, 104 - 0.175, cz + half + 1.2, 3.4, 0.35, 2.4, this.mats.galvanizedSteel, { surface: 'metal' });

    // Multi-Stage Exterior Climbing Ladders (0 -> 26 -> 52 -> 78 -> 104 -> 130)
    this._addLadder({
      id: 'sky_stage1',
      x: 3.5, z: cz + half + 0.4, yBottom: 0, yTop: 26,
      normalX: 0, normalZ: 1, dismountX: 3.5, dismountY: 26.05, dismountZ: cz + half - 1.8,
      hasCage: true, label: 'Skyscraper Stage 1 (0m → 26m)'
    });
    this._addLadder({
      id: 'sky_stage2',
      x: cx + half + 0.4, z: cz, yBottom: 26, yTop: 52,
      normalX: 1, normalZ: 0, dismountX: cx + half - 1.8, dismountY: 52.05, dismountZ: cz,
      hasCage: true, label: 'Skyscraper Stage 2 (26m → 52m)'
    });
    this._addLadder({
      id: 'sky_stage3',
      x: -7.0, z: cz + half + 0.4, yBottom: 52, yTop: 78,
      normalX: 0, normalZ: 1, dismountX: -7.0, dismountY: 78.05, dismountZ: cz + half - 1.8,
      hasCage: false, label: 'Skyscraper Stage 3 — Exposed (52m → 78m)'
    });
    this._addLadder({
      id: 'sky_stage4',
      x: cx + half + 0.4, z: cz + 7.0, yBottom: 78, yTop: 104,
      normalX: 1, normalZ: 0, dismountX: cx + half - 1.8, dismountY: 104.05, dismountZ: cz + 7.0,
      hasCage: false, label: 'Skyscraper Stage 4 — High Wind (78m → 104m)'
    });
    this._addLadder({
      id: 'sky_stage5',
      x: 0.0, z: cz + half + 0.4, yBottom: 104, yTop: 130,
      normalX: 0, normalZ: 1, dismountX: 0.0, dismountY: 130.05, dismountZ: cz + half - 1.8,
      hasCage: false, label: 'Skyscraper Summit Ladder (104m → 130m)'
    });

    // --- Exterior Construction Tower Crane (mounted on West face, jib at y = 136m) ---
    const craneX = -16.2;
    const craneZ = cz;
    // Vertical yellow crane lattice mast from y=0 to y=144
    this._addSolidBox(craneX, 72.0, craneZ, 2.2, 144.0, 2.2, this.mats.craneYellow, { collider: true, surface: 'metal' });
    // Operator cabin
    this._addSolidBox(craneX + 1.8, 137.4, craneZ + 1.6, 2.2, 2.6, 2.2, this.mats.craneYellow, { collider: false });
    // Walkable Horizontal Crane Jib Catwalk extending over the abyss from x=-24 to x=+18 at y=136m!
    this._addSolidBox(-3.0, 135.75, craneZ, 42.0, 0.5, 2.4, this.mats.craneYellow, { surface: 'metal' });
    // Counterweight concrete blocks at back of jib
    this._addSolidBox(-22.5, 137.0, craneZ, 4.0, 2.6, 2.8, this.mats.concrete);
    // Crane apex support cables
    this._pushStrut(this._steelBeamMatrices, new THREE.Vector3(craneX, 144.0, craneZ), new THREE.Vector3(17.5, 136.0, craneZ), 0.07);
    this._pushStrut(this._steelBeamMatrices, new THREE.Vector3(craneX, 144.0, craneZ), new THREE.Vector3(-23.5, 136.0, craneZ), 0.07);

    // Ladder from 130m skyscraper roof up onto 136m Crane Jib
    this._addLadder({
      id: 'sky_crane_ladder',
      x: -14.25, z: craneZ, yBottom: 130, yTop: 136,
      normalX: 1, normalZ: 0, dismountX: -12.8, dismountY: 136.05, dismountZ: craneZ,
      hasCage: false, label: 'Tower Crane Jib Ladder (130m → 136m)'
    });

    // Aviation Red Strobe Lights on Skyscraper corners & Crane Jib tip
    this._addStrobe(-13.6, 131.5, cz - 13.6, { phase: 0.0 });
    this._addStrobe(13.6, 131.5, cz + 13.6, { phase: 0.4 });
    this._addStrobe(17.6, 137.2, craneZ, { phase: 0.8, addLight: true, scale: 7.5 });

    // Base work floodlight at skyscraper south entrance
    const baseLight = new THREE.PointLight(0xd9ebff, 22, 32, 1.5);
    baseLight.position.set(3.5, 5.5, cz + half + 4.5);
    this.scene.add(baseLight);
    this._registerLight(baseLight, 22, 3.5, 5.5, cz + half + 4.5, 'street');

    // Structural Carabiner Anchor Bolts on Skyscraper Decks & Crane Jib
    for (const dy of [26, 52, 78, 104, 130]) {
      this._addAnchorPoint(cx, dy + 0.15, cz + half - 1.2, 2.8);
      this._addAnchorPoint(cx + half - 1.2, dy + 0.15, cz, 2.8);
    }
    this._addAnchorPoint(8.0, 136.15, craneZ, 2.8);
    this._addAnchorPoint(-10.0, 136.15, craneZ, 2.8);

    // 5 High-Tier Skyscraper Loot Caches
    this._addLootSpawn('sky_52', 'coaxial_copper', -10.0, 52.45, cz + 9.0, 'Skyscraper Deck 52m');
    this._addLootSpawn('sky_78', 'transmitter_relay', 10.0, 78.45, cz - 9.0, 'Skyscraper Deck 78m');
    this._addLootSpawn('sky_104', 'titanium_fasteners', -9.5, 104.45, cz - 9.5, 'Skyscraper Deck 104m');
    this._addLootSpawn('sky_130', 'transmitter_relay', -8.0, 130.45, cz + 8.5, 'Skyscraper Roof 130m');
    this._addLootSpawn('sky_crane', 'strobe_beacon', 15.5, 136.45, craneZ, 'Skyscraper Crane Jib 136m');
  }

  // ---------- 4B. 110m Brutalist Concrete & Exterior Scaffolding Tower (West Sector) ----------

  _buildBrutalistScaffoldTower() {
    const bx = -50;
    const bz = -20;
    const half = 9; // 18m x 18m brutalist monolith: x in [-59, -41], z in [-29, -11]

    // Monolithic brutalist concrete core rising 110m
    this._addSolidBox(bx, 55.0, bz, 18.0, 110.0, 18.0, this.mats.concrete, { surface: 'concrete' });

    // Brutalist recessed architectural horizontal concrete ribs every 14m
    for (let ry = 14; ry <= 98; ry += 14) {
      this._addSolidBox(bx, ry, bz, 18.6, 0.8, 18.6, this.mats.shelterConcrete, { collider: false });
    }

    // 1. Skybridge at y = 24m linking Block A Roof (x = -32) to Brutalist Tower East Scaffolding (x = -38.8)
    // Span from x = -40.8 to x = -31.8 at z = -17.0 (length 9.0m, width 2.4m)
    this._addSolidBox(-36.3, 23.85, -17.0, 9.2, 0.3, 2.4, this.mats.galvanizedSteel, { surface: 'metal' });
    this._addSolidBox(-36.3, 24.55, -18.15, 9.2, 0.9, 0.12, this.mats.rustedIron);
    this._addSolidBox(-36.3, 24.55, -15.85, 9.2, 0.9, 0.12, this.mats.rustedIron);
    this._addAnchorPoint(-36.3, 24.15, -17.0, 2.8);

    // 2. East Face Scaffolding Landing at y = 24m (x in [-41, -38.4], z in [-29.2, -10.8])
    this._addSolidBox(-39.7, 23.85, -20.0, 2.6, 0.3, 18.4, this.mats.galvanizedSteel, { surface: 'metal' });
    // Street-to-24m Direct Access Ladder on South-East corner of Brutalist Scaffolding
    this._addLadder({
      id: 'brutalist_ground_ladder',
      x: -39.7,
      z: -10.55,
      yBottom: 0.0,
      yTop: 24.0,
      normalX: 0,
      normalZ: 1,
      dismountX: -39.7,
      dismountY: 24.05,
      dismountZ: -12.2,
      hasCage: true,
      label: 'Brutalist Scaffold Base Ladder (0m → 24m)'
    });

    // 3. Wrap-Around Exterior Scaffolding Ramps & Decks (24m -> 42m -> 52m -> 78m -> 88m -> 110m)
    // Helper to build visual diagonal scaffold ramp planks + register physics ramp
    const addScaffoldRamp = (minX, maxX, minZ, maxZ, yAtMin, yAtMax, axis) => {
      this.ramps.push({ minX, maxX, minZ, maxZ, yAtMin, yAtMax, axis });
      const steps = 16;
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      const w = maxX - minX;
      const d = maxZ - minZ;
      for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps;
        const py = THREE.MathUtils.lerp(yAtMin, yAtMax, t) - 0.08;
        const px = axis === 'x' ? THREE.MathUtils.lerp(minX, maxX, t) : cx;
        const pz = axis === 'z' ? THREE.MathUtils.lerp(minZ, maxZ, t) : cz;
        const stepW = axis === 'x' ? (w / steps) * 1.08 : w;
        const stepD = axis === 'z' ? (d / steps) * 1.08 : d;
        this._addSolidBox(px, py, pz, stepW, 0.14, stepD, this.mats.galvanizedSteel, { collider: false });
      }
      // Diagonal structural handrail struts
      const pStart = new THREE.Vector3(axis === 'x' ? minX : cx, yAtMin, axis === 'z' ? minZ : cz);
      const pEnd = new THREE.Vector3(axis === 'x' ? maxX : cx, yAtMax, axis === 'z' ? maxZ : cz);
      this._pushStrut(this._steelBeamMatrices, pStart, pEnd, 0.08);
      this._pushStrut(
        this._steelBeamMatrices,
        new THREE.Vector3(pStart.x, pStart.y + 1.05, pStart.z),
        new THREE.Vector3(pEnd.x, pEnd.y + 1.05, pEnd.z),
        0.045
      );
    };

    // North Face Scaffolding Ramp: y = 24m (East, x = -41) -> y = 33m (West, x = -59) along z in [-31.6, -29.0]
    this._addSolidBox(-39.7, 23.85, -30.3, 2.6, 0.3, 2.6, this.mats.galvanizedSteel, { surface: 'metal' }); // NE corner turn
    addScaffoldRamp(-59.0, -41.0, -31.6, -29.0, 33.0, 24.0, 'x');
    this._addSolidBox(-60.3, 32.85, -30.3, 2.6, 0.3, 2.6, this.mats.galvanizedSteel, { surface: 'metal' }); // NW corner landing (33m)
    this._addAnchorPoint(-60.3, 33.15, -30.3, 2.6);

    // West Face Scaffolding Ramp: y = 33m (North, z = -29) -> y = 42m (South, z = -11) along x in [-61.6, -59.0]
    addScaffoldRamp(-61.6, -59.0, -29.0, -11.0, 33.0, 42.0, 'z');
    // SW Corner Scaffolding Rest Platform at y = 42m
    this._addSolidBox(-60.3, 41.85, -9.7, 2.6, 0.3, 2.6, this.mats.galvanizedSteel, { surface: 'metal' });
    // South Face Narrow Balance Plank at y = 42m (1.3m wide exposed plank from x = -59 to x = -41 at z = -9.7!)
    this._addSolidBox(-50.0, 41.85, -9.7, 18.0, 0.3, 1.35, this.mats.craneYellow, { surface: 'metal' });
    this._addSolidBox(-39.7, 41.85, -9.7, 2.6, 0.3, 2.6, this.mats.galvanizedSteel, { surface: 'metal' }); // SE corner 42m
    this._addAnchorPoint(-50.0, 42.15, -9.7, 2.6);
    this._addAnchorPoint(-39.7, 42.15, -9.7, 2.6);

    // East Face Caged Ladder from y = 42m -> y = 68m
    this._addLadder({
      id: 'brutalist_mid_ladder',
      x: -39.7,
      z: -12.5,
      yBottom: 42.0,
      yTop: 68.0,
      normalX: 0,
      normalZ: -1,
      dismountX: -39.7,
      dismountY: 68.05,
      dismountZ: -14.4,
      hasCage: true,
      label: 'Brutalist East Scaffold Ladder (42m → 68m)'
    });

    // East Scaffolding Platform at y = 68m (z in [-29.0, -13.5])
    this._addSolidBox(-39.7, 67.85, -21.25, 2.6, 0.3, 15.5, this.mats.galvanizedSteel, { surface: 'metal' });
    this._addSolidBox(-39.7, 67.85, -30.3, 2.6, 0.3, 2.6, this.mats.galvanizedSteel, { surface: 'metal' });
    this._addAnchorPoint(-39.7, 68.15, -20.0, 2.8);

    // Upper North Scaffolding Ramp: y = 68m (East, x = -41) -> y = 78m (West, x = -59) along z in [-31.6, -29.0]
    addScaffoldRamp(-59.0, -41.0, -31.6, -29.0, 78.0, 68.0, 'x');
    this._addSolidBox(-60.3, 77.85, -30.3, 2.6, 0.3, 2.6, this.mats.galvanizedSteel, { surface: 'metal' });

    // Upper West Scaffolding Ramp: y = 78m (North, z = -29) -> y = 88m (South, z = -11) along x in [-61.6, -59.0]
    addScaffoldRamp(-61.6, -59.0, -29.0, -11.0, 78.0, 88.0, 'z');
    this._addSolidBox(-60.3, 87.85, -9.7, 2.6, 0.3, 2.6, this.mats.galvanizedSteel, { surface: 'metal' });
    // South Scaffolding Deck at y = 88m
    this._addSolidBox(-50.0, 87.85, -9.7, 18.0, 0.3, 2.4, this.mats.galvanizedSteel, { surface: 'metal' });
    this._addAnchorPoint(-50.0, 88.15, -9.7, 2.8);

    // Final Summit Exposed Ladder on South Face: y = 88m -> y = 110m Roof
    this._addLadder({
      id: 'brutalist_summit_ladder',
      x: -50.0,
      z: -10.55,
      yBottom: 88.0,
      yTop: 110.0,
      normalX: 0,
      normalZ: 1,
      dismountX: -50.0,
      dismountY: 110.05,
      dismountZ: -12.8,
      hasCage: false,
      label: 'Brutalist Summit Ladder — High Wind (88m → 110m)'
    });

    // Brutalist 110m Summit Roof Deck & Helicopter Winch Pad
    this._addSolidBox(bx, 109.85, bz, 19.2, 0.35, 19.2, this.mats.concrete, { surface: 'concrete' });
    this._addSolidBox(bx, 110.15, bz, 11.0, 0.25, 11.0, this.mats.hazard, { surface: 'metal' });
    this._addAnchorPoint(bx, 110.35, bz + 7.5, 3.0);
    this._addAnchorPoint(bx + 7.5, 110.35, bz, 3.0);

    // Protruding Safety Catch Nets around Brutalist Tower at y = 38m and y = 82m
    for (const ny of [38, 82]) {
      this._addSolidBox(bx, ny, bz + 12.2, 24.0, 0.35, 5.5, this.mats.safetyNet, {
        castShadow: false, receiveShadow: false, collider: true, type: 'safetynet', surface: 'net'
      });
      this._addSolidBox(bx - 12.2, ny, bz, 5.5, 0.35, 24.0, this.mats.safetyNet, {
        castShadow: false, receiveShadow: false, collider: true, type: 'safetynet', surface: 'net'
      });
    }

    // Instanced Vertical & Horizontal Exterior Scaffolding Tube Frame (zero extra draw calls!)
    const scaffoldCorners = [
      [-38.5, -10.8], [-38.5, -20.0], [-38.5, -29.2],
      [-50.0, -31.5], [-61.5, -29.2], [-61.5, -20.0],
      [-61.5, -10.8], [-50.0, -8.5]
    ];
    for (const [sx, sz] of scaffoldCorners) {
      this._pushStrut(this._steelBeamMatrices, new THREE.Vector3(sx, 0, sz), new THREE.Vector3(sx, 92, sz), 0.11);
    }
    for (let sy = 12; sy <= 90; sy += 12) {
      this._pushStrut(this._steelBeamMatrices, new THREE.Vector3(-38.5, sy, -29.2), new THREE.Vector3(-38.5, sy, -10.8), 0.08);
      this._pushStrut(this._steelBeamMatrices, new THREE.Vector3(-61.5, sy, -29.2), new THREE.Vector3(-38.5, sy, -29.2), 0.08);
      this._pushStrut(this._steelBeamMatrices, new THREE.Vector3(-61.5, sy, -29.2), new THREE.Vector3(-61.5, sy, -10.8), 0.08);
    }

    // Obstruction Strobes on Brutalist Summit
    this._addStrobe(bx - 9.2, 111.4, bz - 9.2, { phase: 0.3, scale: 6.5 });
    this._addStrobe(bx + 9.2, 111.4, bz + 9.2, { phase: 1.1, scale: 6.5 });

    // 4 Loot Caches on Brutalist Scaffold Tower (including $1,250 Sub-Apex Seismic Gyro Stabilizer!)
    this._addLootSpawn('brutalist_33', 'titanium_fasteners', -60.3, 33.45, -30.3, 'Brutalist Scaffold NW (33m)');
    this._addLootSpawn('brutalist_42', 'military_capacitor', -50.0, 42.45, -9.7, 'Brutalist Balance Plank (42m)');
    this._addLootSpawn('brutalist_68', 'coaxial_copper', -39.7, 68.45, -22.0, 'Brutalist East Deck (68m)');
    this._addLootSpawn('brutalist_apex', 'seismic_gyro_stabilizer', bx, 110.75, bz, 'Brutalist Summit Pad (110m)');
  }

  // ---------- 4C. 165m Twin-Spire Comms Skyscraper (North-West Sector) ----------

  _buildTwinSpireSkyscraper() {
    const sx = -44;
    const szN = -60; // North Spire center: x in [-50, -38], z in [-66, -54] (12m x 12m)
    const szS = -82; // South-Far Spire center: x in [-50, -38], z in [-88, -76] (12m x 12m)
    // Wait: in our coordinate system, North is -Z! So sz = -60 is South Spire (closer to Brutalist Tower at z=-20) and sz = -82 is North Spire (farther north)!

    // South Twin Spire Core (0m -> 142m) at (-44, y, -60)
    this._addSolidBox(sx, 71.0, szN, 12.0, 142.0, 12.0, this.mats.buildingFacade, { surface: 'concrete' });
    // North Twin Spire Core (0m -> 165m) at (-44, y, -82)
    this._addSolidBox(sx, 82.5, szS, 12.0, 165.0, 12.0, this.mats.buildingFacade, { surface: 'concrete' });

    // Reflective dark glass curtain strips along the Twin Spires
    this._addSolidBox(sx + 6.1, 70.0, szN, 0.2, 136.0, 9.2, this.mats.curtainGlass, { collider: false });
    this._addSolidBox(sx + 6.1, 80.0, szS, 0.2, 158.0, 9.2, this.mats.curtainGlass, { collider: false });

    // Corner steel mega-columns on both spires
    for (const cz of [szN, szS]) {
      const topH = cz === szS ? 165.4 : 142.4;
      for (const ox of [-6.1, 6.1]) {
        for (const oz of [-6.1, 6.1]) {
          this._pushStrut(this._steelBeamMatrices, new THREE.Vector3(sx + ox, 0, cz + oz), new THREE.Vector3(sx + ox, topH, cz + oz), 0.28);
        }
      }
    }

    // Rest Decks & Exterior Gondola Platforms on South Spire (y = 36m, 72m, 108m, 140m)
    for (const dy of [36, 72, 108, 140]) {
      this._addSolidBox(sx, dy - 0.25, szN, 15.2, 0.5, 15.2, this.mats.galvanizedSteel, { surface: 'metal' });
      this._addAnchorPoint(sx + 6.8, dy + 0.15, szN, 2.6);
      this._addAnchorPoint(sx, dy + 0.15, szN + 6.8, 2.6);
    }

    // Suspended Window-Washer Maintenance Gondola at y = 96m on East Face of South Spire (receives Zipline from Brutalist 110m Summit!)
    this._addSolidBox(sx + 8.2, 95.8, szN, 3.6, 0.4, 7.6, this.mats.craneYellow, { surface: 'metal' });
    this._addSolidBox(sx + 9.9, 96.55, szN, 0.15, 1.1, 7.6, this.mats.rustedIron);
    this._addAnchorPoint(sx + 8.2, 96.15, szN, 3.0);
    // Steel suspension cables holding the 96m gondola from the 142m roof davits
    this._pushStrut(this._steelBeamMatrices, new THREE.Vector3(sx + 8.2, 96.0, szN - 3.4), new THREE.Vector3(sx + 6.5, 142.0, szN - 3.4), 0.06);
    this._pushStrut(this._steelBeamMatrices, new THREE.Vector3(sx + 8.2, 96.0, szN + 3.4), new THREE.Vector3(sx + 6.5, 142.0, szN + 3.4), 0.06);
    // Ladder from 96m Gondola up to 108m Deck
    this._addLadder({
      id: 'twinspire_gondola_ladder',
      x: sx + 7.65,
      z: szN - 2.2,
      yBottom: 96.0,
      yTop: 108.0,
      normalX: 1,
      normalZ: 0,
      dismountX: sx + 6.2,
      dismountY: 108.05,
      dismountZ: szN - 2.2,
      hasCage: false,
      label: 'Suspended Gondola Ladder (96m → 108m)'
    });

    // Multi-Stage Caged Ladders up South Twin Spire (0 -> 36 -> 72 -> 108 -> 140)
    this._addLadder({
      id: 'twinspire_s1',
      x: sx, z: szN + 6.45, yBottom: 0, yTop: 36,
      normalX: 0, normalZ: 1, dismountX: sx, dismountY: 36.05, dismountZ: szN + 6.8,
      hasCage: true, label: 'Twin-Spire South Stage 1 (0m → 36m)'
    });
    this._addLadder({
      id: 'twinspire_s2',
      x: sx + 6.45, z: szN, yBottom: 36, yTop: 72,
      normalX: 1, normalZ: 0, dismountX: sx + 6.8, dismountY: 72.05, dismountZ: szN,
      hasCage: true, label: 'Twin-Spire South Stage 2 (36m → 72m)'
    });
    this._addLadder({
      id: 'twinspire_s3',
      x: sx, z: szN + 6.45, yBottom: 72, yTop: 108,
      normalX: 0, normalZ: 1, dismountX: sx, dismountY: 108.05, dismountZ: szN + 6.8,
      hasCage: true, label: 'Twin-Spire South Stage 3 (72m → 108m)'
    });
    this._addLadder({
      id: 'twinspire_s4',
      x: sx - 6.45, z: szN, yBottom: 108, yTop: 140,
      normalX: -1, normalZ: 0, dismountX: sx - 6.8, dismountY: 140.05, dismountZ: szN,
      hasCage: false, label: 'Twin-Spire Upper Exposed Ladder (108m → 140m)'
    });

    // 140m Wind-Tunnel Steel Truss Skybridge spanning between South Spire (z = -66) and North Spire (z = -76)
    this._addSolidBox(sx, 139.8, -71.0, 3.2, 0.4, 12.0, this.mats.galvanizedSteel, { surface: 'metal' });
    this._addSolidBox(sx - 1.55, 140.55, -71.0, 0.12, 1.0, 12.0, this.mats.rustedIron);
    this._addSolidBox(sx + 1.55, 140.55, -71.0, 0.12, 1.0, 12.0, this.mats.rustedIron);
    this._addAnchorPoint(sx, 140.15, -71.0, 3.0);
    // Overhead truss X-bracing on the 140m Skybridge
    this._pushStrut(this._steelBeamMatrices, new THREE.Vector3(sx - 1.5, 140.0, -65.5), new THREE.Vector3(sx + 1.5, 143.2, -76.5), 0.08);
    this._pushStrut(this._steelBeamMatrices, new THREE.Vector3(sx + 1.5, 140.0, -65.5), new THREE.Vector3(sx - 1.5, 143.2, -76.5), 0.08);

    // North Spire 140m Staging Deck & Final 140m -> 165m Comms Summit Ladder
    this._addSolidBox(sx, 139.8, szS, 15.2, 0.5, 15.2, this.mats.galvanizedSteel, { surface: 'metal' });
    this._addAnchorPoint(sx, 140.15, szS + 6.8, 2.8);

    this._addLadder({
      id: 'twinspire_summit_ladder',
      x: sx + 6.45,
      z: szS,
      yBottom: 140.0,
      yTop: 165.0,
      normalX: 1,
      normalZ: 0,
      dismountX: sx + 4.8,
      dismountY: 165.05,
      dismountZ: szS,
      hasCage: false,
      label: 'Twin-Spire Summit Antenna Ladder (140m → 165m)'
    });

    // Twin-Spire 165m Summit Deck & Twin Microwave Comms Masts
    this._addSolidBox(sx, 164.85, szS, 14.4, 0.35, 14.4, this.mats.galvanizedSteel, { surface: 'metal' });
    this._addSolidBox(sx, 165.15, szS, 8.0, 0.25, 8.0, this.mats.hazard, { surface: 'metal' });
    this._addAnchorPoint(sx, 165.35, szS + 5.5, 3.2);
    this._addAnchorPoint(sx + 5.5, 165.35, szS, 3.2);

    // Twin Comms Masts rising to 176m on North Spire Summit
    for (const mx of [sx - 4.5, sx + 4.5]) {
      this._pushStrut(this._towerWhiteMatrices, new THREE.Vector3(mx, 165.0, szS - 4.5), new THREE.Vector3(mx, 176.0, szS - 4.5), 0.18);
      this._addStrobe(mx, 176.4, szS - 4.5, { phase: mx * 0.2, scale: 8.0 });
    }
    this._addStrobe(sx, 143.5, szN, { phase: 0.7, scale: 6.5 });

    // Protruding Safety Nets on Twin-Spire at y = 66m and y = 132m
    for (const ny of [66, 132]) {
      this._addSolidBox(sx, ny, szN + 9.5, 18.0, 0.35, 5.2, this.mats.safetyNet, {
        castShadow: false, receiveShadow: false, collider: true, type: 'safetynet', surface: 'net'
      });
      this._addSolidBox(sx + 9.5, ny, szS, 5.2, 0.35, 18.0, this.mats.safetyNet, {
        castShadow: false, receiveShadow: false, collider: true, type: 'safetynet', surface: 'net'
      });
    }

    // 5 High-Value Loot Caches on Twin-Spire Comms Skyscraper (including $2,100 Sub-Apex Quantum Microwave Transceiver!)
    this._addLootSpawn('twinspire_72', 'coaxial_copper', sx - 5.5, 72.45, szN + 5.5, 'Twin-Spire Deck (72m)');
    this._addLootSpawn('twinspire_gondola', 'emergency_tech_kit', sx + 8.2, 96.45, szN + 2.0, 'Twin-Spire Suspended Gondola (96m)');
    this._addLootSpawn('twinspire_108', 'transmitter_relay', sx + 5.5, 108.45, szN - 5.5, 'Twin-Spire Deck (108m)');
    this._addLootSpawn('twinspire_bridge', 'strobe_beacon', sx, 140.45, -71.0, 'Twin-Spire 140m Skybridge');
    this._addLootSpawn('twinspire_apex', 'quantum_microwave_transceiver', sx, 165.75, szS, 'Twin-Spire Comms Summit (165m)');
  }

  // ---------- 5. 220m TV / Lattice Broadcast Tower ----------

  _buildBroadcastTower() {
    const tx = 44;
    const tz = -46;

    // Concrete foundation piers & substation yard trim (smooth 0.3m step-on slab)
    this._addSolidBox(tx, 0.15, tz, 17.5, 0.3, 17.5, this.mats.concrete, { surface: 'concrete' });
    const yardLight = new THREE.PointLight(0xffb14c, 22, 32, 1.5);
    yardLight.position.set(tx - 6.0, 6.0, tz + 6.5);
    this.scene.add(yardLight);
    this._registerLight(yardLight, 22, tx - 6.0, 6.0, tz + 6.5, 'street');

    // Tapered 4-Legged Lattice Truss Mast (InstancedMesh: alternating red & white sections every 35m!)
    const halfWidthAt = (y) => {
      if (y <= 175) {
        return THREE.MathUtils.lerp(7.2, 2.6, y / 175);
      }
      return THREE.MathUtils.lerp(2.6, 1.5, (y - 175) / 45);
    };

    const segStep = 7.0;
    for (let y = 0; y < 220; y += segStep) {
      const yNext = Math.min(220, y + segStep);
      const w0 = halfWidthAt(y);
      const w1 = halfWidthAt(yNext);
      const bandIdx = Math.floor(y / 35);
      const targetList = (bandIdx % 2 === 0) ? this._towerRedMatrices : this._towerWhiteMatrices;

      const c0 = [
        new THREE.Vector3(tx - w0, y, tz - w0),
        new THREE.Vector3(tx + w0, y, tz - w0),
        new THREE.Vector3(tx + w0, y, tz + w0),
        new THREE.Vector3(tx - w0, y, tz + w0)
      ];
      const c1 = [
        new THREE.Vector3(tx - w1, yNext, tz - w1),
        new THREE.Vector3(tx + w1, yNext, tz - w1),
        new THREE.Vector3(tx + w1, yNext, tz + w1),
        new THREE.Vector3(tx - w1, yNext, tz + w1)
      ];

      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        // Main corner leg
        this._pushStrut(targetList, c0[i], c1[i], y > 175 ? 0.14 : 0.22);
        // Horizontal perimeter strut
        this._pushStrut(targetList, c1[i], c1[j], 0.1);
        // Crisp X-bracing diagonals on every face
        this._pushStrut(targetList, c0[i], c1[j], 0.085);
        this._pushStrut(targetList, c0[j], c1[i], 0.085);
      }
    }

    // Top Antenna Spire & Broadcast Microwave Array (218m -> 228m)
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.36, 10.5, 12), this.mats.towerWhiteSteel);
    spire.position.set(tx, 223.2, tz);
    this.scene.add(spire);

    // Broadcast dipole crossbars on antenna spire
    for (const ay of [221, 223.5, 226]) {
      const dipole = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.14, 0.14), this.mats.galvanizedSteel);
      dipole.position.set(tx, ay, tz);
      this.scene.add(dipole);
    }

    // Walkable Grated Resting Platforms (split cleanly around central ladder hatch so climbing passes right through!)
    const addTowerDeck = (y, size, hatchZ) => {
      const half = size / 2;
      const hatchHalf = 0.95;
      // Split along Z around hatchZ into North slab, South slab, and flanking West/East strips
      const zMin = tz - half;
      const zMax = tz + half;
      const hz0 = hatchZ - hatchHalf;
      const hz1 = hatchZ + hatchHalf;

      if (hz0 > zMin + 0.2) {
        this._addSolidBox(tx, y - 0.2, (zMin + hz0) / 2, size, 0.4, hz0 - zMin, this.mats.galvanizedSteel, { surface: 'metal' });
      }
      if (zMax > hz1 + 0.2) {
        this._addSolidBox(tx, y - 0.2, (hz1 + zMax) / 2, size, 0.4, zMax - hz1, this.mats.galvanizedSteel, { surface: 'metal' });
      }
      // West & East deck panels beside the ladder hatch
      const sideW = (size - 2.0) / 2;
      if (sideW > 0.2) {
        this._addSolidBox(tx - 1.0 - sideW / 2, y - 0.2, hatchZ, sideW, 0.4, hatchHalf * 2, this.mats.galvanizedSteel, { surface: 'metal' });
        this._addSolidBox(tx + 1.0 + sideW / 2, y - 0.2, hatchZ, sideW, 0.4, hatchHalf * 2, this.mats.galvanizedSteel, { surface: 'metal' });
      }

      // Low perimeter safety guardrails (keep players from accidentally bumping off while resting!)
      const railH = 0.95;
      this._addSolidBox(tx, y + railH / 2, zMin + 0.08, size, railH, 0.12, this.mats.rustedIron);
      this._addSolidBox(tx, y + railH / 2, zMax - 0.08, size, railH, 0.12, this.mats.rustedIron);
      this._addSolidBox(tx - half + 0.08, y + railH / 2, tz, 0.12, railH, size, this.mats.rustedIron);
      this._addSolidBox(tx + half - 0.08, y + railH / 2, tz, 0.12, railH, size, this.mats.rustedIron);

      // Subtle glowing hazard marker at platform edge
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.16), this.mats.amberBeacon);
      lamp.position.set(tx, y + 1.15, zMax - 0.14);
      this.scene.add(lamp);
    };

    const stages = [
      { y0: 0.3, y1: 35, size: 11.2, ladderZ: tz + 1.8, dismountZ: tz - 0.6, normalZ: 1 },
      { y0: 35, y1: 70, size: 9.8, ladderZ: tz - 1.8, dismountZ: tz + 0.6, normalZ: -1 },
      { y0: 70, y1: 105, size: 8.6, ladderZ: tz + 1.6, dismountZ: tz - 0.6, normalZ: 1 },
      { y0: 105, y1: 140, size: 7.4, ladderZ: tz - 1.6, dismountZ: tz + 0.6, normalZ: -1 },
      { y0: 140, y1: 175, size: 6.4, ladderZ: tz + 1.4, dismountZ: tz - 0.6, normalZ: 1 },
      { y0: 175, y1: 205, size: 5.4, ladderZ: tz - 1.3, dismountZ: tz + 0.6, normalZ: -1 },
      { y0: 205, y1: 218, size: 5.2, ladderZ: tz + 1.2, dismountZ: tz - 0.7, normalZ: 1 }
    ];

    stages.forEach((s, idx) => {
      addTowerDeck(s.y1, s.size, s.ladderZ);
      this._addLadder({
        id: `tower_stage_${idx + 1}`,
        x: tx,
        z: s.ladderZ,
        yBottom: s.y0,
        yTop: s.y1,
        normalX: 0,
        normalZ: s.normalZ,
        dismountX: tx,
        dismountY: s.y1 + 0.05,
        dismountZ: s.dismountZ,
        hasCage: true,
        label: `Broadcast Mast Stage ${idx + 1} (${Math.round(s.y0)}m → ${s.y1}m)`
      });
    });

    // Flashing Red Aviation Obstruction Strobes along the 220m Broadcast Tower
    this._addStrobe(tx - 4.8, 71.2, tz + 4.8, { phase: 0.0, scale: 6.0 });
    this._addStrobe(tx + 4.8, 71.2, tz - 4.8, { phase: 0.0, scale: 6.0 });
    this._addStrobe(tx - 3.6, 141.2, tz + 3.6, { phase: 1.5, scale: 7.0 });
    this._addStrobe(tx + 3.6, 141.2, tz - 3.6, { phase: 1.5, scale: 7.0 });
    this._addStrobe(tx - 2.6, 206.2, tz + 2.6, { phase: 3.0, scale: 7.5 });
    this._addStrobe(tx, 228.6, tz, { phase: 0.5, addLight: true, scale: 12.0 });

    // 5 Ultra-High-Tier Broadcast Tower Loot Caches + Apex Master Core at 218m!
    this._addLootSpawn('tower_70', 'coaxial_copper', tx - 3.2, 70.45, tz + 2.8, 'Broadcast Tower 70m');
    this._addLootSpawn('tower_105', 'transmitter_relay', tx + 2.8, 105.45, tz - 2.6, 'Broadcast Tower 105m');
    this._addLootSpawn('tower_140', 'strobe_beacon', tx - 2.4, 140.45, tz + 2.2, 'Broadcast Tower 140m');
    this._addLootSpawn('tower_175', 'transmitter_relay', tx + 2.1, 175.45, tz - 2.0, 'Broadcast Tower 175m');
    this._addLootSpawn('tower_205', 'strobe_beacon', tx - 1.7, 205.45, tz + 1.5, 'Broadcast Tower 205m');
    this._addLootSpawn('tower_apex_core', 'master_broadcast_core', tx + 1.4, 218.55, tz - 1.4, 'Broadcast Summit 220m');
  }

  // ---------- 6. High-Altitude & Cross-Tower Zipline Network ----------

  _buildZiplines() {
    const hubLanding = new THREE.Vector3(6.0, 2.2, 5.0);

    const addZipline = (id, startVec, endVec, label, { landingY = 0.8, destLabel = 'Alley Hub' } = {}) => {
      // Visual anchor gantry post at launch point
      this._addSolidBox(startVec.x, startVec.y - 0.7, startVec.z, 0.28, 2.2, 0.28, this.mats.hazard, { collider: false });

      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), this.mats.greenBeacon);
      beacon.position.set(startVec.x, startVec.y + 0.55, startVec.z);
      this.scene.add(beacon);

      // Tensioned steel zipline cable mesh
      const dir = new THREE.Vector3().subVectors(endVec, startVec);
      const len = dir.length();
      const mid = new THREE.Vector3().addVectors(startVec, endVec).multiplyScalar(0.5);
      const cable = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.055, len, 8),
        this.mats.ziplineCable
      );
      cable.position.copy(mid);
      cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      this.scene.add(cable);

      this.ziplines.push({
        id,
        start: startVec.clone(),
        end: endVec.clone(),
        anchorPos: new THREE.Vector3(startVec.x, startVec.y - 0.6, startVec.z),
        landingY,
        destLabel,
        label
      });
    };

    // 1. 130m Skyscraper Summit Zipline -> Hub Alley Landing Pad
    addZipline(
      'zip_skyscraper',
      new THREE.Vector3(7.5, 131.6, -34.6),
      hubLanding,
      '130m Skyscraper Zipline → Alley Hub (0m)',
      { landingY: 0.8, destLabel: 'Alley Hub' }
    );

    // 2. 220m Broadcast Tower Summit Zipline -> Hub Alley Landing Pad
    addZipline(
      'zip_tower',
      new THREE.Vector3(41.9, 219.4, -44.0),
      hubLanding,
      '220m Broadcast Summit Zipline → Alley Hub (0m)',
      { landingY: 0.8, destLabel: 'Alley Hub' }
    );
  }

  // ---------- 7. Distant Glowing Night City Horizon ----------

  _buildDistantCitySkyline() {
    const count = 175;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const inst = new THREE.InstancedMesh(geo, this.mats.skylineTower, count);
    const dummy = new THREE.Object3D();

    let placed = 0;
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967295;
    };

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.06;
      const dist = 115 + rand() * 320;
      const bx = Math.cos(angle) * dist;
      const bz = Math.sin(angle) * dist - 20;
      const bw = 12 + rand() * 24;
      const bd = 12 + rand() * 24;
      const bh = 28 + Math.pow(rand(), 1.65) * 165;

      dummy.position.set(bx, bh / 2 - 2, bz);
      dummy.scale.set(bw, bh, bd);
      dummy.rotation.y = rand() * 0.4;
      dummy.updateMatrix();
      inst.setMatrixAt(placed++, dummy.matrix);

      // Occasional distant horizon red aviation strobe on tallest background towers
      if (bh > 135 && i % 4 === 0) {
        this._addStrobe(bx, bh + 1.2, bz, { phase: rand() * 6.28, scale: 8.5 });
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    this.scene.add(inst);

    // Distant dark city floor plane extending to horizon so looking down from 220m shows continuous urban dark sprawl
    const horizonFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1400),
      new THREE.MeshStandardMaterial({
        color: 0x070a10,
        roughness: 0.85,
        metalness: 0.15
      })
    );
    horizonFloor.rotation.x = -Math.PI / 2;
    horizonFloor.position.y = -0.75;
    this.scene.add(horizonFloor);
  }

  // ---------- Flush Instanced Structural Geometry & Build 2D Spatial Grid ----------

  _flushInstancedGeometry() {
    const buildInstanced = (geo, mat, matrices, castShadow = false, receiveShadow = true, parentGroup = this.scene) => {
      if (!matrices.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
      for (let i = 0; i < matrices.length; i++) {
        mesh.setMatrixAt(i, matrices[i]);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.frustumCulled = false;
      parentGroup.add(mesh);
    };

    const unitBox = new THREE.BoxGeometry(1, 1, 1);

    // 1. Flush all pooled _addSolidBox matrices by (material, castShadow, receiveShadow, parentGroup)
    for (const pool of this._boxPools.values()) {
      buildInstanced(unitBox, pool.material, pool.matrices, pool.castShadow, pool.receiveShadow, pool.parentGroup);
    }

    // 2. Flush glowing Carabiner Anchor Bolts & Tie-Off Rings
    buildInstanced(unitBox, this.mats.hazard, this._anchorBoltMatrices, false, false, this.scene);
    const anchorRingGeo = new THREE.TorusGeometry(0.14, 0.032, 8, 16);
    buildInstanced(anchorRingGeo, this.mats.greenBeacon, this._anchorRingMatrices, false, false, this.scene);

    // 3. Flush ladder rungs & safety cages
    buildInstanced(unitBox, this.mats.ladderRung, this._rungMatrices, false, true, this.scene);

    const hoopGeo = new THREE.TorusGeometry(0.46, 0.028, 6, 14, Math.PI * 1.25);
    hoopGeo.rotateX(Math.PI / 2);
    hoopGeo.rotateY(-Math.PI * 0.125);
    buildInstanced(hoopGeo, this.mats.ladderCage, this._cageMatrices, false, true, this.scene);

    // 4. Structural steel beams & broadcast lattice trusses
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
    buildInstanced(cylGeo, this.mats.structuralSteel, this._steelBeamMatrices, true, true, this.scene);
    buildInstanced(cylGeo, this.mats.towerRedSteel, this._towerRedMatrices, false, true, this.scene);
    buildInstanced(cylGeo, this.mats.towerWhiteSteel, this._towerWhiteMatrices, false, true, this.scene);
  }

  _buildSpatialGrid() {
    this.colliderGrid.clear();
    this.rampGrid.clear();
    const cs = this.gridCellSize;

    for (const box of this.colliders) {
      const gx0 = Math.floor(box.minX / cs);
      const gx1 = Math.floor(box.maxX / cs);
      const gz0 = Math.floor(box.minZ / cs);
      const gz1 = Math.floor(box.maxZ / cs);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gz = gz0; gz <= gz1; gz++) {
          const key = `${gx},${gz}`;
          let cell = this.colliderGrid.get(key);
          if (!cell) {
            cell = [];
            this.colliderGrid.set(key, cell);
          }
          cell.push(box);
        }
      }
    }

    for (const ramp of this.ramps) {
      const gx0 = Math.floor((ramp.minX - 0.5) / cs);
      const gx1 = Math.floor((ramp.maxX + 0.5) / cs);
      const gz0 = Math.floor((ramp.minZ - 0.5) / cs);
      const gz1 = Math.floor((ramp.maxZ + 0.5) / cs);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gz = gz0; gz <= gz1; gz++) {
          const key = `${gx},${gz}`;
          let cell = this.rampGrid.get(key);
          if (!cell) {
            cell = [];
            this.rampGrid.set(key, cell);
          }
          cell.push(ramp);
        }
      }
    }
  }

  getNearbyColliders(x, z) {
    const cs = this.gridCellSize;
    const gx = Math.floor(x / cs);
    const gz = Math.floor(z / cs);
    const cell = this.colliderGrid.get(`${gx},${gz}`);
    return cell || this.colliders;
  }

  getNearbyRamps(x, z) {
    const cs = this.gridCellSize;
    const gx = Math.floor(x / cs);
    const gz = Math.floor(z / cs);
    const cell = this.rampGrid.get(`${gx},${gz}`);
    return cell || [];
  }

  // ---------- Mute-First Visual Wind Streak Particles ----------

  _buildWindParticles() {
    const count = 180;
    const geo = new THREE.PlaneGeometry(1.6, 0.045);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xcce8ff,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.windStreaks = new THREE.InstancedMesh(geo, mat, count);
    this.windStreaks.frustumCulled = false;

    for (let i = 0; i < count; i++) {
      this.windStreakData.push({
        ox: (Math.random() - 0.5) * 32,
        oy: (Math.random() - 0.5) * 18,
        oz: (Math.random() - 0.5) * 32,
        speed: 0.7 + Math.random() * 0.8,
        len: 0.8 + Math.random() * 1.4
      });
    }
    this.scene.add(this.windStreaks);
  }

  getZoneName(pos) {
    if (this.crawlZones) {
      for (const cz of this.crawlZones) {
        if (pos.x >= cz.minX && pos.x <= cz.maxX && pos.y >= cz.minY && pos.y <= cz.maxY && pos.z >= cz.minZ && pos.z <= cz.maxZ) {
          return cz.label;
        }
      }
    }
    if (pos.y < -1.5) {
      if (pos.z > 36.2) {
        return pos.x > -6.2 ? 'BUNKER TECH VAULT WING B (-6m)' : 'BUNKER STORAGE CORRIDOR A (-6m)';
      }
      return 'FALLOUT SHELTER B-04 (-6m)';
    }
    if (pos.x > 26 && pos.z < -26) {
      if (pos.y > 200) return 'BROADCAST TOWER SUMMIT (220m)';
      if (pos.y > 100) return 'BROADCAST MAST — UPPER ZONE';
      return 'BROADCAST TOWER — LOWER MAST';
    }
    if (pos.x < -33 && pos.z < -48) {
      if (pos.y > 160) return 'TWIN-SPIRE COMMS SUMMIT (165m)';
      if (pos.y > 135) return 'TWIN-SPIRE 140m SKYBRIDGE';
      if (pos.y > 90 && pos.x > -39) return 'TWIN-SPIRE SUSPENDED GONDOLA (96m)';
      return 'TWIN-SPIRE COMMS SKYSCRAPER';
    }
    if (pos.x < -34 && pos.z > -35 && pos.z < -5) {
      if (pos.y > 106) return 'BRUTALIST TOWER SUMMIT (110m)';
      if (pos.y > 30) return 'BRUTALIST EXTERIOR SCAFFOLDING';
      return 'BRUTALIST CONCRETE TOWER';
    }
    if (pos.z < -30 && pos.x > -24 && pos.x < 24) {
      if (pos.y > 132) return 'SKYSCRAPER TOWER CRANE (136m)';
      if (pos.y > 75) return 'SKYSCRAPER — EXPOSED STEEL';
      return 'UNFINISHED SKYSCRAPER';
    }
    if (pos.y > 20) {
      if (pos.x < -31.8) return 'WEST TOWER SKYBRIDGE (24m)';
      if (pos.x < -13) return 'BLOCK A INDUSTRIAL ROOF (24m)';
      if (pos.x > 13) return 'BLOCK B OFFICE ROOF (28m)';
      return 'ROOFTOP PIPE BRIDGE (24m)';
    }
    return 'CENTRAL ALLEY HUB';
  }

  update(dt, elapsed, playerPos, windState) {
    // 0. Tiered Sector Group & PointLight Distance/Altitude Culling (Locks 60+ FPS above 120m!)
    const py = playerPos.y;
    // Underground Fallout Shelter & Bunker Wing meshes only visible when near/below ground or stairwell
    const showUnderground = py < 3.5;
    if (this.undergroundGroup.visible !== showUnderground) {
      this.undergroundGroup.visible = showUnderground;
    }
    // Street-level detail props & mid-rise rooftop small detail props cull when high above 98m
    const showStreetDetail = py < 98.0;
    if (this.streetDetailGroup.visible !== showStreetDetail) {
      this.streetDetailGroup.visible = showStreetDetail;
    }
    const showMidRiseDetail = py < 118.0;
    if (this.midRiseDetailGroup.visible !== showMidRiseDetail) {
      this.midRiseDetailGroup.visible = showMidRiseDetail;
    }

    // Distance & altitude cull managed PointLights
    for (const ml of this.managedLights) {
      if (ml.sector === 'underground') {
        ml.light.visible = showUnderground;
        continue;
      }
      const dist = Math.hypot(playerPos.x - ml.x, py - ml.y, playerPos.z - ml.z);
      ml.light.visible = py < 95.0 && dist < 85.0;
    }

    // 1. Pulse red aviation obstruction strobes
    for (const s of this.strobes) {
      const cycle = (elapsed * 1.35 + s.phase) % 2.4;
      const flash = cycle < 0.22 ? Math.sin((cycle / 0.22) * Math.PI) : 0.08;
      s.bulb.material.emissiveIntensity = 0.5 + flash * 5.2;
      s.sprite.material.opacity = 0.14 + flash * 0.85;
      const sc = s.baseScale * (0.65 + flash * 0.65);
      s.sprite.scale.set(sc, sc, 1);
      if (s.light) {
        s.light.intensity = 1.5 + flash * 24;
      }
    }

    // 2. Flicker cold fluorescent shelter lamps realistically (skip when underground group is culled)
    for (const f of this.flickerLights) {
      if (f.sector === 'underground' && !showUnderground) continue;
      if (!f.light.visible) continue;
      const wave = Math.sin(elapsed * f.speed + f.offset) * Math.sin(elapsed * f.speed * 2.7 + f.offset);
      const dip = wave > 0.78 ? 0.22 : (wave > 0.62 ? 0.65 : 1.0);
      f.light.intensity = f.baseIntensity * dip;
      f.mesh.material.emissiveIntensity = 0.6 + dip * 2.4;
    }

    // 3. Animate visual wind streaks around player at altitude > 30m (mute-first wind sensation!)
    if (this.windStreaks) {
      const altFactor = THREE.MathUtils.clamp((playerPos.y - 28) / 45, 0, 1);
      const gustBoost = windState.phase === 'gust' ? 2.6 : (windState.phase === 'warning' ? 1.55 : 0.75);
      const opacity = altFactor * (windState.phase === 'gust' ? 0.52 : (windState.phase === 'warning' ? 0.28 : 0.14));
      this.windStreaks.material.opacity = opacity;
      this.windStreaks.visible = opacity > 0.01;

      if (this.windStreaks.visible) {
        const dirX = windState.dirX || 1;
        const dirZ = windState.dirZ || 0;
        const speedBase = (14 + windState.speedKmh * 0.42) * gustBoost;
        const yaw = Math.atan2(-dirZ, dirX);
        const dummy = this._windDummy;

        for (let i = 0; i < this.windStreakData.length; i++) {
          const p = this.windStreakData[i];
          p.ox += dirX * speedBase * p.speed * dt;
          p.oz += dirZ * speedBase * p.speed * dt;
          if (p.ox > 16) p.ox -= 32;
          if (p.ox < -16) p.ox += 32;
          if (p.oz > 16) p.oz -= 32;
          if (p.oz < -16) p.oz += 32;

          dummy.position.set(playerPos.x + p.ox, playerPos.y + 1.2 + p.oy, playerPos.z + p.oz);
          dummy.rotation.set(0, yaw, 0);
          dummy.scale.set(p.len * (0.9 + gustBoost * 0.7), 1 + gustBoost * 0.35, 1);
          dummy.updateMatrix();
          this.windStreaks.setMatrixAt(i, dummy.matrix);
        }
        this.windStreaks.instanceMatrix.needsUpdate = true;
      }
    }
  }
}
