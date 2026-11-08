/**
 * BottomNav.js - Mobile 5-Tab Bottom Navigation Bar with Reactive Laundry & Backup Badges
 */

import { eventBus } from '../utils/eventBus.js';
import { wardrobeDb } from '../db/wardrobeDb.js';
import { getNavIconSvg } from '../utils/domUtils.js';

export class BottomNav {
  constructor(options = {}) {
    this.container = options.container || null;
    this.activeRoute = options.activeRoute || '#gallery';
    this.laundryCount = 0;
    this.hasUnsavedBackup = false;
    this._unsubs = [];
  }

  async init(container) {
    if (container) this.container = container;
    await this.refreshBadges();
    this.render();

    this._unsubs.push(
      eventBus.on('laundry:updated', () => this.refreshBadges()),
      eventBus.on('wardrobe:changed', () => this.refreshBadges()),
      eventBus.on('backup:completed', () => this.refreshBadges()),
      eventBus.on('backup:restored', () => this.refreshBadges())
    );
  }

  async refreshBadges() {
    try {
      const [count, dirtyBackup] = await Promise.all([
        wardrobeDb.getLaundryCount(),
        wardrobeDb.hasChangesSinceBackup()
      ]);
      this.laundryCount = count || 0;
      this.hasUnsavedBackup = Boolean(dirtyBackup);
      this.render();
    } catch (_) {}
  }

  setActiveRoute(route) {
    this.activeRoute = route || '#gallery';
    this.render();
  }

  render() {
    const el = typeof document !== 'undefined' ? document.createElement('nav') : null;
    if (!el) return null;

    el.className = 'bottom-nav';
    el.setAttribute('aria-label', 'Primary Navigation');

    const tabs = [
      { route: '#gallery', label: 'Wardrobe', icon: getNavIconSvg('wardrobe') },
      { route: '#tomorrow', label: 'Create', icon: getNavIconSvg('create') },
      { route: '#add', label: 'Add', icon: getNavIconSvg('add'), isPrimary: true },
      { route: '#laundry', label: 'Laundry', icon: getNavIconSvg('laundry'), badge: this.laundryCount > 0 ? String(this.laundryCount) : null },
      { route: '#settings', label: 'Settings', icon: getNavIconSvg('settings'), dot: this.hasUnsavedBackup }
    ];

    el.innerHTML = tabs
      .map((tab) => {
        const isActive = this.activeRoute === tab.route;
        const badgeHtml = tab.badge
          ? `<span class="nav-badge" data-badge="laundry">${tab.badge}</span>`
          : tab.dot
            ? `<span class="nav-dot" title="Unsaved changes since last backup"></span>`
            : '';

        return `
          <a href="${tab.route}" class="bottom-nav-item ${isActive ? 'active' : ''} ${tab.isPrimary ? 'nav-primary-add' : ''}" data-route="${tab.route}">
            <span class="nav-icon-wrap">
              <span class="nav-icon">${tab.icon}</span>
              ${badgeHtml}
            </span>
            <span class="nav-label">${tab.label}</span>
          </a>
        `;
      })
      .join('');

    if (this.container) {
      this.container.innerHTML = '';
      this.container.appendChild(el);
    }

    return el;
  }

  destroy() {
    this._unsubs.forEach((fn) => {
      if (typeof fn === 'function') fn();
    });
    this._unsubs = [];
  }
}

export default BottomNav;
