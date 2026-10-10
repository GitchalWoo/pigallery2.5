describe('Login', () => {
  it('Page opens', () => {
    cy.visit('/');
    cy.get('.card-body');
    cy.get('.col-sm-12').contains('Login');
  });
  it('Login', () => {
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
    cy.wait('@getContent').then((interception) => {
      expect(interception.response.statusCode).to.eq(200);
      assert.isNotNull(interception.response.body, '1st API call has data');
    });
    cy.location('pathname').should('include', '/gallery');
  });

});
