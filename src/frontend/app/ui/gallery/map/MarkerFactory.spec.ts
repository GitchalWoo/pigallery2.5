import {describe, expect, it} from 'vitest';
import {MarkerFactory} from './MarkerFactory';

describe('MarkerFactory', () => {
  it('should create default and small SVG icons', () => {
    const icon = MarkerFactory.getSvgIcon();
    expect(icon).toBeDefined();
    expect(icon.options.className).toContain('custom-div-icon');

    const smallIcon = MarkerFactory.getSvgIcon({small: true});
    expect(smallIcon).toBeDefined();
    expect(smallIcon.options.className).toContain('marker-svg-small');
  });

  it('should create a MarkerClusterGroup without throwing TypeError', () => {
    const clusterGroup = MarkerFactory.createMarkerClusterGroup({maxClusterRadius: 20});
    expect(clusterGroup).toBeDefined();
    expect(typeof clusterGroup.addLayer).toBe('function');
    expect(typeof clusterGroup.clearLayers).toBe('function');
  });
});

