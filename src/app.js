/**
 * app.js - Main Application Bootstrapper for Wardrobe Organizer & AI Fashion Stylist PWA
 * Initializes IndexedDB, requests persistent storage on iOS/Android, mounts BottomNav & HashRouter,
 * and registers the offline Service Worker.
 */

import { wardrobeDb } from './db/wardrobeDb.js';
import { requestPersistentStorage } from './utils/mediaUtils.js';
import { eventBus } from './utils/eventBus.js';
import { HashRouter } from './router.js';
import { BottomNav } from './components/BottomNav.js';
import { GalleryView } from './views/GalleryView.js?v=31';
import { AddGarmentView } from './views/AddGarmentView.js?v=31';
import { TomorrowStylistView } from './views/TomorrowStylistView.js?v=31';
import { LaundryView } from './views/LaundryView.js?v=31';
import { BackupSettingsView } from './views/BackupSettingsView.js?v=31';

export class WardrobeApp {
  constructor() {
    this.router = null;
    this.bottomNav = null;
  }

  async init() {
    // 1. Open IndexedDB and request non-evictable storage on iPhone/Android
    await wardrobeDb.openDb();
    await requestPersistentStorage().catch(() => false);

    // 2. Sync header season badge
    await this.syncHeaderSeason();
    eventBus.on('season:changed', () => this.syncHeaderSeason());
    eventBus.on('backup:restored', () => this.syncHeaderSeason());

    // 3. Mount Bottom Navigation
    const navMount = document.getElementById('app-bottom-nav');
    this.bottomNav = new BottomNav({ container: navMount });
    await this.bottomNav.init(navMount);

    // 4. Configure HashRouter
    const mainMount = document.getElementById('app-main-view');
    this.router = new HashRouter({
      defaultRoute: '#gallery',
      container: mainMount,
      onRouteChanged: (route) => {
        if (this.bottomNav) {
          this.bottomNav.setActiveRoute(route);
        }
        const scrollView = typeof document !== 'undefined' ? document.getElementById('app-scroll-view') : null;
        if (scrollView && typeof scrollView.scrollTo === 'function') {
          scrollView.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
    });

    this.router
      .register('#gallery', () => new GalleryView())
      .register('#add', () => new AddGarmentView())
      .register('#tomorrow', () => new TomorrowStylistView())
      .register('#laundry', () => new LaundryView())
      .register('#settings', () => new BackupSettingsView());

    await this.router.start();

    // 5. Register Offline Service Worker
    this.registerServiceWorker();
  }

  async syncHeaderSeason() {
    const badgeEl = document.getElementById('header-season-pill');
    if (!badgeEl) return;
    const settings = await wardrobeDb.getSettings().catch(() => ({ activeSeason: 'winter' }));
    const isWinter = (settings?.activeSeason || 'winter') === 'winter';
    badgeEl.textContent = isWinter ? 'WINTER' : 'SUMMER';
    badgeEl.onclick = async () => {
      const next = isWinter ? 'summer' : 'winter';
      await wardrobeDb.setSetting('activeSeason', next);
      eventBus.emit('season:changed', { activeSeason: next });
      eventBus.emit('wardrobe:changed', { source: 'header_season_switch' });
    };
  }

  registerServiceWorker() {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      let refreshing = false;
      if (typeof navigator.serviceWorker.addEventListener === 'function') {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!refreshing && typeof window !== 'undefined' && window.location && typeof window.location.reload === 'function') {
            refreshing = true;
            window.location.reload();
          }
        });
      }
      const register = () =>
        navigator.serviceWorker
          .register('./sw.js?v=31', { updateViaCache: 'none' })
          .then((reg) => {
            if (reg && typeof reg.update === 'function') {
              reg.update().catch(() => {});
            }
          })
          .catch(() => {});
      if (document.readyState === 'complete') {
        register();
      } else {
        window.addEventListener('load', register);
      }
    }
  }
}

// Auto-initialize when mounted in main index.html
if (typeof document !== 'undefined' && document.getElementById('app-main-view')) {
  const app = new WardrobeApp();
  app.init().catch((err) => {
    console.error('[WardrobeApp] Initialization error:', err);
  });
}

export default WardrobeApp;
