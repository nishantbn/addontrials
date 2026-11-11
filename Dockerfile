FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY src/ ./src/

ENV PORT=7000
EXPOSE 7000

CMD ["node", "src/index.mjs"]
