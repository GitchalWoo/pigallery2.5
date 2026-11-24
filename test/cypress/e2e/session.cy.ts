// P06: session UX (#1306, #1315) and API error statuses (#1305)
const loginWith = (username: string, password: string): void => {
  cy.get('#username').clear();
  cy.get('#username').type(username);
  cy.get('#password').clear();
  cy.get('#password').type(password);
  cy.get('.col-sm-12 > .btn').click();
};

const apiAsAdmin = (method: string, url: string, body: unknown): Cypress.Chainable<Cypress.Response<unknown>> =>
  cy.request({method: 'POST', url: '/pgapi/user/login', body: {loginCredential: {username: 'admin', password: 'admin'}}})
    .then(() => cy.getCookie('pigallery2-csrf-token'))
    .then((csrf) => cy.request({
      method, url, body, failOnStatusCode: false,
      headers: {'X-CSRF-TOKEN': csrf.value}
    }));

const endSession = (attempt = 0): void => {
  cy.wait(500);
  cy.clearCookies();
  cy.getCookie('pigallery2-session').then((cookie) => {
    if (cookie && attempt < 10) {
      endSession(attempt + 1);
    } else {
      expect(cookie).to.equal(null);
    }
  });
};

describe('Session', () => {
  beforeEach(() => {
    cy.clearCookies();
  });

  it('returns to the deep link after the login', () => {
    cy.visit('/albums');
    cy.location('pathname').should('eq', '/login');
    cy.location('search').should('eq', '?returnUrl=%2Falbums');
    loginWith('admin', 'admin');
    cy.location('pathname').should('eq', '/albums');
  });

  it('does not follow a return url to another site', () => {
    cy.visit('/login?returnUrl=%2F%2Fevil.example%2Fx');
    loginWith('admin', 'admin');
    cy.location('pathname').should('include', '/gallery');
    cy.location('host').should('eq', new URL(Cypress.config('baseUrl')).host);
  });

  it('clears the password after a wrong one', () => {
    cy.visit('/login');
    cy.intercept('POST', '/pgapi/user/login').as('login');
    loginWith('admin', 'wrong');
    cy.wait('@login').its('response.statusCode').should('eq', 401);
    // CI builds every locale and the browser may get another language: check the element, not its text
    cy.get('.error-message').first().should('be.visible').and('not.be.empty');
    cy.get('#password').should('have.value', '').and('have.focus');
    cy.get('#username').should('have.value', 'admin');
  });

  it('tells that the session has ended and returns to the page after the login', () => {
    cy.visit('/');
    loginWith('admin', 'admin');
    cy.location('pathname').should('include', '/gallery');
    cy.get('app-gallery-directories.directories > app-gallery-directory').contains('dupl').should('exist');
    // the session ends (e.g. it expired). Responses still on their way may set the cookie again: clear until it is gone.
    endSession();
    cy.intercept('GET', '/pgapi/gallery/content/dupl*').as('content');
    cy.get('app-gallery-directories.directories > app-gallery-directory').contains('dupl').click();
    cy.wait('@content').its('response.statusCode').should('eq', 401);
    cy.get('.toast-warning').should('be.visible');
    cy.location('pathname').should('eq', '/login');
    cy.location('search').should('eq', '?returnUrl=%2Fgallery%2Fdupl');
    // only once, also when several requests answered 401
    cy.get('.toast-warning').should('have.length', 1);
    loginWith('admin', 'admin');
    cy.location('pathname').should('eq', '/gallery/dupl');
  });

  it('sends a normal user from the admin page to their page with a warning', () => {
    apiAsAdmin('PUT', '/pgapi/user', {newUser: {name: 'p06user', password: 'p06pass', role: 2}})
      .its('status').should('be.oneOf', [200, 400]); // 400: created by an earlier run
    cy.clearCookies();
    cy.visit('/login');
    loginWith('p06user', 'p06pass');
    cy.location('pathname').should('not.eq', '/login');
    cy.visit('/admin');
    cy.get('.toast-warning').should('be.visible');
    cy.location('pathname').should('not.eq', '/admin');
    cy.location('pathname').should('not.eq', '/login');
  });

  it('answers API errors with their HTTP status and a JSON body', () => {
    cy.request({url: '/pgapi/does/not/exist', failOnStatusCode: false}).then((res) => {
      expect(res.status).to.eq(404);
      expect(res.headers['content-type']).to.contain('application/json');
      expect((res.body as { error: { code: number } }).error.code).to.eq(51); // PATH_ERROR
    });
    cy.request({url: '/pgapi/gallery/content/', failOnStatusCode: false}).then((res) => {
      expect(res.status).to.eq(401);
      expect((res.body as { error: { code: number } }).error.code).to.eq(1); // NOT_AUTHENTICATED
    });
  });
});
