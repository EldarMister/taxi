"""Build a compact roadside-feature snapshot from a Kyrgyzstan OSM PBF.

Usage: python -m pip install osmium
       python server/scripts/build-road-features.py .local/maps/kyrgyzstan.osm.pbf
"""

import json
import argparse
import math
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import osmium


SOURCE = "https://download.geofabrik.de/asia/kyrgyzstan-latest.osm.pbf"
HIGHWAYS = {"stop", "give_way", "traffic_signals", "crossing", "speed_camera"}
DRIVABLE = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service", "road", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}
TAG_KEYS = {
    "highway", "traffic_sign", "maxspeed", "direction", "traffic_sign:direction",
    "traffic_signals:direction", "crossing", "crossing:signals", "bicycle", "foot",
    "motor_vehicle", "enforcement", "railway", "traffic_signals",
    "footway", "crossing:markings", "width", "lanes", "maxspeed:forward", "maxspeed:backward", "oneway",
}


def speed_enforcement(value):
    return any(token.strip() in {"maxspeed", "average_speed"} for token in re.split("[;,]", value or ""))


def road_width(tags):
    width = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(?:m)?", tags.get("width", ""))
    if width:
        return round(max(5, min(18, float(width[1]))), 1)
    lanes = re.fullmatch(r"\d+", tags.get("lanes", ""))
    if lanes:
        return round(max(5, min(18, int(lanes[0]) * 3.2)), 1)
    return 10 if tags.get("highway") in {"primary", "secondary", "trunk"} else 7


def segment_distance(point, before, after):
    x_scale = math.cos(math.radians(point[0])) * 111320
    ax, ay = (before[1] - point[1]) * x_scale, (before[0] - point[0]) * 111320
    dx, dy = (after[1] - before[1]) * x_scale, (after[0] - before[0]) * 111320
    length2 = dx * dx + dy * dy
    fraction = min(1, max(0, -(ax * dx + ay * dy) / length2)) if length2 else 0
    return math.hypot(ax + dx * fraction, ay + dy * fraction)


class Enforcement(osmium.SimpleHandler):
    """Relations can be the only place that identifies a speed enforcement device."""
    def __init__(self):
        super().__init__()
        self.devices = {}

    def relation(self, relation):
        if relation.tags.get("type") != "enforcement" or not speed_enforcement(relation.tags.get("enforcement")):
            return
        devices = [member.ref for member in relation.members if member.type == "n" and member.role == "device"]
        # A relation without a device can still map the beginning of section control.
        if not devices:
            devices = [member.ref for member in relation.members if member.type == "n" and member.role == "from"]
        for ref in devices:
            self.devices[ref] = {key: relation.tags[key] for key in ("enforcement", "maxspeed") if key in relation.tags}


class Features(osmium.SimpleHandler):
    def __init__(self, devices=None):
        super().__init__()
        self.elements = []
        self.counts = Counter()
        self.grid = {}
        self.devices = devices or {}
        self.speed_ways = []
        self.ids = set()

    def add(self, element):
        if element["id"] in self.ids:
            return
        self.ids.add(element["id"])
        self.elements.append(element)
        self.grid.setdefault(self.cell(element["latitude"], element["longitude"]), []).append(element)
        self.counts[element["tags"].get("highway", "traffic_sign")] += 1

    @staticmethod
    def cell(latitude, longitude):
        return math.floor(latitude * 1000), math.floor(longitude * 1000)

    def node(self, node):
        if not node.location.valid():
            return
        # Most PBF nodes have no tags; avoid materializing their dictionaries.
        if not node.tags and node.id not in self.devices:
            return
        tags = {key: node.tags[key] for key in TAG_KEYS if key in node.tags}
        tags.update(self.devices.get(node.id, {}))
        if (not HIGHWAYS.intersection((tags.get("highway") or "").split(";")) and tags.get("footway") != "crossing" and not tags.get("traffic_sign")
                and not speed_enforcement(tags.get("enforcement")) and not tags.get("maxspeed")
                and tags.get("crossing") in (None, "no")):
            return
        element = {
            "id": node.id,
            "latitude": round(node.location.lat, 7),
            "longitude": round(node.location.lon, 7),
            "tags": tags,
            "roads": [],
        }
        self.add(element)

    def way(self, way):
        tags = {key: way.tags[key] for key in TAG_KEYS if key in way.tags}
        if tags.get("footway") == "crossing" or (tags.get("highway") in {"footway", "path", "pedestrian"} and tags.get("crossing") not in (None, "no")):
            valid = [(node.location.lat, node.location.lon) for node in way.nodes if node.location.valid()]
            if len(valid) >= 2:
                distances = [math.hypot((after[1] - before[1]) * math.cos(math.radians(before[0])), after[0] - before[0]) for before, after in zip(valid, valid[1:])]
                target = sum(distances) / 2
                for index, length in enumerate(distances):
                    if target <= length or index == len(distances) - 1:
                        fraction = target / length if length else 0
                        before, after = valid[index], valid[index + 1]
                        lat = before[0] + (after[0] - before[0]) * fraction
                        lon = before[1] + (after[1] - before[1]) * fraction
                        nearby = [feature for cell_lat in range(math.floor(lat * 1000) - 1, math.floor(lat * 1000) + 2)
                                  for cell_lon in range(math.floor(lon * 1000) - 1, math.floor(lon * 1000) + 2)
                                  for feature in self.grid.get((cell_lat, cell_lon), ())]
                        if not any(feature["tags"].get("highway") == "crossing" and math.hypot((feature["longitude"] - lon) * math.cos(math.radians(lat)), feature["latitude"] - lat) * 111320 < 6 for feature in nearby):
                            bearing = (math.degrees(math.atan2((after[1] - before[1]) * math.cos(math.radians(lat)), after[0] - before[0])) + 450) % 360
                            self.add({"id": f"way/{way.id}", "latitude": round(lat, 7), "longitude": round(lon, 7),
                                      "tags": {**tags, "highway": "crossing"}, "roads": [], "bearing": round(bearing) % 360})
                        break
                    target -= length
        if tags.get("highway") in DRIVABLE and tags.get("motor_vehicle") != "no" and any(tags.get(key) for key in ("maxspeed", "maxspeed:forward", "maxspeed:backward")):
            geometry = [{"latitude": round(node.location.lat, 7), "longitude": round(node.location.lon, 7)} for node in way.nodes if node.location.valid()]
            if len(geometry) >= 2:
                self.speed_ways.append({"id": way.id, "geometry": geometry,
                                        "tags": {key: value for key, value in tags.items() if key in {"maxspeed", "maxspeed:forward", "maxspeed:backward", "oneway"}}})


class RoadAnchors(osmium.SimpleHandler):
    def __init__(self, features):
        super().__init__()
        self.grid = features.grid
        self.nearby_roads = []
        self.speed_grid = {}
        self.speed_ids = {way["id"] for way in features.speed_ways}
        for way in features.speed_ways:
            for before, after in zip(way["geometry"], way["geometry"][1:]):
                segment = ((before["latitude"], before["longitude"]), (after["latitude"], after["longitude"]))
                for lat in range(math.floor(min(segment[0][0], segment[1][0]) * 1000), math.floor(max(segment[0][0], segment[1][0]) * 1000) + 1):
                    for lon in range(math.floor(min(segment[0][1], segment[1][1]) * 1000), math.floor(max(segment[0][1], segment[1][1]) * 1000) + 1):
                        self.speed_grid.setdefault((lat, lon), []).append(segment)

    def way(self, way):
        if way.tags.get("highway") not in DRIVABLE or way.tags.get("motor_vehicle") == "no":
            return
        nodes = way.nodes
        for index in range(1, len(nodes)):
            before, after = nodes[index - 1], nodes[index]
            if not before.location.valid() or not after.location.valid():
                continue
            lat1, lon1 = before.location.lat, before.location.lon
            lat2, lon2 = after.location.lat, after.location.lon
            south, north = sorted((lat1, lat2))
            west, east = sorted((lon1, lon2))
            if way.id not in self.speed_ids:
                # Retain only close parallel untagged roads. They prevent a limit
                # from being borrowed by a neighbouring frontage/service road.
                direction = math.atan2((lon2 - lon1) * math.cos(math.radians(lat1)), lat2 - lat1)
                close = False
                for cell_lat in range(math.floor((south - .0002) * 1000), math.floor((north + .0002) * 1000) + 1):
                    for cell_lon in range(math.floor((west - .00025) * 1000), math.floor((east + .00025) * 1000) + 1):
                        for start, end in self.speed_grid.get((cell_lat, cell_lon), ()):
                            other_direction = math.atan2((end[1] - start[1]) * math.cos(math.radians(start[0])), end[0] - start[0])
                            difference = abs((direction - other_direction + math.pi) % (2 * math.pi) - math.pi)
                            if min(difference, math.pi - difference) > math.radians(35):
                                continue
                            distance = min(segment_distance((lat1, lon1), start, end), segment_distance((lat2, lon2), start, end),
                                           segment_distance(start, (lat1, lon1), (lat2, lon2)), segment_distance(end, (lat1, lon1), (lat2, lon2)))
                            if distance <= 18:
                                close = True
                                break
                        if close:
                            break
                    if close:
                        break
                if close:
                    self.nearby_roads.append({"id": way.id, "geometry": [{"latitude": round(lat1, 7), "longitude": round(lon1, 7)},
                                                                         {"latitude": round(lat2, 7), "longitude": round(lon2, 7)}], "tags": {}})
            # Long sparse motorway segments need only the nearby feature cells.
            for cell_lat in range(math.floor((south - .00045) * 1000), math.floor((north + .00045) * 1000) + 1):
                for cell_lon in range(math.floor((west - .00055) * 1000), math.floor((east + .00055) * 1000) + 1):
                    for feature in self.grid.get((cell_lat, cell_lon), ()):
                        x_scale = 111320 * math.cos(math.radians(feature["latitude"]))
                        ax = (lon1 - feature["longitude"]) * x_scale
                        ay = (lat1 - feature["latitude"]) * 111320
                        dx = (lon2 - lon1) * x_scale
                        dy = (lat2 - lat1) * 111320
                        length2 = dx * dx + dy * dy
                        if length2 < 1:
                            continue
                        fraction = min(1, max(0, -(ax * dx + ay * dy) / length2))
                        distance = math.hypot(ax + dx * fraction, ay + dy * fraction)
                        if distance > 45:
                            continue
                        road = {
                            "latitude": round(lat1 + (lat2 - lat1) * fraction, 7),
                            "longitude": round(lon1 + (lon2 - lon1) * fraction, 7),
                            "bearing": round((math.degrees(math.atan2(dx, dy)) + 360) % 360) % 360,
                            "distance": round(distance, 1),
                            "widthMeters": road_width(way.tags),
                            "roadClass": way.tags.get("highway"),
                        }
                        roads = feature["roads"]
                        if any(abs(item["bearing"] - road["bearing"]) < 12
                               and abs(item["distance"] - road["distance"]) < 2 for item in roads):
                            continue
                        roads.append(road)
                        roads.sort(key=lambda item: item["distance"])
                        del roads[8:]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--overlay', type=Path, action='append', default=[], help='Current bounded OSM API XML extract')
    args = parser.parse_args()
    source = args.source
    if not source or not source.is_file():
        raise SystemExit("Pass a downloaded Kyrgyzstan .osm.pbf file")
    destination = Path(__file__).resolve().parents[1] / "data" / "road-features-kg.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    enforcement = Enforcement()
    enforcement.apply_file(str(source))
    print(f"Found {len(enforcement.devices)} enforcement relation devices", flush=True)
    features = Features(enforcement.devices)
    if enforcement.devices:
        # Relation devices need not have their own tags. Collect those explicitly
        # before the C++ tag filter skips millions of ordinary geometry nodes.
        features.apply_file(str(source), filters=[osmium.filter.EntityFilter(osmium.osm.NODE), osmium.filter.IdFilter(enforcement.devices)])
    features.apply_file(str(source), locations=True, filters=[osmium.filter.KeyFilter("highway", "traffic_sign", "maxspeed", "maxspeed:forward", "maxspeed:backward", "enforcement", "crossing", "footway")])
    overlays = []
    for overlay in args.overlay:
        tree = ET.parse(overlay)
        bounds = tree.find('bounds')
        if bounds is None:
            raise ValueError('An OSM overlay must contain explicit bounds')
        south, north = float(bounds.get('minlat')), float(bounds.get('maxlat'))
        west, east = float(bounds.get('minlon')), float(bounds.get('maxlon'))
        devices = Enforcement()
        devices.apply_file(str(overlay))
        updated = Features(devices.devices)
        updated.apply_file(str(overlay), locations=True)
        inside = lambda item: south <= item['latitude'] <= north and west <= item['longitude'] <= east
        features.elements = [item for item in features.elements if not inside(item)] + [item for item in updated.elements if inside(item)]
        speed_ways = {way['id']: way for way in features.speed_ways}
        speed_ways.update({way['id']: way for way in updated.speed_ways})
        features.speed_ways = list(speed_ways.values())
        overlays.append({'bounds': {'south': south, 'north': north, 'west': west, 'east': east},
                         'source': 'https://api.openstreetmap.org/api/0.6/map', 'fetchedAt': datetime.now(timezone.utc).isoformat()})
    if overlays:
        features.grid = {}
        for item in features.elements:
            features.grid.setdefault(features.cell(item['latitude'], item['longitude']), []).append(item)
        features.counts = Counter(item['tags'].get('highway', 'traffic_sign') for item in features.elements)
    print(f"Collected {len(features.elements)} features and {len(features.speed_ways)} speed-tagged roads", flush=True)
    # Separate pass: a crossing footway can follow its motor road in PBF order.
    anchors = RoadAnchors(features)
    anchors.apply_file(str(source), locations=True, filters=[osmium.filter.KeyFilter("highway")])
    for overlay in args.overlay:
        anchors.apply_file(str(overlay), locations=True, filters=[osmium.filter.KeyFilter("highway")])
    features.elements.sort(key=lambda item: str(item["id"]))
    for element in features.elements:
        roads = element["roads"]
        if roads:
            best = roads[0]["distance"]
            element["roads"] = [road for road in roads if road["distance"] <= best + 2][:4]
    with osmium.io.Reader(str(source)) as reader:
        source_timestamp = reader.header().get('osmosis_replication_timestamp') or None
    payload = {
        "source": SOURCE,
        "sourceTimestamp": source_timestamp,
        "overlays": overlays,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "elements": features.elements,
        "speedWays": features.speed_ways,
        "nearbyRoads": anchors.nearby_roads,
    }
    temporary = destination.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(destination)
    print(f"Saved {len(features.elements)} nodes ({destination.stat().st_size} bytes) to {destination}")
    print(dict(features.counts))
    print(f"Speed-tagged ways: {len(features.speed_ways)}; enforcement relation device nodes: {len(enforcement.devices)}")
    print(f"Nearby untagged road segments: {len(anchors.nearby_roads)}")


if __name__ == "__main__":
    main()
