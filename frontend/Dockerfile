FROM node:20-alpine

WORKDIR /app

ENV CHOKIDAR_USEPOLLING=true

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
