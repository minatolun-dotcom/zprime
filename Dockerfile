# --- client build ---
FROM node:22-alpine AS client-build
WORKDIR /app
COPY package.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install --workspaces --include-workspace-root
COPY client ./client
RUN npm run build -w client

# --- server build ---
FROM node:22-alpine AS server-build
WORKDIR /app
COPY package.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install --workspaces --include-workspace-root
COPY server ./server
RUN npm run build -w server

# --- runtime ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# R-85: in-app backups spawn pg_dump/psql directly (no host tools, no shell —
# args arrays only). postgresql16-client matches the db service (postgres:16).
RUN apk add --no-cache postgresql16-client
COPY --from=server-build /app/node_modules ./node_modules
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=server-build /app/server/package.json ./server/package.json
COPY --from=server-build /app/server/drizzle ./server/drizzle
COPY --from=client-build /app/client/dist ./client/dist
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
