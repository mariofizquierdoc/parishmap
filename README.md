# ParishMap

Explore Catholic dioceses and their parishes on a map, starting with the Archdiocese of Guayaquil.
The public site is read-only. A private admin site is used to draw parish territories.

## Requirements

Node.js 24 or newer.

## Getting started

```sh
npm install
cp .env.example server/.env
npm run db:generate -w server
npm run db:deploy -w server
npm run db:seed -w server
npm run import:guayaquil -w server
npm run admin:create -w server   # paste the three lines it prints into server/.env
npm run dev
```

The public site is at http://localhost:5173, and the admin site at http://localhost:5173/admin.

## Project layout

| Folder    | Contents                                  |
| --------- | ----------------------------------------- |
| `shared/` | Types and geometry code used by both apps |
| `server/` | Express API, Prisma schema, and scripts   |
| `web/`    | React site, including `/admin`            |
| `e2e/`    | Browser tests                             |

## Commands

| Command                              | Purpose                                     |
| ------------------------------------ | ------------------------------------------- |
| `npm run dev`                        | Run the API and the site                    |
| `npm test`                           | Run unit and API tests                      |
| `npm run test:e2e:prod`              | Run browser tests on the production build   |
| `npm run test:e2e`                   | Run browser tests, using their own database |
| `npm run lint`                       | Check code with ESLint                      |
| `npm run typecheck`                  | Check types in all apps                     |
| `npm run format`                     | Format code with Prettier                   |
| `npm run backup`                     | Back up the database and shapes             |
| `npm run import:guayaquil -w server` | Add new parishes from the source page       |

The first run of the browser tests needs `npx playwright install chromium`.

## Importing parishes

The importer only adds parishes that are new. It never changes or deletes existing ones, so
corrections made in the admin site are safe. It prints anything that looks wrong for review.

## Backups

**The hand-drawn boundaries exist only in the database, which isn't in git.** Back up regularly:

```sh
npm run backup
```

This writes a database copy and a readable GeoJSON file to `backups/`. Copy them somewhere else,
because a backup on the same disk won't survive losing that disk. It's safe to run while the
server is running.

To restore, stop the server first. The replaced database is kept beside the original.

```sh
npm run restore -w server -- ../backups/parishmap-YYYYMMDD-HHMMSS.db
npm run db:deploy -w server
```

## Deployment

```sh
npm ci
npm run build
npm run db:deploy -w server
npm run db:seed -w server        # first deployment only
npm start
```

The app runs as one process, which serves both the API and the site.

The host needs:

- **HTTPS**, because the login cookie only works over a secure connection.
- **A persistent disk** for the SQLite file. Point `DATABASE_URL` at it.
- **A single running instance**, because SQLite is a local file.

| Variable                | Required   | Purpose                                               |
| ----------------------- | ---------- | ----------------------------------------------------- |
| `NODE_ENV`              | Yes        | Set to `production`                                   |
| `DATABASE_URL`          | Yes        | For example, `file:/data/parishmap.db`                |
| `ADMIN_USERNAME`        | Yes        | From `npm run admin:create -w server`                 |
| `ADMIN_PASSWORD_HASH`   | Yes        | From `npm run admin:create -w server`                 |
| `SESSION_SECRET`        | Yes        | From `npm run admin:create -w server`                 |
| `PORT`                  | No         | Defaults to 3001                                      |
| `TRUST_PROXY`           | Behind one | Number of proxies in front of the app, usually `1`    |
| `SATELLITE_TILE_URL`    | No         | Satellite layer for the admin editor                  |
| `SATELLITE_ATTRIBUTION` | No         | Credit text the imagery provider requires             |
| `HTTPS`                 | No         | Set to `false` only to try a production build locally |

Set `TRUST_PROXY` correctly when behind a proxy. Otherwise, the login limit treats all visitors as
one address.

## Maps

Street maps come from [OpenFreeMap](https://openfreemap.org/), which needs no key and has no usage
limit, but offers no uptime guarantee. If it's unavailable, the parish list keeps working and the
map shows a message.

**Satellite imagery is off until configured.** Before enabling a provider, check that its terms
allow tracing boundaries from its imagery and publishing the result.

## Accuracy

Boundaries are drawn by hand and may not match official records. Publicly, they're labeled as
approximate unless marked as confirmed, and the site carries a disclaimer.

## License

The code is released under the [MIT License](LICENSE).

The MIT License does not cover the parish list, which comes from the
[Archdiocese of Guayaquil](https://arquidiocesisdeguayaquil.org.ec/parroquias/). That includes the
trimmed copy of their page in `server/test/fixtures/`, which is kept only to test the importer.
