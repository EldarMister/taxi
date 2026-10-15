import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('site_labels', Path(__file__).resolve().parents[1] / 'scripts/build-site-labels.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SiteLabelsTest(unittest.TestCase):
    def test_names_and_area_interiors_survive_the_snapshot(self):
        # A concave territory must use an interior point, not its bounding box.
        xml = '<osm version="0.6">' + ''.join(
            f'<node id="{i}" lat="{lat}" lon="{lon}" version="1"/>'
            for i, (lon, lat) in enumerate([(72, 41), (72.02, 41), (72.02, 41.005), (72.005, 41.005), (72.005, 41.02), (72, 41.02)], 1)
        ) + '<way id="20" version="1">' + ''.join(f'<nd ref="{i}"/>' for i in [1, 2, 3, 4, 5, 6, 1]) + (
            '<tag k="landuse" v="retail"/><tag k="name:ru" v="Рынок"/><tag k="name:ky" v="Базар"/></way>'
            '<node id="30" lat="41.1" lon="72.1" version="1"><tag k="amenity" v="kindergarten"/><tag k="name" v="Үмүт"/></node></osm>'
        )
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'sites.osm'
            source.write_text(xml, encoding='utf-8')
            result = module.build(source)
            self.assertEqual(len(result['features']), 2)
            market = next(f for f in result['features'] if f['id'] == 'way/20')
            self.assertEqual(market['properties']['name:ru'], 'Рынок')
            self.assertEqual(market['properties']['name:ky'], 'Базар')
            lon, lat = market['geometry']['coordinates']
            self.assertTrue(72 < lon < 72.005 or 41 < lat < 41.005)
            self.assertEqual(module.build(source, [source]), result, 'overlay replaces the same OSM objects without duplicating labels')

    def test_unnamed_territories_do_not_get_invented_names(self):
        self.assertIsNone(module.site_properties({'landuse': 'retail'}))
        self.assertIsNone(module.site_properties({'amenity': 'school', 'name': 'School'}))
        self.assertEqual(module.site_properties({'amenity': 'marketplace', 'name': 'Market'})['kind'], 'marketplace')


if __name__ == '__main__':
    unittest.main()
