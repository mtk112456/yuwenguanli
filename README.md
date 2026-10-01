# 班级成长助教 · 教师端（独立教师管理 App）

- 包名：`tech.qneng.teacher`（与学生端 `myapp.qiwubanyuwenlianghuakaohe` 并存，互不覆盖）
- 壳层：Capacitor 8，默认加载 `https://qi.qnengs.tech/admin/teacher/index.php`（教师专用界面，HTTPS）
- 界面源码：`D:\DeskBox\班级量化考核系统\班级量化考核管理系统网页前后端\admin\teacher\`（随主站实时同步上线）
- 构建方式：**GitHub Actions**（push 到 main 自动构建；或 Actions 页手动 workflow_dispatch），产物在 Artifacts：`班级成长助教-教师端-Release`
- 签名：仓库 Secrets（`ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD`），密钥为 `D:\DeskBox\班级量化考核系统\签名密钥备份\yuwen-release.p12`（PKCS12，alias `yuwen`，密码在同目录 keystore-password.txt）

## 版本策略

- `android/app/build.gradle` 的 `versionCode` / `versionName` 独立于学生端递增；发布前同步更新
- 学生端与教师端 APK 分开发布，教师 APK 只在教师端更新通道（`uploads/teacher_app.apk`）分发，**绝不推给学生**

## 本地开发

```
npm install
npx cap add android   # 已添加过则跳过
npx cap sync          # 改了 capacitor.config.json / www 后执行
```

本地无需 Android SDK（CI 出包）。改动网页层请直接编辑主站源码 `admin/teacher/`（保存即上线，改前备份）。
