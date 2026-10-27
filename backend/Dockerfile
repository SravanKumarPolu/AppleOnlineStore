
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

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules

COPY --chown=node:node . .

# Ensure application files are readable by node
RUN chmod -R a+rX /app

USER node

EXPOSE 3001

CMD ["node", "server.js"]
