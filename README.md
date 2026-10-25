# 作业有迹

静态网页部署在 GitHub Pages，学生名单和作业记录保存在 Supabase。网页允许任何访客只读查看；管理员账号经过 Supabase Auth 登录，修改权限由数据库函数检查。

## 1. 创建 Supabase 数据库

1. 在 Supabase 创建一个项目，并打开 **SQL Editor → New query**。
2. 将 [`supabase/schema.sql`](./supabase/schema.sql) 的全部内容粘贴并运行。
3. 在项目的 **Connect** 对话框或 **Project Settings → API Keys** 中复制 Project URL 和 **publishable key**（`sb_publishable_...`；旧项目也可使用 `anon` key）。
4. 编辑根目录的 `config.js`，填入这两项。浏览器端只使用 publishable/anon key；**绝不要**使用 `service_role` 或 secret key。

publishable/anon key 本来就会公开给网页访客，安全边界是上面的数据库 RLS 策略和权限函数，不是隐藏这个 key。

## 2. 创建管理员账号

1. 在 Supabase **Authentication → Sign In / Providers** 中关闭新用户注册，再到 **Authentication → Users** 创建一个管理员用户。只需要一个管理员时，用你自己的邮箱创建一个账号即可，不需要准备多组邮箱。
2. 复制这个用户的 UUID。
3. 在 SQL Editor 中按下方语句分配角色，将 UUID 换成实际用户 ID。初次设置建议分配 `level3`，这个账号即可执行所有管理操作：

```sql
insert into public.admin_roles (user_id, role) values
  ('替换为管理员用户UUID', 'level3');
```

角色权限：`level1` 可记录和撤销；`level2` 另可添加同学；`level3` 另可移除同学。只有需要不同人员各自拥有账号时，才需要为他们分别创建账号并分配角色。只有拥有数据库管理权限的人才能分配角色。

## 3. 发布到 GitHub Pages

1. 把本文件夹的文件推送到 GitHub 仓库的 `main` 分支（根目录需包含 `index.html`）。
2. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 等待仓库 **Actions** 页里的 “Deploy to GitHub Pages” 工作流完成。
4. 在 **Settings → Pages** 中打开 GitHub Pages 网址，即可在学校电脑访问。

推送配置前请先填写 `config.js`。项目 URL 和 publishable/anon key 属于浏览器公开配置；不要把任何数据库密码、service role key 或 Supabase secret key 加入仓库。

## 4. 使用和隐私

- 所有人都可以读取名单、排行榜和等级统计。这个网站是公开只读的，不适合放置不应公开的学生信息；若要限制学校外的访问，应改用需要登录的访问方案。
- 管理员从页面右上角登录。登录用户必须已在 `admin_roles` 中分配角色，否则仍然只有只读权限。
- 写入操作由 Supabase 数据库事务执行，记录最多 6 次；撤销会留下审计记录。排行榜会自动定时刷新云端数据。
- 旧版本保存在当前浏览器的演示数据不会自动导入 Supabase。
- GitHub Pages 托管网页，Supabase 托管数据；不需要另租一台服务器或在学校电脑安装东西。
