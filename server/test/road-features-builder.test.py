"""Exercise the OSM extraction pipeline with real node/way/relation callbacks."""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

import osmium


sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("road_features_builder", Path(__file__).resolve().parents[1] / "scripts" / "build-road-features.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class RoadFeaturesBuilderTest(unittest.TestCase):
    def test_way_crossings_relation_devices_and_directional_limits(self):
        osm = '''<osm version="0.6">
          <node id="1" lat="42.87" lon="74.59"/>
          <node id="2" lat="42.88" lon="74.59"/>
          <node id="3" lat="42.875" lon="74.58995"/>
          <node id="4" lat="42.875" lon="74.59005"/>
          <node id="5" lat="42.876" lon="74.5902"/>
          <node id="6" lat="42.87" lon="74.59008"/>
          <node id="7" lat="42.88" lon="74.59008"/>
          <node id="8" lat="42.877" lon="74.59"><tag k="footway" v="crossing"/></node>
          <way id="10"><nd ref="1"/><nd ref="2"/>
            <tag k="highway" v="residential"/><tag k="maxspeed:forward" v="40"/>
            <tag k="maxspeed:backward" v="50"/><tag k="lanes" v="2"/></way>
          <way id="11"><nd ref="3"/><nd ref="4"/>
            <tag k="highway" v="footway"/><tag k="footway" v="crossing"/>
            <tag k="crossing" v="uncontrolled"/></way>
          <way id="12"><nd ref="6"/><nd ref="7"/><tag k="highway" v="service"/></way>
          <relation id="20"><member type="node" ref="5" role="device"/>
            <member type="node" ref="1" role="from"/><member type="node" ref="2" role="to"/>
            <tag k="type" v="enforcement"/><tag k="enforcement" v="traffic_signals;maxspeed"/>
            <tag k="maxspeed" v="40"/></relation>
        </osm>'''
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "features.osm"
            source.write_text(osm, encoding="utf-8")
            relations = builder.Enforcement()
            relations.apply_file(str(source))
            self.assertEqual(set(relations.devices), {5})
            features = builder.Features(relations.devices)
            features.apply_file(str(source), filters=[osmium.filter.EntityFilter(osmium.osm.NODE), osmium.filter.IdFilter(relations.devices)])
            features.apply_file(str(source), locations=True, filters=[osmium.filter.KeyFilter("highway", "footway", "maxspeed")])
            anchors = builder.RoadAnchors(features)
            anchors.apply_file(str(source), locations=True)
        camera = next(item for item in features.elements if item["id"] == 5)
        self.assertTrue(any(item['id'] == 8 for item in features.elements))
        crossing = next(item for item in features.elements if item["id"] == "way/11")
        self.assertEqual(camera["tags"]["maxspeed"], "40")
        self.assertTrue(camera["roads"])
        self.assertEqual(crossing["tags"]["highway"], "crossing")
        self.assertAlmostEqual(crossing["longitude"], 74.59)
        self.assertEqual(crossing["roads"][0]["bearing"], 0)
        self.assertEqual(crossing["roads"][0]["widthMeters"], 6.4)
        self.assertEqual(crossing["roads"][0]["roadClass"], "residential")
        self.assertEqual(features.speed_ways[0]["tags"]["maxspeed:backward"], "50")
        self.assertEqual([way["id"] for way in anchors.nearby_roads], [12])


if __name__ == "__main__":
    unittest.main()
