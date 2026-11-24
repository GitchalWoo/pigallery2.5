import {ComponentFixture, TestBed} from '@angular/core/testing';
import {BehaviorSubject} from 'rxjs';
import {NgIconsModule} from '@ng-icons/core';
import {ionCalendarOutline, ionImageOutline, ionLocationOutline, ionVideocamOutline} from '@ng-icons/ionicons';
import {By} from '@angular/platform-browser';
import {LeafletDirective} from '@bluehalo/ngx-leaflet';

import {InfoPanelLightboxComponent} from './info-panel.lightbox.gallery.component';
import {QueryService} from '../../../../model/query.service';
import {MapService} from '../../map/map.service';
import {AuthenticationService} from '../../../../model/network/authentication.service';
import {ThemeService} from '../../../../model/theme.service';
import {ContentLoaderService} from '../../contentLoader.service';
import {MediaDTO} from '../../../../../../common/entities/MediaDTO';

class MockQueryService {
  getParams() {
    return {};
  }
}

class MockMapService {
  get MapLayer() {
    return {url: ''};
  }

  get DarkMapLayer() {
    return {url: ''};
  }

  get ShortAttributions() {
    return '';
  }
}

class MockAuthenticationService {
  canSearch() {
    return false;
  }
}

class MockThemeService {
  darkMode = new BehaviorSubject(false);
}

class MockContentLoaderService {
  isSearchResult() {
    return false;
  }
}

function makePhoto(overrides: any = {}): MediaDTO {
  return {
    name: 'IMG_7936.HEIC',
    directory: {name: 'vacation', path: '/photos'},
    metadata: {
      size: {width: 4032, height: 3024},
      creationDate: Date.now(),
      fileSize: 2048000,
    },
    ...overrides,
  } as MediaDTO;
}

describe('InfoPanelLightboxComponent - Live Photo', () => {
  let component: InfoPanelLightboxComponent;
  let fixture: ComponentFixture<InfoPanelLightboxComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        InfoPanelLightboxComponent,
        NgIconsModule.withIcons({
          ionImageOutline,
          ionVideocamOutline,
          ionCalendarOutline,
          ionLocationOutline,
        }),
      ],
      providers: [
        {provide: QueryService, useClass: MockQueryService},
        {provide: MapService, useClass: MockMapService},
        {provide: AuthenticationService, useClass: MockAuthenticationService},
        {provide: ThemeService, useClass: MockThemeService},
        {provide: ContentLoaderService, useClass: MockContentLoaderService},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InfoPanelLightboxComponent);
    component = fixture.componentInstance;
  });

  it('should show companion video row when media is a Live Photo', () => {
    component.media = makePhoto({
      liveVideoPath: 'vacation/IMG_7936_HEVC.MOV',
      liveVideoInfo: {
        name: 'IMG_7936_HEVC.MOV',
        size: {width: 1920, height: 1080},
        fileSize: 4500000,
        duration: 3000,
      },
    });
    component.ngOnChanges();
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('.row');
    const videoRow = Array.from(rows).find(
      (r: HTMLElement) => r.querySelector('ng-icon[name="ionVideocamOutline"]')
    ) as HTMLElement;
    expect(videoRow).toBeTruthy();
    expect(videoRow.textContent).toContain('IMG_7936_HEVC.MOV');
    expect(videoRow.textContent).toContain('1920');
    expect(videoRow.textContent).toContain('1080');
  });

  it('should not show companion video row for regular photos', () => {
    component.media = makePhoto();
    component.ngOnChanges();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    // Should not have a videocam icon in the file info area
    // (videocam may appear in other sections for regular videos)
    const fileInfoRows = el.querySelectorAll('.row[title="File information and properties"], .row[title="Companion video"]');
    let hasCompanionRow = false;
    fileInfoRows.forEach((row: HTMLElement) => {
      if (row.getAttribute('title') === 'Companion video') {
        hasCompanionRow = true;
      }
    });
    expect(hasCompanionRow).toBe(false);
  });

  it('isLivePhoto() should return true when liveVideoPath is set', () => {
    component.media = makePhoto({
      liveVideoPath: 'vacation/IMG_7936_HEVC.MOV',
    });
    expect(component.isLivePhoto()).toBe(true);
  });

  it('isLivePhoto() should return false for regular photos', () => {
    component.media = makePhoto();
    expect(component.isLivePhoto()).toBe(false);
  });

  it('should place a marker and recenter the map when switching photos', () => {
    component.media = makePhoto({
      metadata: {
        size: {width: 4032, height: 3024},
        creationDate: Date.now(),
        fileSize: 2048000,
        positionData: {GPSData: {latitude: 47.4979, longitude: 19.0402}},
      },
    });
    component.ngOnChanges();
    fixture.detectChanges();

    expect(component.mapCenter).toEqual(expect.objectContaining({lat: 47.4979, lng: 19.0402}));
    expect(component.markerLayer).toHaveLength(1);
    expect(component.markerLayer[0].getLatLng()).toEqual(expect.objectContaining({lat: 47.4979, lng: 19.0402}));

    const leafletDir = fixture.debugElement.query(By.directive(LeafletDirective))?.injector.get(LeafletDirective);
    expect(leafletDir).toBeTruthy();
    expect(leafletDir.center).toEqual(expect.objectContaining({lat: 47.4979, lng: 19.0402}));

    // Switch to a second photo (including 0 coordinate on prime meridian)
    component.media = makePhoto({
      name: 'Greenwich.jpg',
      metadata: {
        size: {width: 4032, height: 3024},
        creationDate: Date.now(),
        fileSize: 2048000,
        positionData: {GPSData: {latitude: 51.4779, longitude: 0}},
      },
    });
    component.ngOnChanges();
    fixture.detectChanges();

    expect(component.mapCenter).toEqual(expect.objectContaining({lat: 51.4779, lng: 0}));
    expect(component.markerLayer).toHaveLength(1);
    expect(component.markerLayer[0].getLatLng()).toEqual(expect.objectContaining({lat: 51.4779, lng: 0}));
    expect(leafletDir.center).toEqual(expect.objectContaining({lat: 51.4779, lng: 0}));

    // Switch to a photo without GPS
    component.media = makePhoto({name: 'NoGps.jpg'});
    component.ngOnChanges();
    fixture.detectChanges();

    expect(component.mapCenter).toBeNull();
    expect(component.markerLayer).toHaveLength(0);
    expect(fixture.nativeElement.querySelector('#map')).toBeNull();
  });
});
