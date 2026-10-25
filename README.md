# 作业有迹

静态网页部署在 GitHub Pages，学生名单和作业记录保存在 Supabase。名单和记录仅对获准的登录账号开放；访客账号只读，管理员修改权限由数据库函数检查。

## 1. 创建 Supabase 数据库

1. 在 Supabase 创建一个项目，并打开 **SQL Editor → New query**。
2. 将 [`supabase/schema.sql`](./supabase/schema.sql) 的全部内容粘贴并运行。
3. 在项目的 **Connect** 对话框或 **Project Settings → API Keys** 中复制 Project URL 和 **publishable key**（`sb_publishable_...`；旧项目也可使用 `anon` key）。
4. 编辑根目录的 `config.js`，填入这两项。可同时设置 `adminDisplayName`，自定义登录后右上角显示的名称，例如 `"王老师"`。浏览器端只使用 publishable/anon key；**绝不要**使用 `service_role` 或 secret key。

publishable/anon key 本来就会公开给网页访客，安全边界是上面的数据库 RLS 策略和权限函数，不是隐藏这个 key。

## 2. 创建管理员账号

1. 在 Supabase **Authentication → Sign In / Providers** 中关闭新用户注册，再到 **Authentication → Users** 创建一个管理员用户。只需要一个管理员时，用你自己的邮箱创建一个账号即可，不需要准备多组邮箱。
2. 复制这个用户的 UUID。
3. 在 SQL Editor 中按下方语句分配角色，将 UUID 换成实际用户 ID。初次设置建议分配 `level3`，这个账号即可执行所有管理操作：

```sql
insert into public.admin_roles (user_id, role, display_name) values
  ('替换为管理员用户UUID', 'level3', '王老师');
```

`display_name` 就是登录后右上角显示的名字；以后添加其他管理员时，也可以为他们填写各自的名字。管理员可以点右上角的名字自行修改；这只更改显示名称，不会授予管理员权限。也可在 SQL Editor 更改已有管理员的名字：

```sql
update public.admin_roles
set display_name = '王老师'
where user_id = '替换为管理员用户UUID';
```

若数据库已运行过旧版 `schema.sql`，请在 Supabase **SQL Editor** 再次运行更新后的完整 `supabase/schema.sql`，以添加显示名字段和相关函数。角色权限：`level1` 可记录和撤销；`level2` 另可添加同学；`level3` 另可移除同学。显示名不会授予管理权限；权限仍由 `role` 单独决定。只有拥有数据库管理权限的人才能分配角色。

## 3. 创建只读查看账号

1. 在 Supabase **Authentication → Users** 创建一个普通登录账号。
2. 复制用户 UUID，并在 SQL Editor 授予名单查看权限：

```sql
insert into public.class_viewers (user_id)
values ('替换为查看账号用户UUID');
```

这个账号可登录查看名单和统计，但不能添加、记录、撤销或移除学生。尚未获准的账号不能读取名单。若要让多人查看，可以使用学校认可的共享查看账号，或分别创建用户并逐个加入 `class_viewers`。

## 4. 导入学生名单

已根据本机的 `students.md` 生成本地文件 `supabase/import_students.sql`。打开该文件，将 SQL 内容粘贴至 Supabase 项目的 **SQL Editor** 并执行，即可导入名单；重复执行会跳过已存在的同名学生。名单只保存在 Supabase，初始记录次数为 0。`students.md` 和导入脚本都已加入 `.gitignore`，不要强行添加或提交到 GitHub。

## 5. 发布到 GitHub Pages

1. 把本文件夹的文件推送到 GitHub 仓库的 `main` 分支（根目录需包含 `index.html`）。
2. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 等待仓库 **Actions** 页里的 “Deploy to GitHub Pages” 工作流完成。
4. 在 **Settings → Pages** 中打开 GitHub Pages 网址，即可在学校电脑访问。

推送配置前请先填写 `config.js`。项目 URL 和 publishable/anon key 属于浏览器公开配置；不要把任何数据库密码、service role key 或 Supabase secret key 加入仓库。

## 6. 使用和隐私

- GitHub Pages 公开提供网页文件，但名单和统计必须登录获准账号后才能读取。
- `students.md` 和生成的 `supabase/import_students.sql` 已加入本地 `.gitignore`，不会被 Git 推送。不要复制学生姓名到代码、公开仓库或工单。
- 管理员从页面右上角登录。登录用户必须已在 `admin_roles` 中分配角色，否则仍然只有只读权限。
- 写入操作由 Supabase 数据库事务执行，记录最多 6 次；撤销会留下审计记录。排行榜会自动定时刷新云端数据。
- 旧版本保存在当前浏览器的演示数据不会自动导入 Supabase。
- GitHub Pages 托管网页，Supabase 托管数据；不需要另租一台服务器或在学校电脑安装东西。
