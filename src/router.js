/**
 * HashRouter - Client-Side Hash Navigation & View Lifecycle Manager
 * Supports:
 * - #gallery, #add, #tomorrow, #laundry, #settings
 * - Query string parsing and XSS sanitization (#tomorrow?anchor=123&occasion=gym)
 * - View lifecycle (unmount previous view, mount next view)
 * - Concurrency guard against rapid consecutive route transitions
 */

import { sanitizeParamValue } from './utils/domUtils.js';

export class HashRouter {
  constructor(options = {}) {
    this.defaultRoute = options.defaultRoute || '#gallery';
    this.container = options.container || null;
    this.onRouteChanged = options.onRouteChanged || null;
    this.routes = new Map();
    this.currentView = null;
    this.currentRoute = null;
    this._navSequence = 0;
    this._boundHashChange = () => {
      this.handleRoute(window.location.hash || this.defaultRoute);
    };
  }

  /**
   * Register a route handler or view factory
   * @param {string} route - e.g. '#gallery'
   * @param {Function} handler - (params, route) => ViewInstance | Promise<ViewInstance> | void
   */
  register(route, handler) {
    const normalized = route.startsWith('#') ? route : `#${route}`;
    this.routes.set(normalized, handler);
    return this;
  }

  /**
   * Parse hash string into route and sanitized query parameters
   * @param {string} hashString
   * @returns {{ route: string, params: Object }}
   */
  parseHash(hashString = '') {
    const raw = String(hashString || '').trim();
    if (!raw || raw === '#') {
      return { route: this.defaultRoute, params: {} };
    }

    const withHash = raw.startsWith('#') ? raw : `#${raw}`;
    const qIndex = withHash.indexOf('?');
    if (qIndex === -1) {
      return { route: withHash, params: {} };
    }

    const route = withHash.slice(0, qIndex) || this.defaultRoute;
    const queryStr = withHash.slice(qIndex + 1);
    const params = {};

    const searchParams = new URLSearchParams(queryStr);
    for (const [key, val] of searchParams.entries()) {
      const safeKey = sanitizeParamValue(key);
      const safeVal = sanitizeParamValue(val);
      if (safeKey) {
        params[safeKey] = safeVal;
      }
    }

    return { route, params };
  }

  /**
   * Handle route transition with lifecycle hooks (unmount old -> mount new)
   * @param {string} [hashString]
   */
  async handleRoute(hashString) {
    const seq = ++this._navSequence;
    const targetHash = hashString !== undefined ? hashString : (typeof window !== 'undefined' ? window.location.hash : this.defaultRoute);
    const { route, params } = this.parseHash(targetHash);

    let effectiveRoute = route;
    let handler = this.routes.get(effectiveRoute);

    if (!handler) {
      effectiveRoute = this.defaultRoute;
      handler = this.routes.get(effectiveRoute);
    }

    if (!handler) {
      return null;
    }

    // Unmount existing view if present
    if (this.currentView && typeof this.currentView.unmount === 'function') {
      try {
        await this.currentView.unmount();
      } catch (_) {}
    }

    const nextView = await handler(params, effectiveRoute);

    // If a newer navigation started while awaiting, abort stale mount
    if (seq !== this._navSequence) {
      if (nextView && typeof nextView.unmount === 'function') {
        try {
          await nextView.unmount();
        } catch (_) {}
      }
      return null;
    }

    this.currentView = nextView || null;
    this.currentRoute = effectiveRoute;

    if (typeof this.onRouteChanged === 'function') {
      try {
        this.onRouteChanged(effectiveRoute, params);
      } catch (_) {}
    }

    if (this.currentView && typeof this.currentView.mount === 'function') {
      try {
        await this.currentView.mount(this.container, params);
      } catch (err) {
        console.error(`[HashRouter] Error mounting ${effectiveRoute}:`, err);
      }
    }

    return this.currentView;
  }

  /**
   * Programmatically navigate to a hash route
   * @param {string} hash
   */
  navigate(hash) {
    const normalized = hash.startsWith('#') ? hash : `#${hash}`;
    if (typeof window !== 'undefined') {
      if (window.location.hash === normalized) {
        return this.handleRoute(normalized);
      }
      window.location.hash = normalized;
    }
    return this.handleRoute(normalized);
  }

  /**
   * Start listening to window hashchange / popstate events
   */
  start() {
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', this._boundHashChange);
    }
    return this.handleRoute(typeof window !== 'undefined' ? window.location.hash : this.defaultRoute);
  }

  /**
   * Stop listening to window events
   */
  stop() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('hashchange', this._boundHashChange);
    }
  }
}

export default HashRouter;
