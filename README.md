# Main Backend

Node.js orchestration backend for the dependency scanner dashboard.

## Features

- GitHub repository scan jobs
- ZIP repository upload scan jobs
- Live scan logs through server-sent events
- Dependency scanner service integration
- JWT and Nodemailer
- PostgreSQL/Sequelize-ready folders and model stubs

## Run

```powershell
npm install
copy .env.example .env
npm run dev
```

Or on Windows:

```powershell
.\start
```

`.\start` runs `node server.js` directly so repository clone/write activity cannot restart the backend during an active scan.

Default API URL: `http://127.0.0.1:5000`

Database is disabled by default. When PostgreSQL is needed, install the DB packages and set `DB_ENABLED=true`:

```powershell
npm install sequelize pg pg-hstore
```

Make sure the dependency scanner is also running:

```powershell
cd ..\dependency-Scanner
.\start
```

## GitHub OAuth

Create a GitHub OAuth App and set:

- Homepage URL: `http://127.0.0.1:3000`
- Authorization callback URL: `http://127.0.0.1:5000/api/github/oauth/callback`

Then update `.env`:

```powershell
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
GITHUB_CALLBACK_URL=http://127.0.0.1:5000/api/github/oauth/callback
FRONTEND_URL=http://127.0.0.1:3000
```

The backend stores the GitHub access token in memory for this phase and gives the frontend only a temporary session id.

## Routes

- `GET /api/health`
- `GET /api/scans`
- `GET /api/scans/:jobId`
- `GET /api/scans/:jobId/logs`
- `GET /api/github/oauth/start`
- `GET /api/github/oauth/callback`
- `POST /api/github/session`
- `POST /api/github/repositories`
- `POST /api/scans/github`
- `POST /api/scans/zip`
