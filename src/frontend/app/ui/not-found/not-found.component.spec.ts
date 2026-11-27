import {TestBed} from '@angular/core/testing';
import {RouterTestingHarness} from '@angular/router/testing';
import {provideRouter, UrlSegment} from '@angular/router';
import {Component} from '@angular/core';
import {provideIcons} from '@ng-icons/core';
import {ionSearchOutline} from '@ng-icons/ionicons';
import {PiTitleService} from '../../model/pi-title.service';
import {NotFoundComponent} from './not-found.component';
import {galleryMatcherFunction} from '../../app.routing';
import {QueryParams} from '../../../../common/QueryParams';

@Component({template: 'Gallery'})
class TestGalleryComponent {}

describe('NotFoundComponent', () => {
  it('shows the page title and links back to the gallery', async () => {
    const title = {setTitle: vi.fn()};
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {path: 'gallery', component: TestGalleryComponent},
          {path: '**', component: NotFoundComponent},
        ]),
        provideIcons({ionSearchOutline}),
        {provide: PiTitleService, useValue: title},
      ],
    });
    const harness = await RouterTestingHarness.create('/unknown/page');
    expect(harness.routeNativeElement.querySelector('h1').textContent.trim()).toBe('Page not found');
    expect(title.setTitle).toHaveBeenCalledWith('Page not found');
    expect(harness.routeNativeElement.querySelector('a').getAttribute('href')).toBe('/gallery');
  });
});

describe('Gallery page matcher', () => {
  it.each([['gallery', 'family/2026.10'], ['search', '{"t":102,"v":"family/2026.10"}']])(
    'keeps %s deep links with encoded and unencoded slashes', (route, value) => {
      const parameter = route === 'gallery' ? QueryParams.gallery.directory : QueryParams.gallery.search.query;
      for (const parts of [[value], value.split('/')]) {
        const segments = [route, ...parts].map(part => new UrlSegment(part, {}));
        const match = galleryMatcherFunction(segments);
        expect(match.consumed).toEqual(segments);
        expect(match.posParams[parameter].path).toBe(value);
      }
    });
});
