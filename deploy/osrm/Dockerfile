FROM ghcr.io/project-osrm/osrm-backend:26.9.0-debian@sha256:8a1b1bc938412f15f9b5b32d794c4ec6bf4a85dfbbabfa0a014b70b187edb53b
USER root
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gosu \
    && rm -rf /var/lib/apt/lists/* && useradd --non-unique --uid 1000 --create-home taxi-osrm
COPY start.sh update-loop.sh http-update.sh supervisor.sh bootstrap.sh /usr/local/bin/
RUN mv /usr/local/bin/start.sh /usr/local/bin/taxi-osrm-start \
    && mv /usr/local/bin/update-loop.sh /usr/local/bin/taxi-osrm-update-loop \
    && sed -i 's/\r$//' /usr/local/bin/taxi-osrm-start /usr/local/bin/taxi-osrm-update-loop /usr/local/bin/http-update.sh /usr/local/bin/supervisor.sh /usr/local/bin/bootstrap.sh \
    && chmod +x /usr/local/bin/taxi-osrm-start /usr/local/bin/taxi-osrm-update-loop /usr/local/bin/bootstrap.sh
ENV PORT=5000 OSM_PBF_URL=https://download.geofabrik.de/asia/kyrgyzstan-latest.osm.pbf \
    OSM_PBF_FALLBACK_URL=https://data.bbbike.org/osm/pbf/region/asia/kyrgyzstan.osm.pbf \
    MAP_UPDATE_INTERVAL_SECONDS=86400
EXPOSE 5000
ENTRYPOINT ["/usr/local/bin/bootstrap.sh"]
