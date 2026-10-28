
# Stage 1: Build React admin application
FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

# Public build-time configuration. Left empty in the Docker image on purpose:
# src/config.ts then resolves the API to the page origin, and nginx proxies
# `/api/` + `/socket.io/` to backend:3001. Pass an absolute URL only when the
# admin panel is hosted on a different origin than the API.
ARG VITE_BACKEND_URL
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}

RUN npm run build

# Stage 2: Serve using Nginx
FROM nginxinc/nginx-unprivileged:stable-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
