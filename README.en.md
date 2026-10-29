# Beryllium

An online epub reader built for self hosting

[中文文档](./README.md)

## features

- easy to deploy, and you own all of your data
- desktop and mobile support
- dark mode
- bookmark and highlight support
- multi-user support

## how to use

if you want to build from source, see `how to develop` below.

generally, you should use [container image](https://github.com/lee88688/beryllium/pkgs/container/beryllium) directly. here is the example of docker compose config.

```yaml
version: "3"
services:
  beryllium:
    image: ghcr.io/lee88688/beryllium:latest
    ports:
      - 3000:3000
    environment:
      # this env should be add, do not add quote to password string
      # this is used for startup. when admin user is created, this is no longer need.
      - ADMIN_USER_PASSWORD=some-password
      # the default admin user name is admin,
      # if you want to rename, please uncomment this line
      # - ADMIN_USER_NAME=some-other-name
    volumes:
      - /path/to/data:/app/data
```

`/app/data/db.sqlite` stores the database, `/app/data/asar` stores EPUB files and `/app/data/books` stores PDFs.
The data locations can be changed with `DATABASE_PATH`, `ASAR_DIR`, `BOOKS_DIR` and `TEMP_DIR`; upload caps are `MAX_UPLOAD_SIZE_MB` / `MAX_PDF_SIZE_MB` (see `.env.example`).

### image and tags

Images live in the GitHub Container Registry. The package is public, so it can be pulled anonymously without `docker login`. Tags:

- `latest`: republished on every push to `main`, i.e. a rolling tag; a release moves `latest` to that version too.
- `0.7.0` / `0.7`: fixed points, `0.7` follows the newest patch of the same minor line.
- `v0.7.0`: same name as the git tag.

The version is derived from the commit messages ([Conventional Commits](https://www.conventionalcommits.org/)). Once commits land on `main`, CI tags and releases them and publishes the image:

| commit                                             | version               |
| -------------------------------------------------- | --------------------- |
| `fix:` / `perf:`                                   | patch (0.7.0 → 0.7.1) |
| `feat:`                                            | minor (0.6.1 → 0.7.0) |
| `feat!:` or a `BREAKING CHANGE:` footer            | major                 |
| `refactor:` / `docs:` / `chore:` / `test:` / `ci:` | no release (no tag)   |

So a single `fix:` commit pushed to `main` publishes a patch release; protecting `main` and going through PRs (squash-merge, so the PR title becomes the commit message) is recommended.

The version lives in exactly three places: the git tag, the GitHub Release and the image tags (the image also carries it as the `org.opencontainers.image.version` OCI label). The `version` field in `package.json` does not take part in releasing; the tag is the only source of truth.

A non-conforming message does not fail anything by itself — it just produces **no release**. The repository therefore ships a `commit-msg` hook; enable it once per clone (equivalent to `git config core.hooksPath .githooks`):

```bash
pnpm hooks:install
```

A non-conforming message is then rejected before the commit is created. Scratch commits on a branch can bypass it with `git commit --no-verify`. CI also runs `commit-lint` (on pushes to `main` and on every PR, where both the title and the commits are checked) to cover paths a local hook cannot see, such as commits made in the web UI and squash-merge titles. To check the commits that are written but not pushed yet:

```bash
pnpm commit:check
```

The old Docker Hub image `lee88688/beryllium` is frozen at v0.6.1 and no longer updated; use `ghcr.io/lee88688/beryllium`.

### NOTE

Uploaded EPUBs are converted to asar (a tar-like archive of the extracted tree); PDFs are kept as original files in `BOOKS_DIR` and read on demand through HTTP Range, not wrapped in asar.

## stack

- [TanStack Start](https://tanstack.com/start) (SPA mode + server routes / server functions)
- [Drizzle ORM](https://orm.drizzle.team/) with SQLite (Node's built-in `node:sqlite` driver)
- [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) (Base UI primitives)
- React 19 + [TanStack Query](https://tanstack.com/query) + Jotai
- [foliate-js](https://github.com/johnfactotum/foliate-js) for EPUB rendering (vendored git submodule, wrapped by `src/features/reader/epub/**`)
- [pdf.js](https://mozilla.github.io/pdf.js/) for PDF rendering (`pdfjs-dist`, custom page layer, lazy worker/cmaps/wasm)
- tests: Vitest (unit / integration against the built server bundle) and Playwright (e2e)

## how to development

Node.js >= 24 and pnpm (`corepack enable pnpm`) are required.

The rendering core, foliate-js, is vendored as a git submodule (`vendor/foliate-js`, commit pinned in `git submodule status`), so a clone has to bring it along:

```bash
git clone --recursive <repo>  # or: git submodule update --init
pnpm install                 # install dependencies
cp .env.example .env         # prepare environment variables
pnpm db:generate             # generate SQLite migrations (after schema changes)
pnpm dev                     # development server (port 3000)
```

Other commands:

| command                                                | description                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `pnpm build`                                           | production build: `dist/client` (SPA) + `dist/server/server.js`                                    |
| `pnpm start`                                           | run the built app in a single process (`server.mjs`, applies migrations and seeds the first admin) |
| `pnpm typecheck` / `pnpm lint` / `pnpm format`         | tsc / oxlint / oxfmt                                                                               |
| `pnpm db:migrate` / `pnpm db:studio` / `pnpm db:check` | local migration, drizzle studio, migration consistency check                                       |
| `pnpm test:unit`                                       | unit tests (domain functions + services on an in-memory database)                                  |
| `pnpm test:integration`                                | integration tests (builds first, then drives `dist/server/server.js` in-process)                   |
| `pnpm test:e2e`                                        | Playwright e2e (starts the server against an isolated data directory)                              |
| `pnpm test`                                            | all of the above, in order                                                                         |

## deployment

The image runs a single node process: `node server.mjs`. It serves the SPA assets, the `/api/*` REST routes and the `/_serverFn/*` server functions, and applies the migrations in `drizzle/` on the first database access.

> **Breaking upgrade**: the data layer and UI were rewritten (Drizzle + SQLite instead of Prisma + Next.js). A `data/db.sqlite` left behind by the previous version **cannot be upgraded in place** — the server refuses to start against it; move the old file aside (or delete it) and upload your books again. Do not run `pnpm db:migrate` against the old file either: drizzle-kit bypasses that check and leaves an empty migration ledger behind (the server only accepts a ledger with applied migrations).

- The first start creates an admin from `ADMIN_USER_NAME` / `ADMIN_USER_PASSWORD`; once an admin exists those variables are ignored.
- Set `SESSION_COOKIE_SECURE=true` when serving over HTTPS.
- The upload size limit is controlled by `MAX_UPLOAD_SIZE_MB` (default 200).
