/**
 * Sorting and grouping by directory (upstream #1198), the flatten glob (91e374dc), the breadcrumb's Home (#1343)
 * and the sorting menu on a phone (9fe9eaaf), on the demo flatten-test folder:
 * flatten-test/{ft-root, nested/{ft-level1, deeper/{ft-level2, deepest/ft-level3}}, nested-sibling/ft-sibling}.
 * Run once per design: the screenshots are named after the design the server shows.
 */
const SEARCH_DIRECTORY = 102; // SearchQueryTypes.directory
const GLOB_MATCH = 3; // TextSearchQueryMatchTypes.globMatch

describe('Sorting and grouping by directory', () => {
  const design = (): Cypress.Chainable<string> =>
    cy.document().then(d => d.documentElement.getAttribute('data-gallery-design') || 'classic');
  const shot = (name: string): void => {
    design().then(dsg => cy.screenshot(`directory-sort-${dsg}-${name}`, {capture: 'viewport', overwrite: true}));
  };
  const photo = (name: string) => cy.get(`app-gallery-grid-photo img[alt="${name}"]`);
  // the folders are indexed when they are opened: a search finds only indexed folders
  const indexFlattenTest = (): void => {
    ['flatten-test', 'flatten-test/nested', 'flatten-test/nested/deeper', 'flatten-test/nested/deeper/deepest',
      'flatten-test/nested-sibling'].forEach(folder => cy.request('/pgapi/gallery/content/' + encodeURIComponent(folder)));
  };
  const flatten = (folder: string): void => {
    indexFlattenTest();
    cy.intercept({method: 'Get', url: '/pgapi/search/*'}).as('getSearch');
    cy.visit('/search/' + encodeURIComponent(JSON.stringify({type: SEARCH_DIRECTORY, matchType: GLOB_MATCH, value: folder + '/*'})));
    cy.wait('@getSearch');
  };
  const openSortMenu = (): void => {
    // no scrolling: a scroll closes the dropdown
    cy.get('app-gallery-navbar #button-alignment').click({scrollBehavior: false});
    cy.get('#sorting-dropdown').should('be.visible');
  };
  // the sorting is the first column of the menu, the grouping the second
  const menuItems = (column: number) => cy.get('#sorting-dropdown > .row > .col').eq(column).find('button.sorting-grouping-item');

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

  it('groups a flattened folder by directory in tree order and opens a folder from its header', () => {
    flatten('flatten-test');
    openSortMenu();
    menuItems(0).contains('directory').should('exist');
    menuItems(1).contains('directory').closest('button').click({scrollBehavior: false});
    menuItems(1).contains('directory').closest('button').should('have.class', 'active');
    // a search groups descending by default
    menuItems(1).contains('ascending').closest('button').click({scrollBehavior: false});
    cy.get('app-gallery-navbar #button-alignment').click({scrollBehavior: false});

    // a folder is right before its subfolders, the sibling with the longer name comes after them
    cy.get('.directory-header a.directory-link').then(links => [...links].map(l => l.textContent.trim()))
      .should('deep.equal', [
        'flatten-test', 'flatten-test/nested', 'flatten-test/nested/deeper', 'flatten-test/nested/deeper/deepest',
        'flatten-test/nested-sibling'
      ]);
    cy.get('.directory-header a.directory-link').eq(1).should('have.attr', 'title', 'flatten-test/nested');
    // the paths do not widen the page
    cy.document().its('documentElement').should(el => expect(el.scrollWidth, 'page width').to.be.at.most(el.clientWidth));
    shot('grouped');

    cy.intercept({method: 'Get', url: '/pgapi/gallery/content/*'}).as('getFolder');
    cy.get('.directory-header a.directory-link').eq(1).click();
    cy.wait('@getFolder');
    cy.get('#directory-path li').last().should('contain.text', 'nested');
    photo('ft-level1.jpg').should('exist');
    photo('ft-root.jpg').should('not.exist');
  });

  it('flattens only the folder and its subfolders, not a sibling that starts with the same name', () => {
    flatten('flatten-test/nested');
    photo('ft-level1.jpg').should('exist');
    photo('ft-level2.jpg').should('exist');
    photo('ft-level3.jpg').should('exist');
    photo('ft-sibling.jpg').should('not.exist');
  });

  it('does not offer directory for a folder and links Home to /gallery without %2F', () => {
    cy.intercept({method: 'Get', url: '/pgapi/gallery/content/*'}).as('getFolder');
    cy.visit('/gallery/flatten-test');
    cy.wait('@getFolder');
    openSortMenu();
    menuItems(0).should('have.length.greaterThan', 3);
    cy.get('#sorting-dropdown').should('not.contain.text', 'directory');
    cy.get('app-gallery-navbar #button-alignment').click({scrollBehavior: false});

    cy.get('#directory-path li').first().find('a')
      .should('have.attr', 'href').and('not.contain', '%2F').and('match', /\/gallery\/?$/);
    // the root content may come from the client cache: no request to wait for
    cy.get('#directory-path li').first().find('a').click();
    cy.location('pathname').should('match', /^\/gallery\/?$/);
    cy.get('#directory-path li').should('have.length', 1);
  });

  it('keeps the sorting menu on a phone screen', () => {
    cy.viewport(320, 640);
    flatten('flatten-test');
    openSortMenu();
    menuItems(0).contains('name').closest('button').click({scrollBehavior: false});
    // the menu is fitted on the next frame after it opened or changed: retry until then
    cy.get('#sorting-dropdown').should('be.visible').should(menu => {
      const rect = menu[0].getBoundingClientRect();
      expect(rect.left, 'left edge').to.be.at.least(0);
      expect(rect.right, 'right edge').to.be.at.most(320);
    });
    shot('phone-menu');
  });
});
