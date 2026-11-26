# Built by the Supervisor from this folder; src/ is a copy of the repo (see ha-addon/README.md).
FROM node:24-alpine
WORKDIR /app
COPY src/package.json src/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY src/ ./
RUN npx vite build -c vite.mcp.config.ts --logLevel error
COPY run.sh /run.sh
CMD ["/bin/sh", "/run.sh"]
