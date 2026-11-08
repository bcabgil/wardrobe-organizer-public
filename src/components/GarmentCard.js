/**
 * GarmentCard.js - Editorial Lookbook Wardrobe Card with 1-Tap Corner Status Toggle & Fit Video Badge
 */

import { escapeHtml, getCategoryIconSvg, getUiIconSvg } from '../utils/domUtils.js';
import { formatCategoryLabel, getGarmentCareCategory } from '../db/wardrobeDb.js';

export class GarmentCard {
  constructor(options = {}) {
    this.garment = options.garment || {};
    this.photoUrl = options.photoUrl || null;
    this.onToggleStatus = options.onToggleStatus || null;
    this.onSelect = options.onSelect || null;
  }

  render() {
    const g = this.garment || {};
    const card = document.createElement('article');
    card.className = `garment-card status-${g.status || 'clean'}`;
    card.dataset.garmentId = g.id || '';

    const isClean = g.status !== 'to_wash';
    const typeLabel = formatCategoryLabel(g.type || 'everyday');
    const careCat = getGarmentCareCategory(g);

    const subtitleParts = [typeLabel];
    if (!isClean) {
      subtitleParts.push('In Laundry');
    } else if (careCat === 'delicate' || g.delicate) {
      subtitleParts.push('Delicate');
    } else if (careCat && careCat !== 'other') {
      subtitleParts.push(formatCategoryLabel(careCat));
    }
    const subtitleText = subtitleParts.join(' · ');

    const mediaHtml = this.photoUrl
      ? `<img src="${escapeHtml(this.photoUrl)}" alt="${escapeHtml(g.name || 'Garment')}" class="garment-card-img" loading="lazy" />`
      : `<div class="garment-card-placeholder">${getCategoryIconSvg(g.category)}</div>`;

    const videoBadgeHtml = g.videoMediaId
      ? `<span class="badge-fit-video" title="Has Fit Video">▶ FIT</span>`
      : '';

    const statusIconHtml = isClean
      ? getUiIconSvg('check')
      : getUiIconSvg('laundry-basket');

    card.innerHTML = `
      <div class="garment-card-media" data-action="open-detail">
        ${mediaHtml}
        <button
          type="button"
          class="card-status-corner-btn btn-toggle ${isClean ? 'is-clean' : 'is-wash'}"
          data-action="toggle-status"
          title="${isClean ? 'Clean — Tap to move to laundry' : 'In Laundry — Tap to mark clean'}"
          aria-label="${isClean ? 'Move to laundry' : 'Mark clean'}"
        >
          ${statusIconHtml}
        </button>
        ${videoBadgeHtml}
      </div>
      <div class="garment-card-body">
        <div class="garment-card-title" data-action="open-detail">${escapeHtml(g.name || 'Untitled Garment')}</div>
        <div class="garment-card-subtitle">${escapeHtml(subtitleText)}</div>
      </div>
    `;

    const toggleBtn = card.querySelector('[data-action="toggle-status"]');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof this.onToggleStatus === 'function') {
          this.onToggleStatus(g);
        }
      });
    }

    card.querySelectorAll('[data-action="open-detail"]').forEach((el) => {
      el.addEventListener('click', () => {
        if (typeof this.onSelect === 'function') {
          this.onSelect(g);
        }
      });
    });

    return card;
  }
}

export default GarmentCard;
