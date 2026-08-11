FROM node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    ca-certificates \
    git=1:2.39.5-0+deb12u2 \
    python3=3.11.2-1+b1 \
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
