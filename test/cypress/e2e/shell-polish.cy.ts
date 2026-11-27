describe('Shell, settings and installed app', () => {
  beforeEach(() => {
    cy.viewport(1280, 800);
    cy.visit('/', {onBeforeLoad: window => cy.spy(window.console, 'info').as('consoleInfo')});
    cy.get('#username').type('admin');
    cy.get('#password').type('admin', {log: false});
    cy.get('form#form button[type="submit"]').click();
    cy.location('pathname').should('include', '/gallery');
  });

  it('keeps navbar controls usable and closes the menu on outside click or Escape', () => {
    cy.get('#navbarCollapse').should('not.have.attr', 'aria-hidden', 'true');
    cy.get('#directory-path').should('be.visible');
    cy.get('#button-frame-menu').focus().should('be.focused');
    cy.press(Cypress.Keyboard.Keys.ENTER);
    cy.get('#dropdown-frame-menu').should('be.visible');
    cy.get('#dropdown-frame-menu button[aria-controls="dropdown-frame-tools"]').focus().should('be.focused');
    cy.press(Cypress.Keyboard.Keys.ENTER);
    cy.get('#dropdown-frame-tools').should('be.visible');
    cy.get('#dropdown-frame-tools #fix-switch').check({scrollBehavior: false});
    cy.get('#dropdown-frame-menu').should('be.visible');
    cy.get('#dropdown-frame-tools #fix-switch').focus();
    cy.press(Cypress.Keyboard.Keys.ESC);
    cy.get('#dropdown-frame-menu').should('not.exist');
    cy.focused().should('have.id', 'button-frame-menu');
    cy.get('#button-frame-menu').click({scrollBehavior: false});
    cy.get('#dropdown-frame-menu').should('be.visible');
    cy.get('#directory-path').click({scrollBehavior: false});
    cy.get('#dropdown-frame-menu').should('not.exist');
  });

  it('logs the frontend build and makes the commit link keyboard reachable', () => {
    cy.get('@consoleInfo').should('have.been.calledWithMatch', /PiGallery2\.5 client pigallery2\.5@[0-9a-f]{8}.*commit [0-9a-f]{40}/);
    cy.visit('/admin');
    cy.get('a.version').focus();
    cy.get('.version-popover a').should('have.attr', 'href')
      .and('match', /^https:\/\/github\.com\/GitchalWoo\/pigallery2\.5\/commit\/[0-9a-f]{40}$/);
    cy.press(Cypress.Keyboard.Keys.TAB);
    cy.focused().should('match', '.version-popover a');
    cy.press(Cypress.Keyboard.Keys.ESC);
    cy.get('.version-popover').should('not.exist');
    cy.focused().should('have.class', 'version');
  });

  it('shows configured job progress with the Jobs card hidden', () => {
    const name = 'Indexing';
    const hash = 'Indexing-",indexChangesOnly:true"';
    cy.intercept('GET', '/pgapi/settings', request => {
      request.continue(response => {
        // A non-default indexing option keeps its card visible in Basic mode.
        response.body.result.Indexing.reIndexingSensitivity = 40;
      });
    });
    cy.intercept('GET', '/pgapi/admin/jobs/available', {
      error: null, result: [{Name: name, ConfigTemplate: [{id: 'indexChangesOnly', defaultValue: true}]}],
    }).as('availableJobs');
    const start = Date.now() - 10000;
    cy.intercept('GET', '/pgapi/admin/jobs/scheduled/progress', {
      error: null,
      result: {
        [hash]: {
          HashName: hash, jobName: name, state: 1, logs: [],
          steps: {all: 4, processed: 2, skipped: 0}, time: {start, end: start},
        },
      },
    }).as('progress');
    cy.visit('/admin');
    cy.wait(['@availableJobs', '@progress']);
    cy.get('#Jobs').should('not.be.visible');
    cy.get('#Indexing [role="progressbar"]').should('be.visible').and('contain.text', '2/4');
  });

  it('uses the active shell color and declares valid phone install metadata', () => {
    cy.viewport(390, 700);
    cy.document().should(document => {
      const background = document.defaultView.getComputedStyle(document.body).backgroundColor;
      expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).to.equal(background);
      expect(document.querySelector('link[rel="apple-touch-icon"]').getAttribute('href')).to.equal('icon_180.png');
    });
    cy.request('/manifest.json').then(({body}) => {
      const manifest = typeof body === 'string' ? JSON.parse(body) : body;
      expect(manifest).to.include({id: '/', scope: '/', start_url: '/', display: 'standalone'});
      expect(manifest.icons.map(icon => icon.sizes)).to.include.members(['192x192', '512x512']);
    });
  });

  it('wraps from the last photo to the first with the default loop setting', () => {
    cy.visit('/gallery/timestamps');
    cy.get('app-gallery-grid-photo img').should('have.length', 7).then(photos => {
      const first = photos[0].getAttribute('alt');
      cy.wrap(photos.last()).closest('.photo-link').click();
      cy.get('#rightArrow .restart-icon').should('exist');
      cy.get('#rightArrow').click({force: true});
      cy.location('search').should(search => expect(new URLSearchParams(search).get('p')).to.equal(first));
    });
  });

  it('keeps the lightbox info directory link available to the keyboard', () => {
    cy.request('/pgapi/gallery/content/timestamps');
    const query = {type: 103, matchType: 1, value: 'big_ben.jpg'};
    cy.visit('/search/' + encodeURIComponent(JSON.stringify(query)));
    cy.get('app-gallery-grid-photo img[alt="big_ben.jpg"]').closest('.photo-link').click();
    cy.get('app-lightbox-controls [title="info key: i"]').click({force: true});
    cy.get('app-info-panel a.dir-link').should('have.attr', 'href').and('match', /^\/gallery\/timestamps(?:\?|$)/);
    cy.get('app-info-panel a.dir-link').focus().should('be.focused');
  });
});
