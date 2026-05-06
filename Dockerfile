FROM node:22-alpine

RUN apk add --no-cache python3 make g++ sqlite

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build:web

EXPOSE 8787

CMD ["npm", "run", "start:prod"]
