# 🤖 ایجنت کدنویسی اهواز (Ahwaz) — نسخه Telegram Serverless (`v2.1.0`)

ایجنت کدنویسی خودمختار و استودیوی گرافیکی **Mini App Code Studio** که به‌صورت ۱۰۰٪ بومی روی زیرساخت **Telegram Serverless** (`@tgcloud/cli`، ایزوله V8 و دیتابیس ابری SQLite) اجرا می‌شود.

[![Version](https://img.shields.io/badge/version-2.1.0-0284c7)](./package.json)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-339933?logo=node.js&logoColor=white)](./package.json)
[![Platform](https://img.shields.io/badge/runtime-Telegram%20Serverless%20V8-26A5E4?logo=telegram&logoColor=white)](https://core.telegram.org/bots/serverless)
[![Telegram Contact](https://img.shields.io/badge/Telegram-%40webxplusx-26A5E4?logo=telegram&logoColor=white)](https://t.me/webxplusx)

> **زبان مستندات**: [English (`README.md`)](./README.md) | **فارسی**

---

## معرفی پروژه

**Ahwaz** یک ایجنت مهندسی نرم‌افزار مجهز به ۱۱ ابزار عملیاتی است که بدون نیاز به سرور مجازی (VPS)، داکر یا دیتابیس خارجی، مستقیماً روی پلتفرم **Telegram Serverless** اجرا می‌شود. فایل‌های پروژه‌ها، تاریخچه مکالمات و تنظیمات سرویس‌ها در دیتابیس **SQLite** ابری تلگرام (`sdk/db`) ذخیره می‌شوند و کاربر می‌تواند هم از طریق چت تلگرام و هم از طریق محیط گرافیکی **Mini App Code Studio** پروژه‌های خود را مدیریت کند.

---

## قابلیت‌های کلیدی

- **پشتیبانی از ۹ سرویس هوش مصنوعی و مدل‌های رایگان (`tgcloud/lib/agent/providers.js`)**:
  - **`opencode` (OpenCode Zen)**: مدل‌های رایگان کدنویسی (`big-pickle`, `deepseek-v4.1-flash-free`, `glm-5.3-flash-free`, `mimo-v2.6-flash-free`, `nemotron-3-ultra-free`, ...) به همراه استعلام زنده لیست مدل‌ها از `GET https://opencode.ai/zen/v1/models`.
  - **`freellmapi` (روتر FreeLLMAPI)**: اتصال به هر سرور روتر `/v1` عمومی با HTTPS (`auto`, `auto:smart`, `auto:fast`) و نمایش هدر `x-routed-via`.
  - **`apifreellm` (`apifreellm.com`)**: اتصال بومی به اندپوینت REST رایگان `POST https://apifreellm.com/api/v1/chat`.
  - **`llm7` و `pollinations` (بدون نیاز به کلید API)**: اجرای فوری کدنویسی بدون ثبت‌نام، همراه با Failover خودکار از `llm7` به `pollinations` در صورت محدودیت نرخ درخواست.
  - **`openrouter` (مدل‌های `:free`)، `groq`، `gemini` (Google AI Studio) و `custom` (هر API سازگار با OpenAI)**.
- **موتور دوگانه اجرای ابزارها (`llm-router.js`)**: پشتیبانی همزمان از Function Calling استاندارد (`tools` / `functionDeclarations`) و سوییچ خودکار به پروتکل `<tool_call>` (ReAct) برای مدل‌های رایگانی که از پارامتر `tools` پشتیبانی نمی‌کنند.
- **۱۱ ابزار واقعی کدنویسی**: ساخت، خواندن، ویرایش، حذف و جستجوی فایل‌ها در SQLite، تست منطق جاوااسکریپت در سندباکس V8 (`verify_javascript`)، ایمپورت و اکسپورت آرشیو `.zip` با پیاده‌سازی خالص PKZIP، و کلون/پوش مستقیم به GitHub.

---

## راه‌اندازی سریع (دسکتاپ، سرور یا اندروید Termux)

> **نکته مهم**: همیشه ابتدا `npm install` را اجرا کنید تا دستور `npx tgcloud` از پکیج رسمی `@tgcloud/cli` داخل پروژه استفاده کند.

### نصب در Termux (اندروید)
```bash
pkg update && pkg upgrade -y
pkg install -y nodejs-lts git

git clone https://github.com/gase99/Ahwaz.git
cd Ahwaz
npm install

npm run build
npm run validate:tgcloud
npm test

# اتصال به ربات با توکن Serverless دریافتی از @BotFather (فرمت app<id>:<secret>)
npx tgcloud login

# استقرار ماژول‌ها و Mini App، ساخت جداول SQLite و همگام‌سازی وبهوک
npm run deploy
npx tgcloud migrate
npx tgcloud webhook sync
```

پس از استقرار:
1. در تلگرام به ربات خود `/start` بدهید (اولین کاربر به‌طور خودکار **Admin** می‌شود).
2. با دستور `/provider llm7` (بدون کلید) یا `/opencode <KEY>` یا `/setkey <KEY>` سرویس هوش مصنوعی را تنظیم کنید.
3. آدرس `Static: https://...` خروجی دستور `npm run deploy` را با `/setminiapp https://...` ثبت کنید تا دکمه **Code Studio (Mini App)** فعال شود.

*(برای جزئیات کامل معماری، جداول پیکربندی، امنیت و عیب‌یابی، فایل انگلیسی [`README.md`](./README.md) را مطالعه کنید.)*

---

## پنل مینی آپ (Code Studio)

در بخش **⚙️ تنظیمات** مینی آپ می‌توانید برای هر کدام از ۹ سرویس هوش مصنوعی کلید API، آدرس سرور و مدل را ثبت کنید و وضعیت فعال بودن هر سرویس را مشاهده کنید (کلیدها ذخیره می‌شوند و هرگز نمایش داده نمی‌شوند). در بخش **📘 راهنما** روش اتصال، دستور مربوطه در ربات (مثل `/setkey gemini YOUR_KEY`) و لینک ثبت‌نام هر ارائه‌دهنده ذکر شده است.

## توسعه‌دهنده و ارتباط

- **Developer & Maintainer**: **Abbas Karoshad** (عباس کروشاد)
- **Telegram**: [@webxplusx](https://t.me/webxplusx)
- **GitHub Repository**: [github.com/gase99/Ahwaz](https://github.com/gase99/Ahwaz)
