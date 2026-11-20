import * as THREE from 'three';
import { GameRenderer } from './Renderer.js';
import { MaterialLibrary } from './Materials.js';
import { World } from './World.js';
import { PlayerController } from './Player.js';
import { ClimberSystem } from './Climber.js';
import { FirstPersonRig } from './FirstPersonRig.js';
import { InteractionSystem } from './Interaction.js';
import { AlertAudio } from './Audio.js';
import { UIManager } from './UI.js';

class RooftopVertigoGame {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.ui = new UIManager();
    this.audio = new AlertAudio();

    this.gameRenderer = new GameRenderer(this.container);
    this.materials = new MaterialLibrary(this.gameRenderer.getMaxAnisotropy());
    this.world = new World(this.gameRenderer.scene, this.materials);
    this.player = new PlayerController(this.gameRenderer.camera, this.gameRenderer.renderer.domElement, this.world);
    this.climber = new ClimberSystem(this.world, this.audio);
    this.rig = new FirstPersonRig(this.gameRenderer.camera);
    this.interaction = new InteractionSystem(this.gameRenderer.scene, this.world, this.materials);

    // Ensure camera (holding FirstPersonRig & Headlamp) is added to scene!
    this.gameRenderer.scene.add(this.gameRenderer.camera);

    // App state
    this.started = false;
    this.activeModal = 'start'; // 'start' | 'inventory' | 'trader' | 'pause' | 'victory' | null
    this.focusedTarget = null;
    this.clock = new THREE.Clock();
    this.elapsed = 0;

    // FPS smoother
    this._fpsFrames = 0;
    this._fpsAccum = 0;
    this.currentFps = 60;

    this._bindEvents();
    this._syncSettings();
    this.ui.setReady();

    // Start render loop (renders atmospheric live alley background behind title card!)
    this._animate();
  }

  _syncSettings() {
    this.ui.syncSettingsUI({
      quality: this.gameRenderer.quality,
      vertigo: this.player.vertigoSetting,
      muted: this.audio.muted
    });
  }

  _clearInputs() {
    const inp = this.player.input;
    inp.forward = false;
    inp.backward = false;
    inp.left = false;
    inp.right = false;
    inp.sprint = false;
    inp.jumpPressed = false;
  }

  openModal(name) {
    this.activeModal = name;
    this._clearInputs();
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    this.ui.showStartScreen(name === 'start');
    this.ui.showHUD(this.started && name !== 'start');
    this.ui.showModal(name);

    if (name === 'inventory') {
      this._refreshInventoryUI();
    } else if (name === 'trader') {
      this._refreshTraderUI();
    }
  }

  resumeGameplay() {
    const firstStart = !this.started;
    this.started = true;
    this.activeModal = null;
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    if (firstStart) {
      this.player.respawnAtHub();
    }
    this.ui.showStartScreen(false);
    this.ui.showModal(null);
    this.ui.showHUD(true);
    try {
      this.player.controls.lock();
    } catch (_) {
      // Browser may decline rapid re-lock; clicking canvas re-locks cleanly
    }
  }

  _refreshInventoryUI() {
    this.ui.renderInventory(this.interaction, (uid) => {
      const dropped = this.interaction.dropInventoryItem(uid);
      if (dropped) {
        this.ui.notify(`Dropped ${dropped.name} (-${dropped.weight.toFixed(1)} kg).`, 'warn');
        this._refreshInventoryUI();
      }
    });
  }

  _refreshTraderUI() {
    this.ui.renderTrader(this.interaction, {
      onSellItem: (uid) => {
        const res = this.interaction.sellItem(uid);
        if (!res) return;
        this.audio.playTrade();
        this.ui.setTraderFeedback(`Sold ${res.item.name} for +$${res.item.value.toLocaleString()}.`);
        this._refreshTraderUI();
        if (res.soldApexNow) {
          this.activeModal = 'victory';
          this.ui.showVictory(this.interaction);
        }
      },
      onSellAll: () => {
        const res = this.interaction.sellAll();
        if (!res.count) return;
        this.audio.playTrade();
        this.ui.setTraderFeedback(`Sold ${res.count} items for +$${res.value.toLocaleString()}!`);
        this._refreshTraderUI();
        if (res.soldApexNow) {
          this.activeModal = 'victory';
          this.ui.showVictory(this.interaction);
        }
      },
      onBuyItem: (itemId) => {
        const res = this.interaction.buyShopItem(itemId);
        if (!res.ok) {
          this.ui.setTraderFeedback(res.reason);
          return;
        }
        this.audio.playTrade();
        this.rig.applyUpgrades(this.interaction.upgrades);
        this.ui.setTraderFeedback(`Purchased ${res.item.name}!`);
        this._refreshTraderUI();
      },
      onNextNight: () => {
        this.interaction.advanceNight();
        const totalCaches = this.interaction.getCollectedStats().total;
        this.audio.playTrade();
        this.ui.setTraderFeedback(`Night ${this.interaction.nightNumber} begun — all ${totalCaches} salvage caches restocked!`);
        this.ui.notify(`NIGHT ${this.interaction.nightNumber}: All ${totalCaches} vertical & bunker salvage caches restocked!`, 'good');
        this._refreshTraderUI();
      }
    });
  }

  _handleInteract() {
    if (!this.focusedTarget) return;
    const t = this.focusedTarget;

    if (t.type === 'loot') {
      const res = this.interaction.collectLootNode(t.ref);
      if (res.ok) {
        this.audio.playLoot();
        this.ui.notify(
          `+${res.item.name} (${res.item.weight.toFixed(1)}kg • $${res.item.value.toLocaleString()})`,
          res.item.isApex ? 'good' : 'info'
        );
        if (res.item.isApex) {
          this.ui.notify('APEX CORE ACQUIRED! Ride the 220m Summit Zipline back to Scrap Buyer!', 'good');
        }
      } else {
        this.audio.playDanger();
        this.ui.notify(res.reason, 'warn');
      }
    } else if (t.type === 'trader') {
      this.openModal('trader');
    } else if (t.type === 'zipline') {
      this.climber.startZipline(t.ref, this.player, (msg, kind) => this.ui.notify(msg, kind));
    } else if (t.type === 'ladder_top') {
      this.climber.enterLadder(t.ref, this.player, true);
    } else if (t.type === 'ladder_bot') {
      this.climber.enterLadder(t.ref, this.player, false);
    } else if (t.type === 'vent_grate') {
      this.climber.reset();
      this.player.enterVentGrate(t.ref, (msg, kind) => this.ui.notify(msg, kind));
    }
  }

  _handleUseEnergyShot() {
    if (this.interaction.energyShots <= 0) {
      this.ui.notify('No Energy Injections left! Buy more at the Scrap Buyer ($140).', 'warn');
      return;
    }
    this.interaction.energyShots -= 1;
    this.player.useAdrenaline();
    this.rig.triggerInjectAnim();
    this.audio.playInject();
    this.ui.notify('ENERGY INJECTION — +65% Stamina & 8s Adrenaline Grip!', 'good');
  }

  _handleFatalFall(dropDist) {
    this.interaction.stats.fatalFalls += 1;
    const { lostValue, lostCount } = this.interaction.dropUnbankedLoot();
    this.climber.reset();
    this.player.respawnAtHub();
    this.audio.playDanger();

    if (lostCount > 0) {
      this.ui.notify(
        `FATAL FALL (${dropDist.toFixed(0)}m)! Dropped ${lostCount} unbanked items ($${lostValue.toLocaleString()}). Credits & upgrades kept.`,
        'danger'
      );
    } else {
      this.ui.notify(
        `FATAL FALL (${dropDist.toFixed(0)}m)! Respawned in Alley Hub. Credits & gear intact.`,
        'danger'
      );
    }
  }

  _bindEvents() {
    const el = this.ui.el;

    // Start screen buttons
    el.btnPlay.addEventListener('click', () => this.resumeGameplay());

    const toggleQuality = () => {
      const next = this.gameRenderer.quality === 'high' ? 'medium' : 'high';
      this.gameRenderer.setQuality(next);
      this._syncSettings();
    };
    el.btnStartQuality.addEventListener('click', toggleQuality);
    el.btnSetQuality.addEventListener('click', toggleQuality);

    const toggleAudio = () => {
      this.audio.toggleMute();
      this._syncSettings();
    };
    el.btnStartAudio.addEventListener('click', toggleAudio);
    el.btnSetAudio.addEventListener('click', toggleAudio);

    el.btnSetVertigo.addEventListener('click', () => {
      const order = ['full', 'reduced', 'off'];
      const next = order[(order.indexOf(this.player.vertigoSetting) + 1) % order.length];
      this.player.setVertigoMode(next);
      this._syncSettings();
    });

    el.inputSens.addEventListener('input', (e) => {
      this.player.setSensitivity(parseFloat(e.target.value));
    });

    // Modal close / resume buttons
    el.btnCloseInv.addEventListener('click', () => this.resumeGameplay());
    el.btnCloseTrader.addEventListener('click', () => this.resumeGameplay());
    el.btnResume.addEventListener('click', () => this.resumeGameplay());
    el.btnReturnHub.addEventListener('click', () => {
      this.climber.reset();
      this.player.respawnAtHub();
      this.ui.notify('Returned safely to Central Alley Hub.', 'info');
      this.resumeGameplay();
    });
    el.btnContinueFreeplay.addEventListener('click', () => this.resumeGameplay());
    el.btnVictoryNextNight.addEventListener('click', () => {
      this.interaction.advanceNight();
      this.climber.reset();
      this.player.respawnAtHub();
      this.ui.notify(`NIGHT ${this.interaction.nightNumber} STARTED — All caches restocked!`, 'good');
      this.resumeGameplay();
    });

    // PointerLock lifecycle
    this.player.controls.addEventListener('lock', () => {
      this.activeModal = null;
      this.ui.showStartScreen(false);
      this.ui.showModal(null);
      this.ui.showHUD(true);
    });

    this.player.controls.addEventListener('unlock', () => {
      this._clearInputs();
      // If user unlocked via Esc while actively playing, open Pause menu
      if (this.started && this.activeModal === null) {
        this.openModal('pause');
      }
    });

    // Click canvas to re-lock if somehow unlocked without modal
    this.gameRenderer.renderer.domElement.addEventListener('click', () => {
      if (this.started && this.activeModal === null && !this.player.controls.isLocked) {
        this.player.controls.lock();
      }
    });

    // Keyboard controls
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        if (!this.started) return;
        if (this.activeModal === 'inventory') {
          this.resumeGameplay();
        } else if (this.activeModal === null) {
          this.openModal('inventory');
        }
        return;
      }

      if (e.code === 'Escape') {
        if (this.activeModal === 'inventory' || this.activeModal === 'trader' || this.activeModal === 'pause') {
          e.preventDefault();
          this.resumeGameplay();
        } else if (this.started && this.activeModal === null && !this.player.controls.isLocked) {
          // Fallback when PointerLock wasn't active (e.g. browser lock cooldown or embedded view)
          e.preventDefault();
          this.openModal('pause');
        }
        return;
      }

      // Close trader with E
      if (e.code === 'KeyE' && this.activeModal === 'trader') {
        e.preventDefault();
        this.resumeGameplay();
        return;
      }

      // Ignore gameplay keys when in a modal
      if (this.activeModal !== null) return;

      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.player.input.forward = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.player.input.backward = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.player.input.left = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.player.input.right = true;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.player.input.sprint = true;
          break;
        case 'Space':
          e.preventDefault();
          if (!e.repeat) this.player.input.jumpPressed = true;
          break;
        case 'KeyF':
          if (!e.repeat) {
            this.climber.toggleCarabiner(
              this.player,
              this.interaction.upgrades,
              (msg, kind) => this.ui.notify(msg, kind)
            );
          }
          break;
        case 'KeyE':
          if (!e.repeat) this._handleInteract();
          break;
        case 'KeyQ':
        case 'Digit1':
          if (!e.repeat) this._handleUseEnergyShot();
          break;
        case 'KeyH':
        case 'KeyL':
          if (!e.repeat) {
            const on = this.rig.toggleHeadlamp();
            this.ui.notify(on ? 'Headlamp ON.' : 'Headlamp OFF.', 'info');
          }
          break;
      }
    });

    window.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.player.input.forward = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.player.input.backward = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.player.input.left = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.player.input.right = false;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.player.input.sprint = false;
          break;
      }
    });
  }

  _animate() {
    requestAnimationFrame(() => this._animate());

    const rawDt = this.clock.getDelta();
    const dt = Math.min(0.05, rawDt);
    this.elapsed += dt;

    // FPS counter
    this._fpsFrames += 1;
    this._fpsAccum += rawDt;
    if (this._fpsAccum >= 0.5) {
      this.currentFps = Math.round(this._fpsFrames / this._fpsAccum);
      this._fpsFrames = 0;
      this._fpsAccum = 0;
    }

    if (this.activeModal === 'start') {
      // Gentle atmospheric night camera pan in the wet alley hub behind title card
      const angle = Math.sin(this.elapsed * 0.16) * 0.28;
      this.gameRenderer.camera.position.set(Math.sin(this.elapsed * 0.18) * 2.4, 3.2, 11.5);
      this.gameRenderer.camera.lookAt(angle * 22, 42, -45);
      this.world.update(dt, this.elapsed, this.gameRenderer.camera.position, this.climber.wind);
      this.interaction.update(dt, this.elapsed);
      this.gameRenderer.updateLightingForPlayer(this.gameRenderer.camera.position);
      this.gameRenderer.render();
      return;
    }

    if (this.activeModal === null) {
      // Active simulation tick
      const weightMult = this.interaction.getWeightStaminaMultiplier();
      this.player.update(dt, this.elapsed, this.climber, this.interaction.upgrades, weightMult, {
        onNotify: (msg, kind) => this.ui.notify(msg, kind),
        onSafetyNetCatch: () => {
          this.interaction.stats.fallsSurvived += 1;
          this.ui.notify('CAUGHT BY SUSPENDED SAFETY NET — NO INJURY!', 'good');
        },
        onHardLanding: (drop) => {
          this.audio.playDanger();
          this.ui.notify(`Hard landing (${drop.toFixed(1)}m) — shaken stamina!`, 'warn');
        },
        onFatalFall: (drop) => this._handleFatalFall(drop)
      });

      this.focusedTarget = this.interaction.findFocusedTarget(
        this.gameRenderer.camera,
        this.player.position,
        this.climber.isClimbing || this.climber.isZiplining
      );

      this.rig.update(dt, this.elapsed, {
        mode: this.climber.isZiplining ? 'zipline' : (this.climber.isClimbing ? 'climb' : 'walk'),
        moveSpeed: this.player.moveSpeed,
        isSprinting: this.player.isSprinting,
        climbPhase: this.climber.climbPhase,
        isSliding: this.climber.isSliding,
        isAnchored: this.climber.isAnchored,
        isClipping: this.climber.isClipping,
        clipProgress: this.climber.clipDuration > 0 ? this.climber.clipTimer / this.climber.clipDuration : 0,
        staminaPct: this.player.stamina
      });

      this.world.update(dt, this.elapsed, this.player.position, this.climber.wind);
      this.interaction.update(dt, this.elapsed);
      this.gameRenderer.updateLightingForPlayer(this.player.position);

      this.ui.updateHUD({
        player: this.player,
        climber: this.climber,
        interaction: this.interaction,
        rig: this.rig,
        world: this.world,
        focusedTarget: this.focusedTarget,
        fps: this.currentFps
      });
    } else {
      // Keep strobes & flickering fluorescents alive even behind open menus
      this.world.update(dt, this.elapsed, this.player.position, this.climber.wind);
      this.interaction.update(dt, this.elapsed);
    }

    this.gameRenderer.render();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.__rooftopVertigo = new RooftopVertigoGame();
});
