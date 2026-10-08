/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-explicit-any */
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

