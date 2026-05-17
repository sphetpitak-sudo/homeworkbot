FROM --platform=linux/amd64 node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

ENV PORT=8080
EXPOSE 8080

USER node

CMD ["node", "index.js"]
