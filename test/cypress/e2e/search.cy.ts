describe('Search', () => {
  beforeEach(() => {
    cy.visit('/');
    cy.get('.card-body');
    cy.get('.col-sm-12').contains('Login');
    /* ==== Generated with Cypress Studio ==== */
    cy.get('#username').type('admin');
    cy.get('#password').clear();
    cy.get('#password').type('admin');
    cy.intercept({
      method: 'Get',
      url: '/pgapi/gallery/content/',
    }).as('getContent');
    cy.get('.col-sm-12 > .btn').click();
  });
  it('Search builder should propagate to search bar', () => {
    cy.location('pathname').should('include', '/gallery');

    cy.get('app-gallery-search .search-text').type('a and b', {force: true});
    cy.get('app-gallery-search ng-icon[name="ionChevronDownOutline"]').click();
    cy.get('app-gallery-search-query-builder app-gallery-search-field-base input.search-text').should('have.value', 'a and b');
    cy.get('app-gallery-search-query-entry .btn-danger').last().click();
    cy.get('app-gallery-search-query-builder app-gallery-search-field-base input.search-text').should('have.value', 'a');
    cy.get('modal-container .btn-close').click();
    cy.get('app-gallery-search .search-text').should('have.value', 'a');

  });

  // Android keyboards often send Enter as an unidentified key (229) that no keydown.enter handler sees,
  // but the browser still submits the form of the field (#1214)
  const pressEnterLikeAPhoneKeyboard = (selector: string): void => {
    cy.window().then((win) => {
      const hideEnter = (e: KeyboardEvent): void => {
        if (e.key !== 'Enter') {
          return;
        }
        // only hidden from the handlers, the default action (submitting the form) still happens
        e.stopImmediatePropagation();
        win.removeEventListener('keydown', hideEnter, true);
      };
      win.addEventListener('keydown', hideEnter, true);
    });
    cy.get(selector).then(($input) => {
      const input = $input[0] as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}));
      // the browser's implicit submission of a form by Enter
      input.form.requestSubmit();
    });
  };

  it('Search dialog should search on Enter and close', () => {
    cy.location('pathname').should('include', '/gallery');
    cy.get('app-gallery-search ng-icon[name="ionChevronDownOutline"]').click();
    const builderText = 'modal-container app-gallery-search-field-base input.search-text';
    cy.get(builderText).type('IMG_5910{enter}');

    cy.location('pathname').should('include', '/search/');
    cy.get('modal-container').should('not.exist');
    cy.get('.photo-container img[alt="IMG_5910.jpg"]');
  });

  it('Phone keyboard Enter should search from the search bar', () => {
    cy.location('pathname').should('include', '/gallery');
    const searchBar = 'app-gallery-search .search-text';
    cy.get(searchBar).should('have.attr', 'enterkeyhint', 'search');
    cy.get(searchBar).type('IMG_5910', {force: true});
    pressEnterLikeAPhoneKeyboard(searchBar);

    cy.location('pathname').should('include', '/search/');
    cy.get('.photo-container img[alt="IMG_5910.jpg"]');
  });

  it('Phone keyboard Enter should search from the search dialog and close it', () => {
    cy.location('pathname').should('include', '/gallery');
    cy.get('app-gallery-search ng-icon[name="ionChevronDownOutline"]').click();
    const builderText = 'modal-container app-gallery-search-field-base input.search-text';
    cy.get(builderText).should('have.attr', 'enterkeyhint', 'search');
    cy.get(builderText).type('IMG_5910');
    pressEnterLikeAPhoneKeyboard(builderText);

    // the typed query, not an emptied one
    cy.location('pathname').should('include', '/search/');
    cy.get('modal-container').should('not.exist');
    cy.get('.photo-container img[alt="IMG_5910.jpg"]');
  });
});
