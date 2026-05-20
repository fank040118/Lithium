# 隐私政策 / Privacy Policy

**最后更新 / Last updated：2026-05-16**

---

## 中文

Lithium（Custom Start Page）是一个开源浏览器扩展。本政策说明扩展收集、使用、保护数据的方式。

### 收集哪些数据

**仅在你启用云同步并注册账号时**，扩展会收集：

- **邮箱地址**：作为账号唯一标识与登录凭证
- **密码**：以加密哈希形式存储于 Google Firebase Authentication，作者**无法看到原始密码**
- **扩展配置**：快捷方式、自定义时钟、自定义搜索引擎、网格布局参数

未启用云同步时，**所有数据仅保存在浏览器本地**（`chrome.storage.local` / `browser.storage.local`），不会上传任何服务器，作者也无法接触。

### 数据存储位置

云端数据托管在 **Google Firebase**（Firestore + Firebase Authentication），位于 Google 的全球基础设施上，遵循 [Google 隐私政策](https://policies.google.com/privacy)。

### 谁能访问你的数据

云端数据按 Firebase user ID 严格隔离。技术层面：

- 仅持有你账号密码者能登录并读写**你自己**的数据
- 作者**没有管理员权限**访问任何用户的数据内容
- 数据访问由 Firestore Security Rules 强制隔离（仅 `uid` 匹配且邮箱已验证才能读写）

### 第三方服务

- **Google Firebase**（Authentication + Firestore）：用于账号管理和云同步。**仅在启用云同步并登录后**接触。Google Firebase 的隐私实践：https://firebase.google.com/support/privacy
- **Favicon 抓取**：扩展会为你保存的每个快捷方式获取站点图标，优先使用浏览器原生 favicon API（仅 Chrome 支持，无网络外发）。在 Firefox 上、或原生 API 失败时，会**回退**到以下第三方图标服务：
  - `https://www.google.com/s2/favicons`（Google）
  - `https://icon.horse`（第三方独立服务）
  - 这意味着这些服务可以看到你快捷方式的**域名列表**（不会看到具体路径、查询参数或访问频率）。图标会被本地缓存以减少重复请求（缓存键见 `iconCache.js` 中的 `ICON_CACHE_KEY`）。
- 除上述外**不集成任何广告、分析或追踪服务**（无 Google Analytics、无 Sentry、无任何打点）。

### 邮件用途

注册邮箱仅用于：

- 登录凭证
- 邮箱验证邮件（由 Firebase 自动发送）
- 必要的账号相关操作（如密码重置邮件，由 Firebase 发送）

**永远不会**发送营销、广告、推送或任何第三方邮件。

### 你的权利

- **随时退出登录**：本地保留数据，云端数据保留
- **自助删除账号与全部云端数据**：登录后在扩展的「云同步」面板点击「删除账户」按钮，确认后立即生效（不可撤销）
- **如自助删除遇到问题**：可通过下方联系方式联系作者协助
- **卸载扩展**：本地数据随之删除，云端数据保留（如需删除云端数据请使用上述自助按钮或联系作者）

### 数据保留

收到删除请求后 30 天内永久删除所有相关数据。

### 项目性质声明

本扩展为**个人经验展示项目**。云同步服务由作者个人 Firebase 项目托管，受免费额度限制，**不提供任何 SLA 保证**。服务可能随时调整、限流或停止。强烈建议你定期使用扩展的本地导出功能备份数据。

### 联系方式

涉及隐私问题、数据删除请求：

- 提交 GitHub Issue：https://github.com/fank040118/Lithium/issues
- 或通过 GitHub Profile：https://github.com/fank040118

---

## English

Lithium (Custom Start Page) is an open-source browser extension. This policy describes how data is collected, used, and protected.

### Data Collected

**Only if you enable cloud sync and create an account**, the extension collects:

- **Email address**: as your account identifier and login credential
- **Password**: stored as a salted hash by Google Firebase Authentication; the author **cannot see your raw password**
- **Extension configuration**: shortcuts, custom clocks, custom search engines, grid layout parameters

Without cloud sync enabled, **all data stays in your browser's local storage** and is never sent to any server.

### Where Data Is Stored

Cloud data is hosted on **Google Firebase** (Firestore + Firebase Authentication), subject to [Google's Privacy Policy](https://policies.google.com/privacy).

### Data Access

Data is isolated per Firebase user ID via Firestore Security Rules (only requests where `uid` matches and email is verified can read/write). The author has **no administrative access** to any user's data content.

### Third-Party Services

- **Google Firebase** (Authentication + Firestore): account management and cloud sync. **Only contacted when you enable cloud sync and sign in.** Firebase privacy practices: https://firebase.google.com/support/privacy
- **Favicon fetching**: for each shortcut you save, the extension fetches the site's favicon. The browser's native favicon API is preferred (Chrome only, no outbound network). On Firefox, or when the native API fails, the extension **falls back** to these third-party services:
  - `https://www.google.com/s2/favicons` (Google)
  - `https://icon.horse` (independent third party)
  - These services can therefore see the **domain list** of your shortcuts (but not paths, query strings, or visit frequency). Icons are cached locally to minimize repeat requests (cache key: `ICON_CACHE_KEY` in `iconCache.js`).
- Beyond the above, **no advertising, analytics, or tracking services** are integrated.

### Email Usage

Your registered email is used only for:

- Login credential
- Email verification (sent by Firebase)
- Account-related operations such as password reset (sent by Firebase)

**No marketing, advertising, or third-party emails will ever be sent.**

### Your Rights

- Sign out anytime (local data retained, cloud data retained)
- **Self-service account deletion**: while signed in, open the cloud-sync panel in the extension and click "Delete Account". This permanently removes your Firebase account and all cloud data (irreversible)
- If self-service deletion fails, contact the author via the channels below
- Uninstall the extension (local data removed; cloud data retained — use the in-app delete button or contact the author to remove cloud data)

### Data Retention

All related data will be permanently deleted within 30 days of a deletion request.

### Project Nature

This is a **personal showcase project**. Cloud sync is hosted on the author's personal Firebase project under free-tier quotas, with **no SLA guarantees**. Service may be modified, throttled, or terminated at any time. You are strongly encouraged to use the extension's local export feature to back up your data.

### Contact

For privacy concerns or data deletion requests:

- Open a GitHub Issue: https://github.com/fank040118/Lithium/issues
- Or via GitHub Profile: https://github.com/fank040118
