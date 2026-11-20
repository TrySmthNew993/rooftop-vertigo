import * as THREE from 'three';

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class ClimberSystem {
  constructor(world, audio) {
    this.world = world;
    this.audio = audio;

    // Climbing state
    this.activeLadder = null;
    this.climbY = 0;
    this.climbPhase = 0;
    this.isSliding = false;
    this.dismountCooldown = 0;
    this.facingYaw = 0;

    // Smooth auto-mantle animation at top of ladders
    this.mantling = false;
    this.mantleTimer = 0;
    this.mantleDuration = 0.24;
    this.mantleStart = new THREE.Vector3();
    this.mantleEnd = new THREE.Vector3();

    // Carabiner anchor state (works on ladders AND on high beams/roofs >= 14m)
    this.isAnchored = false;
    this.isClipping = false;
    this.clipTimer = 0;
    this.clipDuration = 1.1;

    // Zipline descent state
    this.activeZipline = null;
    this.zipProgress = 0;
    this.zipSpeed = 0;
    this.zipLength = 1;

    // High-altitude wind & gust simulation (>50m)
    this.wind = {
      phase: 'calm',      // 'calm' | 'warning' | 'gust'
      timer: 10.0,
      phaseDuration: 10.0,
      speedKmh: 8,
      dirX: 1,
      dirZ: 0,
      dirLabel: 'EAST →',
      forceVec: new THREE.Vector3()
    };
  }

  get isClimbing() {
    return this.activeLadder !== null;
  }

  get isZiplining() {
    return this.activeZipline !== null;
  }

  reset() {
    this.activeLadder = null;
    this.isSliding = false;
    this.mantling = false;
    this.isAnchored = false;
    this.isClipping = false;
    this.clipTimer = 0;
    this.activeZipline = null;
    this.dismountCooldown = 0.5;
    this.wind.phase = 'calm';
    this.wind.timer = 10.0;
    this.wind.speedKmh = 8;
    this.wind.forceVec.set(0, 0, 0);
  }

  // Triggered by pressing F
  toggleCarabiner(player, upgrades, onNotify) {
    if (this.mantling || this.isZiplining) return;

    if (this.isAnchored) {
      this.isAnchored = false;
      this.audio.playCarabinerClick(false);
      onNotify?.('Carabiner unclipped.', 'info');
      return;
    }

    if (this.isClipping) {
      // Cancel in-progress latch
      this.isClipping = false;
      this.clipTimer = 0;
      return;
    }

    // Can clip anytime on a ladder, OR when standing at height (>= 14m) within reach of a physical anchor bolt, guardrail, scaffolding pole, or steel beam
    const nearStructuralAnchor = this.world.hasNearbyAnchorPoint
      ? this.world.hasNearbyAnchorPoint(player.position)
      : true;
    const canClip = this.isClimbing || (player.onGround && player.position.y >= 14.0 && nearStructuralAnchor);
    if (!canClip) {
      if (player.onGround && player.position.y >= 14.0 && !nearStructuralAnchor) {
        onNotify?.('Move closer to a guardrail, scaffolding pole, I-beam, or Anchor Bolt to clip [F]!', 'warn');
      } else {
        onNotify?.('Attach carabiner while on a ladder or near structural steel/anchors (>14m).', 'warn');
      }
      return;
    }

    this.isClipping = true;
    this.clipTimer = 0;
    this.clipDuration = upgrades.quickCarabiner ? 0.30 : 1.10;
  }

  enterLadder(ladder, player, fromTop = false) {
    if (!ladder || this.isZiplining || this.mantling) return;
    this.activeLadder = ladder;
    this.isAnchored = false;
    this.isClipping = false;
    this.isSliding = false;

    if (fromTop) {
      this.climbY = Math.max(ladder.yBottom + 0.5, ladder.yTop - 0.9);
    } else {
      this.climbY = THREE.MathUtils.clamp(player.position.y, ladder.yBottom + 0.05, ladder.yTop - 0.35);
    }

    // Position player neatly in front of rungs along ladder normal
    const offset = 0.58;
    player.position.set(
      ladder.x + ladder.normalX * offset,
      this.climbY,
      ladder.z + ladder.normalZ * offset
    );
    player.velocity.set(0, 0, 0);
    player.onGround = false;
    player.peakFallY = this.climbY;

    // Face smoothly into the ladder rungs
    this.facingYaw = Math.atan2(ladder.normalX, ladder.normalZ);
    player.setYawSmooth(this.facingYaw);
  }

  dismountLadder(player, kickOff = true, gripFailed = false) {
    if (!this.activeLadder) return;
    const lad = this.activeLadder;
    this.activeLadder = null;
    this.isSliding = false;
    this.isAnchored = false;
    this.isClipping = false;
    this.clipTimer = 0;
    this.dismountCooldown = 0.45;
    player.clearYawSmooth();
    player.peakFallY = player.position.y;

    if (gripFailed) {
      // Push backwards off the ladder on grip failure!
      player.velocity.set(lad.normalX * 2.4, -1.5, lad.normalZ * 2.4);
    } else if (kickOff) {
      player.velocity.set(lad.normalX * 3.1, 3.6, lad.normalZ * 3.1);
    } else {
      player.velocity.set(0, 0, 0);
    }
  }

  startZipline(zip, player, onNotify) {
    if (this.isZiplining) return;
    this.activeLadder = null;
    this.isAnchored = false;
    this.isClipping = false;
    this.clipTimer = 0;
    this.mantling = false;
    player.clearYawSmooth();

    this.activeZipline = zip;
    this.zipProgress = 0;
    this.zipSpeed = 12.0;
    this.zipLength = zip.start.distanceTo(zip.end);
    player.velocity.set(0, 0, 0);
    player.onGround = false;
    this.audio.playCarabinerClick(true);
    onNotify?.(`Engaged ${zip.label}!`, 'good');
  }

  tryAutoGrabLadder(player, input) {
    if (this.isClimbing || this.isZiplining || this.mantling || this.dismountCooldown > 0) return false;

    for (const lad of this.world.ladders) {
      // Vertical overlap with ladder shaft (avoid grabbing when standing comfortably above top)
      if (player.position.y < lad.yBottom - 0.4 || player.position.y > lad.yTop - 0.35) continue;

      const grabX = lad.x + lad.normalX * 0.56;
      const grabZ = lad.z + lad.normalZ * 0.56;
      const dx = player.position.x - grabX;
      const dz = player.position.z - grabZ;
      const horizDist = Math.hypot(dx, dz);

      if (horizDist < 0.72) {
        // Require pressing forward (or airborne near rungs) so brushing past back of ladder doesn't hijack player
        if (input.forward || !player.onGround) {
          this.enterLadder(lad, player, false);
          return true;
        }
      }
    }
    return false;
  }

  _updateWind(dt, altitude, onNotify) {
    const w = this.wind;

    if (altitude < 48) {
      w.phase = 'calm';
      w.timer = 8.0;
      w.phaseDuration = 8.0;
      w.speedKmh = 8 + Math.max(0, altitude) * 0.25;
      w.forceVec.set(0, 0, 0);
      return;
    }

    // Scale base ambient wind & gust intensity with altitude (50m -> 220m)
    const altFrac = THREE.MathUtils.clamp((altitude - 50) / 170, 0, 1);
    const ambientKmh = 28 + altFrac * 30;

    w.timer -= dt;

    if (w.phase === 'calm') {
      w.speedKmh += (ambientKmh - w.speedKmh) * Math.min(1, dt * 2.5);
      w.forceVec.set(0, 0, 0);
      if (w.timer <= 0) {
        // Pick fresh horizontal gust direction
        const angle = Math.random() * Math.PI * 2;
        w.dirX = Math.cos(angle);
        w.dirZ = Math.sin(angle);
        const dirs = ['EAST →', 'SE ↘', 'SOUTH ↓', 'SW ↙', 'WEST ←', 'NW ↖', 'NORTH ↑', 'NE ↗'];
        const idx = Math.round(((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
        w.dirLabel = dirs[idx];

        w.phase = 'warning';
        w.phaseDuration = 2.6;
        w.timer = 2.6;
        this.audio.playGustWarning();
      }
    } else if (w.phase === 'warning') {
      const targetWarn = ambientKmh + 18 + altFrac * 14;
      w.speedKmh += (targetWarn - w.speedKmh) * Math.min(1, dt * 3.0);
      w.forceVec.set(0, 0, 0);
      if (w.timer <= 0) {
        w.phase = 'gust';
        w.phaseDuration = 3.8 + altFrac * 1.4;
        w.timer = w.phaseDuration;
      }
    } else if (w.phase === 'gust') {
      const peakKmh = 68 + altFrac * 38;
      w.speedKmh += (peakKmh - w.speedKmh) * Math.min(1, dt * 5.0);
      const strength = 3.2 + altFrac * 2.1;
      w.forceVec.set(w.dirX * strength, 0, w.dirZ * strength);

      if (w.timer <= 0) {
        w.phase = 'calm';
        w.phaseDuration = 12.5 - altFrac * 4.5 + Math.random() * 4.0;
        w.timer = w.phaseDuration;
      }
    }
  }

  update(dt, elapsed, player, input, upgrades, weightStaminaMult, onNotify) {
    if (this.dismountCooldown > 0) {
      this.dismountCooldown = Math.max(0, this.dismountCooldown - dt);
    }

    this._updateWind(dt, player.position.y, onNotify);

    // 1. Update carabiner latch progress if clipping in (abort immediately if player left ladder/ground!)
    if (this.isClipping) {
      const nearAnchor = this.world.hasNearbyAnchorPoint
        ? this.world.hasNearbyAnchorPoint(player.position)
        : true;
      const stillValidAnchor = this.isClimbing || (player.onGround && player.position.y >= 14.0 && nearAnchor);
      if (!stillValidAnchor || this.mantling || this.isZiplining) {
        this.isClipping = false;
        this.clipTimer = 0;
        onNotify?.('Carabiner latch interrupted — moved away from anchor/footing!', 'warn');
      } else {
        this.clipTimer += dt;
        if (this.clipTimer >= this.clipDuration) {
          this.isClipping = false;
          this.isAnchored = true;
          this.clipTimer = 0;
          this.audio.playCarabinerClick(true);
          onNotify?.('CARABINER ANCHORED — Safe from wind & recovering stamina.', 'good');
        }
      }
    }

    // 2. Zipline Descent Update (Supports Cross-Tower landings at zip.end.y & Mid-Air [Space] Dismount!)
    if (this.isZiplining) {
      const zip = this.activeZipline;

      // Allow mid-air dismount with [Space] after clearing the starting platform (zipProgress > 0.08)
      if (input.jumpPressed && this.zipProgress > 0.08) {
        const dir = new THREE.Vector3().subVectors(zip.end, zip.start).normalize();
        const dropSpeed = Math.min(11.0, this.zipSpeed * 0.42);
        this.activeZipline = null;
        player.velocity.set(dir.x * dropSpeed, -1.0, dir.z * dropSpeed);
        player.onGround = false;
        player.peakFallY = player.position.y;
        this.audio.playCarabinerClick(false);
        onNotify?.('Released zipline mid-air [SPACE]!', 'warn');
        return { handledMovement: false };
      }

      this.zipSpeed = Math.min(34.0, this.zipSpeed + 14.0 * dt);
      this.zipProgress += (this.zipSpeed / this.zipLength) * dt;
      const t = Math.min(1, this.zipProgress);

      // Slight catenary sag along cable for cinematic realism
      const sag = Math.sin(t * Math.PI) * Math.min(4.5, this.zipLength * 0.025);
      player.position.lerpVectors(zip.start, zip.end, t);
      player.position.y -= (1.55 + sag);
      player.peakFallY = player.position.y;
      player.velocity.set(0, 0, 0);

      // Gentle stamina recovery while riding cable
      player.stamina = Math.min(100, player.stamina + 14 * dt);

      if (t >= 1) {
        this.activeZipline = null;
        const landY = typeof zip.landingY === 'number'
          ? zip.landingY
          : Math.max(0.35, zip.end.y - 1.4);
        player.position.set(zip.end.x, landY, zip.end.z);
        player.velocity.set(0, 0, 0);
        player.peakFallY = landY;
        player.onGround = true;
        this.audio.playCarabinerClick(false);
        const destMsg = zip.destLabel || 'Alley Hub';
        onNotify?.(`Zipline traverse complete — landed safely on ${destMsg}!`, 'good');
      }
      return { handledMovement: true };
    }

    // 3. Smooth Auto-Mantle at Top of Ladder
    if (this.mantling) {
      this.mantleTimer += dt;
      const t = Math.min(1, this.mantleTimer / this.mantleDuration);
      const ease = t * (2 - t);
      player.position.lerpVectors(this.mantleStart, this.mantleEnd, ease);
      player.position.y += Math.sin(t * Math.PI) * 0.28; // natural step-up arc
      player.peakFallY = player.position.y;

      if (t >= 1) {
        this.mantling = false;
        player.position.copy(this.mantleEnd);
        player.velocity.set(0, 0, 0);
        player.onGround = true;
      }
      return { handledMovement: true };
    }

    // 4. Anchored while standing on elevated beam/roof (not on ladder)
    if (this.isAnchored && !this.isClimbing) {
      const regen = upgrades.quickCarabiner ? 44 : 26;
      player.stamina = Math.min(100, player.stamina + regen * dt);
      player.velocity.set(0, 0, 0);
      return { handledMovement: true };
    }

    // 5. Active Ladder Climbing Update
    if (this.isClimbing) {
      const lad = this.activeLadder;

      // Clamp horizontal mouselook to ~188° relative to facing the ladder rungs
      const currentYaw = player.getYaw();
      const relYaw = normalizeAngle(currentYaw - this.facingYaw);
      const maxYaw = Math.PI * 0.52;
      if (relYaw > maxYaw) player.setYaw(this.facingYaw + maxYaw);
      if (relYaw < -maxYaw) player.setYaw(this.facingYaw - maxYaw);

      // Anchored on ladder: lock movement, rapid stamina recovery, immune to gusts & falling!
      if (this.isAnchored) {
        this.isSliding = false;
        const regen = upgrades.quickCarabiner ? 46 : 28;
        player.stamina = Math.min(100, player.stamina + regen * dt);
        return { handledMovement: true };
      }

      // Space dismounts / kicks off the ladder
      if (input.jumpPressed) {
        this.dismountLadder(player, true, false);
        return { handledMovement: false };
      }

      // Compute grip drain multipliers (gloves + energy boost + weight)
      const gloveMult = upgrades.glovesTier >= 2 ? 0.48 : (upgrades.glovesTier === 1 ? 0.70 : 1.0);
      const boostMult = player.adrenalineTimer > 0 ? 0.35 : 1.0;
      const climbMult = weightStaminaMult * gloveMult * boostMult;

      let moveY = 0;
      this.isSliding = false;

      if (input.sprint && !input.forward) {
        // Fast slide down ladder!
        moveY = -11.5;
        this.isSliding = true;
        player.stamina -= 4.2 * climbMult * dt;
      } else if (input.forward) {
        moveY = 4.0;
        this.climbPhase += dt * 9.5;
        player.stamina -= 6.8 * climbMult * dt;
      } else if (input.backward) {
        moveY = -4.3;
        this.climbPhase -= dt * 9.5;
        player.stamina -= 3.2 * climbMult * dt;
      } else {
        // Hanging idle on rungs still slowly taxes grip
        player.stamina -= 1.8 * climbMult * dt;
      }

      // High-altitude active wind gust massively drains unclipped grip!
      if (this.wind.phase === 'gust' && player.position.y >= 48) {
        const altScale = 1 + THREE.MathUtils.clamp((player.position.y - 50) / 170, 0, 1) * 0.55;
        const windGloveResist = upgrades.glovesTier >= 2 ? 0.65 : 1.0;
        player.stamina -= 25.0 * altScale * windGloveResist * boostMult * dt;
      }

      this.climbY += moveY * dt;

      // Top of ladder: smooth auto-mantle onto roof/platform!
      if (this.climbY >= lad.yTop - 0.12 && input.forward) {
        this.mantling = true;
        this.mantleTimer = 0;
        this.mantleStart.copy(player.position);
        this.mantleEnd.set(lad.dismountX, lad.dismountY, lad.dismountZ);
        this.activeLadder = null;
        this.isSliding = false;
        this.isClipping = false;
        this.clipTimer = 0;
        this.dismountCooldown = 0.45;
        player.clearYawSmooth();
        return { handledMovement: true };
      }

      // Bottom of ladder: clean step-off onto deck/ground
      if (this.climbY <= lad.yBottom + 0.05 && moveY < 0) {
        this.climbY = lad.yBottom + 0.05;
        player.position.set(
          lad.x + lad.normalX * 0.85,
          lad.yBottom + 0.06,
          lad.z + lad.normalZ * 0.85
        );
        this.dismountLadder(player, false, false);
        player.onGround = true;
        return { handledMovement: false };
      }

      this.climbY = THREE.MathUtils.clamp(this.climbY, lad.yBottom + 0.05, lad.yTop - 0.08);
      const offset = 0.58;
      // Subtle lateral rung-climb sway
      const rightX = Math.cos(this.facingYaw);
      const rightZ = -Math.sin(this.facingYaw);
      const sway = this.isSliding ? 0 : Math.sin(this.climbPhase) * 0.045;

      player.position.set(
        lad.x + lad.normalX * offset + rightX * sway,
        this.climbY,
        lad.z + lad.normalZ * offset + rightZ * sway
      );
      player.peakFallY = this.climbY;

      // Grip Failure at 0 Stamina!
      if (player.stamina <= 0) {
        player.stamina = 0;
        this.audio.playDanger();
        onNotify?.('GRIP FAILED! You lost hold of the ladder!', 'danger');
        this.dismountLadder(player, false, true);
        return { handledMovement: false };
      }

      return { handledMovement: true };
    }

    return { handledMovement: false };
  }
}
