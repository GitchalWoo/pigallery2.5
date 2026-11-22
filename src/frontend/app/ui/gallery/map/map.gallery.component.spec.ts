import {ComponentFixture, TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {BehaviorSubject} from 'rxjs';
import {GalleryMapComponent} from './map.gallery.component';
import {MapService} from './map.service';
import {QueryService} from '../../../model/query.service';
import {ThemeService} from '../../../model/theme.service';
import {NetworkService} from '../../../model/network/network.service';
import {type PhotoDTO} from '../../../../../common/entities/PhotoDTO';
import {type FileDTO} from '../../../../../common/entities/FileDTO';

class MockMapService {
  get MapLayer() {
    return {url: 'https://example.com/{z}/{x}/{y}.png'};
  }
  get DarkMapLayer() {
    return {url: 'https://example.com/dark/{z}/{x}/{y}.png'};
  }
  get ShortAttributions() {
    return '';
  }
}

class MockQueryService {
  getParams() {
    return {};
  }
}

class MockThemeService {
  darkMode = new BehaviorSubject(false);
}

const makePhoto = (name: string, gps?: {latitude?: number; longitude?: number}): PhotoDTO => ({
  name,
  directory: {name: '.', path: '.'},
  metadata: {
    size: {width: 100, height: 100},
    creationDate: 0,
    fileSize: 100,
    ...(gps ? {positionData: {GPSData: gps}} : {}),
  },
} as unknown as PhotoDTO);

describe('GalleryMapComponent - markers', () => {
  let component: GalleryMapComponent;
  let fixture: ComponentFixture<GalleryMapComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GalleryMapComponent],
      providers: [
        {provide: MapService, useClass: MockMapService},
        {provide: QueryService, useClass: MockQueryService},
        {provide: ThemeService, useClass: MockThemeService},
        provideRouter([]),
      ],
    })
      .overrideComponent(GalleryMapComponent, {set: {template: ''}})
      .compileComponents();

    fixture = TestBed.createComponent(GalleryMapComponent);
    component = fixture.componentInstance;
  });

  it('should create markers for photos on the equator (lat 0) and prime meridian (lng 0)', () => {
    component.photos = [
      makePhoto('Greenwich.jpg', {latitude: 51.4779, longitude: 0}),
      makePhoto('Equator.jpg', {latitude: 0, longitude: -78.4558}),
      makePhoto('NullIsland.jpg', {latitude: 0, longitude: 0}),
      makePhoto('NoGps.jpg'),
    ];
    component.ngOnChanges();

    expect(component.markerLayer.map(m => m.getLatLng())).toEqual([
      expect.objectContaining({lat: 51.4779, lng: 0}),
      expect.objectContaining({lat: 0, lng: -78.4558}),
      expect.objectContaining({lat: 0, lng: 0}),
    ]);
  });
});

describe('MapService - GPX stats', () => {
  const gpx = (body: string): Document =>
    new DOMParser().parseFromString(
      `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1">${body}</gpx>`,
      'application/xml'
    );
  const trkpt = (lat: number, lon: number, time?: string): string =>
    `<trkpt lat="${lat}" lon="${lon}">${time ? `<time>${time}</time>` : ''}</trkpt>`;
  const gpxFile: FileDTO = {
    id: 1,
    name: 'track.gpx',
    directory: {path: '.', name: 'trips'},
  };

  it('should compute duration and average speed for a short (10-minute) track (#1254)', async () => {
    const getXML = vi.fn().mockResolvedValue(gpx(
      '<trk><trkseg>' +
      trkpt(48.0, 20.0, '2015-06-12T14:00:00Z') +
      trkpt(48.01, 20.0, '2015-06-12T14:10:00Z') +
      '</trkseg></trk>'
    ));
    const service = new MapService({getXML} as unknown as NetworkService);

    const res = await service.getMapCoordinates(gpxFile);
    expect(res.stats).toBeDefined();
    expect(res.stats.duration).toBe(600);
    expect(res.stats.distance).toBeGreaterThan(1000);
    expect(res.stats.averageSpeed).toBeGreaterThan(0);
  });

  it('should drop sub-second and invalid (NaN) durations', async () => {
    const getXML = vi.fn().mockResolvedValue(gpx(
      '<trk><trkseg>' +
      trkpt(48.0, 20.0, 'not-a-date') +
      trkpt(48.01, 20.0, '2015-06-12T14:10:00Z') +
      '</trkseg></trk>'
    ));
    const service = new MapService({getXML} as unknown as NetworkService);

    const res = await service.getMapCoordinates(gpxFile);
    expect(res.stats.duration).toBe(0);
    expect(res.stats.averageSpeed).toBe(0);
  });
});
