// Minimal browser surface for importing the real renderer modules in Node.
// No playback, layout, or networking is simulated.
class Events {
  listeners = new Map();
  addEventListener(type, listener, options = {}) {
    const entries = this.listeners.get(type) || new Map();
    entries.set(listener, options);
    this.listeners.set(type, entries);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatchEvent(event) {
    for (const [listener, options] of [...(this.listeners.get(event.type) || [])]) {
      if (options.once) this.removeEventListener(event.type, listener);
      listener(event);
    }
    return true;
  }
  listenerCount(type) { return this.listeners.get(type)?.size || 0; }
}

const observers = new Set();
function removed(parent, node) {
  if (!parent.isConnected) return;
  for (const observer of observers) {
    observer.records.push({ removedNodes: [node] });
    if (observer.pending) continue;
    observer.pending = true;
    queueMicrotask(() => {
      observer.pending = false;
      observer.callback(observer.records.splice(0));
    });
  }
}

class FakeNode extends Events {
  childNodes = [];
  parentNode = null;
  get firstChild() { return this.childNodes[0] || null; }
  get isConnected() { return this === globalThis.document || !!this.parentNode?.isConnected; }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }
  removeChild(node) {
    removed(this, node);
    this.childNodes.splice(this.childNodes.indexOf(node), 1);
    node.parentNode = null;
    return node;
  }
  append(...nodes) { nodes.forEach(node => this.appendChild(node instanceof FakeNode ? node : document.createTextNode(String(node)))); }
  prepend(...nodes) {
    this.append(...nodes);
    this.childNodes.unshift(...this.childNodes.splice(-nodes.length));
  }
  remove() { this.parentNode?.removeChild(this); }
}

class FakeElement extends FakeNode {
  className = '';
  dataset = {};
  attributes = new Map();
  style = { setProperty(key, value) { this[key] = value; } };
  classList = { add() {}, remove() {}, toggle() {} };
  setAttribute(key, value) { this.attributes.set(key, value); }
  hasAttribute(key) { return this.attributes.has(key); }
  getBoundingClientRect() { return { width: 0, height: 0, left: 0 }; }
}

class FakeFragment extends FakeNode {}

export const resizeObservers = [];
let installed = false;
export function installBrowser() {
  if (installed) return;
  installed = true;
  const document = new FakeElement();
  document.documentElement = document.appendChild(new FakeElement());
  document.body = document.documentElement.appendChild(new FakeElement());
  document.createElement = () => new FakeElement();
  document.createTextNode = text => Object.assign(new FakeNode(), { textContent: text });
  document.getElementById = id => {
    const find = node => node.id === id ? node : node.childNodes.map(find).find(Boolean);
    return find(document) || null;
  };
  document.hasFocus = () => true;
  const storage = new Map();
  const values = {
    document,
    window: Object.assign(new Events(), { native: { api() { throw new Error('Unexpected API call'); } } }),
    location: { hash: '' },
    Node: FakeNode,
    Element: FakeElement,
    DocumentFragment: FakeFragment,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      clear: () => storage.clear()
    },
    navigator: { mediaSession: { setActionHandler() {} } },
    Audio: class extends Events { paused = true; currentTime = 0; duration = 0; },
    Notification: class {},
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    MutationObserver: class {
      records = [];
      constructor(callback) { this.callback = callback; }
      observe() { observers.add(this); }
      disconnect() { observers.delete(this); }
    },
    ResizeObserver: class {
      disconnected = false;
      constructor() { resizeObservers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    requestAnimationFrame: () => 0
  };
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
}
