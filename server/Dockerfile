# Built from the repository root (`docker build -f server/Dockerfile .`): the API bundles the game's
# scoring from `src/` to score every run itself. `Dockerfile.dockerignore` keeps the rest out.
FROM node:24-alpine AS build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
COPY src /app/src
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist ./dist
# Migrations are applied at startup by drizzle-orm's migrator, so the SQL ships in the image.
COPY server/drizzle ./drizzle
EXPOSE 8787
CMD ["node", "dist/index.js"]
