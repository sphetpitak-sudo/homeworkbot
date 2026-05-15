FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production && npm install -g pm2

COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["pm2-runtime", "index.js"]
