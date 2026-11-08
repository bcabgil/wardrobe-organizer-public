/**
 * GalleryView.js - Editorial Wardrobe Catalog with Ultra-Minimal Toolbar, Slide-Up Filter Sheet & Lookbook Grid
 */

import {
  wardrobeDb,
  formatCategoryLabel,
  getGarmentOccasionList,
  garmentMatchesOccasion,
  normalizeCategoryValue
} from '../db/wardrobeDb.js';
import { MediaUrlManager } from '../utils/mediaUtils.js';
import { eventBus } from '../utils/eventBus.js';
import { escapeHtml, getNavIconSvg } from '../utils/domUtils.js';
import { GarmentCard } from '../components/GarmentCard.js';
import { GarmentModal } from '../components/GarmentModal.js';
import { showToast } from '../components/Toast.js';

export class GalleryView {
  constructor() {
    this.container = null;
    this.urlManager = new MediaUrlManager();
    this.garments = [];
    this.activeSeason = 'winter';
    this.isSearchOpen = false;
    this.isFilterSheetOpen = false;
    this.filters = {
      seasonFilter: 'active', // 'active' | 'all' | 'winter' | 'summer' | 'all-season'
      status: 'all',          // 'all' | 'clean' | 'to_wash'
      type: 'all',            // 'all' | 'everyday' | 'dress-up' | ...
      category: 'all',        // 'all' | 'top' | 'bottom' | 'outerwear' | 'one-piece' | 'shoes' | 'accessory'
      search: ''
    };
    this._unsubs = [];
  }

  async mount(container, params = {}) {
    this.container = container;
    if (params.season) this.filters.seasonFilter = params.season;
    if (params.category) this.filters.category = params.category;
    if (params.status) this.filters.status = params.status;

    await this.loadData();
    await this.render();

    this._unsubs.push(
      eventBus.on('wardrobe:changed', async () => {
        await this.loadData();
        await this.render();
      }),
      eventBus.on('season:changed', async () => {
        await this.loadData();
        await this.render();
      })
    );
  }

  async loadData() {
    const [garments, settings, customCategories] = await Promise.all([
      wardrobeDb.getAllGarments(),
      wardrobeDb.getSettings(),
      wardrobeDb.getCustomCategories()
    ]);
    this.garments = garments || [];
    this.activeSeason = (settings && settings.activeSeason) || 'winter';
    this.customCategories = customCategories || {
      laundryCategories: ['coloured', 'whites'],
      careCategories: ['delicate', 'other'],
      occasionCategories: ['everyday', 'dress-up']
    };
  }

  getActiveFilterCount() {
    let count = 0;
    if (this.filters.seasonFilter !== 'active') count++;
    if (this.filters.status !== 'all') count++;
    if (this.filters.type !== 'all') count++;
    if (this.filters.category !== 'all') count++;
    return count;
  }

  getFilteredGarments() {
    return this.garments.filter((g) => {
      if (this.filters.seasonFilter === 'active') {
        if (g.season && g.season !== this.activeSeason && g.season !== 'all-season') {
          return false;
        }
      } else if (this.filters.seasonFilter !== 'all') {
        if (g.season !== this.filters.seasonFilter) return false;
      }

      if (this.filters.status !== 'all' && g.status !== this.filters.status) {
        return false;
      }
      if (this.filters.type !== 'all' && !garmentMatchesOccasion(g, this.filters.type)) {
        return false;
      }
      if (this.filters.category !== 'all' && g.category !== this.filters.category) {
        return false;
      }
      if (this.filters.search) {
        const q = this.filters.search.toLowerCase();
        const hay = `${g.name || ''} ${g.visualDescription || ''} ${g.category || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  async render() {
    if (!this.container) return;

    const isWinter = this.activeSeason === 'winter';
    const cleanCount = this.garments.filter((g) => g.status === 'clean').length;
    const filteredCount = this.getFilteredGarments().length;
    const activeFilterCount = this.getActiveFilterCount();

    const occasionList = [...(this.customCategories?.occasionCategories || ['everyday', 'dress-up'])];
    for (const g of this.garments) {
      for (const t of getGarmentOccasionList(g)) {
        if (t && !occasionList.some((x) => normalizeCategoryValue(x) === t)) {
          occasionList.push(t);
        }
      }
    }

    this.container.innerHTML = `
      <section class="view-section gallery-view">
        <!-- ULTRA-MINIMAL TOOLBAR -->
        <div class="gallery-toolbar">
          <span class="gallery-summary-label">${this.garments.length} PIECES · ${cleanCount} CLEAN</span>
          <div class="gallery-toolbar-actions">
            <button type="button" class="toolbar-tonal-btn ${this.isSearchOpen || this.filters.search ? 'active' : ''}" id="btn-toggle-gallery-search">
              Search
            </button>
            <button type="button" class="toolbar-tonal-btn ${activeFilterCount > 0 ? 'active' : ''}" id="btn-open-filter-sheet">
              Filter${activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
            </button>
          </div>
        </div>

        <!-- COLLAPSIBLE SEARCH DRAWER -->
        <div class="gallery-search-drawer ${this.isSearchOpen || this.filters.search ? '' : 'hidden'}" id="gallery-search-drawer">
          <input
            type="search"
            id="gallery-search"
            class="form-input search-input"
            placeholder="Search pieces, colors, fabrics..."
            value="${escapeHtml(this.filters.search)}"
          />
        </div>

        <!-- GARMENT LOOKBOOK GRID -->
        <div id="gallery-grid-mount" class="garment-grid"></div>

        <!-- SLIDE-UP FILTER COLLECTION BOTTOM SHEET -->
        <div class="modal-backdrop ${this.isFilterSheetOpen ? '' : 'hidden'}" id="gallery-filter-sheet" data-modal="filter-collection">
          <div class="modal-sheet">
            <div class="sheet-drag-handle"></div>
            <div class="modal-header">
              <h3 class="modal-title">Filter Collection</h3>
              <div class="modal-header-actions">
                <button type="button" class="btn-reset-filters" id="btn-reset-filters">Reset</button>
                <button type="button" class="modal-close-btn" id="btn-close-filter-sheet" aria-label="Close">✕</button>
              </div>
            </div>

            <div class="modal-body">
              <div class="filter-sheet-group">
                <span class="filter-sheet-label">CATEGORY</span>
                <div class="chip-grid-3" data-filter-group="category">
                  <button type="button" class="filter-chip ${this.filters.category === 'all' ? 'active' : ''}" data-val="all">All</button>
                  <button type="button" class="filter-chip ${this.filters.category === 'top' ? 'active' : ''}" data-val="top">Tops</button>
                  <button type="button" class="filter-chip ${this.filters.category === 'bottom' ? 'active' : ''}" data-val="bottom">Bottoms</button>
                  <button type="button" class="filter-chip ${this.filters.category === 'outerwear' ? 'active' : ''}" data-val="outerwear">Outerwear</button>
                  <button type="button" class="filter-chip ${this.filters.category === 'shoes' ? 'active' : ''}" data-val="shoes">Shoes</button>
                  <button type="button" class="filter-chip ${this.filters.category === 'accessory' ? 'active' : ''}" data-val="accessory">Accessories</button>
                  <button type="button" class="filter-chip ${this.filters.category === 'one-piece' ? 'active' : ''}" data-val="one-piece">One-Piece</button>
                </div>
              </div>

              <div class="filter-sheet-group">
                <span class="filter-sheet-label">OCCASION</span>
                <div class="chip-scroll-row" data-filter-group="type">
                  <button type="button" class="filter-chip ${this.filters.type === 'all' ? 'active' : ''}" data-val="all">All</button>
                  ${occasionList
                    .map(
                      (occ) =>
                        `<button type="button" class="filter-chip ${normalizeCategoryValue(this.filters.type) === normalizeCategoryValue(occ) ? 'active' : ''}" data-val="${escapeHtml(normalizeCategoryValue(occ))}">${escapeHtml(formatCategoryLabel(occ))}</button>`
                    )
                    .join('')}
                </div>
              </div>

              <div class="filter-sheet-group">
                <span class="filter-sheet-label">AVAILABILITY</span>
                <div class="chip-scroll-row" data-filter-group="status">
                  <button type="button" class="filter-chip ${this.filters.status === 'all' ? 'active' : ''}" data-val="all">All</button>
                  <button type="button" class="filter-chip ${this.filters.status === 'clean' ? 'active' : ''}" data-val="clean">Clean Only</button>
                  <button type="button" class="filter-chip ${this.filters.status === 'to_wash' ? 'active' : ''}" data-val="to_wash">In Laundry</button>
                </div>
              </div>

              <div class="filter-sheet-group">
                <span class="filter-sheet-label">SEASON</span>
                <div class="chip-scroll-row" data-filter-group="seasonFilter">
                  <button type="button" class="filter-chip ${this.filters.seasonFilter === 'active' ? 'active' : ''}" data-val="active">Active (${isWinter ? 'Winter' : 'Summer'})</button>
                  <button type="button" class="filter-chip ${this.filters.seasonFilter === 'all' ? 'active' : ''}" data-val="all">All Clothes</button>
                  <button type="button" class="filter-chip ${this.filters.seasonFilter === 'winter' ? 'active' : ''}" data-val="winter">Winter</button>
                  <button type="button" class="filter-chip ${this.filters.seasonFilter === 'summer' ? 'active' : ''}" data-val="summer">Summer</button>
                  <button type="button" class="filter-chip ${this.filters.seasonFilter === 'all-season' ? 'active' : ''}" data-val="all-season">Year-Round</button>
                </div>
              </div>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn-primary btn-block" id="btn-apply-filter-sheet">
                SHOW ${filteredCount} PIECES
              </button>
            </div>
          </div>
        </div>
      </section>
    `;

    // Toggle Search Drawer
    this.container.querySelector('#btn-toggle-gallery-search')?.addEventListener('click', () => {
      this.isSearchOpen = !this.isSearchOpen;
      const drawer = this.container.querySelector('#gallery-search-drawer');
      const searchBtn = this.container.querySelector('#btn-toggle-gallery-search');
      if (drawer) drawer.classList.toggle('hidden', !this.isSearchOpen && !this.filters.search);
      if (searchBtn) searchBtn.classList.toggle('active', this.isSearchOpen || Boolean(this.filters.search));
      if (this.isSearchOpen) {
        this.container.querySelector('#gallery-search')?.focus();
      }
    });

    // Search input
    this.container.querySelector('#gallery-search')?.addEventListener('input', (e) => {
      this.filters.search = e.target.value || '';
      this.renderGrid();
      const applyBtn = this.container.querySelector('#btn-apply-filter-sheet');
      if (applyBtn) {
        applyBtn.textContent = `SHOW ${this.getFilteredGarments().length} PIECES`;
      }
    });

    // Open & Close Filter Sheet
    const filterSheet = this.container.querySelector('#gallery-filter-sheet');
    const closeFilterSheet = () => {
      this.isFilterSheetOpen = false;
      filterSheet?.classList.add('hidden');
    };

    this.container.querySelector('#btn-open-filter-sheet')?.addEventListener('click', () => {
      this.isFilterSheetOpen = true;
      filterSheet?.classList.remove('hidden');
    });

    this.container.querySelector('#btn-close-filter-sheet')?.addEventListener('click', closeFilterSheet);
    this.container.querySelector('#btn-apply-filter-sheet')?.addEventListener('click', closeFilterSheet);
    filterSheet?.addEventListener('click', (e) => {
      if (e.target === filterSheet) closeFilterSheet();
    });

    // Reset Filters
    this.container.querySelector('#btn-reset-filters')?.addEventListener('click', async () => {
      this.filters.seasonFilter = 'active';
      this.filters.status = 'all';
      this.filters.type = 'all';
      this.filters.category = 'all';
      await this.render();
    });

    // Bind filter chip groups inside Filter Sheet
    this.container.querySelectorAll('[data-filter-group]').forEach((groupEl) => {
      const groupKey = groupEl.dataset.filterGroup;
      groupEl.querySelectorAll('.filter-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          this.filters[groupKey] = chip.dataset.val;
          groupEl.querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c === chip));
          this.renderGrid();
          const applyBtn = this.container.querySelector('#btn-apply-filter-sheet');
          if (applyBtn) {
            applyBtn.textContent = `SHOW ${this.getFilteredGarments().length} PIECES`;
          }
          const filterTriggerBtn = this.container.querySelector('#btn-open-filter-sheet');
          const count = this.getActiveFilterCount();
          if (filterTriggerBtn) {
            filterTriggerBtn.textContent = `Filter${count > 0 ? ` · ${count}` : ''}`;
            filterTriggerBtn.classList.toggle('active', count > 0);
          }
        });
      });
    });

    await this.renderGrid();
  }

  async renderGrid() {
    if (!this.container) return;
    const gridMount = this.container.querySelector('#gallery-grid-mount');
    if (!gridMount) return;

    this.urlManager.revokeAll();
    gridMount.innerHTML = '';

    const filtered = this.getFilteredGarments();

    if (filtered.length === 0) {
      gridMount.innerHTML = `
        <div class="empty-state-card">
          <div class="empty-icon">${getNavIconSvg('wardrobe')}</div>
          <h3>${this.garments.length === 0 ? 'Your Digital Wardrobe is Empty' : 'No Matching Pieces'}</h3>
          <p>${
            this.garments.length === 0
              ? 'Begin curating your collection by adding your garments with photos and fit videos.'
              : 'Try adjusting or resetting your collection filters.'
          }</p>
          <a href="#add" class="btn-primary">Add Piece</a>
        </div>
      `;
      return;
    }

    for (const g of filtered) {
      let photoUrl = null;
      if (g.photoMediaId) {
        const blob = await wardrobeDb.getMediaBlob(g.photoMediaId).catch(() => null);
        if (blob) {
          photoUrl = this.urlManager.createUrl(blob);
        }
      }

      const card = new GarmentCard({
        garment: g,
        photoUrl,
        onToggleStatus: async (item) => {
          const updated = await wardrobeDb.toggleGarmentStatus(item.id);
          eventBus.emit('wardrobe:changed', { id: item.id });
          eventBus.emit('laundry:updated', { id: item.id });
          showToast(
            `${updated.name} moved to ${updated.status === 'clean' ? 'Clean' : 'Laundry'}`,
            'success'
          );
        },
        onSelect: (item) => {
          const modal = new GarmentModal({
            garment: item,
            onUpdated: async () => {
              await this.loadData();
              await this.render();
            },
            onDeleted: async () => {
              await this.loadData();
              await this.render();
            }
          });
          modal.open(document.body);
        }
      });

      gridMount.appendChild(card.render());
    }
  }

  async unmount() {
    this.urlManager.revokeAll();
    this._unsubs.forEach((fn) => {
      if (typeof fn === 'function') fn();
    });
    this._unsubs = [];
  }
}

export default GalleryView;
