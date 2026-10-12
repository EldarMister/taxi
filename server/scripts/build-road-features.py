"""Build a compact roadside-feature snapshot from a Kyrgyzstan OSM PBF.

Usage: python -m pip install osmium
       python server/scripts/build-road-features.py .local/maps/kyrgyzstan.osm.pbf
"""

import json
import math
import sys
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
    "motor_vehicle", "enforcement",
}


class Features(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.elements = []
        self.counts = Counter()
        self.grid = {}

    @staticmethod
    def cell(latitude, longitude):
        return math.floor(latitude * 1000), math.floor(longitude * 1000)

    def node(self, node):
        if not node.location.valid():
            return
        tags = {key: node.tags[key] for key in TAG_KEYS if key in node.tags}
        if tags.get("highway") not in HIGHWAYS and not tags.get("traffic_sign") and tags.get("enforcement") != "maxspeed":
            return
        element = {
            "id": node.id,
            "latitude": round(node.location.lat, 7),
            "longitude": round(node.location.lon, 7),
            "tags": tags,
            "roads": [],
        }
        self.elements.append(element)
        self.grid.setdefault(self.cell(element["latitude"], element["longitude"]), []).append(element)
        self.counts[tags.get("highway", "traffic_sign")] += 1

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
                            "bearing": round((math.degrees(math.atan2(dx, dy)) + 360) % 360),
                            "distance": round(distance, 1),
                        }
                        roads = feature["roads"]
                        if any(abs(item["bearing"] - road["bearing"]) < 12
                               and abs(item["distance"] - road["distance"]) < 2 for item in roads):
                            continue
                        roads.append(road)
                        roads.sort(key=lambda item: item["distance"])
                        del roads[8:]


def main():
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if not source or not source.is_file():
        raise SystemExit("Pass a downloaded Kyrgyzstan .osm.pbf file")
    destination = Path(__file__).resolve().parents[1] / "data" / "road-features-kg.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    features = Features()
    features.apply_file(str(source), locations=True)
    features.elements.sort(key=lambda item: item["id"])
    for element in features.elements:
        roads = element["roads"]
        if roads:
            best = roads[0]["distance"]
            element["roads"] = [road for road in roads if road["distance"] <= best + 2][:4]
    payload = {
        "source": SOURCE,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "elements": features.elements,
    }
    destination.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Saved {len(features.elements)} nodes ({destination.stat().st_size} bytes) to {destination}")
    print(dict(features.counts))


if __name__ == "__main__":
    main()
