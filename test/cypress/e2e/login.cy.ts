describe('Login', () => {
  it('Page opens', () => {
    cy.visit('/');
    cy.get('#username').should('be.visible').and('have.attr', 'autocomplete', 'username');
    cy.get('#password').should('be.visible').and('have.attr', 'autocomplete', 'current-password');
  });
  it('Login', () => {
    cy.visit('/');
    /* ==== Generated with Cypress Studio ==== */
    cy.get('#username').type('admin');
    cy.get('#password').clear();
    cy.get('#password').type('admin');

    cy.intercept({
      method: 'Get',
      url: '/pgapi/gallery/content/',
    }).as('getContent');
    cy.get('form#form button[type="submit"]').click();
    cy.wait('@getContent').then((interception) => {
      expect(interception.response.statusCode).to.eq(200);
      assert.isNotNull(interception.response.body, '1st API call has data');
    });
    cy.location('pathname').should('include', '/gallery');
  });

});
