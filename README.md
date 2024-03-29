# Beryllium

专注于自部署的在线epub阅读器

[English Version](./README.en.md)

## 特性

- 易于部署，只需要一个docker镜像就完成
- 同时支持桌面端和移动端web页面
- 暗黑模式
- 支持书签和内容标记
- 支持多用户

## 如何使用

如果你想要从源码构建，请参考`如何开发`。

通常情况下，你只需要使用[docker镜像](https://hub.docker.com/r/lee88688/beryllium)，下面是docker compose配置示例，docker cli参数也可以参考下方的配置。

```yaml
version: "3"
services:
  beryllium:
    image: lee88688/beryllium
    ports:
      - 3000:3000
    environment:
      # 这个环境变量是必须添加的，不要在密码两侧添加引号
      # 在首次创建的时候使用，在数据库中存在admin账户后不再使用
      - ADMIN_USER_PASSWORD=some-password
      # 默认的admin账户名称为 admin,
      # 如果你想要修改admin账户的名称可以参考下面的配置
      # - ADMIN_USER_NAME=some-other-name
    volumes:
      - /path/to/data:/app/data
```

`/app/data/db.sqlite` 是数据库的路径, `/app/data/asar` 用于存储电子书的路径。

### 注意

epub文件在上传后会被转换成asar文件格式，asar文件与tar文件类似存储的是epub文件解压之后的文件。如果你想要后续再使用上传的epub文件，那就不要删除epub文件。epub文件是无法再从服务器上在此下载的。

## 如何开发

- create `.env` file, like `.env.example`
- prisma
  - `npx prisma db push`, push schema to db
  - `npx prisma db seed`, seed db

This is a [T3 Stack](https://create.t3.gg/) project bootstrapped with `create-t3-app`.

## What's next? How do I make an app with this?

We try to keep this project as simple as possible, so you can start with just the scaffolding we set up for you, and add additional things later when they become necessary.

If you are not familiar with the different technologies used in this project, please refer to the respective docs. If you still are in the wind, please join our [Discord](https://t3.gg/discord) and ask for help.

- [Next.js](https://nextjs.org)
- [NextAuth.js](https://next-auth.js.org)
- [Prisma](https://prisma.io)
- [Tailwind CSS](https://tailwindcss.com)
- [tRPC](https://trpc.io)

## Learn More

To learn more about the [T3 Stack](https://create.t3.gg/), take a look at the following resources:

- [Documentation](https://create.t3.gg/)
- [Learn the T3 Stack](https://create.t3.gg/en/faq#what-learning-resources-are-currently-available) — Check out these awesome tutorials

You can check out the [create-t3-app GitHub repository](https://github.com/t3-oss/create-t3-app) — your feedback and contributions are welcome!

## How do I deploy this?

Follow our deployment guides for [Vercel](https://create.t3.gg/en/deployment/vercel), [Netlify](https://create.t3.gg/en/deployment/netlify) and [Docker](https://create.t3.gg/en/deployment/docker) for more information.
