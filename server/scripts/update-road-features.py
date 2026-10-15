"""Download current Geofabrik data before rebuilding, rather than reusing an old PBF.

python server/scripts/update-road-features.py [--overlay current-region.osm]
"""
import argparse
import subprocess
import sys
import urllib.request
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--overlay', type=Path, action='append', default=[])
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
source = root / '.local/maps/kyrgyzstan-current.osm.pbf'
source.parent.mkdir(parents=True, exist_ok=True)
temporary = source.with_suffix('.download')
request = urllib.request.Request('https://download.geofabrik.de/asia/kyrgyzstan-latest.osm.pbf',
                                 headers={'User-Agent': 'Atlas-road-features/1.0'})
try:
    with urllib.request.urlopen(request, timeout=60) as response, temporary.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
        expected = response.headers.get('Content-Length')
    if expected and temporary.stat().st_size != int(expected):
        raise ValueError('The PBF download was incomplete')
    temporary.replace(source)
    command = [sys.executable, str(Path(__file__).with_name('build-road-features.py')), str(source)]
    for overlay in args.overlay:
        command.extend(['--overlay', str(overlay)])
    subprocess.run(command, check=True)
finally:
    temporary.unlink(missing_ok=True)
