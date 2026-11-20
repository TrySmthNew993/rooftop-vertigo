import * as THREE from 'three';

export const LOOT_CATALOG = {
  titanium_fasteners: {
    key: 'titanium_fasteners',
    name: 'Titanium Fasteners',
    weight: 1.8,
    value: 140,
    tier: 'LOW-MID',
    color: 0x99d6ff
  },
  coaxial_copper: {
    key: 'coaxial_copper',
    name: 'Coaxial Copper Cables',
    weight: 3.2,
    value: 240,
    tier: 'MID',
    color: 0xff9f45
  },
  military_capacitor: {
    key: 'military_capacitor',
    name: 'Military Pulse Capacitor',
    weight: 3.6,
    value: 340,
    tier: 'MID-HIGH',
    color: 0x62ff8e
  },
  transmitter_relay: {
    key: 'transmitter_relay',
    name: 'High-Gain Transmitter Relay',
    weight: 4.4,
    value: 420,
    tier: 'HIGH',
    color: 0x38e4ff
  },
  emergency_tech_kit: {
    key: 'emergency_tech_kit',
    name: 'Emergency Bunker Tech Kit',
    weight: 2.8,
    value: 480,
    tier: 'HIGH',
    color: 0xff7b29
  },
  strobe_beacon: {
    key: 'strobe_beacon',
    name: 'Aviation Strobe Beacon',
    weight: 4.0,
    value: 560,
    tier: 'HIGH',
    color: 0xff4558
  },
  seismic_gyro_stabilizer: {
    key: 'seismic_gyro_stabilizer',
    name: 'Seismic Gyro Stabilizer (110m Apex)',
    weight: 4.8,
    value: 1250,
    tier: 'SUB-APEX',
    color: 0x3cd6ff,
    isSubApex: true
  },
  quantum_microwave_transceiver: {
    key: 'quantum_microwave_transceiver',
    name: 'Quantum Microwave Transceiver (165m Apex)',
    weight: 5.4,
    value: 2100,
    tier: 'SUB-APEX',
    color: 0xc470ff,
    isSubApex: true
  },
  master_broadcast_core: {
    key: 'master_broadcast_core',
    name: 'Master Broadcast Core (220m Apex)',
    weight: 6.0,
    value: 3500,
    tier: 'APEX',
    color: 0xffc83d,
    isApex: true
  }
};

export const SHOP_CATALOG = [
  {
    id: 'energy_shot',
    name: 'Energy Injection',
    cost: 140,
    consumable: true,
    maxStock: 5,
    desc: 'Press [Q] anytime (+65% instant stamina + 8s reduced drain). Max 5 carried.'
  },
  {
    id: 'gloves_1',
    name: 'Climbing Chalk & Grip Gloves',
    cost: 300,
    desc: 'Cuts climbing stamina drain by 30% and steadies wet metal grip.'
  },
  {
    id: 'wide_headlamp',
    name: 'Wide-Beam Tactical Headlamp',
    cost: 350,
    desc: 'Expands headlamp cone & throws beam 76m across skyscraper steel.'
  },
  {
    id: 'quick_carabiner',
    name: 'Quick-Lock Carabiner',
    cost: 480,
    desc: 'Cuts anchor latch time from 1.1s to 0.3s and boosts anchored recovery +65%.'
  },
  {
    id: 'pack_frame',
    name: 'Carbon Harness Pack Frame',
    cost: 550,
    desc: 'Expands carry limit from 22kg to 34kg & softens weight stamina drag.'
  },
  {
    id: 'gloves_2',
    name: 'Pro Mag-Chalk Gloves Mk.II',
    cost: 750,
    requires: 'gloves_1',
    desc: 'Cuts climbing drain by 52% total and reduces wind-gust grip fatigue.'
  }
];

export class InteractionSystem {
  constructor(scene, world, materials) {
    this.scene = scene;
    this.world = world;
    this.mats = materials.mats;

    // Economy & inventory state
    this.credits = 0;
    this.nightNumber = 1;
    this.inventory = []; // [{ uid, key, name, weight, value, isApex }]
    this.uidCounter = 1;

    // Upgrades & consumables (persist across deaths!)
    this.upgrades = {
      glovesTier: 0,       // 0, 1, 2
      quickCarabiner: false,
      wideHeadlamp: false,
      packFrame: false
    };
    this.energyShots = 1; // Start with 1 emergency Energy Injection!

    // Lifetime stats
    this.stats = {
      totalEarned: 0,
      itemsExtracted: 0,
      fallsSurvived: 0,
      fatalFalls: 0,
      apexSold: false
    };

    // Active 3D loot cache nodes
    this.lootNodes = [];
    this._spawnAllLootNodes();
  }

  _buildLootMesh(def) {
    const group = new THREE.Group();
    if (def.key === 'coaxial_copper') {
      // Heavy copper cable drum spool
      const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.36, 16), this.mats.copperCoil);
      spool.rotation.z = Math.PI / 2;
      group.add(spool);
      const flangeGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.04, 16);
      for (const sx of [-0.19, 0.19]) {
        const fl = new THREE.Mesh(flangeGeo, this.mats.structuralSteel);
        fl.rotation.z = Math.PI / 2;
        fl.position.x = sx;
        group.add(fl);
      }
    } else if (def.key === 'titanium_fasteners') {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.32, 0.4), this.mats.titaniumCase);
      group.add(crate);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.08, 0.42), this.mats.hazard);
      group.add(band);
    } else if (def.key === 'transmitter_relay') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.46, 0.36), this.mats.relayUnit);
      group.add(body);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.55, 8), this.mats.galvanizedSteel);
      ant.position.set(0.16, 0.42, 0);
      group.add(ant);
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.38), this.mats.fluorescentBulb);
      led.position.y = 0.08;
      group.add(led);
    } else if (def.key === 'strobe_beacon') {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.22, 14), this.mats.structuralSteel);
      group.add(base);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), this.mats.strobeRed);
      dome.position.y = 0.22;
      group.add(dome);
    } else if (def.key === 'military_capacitor') {
      const bank = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.22, 0.36), this.mats.milCapacitor || this.mats.structuralSteel);
      bank.position.y = -0.06;
      group.add(bank);
      for (const cx of [-0.14, 0.14]) {
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.38, 14), this.mats.galvanizedSteel);
        cyl.position.set(cx, 0.14, 0);
        group.add(cyl);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 12), this.mats.greenBeacon);
        cap.position.set(cx, 0.35, 0);
        group.add(cap);
      }
    } else if (def.key === 'emergency_tech_kit') {
      const caseBody = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.32, 0.42), this.mats.techKit || this.mats.hazard);
      group.add(caseBody);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.07, 0.44), this.mats.amberBeacon);
      stripe.position.y = 0.04;
      group.add(stripe);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.08), this.mats.galvanizedSteel);
      handle.position.set(0, 0.19, 0.16);
      group.add(handle);
    } else if (def.key === 'seismic_gyro_stabilizer') {
      const sphere = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 1), this.mats.gyroCore || this.mats.relayUnit);
      sphere.position.y = 0.28;
      group.add(sphere);
      const gimbal1 = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 8, 22), this.mats.galvanizedSteel);
      gimbal1.position.y = 0.28;
      gimbal1.rotation.x = Math.PI / 4;
      group.add(gimbal1);
      const gimbal2 = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.03, 8, 22), this.mats.hazard);
      gimbal2.position.y = 0.28;
      gimbal2.rotation.y = Math.PI / 3;
      group.add(gimbal2);
    } else if (def.key === 'quantum_microwave_transceiver') {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.24, 0.48), this.mats.structuralSteel);
      base.position.y = -0.02;
      group.add(base);
      const dish = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.28, 16, 1, true), this.mats.quantumDish || this.mats.apexCore);
      dish.position.y = 0.26;
      dish.rotation.x = Math.PI;
      group.add(dish);
      const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 10), this.mats.greenBeacon);
      feed.position.y = 0.36;
      group.add(feed);
    } else {
      // Master Broadcast Core (220m Apex Trophy!)
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 1), this.mats.apexCore);
      core.position.y = 0.35;
      group.add(core);
      const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.04, 10, 24), this.mats.galvanizedSteel);
      ring1.position.y = 0.35;
      group.add(ring1);
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.16, 16), this.mats.hazard);
      ped.position.y = -0.1;
      group.add(ped);
    }

    // Subtle glowing salvage beacon ring underneath so caches pop cleanly at night
    const ringMat = new THREE.MeshBasicMaterial({
      color: def.color,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide
    });
    const beaconRing = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.56, 20), ringMat);
    beaconRing.rotation.x = -Math.PI / 2;
    beaconRing.position.y = -0.22;
    group.add(beaconRing);

    return { group, beaconRing };
  }

  _spawnAllLootNodes() {
    // Clear existing meshes first
    for (const node of this.lootNodes) {
      if (node.mesh) this.scene.remove(node.mesh);
    }
    this.lootNodes = [];

    for (const sp of this.world.lootSpawns) {
      const def = LOOT_CATALOG[sp.itemKey];
      if (!def) continue;
      const { group, beaconRing } = this._buildLootMesh(def);
      group.position.copy(sp.position);
      this.scene.add(group);

      this.lootNodes.push({
        id: sp.id,
        def,
        zoneName: sp.zoneName,
        position: sp.position.clone(),
        mesh: group,
        beaconRing,
        collected: false
      });
    }
  }

  advanceNight() {
    this.nightNumber += 1;
    this._spawnAllLootNodes();
  }

  getMaxWeight() {
    return this.upgrades.packFrame ? 34.0 : 22.0;
  }

  getCurrentWeight() {
    return this.inventory.reduce((sum, item) => sum + item.weight, 0);
  }

  getHaulValue() {
    return this.inventory.reduce((sum, item) => sum + item.value, 0);
  }

  getWeightStaminaMultiplier() {
    const w = this.getCurrentWeight();
    const maxW = this.getMaxWeight();
    const ratio = Math.min(1.25, w / maxW);
    const maxExtra = this.upgrades.packFrame ? 0.55 : 0.85;
    return 1.0 + ratio * maxExtra;
  }

  getCollectedStats() {
    const collected = this.lootNodes.filter((n) => n.collected).length;
    return { collected, total: this.lootNodes.length };
  }

  canLoot(def) {
    return this.getCurrentWeight() + def.weight <= this.getMaxWeight() + 0.01;
  }

  collectLootNode(node) {
    if (!node || node.collected) return { ok: false, reason: 'Already collected.' };
    if (!this.canLoot(node.def)) {
      return {
        ok: false,
        reason: `Pack too heavy! (${this.getCurrentWeight().toFixed(1)}/${this.getMaxWeight().toFixed(0)} kg). Sell or drop items [Tab].`
      };
    }

    node.collected = true;
    node.mesh.visible = false;
    this.inventory.push({
      uid: this.uidCounter++,
      key: node.def.key,
      name: node.def.name,
      weight: node.def.weight,
      value: node.def.value,
      isApex: !!node.def.isApex
    });
    return { ok: true, item: node.def };
  }

  dropInventoryItem(uid) {
    const idx = this.inventory.findIndex((i) => i.uid === uid);
    if (idx === -1) return null;
    const [removed] = this.inventory.splice(idx, 1);
    return removed;
  }

  dropUnbankedLoot() {
    const lostValue = this.getHaulValue();
    const lostCount = this.inventory.length;
    this.inventory = [];
    return { lostValue, lostCount };
  }

  sellItem(uid) {
    const idx = this.inventory.findIndex((i) => i.uid === uid);
    if (idx === -1) return null;
    const [item] = this.inventory.splice(idx, 1);
    this.credits += item.value;
    this.stats.totalEarned += item.value;
    this.stats.itemsExtracted += 1;
    let soldApexNow = false;
    if (item.isApex && !this.stats.apexSold) {
      this.stats.apexSold = true;
      soldApexNow = true;
    }
    return { item, soldApexNow };
  }

  sellAll() {
    if (!this.inventory.length) return { count: 0, value: 0, soldApexNow: false };
    let value = 0;
    let soldApexNow = false;
    const count = this.inventory.length;
    for (const item of this.inventory) {
      value += item.value;
      if (item.isApex && !this.stats.apexSold) {
        this.stats.apexSold = true;
        soldApexNow = true;
      }
    }
    this.inventory = [];
    this.credits += value;
    this.stats.totalEarned += value;
    this.stats.itemsExtracted += count;
    return { count, value, soldApexNow };
  }

  isShopItemOwned(itemId) {
    if (itemId === 'gloves_1') return this.upgrades.glovesTier >= 1;
    if (itemId === 'gloves_2') return this.upgrades.glovesTier >= 2;
    if (itemId === 'quick_carabiner') return this.upgrades.quickCarabiner;
    if (itemId === 'wide_headlamp') return this.upgrades.wideHeadlamp;
    if (itemId === 'pack_frame') return this.upgrades.packFrame;
    return false;
  }

  buyShopItem(itemId) {
    const item = SHOP_CATALOG.find((s) => s.id === itemId);
    if (!item) return { ok: false, reason: 'Unknown item.' };
    if (item.requires && !this.isShopItemOwned(item.requires)) {
      return { ok: false, reason: 'Requires previous upgrade tier first.' };
    }
    if (!item.consumable && this.isShopItemOwned(itemId)) {
      return { ok: false, reason: 'Already installed.' };
    }
    if (item.consumable && this.energyShots >= item.maxStock) {
      return { ok: false, reason: `Energy Injection pouch full (${item.maxStock}/${item.maxStock}).` };
    }
    if (this.credits < item.cost) {
      return { ok: false, reason: `Need $${item.cost - this.credits} more credits.` };
    }

    this.credits -= item.cost;
    if (itemId === 'energy_shot') this.energyShots += 1;
    if (itemId === 'gloves_1') this.upgrades.glovesTier = Math.max(1, this.upgrades.glovesTier);
    if (itemId === 'gloves_2') this.upgrades.glovesTier = 2;
    if (itemId === 'quick_carabiner') this.upgrades.quickCarabiner = true;
    if (itemId === 'wide_headlamp') this.upgrades.wideHeadlamp = true;
    if (itemId === 'pack_frame') this.upgrades.packFrame = true;

    return { ok: true, item };
  }

  findFocusedTarget(camera, playerPos, isClimbing) {
    if (isClimbing) return null;

    const camForward = new THREE.Vector3();
    camera.getWorldDirection(camForward);
    const eyePos = camera.position;

    let best = null;
    let bestScore = Infinity;

    const consider = (type, ref, pos, maxDist, key, title, subtitle) => {
      const toObj = new THREE.Vector3().subVectors(pos, eyePos);
      const dist = toObj.length();
      if (dist > maxDist) return;
      const dot = toObj.normalize().dot(camForward);
      if (dot < 0.35 && dist > 1.75) return; // Must roughly face target unless standing right on top of it
      const score = dist - dot * 1.4;
      if (score < bestScore) {
        bestScore = score;
        best = { type, ref, key, title, subtitle, dist };
      }
    };

    // 1. Loot caches
    for (const node of this.lootNodes) {
      if (node.collected) continue;
      consider(
        'loot',
        node,
        node.position,
        3.5,
        'E',
        `SALVAGE: ${node.def.name}`,
        `${node.def.weight.toFixed(1)} kg • Value $${node.def.value.toLocaleString()}`
      );
    }

    // 2. Trader Kiosk
    for (const st of this.world.interactables) {
      consider(st.type, st, st.position, st.radius, 'E', st.title, st.subtitle);
    }

    // 3. Summit Descent Ziplines
    for (const zip of this.world.ziplines) {
      consider(
        'zipline',
        zip,
        zip.anchorPos,
        3.9,
        'E',
        'RIDE DESCENT ZIPLINE',
        zip.label
      );
    }

    // 4. Air Vent & Crawl Tube Entrances / Exits
    if (this.world.ventGrates) {
      for (const grate of this.world.ventGrates) {
        consider(
          'vent_grate',
          grate,
          grate.promptPos,
          grate.radius || 2.8,
          'E',
          grate.title || 'Enter Air Vent / Crawl',
          grate.subtitle || 'Narrow Ventilation Duct (0.8m Crawl State)'
        );
      }
    }

    // 5. Ladder Top/Bottom explicit grab helper (especially smooth for climbing DOWN from roofs!)
    for (const lad of this.world.ladders) {
      const topPos = new THREE.Vector3(lad.x, lad.yTop + 0.3, lad.z);
      const botPos = new THREE.Vector3(lad.x, lad.yBottom + 1.1, lad.z);
      if (Math.abs(playerPos.y - lad.yTop) < 1.8) {
        consider('ladder_top', lad, topPos, 2.8, 'E', 'DESCEND LADDER', lad.label);
      } else if (Math.abs(playerPos.y - lad.yBottom) < 1.8) {
        consider('ladder_bot', lad, botPos, 2.5, 'E', 'CLIMB LADDER', lad.label);
      }
    }

    return best;
  }

  update(dt, elapsed) {
    // Gentle hover/spin on Apex & Sub-Apex Trophies + pulsing beacon rings on all uncollected loot
    const pulse = 0.55 + Math.sin(elapsed * 3.8) * 0.3;
    for (const node of this.lootNodes) {
      if (node.collected) continue;
      node.beaconRing.material.opacity = pulse;
      if (node.def.isApex || node.def.isSubApex) {
        node.mesh.rotation.y += dt * 0.85;
        node.mesh.position.y = node.position.y + Math.sin(elapsed * 2.4) * 0.14;
      }
    }
  }
}
