FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS ui
WORKDIR /ui
COPY frontend/package*.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npm run build

FROM python:3.14-slim-bookworm@sha256:48b13b003dda20b16f9442b8475aa05fe21bf6579a8c881db92ffb4d8fd20f83
ARG BUILD_COMMIT=unknown
ARG BUILD_DATE=unknown
ENV COMGRAF_BUILD_COMMIT=${BUILD_COMMIT} COMGRAF_BUILD_DATE=${BUILD_DATE} PRODUCT_VERSION=1.5.0
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# Python wheels built from source must remain at x86-64-v1 even if the image is built on a newer CPU.
ENV CFLAGS="-march=x86-64 -mtune=generic" RUSTFLAGS="-C target-cpu=x86-64"
WORKDIR /app/backend
COPY backend/requirements.lock.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home --uid 10001 comgraf && mkdir -p /data/uploads /data/mail-secrets && chown -R comgraf:comgraf /data
COPY --chown=comgraf:comgraf backend/ ./
COPY --from=ui --chown=comgraf:comgraf /ui/dist /app/frontend/dist
USER comgraf
EXPOSE 8000
CMD ["python", "-m", "app.start"]
