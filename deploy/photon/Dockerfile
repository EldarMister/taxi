FROM eclipse-temurin:21-jre-jammy
USER root
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates zstd gosu \
    && rm -rf /var/lib/apt/lists/* && useradd --uid 1000 --create-home photon
WORKDIR /app
RUN curl -fL --retry 3 https://github.com/komoot/photon/releases/download/1.3.0/photon-1.3.0.jar -o photon.jar \
    && echo 'a89707c0045e4807b2a1180e132e68e108d998709f48b6c94b98a6e281f571a5  photon.jar' | sha256sum -c -
COPY start.sh run.sh update-loop.sh /app/
RUN chmod +x /app/start.sh /app/run.sh /app/update-loop.sh
ENV PORT=8080 PHOTON_DUMP_URL=https://download1.graphhopper.com/public/asia/central-asia/photon-dump-central-asia-1.0-latest.jsonl.zst MAP_UPDATE_INTERVAL_SECONDS=86400
EXPOSE 8080
ENTRYPOINT ["/app/start.sh"]
