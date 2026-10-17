FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
ENV DB_PATH=/data/db.json
EXPOSE 8080

# Accounts live on a mounted disk. Create the directory so a local run still starts.
CMD ["sh", "-c", "mkdir -p /data && npm start"]
