// A small bounded work queue. Changing sheets drops work that has not started.
export class PreviewCache {
  constructor(load, { concurrency = 2, maxBytes = 96 * 1024 * 1024 } = {}) {
    this.load = load;
    this.concurrency = concurrency;
    this.maxBytes = maxBytes;
    this.entries = new Map();
    this.pending = new Map();
    this.queue = [];
    this.visible = new Set();
    this.active = 0;
    this.bytes = 0;
  }
  show(keys) {
    this.visible = new Set(keys);
    this.trim();
  }
  peek(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  request(key, input) {
    const cached = this.peek(key);
    if (cached) return Promise.resolve(cached);
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = new Promise((resolve, reject) =>
      this.queue.push({ key, input, resolve, reject }),
    );
    this.pending.set(key, promise);
    this.pump();
    return promise;
  }
  pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      if (!this.visible.has(job.key)) {
        this.pending.delete(job.key);
        job.resolve(null);
        continue;
      }
      this.active++;
      Promise.resolve()
        .then(() => this.load(job.input))
        .then((value) => {
          const bytes = value.width * value.height * 4;
          this.entries.set(job.key, { value, bytes });
          this.bytes += bytes;
          this.trim();
          job.resolve(value);
        }, job.reject)
        .finally(() => {
          this.active--;
          this.pending.delete(job.key);
          this.pump();
        });
    }
  }
  trim() {
    for (const [key, entry] of this.entries) {
      if (this.bytes <= this.maxBytes) break;
      if (this.visible.has(key)) continue;
      this.entries.delete(key);
      this.bytes -= entry.bytes;
      entry.value.close?.();
      if (entry.value.tagName === "CANVAS")
        entry.value.width = entry.value.height = 0;
    }
  }
}
