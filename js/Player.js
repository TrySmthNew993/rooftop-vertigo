import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

export class PlayerController {
  constructor(camera, domElement, world) {
    this.camera = camera;
    this.world = world;
    this.controls = new PointerLockControls(camera, domElement);

    // Spawn in Central Alley Hub facing North (-Z) toward Skyscraper & Broadcast Tower
    this.spawnPos = new THREE.Vector3(0, 0.05, 9.5);
    this.position = this.spawnPos.clone(); // Feet position
    this.velocity = new THREE.Vector3();

    this.radius = 0.38;
    this.standHeight = 1.72;
    this.standEyeHeight = 1.60;
    this.crawlHeight = 0.85;
    this.crawlEyeHeight = 0.78;
    this.height = this.standHeight;
    this.eyeHeight = this.standEyeHeight;
    this.isCrawling = false;
    this.inVentZone = false;

    this.onGround = true;
    this.peakFallY = this.position.y;
    this.stamina = 100;
    this.adrenalineTimer = 0;

    // Visual camera fx state
    this.bobPhase = 0;
    this.baseFov = 74;
    this.currentFov = 74;
    this.vertigoSetting = 'full'; // 'full' | 'reduced' | 'off'
    this.vertigoIntensity = 0;
    this.impactFlash = 0;
    this.moveSpeed = 0;
    this.isSprinting = false;

    // Input flags
    this.input = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false,
      jumpPressed: false
    };

    // Yaw smooth target (used briefly when latching onto a ladder)
    this._targetYaw = null;
    this._yawLerpTimer = 0;

    this.respawnAtHub();
  }

  setSensitivity(val) {
    this.controls.pointerSpeed = THREE.MathUtils.clamp(val, 0.3, 2.5);
  }

  setVertigoMode(mode) {
    this.vertigoSetting = mode;
  }

  getYaw() {
    return this.camera.rotation.y;
  }

  setYaw(y) {
    this.camera.rotation.y = y;
  }

  setYawSmooth(y) {
    this._targetYaw = y;
    this._yawLerpTimer = 0.25;
  }

  clearYawSmooth() {
    this._targetYaw = null;
    this._yawLerpTimer = 0;
  }

  respawnAtHub() {
    this.position.copy(this.spawnPos);
    this.velocity.set(0, 0, 0);
    this.onGround = true;
    this.peakFallY = this.position.y;
    this.stamina = 100;
    this.adrenalineTimer = 0;
    this.isCrawling = false;
    this.inVentZone = false;
    this.height = this.standHeight;
    this.eyeHeight = this.standEyeHeight;
    this.clearYawSmooth();
    this.camera.rotation.set(0.06, 0, 0, 'YXZ');
    this.camera.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
  }

  enterVentGrate(grate, onNotify) {
    if (!grate || !grate.targetPos) return;
    this.position.copy(grate.targetPos);
    this.velocity.set(0, 0, 0);
    this.onGround = true;
    this.peakFallY = this.position.y;

    if (grate.enterCrawl) {
      this.isCrawling = true;
      this.inVentZone = true;
      this.height = this.crawlHeight;
      this.eyeHeight = this.crawlEyeHeight;
    } else {
      this.isCrawling = false;
      this.inVentZone = false;
    }

    if (typeof grate.targetYaw === 'number') {
      this.camera.rotation.set(0, grate.targetYaw, 0, 'YXZ');
      this.clearYawSmooth();
    }
    this.camera.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
    if (grate.toastMsg && onNotify) {
      onNotify(grate.toastMsg, 'info');
    }
  }

  _hasStandingHeadroom() {
    const r = Math.max(0.2, this.radius - 0.04);
    const footY = this.position.y;
    const headTop = footY + this.standHeight;
    const nearby = this.world.getNearbyColliders
      ? this.world.getNearbyColliders(this.position.x, this.position.z)
      : this.world.colliders;
    for (const box of nearby) {
      if (box.type === 'safetynet') continue;
      if (this.position.x + r <= box.minX || this.position.x - r >= box.maxX) continue;
      if (this.position.z + r <= box.minZ || this.position.z - r >= box.maxZ) continue;
      if (box.minY >= footY + this.crawlHeight - 0.05 && box.minY < headTop) {
        return false;
      }
    }
    return true;
  }

  _isInCrawlZone() {
    if (!this.world.crawlZones) return false;
    const px = this.position.x;
    const py = this.position.y;
    const pz = this.position.z;
    for (const z of this.world.crawlZones) {
      if (px >= z.minX && px <= z.maxX && py >= z.minY && py <= z.maxY && pz >= z.minZ && pz <= z.maxZ) {
        return true;
      }
    }
    return false;
  }

  useAdrenaline() {
    this.stamina = Math.min(100, this.stamina + 65);
    this.adrenalineTimer = 8.0;
  }

  _getRampHeight(x, z, footY) {
    let bestY = null;
    const ramps = this.world.getNearbyRamps
      ? this.world.getNearbyRamps(x, z)
      : this.world.ramps;
    for (const r of ramps) {
      if (x >= r.minX - 0.15 && x <= r.maxX + 0.15 && z >= r.minZ - 0.15 && z <= r.maxZ + 0.15) {
        const t = r.axis === 'z'
          ? THREE.MathUtils.clamp((z - r.minZ) / (r.maxZ - r.minZ), 0, 1)
          : THREE.MathUtils.clamp((x - r.minX) / (r.maxX - r.minX), 0, 1);
        const ry = THREE.MathUtils.lerp(r.yAtMin, r.yAtMax, t);
        // Only snap onto ramp if feet are near or slightly above ramp height (so you can walk underneath fire escape stairs!)
        if (footY >= ry - 1.0 && footY <= ry + 0.85) {
          if (bestY === null || ry > bestY) bestY = ry;
        }
      }
    }
    return bestY;
  }

  _resolveCollisions(dt, callbacks) {
    const r = this.radius;
    const h = this.height;
    let landedSurface = null;
    let caughtByNet = false;

    const colliders = this.world.getNearbyColliders
      ? this.world.getNearbyColliders(this.position.x, this.position.z)
      : this.world.colliders;

    // 1. Apply horizontal movement & resolve X/Z wall collisions
    this.position.x += this.velocity.x * dt;
    for (const box of colliders) {
      if (box.type === 'safetynet') continue;
      if (this.position.y + 0.35 >= box.maxY || this.position.y + h <= box.minY) continue;
      if (this.position.z + r <= box.minZ || this.position.z - r >= box.maxZ) continue;
      if (this.position.x + r > box.minX && this.position.x - r < box.maxX) {
        if (this.velocity.x > 0) {
          this.position.x = box.minX - r;
        } else if (this.velocity.x < 0) {
          this.position.x = box.maxX + r;
        }
        this.velocity.x = 0;
      }
    }

    this.position.z += this.velocity.z * dt;
    for (const box of colliders) {
      if (box.type === 'safetynet') continue;
      if (this.position.y + 0.35 >= box.maxY || this.position.y + h <= box.minY) continue;
      if (this.position.x + r <= box.minX || this.position.x - r >= box.maxX) continue;
      if (this.position.z + r > box.minZ && this.position.z - r < box.maxZ) {
        if (this.velocity.z > 0) {
          this.position.z = box.minZ - r;
        } else if (this.velocity.z < 0) {
          this.position.z = box.maxZ + r;
        }
        this.velocity.z = 0;
      }
    }

    // 2. Apply vertical movement & check floors, ceilings, and safety nets
    const prevY = this.position.y;
    this.position.y += this.velocity.y * dt;
    this.onGround = false;

    // Check sloped ramps first (shelter ramp, fire escape stairs & brutalist scaffolding ramps)
    const rampY = this._getRampHeight(this.position.x, this.position.z, prevY);
    if (rampY !== null && this.position.y <= rampY + 0.12 && this.velocity.y <= 0.5) {
      this.position.y = rampY;
      this.velocity.y = 0;
      this.onGround = true;
      landedSurface = 'ramp';
    }

    // Check AABB floors, ceilings, and suspended skyscraper safety nets
    for (const box of colliders) {
      if (this.position.x + r <= box.minX || this.position.x - r >= box.maxX) continue;
      if (this.position.z + r <= box.minZ || this.position.z - r >= box.maxZ) continue;

      // Safety net catch!
      if (box.type === 'safetynet') {
        if (this.velocity.y <= 0 && prevY >= box.minY - 0.5 && this.position.y <= box.maxY + 0.1) {
          const drop = this.peakFallY - box.maxY;
          this.position.y = box.maxY + 0.04;
          if (drop > 4.0) {
            this.velocity.y = 4.2; // Gentle cushioned safety-net spring bounce!
            caughtByNet = true;
          } else {
            this.velocity.y = 0;
            this.onGround = true;
          }
          this.peakFallY = this.position.y;
        }
        continue;
      }

      // Solid floor landing (with swept previous-foot check so fast falling never tunnels!)
      if (this.velocity.y <= 0 && prevY >= box.maxY - 0.45 && this.position.y <= box.maxY) {
        this.position.y = box.maxY;
        this.velocity.y = 0;
        this.onGround = true;
        landedSurface = box.surface;
      } else if (this.velocity.y > 0 && prevY + h <= box.minY + 0.25 && this.position.y + h > box.minY) {
        // Ceiling bump
        this.position.y = box.minY - h;
        this.velocity.y = 0;
      }
    }

    // Keep within outer world bounds safely
    this.position.x = THREE.MathUtils.clamp(this.position.x, -88, 88);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -108, 68);

    // Evaluate landing impact / safety net catch
    if (caughtByNet) {
      callbacks.onSafetyNetCatch?.();
    } else if (this.onGround) {
      const fallDist = this.peakFallY - this.position.y;
      if (fallDist > 10.5 && landedSurface !== 'net') {
        this.impactFlash = 1.0;
        callbacks.onFatalFall?.(fallDist);
        return true;
      } else if (fallDist > 5.5) {
        this.impactFlash = 0.65;
        this.stamina = Math.max(0, this.stamina - 22);
        callbacks.onHardLanding?.(fallDist);
      }
      this.peakFallY = this.position.y;
    } else {
      if (this.position.y > this.peakFallY) {
        this.peakFallY = this.position.y;
      }
      // Emergency void safeguard
      if (this.position.y < -25) {
        callbacks.onFatalFall?.(40);
        return true;
      }
    }
    return false;
  }

  _syncCameraPosition(dt, elapsed, climber, vertigoMult) {
    if (!climber) return;

    // Smoothly turn yaw toward ladder briefly when entering climb state (bounded by timeout so it never fights mouselook)
    if (this._targetYaw !== null) {
      this._yawLerpTimer -= dt;
      let diff = this._targetYaw - this.camera.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < 0.02 || this._yawLerpTimer <= 0) {
        if (Math.abs(diff) < 0.02) this.camera.rotation.y = this._targetYaw;
        this.clearYawSmooth();
      } else {
        this.camera.rotation.y += diff * Math.min(1, dt * 12);
      }
    }

    // Compute camera head-bob, ladder sway, high-altitude tower flex & vertigo FOV
    let bobY = 0;
    let bobX = 0;
    let targetRoll = 0;

    if (climber.isClimbing && !climber.isAnchored) {
      if (climber.isSliding) {
        bobX = (Math.random() - 0.5) * 0.018;
        bobY = (Math.random() - 0.5) * 0.018;
      } else {
        bobY = Math.abs(Math.sin(climber.climbPhase)) * 0.032;
        targetRoll = Math.sin(climber.climbPhase) * 0.022;
      }
    } else if (!climber.isZiplining && this.onGround && this.moveSpeed > 0.35) {
      const freq = this.isCrawling ? 6.2 : (this.isSprinting ? 11.8 : 7.8);
      const amp = this.isCrawling ? 0.022 : (this.isSprinting ? 0.068 : 0.034);
      this.bobPhase += dt * freq;
      bobY = Math.sin(this.bobPhase) * amp;
      bobX = Math.cos(this.bobPhase * 0.5) * amp * 0.45;
      targetRoll = Math.cos(this.bobPhase * 0.5) * (this.isSprinting ? 0.014 : 0.006);
    }

    // High-altitude vertigo & tower flex camera sensation!
    const alt = Math.max(0, this.position.y);
    const altFactor = THREE.MathUtils.clamp((alt - 18) / 140, 0, 1);
    // Downward pitch check (camera.rotation.x < 0 means looking down)
    const lookDown = THREE.MathUtils.clamp((-this.camera.rotation.x - 0.35) / 1.05, 0, 1);
    const gustShake = climber.wind.phase === 'gust' && alt >= 48 ? (climber.isAnchored ? 0.35 : 1.0) : 0;

    // Combined vertigo intensity for FOV shift & screen edge vignette
    this.vertigoIntensity = THREE.MathUtils.clamp(
      altFactor * (0.28 + lookDown * 0.78) + gustShake * 0.32,
      0,
      1
    );

    const swayScale = vertigoMult * altFactor;
    const towerFlexX = Math.sin(elapsed * 0.85) * 0.045 * swayScale + Math.sin(elapsed * 19.0) * 0.025 * gustShake * vertigoMult;
    const towerFlexRoll = Math.sin(elapsed * 0.72) * 0.022 * swayScale + Math.sin(elapsed * 14.0) * 0.03 * gustShake * vertigoMult;

    targetRoll += towerFlexRoll;
    if (climber.isZiplining) {
      targetRoll += Math.sin(elapsed * 12) * 0.015;
    }

    // Dynamic FOV shift (widens smoothly when looking down from extreme height or sliding/ziplining)
    let targetFov = this.baseFov;
    if (climber.isZiplining) {
      targetFov = 86;
    } else if (this.isSprinting && this.moveSpeed > 2.0) {
      targetFov = 78.5;
    }
    targetFov += this.vertigoIntensity * 9.5 * vertigoMult;

    this.currentFov += (targetFov - this.currentFov) * Math.min(1, dt * 6.0);
    if (Math.abs(this.camera.fov - this.currentFov) > 0.05) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    this.camera.rotation.z += (targetRoll - this.camera.rotation.z) * Math.min(1, dt * 10);
    this.camera.position.set(
      this.position.x + bobX + towerFlexX,
      this.position.y + this.eyeHeight + bobY,
      this.position.z
    );
  }

  update(dt, elapsed, climber, upgrades, weightStaminaMult, callbacks) {
    if (this.adrenalineTimer > 0) {
      this.adrenalineTimer = Math.max(0, this.adrenalineTimer - dt);
    }
    if (this.impactFlash > 0) {
      this.impactFlash = Math.max(0, this.impactFlash - dt * 2.2);
    }

    const vertigoMult = this.vertigoSetting === 'full' ? 1.0 : (this.vertigoSetting === 'reduced' ? 0.35 : 0.0);

    // Let Climber handle ladder / mantle / zipline / anchored modes first
    const climbResult = climber.update(
      dt,
      elapsed,
      this,
      this.input,
      upgrades,
      weightStaminaMult,
      callbacks.onNotify
    );

    if (!climbResult.handledMovement) {
      // Update crawl / air-vent posture & smooth eye-height transition
      this.inVentZone = this._isInCrawlZone();
      if (this.inVentZone) {
        this.isCrawling = true;
      } else if (this.isCrawling && this._hasStandingHeadroom()) {
        this.isCrawling = false;
      }
      this.height = this.isCrawling ? this.crawlHeight : this.standHeight;
      const targetEye = this.isCrawling ? this.crawlEyeHeight : this.standEyeHeight;
      this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 11.0);

      // Standard First-Person Ground & Air Movement
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() > 0.0001) forward.normalize();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

      const moveDir = new THREE.Vector3();
      if (this.input.forward) moveDir.add(forward);
      if (this.input.backward) moveDir.sub(forward);
      if (this.input.right) moveDir.add(right);
      if (this.input.left) moveDir.sub(right);
      if (moveDir.lengthSq() > 0) moveDir.normalize();

      const wantsSprint = !this.isCrawling && this.input.sprint && this.input.forward && this.stamina > 2 && this.onGround;
      this.isSprinting = wantsSprint;
      const baseSpeed = this.isCrawling ? 2.45 : (wantsSprint ? 7.6 : 4.7);
      // Heavy bags slightly trim top walk speed for tactile weight feel
      const speedMult = 1.0 / (1.0 + (weightStaminaMult - 1.0) * 0.22);
      const targetSpeed = baseSpeed * speedMult;

      const accel = this.onGround ? 14.0 : 4.2;
      const targetVx = moveDir.x * targetSpeed;
      const targetVz = moveDir.z * targetSpeed;

      this.velocity.x += (targetVx - this.velocity.x) * Math.min(1, dt * accel);
      this.velocity.z += (targetVz - this.velocity.z) * Math.min(1, dt * accel);

      // Lateral high-altitude wind gust force when standing/walking unclipped above 48m!
      if (climber.wind.phase === 'gust' && !climber.isAnchored && this.position.y >= 48) {
        this.velocity.x += climber.wind.forceVec.x * dt;
        this.velocity.z += climber.wind.forceVec.z * dt;
      }

      // Jump (disabled while crawling inside low air vents)
      if (this.input.jumpPressed && this.onGround && !this.isCrawling) {
        this.velocity.y = 7.2;
        this.onGround = false;
        this.stamina = Math.max(0, this.stamina - 6.0 * weightStaminaMult);
      }

      // Gravity
      this.velocity.y -= 21.5 * dt;
      this.velocity.y = Math.max(-44.0, this.velocity.y);

      // Dynamic Adaptive Sub-Stepping (<= 0.22m displacement per sub-step, capped at 8 steps) so thin 0.3m scaffolding planks & safety nets NEVER tunnel at 165m-220m!
      const disp = Math.hypot(this.velocity.x * dt, this.velocity.y * dt, this.velocity.z * dt);
      const subSteps = Math.min(8, Math.max(1, Math.ceil(disp / 0.22)));
      const subDt = dt / subSteps;
      let diedThisFrame = false;
      for (let s = 0; s < subSteps; s++) {
        if (this._resolveCollisions(subDt, callbacks)) {
          diedThisFrame = true;
          break;
        }
      }

      if (!diedThisFrame) {
        // Stamina drain / recovery on ground
        const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
        this.moveSpeed = horizSpeed;
        const boostMult = this.adrenalineTimer > 0 ? 0.35 : 1.0;

        if (wantsSprint && horizSpeed > 1.5) {
          this.stamina = Math.max(0, this.stamina - 15.5 * weightStaminaMult * boostMult * dt);
        } else if (this.onGround) {
          const regen = horizSpeed < 0.8 ? 22.0 : 12.0;
          this.stamina = Math.min(100, this.stamina + regen * dt);
        }

        // Seamless ladder auto-grab check
        climber.tryAutoGrabLadder(this, this.input);
      }
    } else {
      this.moveSpeed = 0;
      this.isSprinting = false;
    }

    // Consume single-frame jump press flag
    this.input.jumpPressed = false;

    this._syncCameraPosition(dt, elapsed, climber, vertigoMult);
  }
}
