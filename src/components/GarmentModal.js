/**
 * GarmentModal.js - Slide-Up Garment Detail Bottom Sheet with Photo/Fit Video Carousel, Top Edit Button & 2-Column Spec Table
 */

import { escapeHtml, getCategoryIconSvg, getUiIconSvg } from '../utils/domUtils.js';
import { createSafeVideoPlayer, MediaUrlManager } from '../utils/mediaUtils.js';
import {
  wardrobeDb,
  formatCategoryLabel,
  getGarmentCareCategory,
  getGarmentOccasionList,
  normalizeCategoryValue
} from '../db/wardrobeDb.js';
import { eventBus } from '../utils/eventBus.js';
import { showToast } from './Toast.js';

const TEMP_SHORT_LABELS = {
  freezing: '<5°C',
  cold: '5–14°C',
  mild: '15–22°C',
  warm: '>22°C',
  'all-temps': 'All Temps'
};

export class GarmentModal {
  constructor(options = {}) {
    this.garment = options.garment || {};
    this.onClose = options.onClose || null;
    this.onUpdated = options.onUpdated || null;
    this.onDeleted = options.onDeleted || null;
    this.onStyleWithItem = options.onStyleWithItem || null;
    this.urlManager = new MediaUrlManager();
    this.isEditing = false;
    this.carouselIndex = 0; // 0 = Photo, 1 = Fit Video
    this.modalEl = null;
  }

  async open(container = document.body) {
    const g = this.garment;
    let photoUrl = null;
    let videoUrl = null;
    let videoMime = 'video/mp4';

    if (g.photoMediaId) {
      const blob = await wardrobeDb.getMediaBlob(g.photoMediaId).catch(() => null);
      if (blob) photoUrl = this.urlManager.createUrl(blob);
    }

    if (g.videoMediaId) {
      const mediaRec = await wardrobeDb.getMedia(g.videoMediaId).catch(() => null);
      const blob = await wardrobeDb.getMediaBlob(g.videoMediaId).catch(() => null);
      if (blob) {
        videoUrl = this.urlManager.createUrl(blob);
        videoMime = (mediaRec && mediaRec.mimeType) || blob.type || 'video/mp4';
      }
    }

    this.customCategories = await wardrobeDb.getCustomCategories().catch(() => ({
      laundryCategories: ['coloured', 'whites'],
      careCategories: ['delicate', 'other'],
      occasionCategories: ['everyday', 'dress-up']
    }));

    this.modalEl = this.render({ photoUrl, videoUrl, videoMime });
    container.appendChild(this.modalEl);
    return this.modalEl;
  }

  render({ photoUrl = null, videoUrl = null, videoMime = 'video/mp4' } = {}) {
    const g = this.garment || {};
    const wrapper = document.createElement('div');
    wrapper.className = 'modal-backdrop';
    wrapper.dataset.modal = 'garment-detail';

    const isClean = g.status !== 'to_wash';
    const currentTemps = Array.isArray(g.tempSuitability)
      ? [...g.tempSuitability]
      : typeof g.tempSuitability === 'string' && g.tempSuitability
        ? g.tempSuitability.split(',').map((s) => s.trim())
        : ['all-temps'];
    this.editTempSuitability = currentTemps.length > 0 ? currentTemps : ['all-temps'];
    const tempDisplayLabel = this.editTempSuitability
      .map((t) => TEMP_SHORT_LABELS[t] || t)
      .join(', ');

    const currentCareCat = getGarmentCareCategory(g);
    const cats = this.customCategories || {
      laundryCategories: ['coloured', 'whites'],
      careCategories: ['delicate', 'other'],
      occasionCategories: ['everyday', 'dress-up']
    };
    const mergeUnique = (list, currentVal) => {
      const base = Array.isArray(list) ? [...list] : [];
      const curList = Array.isArray(currentVal) ? currentVal : [currentVal];
      for (const item of curList) {
        const normCur = normalizeCategoryValue(item);
        if (normCur && !base.some((x) => normalizeCategoryValue(x) === normCur)) {
          base.push(normCur);
        }
      }
      return base;
    };
    this.editOccasions = getGarmentOccasionList(g);
    const laundryOptions = mergeUnique(cats.laundryCategories, g.colorGroup || 'coloured');
    const careOptions = mergeUnique(cats.careCategories, currentCareCat);
    const occasionOptions = mergeUnique(cats.occasionCategories, this.editOccasions);

    const seasonLabel = formatCategoryLabel(g.season || 'all-season');
    const catAndLayerLabel = `${formatCategoryLabel(g.category || 'top')} · ${formatCategoryLabel(g.layerRole || 'base')}`;
    const laundryAndCareLabel = `${formatCategoryLabel(g.colorGroup || 'coloured')} · ${formatCategoryLabel(currentCareCat)}`;

    wrapper.innerHTML = `
      <div class="modal-sheet">
        <div class="sheet-drag-handle"></div>
        <div class="modal-header">
          <h3 class="modal-title">${escapeHtml(g.name || 'Garment Details')}</h3>
          <div class="modal-header-actions">
            <button type="button" class="modal-edit-btn" data-action="toggle-edit">Edit</button>
            <button type="button" class="modal-close-btn" data-action="close-modal" aria-label="Close">✕</button>
          </div>
        </div>

        <div class="modal-body">
          <!-- DETAIL VIEW WITH MEDIA CAROUSEL -->
          <div class="modal-panel" data-panel="detail">
            <div class="modal-carousel" data-role="media-carousel">
              <span class="carousel-indicator-pill" data-role="carousel-indicator">1 / 2 · PHOTO</span>

              <div class="carousel-slide" data-slide="0">
                ${
                  photoUrl
                    ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(g.name)}" class="modal-detail-img" />`
                    : `<div class="modal-placeholder-box">${getCategoryIconSvg(g.category)}</div>`
                }
              </div>

              <div class="carousel-slide hidden" data-slide="1" id="modal-video-slot">
                ${
                  videoUrl
                    ? ''
                    : `<div class="modal-placeholder-box"><span class="text-muted">No fit video uploaded yet. Tap Edit above to add one.</span></div>`
                }
              </div>

              <button type="button" class="carousel-nav-btn carousel-nav-prev" data-action="carousel-prev" aria-label="Previous slide">
                ${getUiIconSvg('chevron-left')}
              </button>
              <button type="button" class="carousel-nav-btn carousel-nav-next" data-action="carousel-next" aria-label="Next slide">
                ${getUiIconSvg('chevron-right')}
              </button>

              <div class="carousel-dots">
                <button type="button" class="carousel-dot active" data-slide-dot="0" aria-label="Photo"></button>
                <button type="button" class="carousel-dot" data-slide-dot="1" aria-label="Fit Video"></button>
              </div>
            </div>

            <div class="modal-spec-table">
              <div class="spec-row">
                <div class="spec-cell">
                  <span class="spec-label">OCCASION</span>
                  <span class="spec-val">${escapeHtml(formatCategoryLabel(g.type || 'everyday'))}</span>
                </div>
                <div class="spec-cell">
                  <span class="spec-label">SEASON</span>
                  <span class="spec-val">${escapeHtml(seasonLabel)}</span>
                </div>
              </div>
              <div class="spec-row">
                <div class="spec-cell">
                  <span class="spec-label">CATEGORY</span>
                  <span class="spec-val">${escapeHtml(catAndLayerLabel)}</span>
                </div>
                <div class="spec-cell">
                  <span class="spec-label">TEMPERATURE</span>
                  <span class="spec-val">${escapeHtml(tempDisplayLabel)}</span>
                </div>
              </div>
              <div class="spec-row">
                <div class="spec-cell">
                  <span class="spec-label">LAUNDRY &amp; CARE</span>
                  <span class="spec-val">${escapeHtml(laundryAndCareLabel)}</span>
                </div>
                <div class="spec-cell">
                  <span class="spec-label">STATUS</span>
                  <span class="spec-val">${isClean ? 'Clean' : 'To Wash'}</span>
                </div>
              </div>
            </div>

            ${
              g.visualDescription
                ? `<p class="modal-visual-desc">${escapeHtml(g.visualDescription)}</p>`
                : ''
            }
          </div>

          <!-- EDIT PANEL (Toggled via Top Header Edit Button) -->
          <div class="modal-panel hidden" data-panel="edit">
            <form id="edit-garment-form" class="garment-form">
              <label class="form-label">NAME
                <input type="text" name="name" class="form-input" value="${escapeHtml(g.name || '')}" required />
              </label>

              <div class="form-row-2 keep-2col-mobile">
                <label class="form-label">SEASON
                  <select name="season" class="form-select">
                    <option value="winter" ${g.season === 'winter' ? 'selected' : ''}>Winter</option>
                    <option value="summer" ${g.season === 'summer' ? 'selected' : ''}>Summer</option>
                    <option value="all-season" ${g.season === 'all-season' ? 'selected' : ''}>All-Season</option>
                  </select>
                </label>
                <label class="form-label">CATEGORY
                  <select name="category" class="form-select">
                    <option value="top" ${g.category === 'top' ? 'selected' : ''}>Top</option>
                    <option value="bottom" ${g.category === 'bottom' ? 'selected' : ''}>Bottom</option>
                    <option value="outerwear" ${g.category === 'outerwear' ? 'selected' : ''}>Outerwear</option>
                    <option value="one-piece" ${g.category === 'one-piece' ? 'selected' : ''}>One-Piece</option>
                    <option value="shoes" ${g.category === 'shoes' ? 'selected' : ''}>Shoes</option>
                    <option value="accessory" ${g.category === 'accessory' ? 'selected' : ''}>Accessory</option>
                  </select>
                </label>
              </div>

              <div class="form-row-2 keep-2col-mobile">
                <label class="form-label">LAYER ROLE
                  <select name="layerRole" class="form-select">
                    <option value="base" ${g.layerRole === 'base' ? 'selected' : ''}>Base</option>
                    <option value="mid" ${g.layerRole === 'mid' ? 'selected' : ''}>Mid</option>
                    <option value="outer" ${g.layerRole === 'outer' ? 'selected' : ''}>Outer</option>
                    <option value="single" ${g.layerRole === 'single' ? 'selected' : ''}>Single</option>
                  </select>
                </label>
                <label class="form-label">STATUS
                  <select name="status" class="form-select">
                    <option value="clean" ${isClean ? 'selected' : ''}>Clean</option>
                    <option value="to_wash" ${!isClean ? 'selected' : ''}>To Wash</option>
                  </select>
                </label>
              </div>

              <div class="form-group">
                <span class="form-label">TEMPERATURE SUITABILITY</span>
                <div class="pill-selector" data-field="editTempSuitability" data-multi="true">
                  <button type="button" class="pill-btn ${this.editTempSuitability.includes('freezing') ? 'active' : ''}" data-value="freezing">&lt;5°C</button>
                  <button type="button" class="pill-btn ${this.editTempSuitability.includes('cold') ? 'active' : ''}" data-value="cold">5–14°C</button>
                  <button type="button" class="pill-btn ${this.editTempSuitability.includes('mild') ? 'active' : ''}" data-value="mild">15–22°C</button>
                  <button type="button" class="pill-btn ${this.editTempSuitability.includes('warm') ? 'active' : ''}" data-value="warm">&gt;22°C</button>
                  <button type="button" class="pill-btn ${this.editTempSuitability.includes('all-temps') ? 'active' : ''}" data-value="all-temps">All Temps</button>
                </div>
              </div>

              <div class="form-group">
                <span class="form-label">OCCASION</span>
                <div class="pill-selector" data-field="editOccasions" data-multi="true">
                  ${occasionOptions
                    .map((opt) => {
                      const normOpt = normalizeCategoryValue(opt);
                      return `<button type="button" class="pill-btn ${this.editOccasions.includes(normOpt) ? 'active' : ''}" data-value="${escapeHtml(normOpt)}">${escapeHtml(formatCategoryLabel(opt))}</button>`;
                    })
                    .join('')}
                </div>
              </div>

              <div class="form-row-2 keep-2col-mobile">
                <label class="form-label">LAUNDRY
                  <select name="colorGroup" class="form-select">
                    ${laundryOptions
                      .map(
                        (opt) =>
                          `<option value="${escapeHtml(opt)}" ${normalizeCategoryValue(g.colorGroup || 'coloured') === normalizeCategoryValue(opt) ? 'selected' : ''}>${escapeHtml(formatCategoryLabel(opt))}</option>`
                      )
                      .join('')}
                  </select>
                </label>
                <label class="form-label">CARE
                  <select name="careCategory" class="form-select">
                    ${careOptions
                      .map(
                        (opt) =>
                          `<option value="${escapeHtml(opt)}" ${normalizeCategoryValue(currentCareCat) === normalizeCategoryValue(opt) ? 'selected' : ''}>${escapeHtml(formatCategoryLabel(opt))}</option>`
                      )
                      .join('')}
                  </select>
                </label>
              </div>

              <div class="form-group">
                <label class="form-label">FIT VIDEO
                  <input type="file" name="newVideo" id="edit-new-video-input" accept="video/*" class="form-input" />
                </label>
              </div>

              <label class="form-label">STYLE &amp; FIT NOTES
                <textarea name="visualDescription" class="form-textarea" rows="2">${escapeHtml(g.visualDescription || '')}</textarea>
              </label>

              <div class="modal-edit-actions">
                <button type="button" class="btn-danger" data-action="delete-garment">Delete</button>
              </div>
            </form>
          </div>
        </div>

        <div class="modal-footer" data-role="modal-footer">
          ${
            isClean
              ? `<button type="button" class="btn-primary" data-action="style-anchor">Build Outfit With This Piece</button>`
              : `<button type="button" class="btn-secondary" data-action="quick-clean">Mark Clean to Style</button>`
          }
        </div>
      </div>
    `;

    // Mount safe inline video element if videoUrl exists
    let videoPlayer = null;
    if (videoUrl) {
      const slot = wrapper.querySelector('#modal-video-slot');
      if (slot) {
        videoPlayer = createSafeVideoPlayer(videoUrl, videoMime);
        videoPlayer.className = 'modal-fit-video';
        slot.appendChild(videoPlayer);
      }
    }

    // Carousel navigation logic
    const slides = wrapper.querySelectorAll('[data-slide]');
    const dots = wrapper.querySelectorAll('[data-slide-dot]');
    const indicatorEl = wrapper.querySelector('[data-role="carousel-indicator"]');

    const setCarouselSlide = (idx) => {
      this.carouselIndex = (idx + 2) % 2;
      slides.forEach((s) => s.classList.toggle('hidden', Number(s.dataset.slide) !== this.carouselIndex));
      dots.forEach((d) => d.classList.toggle('active', Number(d.dataset.slideDot) === this.carouselIndex));
      if (indicatorEl) {
        indicatorEl.textContent =
          this.carouselIndex === 0 ? '1 / 2 · PHOTO' : '2 / 2 · FIT VIDEO';
      }
      if (this.carouselIndex !== 1 && videoPlayer && typeof videoPlayer.pause === 'function') {
        videoPlayer.pause();
      }
    };

    wrapper.querySelector('[data-action="carousel-prev"]')?.addEventListener('click', () => {
      setCarouselSlide(this.carouselIndex - 1);
    });
    wrapper.querySelector('[data-action="carousel-next"]')?.addEventListener('click', () => {
      setCarouselSlide(this.carouselIndex + 1);
    });
    dots.forEach((dot) => {
      dot.addEventListener('click', () => {
        setCarouselSlide(Number(dot.dataset.slideDot));
      });
    });

    // Touch swipe on carousel
    const carouselEl = wrapper.querySelector('[data-role="media-carousel"]');
    let touchStartX = null;
    carouselEl?.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches?.[0]?.clientX ?? null;
    }, { passive: true });
    carouselEl?.addEventListener('touchend', (e) => {
      if (touchStartX === null) return;
      const dx = (e.changedTouches?.[0]?.clientX ?? touchStartX) - touchStartX;
      if (Math.abs(dx) > 40) {
        setCarouselSlide(dx < 0 ? this.carouselIndex + 1 : this.carouselIndex - 1);
      }
      touchStartX = null;
    }, { passive: true });

    // Top-right Edit / SAVE button
    const editBtn = wrapper.querySelector('[data-action="toggle-edit"]');
    const detailPanel = wrapper.querySelector('[data-panel="detail"]');
    const editPanel = wrapper.querySelector('[data-panel="edit"]');
    const footerEl = wrapper.querySelector('[data-role="modal-footer"]');
    const editForm = wrapper.querySelector('#edit-garment-form');

    const saveGarmentEdits = async () => {
      if (!editForm) return;
      const fd = new FormData(editForm);
      const updates = {
        name: String(fd.get('name') || '').trim() || g.name,
        season: fd.get('season'),
        category: fd.get('category'),
        layerRole: fd.get('layerRole') || g.layerRole || 'base',
        tempSuitability:
          Array.isArray(this.editTempSuitability) && this.editTempSuitability.length > 0
            ? this.editTempSuitability
            : ['all-temps'],
        colorGroup: fd.get('colorGroup'),
        careCategory: fd.get('careCategory') || currentCareCat || 'other',
        delicate: normalizeCategoryValue(fd.get('careCategory') || currentCareCat) === 'delicate',
        type:
          Array.isArray(this.editOccasions) && this.editOccasions.length > 0
            ? this.editOccasions
            : ['everyday'],
        status: fd.get('status'),
        visualDescription: String(fd.get('visualDescription') || '').trim()
      };

      const videoFile = fd.get('newVideo');
      if (videoFile && videoFile instanceof Blob && videoFile.size > 0) {
        const savedVid = await wardrobeDb.saveMedia({
          garmentId: g.id,
          type: 'video',
          mimeType: videoFile.type || 'video/mp4',
          data: videoFile
        });
        updates.videoMediaId = savedVid.id;
      }

      await wardrobeDb.updateGarment(g.id, updates);
      eventBus.emit('wardrobe:changed', { id: g.id });
      eventBus.emit('laundry:updated', { id: g.id });
      showToast('Garment updated!', 'success');
      if (typeof this.onUpdated === 'function') this.onUpdated();
      this.close();
    };

    editBtn?.addEventListener('click', async () => {
      if (!this.isEditing) {
        this.isEditing = true;
        editBtn.classList.add('active');
        editBtn.textContent = 'SAVE';
        detailPanel?.classList.add('hidden');
        editPanel?.classList.remove('hidden');
        footerEl?.classList.add('hidden');
      } else {
        await saveGarmentEdits();
      }
    });

    // Close handlers
    wrapper.querySelector('[data-action="close-modal"]')?.addEventListener('click', () => this.close());
    wrapper.addEventListener('click', (e) => {
      if (e.target === wrapper) this.close();
    });

    // Style with item
    wrapper.querySelector('[data-action="style-anchor"]')?.addEventListener('click', () => {
      const id = g.id;
      const primaryOccasion = getGarmentOccasionList(g)[0] || 'everyday';
      this.close();
      if (typeof this.onStyleWithItem === 'function') {
        this.onStyleWithItem(id);
      } else if (typeof window !== 'undefined') {
        window.location.hash = `#tomorrow?anchor=${encodeURIComponent(id)}&occasion=${encodeURIComponent(primaryOccasion)}`;
      }
    });

    // Quick clean button
    wrapper.querySelector('[data-action="quick-clean"]')?.addEventListener('click', async () => {
      await wardrobeDb.updateGarment(g.id, { status: 'clean' });
      eventBus.emit('wardrobe:changed', { id: g.id });
      eventBus.emit('laundry:updated', { id: g.id });
      showToast(`${g.name} marked clean!`, 'success');
      if (typeof this.onUpdated === 'function') this.onUpdated();
      this.close();
    });

    // Multi-select occasion pills inside Edit form
    const editOccasionGroup = wrapper.querySelector('[data-field="editOccasions"]');
    if (editOccasionGroup) {
      editOccasionGroup.querySelectorAll('.pill-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const val = normalizeCategoryValue(btn.dataset.value);
          let next = [...this.editOccasions];
          if (next.includes(val)) {
            next = next.filter((o) => o !== val);
          } else {
            next.push(val);
          }
          if (next.length === 0) {
            next = [val];
          }
          this.editOccasions = next;
          editOccasionGroup.querySelectorAll('.pill-btn').forEach((b) => {
            b.classList.toggle('active', this.editOccasions.includes(normalizeCategoryValue(b.dataset.value)));
          });
        });
      });
    }

    // Multi-select temperature suitability pills inside Edit form
    const editTempGroup = wrapper.querySelector('[data-field="editTempSuitability"]');
    if (editTempGroup) {
      editTempGroup.querySelectorAll('.pill-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const val = btn.dataset.value;
          if (val === 'all-temps') {
            this.editTempSuitability = ['all-temps'];
          } else {
            let next = this.editTempSuitability.filter((t) => t !== 'all-temps');
            if (next.includes(val)) {
              next = next.filter((t) => t !== val);
            } else {
              next.push(val);
            }
            if (next.length === 0) {
              next = ['all-temps'];
            }
            this.editTempSuitability = next;
          }
          editTempGroup.querySelectorAll('.pill-btn').forEach((b) => {
            b.classList.toggle('active', this.editTempSuitability.includes(b.dataset.value));
          });
        });
      });
    }

    // Edit form submit (e.g., pressing Enter inside an input)
    if (editForm) {
      editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveGarmentEdits();
      });
    }

    // Delete button
    wrapper.querySelector('[data-action="delete-garment"]')?.addEventListener('click', async () => {
      await wardrobeDb.deleteGarment(g.id);
      eventBus.emit('wardrobe:changed', { id: g.id });
      eventBus.emit('laundry:updated', { id: g.id });
      showToast('Garment removed from wardrobe', 'info');
      if (typeof this.onDeleted === 'function') this.onDeleted(g.id);
      this.close();
    });

    return wrapper;
  }

  close() {
    this.urlManager.revokeAll();
    if (this.modalEl && this.modalEl.parentNode) {
      this.modalEl.parentNode.removeChild(this.modalEl);
    }
    this.modalEl = null;
    if (typeof this.onClose === 'function') {
      this.onClose();
    }
  }
}

export default GarmentModal;
