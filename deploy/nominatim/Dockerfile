FROM mediagis/nominatim:5.3@sha256:7923a8e67197fc6d4f4ecb7c0e8bbedffeddcfdf4519596fe946e46a28f5a9f8
USER root
# Railway's private network needs IPv6. Do not trace database secrets into logs.
RUN sed -i 's/--bind :8080/--bind [::]:8080/g' /app/start.sh \
    && sed -i 's/sudo -E -u nominatim gunicorn/sudo -H -E -u nominatim gunicorn/' /app/start.sh \
    && sed -i 's@^#!/bin/bash -ex$@#!/bin/bash -e@; s/^set -x$/set +x/' /app/start.sh /app/init.sh /app/config.sh \
    && sed -i 's@/var/lib/postgresql/16/main@/var/lib/postgresql/16/main/data@g' /app/start.sh /app/init.sh /etc/postgresql/16/main/postgresql.conf \
    && sed -i '/^service postgresql start$/i chown -R nominatim:nominatim /var/lib/postgresql/16/main/project' /app/start.sh \
    && sed -i 's@sudo -E -u nominatim nominatim replication --project-dir ${PROJECT_DIR} \&> /var/log/replication.log \&@/usr/local/bin/taxi-nominatim-replication \&@' /app/start.sh \
    && mv /nominatim /nominatim-template \
    && ln -s /var/lib/postgresql/16/main/project /nominatim
COPY start.sh /usr/local/bin/taxi-nominatim-start
COPY replication.sh /usr/local/bin/taxi-nominatim-replication
RUN sed -i 's/\r$//' /usr/local/bin/taxi-nominatim-start /usr/local/bin/taxi-nominatim-replication \
    && chmod +x /usr/local/bin/taxi-nominatim-start /usr/local/bin/taxi-nominatim-replication
ENV PBF_URL=https://download.geofabrik.de/asia/kyrgyzstan-latest.osm.pbf \
    REPLICATION_URL=https://download.geofabrik.de/asia/kyrgyzstan-updates/ \
    REPLICATION_UPDATE_INTERVAL=86400 REPLICATION_RECHECK_INTERVAL=900 UPDATE_MODE=continuous \
    IMPORT_WIKIPEDIA=false IMPORT_STYLE=full THREADS=2 GUNICORN_WORKERS=2 \
    POSTGRES_SHARED_BUFFERS=256MB POSTGRES_MAINTENANCE_WORK_MEM=512MB \
    POSTGRES_AUTOVACUUM_WORK_MEM=128MB POSTGRES_EFFECTIVE_CACHE_SIZE=1GB \
    POSTGRES_WORK_MEM=8MB POSTGRES_MAX_CONNECTIONS=40 PORT=8080
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/taxi-nominatim-start"]
