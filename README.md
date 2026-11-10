# 🤖 Ahwaz — Telegram Coding Agent (Google Gemini + Telegram Services)

یک **ایجنت برنامه‌نویسی خودکار (Autonomous Coding Agent)** ساخته‌شده با **TypeScript / Node.js**، متصل به **Google Gemini** و طراحی‌شده با معماری لایه‌ای **Telegram Services** با پشتیبانی بومی از **Local Telegram Bot API Server** در Docker.

با این سرویس می‌توانید مستقیماً از داخل تلگرام پروژه بسازید، کدها را ویرایش و دیباگ کنید، تست و دستورات ترمینال اجرا کنید، ریپوزیتوری‌های Git را کلون و مدیریت کنید، فایل یا آرشیو `.zip` بفرستید و خروجی کامل پروژه را تا سقف **۲۰۰۰ مگابایت** در تلگرام تحویل بگیرید.

---

## 🏗 معماری سیستم (Modular Telegram Services Architecture)

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                         Telegram Client (User)                            │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│        Self-Hosted Local Telegram Bot API Server (Docker: :8081)          │
│     • --local mode enabled (Up to 2,000 MB uploads & downloads)           │
│     • Shared zero-copy volume (/var/lib/telegram-bot-api)                 │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │  Polling or Fastify Webhook (:3000)
                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                   Telegram Services Layer (src/services/telegram)         │
│  ├─ bot-api.service.ts      (grammY client + custom apiRoot + migration)  │
│  ├─ transport.service.ts    (Fastify /health + Webhook + Long Polling)    │
│  ├─ auth.middleware.ts      (Allowlist security + Task AbortCoordinator)  │
│  ├─ command.service.ts      (/start /project /files /zip /clone /git ...) │
│  ├─ callback.service.ts     (Interactive Inline Keyboard handlers)        │
│  ├─ message.service.ts      (Background execution + live status tracker)  │
│  ├─ file-ingest.service.ts  (Zero-copy local volume & HTTP ZIP/file load) │
│  └─ delivery.service.ts     (Code-aware Markdown->HTML chunker & sender)  │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                 Autonomous Coding Agent Core (src/agent)                  │
│  ├─ coding-agent.ts         (Multi-step ReAct & Function-Calling loop)    │
│  ├─ gemini-provider.ts      (Official @google/genai SDK — Gemini 2.5/3)   │
│  └─ tools/                                                                │
│      ├─ filesystem.tool.ts  (list_files, read_file, write_file, edit_file,│
│      │                       delete_path, search_code — Path-Jailed!)     │
│      ├─ executor.tool.ts    (run_command — Timeout, Secret-Stripped, Kill)│
│      ├─ git.tool.ts         (init, status, diff, log, clone, commit, push)│
│      └─ archive.tool.ts     (export_project_zip, send_file_to_telegram)   │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## ✨ قابلیت‌های کلیدی

- **معماری ماژولار Telegram Services**: تفکیک کامل لایه ارتباطی تلگرام (`bot-api`, `transport`, `delivery`, `file-ingest`, `commands`, `callbacks`, `messages`, `auth`) از هسته هوش مصنوعی.
- **پشتیبانی بومی از Local Telegram Bot API Server**:
  - اتصال مستقیم به کانتینر `aiogram/telegram-bot-api` از طریق متغیر `TELEGRAM_API_ROOT`.
  - حذف محدودیت ۵۰ مگابایتی تلگرام و ارتقا به **۲۰۰۰ مگابایت** برای ارسال و دریافت پروژه‌های حجیم.
  - **خوانش مستقیم دیسک (Zero-Copy Local Volume)**: در حالت `--local`، فایل‌ها و آرشیوهای `.zip` مستقیماً از Volume مشترک بدون سربار شبکه استخراج می‌شوند.
  - اسکریپت آماده مهاجرت ربات از سرور ابری تلگرام به سرور اختصاصی (`npm run telegram:migrate-local`).
- **ایجنت مهندسی نرم‌افزار کامل با Google Gemini**:
  - ساخت و مدیریت چندین پروژه مجزا برای هر کاربر (`workspaces/<userId>/<projectName>`).
  - خواندن، نوشتن، ویرایش دقیق (`edit_file`) و جستجوی Regex در کدها (`search_code`) با محافظت کامل در برابر Path Traversal و Symlink Escape.
  - اجرای دستورات ساخت و تست (`npm test`, `pytest`, `tsc`, `python3`, ...) در محیط ایزوله بدون دسترسی به متغیرهای محرمانه سرور.
  - عملیات کامل Git (`clone`, `status`, `diff`, `log`, `checkout`, `create_branch`, `commit_all`, `pull`, `push`) با پشتیبانی از `GITHUB_TOKEN`.
- **تجربه کاربری حرفه‌ای در تلگرام**:
  - نمایش **وضعیت زنده (Live Progress)** گام‌های ایجنت و ابزارهای در حال اجرا به همراه دکمه شیشه‌ای **«⏹ توقف اجرای ایجنت»** با لغو آنی (`AbortSignal`).
  - مبدل هوشمند Markdown به HTML تلگرام و تکه‌تکه کردن پاسخ‌های طولانی بدون شکستن بلاک‌های کد (`<pre><code>`).

---

## 🚀 راه‌اندازی سریع با Docker Compose (همراه با Local Telegram Bot API Server)

### ۱. پیش‌نیازها
1. از `@BotFather` در تلگرام یک ربات بسازید و `TELEGRAM_BOT_TOKEN` را بگیرید.
2. وارد [my.telegram.org](https://my.telegram.org) شوید و از بخش **API development tools** مقادیر `TELEGRAM_API_ID` و `TELEGRAM_API_HASH` را دریافت کنید (مخصوص اجرای سرور لوکال تلگرام).
3. کلید `GEMINI_API_KEY` را از [Google AI Studio](https://aistudio.google.com/) دریافت کنید.
4. آیدی عددی اکانت تلگرام خود را (مثلاً از `@userinfobot`) برای قرار دادن در `ALLOWED_TELEGRAM_USER_IDS` بردارید.

### ۲. ساخت فایل تنظیمات `.env`

```bash
cp .env.example .env
```

مقادیر زیر را در `.env` پر کنید:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCDEF...
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef
TELEGRAM_API_ROOT=http://telegram-bot-api:8081
TELEGRAM_LOCAL_MODE=true
TELEGRAM_MODE=polling

ALLOWED_TELEGRAM_USER_IDS=YOUR_TELEGRAM_NUMERIC_ID
GEMINI_API_KEY=AIzaSy...
GEMINI_DEFAULT_MODEL=gemini-2.5-pro
```

### ۳. اجرای کانتینرها روی سرور

```bash
docker compose up -d --build
```

> **نکته مهم هنگام اولین اتصال به Local Telegram Bot API Server:**
> اگر توکن ربات شما قبلاً روی سرور رسمی `api.telegram.org` فعال بوده است، طبق مستندات رسمی تلگرام باید یک‌بار دستور `logOut` روی سرور ابری صدا زده شود تا آپدیت‌ها به سرور لوکال شما هدایت شوند:
> ```bash
> docker compose exec ahwaz-agent npm run telegram:migrate-local:prod
> ```
> (یا در محیط توسعه با `npm run telegram:migrate-local`).

بررسی سلامت سرویس:

```bash
curl http://localhost:3000/health
```

---

## 💻 اجرای مستقیم بدون Docker (Node.js / Systemd)

```bash
npm install
cp .env.example .env
# اگر از سرور رسمی تلگرام استفاده می‌کنید:
# TELEGRAM_API_ROOT=https://api.telegram.org
# TELEGRAM_LOCAL_MODE=false

# حالت توسعه (Development):
npm run dev

# کامپایل و اجرای Production:
npm run build
npm start
```

برای اجرا به عنوان سرویس دائمی لینوکس (`systemd`)، فایل نمونه در مسیر `systemd/ahwaz-telegram-agent.service` قرار داده شده است.

---

## 🌐 اجرای در حالت Webhook

اگر روی سرور خود دامنه و SSL (مثلاً با Nginx / Caddy / Cloudflare) دارید، در فایل `.env` مقادیر زیر را تنظیم کنید:

```env
TELEGRAM_MODE=webhook
SERVER_HOST=0.0.0.0
SERVER_PORT=3000
TELEGRAM_WEBHOOK_URL=https://bot.yourdomain.com
TELEGRAM_WEBHOOK_PATH=/telegram/webhook
TELEGRAM_WEBHOOK_SECRET=a_very_strong_secret_token
```

سرویس Fastify به صورت خودکار Webhook را با هدر امنیتی `X-Telegram-Bot-Api-Secret-Token` روی سرور تلگرام ثبت و اعتبارسنجی می‌کند.

---

## 📱 دستورات ربات در تلگرام

| دستور | کاربرد |
| :--- | :--- |
| `/start` | نمایش داشبورد اصلی، پروژه فعال، مدل Gemini و وضعیت سرور تلگرام |
| `/help` | راهنمای کامل دستورات و نحوه کار با ایجنت |
| `/project <name>` | ساخت یا سوییچ به یک پروژه مجزا (مثلاً `/project shop-api`) |
| `/projects` | نمایش لیست تمام پروژه‌ها با دکمه‌های شیشه‌ای جهت سوییچ سریع |
| `/files [path]` | نمایش ساختار درختی فایل‌ها و پوشه‌های پروژه فعال |
| `/zip` | فشرده‌سازی کل پروژه فعال و ارسال مستقیم فایل `.zip` در تلگرام |
| `/clone <url> [name]` | کلون کردن ریپوزیتوری Git داخل یک پروژه جدید |
| `/git [status\|diff\|log]` | مشاهده سریع وضعیت، تغییرات یا تاریخچه کامیت‌های Git |
| `/run <command>` | اجرای مستقیم دستور شل داخل پوشه پروژه فعال |
| `/model [name]` | انتخاب مدل Gemini از منوی شیشه‌ای یا وارد کردن نام مدل دلخواه |
| `/reset` | پاکسازی حافظه گفتگوی پروژه فعلی (فایل‌های کد حفظ می‌شوند) |
| `/cancel` | توقف فوری اجرای ایجنت و فرآیندهای فرزند در حال اجرا |
| `/status` | گزارش سلامت سرویس، آدرس `apiRoot`، سقف حجم فایل و آمار مصرف |

همچنین می‌توانید هر فایل کد یا آرشیو `.zip` را مستقیماً در چت تلگرام آپلود کنید (با کپشن یا بدون کپشن) تا در پروژه فعال اکسترکت و توسط ایجنت تحلیل یا ویرایش شود.

---

## 🧪 تست و بررسی کیفیت کد

```bash
# اجرای مجموعه تست‌های واحد و یکپارچه (Vitest)
npm test

# بررسی تایپ‌های TypeScript
npm run typecheck

# بیلد نسخه نهایی در پوشه dist/
npm run build
```

---

## 📂 ساختار پوشه‌های پروژه

```text
Ahwaz/
├── docker-compose.yml               # استک کامل: Local Telegram Bot API Server + Ahwaz Agent
├── Dockerfile                       # ایمیج چندمرحله‌ای Node 22 به همراه Git، Python3 و Bash
├── systemd/                         # فایل سرویس لینوکس (systemd)
├── .env.example                     # الگوی کامل متغیرهای محیطی
├── src/
│   ├── index.ts                     # نقطه ورود و مدیریت Graceful Shutdown
│   ├── config/                      # اعتبارسنجی تنظیمات با Zod و لاگر ساخت‌یافته Pino
│   ├── types/                       # تایپ‌های ایجنت، ابزارها و نشست کاربران
│   ├── agent/                       # هسته Coding Agent، اتصال به Gemini و رجیستری ابزارها
│   │   └── tools/                   # ابزارهای Filesystem، Shell Executor، Git و ZIP Archive
│   ├── services/
│   │   ├── workspace.service.ts     # مدیریت ایزوله پروژه‌ها، حفاظت مسیر و ZIP
│   │   ├── session.service.ts       # مدیریت نشست، مدل انتخابی و حافظه گفتگو
│   │   └── telegram/                # لایه ماژولار Telegram Services
│   └── scripts/
│       └── migrate-to-local-api.ts  # ابزار انتقال توکن ربات به Local Bot API Server
└── tests/                           # تست‌های کامل Workspace، ابزارها، مبدل HTML، ایجنت و Webhook
```
