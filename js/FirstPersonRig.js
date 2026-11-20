import * as THREE from 'three';

export class FirstPersonRig {
  constructor(camera) {
    this.camera = camera;
    this.root = new THREE.Group();
    this.camera.add(this.root);

    this.headlampOn = true;
    this.headlampUpgraded = false;
    this.glovesTier = 0;

    this.injectTimer = 0;
    this._climbSwing = 0;

    this._buildHeadlamp();
    this._buildHandsAndGear();
  }

  _buildHeadlamp() {
    this.headlamp = new THREE.SpotLight(0xdff2ff, 11, 44, 0.44, 0.52, 1.65);
    this.headlamp.position.set(0, 0.12, -0.05);
    this.headlampTarget = new THREE.Object3D();
    this.headlampTarget.position.set(0, -0.04, -10);
    this.camera.add(this.headlamp);
    this.camera.add(this.headlampTarget);
    this.headlamp.target = this.headlampTarget;
  }

  _buildHandsAndGear() {
    this.sleeveMat = new THREE.MeshStandardMaterial({
      color: 0x1a2029,
      roughness: 0.82,
      metalness: 0.08
    });
    this.gloveMat = new THREE.MeshStandardMaterial({
      color: 0x262c35,
      roughness: 0.72,
      metalness: 0.18
    });
    this.knuckleMat = new THREE.MeshStandardMaterial({
      color: 0x3b4452,
      roughness: 0.48,
      metalness: 0.55
    });
    this.carabinerMat = new THREE.MeshStandardMaterial({
      color: 0xff8c24,
      roughness: 0.25,
      metalness: 0.88,
      emissive: 0x331600,
      emissiveIntensity: 0.35
    });
    this.lanyardMat = new THREE.MeshStandardMaterial({
      color: 0x27b5e0,
      roughness: 0.65,
      metalness: 0.15
    });

    const buildArm = (side) => {
      const arm = new THREE.Group();
      // Forearm
      const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.046, 0.32, 10), this.sleeveMat);
      forearm.rotation.x = Math.PI / 2;
      forearm.position.set(0, 0, 0.14);
      arm.add(forearm);

      // Wrist strap
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.035, 10), this.knuckleMat);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.set(0, 0, -0.01);
      arm.add(cuff);

      // Gloved palm
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.042, 0.095), this.gloveMat);
      palm.position.set(0, 0, -0.068);
      arm.add(palm);

      // Knuckle guard
      const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.076, 0.018, 0.028), this.knuckleMat);
      knuckle.position.set(0, 0.022, -0.095);
      arm.add(knuckle);

      // Curled gripping fingers
      const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.038, 0.042), this.gloveMat);
      fingers.position.set(0, -0.016, -0.125);
      fingers.rotation.x = 0.55;
      arm.add(fingers);

      // Thumb
      const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.024, 0.052), this.gloveMat);
      thumb.position.set(-side * 0.045, -0.005, -0.088);
      thumb.rotation.y = side * 0.35;
      arm.add(thumb);

      return arm;
    };

    this.leftArm = buildArm(-1);
    this.rightArm = buildArm(1);
    this.root.add(this.leftArm);
    this.root.add(this.rightArm);

    // 3D Carabiner & Safety Tether Group
    this.carabinerGroup = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.0085, 8, 18), this.carabinerMat);
    ring.scale.set(0.76, 1.25, 1);
    this.carabinerGroup.add(ring);

    const gate = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.068, 8), this.knuckleMat);
    gate.position.set(0.031, 0, 0);
    this.carabinerGroup.add(gate);

    const tether = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.42, 8), this.lanyardMat);
    tether.position.set(0, -0.24, 0.05);
    tether.rotation.x = 0.28;
    this.carabinerGroup.add(tether);

    this.carabinerGroup.visible = false;
    this.root.add(this.carabinerGroup);

    // 3D Energy Injection Syringe
    this.syringeGroup = new THREE.Group();
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.14, 10),
      new THREE.MeshStandardMaterial({
        color: 0x38e4ff,
        emissive: 0x22d8ff,
        emissiveIntensity: 2.2,
        roughness: 0.15,
        metalness: 0.4
      })
    );
    barrel.rotation.x = Math.PI / 2;
    this.syringeGroup.add(barrel);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 10), this.knuckleMat);
    cap.rotation.x = Math.PI / 2;
    cap.position.z = 0.075;
    this.syringeGroup.add(cap);

    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.007, 0.045, 8), this.knuckleMat);
    tip.rotation.x = Math.PI / 2;
    tip.position.z = -0.09;
    this.syringeGroup.add(tip);

    this.syringeGroup.visible = false;
    this.root.add(this.syringeGroup);
  }

  setHeadlamp(on) {
    this.headlampOn = !!on;
    this.headlamp.visible = this.headlampOn;
  }

  toggleHeadlamp() {
    this.setHeadlamp(!this.headlampOn);
    return this.headlampOn;
  }

  applyUpgrades({ glovesTier, quickCarabiner, wideHeadlamp }) {
    this.glovesTier = glovesTier;
    // Visual cue on gloves: white chalk dusting on palm/fingers when upgraded!
    if (glovesTier >= 2) {
      this.gloveMat.color.setHex(0x8893a0);
      this.knuckleMat.color.setHex(0xff9a32);
    } else if (glovesTier === 1) {
      this.gloveMat.color.setHex(0x56606e);
      this.knuckleMat.color.setHex(0x52b8e0);
    }

    // Quick-Lock Carabiner gets sleek cyan-titanium anodized finish
    if (quickCarabiner) {
      this.carabinerMat.color.setHex(0x38e4ff);
      this.carabinerMat.emissive.setHex(0x0b3a4a);
    }

    this.headlampUpgraded = !!wideHeadlamp;
    if (this.headlampUpgraded) {
      this.headlamp.angle = 0.72;
      this.headlamp.distance = 76;
      this.headlamp.intensity = 19;
      this.headlamp.penumbra = 0.6;
    } else {
      this.headlamp.angle = 0.44;
      this.headlamp.distance = 44;
      this.headlamp.intensity = 11;
      this.headlamp.penumbra = 0.52;
    }
  }

  triggerInjectAnim() {
    this.injectTimer = 0.95;
  }

  update(dt, elapsed, state) {
    // state: { mode: 'walk'|'climb'|'zipline', moveSpeed, isSprinting, climbPhase, isSliding, isAnchored, isClipping, clipProgress, staminaPct }
    if (this.injectTimer > 0) {
      this.injectTimer = Math.max(0, this.injectTimer - dt);
    }

    // Smooth target poses for left & right arms
    let lx = -0.26, ly = -0.34, lz = -0.22, lrx = 0.12, lrz = 0.1;
    let rx = 0.26, ry = -0.34, rz = -0.22, rrx = 0.12, rrz = -0.1;

    if (state.mode === 'climb') {
      if (state.isAnchored) {
        // Resting hands slightly relaxed while clipped into safety anchor
        lx = -0.22; ly = -0.28; lz = -0.26; lrx = 0.25;
        rx = 0.22; ry = -0.28; rz = -0.26; rrx = 0.25;
      } else if (state.isSliding) {
        // Both hands locked firmly on outer rails with high-frequency friction shake
        const vib = Math.sin(elapsed * 55) * 0.008;
        lx = -0.28 + vib; ly = -0.06; lz = -0.34; lrx = 0.55; lrz = -0.22;
        rx = 0.28 - vib; ry = -0.06; rz = -0.34; rrx = 0.55; rrz = 0.22;
      } else {
        // Alternating left/right hand rung-gripping cycle!
        const sL = Math.sin(state.climbPhase);
        const sR = Math.sin(state.climbPhase + Math.PI);
        lx = -0.21;
        ly = -0.09 + sL * 0.11;
        lz = -0.35 + Math.max(0, sL) * 0.04;
        lrx = 0.65 + sL * 0.18;

        rx = 0.21;
        ry = -0.09 + sR * 0.11;
        rz = -0.35 + Math.max(0, sR) * 0.04;
        rrx = 0.65 + sR * 0.18;
      }
    } else if (state.mode === 'zipline') {
      // Overhead grip holding the zipline pulley bar
      const jolt = Math.sin(elapsed * 32) * 0.009;
      lx = -0.14; ly = 0.16 + jolt; lz = -0.32; lrx = 1.05;
      rx = 0.14; ry = 0.16 - jolt; rz = -0.32; rrx = 1.05;
    } else {
      // Ground walking / sprinting / idle breathing bob (gloved hands subtly visible in lower corners!)
      const stride = state.moveSpeed > 0.4 ? Math.sin(elapsed * (state.isSprinting ? 11.5 : 7.5)) : 0;
      const breath = Math.sin(elapsed * (state.staminaPct < 35 ? 6.5 : 2.1)) * (state.staminaPct < 35 ? 0.014 : 0.006);
      const runLift = state.isSprinting && state.moveSpeed > 0.5 ? 0.045 : 0;
      lx = -0.23;
      ly = -0.21 + runLift + breath + stride * 0.025;
      lz = -0.27 - Math.abs(stride) * 0.02;
      lrx = 0.24 + stride * 0.12;

      rx = 0.23;
      ry = -0.21 + runLift + breath - stride * 0.025;
      rz = -0.27 - Math.abs(stride) * 0.02;
      rrx = 0.24 - stride * 0.12;
    }

    // Low-grip tremble when climbing under 30% stamina
    if (state.mode === 'climb' && !state.isAnchored && state.staminaPct < 30) {
      const shake = (1 - state.staminaPct / 30) * 0.014;
      lx += (Math.random() - 0.5) * shake;
      ly += (Math.random() - 0.5) * shake;
      rx += (Math.random() - 0.5) * shake;
      ry += (Math.random() - 0.5) * shake;
    }

    // Override right arm during carabiner clip-in animation
    if (state.isClipping) {
      const p = state.clipProgress;
      rx = THREE.MathUtils.lerp(0.24, 0.06, Math.sin(p * Math.PI));
      ry = THREE.MathUtils.lerp(-0.24, -0.05, p);
      rz = THREE.MathUtils.lerp(-0.26, -0.40, p);
      rrx = 0.45;
    }

    // Override left arm during Energy Injection animation
    if (this.injectTimer > 0) {
      const t = 1 - this.injectTimer / 0.95;
      const lift = Math.sin(t * Math.PI);
      lx = -0.14;
      ly = -0.28 + lift * 0.22;
      lz = -0.34;
      lrx = 0.4;
      this.syringeGroup.visible = true;
      this.syringeGroup.position.set(lx + 0.04, ly + 0.02, lz - 0.06);
      this.syringeGroup.rotation.set(0.35, -0.4, 0.2);
    } else {
      this.syringeGroup.visible = false;
    }

    const lerpAmt = Math.min(1, dt * 14);
    this.leftArm.position.x += (lx - this.leftArm.position.x) * lerpAmt;
    this.leftArm.position.y += (ly - this.leftArm.position.y) * lerpAmt;
    this.leftArm.position.z += (lz - this.leftArm.position.z) * lerpAmt;
    this.leftArm.rotation.x += (lrx - this.leftArm.rotation.x) * lerpAmt;
    this.leftArm.rotation.z += (lrz - this.leftArm.rotation.z) * lerpAmt;

    this.rightArm.position.x += (rx - this.rightArm.position.x) * lerpAmt;
    this.rightArm.position.y += (ry - this.rightArm.position.y) * lerpAmt;
    this.rightArm.position.z += (rz - this.rightArm.position.z) * lerpAmt;
    this.rightArm.rotation.x += (rrx - this.rightArm.rotation.x) * lerpAmt;
    this.rightArm.rotation.z += (rrz - this.rightArm.rotation.z) * lerpAmt;

    // 3D Carabiner visibility & snapped placement
    if (state.isClipping || state.isAnchored) {
      this.carabinerGroup.visible = true;
      if (state.isAnchored) {
        this.carabinerGroup.position.set(0.0, -0.15, -0.38);
        this.carabinerGroup.rotation.set(0.18, 0.0, 0.0);
      } else {
        const p = state.clipProgress;
        this.carabinerGroup.position.set(
          THREE.MathUtils.lerp(0.18, 0.0, p),
          THREE.MathUtils.lerp(-0.28, -0.14, p),
          THREE.MathUtils.lerp(-0.25, -0.38, p)
        );
        this.carabinerGroup.rotation.set(0.18, (1 - p) * 0.9, (1 - p) * 0.5);
      }
    } else {
      this.carabinerGroup.visible = false;
    }
  }
}
