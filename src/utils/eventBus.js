/**
 * EventBus - Global reactive publish-subscribe event emitter for the Wardrobe Organizer PWA.
 * Provides decoupled state synchronization, error containment, and memory leak prevention.
 */

export const EVENTS = Object.freeze({
  GARMENT_CREATED: 'garment:created',
  GARMENT_UPDATED: 'garment:updated',
  GARMENT_DELETED: 'garment:deleted',
  LAUNDRY_UPDATED: 'laundry:updated',
  SEASON_CHANGED: 'season:changed',
  BACKUP_STATUS_CHANGED: 'backup:status_changed',
  TOAST_SHOW: 'toast:show'
});

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} event - Name of the event.
   * @param {Function} callback - Subscriber function.
   * @returns {() => void} Unsubscribe function.
   */
  on(event, callback) {
    if (typeof event !== 'string' || !event.trim()) {
      throw new TypeError('[EventBus] Event name must be a non-empty string');
    }
    if (typeof callback !== 'function') {
      throw new TypeError('[EventBus] Callback must be a function');
    }

    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    const set = this.listeners.get(event);
    set.add(callback);

    // Return unbind function
    return () => this.off(event, callback);
  }

  /**
   * Unsubscribe from an event.
   * If callback is omitted, all listeners for the event are removed.
   * @param {string} event - Name of the event.
   * @param {Function} [callback] - Specific subscriber to remove.
   */
  off(event, callback) {
    if (!this.listeners.has(event)) return;

    if (!callback) {
      this.listeners.delete(event);
      return;
    }

    const set = this.listeners.get(event);
    set.delete(callback);

    if (set.size === 0) {
      this.listeners.delete(event);
    }
  }

  /**
   * Subscribe to an event for exactly one invocation.
   * @param {string} event - Name of the event.
   * @param {Function} callback - Subscriber function.
   * @returns {() => void} Unsubscribe function.
   */
  once(event, callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('[EventBus] Callback must be a function');
    }

    const wrapper = (data) => {
      this.off(event, wrapper);
      return callback(data);
    };

    return this.on(event, wrapper);
  }

  /**
   * Dispatch an event to all subscribers with isolated error containment.
   * A failing subscriber callback will not crash other subscribers or the emitter.
   * @param {string} event - Name of the event.
   * @param {any} [data] - Event payload.
   * @returns {number} Number of subscribers notified.
   */
  emit(event, data) {
    if (!this.listeners.has(event)) return 0;

    // Snapshot subscribers to allow safe mutations during emit loop
    const subscribers = Array.from(this.listeners.get(event));

    for (const callback of subscribers) {
      try {
        const result = callback(data);
        // Catch unhandled async promise rejections
        if (result && typeof result.catch === 'function') {
          result.catch((asyncErr) => {
            console.error(`[EventBus] Unhandled promise rejection in subscriber for "${event}":`, asyncErr);
          });
        }
      } catch (err) {
        console.error(`[EventBus] Error in subscriber for "${event}":`, err);
      }
    }

    return subscribers.length;
  }

  /**
   * Clear listeners.
   * @param {string} [event] - If provided, clears only this event; otherwise clears everything.
   */
  clear(event) {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get the number of active listeners for an event.
   * @param {string} event - Event name.
   * @returns {number}
   */
  listenerCount(event) {
    return this.listeners.has(event) ? this.listeners.get(event).size : 0;
  }
}

// Export singleton instance as default and named export
export const eventBus = new EventBus();
export default eventBus;
