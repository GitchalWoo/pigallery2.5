describe('Loading, empty and error states', () => {
  const get = (pathname: string): Cypress.RouteMatcher => ({method: 'GET', pathname});
  const folderResponse = (name: string, contentAvailable: boolean, metaFile: {name: string}[] = []) => ({
    error: null,
    result: {
      directory: {name, path: '/', media: [], directories: [], metaFile, contentAvailable, cache: {mediaCount: 0}},
      map: {},
    },
  });

  beforeEach(() => {
    cy.viewport(1280, 800);
    cy.visit('/');
    cy.get('#username').type('admin');
    cy.get('#password').clear().type('admin', {log: false});
    cy.get('.col-sm-12 > .btn').click();
    cy.get('app-gallery').should('exist');
  });

  it('shows folder loading and an inline retry, then an empty folder', () => {
    const folder = 'p11-retry/nested';
    const endpoint = get('/pgapi/gallery/content/' + encodeURIComponent(folder));
    cy.intercept(endpoint, {body: folderResponse('nested', true)}).as('retryFolder');
    cy.intercept({...endpoint, times: 1}, {
      delay: 1000, statusCode: 500, body: {error: {message: 'Listing failed'}},
    }).as('failedFolder');
    cy.visit('/gallery/' + folder);
    cy.get('app-gallery app-spinner [role="status"]').should('be.visible');
    cy.wait('@failedFolder');
    cy.get('app-gallery [role="alert"]').should('contain.text', 'Could not load this folder.');
    cy.get('app-gallery app-empty-state').contains('button', 'Retry').click();
    cy.wait('@retryFolder');
    cy.get('app-gallery app-empty-state').should('contain.text', 'This folder is empty.');
    cy.get('app-gallery app-spinner').should('not.exist');
  });

  it('distinguishes empty search results and broken search links', () => {
    const query = {type: 100, value: 'a term with no matches'};
    cy.intercept(get('/pgapi/search/*'), {
      body: {error: null, result: {searchResult: {searchQuery: query, media: [], directories: []}, map: {}}},
    }).as('search');
    cy.visit('/search/' + encodeURIComponent(JSON.stringify(query)));
    cy.wait('@search');
    cy.get('app-gallery app-empty-state').should('contain.text', 'matched nothing');
    cy.visit('/search/' + encodeURIComponent('{"t":99999}'));
    cy.get('app-gallery [role="alert"]').should('contain.text', 'This search link is broken.');
    cy.get('app-gallery app-empty-state button').should('not.exist');
    cy.get('@search.all').should('have.length', 1);
  });

  it('shows the app 404 and returns to the gallery', () => {
    cy.request({url: '/unknown/app-page', failOnStatusCode: false}).then(response => {
      expect(response.status).to.equal(404);
      expect(response.headers['content-type']).to.include('text/html');
    });
    cy.visit('/unknown/app-page', {failOnStatusCode: false});
    cy.get('app-not-found h1').should('have.text', 'Page not found');
    cy.get('app-not-found a').click();
    cy.get('app-gallery').should('exist');
  });

  it('shows loading before an empty collection on Albums, Faces and Duplicates', () => {
    const pages = [
      {url: '/albums', api: '/pgapi/albums', tag: 'app-albums', empty: 'No albums to show.'},
      {url: '/faces', api: '/pgapi/person', tag: 'app-faces', empty: 'No faces to show.'},
      {url: '/duplicates', api: '/pgapi/admin/duplicates', tag: 'app-duplicate', empty: 'No duplicates found'},
    ];
    for (const page of pages) {
      cy.intercept(get(page.api), {delay: 1000, body: {error: null, result: []}}).as('collection');
      cy.visit(page.url);
      cy.get(page.tag + ' app-spinner').should('be.visible');
      cy.get(page.tag).should('not.contain.text', page.empty);
      cy.get(page.tag + ' .add-saved-search').should('not.exist');
      cy.wait('@collection');
      cy.get(page.tag).should('contain.text', page.empty);
      if (page.url === '/albums') {
        cy.get(page.tag + ' .album-tiles button.add-saved-search').should('be.visible');
      }
    }
  });

  it('updates the notification badge and scrolls a long toast within its card', () => {
    const notification = {type: 3, message: 'A long notification with multiple words. '.repeat(90)};
    cy.intercept(get('/pgapi/notifications'), {
      delay: 1000, body: {error: null, result: [notification, notification]},
    }).as('notifications');
    cy.visit('/gallery/');
    cy.get('app-frame #button-frame-menu').should('be.visible').find('.navbar-badge').should('not.exist');
    cy.wait('@notifications');
    cy.get('app-frame #button-frame-menu .navbar-badge').should('have.text', '2');
    cy.get('#toast-container .toast-message').should('be.visible').should($message => {
      const message = $message[0];
      expect(message.scrollHeight).to.be.greaterThan(message.clientHeight);
      expect(message.ownerDocument.defaultView.getComputedStyle(message).overflowY).to.equal('auto');
    });
    cy.get('#toast-container .toast-close-button').click();
    cy.get('#toast-container .toast-message').should('not.exist');
  });

  it('offers upload in an empty marked folder and hides it in a navigation-only folder', () => {
    const enableUploads = (win: Window, enforceMarker: boolean) => {
      interface Injected {
        ConfigInject: {Upload: {enabled: boolean; enforcedDirectoryConfig: boolean}};
      }
      let injected: Injected;
      Object.defineProperty(win, 'ServerInject', {
        configurable: true,
        get: () => injected,
        set: (value: Injected) => {
          value.ConfigInject.Upload.enabled = true;
          value.ConfigInject.Upload.enforcedDirectoryConfig = enforceMarker;
          injected = value;
        },
      });
    };
    cy.intercept(get('/pgapi/gallery/content/p11-upload'), {
      body: folderResponse('p11-upload', true, [{name: '.uploader.pg2conf'}]),
    }).as('uploadFolder');
    cy.intercept('POST', '/pgapi/upload/p11-upload', {body: {error: null, result: []}}).as('upload');
    cy.visit('/gallery/p11-upload', {onBeforeLoad: win => enableUploads(win, true)});
    cy.wait('@uploadFolder');
    cy.get('app-gallery app-empty-state').contains('button', 'Upload').should('be.visible');
    cy.get('app-gallery app-empty-state input[type=file]').selectFile({
      contents: Cypress.Buffer.from('sample'),
      fileName: 'sample.jpg',
    }, {force: true});
    cy.wait('@upload');

    cy.intercept(get('/pgapi/gallery/content/p11-parent'), {
      body: folderResponse('p11-parent', false),
    }).as('parentFolder');
    cy.visit('/gallery/p11-parent', {onBeforeLoad: win => enableUploads(win, false)});
    cy.wait('@parentFolder');
    cy.get('app-gallery app-empty-state').should('contain.text', 'This folder is empty.')
      .find('button').should('not.exist');
    cy.get('#button-frame-menu').click();
    cy.get('#dropdown-frame-menu').should('not.contain.text', 'Upload');
  });
});
