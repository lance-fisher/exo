FROM node:20-alpine

WORKDIR /app

COPY apps/control-ui/package.json ./
RUN npm install

COPY apps/control-ui/ ./

EXPOSE 3000

CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "3000"]
