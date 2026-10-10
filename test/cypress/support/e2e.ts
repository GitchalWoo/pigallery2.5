// ***********************************************************
// This example support/e2e.ts is processed and
// loaded automatically before your test files.
//
// This is a great place to put global configuration and
// behavior that modifies Cypress.
//
// You can change the location of this file or turn off
// automatically serving support files with the
// 'supportFile' configuration option.
//
// You can read more here:
// https://on.cypress.io/configuration
// ***********************************************************

// Ensure the test browser always requests and renders the English locale
beforeEach(() => {
  cy.setCookie('pigallery2-lang', 'en');
});

Cypress.on('window:before:load', (win) => {
  Object.defineProperty(win.navigator, 'language', {
    value: 'en-US',
    configurable: true,
  });
  Object.defineProperty(win.navigator, 'languages', {
    value: ['en-US', 'en'],
    configurable: true,
  });
});
