/**
 * Keyboard operation of the controls made accessible in chore/lint-accessibility
 * (adapted from upstream 23eb43d7), with screenshots to compare the legacy and Prism designs.
 * Run once per design: the screenshots are named after the design the server shows.
 */
describe('Keyboard accessibility', () => {
  const design = (): Cypress.Chainable<string> =>
    cy.document().then(d => d.documentElement.getAttribute('data-gallery-design') || 'classic');
  const shot = (name: string): void => {
    design().then(dsg => cy.screenshot(`a11y-${dsg}-${name}`, {capture: 'viewport', overwrite: true}));
  };

  beforeEach(() => {
    cy.viewport(1280, 800);
    cy.visit('/');
    cy.get('#username').type('admin');
    cy.get('#password').clear();
    cy.get('#password').type('admin');
    cy.intercept({method: 'Get', url: '/pgapi/gallery/content/'}).as('getContent');
    cy.get('.col-sm-12 > .btn').click();
    cy.wait('@getContent');
  });

  it('sorts with the keyboard', () => {
    // no scrolling: a scroll closes the dropdown
    cy.get('app-gallery-navbar #button-alignment').focus().type('{enter}', {scrollBehavior: false});
    cy.get('#sorting-dropdown').should('be.visible');
    cy.get('#sorting-dropdown button.sorting-grouping-item[role="menuitem"]').should('have.length.greaterThan', 3);
    shot('sort-menu');

    // the descending item is a native button: Tab reaches it and Enter activates it
    cy.get('#sorting-dropdown button.sorting-grouping-item').contains('descending').closest('button')
      .as('descending')
      .focus().should('have.focus')
      .type('{enter}', {scrollBehavior: false});
    cy.get('@descending').should('have.class', 'active');
  });

  it('filters with the keyboard', () => {
    // a filter change rebuilds the options, so look the option up again after each key
    const option = () => cy.get('app-gallery-navbar #gallery-filter-0').siblings('.filter-column')
      .contains('li[role="checkbox"]', 'Berkeley');

    cy.get('app-gallery-navbar button.btn-navigator ng-icon[name="ionFunnelOutline"]')
      .closest('button').focus().should('have.focus').type('{enter}');
    cy.get('app-gallery-navbar #gallery-filter-0').select('City', {force: true});
    option().should('have.attr', 'aria-checked', 'true').focus().should('have.focus');
    shot('filter');

    option().type(' ', {scrollBehavior: false});
    option().should('have.attr', 'aria-checked', 'false').and('have.class', 'unselected');
    option().type('{enter}', {scrollBehavior: false, force: true});
    option().should('have.attr', 'aria-checked', 'true').and('not.have.class', 'unselected');
  });

  it('opens the share dialog and the albums tile as buttons', () => {
    cy.get('button#button-frame-menu').click();
    cy.get('#dropdown-frame-menu').should('be.visible');
    shot('frame-menu');
    cy.get('button#button-frame-menu').click();

    cy.get('button#shareButton').focus().type('{enter}');
    cy.get('.modal-content').should('be.visible');
    shot('share');
    cy.get('.modal-content button.btn-close').click();

    cy.visit('/albums');
    cy.get('button.add-saved-search').should('be.visible').and('have.attr', 'type', 'button');
    shot('albums');
  });

  it('shows the lightbox and map controls as buttons', () => {
    cy.get('app-gallery-grid-photo .photo-container').first().click();
    cy.get('app-lightbox-controls [role="button"][tabindex="-1"]').should('have.length.greaterThan', 2);
    cy.get('app-gallery-lightbox-media img').should('have.attr', 'alt').and('not.be.empty');
    shot('lightbox');
    cy.get('body').type('{esc}');
    cy.location('search').should('not.contain', 'p=');
    cy.wait(1000); // the close animation

    cy.get('app-gallery-map').scrollIntoView();
    cy.get('app-gallery-map button.overlay').should('have.attr', 'aria-label', 'Open the map');
    shot('map');
  });
});
