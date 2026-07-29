# Pinned native media tooling for the silent-video validation Container.
# The digest pins Node 22 on Debian bookworm; chromium and ffmpeg come from
# the bookworm archive so decode, playback, and poster output stay
# deterministic for a given image build.
FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3

RUN apt-get update \
	&& apt-get install --yes --no-install-recommends \
		chromium \
		ffmpeg \
	&& rm -rf /var/lib/apt/lists/*

ENV CHROMIUM_BIN=/usr/bin/chromium

WORKDIR /opt/silent-video-validator
COPY server.mjs ./server.mjs

EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
