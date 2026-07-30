FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV STATE_PATH=/data/state.json

CMD ["node", "src/index.js"]
