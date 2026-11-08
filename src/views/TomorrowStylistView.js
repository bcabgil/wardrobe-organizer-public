/**
 * TomorrowStylistView.js - Editorial "Create" AI Fashion Stylist Studio
 * Features a 1-Line Weather Strip, Soft Tonal Luxury Block Controls, Collapsible Options Drawer,
 * and Lookbook Cards with a Single Concise Styling Tip.
 */

import {
  wardrobeDb,
  formatCategoryLabel,
  getGarmentOccasionList,
  garmentMatchesOccasion,
  normalizeCategoryValue
} from '../db/wardrobeDb.js';
import { suggestTomorrowOutfits, STYLE_CACHE_VERSION } from '../services/ai/geminiService.js';
import { sortOutfitsByWearPreference, buildCombinationKey } from '../services/ai/offlineStylist.js';
import { getTomorrowWeather } from '../services/weather/weatherService.js';
import { MediaUrlManager, createSafeVideoPlayer } from '../utils/mediaUtils.js';
import { escapeHtml, getCategoryIconSvg, getNavIconSvg } from '../utils/domUtils.js';
import { eventBus } from '../utils/eventBus.js';
import { WearOutfitModal } from '../components/WearOutfitModal.js';
import { showToast } from '../components/Toast.js';
import { LoadingOverlay } from '../components/LoadingOverlay.js';

export class TomorrowStylistView {
  constructor() {
    this.container = null;
    this.urlManager = new MediaUrlManager();
    this.garments = [];
    this.settings = {};
    this.weather = null;
    this.occasion = 'everyday';
    this.anchorGarmentId = '';
    this.weatherNote = '';
    this.includeOuterwear = false;
    this.isOptionsOpen = false;
    this.lastResult = null;
  }

  async mount(container, params = {}) {
    this.container = container;

    const [garments, settings, lastActive] = await Promise.all([
      wardrobeDb.getAllGarments(),
      wardrobeDb.getSettings(),
      wardrobeDb.getSetting('lastActiveOutfitSuggestions', null)
    ]);
    this.garments = garments || [];
    this.settings = settings || {};

    if (lastActive && typeof lastActive === 'object') {
      if (lastActive.occasion) this.occasion = lastActive.occasion;
      if (typeof lastActive.includeOuterwear === 'boolean') {
        this.includeOuterwear = lastActive.includeOuterwear;
      }
      if (lastActive.anchorGarmentId !== undefined) {
        this.anchorGarmentId = lastActive.anchorGarmentId || '';
      }
      if (lastActive.weatherNote !== undefined) {
        this.weatherNote = lastActive.weatherNote || '';
      }
    }

    if (params.occasion) this.occasion = params.occasion;
    if (params.anchor) {
      this.anchorGarmentId = params.anchor;
      this.isOptionsOpen = true;
    }

    this.weather = await getTomorrowWeather({
      cityName: this.settings.location || '',
      activeSeason: this.settings.activeSeason || 'winter'
    });

    await this.render();
    await this.showRemainingCachedOutfits();
  }

  getCleanInSeasonGarments(targetOccasion = this.occasion) {
    const activeSeason = this.settings.activeSeason || 'winter';
    return this.garments.filter(
      (g) =>
        g &&
        g.status === 'clean' &&
        garmentMatchesOccasion(g, targetOccasion) &&
        (targetOccasion === 'gym' || !g.season || g.season === activeSeason || g.season === 'all-season')
    );
  }

  updateOccasionDependentControls() {
    if (!this.container) return;
    const cleanGarments = this.getCleanInSeasonGarments(this.occasion);

    if (this.anchorGarmentId && !cleanGarments.some((g) => g.id === this.anchorGarmentId)) {
      this.anchorGarmentId = '';
    }

    const anchorSelect = this.container.querySelector('#stylist-anchor-select');
    if (anchorSelect) {
      const anchorOptionsHtml = cleanGarments
        .map(
          (g) =>
            `<option value="${escapeHtml(g.id)}" ${this.anchorGarmentId === g.id ? 'selected' : ''}>${escapeHtml(g.name)} (${escapeHtml(g.category)})</option>`
        )
        .join('');
      anchorSelect.innerHTML = `<option value="">Let AI choose freely</option>${anchorOptionsHtml}`;
    }

    const cleanCountEl = this.container.querySelector('#stylist-clean-count');
    if (cleanCountEl) {
      cleanCountEl.textContent = `${cleanGarments.length} CLEAN`;
    }
  }

  async render() {
    if (!this.container) return;
    const cleanGarments = this.getCleanInSeasonGarments(this.occasion);

    if (this.anchorGarmentId && !cleanGarments.some((g) => g.id === this.anchorGarmentId)) {
      this.anchorGarmentId = '';
    }

    const anchorOptionsHtml = cleanGarments
      .map(
        (g) =>
          `<option value="${escapeHtml(g.id)}" ${this.anchorGarmentId === g.id ? 'selected' : ''}>${escapeHtml(g.name)} (${escapeHtml(g.category)})</option>`
      )
      .join('');

    const w = this.weather || {};
    const occasionList = [
      ...(Array.isArray(this.settings.occasionCategories) && this.settings.occasionCategories.length > 0
        ? this.settings.occasionCategories
        : ['everyday', 'dress-up'])
    ];
    for (const g of this.garments) {
      for (const t of getGarmentOccasionList(g)) {
        if (t && !occasionList.some((x) => normalizeCategoryValue(x) === t)) {
          occasionList.push(t);
        }
      }
    }
    if (!occasionList.some((x) => normalizeCategoryValue(x) === normalizeCategoryValue(this.occasion))) {
      this.occasion = occasionList[0] || 'everyday';
    }
    const occasionPillsHtml = occasionList
      .map((occ) => {
        const normOcc = normalizeCategoryValue(occ);
        return `<button type="button" class="pill-btn ${normalizeCategoryValue(this.occasion) === normOcc ? 'active' : ''}" data-val="${escapeHtml(normOcc)}">${escapeHtml(formatCategoryLabel(occ))}</button>`;
      })
      .join('');

    const hasActiveOptions = Boolean(this.anchorGarmentId || this.weatherNote || this.includeOuterwear);
    const showDrawer = this.isOptionsOpen || hasActiveOptions;

    this.container.innerHTML = `
      <section class="view-section stylist-view">
        <!-- 1-LINE EDITORIAL WEATHER STRIP -->
        <div class="weather-strip">
          <span class="weather-strip-left">
            ${escapeHtml((w.cityName || 'Local').toUpperCase())}  ·  ${w.tempMin ?? 10}°–${w.tempMax ?? 18}°C  ·  ${escapeHtml((w.condition || 'Mild').toUpperCase())}
          </span>
          <span class="weather-strip-right" id="stylist-clean-count">${cleanGarments.length} CLEAN</span>
        </div>

        <!-- COMPACT STYLIST CONTROLS -->
        <div class="stylist-controls card-surface">
          <div class="stylist-top-bar">
            <div class="pill-selector" id="stylist-occasion-pills">
              ${occasionPillsHtml}
            </div>
            <button
              type="button"
              class="toolbar-tonal-btn ${showDrawer ? 'active' : ''}"
              id="btn-toggle-stylist-options"
            >
              Options +
            </button>
          </div>

          <div class="stylist-options-drawer ${showDrawer ? '' : 'hidden'}" id="stylist-options-drawer">
            <div class="form-row-2 keep-2col-mobile">
              <label class="form-label">ANCHOR PIECE
                <select id="stylist-anchor-select" class="form-select">
                  <option value="">Let AI choose freely</option>
                  ${anchorOptionsHtml}
                </select>
              </label>

              <label class="form-label">VIBE / NOTE
                <input type="text" id="stylist-note-input" class="form-input" placeholder="e.g., Office then dinner" value="${escapeHtml(this.weatherNote)}" />
              </label>
            </div>

            <label class="form-label" style="flex-direction:row; align-items:center; gap:8px; cursor:pointer; text-transform:none; letter-spacing:0;">
              <input type="checkbox" id="stylist-include-outerwear" ${this.includeOuterwear ? 'checked' : ''} style="width:17px; height:17px; accent-color:var(--text-primary); cursor:pointer;" />
              <span style="font-size:0.86rem; color:var(--text-primary); font-weight:500;">Include Outerwear</span>
            </label>
          </div>

          <div class="stylist-cta-row">
            <button type="button" id="btn-generate-outfits" class="btn-primary">
              Create Outfits
            </button>
            <button type="button" id="btn-force-refresh-outfits" class="btn-secondary" title="Request fresh combinations">
              Refresh
            </button>
          </div>
        </div>

        <!-- OUTFIT RESULTS MOUNT -->
        <div id="stylist-outfits-mount" class="outfits-list"></div>
      </section>
    `;

    // Toggle Options + drawer
    this.container.querySelector('#btn-toggle-stylist-options')?.addEventListener('click', () => {
      this.isOptionsOpen = !this.isOptionsOpen;
      const drawer = this.container.querySelector('#stylist-options-drawer');
      const btn = this.container.querySelector('#btn-toggle-stylist-options');
      if (drawer) drawer.classList.toggle('hidden', !this.isOptionsOpen);
      if (btn) btn.classList.toggle('active', this.isOptionsOpen);
    });

    // Bind occasion pills
    this.container.querySelectorAll('#stylist-occasion-pills .pill-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.occasion = btn.dataset.val;
        this.container
          .querySelectorAll('#stylist-occasion-pills .pill-btn')
          .forEach((b) => b.classList.toggle('active', b === btn));
        this.updateOccasionDependentControls();
      });
    });

    // Bind anchor select, note & optional outerwear toggle
    this.container.querySelector('#stylist-anchor-select')?.addEventListener('change', (e) => {
      this.anchorGarmentId = e.target.value || '';
    });

    this.container.querySelector('#stylist-note-input')?.addEventListener('input', (e) => {
      this.weatherNote = e.target.value || '';
    });

    this.container.querySelector('#stylist-include-outerwear')?.addEventListener('change', (e) => {
      this.includeOuterwear = Boolean(e.target.checked);
    });

    this.container.querySelector('#btn-generate-outfits')?.addEventListener('click', () => {
      this.applyOptionsToCachedOrSuggest();
    });

    this.container.querySelector('#btn-force-refresh-outfits')?.addEventListener('click', () => {
      this.generateSuggestions({ forceRefresh: true });
    });
  }

  async showRemainingCachedOutfits() {
    if (!this.container) return;
    const outfitsMount = this.container.querySelector('#stylist-outfits-mount');
    if (!outfitsMount) return;

    const [latestGarments, wearCounts, lastActive] = await Promise.all([
      wardrobeDb.getAllGarments(),
      wardrobeDb.getCombinationWearCounts(),
      wardrobeDb.getSetting('lastActiveOutfitSuggestions', null)
    ]);
    this.garments = latestGarments || [];

    const cleanGarmentMap = new Map(
      this.garments.filter((g) => g && g.status === 'clean').map((g) => [g.id, g])
    );

    const hasApiKey = Boolean(this.settings.geminiApiKey && String(this.settings.geminiApiKey).trim());

    if (lastActive && Array.isArray(lastActive.outfits) && lastActive.outfits.length > 0) {
      if (
        lastActive.styleVersion !== STYLE_CACHE_VERSION ||
        (hasApiKey && lastActive.engine !== 'gemini')
      ) {
        await this.generateSuggestions({ forceRefresh: false });
        return;
      }
      const targetOccasion = lastActive.occasion || this.occasion || 'everyday';
      const remainingOutfits = lastActive.outfits.filter((o) => {
        if (!Array.isArray(o.garmentIds) || o.garmentIds.length < 1) return false;
        const outfitOccasion = o.occasion || targetOccasion;
        return o.garmentIds.every((id) => {
          const g = cleanGarmentMap.get(id);
          return g && garmentMatchesOccasion(g, outfitOccasion);
        });
      });

      if (remainingOutfits.length > 0) {
        const sortedRemaining = sortOutfitsByWearPreference(remainingOutfits, wearCounts);
        const updatedActive = {
          ...lastActive,
          styleVersion: STYLE_CACHE_VERSION,
          outfits: sortedRemaining,
          fromCache: true
        };
        this.lastResult = updatedActive;
        await wardrobeDb.setSetting('lastActiveOutfitSuggestions', updatedActive).catch(() => {});
        await this.renderOutfits(updatedActive, outfitsMount);
        return;
      }
    }

    outfitsMount.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-icon">${getNavIconSvg('create')}</div>
        <h3>Curate Tomorrow's Look</h3>
        <p>Select your occasion above and tap <strong>Create Outfits</strong> to view styled combinations.</p>
      </div>
    `;
  }

  async applyOptionsToCachedOrSuggest() {
    if (!this.container) return;
    const outfitsMount = this.container.querySelector('#stylist-outfits-mount');
    if (!outfitsMount) return;

    const [latestGarments, wearCounts, lastActive] = await Promise.all([
      wardrobeDb.getAllGarments(),
      wardrobeDb.getCombinationWearCounts(),
      wardrobeDb.getSetting('lastActiveOutfitSuggestions', null)
    ]);
    this.garments = latestGarments || [];
    const garmentMap = new Map(this.garments.map((g) => [g.id, g]));

    const activeSeason = this.settings.activeSeason || 'winter';
    const currentStylePrefs = String(this.settings.stylePreferences || '').trim();
    const hasApiKey = Boolean(this.settings.geminiApiKey && String(this.settings.geminiApiKey).trim());
    if (
      lastActive &&
      lastActive.styleVersion === STYLE_CACHE_VERSION &&
      (!hasApiKey || lastActive.engine === 'gemini') &&
      Array.isArray(lastActive.outfits) &&
      lastActive.outfits.length > 0 &&
      lastActive.occasion === this.occasion &&
      lastActive.activeSeason === activeSeason &&
      (lastActive.anchorGarmentId || '') === (this.anchorGarmentId || '') &&
      (lastActive.weatherNote || '') === (this.weatherNote || '') &&
      String(lastActive.stylePreferences || '').trim() === currentStylePrefs &&
      lastActive.includeOuterwear === true &&
      this.includeOuterwear === false
    ) {
      const jacketRemovedOutfits = lastActive.outfits
        .map((o) => {
          const nextIds = (o.garmentIds || []).filter((id) => {
            if (id === this.anchorGarmentId) return true;
            const g = garmentMap.get(id);
            return g && g.status === 'clean' && g.category !== 'outerwear';
          });
          return {
            ...o,
            garmentIds: nextIds,
            combinationKey: buildCombinationKey(nextIds)
          };
        })
        .filter((o) => o.garmentIds.length >= 1);

      if (jacketRemovedOutfits.length > 0) {
        const sorted = sortOutfitsByWearPreference(jacketRemovedOutfits, wearCounts);
        const updatedActive = {
          ...lastActive,
          styleVersion: STYLE_CACHE_VERSION,
          includeOuterwear: false,
          outfits: sorted,
          fromCache: true
        };
        this.lastResult = updatedActive;
        await wardrobeDb.setSetting('lastActiveOutfitSuggestions', updatedActive).catch(() => {});
        await this.renderOutfits(updatedActive, outfitsMount);
        return;
      }
    }

    await this.generateSuggestions({ forceRefresh: false });
  }

  async generateSuggestions({ forceRefresh = false } = {}) {
    if (!this.container) return;
    const outfitsMount = this.container.querySelector('#stylist-outfits-mount');
    if (!outfitsMount) return;

    this.urlManager.revokeAll();
    LoadingOverlay.show(
      forceRefresh ? 'Generating fresh outfit combinations...' : 'Curating outfit combinations...'
    );

    try {
      const [latestGarments, latestSettings, wearCounts, persistedCache] = await Promise.all([
        wardrobeDb.getAllGarments(),
        wardrobeDb.getSettings(),
        wardrobeDb.getCombinationWearCounts(),
        wardrobeDb.getSetting('outfitSuggestionsCache', {})
      ]);
      this.garments = latestGarments || [];
      this.settings = latestSettings || {};
      const activeSeason = this.settings.activeSeason || 'winter';

      const result = await suggestTomorrowOutfits({
        garments: this.garments,
        occasion: this.occasion,
        activeSeason,
        anchorGarmentId: this.anchorGarmentId || null,
        weatherNote: this.weatherNote,
        weatherData: this.weather,
        apiKey: this.settings.geminiApiKey || '',
        stylePreferences: this.settings.stylePreferences || '',
        wearCounts: wearCounts || {},
        forceRefresh,
        persistedCache: persistedCache || {},
        includeOuterwear: this.includeOuterwear
      });

      if (
        result.cacheKey &&
        !result.fallbackReason &&
        Array.isArray(result.outfits) &&
        result.outfits.length > 0
      ) {
        const nextCache = { ...(persistedCache || {}) };
        nextCache[result.cacheKey] = {
          engine: result.engine,
          styleVersion: STYLE_CACHE_VERSION,
          outfits: result.outfits,
          message: result.message,
          cachedAt: new Date().toISOString()
        };
        const keys = Object.keys(nextCache);
        if (keys.length > 20) {
          delete nextCache[keys[0]];
        }
        await wardrobeDb.setSetting('outfitSuggestionsCache', nextCache).catch(() => {});
      }

      if (result.fallbackReason && this.settings.geminiApiKey) {
        showToast(`Gemini AI unavailable (${result.fallbackReason}). Showing offline fallback.`, 'warning');
      }

      if (Array.isArray(result.outfits) && result.outfits.length > 0 && !result.fallbackReason) {
        await wardrobeDb
          .setSetting('lastActiveOutfitSuggestions', {
            engine: result.engine,
            styleVersion: STYLE_CACHE_VERSION,
            outfits: result.outfits,
            message: result.message,
            occasion: this.occasion,
            activeSeason,
            anchorGarmentId: this.anchorGarmentId || '',
            weatherNote: this.weatherNote || '',
            stylePreferences: this.settings.stylePreferences || '',
            includeOuterwear: this.includeOuterwear,
            fromCache: Boolean(result.fromCache),
            updatedAt: new Date().toISOString()
          })
          .catch(() => {});
      }

      this.lastResult = result;
      await this.renderOutfits(result, outfitsMount);
    } catch (err) {
      outfitsMount.innerHTML = `<div class="empty-state-card"><p>Could not generate outfits: ${escapeHtml(err.message)}</p></div>`;
    } finally {
      LoadingOverlay.hide();
    }
  }

  async renderOutfits(result, outfitsMount) {
    outfitsMount.innerHTML = '';

    if (!result || !Array.isArray(result.outfits) || result.outfits.length === 0) {
      outfitsMount.innerHTML = `
        <div class="empty-state-card">
          <div class="empty-icon">${getNavIconSvg('create')}</div>
          <h3>No Complete Outfits Available</h3>
          <p>${escapeHtml(result?.message || 'Add at least a clean top and bottom (or one-piece) for this season to create combinations.')}</p>
          <a href="#add" class="btn-primary">Add Piece</a>
        </div>
      `;
      return;
    }

    const garmentMap = new Map(this.garments.map((g) => [g.id, g]));

    for (const outfit of result.outfits) {
      const outfitGarments = (outfit.garmentIds || [])
        .map((id) => garmentMap.get(id))
        .filter(Boolean);

      const cardEl = document.createElement('article');
      cardEl.className = 'outfit-card card-surface';

      const piecesHtmlPromises = outfitGarments.map(async (g) => {
        let photoUrl = null;
        if (g.photoMediaId) {
          const blob = await wardrobeDb.getMediaBlob(g.photoMediaId).catch(() => null);
          if (blob) photoUrl = this.urlManager.createUrl(blob);
        }

        return `
          <div class="outfit-piece-item" data-garment-id="${escapeHtml(g.id)}">
            <div class="outfit-piece-thumb">
              ${
                photoUrl
                  ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(g.name)}" />`
                  : `<div class="outfit-piece-placeholder">${getCategoryIconSvg(g.category)}</div>`
              }
              ${
                g.videoMediaId
                  ? `<button type="button" class="btn-preview-fit" data-video-media-id="${escapeHtml(g.videoMediaId)}" data-garment-name="${escapeHtml(g.name)}">▶ FIT</button>`
                  : ''
              }
            </div>
            <div class="outfit-piece-name">${escapeHtml(g.name)}</div>
            <div class="outfit-piece-cat">${escapeHtml(g.category)}</div>
          </div>
        `;
      });

      const piecesHtml = (await Promise.all(piecesHtmlPromises)).join('');
      const wornCount = typeof outfit.wornCount === 'number' ? outfit.wornCount : 0;
      const kickerStatus = wornCount > 0 ? `WORN ${wornCount}×` : 'NEW LOOK';
      const tipText = outfit.layeringTips || outfit.explanation || '';

      cardEl.innerHTML = `
        <div class="outfit-card-header">
          <div>
            <span class="outfit-kicker">${escapeHtml(this.occasion.toUpperCase())}  ·  ${kickerStatus}</span>
            <h3 class="outfit-title">${escapeHtml(outfit.title || 'Curated Combination')}</h3>
          </div>
          <button type="button" class="btn-primary btn-wear-outfit">WEAR</button>
        </div>

        <div class="outfit-pieces-grid">
          ${piecesHtml}
        </div>

        <div class="outfit-video-drawer hidden" data-role="fit-video-drawer"></div>

        ${
          tipText
            ? `<div class="outfit-tip-block"><p>${escapeHtml(tipText)}</p></div>`
            : ''
        }
      `;

      // Bind inline fit video preview buttons inside the outfit card
      cardEl.querySelectorAll('.btn-preview-fit').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const videoMediaId = btn.dataset.videoMediaId;
          const gName = btn.dataset.garmentName;
          const drawer = cardEl.querySelector('[data-role="fit-video-drawer"]');
          if (!drawer || !videoMediaId) return;

          const blob = await wardrobeDb.getMediaBlob(videoMediaId).catch(() => null);
          if (!blob) {
            showToast('Fit video not found', 'error');
            return;
          }
          const vUrl = this.urlManager.createUrl(blob);
          drawer.classList.remove('hidden');
          drawer.innerHTML = `
            <div class="inline-video-header">
              <span>Fit Preview: <strong>${escapeHtml(gName)}</strong></span>
              <button type="button" class="btn-close-inline-video">Close ✕</button>
            </div>
          `;
          const player = createSafeVideoPlayer(vUrl, blob.type || 'video/mp4');
          player.className = 'outfit-inline-video';
          drawer.appendChild(player);

          drawer.querySelector('.btn-close-inline-video')?.addEventListener('click', () => {
            player.pause();
            drawer.classList.add('hidden');
            drawer.innerHTML = '';
          });
        });
      });

      // Bind "WEAR" button
      cardEl.querySelector('.btn-wear-outfit')?.addEventListener('click', () => {
        const wearModal = new WearOutfitModal({
          outfit: {
            ...outfit,
            garments: outfitGarments
          },
          onConfirmWear: async (selectedWashIds) => {
            const allOutfitIds = outfitGarments.map((g) => g.id);
            const washSet = new Set(selectedWashIds || []);
            const keepCleanWornIds = allOutfitIds.filter((id) => !washSet.has(id));

            if (selectedWashIds && selectedWashIds.length > 0) {
              await wardrobeDb.markGarmentsWorn(selectedWashIds, null, true);
            }
            if (keepCleanWornIds.length > 0) {
              await wardrobeDb.markGarmentsWorn(keepCleanWornIds, null, false);
            }

            await wardrobeDb.addOutfitHistory({
              outfitId: outfit.id,
              title: outfit.title,
              garmentIds: allOutfitIds,
              explanation: outfit.explanation,
              layeringTips: outfit.layeringTips,
              occasion: this.occasion
            });

            eventBus.emit('wardrobe:changed', { source: 'wear_outfit' });
            eventBus.emit('laundry:updated', { wornCount: selectedWashIds.length });
            showToast(
              `Outfit logged! ${selectedWashIds.length} item(s) moved to Laundry.`,
              'success'
            );

            this.garments = await wardrobeDb.getAllGarments();
            await this.render();
            await this.showRemainingCachedOutfits();
          }
        });
        wearModal.open(document.body);
      });

      outfitsMount.appendChild(cardEl);
    }
  }

  async unmount() {
    this.urlManager.revokeAll();
  }
}

export default TomorrowStylistView;
