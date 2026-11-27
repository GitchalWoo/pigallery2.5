import {type ActivatedRoute, type Router} from '@angular/router';
import {of} from 'rxjs';
import {QueryParams} from '../../../../../common/QueryParams';
import {PhotoFrameBuilderGalleryComponent} from './photo-frame-builder.gallery.component';

describe('PhotoFrameBuilderGalleryComponent', () => {
  it.each([true, false])('includes the explicit loop setting %s in photo-frame links', loop => {
    const route = {queryParams: of({})} as ActivatedRoute;
    const router = {url: '/gallery/Family?ls=' + String(!loop)} as Router;
    const component = new PhotoFrameBuilderGalleryComponent(null, null, route, router, null, null);
    component.loopSlideshow = loop;

    component.onOptionsChange();

    const url = new URL(component.url);
    expect(url.searchParams.get(QueryParams.gallery.lightbox.loopSlideshow)).toBe(String(loop));
    expect(url.searchParams.get(QueryParams.gallery.lightbox.playback)).toBe('true');
    expect(router.url).toContain('ls=' + String(!loop));
  });
});
