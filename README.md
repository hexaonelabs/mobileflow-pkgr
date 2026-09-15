# MobileFlow (pkgr.app)

A mobile app packaging and deployment platform (iOS/Android) with integrated CI/CD, subscription management, and GitHub authentication.

## Technology Stack

- **Frontend** (SPA): Angular 20+ standalone components, TypeScript, Tailwind CSS
- **Backend** (API): NestJS, TypeScript, BullMQ (job queue), Firebase Admin SDK
- **Infrastructure**: Docker + Docker Compose (VPS), Firebase Hosting (static SPA)
- **Database**: Firestore (Firebase)
- **File Storage**: Firebase Storage (`.ipa`/`.apk` artifacts)
- **Queue**: Redis (BullMQ, hosted on VPS)
- **Reverse Proxy**: Caddy (auto TLS, VPS)
- **Payments**: Stripe (subscriptions)
- **Source CI/CD**: GitHub Actions
- **Webhooks**: GitHub (build completion) + Stripe (payments)

## Architecture & Domains

```
pkgr.app (Firebase Hosting - marketing site)
├── Static marketing site (Astro)
└── Main domain

dashboard.pkgr.app (Firebase Hosting - Angular SPA)
├── User frontend
├── GitHub OAuth authentication
└── Calls to api.pkgr.app (CORS enabled)

api.pkgr.app (VPS Infomaniak + Docker)
├── NestJS backend
├── Redis (internal localhost)
├── Stripe webhook → /stripe/webhook
├── GitHub webhook → /github/webhook
└── Let's Encrypt certificate (Caddy)
```

## Monorepo Structure

```
.
├── apps/
│   ├── web/                      # Dashboard Angular (deployed to dashboard.pkgr.app)
│   │   ├── src/
│   │   │   ├── app/              # Standalone Angular components
│   │   │   ├── environments/      # Environment config by target
│   │   │   │   ├── environment.ts (local dev)
│   │   │   │   ├── environment.example.ts (template)
│   │   │   │   └── environment.prod.ts (LOCAL ONLY, .gitignored)
│   │   │   └── styles.css
│   │   ├── angular.json
│   │   └── package.json
│   │
│   ├── api/                      # NestJS backend (Docker on VPS)
│   │   ├── src/
│   │   │   ├── app.module.ts     # ConfigModule, Firebase, BullMQ setup
│   │   │   ├── main.ts           # PORT env var, CORS, rawBody
│   │   │   ├── auth/             # OAuth strategies (GitHub, Google)
│   │   │   ├── billing/          # Stripe webhook + subscription logic
│   │   │   ├── projects/         # CI/CD workflows, builds
│   │   │   ├── secrets/          # Encryption, iOS certificates
│   │   │   └── ...
│   │   ├── .env.example          # Template (never committed)
│   │   ├── .env                  # PROD values (LOCAL ONLY, .gitignored)
│   │   ├── Dockerfile            # Multi-stage build (bcrypt compatible)
│   │   └── package.json
│   │
│   └── marketing/                # Astro static site (deployed to pkgr.app)
│       ├── src/
│       └── package.json
│
├── docker-compose.yml            # api + redis (VPS)
├── Dockerfile                    # NestJS build (VPS)
├── .dockerignore                 # Exclude node_modules, src, .env
├── firebase.json                 # Dual hosting targets (marketing + web)
├── .firebaserc                   # Firebase project config
├── package.json                  # Root workspace + scripts
├── CLAUDE.md                     # Development guidelines
├── FREEMIUM_PLAN.md              # Feature roadmap
├── PHASE_1_TASKS.md              # Phase 1 completion checklist
├── PHASE_2_TASKS.md              # Phase 2 scope & tasks
└── README.md                     # This file
```

## Prerequisites

### Local Development
- **Node.js** 22+ (tested with v25.6.0)
- **npm** 11.8.0+
- **Git** with SSH keys configured
- **Firebase CLI**: `npm install -g firebase-tools`
- **Stripe CLI** (optional, for local webhook testing): `brew install stripe/stripe-cli/stripe`

### VPS Access
- **SSH key-based authentication** (see VPS Connection section)
- **SSH client** (macOS/Linux built-in, Windows: PuTTY or WSL)

### Deployment (VPS)
- **VPS**: Ubuntu 24.04 LTS (Infomaniak or similar)
- **Docker** + **Docker Compose** v5.5.1+
- **SSH access** with key-based auth (RSA or Ed25519)
- **DNS A record**: `api.pkgr.app → 179.237.103.112` (example IP)

### Cloud Services
- **Firebase Project** (Firestore, Storage, Hosting, Admin SDK)
- **Stripe Account** (live mode for production)
- **GitHub OAuth App** + **GitHub App** (for login & CI/CD webhooks)
- **Email/SMTP** (for build notifications)

## VPS Connection & Management

### Initial SSH Setup

#### Generate SSH Key (if not already done)
```bash
ssh-keygen -t ed25519 -C "your-email@example.com" -f ~/.ssh/id_ed25519 -N ""
```

#### Add Public Key to VPS Authorized Keys
When creating the VPS on Infomaniak, provide the content of `~/.ssh/id_ed25519.pub`:
```bash
cat ~/.ssh/id_ed25519.pub
```
Copy this entire output into Infomaniak's "SSH Public Key" field during VPS creation.

#### Unlock SSH Key for Session (macOS/Linux)
Your SSH key may be protected by a passphrase. Add it to the SSH agent:
```bash
ssh-add ~/.ssh/id_ed25519
# Enter your passphrase when prompted
# Valid for 1 hour (or until you restart)
```

### Connect to VPS

#### Basic Connection
```bash
ssh ubuntu@api.pkgr.app
# or by IP:
ssh ubuntu@179.237.103.112
```

#### Verify Connection
```bash
ssh ubuntu@api.pkgr.app "echo 'Connected!' && uname -a"
```

#### Persistent SSH Config (Optional)
Create `~/.ssh/config`:
```
Host vps-pkgr
    HostName api.pkgr.app
    User ubuntu
    IdentityFile ~/.ssh/id_ed25519
    StrictHostKeyChecking accept-new
```

Then connect with:
```bash
ssh vps-pkgr
```

### Common VPS Commands

#### Check System Status
```bash
ssh ubuntu@api.pkgr.app "
  echo '=== Uptime ==='; uptime
  echo '=== Disk Usage ==='; df -h /
  echo '=== Memory ==='; free -h
"
```

#### View Docker Status
```bash
ssh ubuntu@api.pkgr.app "cd ~/mobileflow-pkgr && docker compose ps"
```

#### Follow API Logs in Real-Time
```bash
ssh ubuntu@api.pkgr.app "cd ~/mobileflow-pkgr && docker compose logs -f api"
```

#### Restart API Container
```bash
ssh ubuntu@api.pkgr.app "cd ~/mobileflow-pkgr && docker compose restart api"
```

#### Rebuild & Redeploy
```bash
ssh ubuntu@api.pkgr.app "
  cd ~/mobileflow-pkgr
  git pull
  docker compose up -d --build
  docker compose logs api --tail=50
"
```

#### Stop All Containers
```bash
ssh ubuntu@api.pkgr.app "cd ~/mobileflow-pkgr && docker compose down"
```

#### Check Caddy Reverse Proxy Status
```bash
ssh ubuntu@api.pkgr.app "sudo systemctl status caddy"
```

#### View Caddy Logs
```bash
ssh ubuntu@api.pkgr.app "sudo journalctl -u caddy -f"
```

#### Check Firewall Rules
```bash
ssh ubuntu@api.pkgr.app "sudo ufw status verbose"
```

### Transfer Files to/from VPS

#### Upload Local File to VPS
```bash
scp ~/local-file.txt ubuntu@api.pkgr.app:/home/ubuntu/
```

#### Download File from VPS
```bash
scp ubuntu@api.pkgr.app:/home/ubuntu/remote-file.txt ~/
```

#### Sync Production .env
Upload:
```bash
scp apps/api/.env ubuntu@api.pkgr.app:~/mobileflow-pkgr/apps/api/.env
ssh ubuntu@api.pkgr.app "chmod 600 ~/mobileflow-pkgr/apps/api/.env"
```

## Local Installation

### 1. Clone & Install Dependencies
```bash
git clone git@github.com:hexaonelabs/mobileflow-pkgr.git
cd mobileflow-pkgr
npm ci
```

### 2. Configure Environment Files

**`apps/web/src/environments/environment.prod.ts`** (LOCAL ONLY):
```typescript
export const environment = {
  production: true,
  apiUrl: 'https://api.pkgr.app',
};
```

**`apps/api/.env`** (LOCAL ONLY - copy from `.env.example`):
```bash
cp apps/api/.env.example apps/api/.env
# Edit with your real values:
# - Firebase credentials (project_id, client_email, private_key)
# - Stripe keys (sk_test_... for local testing)
# - GitHub OAuth (GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET)
# - SMTP credentials (for local email testing)
# - JWT_SECRET, MASTER_ENCRYPTION_KEY (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
PORT=3000
FRONTEND_URL="http://localhost:4200"
API_URL="http://localhost:3000"
REDIS_URL="redis://localhost:6379"
NODE_ENV="development"
```

### 3. Start Redis (if testing locally with BullMQ)
```bash
# Option 1: Docker
docker run -d -p 6379:6379 redis:7-alpine

# Option 2: Homebrew (macOS)
brew services start redis
```

## Development Commands

### Frontend (Angular)
```bash
# Dev server (localhost:4200)
npm run web

# Build (production)
npm run web:build

# Tests
npm run web:test
```

### Backend (NestJS)
```bash
# Dev server with auto-reload (localhost:3000)
npm run api

# Build (dist/)
npm run api:build

# Tests
npm run api:test

# E2E tests
cd apps/api && npm run test:e2e
```

### Marketing Site (Astro)
```bash
# Dev server
npm run marketing

# Build (static)
npm run marketing:build
```

### All Apps
```bash
# Build all
npm run web:build && npm run api:build && npm run marketing:build

# Individual app shortcuts
npm run web      # Angular dev server
npm run api      # NestJS dev server
npm run marketing # Astro dev server
```

## Deployment

### Firebase Hosting (SPA + Marketing)

#### Prerequisites
```bash
# Authenticate with Firebase
firebase login

# (Already configured in .firebaserc and firebase.json)
```

#### Deploy Both Sites
```bash
# Build both web (Angular) and marketing (Astro)
npm run web:build && npm run marketing:build

# Deploy to Firebase
npx firebase deploy --only hosting

# Or individually:
npx firebase deploy --only hosting:dashboard-pkgr  # Angular (dashboard.pkgr.app)
npx firebase deploy --only hosting:mobileflow-pkgr # Astro (pkgr.app)
```

### VPS Deployment (NestJS API)

#### Prerequisites
- VPS with Ubuntu 24.04
- Docker + Docker Compose installed
- SSH access configured
- DNS A record pointing to VPS IP
- Firewall allowing ports 22, 80, 443

#### Connect to VPS
```bash
ssh ubuntu@179.237.103.112 # or ssh ubuntu@api.pkgr.app
```

#### Initial Setup (first time only)
```bash
# On VPS, create a deploy key for GitHub
ssh-keygen -t ed25519 -C 'vps-mobileflow-deploy' -f ~/.ssh/id_ed25519 -N ''

# Add the public key to GitHub:
# Settings > Deploy keys (repo) > Add deploy key
# Paste ~/.ssh/id_ed25519.pub (read-only)

# Clone repo
git clone git@github.com:hexaonelabs/mobileflow-pkgr.git ~/mobileflow-pkgr
cd ~/mobileflow-pkgr

# Copy production .env (via scp from local or edit on VPS)
# scp apps/api/.env ubuntu@api.pkgr.app:~/mobileflow-pkgr/apps/api/.env
chmod 600 apps/api/.env

# Set firewall rules (ufw)
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

#### Deploy New Version
```bash
# Local: push changes to main branch
git push origin main

# On VPS:
cd ~/mobileflow-pkgr
git pull
docker compose up -d --build

# Check logs
docker compose logs -f api
```

#### Manual Commands on VPS
```bash
# View running containers
docker compose ps

# View API logs (real-time)
docker compose logs -f api

# Restart API (e.g., after .env changes)
docker compose restart api

# Rebuild image (after code push)
docker compose up -d --build

# Stop everything
docker compose down

# Check Caddy reverse proxy
sudo systemctl status caddy
sudo journalctl -u caddy -f

# Check firewall
sudo ufw status verbose
```

## Environment Variables Reference

### `apps/api/.env` (Production)

| Variable | Example | Notes |
|----------|---------|-------|
| `NODE_ENV` | `production` | Set by Dockerfile |
| `PORT` | `4000` | Internal container port (exposed via Caddy) |
| `REDIS_URL` | `redis://redis:6379` | Override in docker-compose for container-to-container |
| `FRONTEND_URL` | `https://dashboard.pkgr.app` | OAuth redirect origin |
| `API_URL` | `https://api.pkgr.app` | Public API endpoint |
| `JWT_SECRET` | `<random-hex-32>` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `MASTER_ENCRYPTION_KEY` | `<random-hex-32>` | For AES-256-GCM vault encryption |
| `FIREBASE_PROJECT_ID` | `genft-6f456` | From Firebase console |
| `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk-...@...iam.gserviceaccount.com` | From service account JSON |
| `FIREBASE_PRIVATE_KEY` | `-----BEGIN PRIVATE KEY-----\n...` | **Keep literal `\n`**, quoted |
| `FIREBASE_STORAGE_BUCKET` | `genft-6f456.appspot.com` | For `.ipa` / `.apk` upload |
| `GITHUB_OAUTH_CLIENT_ID` | | OAuth app (login) |
| `GITHUB_OAUTH_CLIENT_SECRET` | | OAuth app (login) |
| `GITHUB_OAUTH_CALLBACK_URL` | `https://api.pkgr.app/auth/oauth/github/callback` | Must match OAuth app settings |
| `GITHUB_APP_SLUG` | `mobileflow-ci` | GitHub App slug |
| `GITHUB_APP_ID` | `123456` | From GitHub App settings |
| `GITHUB_APP_PRIVATE_KEY` | `-----BEGIN RSA PRIVATE KEY-----\n...` | **Keep literal `\n`**, quoted |
| `GITHUB_WEBHOOK_SECRET` | `<random-hex-32>` | Must match GitHub App webhook secret |
| `STRIPE_SECRET_KEY` | `sk_live_...` | Stripe live mode (production) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | From Stripe webhook endpoint config |
| `STRIPE_PRICE_FREE` | `price_...` | Stripe product price ID |
| `STRIPE_PRICE_STARTER` | `price_...` | Stripe product price ID |
| `STRIPE_PRICE_FOUNDER_LIFETIME` | `price_...` | Stripe product price ID (one-time) |
| `SMTP_HOST` | `smtp.infomaniak.com` | Email provider |
| `SMTP_PORT` | `587` | TLS port |
| `SMTP_USER` | `notifications@pkgr.app` | Email account |
| `SMTP_PASSWORD` | | Email password |
| `SMTP_FROM` | `notifications@pkgr.app` | Sender email (must match domain for SPF/DKIM) |
| `GOOGLE_CLIENT_ID` | | (Optional) For Google OAuth |
| `GOOGLE_CLIENT_SECRET` | | (Optional) For Google OAuth |
| `GOOGLE_CALLBACK_URL` | `https://api.pkgr.app/auth/oauth/google/callback` | (Optional) |

### `apps/web/src/environments/environment.prod.ts` (Local Only)
```typescript
export const environment = {
  production: true,
  apiUrl: 'https://api.pkgr.app',  // Must match FRONTEND_URL on backend
};
```

## Stripe Webhook Testing

### Trigger Test Event (CLI)
```bash
# Enable Stripe CLI listening (local dev)
stripe listen --forward-to localhost:3000/stripe/webhook

# In another terminal, trigger events
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
```

### Verify Webhook (Production)
Dashboard → Developers → Webhooks → click endpoint → check "Recent deliveries"
- Look for HTTP 200 responses
- Verify request/response bodies

## GitHub OAuth & App Setup

### OAuth App (User Login)
1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. **Authorization callback URL**: `https://api.pkgr.app/auth/oauth/github/callback`
3. Copy Client ID + Secret → `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` in `.env`

### GitHub App (CI/CD Workflows)
1. GitHub → Settings → Developer settings → GitHub Apps → New GitHub App
2. **Webhook URL**: `https://api.pkgr.app/github/webhook`
3. **Setup URL** (after install): `https://dashboard.pkgr.app/github/connect/callback`
4. **Permissions**: Contents (read+write), Actions (read+write), Metadata (read)
5. **Subscribe to events**: Workflow runs
6. Copy App ID + generate private key → `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` in `.env`
7. Generate webhook secret → `GITHUB_WEBHOOK_SECRET` in `.env` (also set in GitHub App settings)

## Firebase Setup

### Service Account (Backend)
1. Firebase Console → Project Settings → Service Accounts → Generate New Private Key
2. Copy `project_id`, `client_email`, `private_key` (with literal `\n`) → `.env`

### Firestore
- Already configured in `apps/api/src/app.module.ts`
- All data persisted in Firestore (users, projects, builds, subscriptions)

### Storage
- For `.ipa` / `.apk` artifact upload
- Bucket: `FIREBASE_STORAGE_BUCKET` in `.env`

## Testing

### Unit Tests
```bash
npm run api:test        # NestJS
npm run web:test        # Angular (TBD - currently using preview for manual testing)
```

### E2E Tests
```bash
cd apps/api
npm run test:e2e
```

### Manual Preview (Angular)
```bash
npm run web     # http://localhost:4200
# Test login, project creation, build triggers, payment flow
```

## Common Issues & Solutions

### Redis Connection Error
**Problem**: `Error: connect ECONNREFUSED 127.0.0.1:6379`

**Solution**: Start Redis locally
```bash
docker run -d -p 6379:6379 redis:7-alpine
# OR
brew services start redis
```

### Firebase Admin SDK Auth Error
**Problem**: `Failed to initialize Firebase Admin SDK`

**Solution**: Check `.env` values:
- `FIREBASE_PRIVATE_KEY` must have literal `\n` (not escaped, fully quoted)
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` must be exact

### Stripe Webhook Not Received
**Problem**: Dashboard shows no recent deliveries

**Solutions**:
1. Check `STRIPE_WEBHOOK_SECRET` matches endpoint config
2. Verify endpoint URL in Dashboard: should be `https://api.pkgr.app/stripe/webhook`
3. Test with Dashboard "Send test webhook" button (doesn't require live payment)
4. Check API logs: `docker compose logs api | grep -i stripe`

### CORS Error from Frontend
**Problem**: `Access to XMLHttpRequest from origin dashboard.pkgr.app blocked`

**Solution**: Verify `FRONTEND_URL` in `.env` matches the actual origin (including `https://`)
- Backend automatically sets `Access-Control-Allow-Origin` header to `FRONTEND_URL` value

### SSH Connection Refused
**Problem**: `Permission denied (publickey)`

**Solutions**:
1. Verify SSH key is unlocked: `ssh-add ~/.ssh/id_ed25519`
2. Check key exists: `ls -la ~/.ssh/id_ed25519`
3. Verify public key was added to VPS during creation
4. Try verbose mode to debug: `ssh -vv ubuntu@api.pkgr.app`

### Cannot Connect to VPS After IP Change
**Problem**: VPS IP changed but DNS not updated

**Solutions**:
1. Update DNS A record in Infomaniak: `api.pkgr.app → <new-ip>`
2. DNS propagation takes 1-5 minutes (check: `dig api.pkgr.app`)
3. Connect by IP directly while DNS propagates: `ssh ubuntu@<new-ip>`

## Git Workflow

### Branch Strategy
- `main`: production-ready, deployed to Firebase + VPS
- Feature branches: `feat/xxx`, `fix/xxx`, `refactor/xxx`

### Before Pushing
1. Ensure `.env` files are NOT staged (should be `.gitignored`)
2. Commit message format: `type(scope): description` (see `.CLAUDE.md` for details)
3. Run type check (if configured): `ng build`

### After Merging to Main
1. Builds auto-deploy to Firebase (SPA)
2. VPS deployment is **manual**:
   ```bash
   ssh ubuntu@api.pkgr.app
   cd ~/mobileflow-pkgr
   git pull
   docker compose up -d --build
   ```

## Documentation Files

- **[CLAUDE.md](./CLAUDE.md)**: Development guidelines, TypeScript/Angular best practices
- **[FREEMIUM_PLAN.md](./FREEMIUM_PLAN.md)**: Feature roadmap (Free/Starter/Founder plans)
- **[PHASE_1_TASKS.md](./PHASE_1_TASKS.md)**: Phase 1 completion (GitHub webhook + analytics)
- **[PHASE_2_TASKS.md](./PHASE_2_TASKS.md)**: Phase 2 scope (in progress)

## Support & Questions

- Check the CLAUDE.md file for coding standards
- Review PHASE docs for feature status
- Check GitHub issues for known bugs
- Run tests before committing: `npm run api:test`

---

**Last Updated**: 2026-09-10  
**Deployed**: Dashboard (`dashboard.pkgr.app`), API (`api.pkgr.app`), Marketing (`pkgr.app`)  
**Infrastructure**: Docker (VPS) + Firebase Hosting  
**VPS Provider**: Infomaniak (Ubuntu 24.04 LTS)
