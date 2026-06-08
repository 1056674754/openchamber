FROM oven/bun:1.3.14

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    file \
    g++ \
    git \
    make \
    nodejs \
    npm \
    python3 \
  && npm install -g node-gyp \
  && rm -rf /var/lib/apt/lists/*

