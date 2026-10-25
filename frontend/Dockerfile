
# syntax=docker/dockerfile:1

# Stage 1: Build React/Vite application
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./

# Build tools and dev dependencies are required by Vite.
RUN npm ci

COPY . .

# These variables are PUBLIC and embedded in the client bundle.
ARG VITE_BACKEND_URL
ARG VITE_PAYPAL_CLIENT_ID

ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}
ENV VITE_PAYPAL_CLIENT_ID=${VITE_PAYPAL_CLIENT_ID}

RUN npm run build

# Stage 2: Non-root Nginx
FROM nginxinc/nginx-unprivileged:stable-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist/ /usr/share/nginx/html/

EXPOSE 8080
