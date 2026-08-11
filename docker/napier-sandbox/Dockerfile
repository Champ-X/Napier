FROM node:24.16.0-trixie-slim@sha256:45fbb3ca3b6c7e6646cd2889d0ac7bf314bb180036da792221fc2f48fe4d43fb

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    ca-certificates=20250419 \
    git=1:2.47.3-0+deb13u1 \
    python3=3.13.5-1 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json /opt/napier/

RUN npm ci --prefix /opt/napier \
    --ignore-scripts \
    --omit=dev \
  && npm cache clean --force \
  && chmod -R a+rX /opt/napier

ENV PATH="/opt/napier/node_modules/.bin:/usr/local/bin:/usr/bin:/bin"

LABEL org.opencontainers.image.title="Napier Sandbox" \
  org.opencontainers.image.description="Pinned Node, Shell, Python, Git, LSP, and DAP toolchain for Napier" \
  org.opencontainers.image.source="https://github.com/Champ-X/Napier" \
  org.opencontainers.image.version="0.1.0"

ENTRYPOINT []
CMD ["/usr/local/bin/node", "--version"]
