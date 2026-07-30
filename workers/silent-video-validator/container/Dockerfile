# Pinned native media tooling for the silent-video validation Container.
# The base image is digest-pinned and chromium/ffmpeg install from a fixed
# snapshot.debian.org archive, so every rebuild resolves identical tool
# versions and the deterministic poster bytes stay stable across builds.
FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3

ARG DEBIAN_SNAPSHOT=20260715T000000Z

RUN rm -f /etc/apt/sources.list.d/debian.sources \
	&& printf 'deb http://snapshot.debian.org/archive/debian/%s bookworm main\ndeb http://snapshot.debian.org/archive/debian-security/%s bookworm-security main\ndeb http://snapshot.debian.org/archive/debian/%s bookworm-updates main\n' \
		"$DEBIAN_SNAPSHOT" "$DEBIAN_SNAPSHOT" "$DEBIAN_SNAPSHOT" > /etc/apt/sources.list \
	&& apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Retries=3 update \
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
