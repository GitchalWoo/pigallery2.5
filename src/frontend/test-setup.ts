import 'zone.js';
import 'zone.js/testing';

if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as any;
  }

  if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = (() => ({
      clearRect: () => {},
      beginPath: () => {},
      arc: () => {},
      stroke: () => {},
      lineWidth: 0,
      strokeStyle: '',
      lineCap: '',
    })) as any;
  }
}

const ProxyZoneSpec = (Zone as any)['ProxyZoneSpec'];

if (ProxyZoneSpec) {
  const rootZone = Zone.current;
  const proxyZoneSpec = new ProxyZoneSpec();
  const proxyZone = rootZone.fork(proxyZoneSpec);

  const wrapTest = (fn: any) => {
    if (typeof fn !== 'function') {
      return fn;
    }
    return function (this: any, ...args: any[]) {
      proxyZoneSpec.resetDelegate();
      return proxyZone.run(fn, this, args);
    };
  };

  const patch = (target: any, key: string) => {
    const orig = target[key];
    if (!orig || orig.__zone_patched__) return;
    const patched = function (name: string, fn: any, ...rest: any[]) {
      return orig(name, wrapTest(fn), ...rest);
    };
    Object.assign(patched, orig);
    patched.__zone_patched__ = true;
    target[key] = patched;

    if (orig.only) {
      const origOnly = orig.only;
      const patchedOnly = function (name: string, fn: any, ...rest: any[]) {
        return origOnly(name, wrapTest(fn), ...rest);
      };
      Object.assign(patchedOnly, origOnly);
      patched.only = patchedOnly;
    }
  };

  patch(globalThis, 'it');
  patch(globalThis, 'test');
}

