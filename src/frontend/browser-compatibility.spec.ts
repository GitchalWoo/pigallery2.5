import './browser-compatibility.js';

describe('Browser startup feedback', () => {
  let loading: HTMLHeadingElement;

  beforeEach(() => {
    loading = document.createElement('h2');
    loading.id = 'app-loading-text';
    loading.textContent = 'Loading...';
    document.body.append(loading);
  });

  afterEach(() => loading.remove());

  const reportError = (filename: string, error: Error) => {
    window.dispatchEvent(new ErrorEvent('error', {
      filename: new URL(filename, document.baseURI).href,
      message: error.toString(),
      error,
    }));
  };

  it('reports a syntax error in an app bundle before startup', () => {
    reportError('main-ABC123.js', new SyntaxError('Unexpected token'));
    expect(loading.textContent).toContain('This browser is too old');
  });

  it('leaves other startup errors and other scripts alone', () => {
    reportError('main-ABC123.js', new Error('Connection lost'));
    reportError('custom-extension.js', new SyntaxError('Unexpected token'));
    expect(loading.textContent).toBe('Loading...');
  });
});
