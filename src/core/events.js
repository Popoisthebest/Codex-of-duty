export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(type, listener) {
    let bucket = this.listeners.get(type);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(type, bucket);
    }
    bucket.add(listener);
    return () => this.off(type, listener);
  }

  off(type, listener) {
    const bucket = this.listeners.get(type);
    if (!bucket) return;
    bucket.delete(listener);
    if (bucket.size === 0) this.listeners.delete(type);
  }

  emit(type, payload = {}) {
    const bucket = this.listeners.get(type);
    if (!bucket) return;
    for (const listener of [...bucket]) listener(payload);
  }

  clear() {
    this.listeners.clear();
  }
}
