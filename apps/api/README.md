# MobileFlow API

Backend NestJS de MobileFlow.

## Prerequis locaux

- Node.js compatible avec le repo
- npm
- Redis disponible sur `localhost:6379`, ou une URL Redis configuree dans `REDIS_URL`

L'API utilise BullMQ via Redis. Si Redis n'est pas demarre, le serveur peut afficher une erreur du type:

```text
[ioredis] Unhandled error event: AggregateError [ECONNREFUSED]
```

## Configuration

Copier l'exemple d'environnement, puis remplir les valeurs locales:

```bash
cp apps/api/.env.example apps/api/.env
```

La valeur locale par defaut est:

```bash
REDIS_URL="redis://localhost:6379"
```

## Demarrer Redis

Avec Docker:

```bash
docker run --name mobileflow-redis -p 6379:6379 -d redis:7-alpine
```

Avec Homebrew sur macOS:

```bash
brew install redis
brew services start redis
```

Ou utiliser un Redis distant en mettant a jour `REDIS_URL` dans `apps/api/.env`.

## Demarrer l'API

Depuis la racine du repo:

```bash
npm run api
```

Ou depuis `apps/api`:

```bash
npm run start:dev
```

L'API ecoute par defaut sur `http://localhost:3000`.

## Tests

Depuis la racine du repo:

```bash
npm run api:test
```
