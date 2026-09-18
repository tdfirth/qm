import { JSDOM, type ConstructorOptions, type DOMWindow } from "jsdom";

export const DOM_GLOBALS = ["window", "document", "location", "history", "localStorage", "navigator", "HTMLElement"];

export const timeoutFrames = {
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
  cancelAnimationFrame: clearTimeout,
};

export class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

interface DomOptions extends ConstructorOptions {
  globals?: readonly string[];
  define?: (window: DOMWindow) => Record<string, unknown>;
  matchMedia?: boolean;
}

export interface Dom {
  dom: JSDOM;
  window: DOMWindow;
  document: Document;
  restore(): void;
}

export function withDom(
  markup: string,
  { globals = DOM_GLOBALS, define, matchMedia = true, ...jsdom }: DomOptions = {},
): Dom {
  const dom = new JSDOM(markup, jsdom);
  if (matchMedia)
    Object.defineProperty(dom.window, "matchMedia", {
      value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    });
  const values: Record<string, unknown> = {};
  for (const key of globals) values[key] = (dom.window as unknown as Record<string, unknown>)[key];
  Object.assign(values, define?.(dom.window));
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(values)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return {
    dom,
    window: dom.window,
    document: dom.window.document,
    restore() {
      dom.window.close();
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}
