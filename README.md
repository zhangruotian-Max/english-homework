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
2. 复制这个用户的 UUID，并为其设置一个 3 至 30 位的唯一用户名，只能使用英文字母、数字、点、下划线或连字符。用户名可以包含大写字母，但不区分大小写（例如 `FFT_lg2` 与 `fft_lg2` 视为同一个用户名）。
3. 在 SQL Editor 中将 UUID 和用户名写入映射表，并分配角色。初次设置建议分配 `level3`，这个账号即可执行所有管理操作：

```sql
insert into public.login_usernames (user_id, username) values
  ('替换为管理员用户UUID', 'teacher');

insert into public.admin_roles (user_id, role, display_name) values
  ('替换为管理员用户UUID', 'level3', '王老师');
```

网站登录时只输入用户名和密码。Supabase Authentication 创建账号时仍需邮箱作为账号内部标识；邮箱不会显示在网站登录页面。用户名映射表仅由服务端 Edge Function 读取，不对网页访客开放。

`display_name` 就是登录后右上角显示的名字；以后添加其他管理员时，也可以为他们填写各自的名字。管理员可以点右上角的名字自行修改；这只更改显示名称，不会授予管理员权限。也可在 SQL Editor 更改已有管理员的名字：

```sql
update public.admin_roles
set display_name = '王老师'
where user_id = '替换为管理员用户UUID';
```

每次 `schema.sql` 有更新时（包括已部署过的项目），请在 Supabase **SQL Editor** 再次运行更新后的完整 `supabase/schema.sql`，以应用显示名相关函数和权限检查。角色权限：`level1` 可记录和撤销；`level2` 另可添加同学（包括批量添加）；`level3` 另可移除同学、修改姓名。管理员登录后可见独立的“管理操作”页，普通只读账号不会看到该页面；管理员可在该页执行单人或批量记录、撤销，三级管理员可批量移除。批量记录、撤销、添加、移除最多每批 100 位，任一条目不符合权限或数据限制时整批事务回滚。记录变更只通过记录/撤销审计操作执行，不直接改写次数。显示名不会授予管理权限；权限仍由 `role` 单独决定。只有拥有数据库管理权限的人才能分配角色。

## 3. 设置用户名登录服务

用户名登录需要 Supabase Edge Function 将用户名安全地映射到 Supabase Auth 账号。GitHub Pages 不会部署这个函数，需在 Supabase 项目中单独部署一次：

1. 在 Supabase **SQL Editor** 运行最新版完整的 [`supabase/schema.sql`](./supabase/schema.sql)，创建私有用户名映射表。已运行过旧版本的项目也需要重跑。
2. 打开 Supabase **Edge Functions**，创建名为 `username-login` 的函数，将 [`supabase/functions/username-login/index.ts`](./supabase/functions/username-login/index.ts) 的内容粘贴并部署。
3. 在该函数的设置中关闭 **Verify JWT**，因为登录用户尚未有 JWT。函数只允许本网站来源，并且只返回登录令牌。
4. Supabase 会自动向 Edge Function 提供 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEYS` 和 `SUPABASE_SECRET_KEYS`。新版密钥变量通常以 JSON 对象形式提供，函数会读取其中的 `default` key。旧的 `SUPABASE_ANON_KEY` 和 `SUPABASE_SERVICE_ROLE_KEY` 若显示 **Deprecated（弃用）**，不用手动添加或复制；函数优先使用新版变量，并兼容旧变量。

**绝不要**将 secret / `service_role` key 放入 `config.js`、网页代码或 GitHub 仓库，也不要把以 `SUPABASE_` 开头的内置变量添加为自定义 Secret；它们由 Supabase 管理。每个 Auth 用户都要在 `login_usernames` 表中有一条用户名映射，否则无法用用户名登录。

## 4. 创建只读查看账号

1. 在 Supabase **Authentication → Users** 创建一个普通登录账号。
2. 复制用户 UUID，在 SQL Editor 中设置唯一用户名并授予名单查看权限：

```sql
insert into public.login_usernames (user_id, username)
values ('替换为查看账号用户UUID', 'viewer1');

insert into public.class_viewers (user_id)
values ('替换为查看账号用户UUID');
```

这个账号可登录查看名单和统计，但不能添加、记录、撤销或移除学生。获准的只读账号也可以点页面右上角的“只读查看”自定义自己的显示名称；尚未获准的账号不能查看名单，也不能使用页面修改显示名称。显示名称只保存在该账号的资料中，不会授予任何管理权限。若要让多人查看，可以使用学校认可的共享查看账号，或分别创建用户并逐个加入 `class_viewers`。

以后新增账号时，仍在 **Authentication → Users** 创建账号，然后在 `login_usernames` 中给它分配一个尚未使用的用户名，并按需加入 `admin_roles` 或 `class_viewers`。Supabase Auth 创建账号仍需邮箱；网站登录只需用户名和密码。

## 5. 导入学生名单

已根据本机的 `students.md` 生成本地文件 `supabase/import_students.sql`。打开该文件，将 SQL 内容粘贴至 Supabase 项目的 **SQL Editor** 并执行，即可导入名单；重复执行会跳过已存在的同名学生。名单只保存在 Supabase，初始记录次数为 0。`students.md` 和导入脚本都已加入 `.gitignore`，不要强行添加或提交到 GitHub。

## 6. 发布到 GitHub Pages

1. 把本文件夹的文件推送到 GitHub 仓库的 `main` 分支（根目录需包含 `index.html`）。
2. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 等待仓库 **Actions** 页里的 “Deploy to GitHub Pages” 工作流完成。
4. 在 **Settings → Pages** 中打开 GitHub Pages 网址，即可在学校电脑访问。

推送配置前请先填写 `config.js`。项目 URL 和 publishable/anon key 属于浏览器公开配置；不要把任何数据库密码、service role key 或 Supabase secret key 加入仓库。

## 7. 使用和隐私

- GitHub Pages 公开提供网页文件，但名单和统计必须登录获准账号后才能读取。
- `students.md` 和生成的 `supabase/import_students.sql` 已加入本地 `.gitignore`，不会被 Git 推送。不要复制学生姓名到代码、公开仓库或工单。
- 登录页面要求密码至少 6 位；Supabase 项目中的密码长度策略也需要允许至少 6 位，否则服务端仍会拒绝密码。
- 登录页面使用用户名；Supabase Auth 邮箱仍用于创建和管理账号，但不会显示在网页登录界面。
- 管理员从页面右上角登录。登录用户必须已在 `admin_roles` 中分配角色，否则仍然只有只读权限。
- 未登录或未经授权的账号会停留在登录界面，验证通过后才能进入工作台；点击退出登录后需要再次确认。
- 已获准的只读账号可以点击右上角名称设置自己的显示名称；此设置不改变账号权限。
- 写入操作由 Supabase 数据库事务执行，记录最多 6 次；撤销会留下审计记录。排行榜会自动定时刷新云端数据。
- 旧版本保存在当前浏览器的演示数据不会自动导入 Supabase。
- GitHub Pages 托管网页，Supabase 托管数据；不需要另租一台服务器或在学校电脑安装东西。
