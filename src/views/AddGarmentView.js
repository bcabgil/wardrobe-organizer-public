/**
 * AddGarmentView.js - Editorial Mobile Form with 2-Col Media Tiles, Soft Tonal Luxury Blocks,
 * 2-Second Long-Press Category Removal & Progressive Disclosure Accordion
 */

import {
  wardrobeDb,
  formatCategoryLabel,
  normalizeCategoryValue
} from '../db/wardrobeDb.js';
import { generateGarmentMetadataDescription } from '../services/ai/geminiService.js';
import { MediaUrlManager, createSafeVideoPlayer } from '../utils/mediaUtils.js';
import { escapeHtml, getUiIconSvg } from '../utils/domUtils.js';
import { eventBus } from '../utils/eventBus.js';
import { showToast } from '../components/Toast.js';
import { LoadingOverlay } from '../components/LoadingOverlay.js';

const TEMP_SHORT_MAP = {
  freezing: '<5°C',
  cold: '5–14°C',
  mild: '15–22°C',
  warm: '>22°C',
  'all-temps': 'All Temps'
};

export class AddGarmentView {
  constructor() {
    this.container = null;
    this.urlManager = new MediaUrlManager();
    this.photoFile = null;
    this.videoFile = null;
    this.isAdvancedOpen = false;
    this.lastLongPressAt = 0;
    this.longPressDurationMs = 2000;
    this.customCategories = {
      laundryCategories: ['coloured', 'whites'],
      careCategories: ['delicate', 'other'],
      occasionCategories: ['everyday', 'dress-up']
    };
    this.formState = {
      name: '',
      category: 'top',
      season: 'winter',
      tempSuitability: ['cold'],
      layerRole: 'base',
      colorGroup: 'coloured',
      careCategory: 'other',
      delicate: false,
      status: 'clean',
      type: ['everyday'],
      userDetails: '',
      visualDescription: ''
    };
  }

  async mount(container) {
    this.container = container;
    const [settings, customCategories] = await Promise.all([
      wardrobeDb.getSettings(),
      wardrobeDb.getCustomCategories()
    ]);
    if (customCategories) {
      this.customCategories = customCategories;
    }
    if (settings && settings.activeSeason) {
      this.formState.season = settings.activeSeason;
      this.formState.tempSuitability = [settings.activeSeason === 'winter' ? 'cold' : 'warm'];
    }
    if (!this.customCategories.laundryCategories.includes(this.formState.colorGroup)) {
      this.formState.colorGroup = this.customCategories.laundryCategories[0] || 'coloured';
    }
    if (!this.customCategories.careCategories.includes(this.formState.careCategory)) {
      this.formState.careCategory = this.customCategories.careCategories.includes('other')
        ? 'other'
        : this.customCategories.careCategories[0] || 'other';
      this.formState.delicate = this.formState.careCategory === 'delicate';
    }
    const currentOccasions = Array.isArray(this.formState.type)
      ? this.formState.type.map((v) => normalizeCategoryValue(v)).filter(Boolean)
      : [normalizeCategoryValue(this.formState.type || 'everyday')].filter(Boolean);
    const validOccasions = currentOccasions.filter((occ) =>
      this.customCategories.occasionCategories.some((c) => normalizeCategoryValue(c) === occ)
    );
    this.formState.type =
      validOccasions.length > 0
        ? validOccasions
        : [this.customCategories.occasionCategories[0] || 'everyday'];
    this.render();
  }

  isTempSelected(val) {
    const cur = this.formState.tempSuitability;
    if (Array.isArray(cur)) return cur.includes(val);
    return cur === val;
  }

  getAdvancedSummaryText() {
    const seasonLabel = formatCategoryLabel(this.formState.season || 'winter');
    const layerLabel = formatCategoryLabel(this.formState.layerRole || 'base');
    const temps = Array.isArray(this.formState.tempSuitability)
      ? this.formState.tempSuitability
      : [this.formState.tempSuitability || 'cold'];
    const tempLabel = temps.map((t) => TEMP_SHORT_MAP[t] || t).join(', ');
    const statusLabel = this.formState.status === 'to_wash' ? 'To Wash' : 'Clean';
    return `Advanced Details  ·  ${seasonLabel} · ${layerLabel} · ${tempLabel} · ${statusLabel}`;
  }

  renderCustomizableCategoryPills(groupKey, fieldName) {
    const categories = this.customCategories[groupKey] || [];
    const isMulti = fieldName === 'type';
    const activeValues = Array.isArray(this.formState[fieldName])
      ? this.formState[fieldName].map((v) => normalizeCategoryValue(v))
      : [normalizeCategoryValue(this.formState[fieldName])];
    const pillsHtml = categories
      .map((cat) => {
        const normCat = normalizeCategoryValue(cat);
        const isActive = activeValues.includes(normCat);
        const label = formatCategoryLabel(cat);
        return `
          <span class="pill-chip-wrap" data-chip-wrap="${escapeHtml(normCat)}">
            <button type="button" class="pill-btn ${isActive ? 'active' : ''}" data-val="${escapeHtml(normCat)}" data-longpress-cat="true">${escapeHtml(label)}</button>
            <button type="button" class="pill-remove-btn" data-remove-cat="${escapeHtml(normCat)}" data-cat-group="${escapeHtml(groupKey)}" data-field="${escapeHtml(fieldName)}" title="Remove ${escapeHtml(label)}" aria-label="Remove ${escapeHtml(label)}">×</button>
          </span>
        `;
      })
      .join('');

    return `
      <div class="pill-selector" data-field="${escapeHtml(fieldName)}" data-cat-group="${escapeHtml(groupKey)}"${isMulti ? ' data-multi="true"' : ''}>
        ${pillsHtml}
        <button type="button" class="pill-btn pill-add-btn" data-toggle-add-cat="${escapeHtml(groupKey)}" title="Add category" aria-label="Add category">+</button>
      </div>
      <div class="custom-cat-input-row hidden" data-add-cat-row="${escapeHtml(groupKey)}">
        <input type="text" class="form-input custom-cat-input" data-cat-input="${escapeHtml(groupKey)}" placeholder="New category name..." />
        <button type="button" class="btn-secondary btn-confirm-cat" data-confirm-add-cat="${escapeHtml(groupKey)}" data-field="${escapeHtml(fieldName)}">Add</button>
      </div>
    `;
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <section class="view-section add-garment-view">
        <div class="section-header">
          <h2>New Piece</h2>
        </div>

        <form id="add-garment-form" class="garment-form card-surface">
          <!-- SIDE-BY-SIDE 2-COLUMN MEDIA UPLOADERS -->
          <div class="media-upload-grid">
            <div class="media-upload-box">
              <label class="media-picker-label" for="input-garment-photo">
                <div id="photo-preview-slot" class="media-preview-slot">
                  ${getUiIconSvg('camera')}
                  <strong>+ Photo</strong>
                </div>
              </label>
              <input type="file" id="input-garment-photo" accept="image/*" class="sr-only-input" />
            </div>

            <div class="media-upload-box">
              <label class="media-picker-label" for="input-garment-video">
                <div id="video-preview-slot" class="media-preview-slot">
                  ${getUiIconSvg('video')}
                  <strong>+ Fit Video</strong>
                </div>
              </label>
              <input type="file" id="input-garment-video" accept="video/*" class="sr-only-input" />
            </div>
          </div>

          <!-- GARMENT NAME -->
          <div class="form-group">
            <label class="form-label" for="garment-name-input">NAME</label>
            <input type="text" id="garment-name-input" name="name" class="form-input" placeholder="e.g., Double-Breasted Wool Coat" value="${escapeHtml(this.formState.name || '')}" required />
          </div>

          <!-- CATEGORY (2-Column Soft Tonal Luxury Blocks) -->
          <div class="form-group">
            <span class="form-label">CATEGORY</span>
            <div class="pill-selector pill-grid-2" data-field="category">
              <button type="button" class="pill-btn ${this.formState.category === 'top' ? 'active' : ''}" data-val="top">Top</button>
              <button type="button" class="pill-btn ${this.formState.category === 'bottom' ? 'active' : ''}" data-val="bottom">Bottom</button>
              <button type="button" class="pill-btn ${this.formState.category === 'outerwear' ? 'active' : ''}" data-val="outerwear">Outerwear</button>
              <button type="button" class="pill-btn ${this.formState.category === 'one-piece' ? 'active' : ''}" data-val="one-piece">One-Piece</button>
              <button type="button" class="pill-btn ${this.formState.category === 'shoes' ? 'active' : ''}" data-val="shoes">Shoes</button>
              <button type="button" class="pill-btn ${this.formState.category === 'accessory' ? 'active' : ''}" data-val="accessory">Accessory</button>
            </div>
          </div>

          <!-- CUSTOMIZABLE CORE CATEGORIES (Occasion, Laundry, Care) -->
          <div class="form-group">
            <div class="form-label-row">
              <span class="form-label">OCCASION</span>
              <span class="form-label-hint">Hold 2s to remove</span>
            </div>
            ${this.renderCustomizableCategoryPills('occasionCategories', 'type')}
          </div>

          <div class="form-group">
            <div class="form-label-row">
              <span class="form-label">LAUNDRY</span>
              <span class="form-label-hint">Hold 2s to remove</span>
            </div>
            ${this.renderCustomizableCategoryPills('laundryCategories', 'colorGroup')}
          </div>

          <div class="form-group">
            <div class="form-label-row">
              <span class="form-label">CARE</span>
              <span class="form-label-hint">Hold 2s to remove</span>
            </div>
            ${this.renderCustomizableCategoryPills('careCategories', 'careCategory')}
          </div>

          <!-- PROGRESSIVE DISCLOSURE ACCORDION: ADVANCED DETAILS -->
          <div class="advanced-details-drawer">
            <button type="button" class="advanced-drawer-toggle" id="btn-toggle-advanced-details">
              <span class="advanced-drawer-title" id="advanced-drawer-summary">${escapeHtml(this.getAdvancedSummaryText())}</span>
              ${getUiIconSvg('chevron-down')}
            </button>

            <div class="advanced-drawer-body ${this.isAdvancedOpen ? '' : 'hidden'}" id="advanced-drawer-body">
              <div class="form-group">
                <span class="form-label">SEASON</span>
                <div class="pill-selector" data-field="season">
                  <button type="button" class="pill-btn ${this.formState.season === 'winter' ? 'active' : ''}" data-val="winter">Winter</button>
                  <button type="button" class="pill-btn ${this.formState.season === 'summer' ? 'active' : ''}" data-val="summer">Summer</button>
                  <button type="button" class="pill-btn ${this.formState.season === 'all-season' ? 'active' : ''}" data-val="all-season">All-Season</button>
                </div>
              </div>

              <div class="form-group">
                <span class="form-label">LAYER</span>
                <div class="pill-selector" data-field="layerRole">
                  <button type="button" class="pill-btn ${this.formState.layerRole === 'base' ? 'active' : ''}" data-val="base">Base</button>
                  <button type="button" class="pill-btn ${this.formState.layerRole === 'mid' ? 'active' : ''}" data-val="mid">Mid</button>
                  <button type="button" class="pill-btn ${this.formState.layerRole === 'outer' ? 'active' : ''}" data-val="outer">Outer</button>
                  <button type="button" class="pill-btn ${this.formState.layerRole === 'single' ? 'active' : ''}" data-val="single">Single</button>
                </div>
              </div>

              <div class="form-group">
                <span class="form-label">TEMPERATURE SUITABILITY</span>
                <div class="pill-selector" data-field="tempSuitability" data-multi="true">
                  <button type="button" class="pill-btn ${this.isTempSelected('freezing') ? 'active' : ''}" data-val="freezing">&lt;5°C</button>
                  <button type="button" class="pill-btn ${this.isTempSelected('cold') ? 'active' : ''}" data-val="cold">5–14°C</button>
                  <button type="button" class="pill-btn ${this.isTempSelected('mild') ? 'active' : ''}" data-val="mild">15–22°C</button>
                  <button type="button" class="pill-btn ${this.isTempSelected('warm') ? 'active' : ''}" data-val="warm">&gt;22°C</button>
                  <button type="button" class="pill-btn ${this.isTempSelected('all-temps') ? 'active' : ''}" data-val="all-temps">All Temps</button>
                </div>
              </div>

              <div class="form-group">
                <span class="form-label">STATUS</span>
                <div class="pill-selector" data-field="status">
                  <button type="button" class="pill-btn ${this.formState.status === 'clean' ? 'active' : ''}" data-val="clean">Clean</button>
                  <button type="button" class="pill-btn ${this.formState.status === 'to_wash' ? 'active' : ''}" data-val="to_wash">To Wash</button>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label" for="garment-desc-input">NOTES &amp; DETAILS</label>
                <textarea id="garment-desc-input" name="userDetails" class="form-textarea" rows="2" placeholder="Optional">${escapeHtml(this.formState.userDetails || '')}</textarea>
              </div>
            </div>
          </div>

          <div class="form-submit-row">
            <button type="submit" class="btn-primary btn-block">Save to Wardrobe</button>
          </div>
        </form>
      </section>
    `;

    this.restoreMediaPreviews();
    this.bindEvents();
  }

  syncInputsToFormState() {
    if (!this.container) return;
    const nameInput = this.container.querySelector('#garment-name-input');
    const descInput = this.container.querySelector('#garment-desc-input');
    if (nameInput) this.formState.name = nameInput.value;
    if (descInput) this.formState.userDetails = descInput.value;
  }

  updateAdvancedSummaryDom() {
    if (!this.container) return;
    const summaryEl = this.container.querySelector('#advanced-drawer-summary');
    if (summaryEl) {
      summaryEl.textContent = this.getAdvancedSummaryText();
    }
  }

  restoreMediaPreviews() {
    if (!this.container) return;
    const photoPreview = this.container.querySelector('#photo-preview-slot');
    const videoPreview = this.container.querySelector('#video-preview-slot');

    if (this.photoFile && photoPreview) {
      const previewUrl = this.urlManager.createUrl(this.photoFile);
      photoPreview.innerHTML = `<img src="${previewUrl}" alt="Selected Garment Preview" class="upload-preview-img" />`;
    }
    if (this.videoFile && videoPreview) {
      const videoUrl = this.urlManager.createUrl(this.videoFile);
      videoPreview.innerHTML = '';
      const player = createSafeVideoPlayer(videoUrl, this.videoFile.type || 'video/mp4');
      player.className = 'upload-preview-video';
      videoPreview.appendChild(player);
    }
  }

  bindEvents() {
    if (!this.container) return;

    // Progressive Disclosure Accordion Toggle
    this.container.querySelector('#btn-toggle-advanced-details')?.addEventListener('click', () => {
      this.isAdvancedOpen = !this.isAdvancedOpen;
      const body = this.container.querySelector('#advanced-drawer-body');
      if (body) body.classList.toggle('hidden', !this.isAdvancedOpen);
    });

    // 2-Second Long-Press (2000ms) on Custom Category Pills to Reveal '×' Remove Button
    this.container.querySelectorAll('.pill-btn[data-longpress-cat="true"]').forEach((btn) => {
      let pressTimer = null;
      let longPressTriggered = false;
      let isPressing = false;
      let startX = 0;
      let startY = 0;

      const triggerLongPress = () => {
        pressTimer = null;
        if (!isPressing) return;
        longPressTriggered = true;
        this.lastLongPressAt = Date.now();
        const wrap = btn.closest('.pill-chip-wrap');
        if (wrap) {
          wrap.classList.add('show-remove');
        }
      };

      const startPress = (clientX = 0, clientY = 0) => {
        isPressing = true;
        longPressTriggered = false;
        startX = clientX;
        startY = clientY;
        if (pressTimer) clearTimeout(pressTimer);
        if (this.longPressDurationMs <= 0) {
          Promise.resolve().then(triggerLongPress);
        } else {
          pressTimer = setTimeout(triggerLongPress, this.longPressDurationMs || 2000);
        }
      };

      const cancelPress = () => {
        isPressing = false;
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
      };

      btn.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        startPress(e.clientX || 0, e.clientY || 0);
      });
      btn.addEventListener('pointermove', (e) => {
        if (!isPressing) return;
        if ((e.clientX || e.clientY) && Math.hypot((e.clientX || 0) - startX, (e.clientY || 0) - startY) > 20) {
          cancelPress();
        }
      });
      btn.addEventListener('pointerup', cancelPress);
      btn.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'mouse') {
          cancelPress();
        }
      });

      btn.addEventListener(
        'touchstart',
        (e) => {
          const t = e.touches && e.touches[0];
          startPress(t ? t.clientX : 0, t ? t.clientY : 0);
        },
        { passive: true }
      );
      btn.addEventListener(
        'touchmove',
        (e) => {
          if (!isPressing) return;
          const t = e.touches && e.touches[0];
          if (t && Math.hypot(t.clientX - startX, t.clientY - startY) > 20) {
            cancelPress();
          }
        },
        { passive: true }
      );
      btn.addEventListener('touchend', (e) => {
        cancelPress();
        if (longPressTriggered && e.cancelable) {
          e.preventDefault();
        }
      });
      btn.addEventListener('touchcancel', cancelPress);

      btn.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || isPressing) return;
        startPress(e.clientX || 0, e.clientY || 0);
      });
      btn.addEventListener('mouseup', cancelPress);

      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      btn.addEventListener('selectstart', (e) => {
        e.preventDefault();
      });

      btn.dataset.suppressNextClick = 'false';
      btn.addEventListener(
        'click',
        (e) => {
          if (longPressTriggered || (this.lastLongPressAt && Date.now() - this.lastLongPressAt < 450)) {
            e.stopImmediatePropagation();
            e.preventDefault();
            longPressTriggered = false;
          }
        },
        true
      );
    });

    // Dismiss visible '×' remove badges when tapping elsewhere in the form
    const formEl = this.container.querySelector('#add-garment-form');
    formEl?.addEventListener('click', (e) => {
      if (this.lastLongPressAt && Date.now() - this.lastLongPressAt < 450) return;
      if (!e.target.closest('.pill-chip-wrap')) {
        formEl.querySelectorAll('.pill-chip-wrap.show-remove').forEach((w) => {
          w.classList.remove('show-remove');
        });
      }
    });

    // Pill selectors (with multi-select support for tempSuitability and type/occasion)
    this.container.querySelectorAll('.pill-selector').forEach((groupEl) => {
      const field = groupEl.dataset.field;
      const isMulti = groupEl.dataset.multi === 'true' || field === 'tempSuitability' || field === 'type';
      groupEl.querySelectorAll('.pill-btn[data-val]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const rawVal = btn.dataset.val;
          if (isMulti) {
            let current = Array.isArray(this.formState[field])
              ? [...this.formState[field]]
              : this.formState[field]
                ? [this.formState[field]]
                : [];

            if (field === 'tempSuitability') {
              if (rawVal === 'all-temps') {
                current = ['all-temps'];
              } else {
                current = current.filter((v) => v !== 'all-temps');
                if (current.includes(rawVal)) {
                  current = current.filter((v) => v !== rawVal);
                } else {
                  current.push(rawVal);
                }
                if (current.length === 0) {
                  current = ['all-temps'];
                }
              }
            } else {
              const normRaw = normalizeCategoryValue(rawVal);
              current = current.map((v) => normalizeCategoryValue(v)).filter(Boolean);
              if (current.includes(normRaw)) {
                current = current.filter((v) => v !== normRaw);
              } else {
                current.push(normRaw);
              }
              if (current.length === 0) {
                current = [normRaw];
              }
            }

            this.formState[field] = current;
            groupEl.querySelectorAll('.pill-btn[data-val]').forEach((b) => {
              b.classList.toggle('active', current.includes(b.dataset.val));
            });
          } else {
            this.formState[field] = rawVal;
            if (field === 'careCategory') {
              this.formState.delicate = normalizeCategoryValue(rawVal) === 'delicate';
            }
            groupEl.querySelectorAll('.pill-btn[data-val]').forEach((b) => b.classList.toggle('active', b === btn));
          }
          this.updateAdvancedSummaryDom();
        });
      });
    });

    // Toggle inline input for adding a custom category ('+' button)
    this.container.querySelectorAll('[data-toggle-add-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const groupKey = btn.dataset.toggleAddCat;
        const row = this.container.querySelector(`[data-add-cat-row="${groupKey}"]`);
        if (row) {
          row.classList.toggle('hidden');
          const input = row.querySelector(`[data-cat-input="${groupKey}"]`);
          if (input && !row.classList.contains('hidden') && input.isConnected) {
            input.focus();
          }
        }
      });
    });

    // Confirm adding a custom category
    const handleAddCategory = async (groupKey, fieldName) => {
      const input = this.container.querySelector(`[data-cat-input="${groupKey}"]`);
      const rawLabel = String(input?.dataset?.testValue || input?.value || '').trim();
      if (!rawLabel) return;
      this.syncInputsToFormState();
      const added = await wardrobeDb.addCategoryOption(groupKey, rawLabel);
      if (added) {
        this.customCategories[groupKey] = added.list;
        if (fieldName === 'type') {
          const cur = Array.isArray(this.formState.type)
            ? [...this.formState.type]
            : this.formState.type
              ? [this.formState.type]
              : [];
          if (!cur.includes(added.value)) {
            cur.push(added.value);
          }
          this.formState.type = cur;
        } else {
          this.formState[fieldName] = added.value;
          if (fieldName === 'careCategory') {
            this.formState.delicate = added.value === 'delicate';
          }
        }
        eventBus.emit('categories:changed', { groupKey, list: added.list });
        showToast(`Added "${formatCategoryLabel(added.value)}" category`, 'success');
        this.render();
      }
    };

    this.container.querySelectorAll('[data-confirm-add-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._lastAddPromise = handleAddCategory(btn.dataset.confirmAddCat, btn.dataset.field);
      });
    });

    this.container.querySelectorAll('[data-cat-input]').forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const groupKey = input.dataset.catInput;
          const confirmBtn = this.container.querySelector(`[data-confirm-add-cat="${groupKey}"]`);
          if (confirmBtn) {
            this._lastAddPromise = handleAddCategory(groupKey, confirmBtn.dataset.field);
          }
        }
      });
    });

    // Remove a category option (when '×' is tapped)
    this.container.querySelectorAll('[data-remove-cat]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const groupKey = btn.dataset.catGroup;
        const fieldName = btn.dataset.field;
        const catToRemove = btn.dataset.removeCat;
        this._lastRemovePromise = this.handleRemoveCategory(groupKey, fieldName, catToRemove);
      });
    });

    // Photo input
    const photoInput = this.container.querySelector('#input-garment-photo');
    const photoPreview = this.container.querySelector('#photo-preview-slot');

    photoInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      this.photoFile = file;
      const previewUrl = this.urlManager.createUrl(file);
      if (photoPreview) {
        photoPreview.innerHTML = `<img src="${previewUrl}" alt="Selected Garment Preview" class="upload-preview-img" />`;
      }
    });

    // Fit Video input
    const videoInput = this.container.querySelector('#input-garment-video');
    const videoPreview = this.container.querySelector('#video-preview-slot');

    videoInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      this.videoFile = file;
      const videoUrl = this.urlManager.createUrl(file);
      if (videoPreview) {
        videoPreview.innerHTML = '';
        const player = createSafeVideoPlayer(videoUrl, file.type || 'video/mp4');
        player.className = 'upload-preview-video';
        videoPreview.appendChild(player);
      }
    });

    // Form submission — single optimized AI call on save to generate AI metadata description + user details
    const form = this.container.querySelector('#add-garment-form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameInput = this.container.querySelector('#garment-name-input');
      const descInput = this.container.querySelector('#garment-desc-input');
      const userDetails = String(descInput?.value || '').trim();

      const garmentData = {
        ...this.formState,
        delicate: normalizeCategoryValue(this.formState.careCategory) === 'delicate',
        name: String(nameInput?.value || '').trim() || 'Untitled Garment',
        userDetails
      };

      try {
        LoadingOverlay.show('Saving piece...');
        const settings = await wardrobeDb.getSettings();
        const { garmentDetected, rejectionReason, visualDescription } =
          await generateGarmentMetadataDescription(
            garmentData,
            this.photoFile,
            settings.geminiApiKey || '',
            this.videoFile
          );

        if (garmentDetected === false) {
          showToast(
            `No garment detected in the photo (${rejectionReason || 'No wearable item identified'}). Saving cancelled.`,
            'error'
          );
          return;
        }

        garmentData.visualDescription = visualDescription;

        const saved = await wardrobeDb.saveGarment(garmentData, this.photoFile, this.videoFile);
        eventBus.emit('wardrobe:changed', { garment: saved });
        if (saved.status === 'to_wash') {
          eventBus.emit('laundry:updated', { garment: saved });
        }
        showToast(`Added "${saved.name}" to your wardrobe!`, 'success');
        window.location.hash = '#gallery';
      } catch (err) {
        showToast(`Failed to save garment: ${err.message}`, 'error');
      } finally {
        LoadingOverlay.hide();
      }
    });
  }

  async handleRemoveCategory(groupKey, fieldName, catToRemove) {
    const currentList = this.customCategories[groupKey] || [];
    if (currentList.length <= 1) {
      showToast('Keep at least one category in this group, or add another first.', 'info');
      return currentList;
    }
    this.syncInputsToFormState();
    const updatedList = await wardrobeDb.removeCategoryOption(groupKey, catToRemove);
    this.customCategories[groupKey] = updatedList;
    if (Array.isArray(this.formState[fieldName])) {
      const normRem = normalizeCategoryValue(catToRemove);
      const nextVals = this.formState[fieldName]
        .map((v) => normalizeCategoryValue(v))
        .filter((v) => v && v !== normRem);
      this.formState[fieldName] = nextVals.length > 0 ? nextVals : [updatedList[0] || 'everyday'];
    } else if (normalizeCategoryValue(this.formState[fieldName]) === normalizeCategoryValue(catToRemove)) {
      this.formState[fieldName] = updatedList[0] || '';
      if (fieldName === 'careCategory') {
        this.formState.delicate = normalizeCategoryValue(this.formState.careCategory) === 'delicate';
      }
    }
    eventBus.emit('categories:changed', { groupKey, list: updatedList });
    eventBus.emit('wardrobe:changed', { source: 'category_removed', groupKey, removed: catToRemove });
    eventBus.emit('laundry:updated', { source: 'category_removed', groupKey, removed: catToRemove });
    showToast(`Removed "${formatCategoryLabel(catToRemove)}" category`, 'info');
    this.render();
    return updatedList;
  }

  async unmount() {
    this.urlManager.revokeAll();
  }
}

export default AddGarmentView;
