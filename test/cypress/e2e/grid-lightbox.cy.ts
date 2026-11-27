describe('Grid and lightbox navigation', () => {
  const photo = 'app-gallery-grid-photo img[alt="IMG_5910.jpg"]';

  beforeEach(() => {
    cy.request('POST', '/pgapi/user/login', {
      loginCredential: {username: 'admin', password: 'admin', rememberMe: false},
    });
  });

  it('restores the first gallery entry after a keyword search and restores the search on Forward', () => {
    cy.viewport(1000, 560);
    let loadGallery: () => void;
    const heldRequest = new Cypress.Promise<void>(resolve => {
      loadGallery = resolve;
    });
    cy.intercept({method: 'GET', url: '/pgapi/gallery/content/', times: 1}, () => heldRequest).as('initialGallery');
    cy.visit('/gallery/');
    cy.window().its('history.scrollRestoration').should('equal', 'manual');
    cy.get('app-gallery-grid').should('not.exist');
    cy.then(() => loadGallery());
    cy.wait('@initialGallery');

    cy.get(photo, {timeout: 15000}).should('have.class', 'loaded').then(img => {
      const win = img[0].ownerDocument.defaultView;
      win.scrollBy({top: img[0].getBoundingClientRect().top - 110, behavior: 'instant'});
    });
    cy.get(photo).closest('.photo-container').trigger('mouseenter', {scrollBehavior: false});
    cy.window().its('scrollY').should('be.greaterThan', 200).then(galleryY => {
      cy.contains('.photo-keywords a', 'Berkley').click({force: true, scrollBehavior: false});
      cy.location('pathname').should('match', /^\/search\//);
      cy.get(photo).should('exist');

      cy.go('back');
      cy.location('pathname').should('match', /^\/gallery\/?$/);
      cy.get(photo, {timeout: 15000}).should('have.class', 'loaded');
      cy.window().its('scrollY').should('be.closeTo', galleryY, 40);
      cy.get(photo).should(img => expect(getComputedStyle(img[0]).transitionDuration).to.equal('0s'));

      cy.go('forward');
      cy.location('pathname').should('match', /^\/search\//);
      cy.get(photo).should('exist');
      cy.window().its('scrollY').should('be.closeTo', 0, 4);
    });
  });

  it('opens a photo with Enter and returns from a face search through lightbox history', () => {
    cy.viewport(1000, 560);
    cy.visit('/gallery/');
    cy.get(photo, {timeout: 15000}).scrollIntoView();
    cy.get(photo).closest('.photo-link').focus().closest('.photo-container').should(container => {
      const info = container[0].querySelector('.info');
      expect(info, 'the focused photo info bar').not.to.be.null;
      expect(info.getBoundingClientRect().bottom).to.be.closeTo(container[0].getBoundingClientRect().bottom, 1);
    });
    cy.press(Cypress.Keyboard.Keys.ENTER);
    cy.get('app-lightbox-controls a.face').contains('Alvin the Squirrel').click({force: true, scrollBehavior: false});
    cy.location('pathname').should('match', /^\/search\//);
    cy.get('app-lightbox-controls').should('not.exist');
    cy.get(photo).should('exist');

    cy.go('back');
    cy.location('pathname').should('match', /^\/gallery\/?$/);
    // The lightbox was its own history entry.
    cy.get('app-lightbox-controls').should('exist');
    cy.go('back');
    cy.location('search').should('not.contain', 'p=');
    cy.get('app-lightbox-controls').should('not.exist');
    cy.get(photo).should(img => {
      const {top, bottom} = img[0].getBoundingClientRect();
      expect(top).to.be.lessThan(img[0].ownerDocument.documentElement.clientHeight);
      expect(bottom).to.be.greaterThan(0);
    });
  });

  it('reveals faces before navigating on touch and zooms on a double tap', () => {
    cy.viewport(390, 700);
    cy.visit('/gallery/?p=IMG_5910.jpg');
    const face = 'app-lightbox-controls a.face';
    const touch = (count: number): void => {
      cy.get(face).contains('Alvin the Squirrel').closest('a').then(link => {
        const element = link[0];
        const {PointerEvent} = element.ownerDocument.defaultView as Window & typeof globalThis;
        for (let tap = 0; tap < count; tap++) {
          for (const type of ['pointerdown', 'pointerup']) {
            element.dispatchEvent(new PointerEvent(type, {
              pointerId: 1, pointerType: 'touch', bubbles: true, button: 0, clientX: 180, clientY: 250,
            }));
          }
        }
      });
    };
    touch(2);
    cy.get('.zoom-progress').should('exist');
    touch(2);
    cy.get('.zoom-progress').should('not.exist');
    touch(1);
    cy.get('.faces-shown .face-name').should('contain.text', 'Alvin the Squirrel');
    cy.location('pathname').should('match', /^\/gallery\/?$/);
    touch(1);
    cy.location('pathname').should('match', /^\/search\//);
    cy.get('app-lightbox-controls').should('not.exist');
  });

  it('fits the video buttons and sliders side by side on a narrow phone', () => {
    cy.viewport(320, 640);
    cy.visit('/gallery/?p=bunny.mp4');
    cy.get('.controls-video').children().should(controls => {
      expect(controls).to.have.length(4);
      let rightEdge = 0;
      for (const control of controls) {
        const bounds = control.getBoundingClientRect();
        expect(bounds.width).to.be.greaterThan(0);
        expect(bounds.left).to.be.at.least(rightEdge);
        rightEdge = bounds.right;
      }
      expect(rightEdge).to.be.at.most(320);
    });
    cy.get('input.video-progress').focus();
    cy.press(Cypress.Keyboard.Keys.RIGHT);
    cy.location('search').should('contain', 'p=bunny.mp4');
  });

  it('keeps the Timeline scrubber and date headers working across a month jump', () => {
    cy.request('/pgapi/gallery/content/');
    cy.visit('/timeline');
    const scrubber = '.timeline-scrubber[role="slider"]';
    cy.get(scrubber, {timeout: 15000}).should(track => {
      expect(Number(track.attr('aria-valuemax'))).to.be.greaterThan(0);
    }).focus();
    cy.press(Cypress.Keyboard.Keys.END);
    cy.location('search').should('match', /[?&]at=\d{4}-\d{2}/);
    cy.get('app-gallery-grid .group-header', {timeout: 15000}).should('exist');
    cy.go('back');
    cy.location('search').should('equal', '');
    cy.get(scrubber).should('have.attr', 'aria-valuenow', '0');
  });
});
