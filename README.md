# Beryllium

专注于自部署的在线 epub 阅读器

[English Version](./README.en.md)

## 特性

- 易于部署，只需要一个 docker 镜像就完成
- 同时支持桌面端和移动端 web 页面
- 暗黑模式
- 支持书签和内容标记
- 支持多用户

## 如何使用

如果你想要从源码构建，请参考`如何开发`。

通常情况下，你只需要使用[容器镜像](https://github.com/lee88688/beryllium/pkgs/container/beryllium)，下面是 docker compose 配置示例，docker cli 参数也可以参考下方的配置。

```yaml
version: "3"
services:
  beryllium:
    image: ghcr.io/lee88688/beryllium:latest
    ports:
      - 3000:3000
    environment:
      # 这个环境变量是必须添加的，不要在密码两侧添加引号
      # 在首次创建的时候使用，在数据库中存在admin账户后不再使用
      - ADMIN_USER_PASSWORD=some-password
      # 默认的admin账户名称为 admin,
      # 如果你想要修改admin账户的名称可以参考下面的配置
      # - ADMIN_USER_NAME=some-other-name
      # 必须：用于加密会话 cookie，至少 32 字符（openssl rand -hex 32 生成）
      - SESSION_SECRET=some-random-secret-at-least-32-characters
      # HTTPS 部署时设为 true
      # - SESSION_COOKIE_SECURE=true
    volumes:
      - /path/to/data:/app/data
```

`/app/data/db.sqlite` 是数据库的路径, `/app/data/asar` 用于存储电子书的路径。
数据目录可以通过 `DATABASE_PATH`、`ASAR_DIR`、`TEMP_DIR` 三个环境变量调整（默认值见 `.env.example`）。

### 镜像与版本

镜像托管在 GitHub Container Registry，公开包可直接匿名拉取，无需 `docker login`。tag 规则：

- `latest`：`main` 每次推送都会重新发布，即滚动版；发版也会把 `latest` 指向该版本。
- `0.7.0` / `0.7`：版本固定点，`0.7` 跟随同一条 minor 线的最新 patch。
- `v0.7.0`：与 git tag 同名。

版本号由提交信息推导（[Conventional Commits](https://www.conventionalcommits.org/)），合并进 `main` 后由 CI 自动打 tag、建 GitHub Release 并发布镜像：

| 提交类型                                              | 版本动作               |
| ----------------------------------------------------- | ---------------------- |
| `fix:` / `perf:`                                      | patch（0.7.0 → 0.7.1） |
| `feat:`                                               | minor（0.6.1 → 0.7.0） |
| `feat!:` 或正文含 `BREAKING CHANGE:`                  | major                  |
| `refactor:` / `docs:` / `chore:` / `test:` / `ci:` 等 | 不发版（不产生 tag）   |

也就是说往 `main` 推一个 `fix:` 提交就会发一个 patch 版本，所以建议给 `main` 加分支保护并走 PR（用 squash-merge 让 PR 标题充当提交信息）。

版本号只存在于三处：git tag、GitHub Release、镜像 tag（镜像的 OCI label `org.opencontainers.image.version` 也是它）。`package.json` 的 `version` 字段不参与发版，唯一真源是 tag。

提交信息不合规时不会报错、只是**静默不发版**。仓库因此带了一个 `commit-msg` hook，克隆后执行一次即可启用（等价于 `git config core.hooksPath .githooks`）：

```bash
pnpm hooks:install
```

之后不合规的信息会直接拒绝提交；分支上的临时提交可以 `git commit --no-verify` 跳过。CI 另外还有一道 `commit-lint`（推送到 `main` 与所有 PR，PR 会同时检查标题与提交），兜住网页端提交、squash-merge 标题这类本地 hook 管不到的路径。只想检查已写入但未推送的提交：

```bash
pnpm commit:check
```

旧的 Docker Hub 镜像 `lee88688/beryllium` 已停止更新，冻结在 v0.6.1，请改用 `ghcr.io/lee88688/beryllium`。

### 注意

epub 文件在上传后会被转换成 asar 文件格式，asar 文件与 tar 文件类似存储的是 epub 文件解压之后的文件。如果你想要后续再使用上传的 epub 文件，那就不要删除 epub 文件。epub 文件是无法再从服务器上在此下载的。

## 技术栈

- [TanStack Start](https://tanstack.com/start)（SPA 模式 + server routes / server functions）
- [Drizzle ORM](https://orm.drizzle.team/) + SQLite（Node 内置 `node:sqlite` 驱动）
- [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)（Base UI 原语）
- React 19 + [TanStack Query](https://tanstack.com/query) + Jotai
- [foliate-js](https://github.com/johnfactotum/foliate-js) 渲染（以 git submodule 固定版本，封装在 `src/features/reader/epub/**`）
- 测试：Vitest（单元 / 集成，驱动构建产物）+ Playwright（E2E）

## 如何开发

需要 Node.js ≥ 24 与 pnpm（`corepack enable pnpm` 即可）。

渲染内核 foliate-js 以 git submodule 固定引入（`vendor/foliate-js`，commit 见 `git submodule status`），因此**克隆时必须带上子模块**：

```bash
git clone --recursive <repo>  # 或克隆后执行 git submodule update --init
pnpm install                 # 安装依赖
cp .env.example .env         # 准备环境变量
pnpm db:generate             # 生成 SQLite 迁移（改了 schema 后执行一次）
pnpm dev                     # 开发服务器（默认 3000）
```

其他常用命令：

| 命令                                                   | 说明                                                                        |
| ------------------------------------------------------ | --------------------------------------------------------------------------- |
| `pnpm build`                                           | 生产构建：`dist/client`（SPA）+ `dist/server/server.js`（服务端 bundle）    |
| `pnpm start`                                           | 单进程运行构建产物（`server.mjs`，启动时自动应用迁移并创建首个管理员）      |
| `pnpm typecheck` / `pnpm lint` / `pnpm format`         | tsc / oxlint / oxfmt                                                        |
| `pnpm db:migrate` / `pnpm db:studio` / `pnpm db:check` | 本地迁移、drizzle studio、迁移一致性检查                                    |
| `pnpm test:unit`                                       | 单元测试（domain 纯函数 + 注入内存库的 service）                            |
| `pnpm test:integration`                                | 集成测试（先构建，再直接驱动 `dist/server/server.js` 的 `fetch`，不占端口） |
| `pnpm test:e2e`                                        | Playwright E2E（自动以隔离的数据目录启动服务）                              |
| `pnpm test`                                            | 依次跑上面三类测试                                                          |

## 部署

镜像内部只有一个 Node 进程：`node server.mjs`。它会托管 SPA 静态资源、`/api/*` REST 路由与 `/_serverFn/*` 服务端函数，并在首次访问数据库时应用 `drizzle/` 下的迁移。

> **破坏性升级**：本版本的数据层与 UI 已整体重写（Drizzle + SQLite，替代 Prisma + Next.js）。旧版本留下的 `data/db.sqlite` **无法原地升级**——服务检测到旧库会直接报错并退出，请把旧文件挪走或删除后重新上传书籍。也不要对旧库执行 `pnpm db:migrate`：drizzle-kit 不经过上述检查，失败后会在旧库里留下空的迁移记录表（服务靠「有已应用的迁移」判断，仍然会拒绝启动）。

- 首次启动会按 `ADMIN_USER_NAME` / `ADMIN_USER_PASSWORD` 创建管理员；库中已存在管理员后这两个变量不再生效。
- HTTPS 部署时请设置 `SESSION_COOKIE_SECURE=true`。
- 上传体积上限由 `MAX_UPLOAD_SIZE_MB` 控制（默认 200）。
