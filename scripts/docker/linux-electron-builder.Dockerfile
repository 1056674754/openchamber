FROM --platform=linux/amd64 oven/bun:1.3.14 AS bun-runtime

FROM --platform=linux/amd64 electronuserland/builder:20

COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun

RUN ln -s /usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js /usr/local/bin/node-gyp

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      file \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libatspi2.0-0 \
      libcairo2 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libxcomposite1 \
      libxdamage1 \
      libxrandr2 \
      openbox \
      squashfs-tools \
      xvfb \
    && rm -rf /var/lib/apt/lists/*
