import * as L from 'leaflet';
import {DivIcon, Marker, setOptions, type MarkerClusterGroup, type MarkerClusterGroupOptions} from 'leaflet';
import 'leaflet.markercluster';

if (typeof window !== 'undefined') {
  (window as any).L = (window as any).L || L;
}
if (typeof globalThis !== 'undefined') {
  (globalThis as any).L = (globalThis as any).L || (typeof window !== 'undefined' ? (window as any).L : L);
}

export interface SvgIconOptions {
  color?: string;
  svgItems?: string;
  viewBox?: string;
  small?: boolean;
}

const SvgIcon: { new(options?: SvgIconOptions): DivIcon } = DivIcon.extend({
  initialize: function(options: SvgIconOptions = {}) {
    options.color = options.color || 'var(--bs-primary)';
    options.svgItems = options.svgItems || '<path d="M256 512c141.4 0 256-114.6 256-256S397.4 0 256 0S0 114.6 0 256S114.6 512 256 512z"/>';
    options.viewBox = options.viewBox || '0 0 512 512';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"  fill="' + options.color + '" viewBox="' + options.viewBox + '">' + options.svgItems + '</svg>';
    setOptions(this, {
      iconSize: options.small ? [15, 15] : [30, 30],
      iconAnchor: options.small ? [15, 28] : [15, 35],
      popupAnchor: options.small ? [0, -15] : [0, -30],
      className: 'custom-div-icon' + (options.small ? ' marker-svg-small' : ''),
      html: '<div class="marker-svg-wrapper"><div class="marker-svg-shadow"></div>' +
          '<div  class="marker-svg-pin" style="border-color: ' + options.color + '">' +
          '</div>' + svg + '</div>',
    });
  }
});

export class MarkerFactory {
  public static readonly defIcon = MarkerFactory.getSvgIcon();
  public static readonly defIconSmall = MarkerFactory.getSvgIcon({small: true});


  static getSvgIcon(options?: SvgIconOptions) {
    return new SvgIcon(options);
  }

  static createMarkerClusterGroup(options?: MarkerClusterGroupOptions): MarkerClusterGroup {
    const leafletAny = (typeof window !== 'undefined' && (window as any).L)
      ? (window as any).L
      : (typeof globalThis !== 'undefined' && (globalThis as any).L)
        ? (globalThis as any).L
        : (L as any);
    if (typeof leafletAny?.markerClusterGroup === 'function') {
      return leafletAny.markerClusterGroup(options);
    }
    if (typeof leafletAny?.MarkerClusterGroup === 'function') {
      return new leafletAny.MarkerClusterGroup(options);
    }
    throw new Error('leaflet.markercluster is not available: markerClusterGroup is undefined on L');
  }

}

Marker.prototype.options.icon = MarkerFactory.defIcon;
