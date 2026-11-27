// Keep this script parseable on browsers that cannot load the app bundles.
window.addEventListener('error', function (event) {
  var loading = document.getElementById('app-loading-text');
  if (!loading || !event.filename || event.filename.indexOf(document.baseURI) !== 0) {
    return;
  }
  var filename = event.filename.slice(document.baseURI.length);
  var appBundle = /^(main|polyfills|chunk)(-[a-z0-9]+)?\.js(?:[?#]|$)/i.test(filename);
  var syntaxError = (event.error && event.error.name === 'SyntaxError') || /\bSyntaxError\b/.test(event.message);
  if (appBundle && syntaxError) {
    loading.textContent = 'This browser is too old to run PiGallery. Please update it or use a newer browser.';
  }
});
