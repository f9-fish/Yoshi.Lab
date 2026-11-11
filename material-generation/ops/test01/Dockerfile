# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim
ENV NODE_ENV=production MG_MODE=TEST MG_ENABLED=false MG_PREFLIGHT_ENABLED=false MG_TEST_APPEND_ENABLED=false MG_BIND_HOST=0.0.0.0
WORKDIR /app
COPY material-generation/package.json material-generation/package-lock.json ./material-generation/
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --prefix material-generation --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node material-generation ./material-generation
USER node
EXPOSE 8080
CMD ["node", "material-generation/phase3/server.cjs"]
