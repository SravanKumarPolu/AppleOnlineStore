# Stage 1: Install production dependencies
FROM node:24-alpine AS dependencies

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev && npm cache clean --force

# Stage 2: Production runtime
FROM node:24-alpine

ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

# Upgrade zlib before switching to the non-root user
RUN apk upgrade --no-cache zlib

# Remove npm CLI from the production runtime
RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx

# Copy production dependencies
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules

# Copy application files
COPY --chown=node:node . .

# Ensure application files are readable
RUN chmod -R a+rX /app

# Run as non-root user
USER node

EXPOSE 3001

CMD ["node", "server.js"]
