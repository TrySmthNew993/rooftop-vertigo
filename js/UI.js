import { SHOP_CATALOG } from './Interaction.js';

export class UIManager {
  constructor() {
    this.el = {
      startScreen: document.getElementById('start-screen'),
      loadingStatus: document.getElementById('loading-status'),
      btnPlay: document.getElementById('btn-play'),
      btnStartQuality: document.getElementById('btn-start-quality'),
      btnStartAudio: document.getElementById('btn-start-audio'),

      hud: document.getElementById('hud'),
      altitude: document.getElementById('hud-altitude'),
      zone: document.getElementById('hud-zone'),
      objective: document.getElementById('hud-objective'),
      credits: document.getElementById('hud-credits'),
      weight: document.getElementById('hud-weight'),
      haul: document.getElementById('hud-haul'),
      windReadout: document.getElementById('hud-wind-readout'),
      night: document.getElementById('hud-night'),
      fps: document.getElementById('hud-fps'),

      windBanner: document.getElementById('hud-wind-banner'),
      windIcon: document.getElementById('wind-banner-icon'),
      windTitle: document.getElementById('wind-banner-title'),
      windSpeed: document.getElementById('wind-banner-speed'),
      windSub: document.getElementById('wind-banner-sub'),
      windFill: document.getElementById('wind-bar-fill'),

      crosshair: document.getElementById('crosshair'),
      latchRing: document.getElementById('latch-ring'),
      latchLabel: document.getElementById('latch-label'),
      latchFill: document.getElementById('latch-fill'),

      interactPrompt: document.getElementById('interact-prompt'),
      interactKey: document.getElementById('interact-key'),
      interactTitle: document.getElementById('interact-title'),
      interactSub: document.getElementById('interact-sub'),

      toastContainer: document.getElementById('toast-container'),

      badgeClimb: document.getElementById('badge-climb'),
      badgeAnchor: document.getElementById('badge-anchor'),
      badgeZipline: document.getElementById('badge-zipline'),
      badgeVertigo: document.getElementById('badge-vertigo'),
      badgePanic: document.getElementById('badge-panic'),

      staminaLabel: document.getElementById('stamina-label'),
      staminaPct: document.getElementById('stamina-pct'),
      staminaFill: document.getElementById('stamina-fill'),
      staminaMeta: document.getElementById('stamina-meta'),

      slotCarabiner: document.getElementById('slot-carabiner'),
      gearCarabinerState: document.getElementById('gear-carabiner-state'),
      slotSyringe: document.getElementById('slot-syringe'),
      gearSyringeState: document.getElementById('gear-syringe-state'),
      slotHeadlamp: document.getElementById('slot-headlamp'),
      gearHeadlampState: document.getElementById('gear-headlamp-state'),

      fxVertigo: document.getElementById('fx-vertigo'),
      fxGripDanger: document.getElementById('fx-grip-danger'),
      fxWind: document.getElementById('fx-wind-overlay'),
      fxImpact: document.getElementById('fx-impact'),

      // Modals
      invModal: document.getElementById('inventory-modal'),
      btnCloseInv: document.getElementById('btn-close-inv'),
      invWeightSummary: document.getElementById('inv-weight-summary'),
      invList: document.getElementById('inv-list'),
      invTotalVal: document.getElementById('inv-total-val'),
      invPenaltyInfo: document.getElementById('inv-penalty-info'),
      invLootProgress: document.getElementById('inv-loot-progress'),
      invGearSummary: document.getElementById('inv-gear-summary'),

      traderModal: document.getElementById('trader-modal'),
      traderCredits: document.getElementById('trader-credits'),
      btnSellAll: document.getElementById('btn-sell-all'),
      traderSellList: document.getElementById('trader-sell-list'),
      traderShopList: document.getElementById('trader-shop-list'),
      traderFeedback: document.getElementById('trader-feedback'),
      btnNextNight: document.getElementById('btn-next-night'),
      btnCloseTrader: document.getElementById('btn-close-trader'),

      pauseModal: document.getElementById('pause-modal'),
      btnSetQuality: document.getElementById('btn-set-quality'),
      btnSetVertigo: document.getElementById('btn-set-vertigo'),
      btnSetAudio: document.getElementById('btn-set-audio'),
      inputSens: document.getElementById('input-sens'),
      btnResume: document.getElementById('btn-resume'),
      btnReturnHub: document.getElementById('btn-return-hub'),

      victoryModal: document.getElementById('victory-modal'),
      victoryStats: document.getElementById('victory-stats'),
      btnContinueFreeplay: document.getElementById('btn-continue-freeplay'),
      btnVictoryNextNight: document.getElementById('btn-victory-next-night')
    };

    this._lastPromptId = '';
  }

  setReady() {
    this.el.loadingStatus.textContent = 'Ready — PBR Night Shaders & 220m Skyline Compiled.';
  }

  showStartScreen(visible) {
    this.el.startScreen.classList.toggle('hidden', !visible);
  }

  showHUD(visible) {
    this.el.hud.classList.toggle('hidden', !visible);
  }

  showModal(modalName) {
    this.el.invModal.classList.toggle('hidden', modalName !== 'inventory');
    this.el.traderModal.classList.toggle('hidden', modalName !== 'trader');
    this.el.pauseModal.classList.toggle('hidden', modalName !== 'pause');
    this.el.victoryModal.classList.toggle('hidden', modalName !== 'victory');
  }

  syncSettingsUI({ quality, vertigo, muted }) {
    const qText = quality.toUpperCase();
    const aText = muted ? 'MUTED' : 'ON';
    this.el.btnStartQuality.textContent = `GRAPHICS: ${qText}`;
    this.el.btnStartAudio.textContent = `AUDIO ALERTS: ${aText}`;
    this.el.btnSetQuality.textContent = qText;
    this.el.btnSetVertigo.textContent = vertigo.toUpperCase();
    this.el.btnSetAudio.textContent = aText;
  }

  notify(message, type = 'info') {
    const div = document.createElement('div');
    div.className = `toast ${type}`;
    div.textContent = message;
    this.el.toastContainer.appendChild(div);
    while (this.el.toastContainer.children.length > 3) {
      this.el.toastContainer.removeChild(this.el.toastContainer.firstChild);
    }
    setTimeout(() => {
      div.remove();
    }, 3600);
  }

  renderInventory(interaction, onDrop) {
    const w = interaction.getCurrentWeight();
    const maxW = interaction.getMaxWeight();
    this.el.invWeightSummary.textContent = `${w.toFixed(1)} / ${maxW.toFixed(1)} kg`;
    this.el.invTotalVal.textContent = `$${interaction.getHaulValue().toLocaleString()}`;
    this.el.invPenaltyInfo.textContent = `Encumbrance Stamina Mult: ${interaction.getWeightStaminaMultiplier().toFixed(2)}x`;

    const prog = interaction.getCollectedStats();
    this.el.invLootProgress.textContent = `${prog.collected} / ${prog.total} CACHES`;

    this.el.invList.innerHTML = '';
    if (!interaction.inventory.length) {
      this.el.invList.innerHTML = '<div class="empty-state">Salvage pack is empty. Explore the Fallout Shelter (-6m), Rooftops (24–28m), Skyscraper (130m), or Broadcast Tower (220m).</div>';
    } else {
      for (const item of interaction.inventory) {
        const row = document.createElement('div');
        row.className = `item-row${item.isApex ? ' apex' : ''}`;
        row.innerHTML = `
          <div>
            <div class="item-name">${item.name}</div>
            <div class="item-meta">${item.weight.toFixed(1)} kg • Est. $${item.value.toLocaleString()}</div>
          </div>
          <div class="item-actions">
            <button class="btn-danger" data-drop="${item.uid}">DROP</button>
          </div>
        `;
        row.querySelector('[data-drop]').addEventListener('click', () => onDrop(item.uid));
        this.el.invList.appendChild(row);
      }
    }

    const u = interaction.upgrades;
    const gearLines = [
      ['Climbing Gloves', u.glovesTier === 2 ? 'Pro Mag-Chalk Mk.II (-52% drain)' : (u.glovesTier === 1 ? 'Chalk Gloves Mk.I (-30% drain)' : 'Standard Bare/Work Gloves')],
      ['Carabiner', u.quickCarabiner ? 'Quick-Lock Titanium (0.3s clip)' : 'Standard Screw-Gate (1.1s clip)'],
      ['Headlamp', u.wideHeadlamp ? 'Wide-Beam Tactical (76m)' : 'Standard Narrow Beam (42m)'],
      ['Harness Pack', u.packFrame ? 'Carbon Frame (34 kg cap)' : 'Standard Urban Pack (22 kg cap)'],
      ['Energy Injections', `${interaction.energyShots} / 5 ready [Q]`]
    ];
    this.el.invGearSummary.innerHTML = gearLines.map(([k, v]) => `
      <div class="item-row">
        <div class="item-name">${k}</div>
        <div class="item-meta accent-cyan">${v}</div>
      </div>
    `).join('');
  }

  renderTrader(interaction, { onSellItem, onSellAll, onBuyItem, onNextNight }) {
    this.el.traderCredits.textContent = `$${interaction.credits.toLocaleString()}`;
    const haulVal = interaction.getHaulValue();
    this.el.btnSellAll.textContent = `SELL ALL ($${haulVal.toLocaleString()})`;
    this.el.btnSellAll.disabled = interaction.inventory.length === 0;
    this.el.btnSellAll.onclick = onSellAll;
    this.el.btnNextNight.onclick = onNextNight;

    // Sell list
    this.el.traderSellList.innerHTML = '';
    if (!interaction.inventory.length) {
      this.el.traderSellList.innerHTML = '<div class="empty-state">No carried salvage to sell. Climb higher or loot Fallout Shelter B-04 south of this alley.</div>';
    } else {
      for (const item of interaction.inventory) {
        const row = document.createElement('div');
        row.className = `item-row${item.isApex ? ' apex' : ''}`;
        row.innerHTML = `
          <div>
            <div class="item-name">${item.name}</div>
            <div class="item-meta">${item.weight.toFixed(1)} kg • Payout <span class="accent-green">$${item.value.toLocaleString()}</span></div>
          </div>
          <button class="btn-ghost btn-sm" data-sell="${item.uid}">SELL $${item.value}</button>
        `;
        row.querySelector('[data-sell]').addEventListener('click', () => onSellItem(item.uid));
        this.el.traderSellList.appendChild(row);
      }
    }

    // Upgrade & Consumable Shop List
    this.el.traderShopList.innerHTML = '';
    for (const s of SHOP_CATALOG) {
      const owned = !s.consumable && interaction.isShopItemOwned(s.id);
      const lockedReq = s.requires && !interaction.isShopItemOwned(s.requires);
      const maxed = s.consumable && interaction.energyShots >= s.maxStock;
      const canAfford = interaction.credits >= s.cost;

      let btnLabel = `BUY $${s.cost}`;
      let disabled = false;
      if (owned) {
        btnLabel = 'INSTALLED';
        disabled = true;
      } else if (lockedReq) {
        btnLabel = 'NEEDS MK.I';
        disabled = true;
      } else if (maxed) {
        btnLabel = `FULL (${interaction.energyShots}/${s.maxStock})`;
        disabled = true;
      } else if (!canAfford) {
        disabled = true;
      }

      const row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `
        <div>
          <div class="item-name">${s.name} ${s.consumable ? `<span class="accent-cyan">(${interaction.energyShots}/${s.maxStock})</span>` : ''}</div>
          <div class="item-meta">${s.desc}</div>
        </div>
        <button class="${disabled ? 'btn-ghost' : 'btn-primary'} btn-sm" ${disabled ? 'disabled' : ''}>${btnLabel}</button>
      `;
      if (!disabled) {
        row.querySelector('button').addEventListener('click', () => onBuyItem(s.id));
      }
      this.el.traderShopList.appendChild(row);
    }
  }

  setTraderFeedback(text) {
    this.el.traderFeedback.textContent = text;
  }

  showVictory(interaction) {
    this.el.victoryStats.innerHTML = `
      <div>TOTAL CREDITS EARNED: <span class="accent-green">$${interaction.stats.totalEarned.toLocaleString()}</span></div>
      <div>CURRENT BALANCE: <span class="accent-green">$${interaction.credits.toLocaleString()}</span></div>
      <div>COMPONENTS EXTRACTED: <span class="accent-cyan">${interaction.stats.itemsExtracted}</span></div>
      <div>NIGHT NUMBER: <span class="accent-amber">NIGHT 0${interaction.nightNumber}</span></div>
      <div>FATAL FALLS: <span class="accent-red">${interaction.stats.fatalFalls}</span></div>
    `;
    this.showModal('victory');
  }

  updateHUD({ player, climber, interaction, rig, world, focusedTarget, fps }) {
    const alt = player.position.y;
    this.el.altitude.innerHTML = `${alt.toFixed(1)}<small>m</small>`;
    this.el.zone.textContent = world.getZoneName(player.position);

    // Objective progress indicator
    const hasApex = interaction.inventory.some((i) => i.isApex);
    if (interaction.stats.apexSold) {
      this.el.objective.textContent = 'OBJ: 220m Apex Core Extracted! Free-roam or start New Night.';
    } else if (hasApex) {
      this.el.objective.textContent = 'OBJ: APEX CORE IN BAG! Ride 220m Zipline & sell at Scrap Buyer!';
    } else {
      const prog = interaction.getCollectedStats();
      this.el.objective.textContent = `OBJ: Salvage Loot (${prog.collected}/${prog.total}) & Extract 220m Apex Core`;
    }

    // Right Telemetry
    this.el.credits.textContent = `$${interaction.credits.toLocaleString()}`;
    const curW = interaction.getCurrentWeight();
    const maxW = interaction.getMaxWeight();
    this.el.weight.textContent = `${curW.toFixed(1)} / ${maxW.toFixed(1)} kg`;
    this.el.weight.classList.toggle('accent-amber', curW / maxW > 0.75);
    this.el.haul.textContent = `$${interaction.getHaulValue().toLocaleString()}`;
    this.el.night.textContent = `NIGHT ${String(interaction.nightNumber).padStart(2, '0')}`;
    this.el.fps.textContent = `${fps} FPS`;

    // Wind Telemetry & Mute-Friendly Alert Banner
    const w = climber.wind;
    const kmh = Math.round(w.speedKmh);
    if (alt < 48) {
      this.el.windReadout.textContent = `${kmh} km/h CALM`;
      this.el.windReadout.className = 'stat-val';
      this.el.windBanner.classList.add('hidden');
      this.el.fxWind.style.opacity = '0';
    } else {
      const label = w.phase === 'gust' ? `GUST ${w.dirLabel}` : (w.phase === 'warning' ? 'BUILDING!' : 'HIGH ALT');
      this.el.windReadout.textContent = `${kmh} km/h ${label}`;
      this.el.windReadout.className = `stat-val ${w.phase === 'gust' ? 'accent-red' : (w.phase === 'warning' ? 'accent-amber' : 'accent-cyan')}`;

      if (w.phase === 'warning') {
        this.el.windBanner.classList.remove('hidden', 'danger', 'safe');
        this.el.windIcon.textContent = '▲';
        this.el.windTitle.textContent = `WIND GUST INCOMING (${w.dirLabel}) — ${w.timer.toFixed(1)}s`;
        this.el.windSpeed.textContent = `${kmh} KM/H`;
        this.el.windSub.textContent = climber.isAnchored
          ? '✓ CARABINER ANCHORED — STAY CLIPPED THROUGH GUST'
          : 'PRESS [F] NOW TO CLIP CARABINER BEFORE IMPACT!';
        if (climber.isAnchored) this.el.windBanner.classList.add('safe');
        this.el.windFill.style.width = `${Math.max(0, (w.timer / w.phaseDuration) * 100)}%`;
        this.el.fxWind.style.opacity = '0.35';
      } else if (w.phase === 'gust') {
        this.el.windBanner.classList.remove('hidden');
        this.el.windBanner.classList.toggle('safe', climber.isAnchored);
        this.el.windBanner.classList.toggle('danger', !climber.isAnchored);
        this.el.windIcon.textContent = climber.isAnchored ? '✓' : '⚡';
        this.el.windTitle.textContent = climber.isAnchored
          ? `ANCHORED SAFE — GUST ${w.dirLabel}`
          : `EXTREME WIND GUST (${w.dirLabel})!`;
        this.el.windSpeed.textContent = `${kmh} KM/H`;
        this.el.windSub.textContent = climber.isAnchored
          ? 'Safety lanyard holding firm • Stamina regenerating'
          : (climber.isClimbing
            ? 'GRIP FAILING FAST — CLIP [F] OR INJECT [Q] IMMEDIATELY!'
            : 'STRONG LATERAL PUSH — BRACE OR CLIP [F]!');
        this.el.windFill.style.width = `${Math.max(0, (w.timer / w.phaseDuration) * 100)}%`;
        this.el.fxWind.style.opacity = climber.isAnchored ? '0.28' : '0.85';
      } else {
        this.el.windBanner.classList.add('hidden');
        this.el.fxWind.style.opacity = '0.12';
      }
    }

    // Carabiner Clipping Progress Bar
    if (climber.isClipping) {
      this.el.latchRing.classList.remove('hidden');
      const pct = Math.min(100, (climber.clipTimer / climber.clipDuration) * 100);
      this.el.latchFill.style.width = `${pct}%`;
      this.el.latchLabel.textContent = interaction.upgrades.quickCarabiner
        ? 'QUICK-LOCK LATCHING...'
        : 'CLIPPING CARABINER...';
    } else {
      this.el.latchRing.classList.add('hidden');
    }

    // Center Interaction Prompt
    if (focusedTarget) {
      this.el.interactPrompt.classList.remove('hidden');
      this.el.crosshair.classList.add('active');
      const sig = `${focusedTarget.title}|${focusedTarget.subtitle}`;
      if (sig !== this._lastPromptId) {
        this._lastPromptId = sig;
        this.el.interactKey.textContent = focusedTarget.key;
        this.el.interactTitle.textContent = focusedTarget.title;
        this.el.interactSub.textContent = focusedTarget.subtitle;
      }
    } else {
      this.el.interactPrompt.classList.add('hidden');
      this.el.crosshair.classList.remove('active');
      this._lastPromptId = '';
    }

    // State Badges
    const lowGripPanic = climber.isClimbing && !climber.isAnchored && player.stamina < 30;
    const showClimbOrCrawl = (climber.isClimbing && !climber.isAnchored) || player.isCrawling;
    this.el.badgeClimb.classList.toggle('hidden', !showClimbOrCrawl);
    if (climber.isClimbing && !climber.isAnchored) {
      this.el.badgeClimb.textContent = climber.isSliding ? 'FAST SLIDING [SHIFT]' : 'CLIMBING LADDER';
    } else if (player.isCrawling) {
      this.el.badgeClimb.textContent = 'CRAWLING IN AIR VENT (0.8m)';
    }
    this.el.badgeAnchor.classList.toggle('hidden', !climber.isAnchored);
    this.el.badgeZipline.classList.toggle('hidden', !climber.isZiplining);
    this.el.badgeVertigo.classList.toggle('hidden', player.vertigoIntensity < 0.52 || player.vertigoSetting === 'off');
    this.el.badgePanic.classList.toggle('hidden', !lowGripPanic);

    // Stamina / Grip Bar
    const stam = Math.round(player.stamina);
    this.el.staminaPct.textContent = `${stam}%`;
    this.el.staminaFill.style.width = `${Math.max(0, Math.min(100, player.stamina))}%`;

    this.el.staminaFill.classList.remove('warn', 'danger', 'boost');
    if (player.adrenalineTimer > 0) {
      this.el.staminaFill.classList.add('boost');
      this.el.staminaLabel.textContent = `ADRENALINE BOOST (${player.adrenalineTimer.toFixed(1)}s)`;
    } else if (stam < 28) {
      this.el.staminaFill.classList.add('danger');
      this.el.staminaLabel.textContent = climber.isClimbing ? 'CRITICAL GRIP — LOW STAMINA!' : 'EXHAUSTED';
    } else if (stam < 55) {
      this.el.staminaFill.classList.add('warn');
      this.el.staminaLabel.textContent = 'STAMINA // GRIP (STRAINED)';
    } else {
      this.el.staminaLabel.textContent = climber.isAnchored ? 'STAMINA // RECOVERING (ANCHORED)' : 'STAMINA // GRIP';
    }

    const drainMult = interaction.getWeightStaminaMultiplier();
    if (climber.isZiplining) {
      this.el.staminaMeta.textContent = 'Riding High-Altitude Zipline • [Space] Release Mid-Air onto Deck / Safety Net';
    } else if (climber.isClimbing) {
      this.el.staminaMeta.textContent = `Weight Drain: ${drainMult.toFixed(2)}x • [F] Clip Anchor • [Shift] Fast Slide • [Space] Dismount`;
    } else {
      this.el.staminaMeta.textContent = `Weight Drain: ${drainMult.toFixed(2)}x • [F] Clip Near Rail/Anchor (>14m) • [Q] Energy Shot`;
    }

    // Bottom Left Quick Gear Slots
    const canAnchorHere = climber.isClimbing || (player.onGround && player.position.y >= 14.0 && world.hasNearbyAnchorPoint && world.hasNearbyAnchorPoint(player.position));
    this.el.slotCarabiner.classList.toggle('active', climber.isAnchored || climber.isClipping);
    this.el.gearCarabinerState.textContent = climber.isAnchored
      ? 'ANCHORED SAFE'
      : (canAnchorHere
        ? (interaction.upgrades.quickCarabiner ? 'READY (0.3s)' : 'READY (1.1s)')
        : (interaction.upgrades.quickCarabiner ? 'QUICK-LOCK (0.3s)' : 'STD (1.1s)'));

    this.el.slotSyringe.classList.toggle('active', player.adrenalineTimer > 0);
    this.el.gearSyringeState.textContent = player.adrenalineTimer > 0
      ? `ACTIVE ${player.adrenalineTimer.toFixed(1)}s`
      : `x${interaction.energyShots} READY`;

    this.el.slotHeadlamp.classList.toggle('active', rig.headlampOn);
    this.el.gearHeadlampState.textContent = rig.headlampOn
      ? (rig.headlampUpgraded ? 'ON (WIDE 76m)' : 'ON (STD 42m)')
      : 'OFF';

    // Fullscreen Visual FX Overlays (Vertigo, Low Grip Panic, Fall Impact)
    const vertOpacity = player.vertigoSetting === 'off'
      ? 0
      : player.vertigoIntensity * (player.vertigoSetting === 'reduced' ? 0.35 : 0.82);
    this.el.fxVertigo.style.opacity = vertOpacity.toFixed(2);

    const gripOpacity = lowGripPanic ? ((30 - player.stamina) / 30) * 0.85 : 0;
    this.el.fxGripDanger.style.opacity = gripOpacity.toFixed(2);

    this.el.fxImpact.style.opacity = player.impactFlash.toFixed(2);
  }
}
