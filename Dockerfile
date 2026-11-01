FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 VIBEBOT_DATA_DIR=/app/.data
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/core/model.ts src/core/rules.ts ./src/core/
RUN mkdir -p /app/.data && chown -R node:node /app
USER node
EXPOSE 8787
CMD ["node", "server/index.mjs"]
