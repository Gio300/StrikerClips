import { Pool } from 'pg'
import { createApp } from './app'

// Production entry: talks to your real Postgres (Cloud SQL / RDS / self-hosted).
// DATABASE_URL=postgres://user:pass@host:5432/killcam
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const app = createApp(pool)
const port = Number(process.env.PORT || 8787)
app.listen(port, () => console.log(`KillCam API listening on :${port}`))
