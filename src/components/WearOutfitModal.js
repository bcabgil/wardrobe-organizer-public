/**
 * WearOutfitModal.js - Confirms Wearing an Outfit & Logs Selected Garments to Laundry ("To Wash")
 */

import { escapeHtml } from '../utils/domUtils.js';

export class WearOutfitModal {
  constructor(options = {}) {
    this.outfit = options.outfit || { title: 'Selected Outfit', garments: [] };
    this.onConfirmWear = options.onConfirmWear || null;
    this.onClose = options.onClose || null;
    this.modalEl = null;
  }

  render() {
    const outfit = this.outfit || {};
    const garments = Array.isArray(outfit.garments) ? outfit.garments : [];

    const wrapper = document.createElement('div');
    wrapper.className = 'modal-backdrop';
    wrapper.dataset.modal = 'wear-outfit';

    const itemsHtml = garments
      .map((g) => {
        // Default: tops, bottoms, one-piece, gym items checked by default; outerwear & shoes optional
        const checkedByDefault = !['outerwear', 'shoes'].includes(g.category);
        return `
          <label class="wear-check-item">
            <input type="checkbox" name="washGarment" value="${escapeHtml(g.id)}" ${checkedByDefault ? 'checked' : ''} />
            <span class="wear-item-name">${escapeHtml(g.name || g.id)}</span>
            <span class="wear-item-meta">${escapeHtml(g.category || 'item')}</span>
          </label>
        `;
      })
      .join('');

    wrapper.innerHTML = `
      <div class="modal-sheet modal-sheet-compact">
        <div class="sheet-drag-handle"></div>
        <div class="modal-header">
          <h3 class="modal-title">Wear "${escapeHtml(outfit.title || 'Outfit')}"</h3>
          <button type="button" class="modal-close-btn" data-action="close-wear-modal">✕</button>
        </div>
        <div class="modal-body">
          <p class="text-muted" style="margin:0 0 12px;">Select which pieces should move to your <strong>Laundry</strong> load after wearing:</p>
          <div class="wear-checklist">
            ${itemsHtml}
          </div>
        </div>
        <div class="modal-footer modal-footer-split">
          <button type="button" class="btn-secondary" data-action="close-wear-modal">Cancel</button>
          <button type="button" class="btn-primary btn-confirm" data-action="confirm-wear">Confirm</button>
        </div>
      </div>
    `;

    const confirmBtn = wrapper.querySelector('[data-action="confirm-wear"]');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        const checkedBoxes = wrapper.querySelectorAll('input[name="washGarment"]:checked');
        const selectedIds = Array.from(checkedBoxes).map((cb) => cb.value);
        if (typeof this.onConfirmWear === 'function') {
          this.onConfirmWear(selectedIds, outfit);
        }
        this.close();
      });
    }

    wrapper.querySelectorAll('[data-action="close-wear-modal"]').forEach((btn) => {
      btn.addEventListener('click', () => this.close());
    });

    this.modalEl = wrapper;
    return wrapper;
  }

  open(container = document.body) {
    const el = this.render();
    container.appendChild(el);
    return el;
  }

  close() {
    if (this.modalEl && this.modalEl.parentNode) {
      this.modalEl.parentNode.removeChild(this.modalEl);
    }
    this.modalEl = null;
    if (typeof this.onClose === 'function') {
      this.onClose();
    }
  }
}

export default WearOutfitModal;
