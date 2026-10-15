"""Build named kindergarten/market labels omitted by external vector tiles.

Install osmium and shapely, then run with a Geofabrik Kyrgyzstan PBF. Optional
--overlay OSM XML files replace the same objects with newer verified OSM data.
No names or coordinates are invented. Points on area interiors avoid placing
labels outside concave market grounds. Refresh this snapshot with map updates.
"""
import argparse
import json
from pathlib import Path

import osmium
from shapely import from_wkb


def site_properties(tags):
    kind = tags.get('amenity')
    if kind not in ('kindergarten', 'marketplace'):
        if tags.get('landuse') != 'retail':
            return None
        kind = 'marketplace'
    names = {key: tags[key] for key in ('name', 'name:ru', 'name:ky', 'name:en') if tags.get(key)}
    return {'kind': kind, **names} if names else None


class SiteLabels(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.features = {}
        self.factory = osmium.geom.WKBFactory()

    def add(self, key, properties, longitude, latitude):
        self.features[key] = {
            'type': 'Feature', 'id': key, 'properties': properties,
            'geometry': {'type': 'Point', 'coordinates': [round(longitude, 6), round(latitude, 6)]},
        }

    def node(self, node):
        key = f'node/{node.id}'
        self.features.pop(key, None)
        properties = site_properties(node.tags)
        if properties and node.location.valid():
            self.add(key, properties, node.location.lon, node.location.lat)

    def way(self, way):
        self.features.pop(f'way/{way.id}', None)

    def relation(self, relation):
        self.features.pop(f'relation/{relation.id}', None)

    def area(self, area):
        properties = site_properties(area.tags)
        if not properties:
            return
        point = from_wkb(self.factory.create_multipolygon(area)).representative_point()
        key = f'{"way" if area.from_way() else "relation"}/{area.orig_id()}'
        self.add(key, properties, point.x, point.y)


def build(source, overlays=()):
    handler = SiteLabels()
    for path in (source, *overlays):
        handler.apply_file(str(path), locations=True, idx='flex_mem', filters=[osmium.filter.KeyFilter('amenity', 'landuse')] if path == source else [])
    return {'type': 'FeatureCollection', 'features': [handler.features[key] for key in sorted(handler.features)]}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--overlay', action='append', type=Path, default=[])
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'src/native/site-labels.json')
    args = parser.parse_args()
    result = build(args.source, args.overlay)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'{len(result["features"])} named sites -> {args.output}')
