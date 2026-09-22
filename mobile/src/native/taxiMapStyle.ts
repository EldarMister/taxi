import bright from './openfreemap-bright.json';
import type { Language } from '../types';

type StyleLayer = { id: string; type: string; source?: string; 'source-layer'?: string; minzoom?: number; maxzoom?: number; filter?: unknown; paint?: Record<string, unknown>; layout?: Record<string, unknown> };

const surface = '#F4F7FB';
const road = '#FFFFFF';
const roadEdge = '#D7E0EA';
const majorRoad = '#FFF1CE';
const majorEdge = '#E9D6AC';
const localName = ['coalesce', ['get', 'name:ru'], ['get', 'name:ky'], ['get', 'name:nonlatin'], ['get', 'name'], ['get', 'name_en']];
const currentOsmName = ['coalesce', ['get', 'name_ru'], ['get', 'name'], ['get', 'name_ky'], ['get', 'name_en']];
const currentOsmLabels = process.env.EXPO_PUBLIC_OSM_LABELS_TILEJSON_URL?.trim() || 'https://vector.openstreetmap.org/shortbread_v1/tilejson.json';
const detailedOsmZoom = 14;

// Bright provides the full vector layer hierarchy (including street names and
// POIs). Change the actual land, road, building and label layers here instead
// of placing a colored film over raster OpenStreetMap tiles.
function themedLayer(layer: StyleLayer): StyleLayer {
  const paint = { ...layer.paint };
  const layout = { ...layer.layout };
  const id = layer.id;

  if (id === 'background') paint['background-color'] = surface;
  if (id === 'landuse-residential' || id === 'landuse-suburb') paint['fill-color'] = '#F0F4F8';
  if (id === 'landuse-commercial') paint['fill-color'] = '#F2F3F8';
  if (id === 'landuse-industrial' || id === 'landuse-railway') paint['fill-color'] = '#EEF1F5';
  if (id === 'landuse-hospital') paint['fill-color'] = '#F9ECEF';
  if (id === 'landuse-school') paint['fill-color'] = '#EEEFFC';
  if (id === 'landuse-cemetery') paint['fill-color'] = '#E6F0E8';
  if (id === 'park' || id === 'landcover-grass' || id === 'landcover-grass-park') paint['fill-color'] = '#DDEFE2';
  if (id === 'landcover-wood') { paint['fill-color'] = '#CDE6D5'; paint['fill-outline-color'] = '#BFDBCA'; }
  if (id === 'water' || id === 'water-intermittent') paint['fill-color'] = '#BBDCF4';
  if (id.startsWith('waterway-') || id === 'waterway_tunnel') paint['line-color'] = '#A9D1EF';
  if (id === 'building') paint['fill-color'] = ['interpolate', ['linear'], ['zoom'], 15.5, '#EBEFF4', 16, '#DFE6EE'];
  if (id === 'building-top') { paint['fill-color'] = '#E5ECF3'; paint['fill-outline-color'] = '#D0DAE5'; }
  if (id === 'road_area_pier' || id === 'highway-area') { paint['fill-color'] = road; paint['fill-outline-color'] = roadEdge; }
  if (id === 'road_pier') paint['line-color'] = road;

  if (/^(tunnel|highway|bridge)-/.test(id) && layer.type === 'line') {
    if (id.includes('casing')) paint['line-color'] = /motorway|trunk|primary|secondary|tertiary|link/.test(id) ? majorEdge : roadEdge;
    else if (/motorway|trunk|primary|secondary|tertiary|link/.test(id)) paint['line-color'] = majorRoad;
    else if (/minor|service-track/.test(id)) paint['line-color'] = road;
    else if (id.endsWith('-path')) paint['line-color'] = '#C9D2DC';
  }

  if (id.startsWith('highway-name-') || id.startsWith('label_') || id.startsWith('poi_') || id.startsWith('water_name_') || id === 'waterway_line_label' || id === 'airport') layout['text-field'] = localName;
  // The stock Bright style hides most smaller businesses until very close zooms.
  if (id === 'poi_r1') layer = { ...layer, minzoom: 14.25 };
  if (id === 'poi_r7') layer = { ...layer, minzoom: 15 };
  if (id === 'poi_r20') layer = { ...layer, minzoom: 16 };
  if (id.startsWith('highway-name-')) { paint['text-color'] = '#53667D'; paint['text-halo-color'] = '#FFFFFF'; }
  if (id.startsWith('label_')) { paint['text-color'] = '#253D58'; paint['text-halo-color'] = '#FFFFFF'; }
  if (id.startsWith('poi_')) { paint['text-color'] = '#60758B'; paint['text-halo-color'] = '#FFFFFF'; }
  if (id.startsWith('water_name_') || id === 'waterway_line_label') { paint['text-color'] = '#4889B8'; paint['text-halo-color'] = '#EAF6FF'; }

  return { ...layer, paint, layout };
}

// OpenMapTiles and Shortbread are different snapshots of the same OSM objects.
// Drawing both at street level produces offset double roads, buildings and
// labels. Keep Bright for the overview and use Shortbread's more detailed
// geometry at zoom 14+, where its source has full street/building coverage.
function withoutDuplicateBaseFeatures(layer: StyleLayer): StyleLayer[] {
  if (layer.source !== 'openmaptiles') return [layer];
  if (layer.id === 'label_other') {
    // Shortbread replaces only these local place names, not hamlets or islands.
    return [{ ...layer, filter: ['all', layer.filter, ['!', ['match', ['get', 'class'], ['suburb', 'quarter', 'neighbourhood', 'locality'], true, false]]] }];
  }
  const id = layer.id;
  const roadGeometry = layer.type === 'line' && (/^(tunnel|highway|bridge)-/.test(id) || id.startsWith('railway-') || id === 'railway');
  const replacedAtDetail = roadGeometry || id === 'highway-area'
    || (layer.type === 'line' && id.startsWith('waterway'))
    || layer['source-layer'] === 'building' || layer['source-layer'] === 'water'
    || id.startsWith('landuse-') || ['park', 'landcover-wood', 'landcover-grass', 'landcover-grass-park'].includes(id)
    || id.startsWith('poi_r') || id === 'poi_transit' || id === 'park-name-local'
    || id.startsWith('water_name_') || id === 'waterway_line_label' || id === 'building-housenumber-local';
  if (!replacedAtDetail) return [layer];
  const transitionZoom = id === 'building-housenumber-local' ? 15 : detailedOsmZoom;
  if ((layer.minzoom ?? 0) >= transitionZoom) return [];
  return [{ ...layer, maxzoom: Math.min(layer.maxzoom ?? transitionZoom, transitionZoom) }];
}

const base = bright as unknown as { version: number; layers: StyleLayer[]; sources: Record<string, unknown> };
// Bright omits the OpenMapTiles housenumber layer entirely, despite the tile
// source containing building address numbers. Parks also have names in tiles.
const extraLabelLayers: StyleLayer[] = [
  {
    id: 'park-name-local', type: 'symbol', source: 'openmaptiles', 'source-layer': 'park', minzoom: 13,
    layout: { 'text-field': localName, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 13, 11, 17, 13], 'text-max-width': 8, 'text-padding': 3 },
    paint: { 'text-color': '#4C7C62', 'text-halo-color': '#F5FBF6', 'text-halo-width': 1.4 },
  },
  {
    id: 'building-housenumber-local', type: 'symbol', source: 'openmaptiles', 'source-layer': 'housenumber', minzoom: 14,
    layout: { 'text-field': ['get', 'housenumber'], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 12], 'text-padding': 1, 'text-max-width': 5 },
    paint: { 'text-color': '#40536C', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.6 },
  },
];

// The current OSM tiles contain far more than addresses. Draw their land and
// site polygons below buildings and roads so newer parks, schools and other
// mapped places retain the same palette as the bundled Bright style.
const currentOsmAreaLayers: StyleLayer[] = [
  {
    id: 'current-osm-urban-areas', type: 'fill', source: 'osm_current_labels', 'source-layer': 'land', minzoom: detailedOsmZoom,
    filter: ['match', ['get', 'kind'], ['residential', 'commercial', 'retail', 'industrial', 'railway', 'garages', 'landfill', 'brownfield', 'greenfield'], true, false],
    paint: { 'fill-color': ['match', ['get', 'kind'], 'residential', '#F0F4F8', ['commercial', 'retail'], '#F2F3F8', ['landfill', 'brownfield'], '#E8E4DF', 'greenfield', '#E9EFE6', '#EEF1F5'] },
  },
  {
    id: 'current-osm-agricultural-areas', type: 'fill', source: 'osm_current_labels', 'source-layer': 'land', minzoom: detailedOsmZoom,
    filter: ['match', ['get', 'kind'], ['farmyard', 'farmland', 'orchard', 'vineyard', 'allotments', 'greenhouse_horticulture', 'plant_nursery'], true, false],
    paint: {
      'fill-color': ['match', ['get', 'kind'], ['orchard', 'vineyard', 'plant_nursery'], '#E2EDCF', ['allotments', 'greenhouse_horticulture'], '#E7F0D8', 'farmyard', '#EEE8DB', '#EEF2DF'],
      'fill-outline-color': '#D7E1C7',
    },
  },
  {
    id: 'current-osm-green-areas', type: 'fill', source: 'osm_current_labels', 'source-layer': 'land', minzoom: detailedOsmZoom,
    filter: ['match', ['get', 'kind'], ['forest', 'wood', 'park', 'garden', 'village_green', 'recreation_ground', 'playground', 'grass', 'grassland', 'meadow', 'cemetery', 'grave_yard', 'golf_course', 'miniature_golf', 'heath', 'scrub'], true, false],
    paint: {
      'fill-color': ['match', ['get', 'kind'], ['forest', 'wood'], '#CDE6D5', ['heath', 'scrub'], '#D7E7D3', 'playground', '#F8ECCC', ['cemetery', 'grave_yard'], '#E6F0E8', ['golf_course', 'miniature_golf'], '#D5EACF', '#DDEFE2'],
      'fill-outline-color': ['match', ['get', 'kind'], 'playground', '#DBC993', 'rgba(0, 0, 0, 0)'],
    },
  },
  {
    id: 'current-osm-natural-ground', type: 'fill', source: 'osm_current_labels', 'source-layer': 'land', minzoom: detailedOsmZoom,
    filter: ['match', ['get', 'kind'], ['quarry', 'sand', 'beach', 'bare_rock', 'scree', 'shingle'], true, false],
    paint: {
      'fill-color': ['match', ['get', 'kind'], ['sand', 'beach'], '#F5EDC9', ['bare_rock', 'scree', 'shingle'], '#E5E2DD', '#E6E3DE'],
      'fill-outline-color': ['match', ['get', 'kind'], 'quarry', '#CBC5BD', 'rgba(0, 0, 0, 0)'],
    },
  },
  {
    id: 'current-osm-wetlands', type: 'fill', source: 'osm_current_labels', 'source-layer': 'land', minzoom: detailedOsmZoom,
    filter: ['match', ['get', 'kind'], ['swamp', 'bog', 'string_bog', 'wet_meadow', 'marsh'], true, false],
    paint: { 'fill-color': '#D9EBE4', 'fill-outline-color': '#BFD9D0' },
  },
  {
    id: 'current-osm-sites', type: 'fill', source: 'osm_current_labels', 'source-layer': 'sites', minzoom: 14,
    filter: ['match', ['get', 'kind'], ['sports_center', 'sports_centre', 'university', 'college', 'school', 'hospital', 'parking', 'bicycle_parking', 'construction', 'prison', 'danger_area'], true, false],
    paint: {
      'fill-color': ['match', ['get', 'kind'], ['university', 'college', 'school'], '#E8EBFA', 'hospital', '#F9E9EE', ['sports_center', 'sports_centre'], '#DCEFE3', ['parking', 'bicycle_parking'], '#DCE8F4', 'construction', '#EFE9E2', ['prison', 'danger_area'], '#F2E4E4', '#E9EEF5'],
      'fill-outline-color': ['match', ['get', 'kind'], ['university', 'college', 'school'], '#D4DAEF', 'hospital', '#EFD4DC', ['sports_center', 'sports_centre'], '#C8E1D1', ['parking', 'bicycle_parking'], '#B6CBDD', 'construction', '#D4C7B8', ['prison', 'danger_area'], '#DABEBE', '#D8E1EB'],
    },
  },
  {
    id: 'current-osm-water', type: 'fill', source: 'osm_current_labels', 'source-layer': 'water_polygons', minzoom: detailedOsmZoom,
    paint: { 'fill-color': ['match', ['get', 'kind'], 'glacier', '#EAF1F5', '#BBDCF4'] },
  },
  {
    id: 'current-osm-waterways', type: 'line', source: 'osm_current_labels', 'source-layer': 'water_lines', minzoom: detailedOsmZoom,
    paint: { 'line-color': '#A9D1EF', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.7, 16, 1.5] },
  },
];

// The OpenMapTiles source contains these site polygons, but Bright has no
// layers for them. Without explicit fills a mapped stadium or playing field
// looks like an empty patch even while its point label is visible.
const detailedSiteLayers: StyleLayer[] = [
  { id: 'site-stadium', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse', minzoom: 13,
    filter: ['==', ['get', 'class'], 'stadium'],
    paint: { 'fill-color': '#B4DCC3', 'fill-outline-color': '#68AD85' } },
  { id: 'site-pitch', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse', minzoom: 14,
    filter: ['==', ['get', 'class'], 'pitch'],
    paint: { 'fill-color': '#BFE2C9', 'fill-outline-color': '#78B992' } },
  { id: 'site-track', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse', minzoom: 14,
    filter: ['==', ['get', 'class'], 'track'],
    paint: { 'fill-color': '#F3DFC9', 'fill-outline-color': '#D9B78F' } },
  { id: 'site-attractions', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse', minzoom: 13,
    filter: ['match', ['get', 'class'], ['theme_park', 'zoo'], true, false],
    paint: { 'fill-color': '#E5F0DE', 'fill-outline-color': '#BBD6AE' } },
];

// OpenMapTiles generalises small streets and buildings at its maximum zoom.
// Shortbread keeps the mapped footways, driveways and building polygons in its
// zoom-14 tile, which MapLibre continues to show when the user zooms further.
const currentOsmBuildingLayers: StyleLayer[] = [
  { id: 'current-osm-buildings', type: 'fill', source: 'osm_current_labels', 'source-layer': 'buildings', minzoom: 14,
    paint: { 'fill-color': ['interpolate', ['linear'], ['zoom'], 14, '#E9EFF5', 16, '#DFE6EE'], 'fill-outline-color': '#D0DAE5' } },
];
const currentOsmRoadPolygonLayers: StyleLayer[] = [
  { id: 'current-osm-road-areas', type: 'fill', source: 'osm_current_labels', 'source-layer': 'street_polygons', minzoom: 14,
    filter: ['match', ['get', 'kind'], ['pedestrian', 'service'], true, false],
    paint: { 'fill-color': '#F7F9FC', 'fill-outline-color': '#D7E0EA' } },
];
const currentOsmRoadSource = { source: 'osm_current_labels', 'source-layer': 'streets', minzoom: detailedOsmZoom };
const currentOsmRoadLayers: StyleLayer[] = [
  { id: 'current-osm-road-footways', type: 'line', ...currentOsmRoadSource,
    filter: ['match', ['get', 'kind'], ['footway', 'path', 'cycleway', 'steps'], true, false],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#B8C6D4', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.8, 16, 1.7, 19, 3], 'line-dasharray': [2, 1.5] } },
  { id: 'current-osm-road-tracks', type: 'line', ...currentOsmRoadSource,
    filter: ['==', ['get', 'kind'], 'track'], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#B9A887', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 16, 2, 19, 3.5], 'line-dasharray': [2, 1.2] } },
  { id: 'current-osm-road-service-casing', type: 'line', ...currentOsmRoadSource,
    filter: ['match', ['get', 'kind'], ['service', 'pedestrian'], true, false], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#D7E0EA', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.8, 16, 4, 19, 7] } },
  { id: 'current-osm-road-minor-casing', type: 'line', ...currentOsmRoadSource,
    filter: ['match', ['get', 'kind'], ['unclassified', 'residential', 'living_street', 'busway', 'bus_guideway', 'road'], true, false], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#D7E0EA', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2.4, 16, 7, 19, 12] } },
  { id: 'current-osm-road-major-casing', type: 'line', ...currentOsmRoadSource,
    filter: ['match', ['get', 'kind'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'], true, false], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#E9D6AC', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 3.5, 16, 10, 19, 18] } },
  { id: 'current-osm-road-service', type: 'line', ...currentOsmRoadSource,
    filter: ['match', ['get', 'kind'], ['service', 'pedestrian'], true, false], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#FFFFFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.1, 16, 2.8, 19, 5] } },
  { id: 'current-osm-road-minor', type: 'line', ...currentOsmRoadSource,
    filter: ['match', ['get', 'kind'], ['unclassified', 'residential', 'living_street', 'busway', 'bus_guideway', 'road'], true, false], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#FFFFFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.7, 16, 5.4, 19, 9.5] } },
  { id: 'current-osm-road-major', type: 'line', ...currentOsmRoadSource,
    filter: ['match', ['get', 'kind'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'], true, false], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#FFF1CE', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2.7, 16, 8, 19, 15] } },
  { id: 'current-osm-road-rail', type: 'line', ...currentOsmRoadSource,
    filter: ['match', ['get', 'kind'], ['rail', 'narrow_gauge', 'tram', 'light_rail', 'subway', 'funicular', 'monorail'], true, false],
    paint: { 'line-color': '#82909E', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 17, 2.2], 'line-dasharray': [3, 1.4] } },
];

const currentPoiIcon = ['case',
  ['has', 'shop'], 'shop',
  ['has', 'amenity'], ['match', ['get', 'amenity'],
    ['bank', 'atm'], 'bank', ['hospital', 'clinic'], 'hospital', ['doctors', 'dentist'], 'dentist',
    ['school', 'kindergarten'], 'school', ['university', 'college'], 'college',
    ['cafe', 'restaurant'], 'cafe', 'fast_food', 'fast_food', 'fuel', 'fuel',
    'pharmacy', 'pharmacy', 'police', 'police', 'parking', 'parking',
    'place_of_worship', 'place_of_worship', 'community_centre', 'building',
    'post_office', 'post', 'library', 'library', 'cinema', 'cinema', 'circle'],
  ['has', 'leisure'], ['match', ['get', 'leisure'], ['stadium', 'pitch'], 'pitch', 'playground', 'playground', 'park'],
  'circle',
];
const currentStreetNameLayers: StyleLayer[] = [
  // Route references are useful in the overview, but disappear at street
  // zoom so a road that is both a highway and a city street keeps its name.
  { id: 'current-osm-road-ref', type: 'symbol', source: 'osm_current_labels', 'source-layer': 'street_labels', minzoom: 10, maxzoom: 15.5,
    filter: ['all', ['has', 'ref'], ['<=', ['get', 'ref_cols'], 6]],
    layout: { 'symbol-placement': 'line', 'symbol-spacing': 420, 'icon-image': ['concat', 'road_', ['to-string', ['get', 'ref_cols']]], 'icon-rotation-alignment': 'viewport', 'text-field': ['get', 'ref'], 'text-font': ['Noto Sans Regular'], 'text-size': 10, 'text-rotation-alignment': 'viewport' },
    paint: { 'text-color': '#46586F' } },
  { id: 'current-osm-street-major', type: 'symbol', source: 'osm_current_labels', 'source-layer': 'street_labels', minzoom: 11.5, maxzoom: 15.5,
    filter: ['all', ['any', ['has', 'name'], ['has', 'name_ru'], ['has', 'name_ky']], ['match', ['get', 'kind'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'], true, false]],
    layout: { 'symbol-placement': 'line', 'text-field': currentOsmName, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 16, 13], 'text-padding': 4, 'symbol-spacing': 300 },
    paint: { 'text-color': '#42536A', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.6 } },
  { id: 'current-osm-street-major-detail', type: 'symbol', source: 'osm_current_labels', 'source-layer': 'street_labels', minzoom: 15.5,
    filter: ['all', ['any', ['has', 'name'], ['has', 'name_ru'], ['has', 'name_ky']], ['match', ['get', 'kind'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'], true, false]],
    layout: { 'symbol-placement': 'line', 'text-field': currentOsmName, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 15.5, 13, 18, 14.5], 'text-padding': 2, 'symbol-spacing': 430, 'text-allow-overlap': true },
    paint: { 'text-color': '#354A64', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.8 } },
  { id: 'current-osm-street-local', type: 'symbol', source: 'osm_current_labels', 'source-layer': 'street_labels', minzoom: 14,
    filter: ['all', ['any', ['has', 'name'], ['has', 'name_ru'], ['has', 'name_ky']], ['!', ['match', ['get', 'kind'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'], true, false]]],
    layout: { 'symbol-placement': 'line', 'text-field': currentOsmName, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 12], 'text-padding': 3, 'symbol-spacing': 250 },
    paint: { 'text-color': '#556780', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 } },
  { id: 'current-osm-street-area-names', type: 'symbol', source: 'osm_current_labels', 'source-layer': 'streets_polygons_labels', minzoom: 15,
    filter: ['any', ['has', 'name'], ['has', 'name_ru'], ['has', 'name_ky']],
    layout: { 'text-field': currentOsmName, 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-padding': 3, 'text-max-width': 8 },
    paint: { 'text-color': '#556780', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 } },
];
export const taxiMapStyle = {
  ...bright,
  name: 'Atlas · City',
  sources: {
    ...bright.sources,
    osm_current_labels: { type: 'vector', url: currentOsmLabels, attribution: '© OpenStreetMap contributors' },
    openmaptiles: {
      ...bright.sources.openmaptiles,
      attribution: '© OpenMapTiles Bright · © OpenStreetMap contributors',
    },
  },
  layers: ([
    ...base.layers.flatMap(layer => {
      if (layer.id === 'waterway_tunnel') return [...currentOsmAreaLayers, ...detailedSiteLayers, themedLayer(layer)];
      if (layer.id === 'building-top') return [themedLayer(layer), ...currentOsmBuildingLayers];
      if (layer.id === 'highway-area') return [themedLayer(layer), ...currentOsmRoadPolygonLayers];
      if (layer.id === 'bridge-railway-hatching') return [themedLayer(layer), ...currentOsmRoadLayers];
      if (layer.id === 'poi_r20') return [...extraLabelLayers, themedLayer(layer)];
      if (layer.id === 'highway-name-path') return currentStreetNameLayers;
      if (layer.id.startsWith('highway-name-') || layer.id.startsWith('highway-shield-') || layer.id === 'road_shield_us') return [];
      return [themedLayer(layer)];
    }),
    // Keep the themed vector cartography while filling address gaps in the
    // weekly OpenMapTiles planet from OSM's more current Shortbread tiles.
    { id: 'current-osm-addresses', type: 'symbol', source: 'osm_current_labels', 'source-layer': 'addresses', minzoom: 15,
      layout: { 'text-field': ['get', 'housenumber'], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 17, 11.5, 19, 13], 'text-padding': 2, 'text-max-width': 5 },
      paint: { 'text-color': '#435770', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.6 } },
    { id: 'current-osm-neighborhoods', type: 'symbol', source: 'osm_current_labels', 'source-layer': 'place_labels', minzoom: 13,
      filter: ['match', ['get', 'kind'], ['suburb', 'quarter', 'neighbourhood', 'locality'], true, false],
      layout: { 'text-field': currentOsmName, 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-max-width': 9, 'text-padding': 4 },
      paint: { 'text-color': '#667990', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.4 } },
    { id: 'current-osm-water-names', type: 'symbol', source: 'osm_current_labels', 'source-layer': 'water_polygons_labels', minzoom: 14,
      layout: { 'text-field': currentOsmName, 'text-font': ['Noto Sans Italic'], 'text-size': 11, 'text-padding': 3 },
      paint: { 'text-color': '#4889B8', 'text-halo-color': '#EAF6FF', 'text-halo-width': 1.3 } },
    { id: 'current-osm-waterway-names', type: 'symbol', source: 'osm_current_labels', 'source-layer': 'water_lines_labels', minzoom: detailedOsmZoom,
      layout: { 'symbol-placement': 'line', 'text-field': currentOsmName, 'text-font': ['Noto Sans Italic'], 'text-size': 11, 'text-padding': 3 },
      paint: { 'text-color': '#4889B8', 'text-halo-color': '#EAF6FF', 'text-halo-width': 1.3 } },
    { id: 'current-osm-transit', type: 'symbol', source: 'osm_current_labels', 'source-layer': 'public_transport', minzoom: detailedOsmZoom,
      filter: ['match', ['get', 'kind'], ['bus_stop', 'bus_station', 'station', 'halt', 'tram_stop', 'ferry_terminal'], true, false],
      layout: { 'icon-image': ['match', ['get', 'kind'], ['station', 'halt', 'tram_stop'], 'railway', 'ferry_terminal', 'ferry', 'bus'], 'icon-size': 0.7, 'icon-padding': 4,
        'text-field': currentOsmName, 'text-font': ['Noto Sans Regular'], 'text-size': 10.5, 'text-anchor': 'top', 'text-offset': [0, 0.8], 'text-optional': true },
      paint: { 'text-color': '#526A82', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.3 } },
    { id: 'current-osm-pois', type: 'symbol', source: 'osm_current_labels', 'source-layer': 'pois', minzoom: 14,
      filter: ['all',
        ['!', ['match', ['get', 'highway'], ['bus_stop', 'platform'], true, false]],
        ['!', ['match', ['get', 'amenity'], ['bus_station', 'ferry_terminal'], true, false]],
        ['any', ['has', 'name'], ['has', 'shop'], ['match', ['get', 'amenity'], ['bank', 'atm', 'hospital', 'clinic', 'school', 'pharmacy', 'fuel', 'police', 'parking'], true, false], ['match', ['get', 'leisure'], ['park', 'playground'], true, false]]],
      layout: { 'icon-image': currentPoiIcon, 'icon-size': 0.72, 'icon-padding': 3, 'icon-optional': true,
        'text-field': currentOsmName, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10.5, 18, 12],
        'text-max-width': 8, 'text-padding': 2, 'text-variable-anchor': ['top', 'right', 'left', 'bottom'], 'text-radial-offset': 0.9, 'text-justify': 'auto', 'text-optional': true },
      paint: { 'text-color': '#4D667E', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 } },
  ] as StyleLayer[]).flatMap(withoutDuplicateBaseFeatures),
};

const fallbackTile = process.env.EXPO_PUBLIC_OSM_TILE_URL?.trim() || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const rasterMapFallback = {
  version: 8,
  sources: { osm: { type: 'raster', tiles: [fallbackTile], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

// Recolour the bundled vector map itself so streets, buildings, parks and
// labels remain readable in dark mode. Both themes use the same tile sources.
function darkLayer(layer: StyleLayer): StyleLayer {
  const paint = { ...layer.paint };
  const id = layer.id;
  const isRoad = /^(tunnel|highway|bridge)-/.test(id) || id === 'road_pier' || id === 'highway-area' || id === 'road_area_pier';
  const isWater = id.includes('water');
  const isGreen = /park|grass|wood|forest|green|cemetery|garden/.test(id);
  const isBuilding = id.includes('building');
  const isRoadCasing = id.includes('casing');
  for (const key of Object.keys(paint)) {
    if (!key.endsWith('-color')) continue;
    if (key === 'background-color') paint[key] = '#101010';
    else if (key === 'text-color') paint[key] = isWater ? '#CCCCCC' : '#F0F0F0';
    else if (key === 'text-halo-color') paint[key] = '#101010';
    else if (key === 'line-color') paint[key] = isRoadCasing ? '#1E1E1E' : isRoad ? '#646464' : isWater ? '#383838' : '#484848';
    else if (key === 'fill-outline-color') paint[key] = isBuilding ? '#414141' : '#353535';
    else if (key === 'fill-color') paint[key] = isRoad ? '#585858' : isWater ? '#242424' : isGreen ? '#292929' : isBuilding ? '#353535' : '#1E1E1E';
  }
  if (layer.type === 'symbol' && layer.layout?.['text-field']) {
    paint['text-color'] = isWater ? '#CCCCCC' : '#F0F0F0';
    paint['text-halo-color'] = '#101010';
    paint['text-halo-width'] = paint['text-halo-width'] ?? 1.4;
  }
  if (id === 'current-osm-green-areas') {
    paint['fill-color'] = ['match', ['get', 'kind'], ['forest', 'wood'], '#1D3326', 'playground', '#3C3627', ['park', 'garden', 'grass', 'meadow', 'recreation_ground'], '#25412E', '#303A2A'];
    paint['fill-outline-color'] = ['match', ['get', 'kind'], 'playground', '#66583E', 'rgba(0, 0, 0, 0)'];
  }
  if (id === 'current-osm-agricultural-areas') { paint['fill-color'] = '#293326'; paint['fill-outline-color'] = '#3E4A38'; }
  if (id === 'current-osm-natural-ground') { paint['fill-color'] = '#36332E'; paint['fill-outline-color'] = '#4A4640'; }
  if (id === 'current-osm-wetlands') { paint['fill-color'] = '#233936'; paint['fill-outline-color'] = '#39534E'; }
  if (id === 'current-osm-sites') {
    paint['fill-color'] = ['match', ['get', 'kind'], ['parking', 'bicycle_parking'], '#2B3A49', ['university', 'college', 'school'], '#33354B', 'hospital', '#493039', ['sports_center', 'sports_centre'], '#294235', 'construction', '#3D3731', ['prison', 'danger_area'], '#452F32', '#30343B'];
    paint['fill-outline-color'] = ['match', ['get', 'kind'], ['parking', 'bicycle_parking'], '#50687D', ['university', 'college', 'school'], '#555B7B', 'hospital', '#73505B', ['sports_center', 'sports_centre'], '#4B715A', 'construction', '#625649', ['prison', 'danger_area'], '#6C4A4F', '#4A5360'];
  }
  if (id === 'site-stadium' || id === 'site-pitch' || id === 'site-attractions') { paint['fill-color'] = '#294235'; paint['fill-outline-color'] = '#4B715A'; }
  if (id === 'site-track') { paint['fill-color'] = '#49392B'; paint['fill-outline-color'] = '#765B43'; }
  if (id === 'current-osm-buildings') { paint['fill-color'] = '#353535'; paint['fill-outline-color'] = '#414141'; }
  if (id === 'current-osm-road-areas') { paint['fill-color'] = '#4A4A4A'; paint['fill-outline-color'] = '#262626'; }
  if (id.startsWith('current-osm-road-') && layer.type === 'line') {
    paint['line-color'] = id.endsWith('-casing') ? '#252525'
      : id.endsWith('-major') ? '#666666'
      : id.endsWith('-minor') ? '#575757'
      : id.endsWith('-service') ? '#4B4B4B'
      : id.endsWith('-tracks') ? '#80715E'
      : id.endsWith('-rail') ? '#999999' : '#777777';
  }
  return { ...layer, paint };
}

export const darkMapStyle = {
  ...taxiMapStyle,
  name: 'Atlas · Night',
  layers: (taxiMapStyle.layers as StyleLayer[]).map(darkLayer),
};

const kyrgyzOsmName = ['coalesce', ['get', 'name_ky'], ['get', 'name'], ['get', 'name_ru'], ['get', 'name_en']];
const kyrgyzOpenMapTilesName = ['coalesce', ['get', 'name:ky'], ['get', 'name'], ['get', 'name:ru'], ['get', 'name:nonlatin'], ['get', 'name_en']];
function withKyrgyzLabels(style: typeof taxiMapStyle) {
  return { ...style, layers: (style.layers as StyleLayer[]).map(layer => {
    const textField = layer.layout?.['text-field'];
    const replacement = textField === currentOsmName ? kyrgyzOsmName : textField === localName ? kyrgyzOpenMapTilesName : null;
    return replacement ? { ...layer, layout: { ...layer.layout, 'text-field': replacement } } : layer;
  }) };
}
const kyrgyzMapStyle = withKyrgyzLabels(taxiMapStyle);
const kyrgyzDarkMapStyle = withKyrgyzLabels(darkMapStyle);

// If vector tiles fail, keep the existing OSM raster fallback but desaturate
// and dim it. This needs no second tile provider or extra API key.
export const darkRasterMapFallback = {
  ...rasterMapFallback,
  layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: {
    'raster-saturation': -1,
    'raster-brightness-max': 0.42,
    'raster-contrast': 0.25,
  } }],
};

// A hosted style can replace the bundled palette without changing application
// code. The bundled vector style includes current OSM address labels.
export const primaryMapStyle = process.env.EXPO_PUBLIC_MAP_STYLE_URL?.trim() || taxiMapStyle;
export const primaryDarkMapStyle = process.env.EXPO_PUBLIC_DARK_MAP_STYLE_URL?.trim() || darkMapStyle;
export function mapStyleForLanguage(language: Language, dark: boolean) {
  if (dark) return language === 'ky' && typeof primaryDarkMapStyle !== 'string' ? kyrgyzDarkMapStyle : primaryDarkMapStyle;
  return language === 'ky' && typeof primaryMapStyle !== 'string' ? kyrgyzMapStyle : primaryMapStyle;
}
