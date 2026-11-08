/**
 * LaundryView.js - Active-Only Smart Laundry Loads & One-Tap Batch Cleaning
 */

import {
  wardrobeDb,
  formatCategoryLabel,
  getGarmentCareCategory,
  normalizeCategoryValue
} from '../db/wardrobeDb.js';
import { eventBus } from '../utils/eventBus.js';
import { escapeHtml, getNavIconSvg } from '../utils/domUtils.js';
import { showToast } from '../components/Toast.js';

export class LaundryView {
  constructor() {
    this.container = null;
    this.loads = {
      whitesRegular: [],
      whitesDelicate: [],
      colouredRegular: [],
      colouredDelicate: []
    };
    this.dirtyGarments = [];
    this.customCategories = {
      laundryCategories: ['coloured', 'whites'],
      careCategories: ['delicate', 'other']
    };
    this.basketsByKey = {};
    this._unsub = null;
  }

  async mount(container) {
    this.container = container;
    await this.loadLoads();
    this.render();

    this._unsub = eventBus.on('laundry:updated', async () => {
      await this.loadLoads();
      this.render();
    });
  }

  async loadLoads() {
    const [loads, allGarments, customCategories] = await Promise.all([
      wardrobeDb.getLaundryLoads(),
      wardrobeDb.getAllGarments(),
      wardrobeDb.getCustomCategories()
    ]);
    this.loads = loads || {};
    this.dirtyGarments = (allGarments || []).filter((g) => g.status === 'to_wash');
    if (customCategories) {
      this.customCategories = customCategories;
    }
  }

  buildDynamicBaskets() {
    const laundryCats = [...(this.customCategories.laundryCategories || ['coloured', 'whites'])];
    const careCats = [...(this.customCategories.careCategories || ['delicate', 'other'])];

    for (const g of this.dirtyGarments) {
      const cGroup = normalizeCategoryValue(g.colorGroup || 'coloured');
      const careCat = normalizeCategoryValue(getGarmentCareCategory(g));
      if (cGroup && !laundryCats.some((x) => normalizeCategoryValue(x) === cGroup)) {
        laundryCats.push(cGroup);
      }
      if (careCat && !careCats.some((x) => normalizeCategoryValue(x) === careCat)) {
        careCats.push(careCat);
      }
    }

    const baskets = [];
    this.basketsByKey = {};

    for (const lCat of laundryCats) {
      for (const cCat of careCats) {
        const normL = normalizeCategoryValue(lCat);
        const normC = normalizeCategoryValue(cCat);
        const key = `${normL}__${normC}`;
        const items = this.dirtyGarments.filter(
          (g) =>
            normalizeCategoryValue(g.colorGroup || 'coloured') === normL &&
            normalizeCategoryValue(getGarmentCareCategory(g)) === normC
        );
        const lLabel = formatCategoryLabel(normL);
        const cLabel = formatCategoryLabel(normC);
        const basket = {
          key,
          title: `${lLabel} · ${cLabel}`,
          items
        };
        baskets.push(basket);
        this.basketsByKey[key] = items;
      }
    }

    return baskets;
  }

  render() {
    if (!this.container) return;

    const baskets = this.buildDynamicBaskets();
    const activeBaskets = baskets.filter((b) => b.items.length > 0);
    const totalDirty = activeBaskets.reduce((acc, b) => acc + b.items.length, 0);

    const basketsHtml =
      activeBaskets.length === 0
        ? `
          <div class="empty-state-card">
            <div class="empty-icon">${getNavIconSvg('laundry')}</div>
            <h3>Every Piece is Clean</h3>
            <p>Your laundry baskets are empty and all garments are ready to wear.</p>
          </div>
        `
        : activeBaskets
            .map((b) => {
              const count = b.items.length;
              const listHtml = `
                <ul class="laundry-item-list">
                  ${b.items
                    .map(
                      (g) => `
                        <li class="laundry-item-row" data-garment-id="${escapeHtml(g.id)}">
                          <div>
                            <strong>${escapeHtml(g.name)}</strong>
                            <span class="laundry-item-meta">${escapeHtml(formatCategoryLabel(g.category))} · ${escapeHtml(formatCategoryLabel(g.type))}</span>
                          </div>
                          <button type="button" class="btn-single-clean" data-single-clean="${escapeHtml(g.id)}">Clean</button>
                        </li>
                      `
                    )
                    .join('')}
                </ul>
              `;

              return `
                <div class="laundry-basket-card card-surface" data-basket="${b.key}">
                  <div class="laundry-basket-header">
                    <h3 class="laundry-basket-title">
                      ${escapeHtml(b.title)}
                      <span class="basket-count-pill">${count}</span>
                    </h3>
                    <button type="button" class="btn-primary btn-clean-load" data-clean-basket="${b.key}">
                      MARK LOAD CLEAN
                    </button>
                  </div>
                  ${listHtml}
                </div>
              `;
            })
            .join('');

    this.container.innerHTML = `
      <section class="view-section laundry-view">
        <div class="section-header">
          <h2>Laundry</h2>
          <p class="section-subtitle">
            ${
              totalDirty === 0
                ? 'ALL PIECES CLEAN'
                : `${totalDirty} ${totalDirty === 1 ? 'ITEM' : 'ITEMS'} WAITING  ·  ${activeBaskets.length} ACTIVE ${activeBaskets.length === 1 ? 'LOAD' : 'LOADS'}`
            }
          </p>
        </div>

        <div class="laundry-baskets-grid">
          ${basketsHtml}
        </div>
      </section>
    `;

    // Bind batch clean buttons
    this.container.querySelectorAll('[data-clean-basket]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const basketKey = btn.dataset.cleanBasket;
        const items = this.basketsByKey[basketKey] || this.loads[basketKey] || [];
        if (items.length === 0) return;

        const ids = items.map((g) => g.id);
        await wardrobeDb.markGarmentsClean(ids);
        eventBus.emit('laundry:updated', { cleanedCount: ids.length, basket: basketKey });
        eventBus.emit('wardrobe:changed', { source: 'laundry_batch_clean' });
        showToast(`Marked ${ids.length} item(s) as Clean!`, 'success');
      });
    });

    // Bind single item clean buttons
    this.container.querySelectorAll('[data-single-clean]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.singleClean;
        if (!id) return;
        await wardrobeDb.markGarmentsClean([id]);
        eventBus.emit('laundry:updated', { cleanedCount: 1 });
        eventBus.emit('wardrobe:changed', { source: 'laundry_single_clean' });
        showToast('Item marked as Clean!', 'success');
      });
    });
  }

  async unmount() {
    if (typeof this._unsub === 'function') {
      this._unsub();
      this._unsub = null;
    }
  }
}

export default LaundryView;
