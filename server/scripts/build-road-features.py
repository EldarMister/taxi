"""Build a compact roadside-feature snapshot from a Kyrgyzstan OSM PBF.

Usage: python -m pip install osmium
       python server/scripts/build-road-features.py .local/maps/kyrgyzstan.osm.pbf
"""

import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import osmium


SOURCE = "https://download.geofabrik.de/asia/kyrgyzstan-latest.osm.pbf"
HIGHWAYS = {"stop", "give_way", "traffic_signals", "crossing", "speed_camera"}
TAG_KEYS = {
    "highway", "traffic_sign", "maxspeed", "direction", "traffic_sign:direction",
    "traffic_signals:direction", "crossing", "crossing:signals", "bicycle", "foot",
    "motor_vehicle",
}


class Features(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.elements = []
        self.counts = Counter()

    def node(self, node):
        if not node.location.valid():
            return
        tags = {key: node.tags[key] for key in TAG_KEYS if key in node.tags}
        if tags.get("highway") not in HIGHWAYS and not tags.get("traffic_sign"):
            return
        self.elements.append({
            "id": node.id,
            "latitude": round(node.location.lat, 7),
            "longitude": round(node.location.lon, 7),
            "tags": tags,
        })
        self.counts[tags.get("highway", "traffic_sign")] += 1


def main():
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if not source or not source.is_file():
        raise SystemExit("Pass a downloaded Kyrgyzstan .osm.pbf file")
    destination = Path(__file__).resolve().parents[1] / "data" / "road-features-kg.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    features = Features()
    features.apply_file(str(source), locations=False)
    features.elements.sort(key=lambda item: item["id"])
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
