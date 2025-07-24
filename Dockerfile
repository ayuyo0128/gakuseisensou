FROM node:18-alpine

RUN apk add --no-cache python3 make g++ libc6-compat bash

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV PORT 8080
EXPOSE 8080

CMD ["node", "app.js"]
