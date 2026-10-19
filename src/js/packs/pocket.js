import { h } from '../dom.js';
import { renderDevice } from './pocket-device.js';

export function mount(ctx) {
  const lamp = h('div.pocket-lamp');
  ctx.root.append(lamp);
  const mounted = new Set();
  ctx.views.override('home', async () => ({ render(container) {
    const dispose = renderDevice(container, ctx);
    const cleanup = () => { dispose(); mounted.delete(cleanup); };
    mounted.add(cleanup);
    return cleanup;
  } }));
  return () => { mounted.forEach(cleanup => cleanup()); lamp.remove(); };
}
