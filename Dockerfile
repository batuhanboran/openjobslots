FROM node:22-alpine AS build

RUN apk add --no-cache python3 make g++ sqlite

WORKDIR /app

COPY package*.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build:web
RUN npm prune --omit=dev && npm cache clean --force

FROM node:22-alpine AS runtime

RUN apk add --no-cache sqlite

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/dist ./dist
COPY --from=build /app/app.json ./app.json
COPY --from=build /app/favicon.ico /app/favicon.png /app/ojs-favicon.png /app/ojs-favicon.svg ./

EXPOSE 8787

CMD ["npm", "run", "start:prod"]
