# 🤖 Ahwaz — ایجنت برنامه‌نویسی بومی روی Telegram Serverless (`tgcloud`)

یک **ایجنت برنامه‌نویسی خودکار (Autonomous Coding Agent) + محیط توسعه وب Mini App** ساخته‌شده **۱۰۰٪ بومی برای پلتفرم ابری جدید تلگرام ([Telegram Serverless](https://core.telegram.org/bots/serverless))** و متصل به **Google Gemini**.

بدون نیاز به خرید هیچ سرور مجازی (VPS)، بدون نیاز به Docker و بدون نیاز به دیتابیس خارجی؛ کل بک‌اند ایجنت، دیتابیس **SQLite**، فضای کاری فایل‌ها (Virtual Workspace) و **Mini App Code Studio** مستقیماً روی زیرساخت ابری خود تلگرام (`V8 Isolate` + `@tgcloud/cli`) اجرا می‌شوند!

---

## 🏗 معماری بومی روی Telegram Serverless (`tgcloud/`)

طبق استاندارد رسمی [core.telegram.org/bots/serverless](https://core.telegram.org/bots/serverless)، تمام ماژول‌های اجرایی در پوشه `tgcloud/` با **JavaScript خالص ES Modules** و بدون وابستگی به پکیج‌های خارجی نوشته شده‌اند:

```text
Ahwaz/
├── tgcloud.jsonc                        # پیکربندی رسمی tgcloud و میزبانی Mini App
├── AGENTS.md                            # راهنمای ساختار پروژه برای ابزارهای هوش مصنوعی
├── docs/tgcloud-sdk.md                  # مستندات کامل SDK پلتفرم (db, api, fetch, InputFile)
├── tgcloud/                             # ⚡ اجرا در V8 Isolate ابری خود تلگرام
│   ├── schema.js                        # جداول SQLite داخلی تلگرام (users, botSettings, projects, workspaceFiles, chatHistories)
│   ├── handlers/                        # هندلرهای رویداد تلگرام (سطح اول)
│   │   ├── message.js                   # پردازش دستورات، پرامپت‌های کدنویسی و آپلود فایل/ZIP
│   │   └── callback_query.js            # پردازش دکمه‌های شیشه‌ای (Inline Keyboards)
│   ├── endpoints/                       # اندپوینت‌های سرورلس Mini App با احراز هویت تلگرام
│   │   ├── studio.js                    # مدیریت پروژه‌ها، ویرایشگر فایل و تنظیمات از داخل Mini App
│   │   └── agent.js                     # اجرای مستقیم ایجنت کدنویسی از داخل Mini App
│   └── lib/                             # لایه ماژولار Telegram Services و هسته ایجنت
│       ├── services/
│       │   ├── auth-service.js          # ادمین شدن خودکار اولین کاربر، لیست مجاز و مدیریت امن کلیدها در SQLite
│       │   ├── workspace-service.js     # فایل‌سیستم مجازی چندپروژه‌ای روی SQLite داخلی تلگرام
│       │   ├── conversation-service.js  # حافظه مکالمه مجزا برای هر پروژه در SQLite
│       │   ├── zip-service.js           # ساخت و استخراج آرشیو .zip با جاوااسکریپت خالص (Uint8Array / CRC32)
│       │   ├── github-service.js        # ایمپورت و Push مستقیم ریپوزیتوری‌های GitHub با sdk fetch
│       │   ├── delivery-service.js      # مبدل Markdown به HTML تلگرام، وضعیت زنده و ارسال InputFile
│       │   ├── keyboard-service.js      # منوهای شیشه‌ای و دکمه باز کردن Mini App
│       │   └── command-service.js       # مدیریت کامل دستورات اسلش (/start, /setkey, /project, ...)
│       └── agent/
│           ├── coding-agent.js          # حلقه چندمرحله‌ای Function-Calling با وضعیت زنده در چت
│           ├── gemini-service.js        # کلاینت مستقیم Google Gemini REST API با حفظ thoughtSignature
│           ├── js-sandbox.js            # سندباکس V8 برای تست و راستی‌آزمایی منطق کدهای JavaScript
│           ├── tools.js                 # ۱۱ ابزار مهندسی نرم‌افزار برای ساخت، ویرایش، جستجو، تست، GitHub و ZIP
│           └── system-prompt.js         # پرامپت سیستمی مهندس ارشد نرم‌افزار (پشتیبانی کامل فارسی و انگلیسی)
└── miniapp/ & miniapp-dist/             # 🖥 محیط گرافیکی Ahwaz Code Studio روی دامنه tgcloud.ai
```

---

## ✨ امکانات ایجنت روی سرور تلگرام

1. **صفر سرور، صفر نگهداری**: اجرا روی V8 Isolate اختصاصی تلگرام کنار Bot API با تأخیر نزدیک به صفر.
2. **فضای کاری چندپروژه‌ای در SQLite داخلی تلگرام**:
   - ساخت پروژه‌های مجزا (`/project shop-api`)، نوشتن، خواندن، ویرایش دقیق (`edit_file`) و جستجوی Regex در کدها (`search_code`).
3. **ارسال و دریافت واقعی فایل و آرشیو `.zip`**:
   - موتور ZIP خالص V8 بدون هیچ پکیج npm؛ آپلود فایل یا `.zip` در چت تلگرام با `api.getFileContent` اکسترکت شده و خروجی پروژه با `InputFile` به صورت فایل `.zip` تحویل داده می‌شود.
4. **اتصال مستقیم به GitHub (بدون نیاز به باینری git)**:
   - ایمپورت کامل درخت فایل‌های هر ریپوزیتوری GitHub به داخل پروژه (`/importgh owner/repo`) و کامیت/Push مستقیم تغییرات از داخل تلگرام به GitHub (`/pushgh owner/repo main`).
5. **تست خودکار کد جاوااسکریپت در سندباکس V8 (`verify_javascript`)**:
   - ایجنت قبل از تحویل کد می‌تواند توابع و الگوریتم‌های JS را با `assert` در سندباکس تست کند.
6. **همراه با Mini App اختصاصی (Ahwaz Code Studio)**:
   - میزبانی خودکار روی `https://app<id>.tgcloud.ai/` برای مرور فایل‌ها، ویرایش کد، تغییر پروژه، ثبت کلید Gemini/GitHub و چت با ایجنت در محیط گرافیکی داخل تلگرام!
7. **امنیت کلیدها بدون `.env`**:
   - اولین نفری که `/start` بزند به صورت خودکار **Admin** می‌شود. با ارسال `/setkey AIzaSy...` پیام حاوی کلید **فوراً از صفحه چت حذف شده** و در دیتابیس خصوصی SQLite ربات ذخیره می‌گردد.

---

## 🚀 آموزش گام‌به‌گام دیپلوی روی سرور تلگرام (`tgcloud`)

### گام ۱: فعال‌سازی Serverless در BotFather
1. در تلگرام وارد `@BotFather` شوید و ربات خود را انتخاب کنید.
2. به مسیر **Settings** ← **Serverless** بروید و سوییچ آن را روشن کنید.
3. وارد بخش **CLI Access** شوید و **Access token** (با فرمت `app123456:...`) را کپی کنید.
   > ⚠️ توجه: این توکن مخصوص `tgcloud` است و با توکن معمولی HTTP ربات تفاوت دارد.

### گام ۲: لینک کردن پروژه و دیپلوی روی کلود تلگرام

در پوشه این ریپوزیتوری دستورات زیر را اجرا کنید:

```bash
# ۱. نصب ابزار رسمی @tgcloud/cli (فقط برای دیپلوی از سیستم شما)
npm install

# ۲. اتصال پروژه به ربات تلگرام (توکن CLI Access را وارد کنید)
npx tgcloud login
# نکته: در محیط‌های غیرتعاملی یا CI می‌توانید به جای login متغیر TGCLOUD_TOKEN=app123:... را ست کنید.

# ۳. بیلد Mini App و دیپلوی کل ماژول‌های tgcloud/ روی سرور تلگرام
npm run deploy

# ۴. ساخت جداول دیتابیس SQLite روی سرور تلگرام (تأیید مایگریشن)
npx tgcloud migrate
```

پس از اجرای `npm run deploy`، ابزار `tgcloud` آدرس Mini App شما (مانند `https://app12345.tgcloud.ai/`) را نیز چاپ می‌کند.

### گام ۳: راه‌اندازی اولیه داخل تلگرام (در ۱۰ ثانیه!)

1. ربات خود را در تلگرام باز کنید و `/start` بزنید (شما به عنوان اولین کاربر، به طور خودکار **Admin** ربات می‌شوید).
2. کلید Google Gemini خود (دریافتی از [Google AI Studio](https://aistudio.google.com/)) را بفرستید:
   ```text
   /setkey AIzaSyYourGeminiApiKeyHere
   ```
   *(ربات بلافاصله پیام شما را برای امنیت پاک می‌کند و کلید را در SQLite ذخیره می‌نماید.)*
3. *(اختیاری)* اگر می‌خواهید دکمه شیشه‌ای **Code Studio Mini App** در منوی `/start` نمایش داده شود، آدرس چاپ‌شده در ترمینال را ثبت کنید:
   ```text
   /setminiapp https://app12345.tgcloud.ai
   ```
4. تمام! حالا هر پروژه‌ای می‌خواهید به فارسی بنویسید (مثلاً: *«یک سرویس مدیریت لینک کوتاه با ساختار ماژولار و تست بنویس و فایل زیپش رو برام بفرست»*).

---

## 📱 لیست کامل دستورات ربات در تلگرام

| دستور | توضیح |
| :--- | :--- |
| `/start` | داشبورد اصلی، وضعیت کلید Gemini، پروژه فعال و دکمه Code Studio |
| `/help` | راهنمای کامل دستورات و امکانات |
| `/setkey <AIza...>` | ذخیره امن کلید Google Gemini در SQLite (با حذف خودکار پیام از چت) |
| `/setgithub <ghp_...>` | ذخیره امن توکن GitHub برای Push و ریپوهای خصوصی |
| `/setminiapp <url>` | تنظیم آدرس Mini App جهت نمایش دکمه استودیو کد |
| `/allow <tg_id>` | مجاز کردن کاربر جدید برای استفاده از ایجنت (ویژه ادمین) |
| `/disallow <tg_id>` | لغو دسترسی یک کاربر (ویژه ادمین) |
| `/project <name>` | ساخت یا سوییچ به یک پروژه مجزا در دیتابیس |
| `/projects` | منوی شیشه‌ای لیست تمام پروژه‌ها و تعداد فایل‌ها |
| `/files [subpath]` | نمایش لیست فایل‌های موجود در پروژه فعال |
| `/read <file_path>` | نمایش محتوای کد یک فایل با سینتکس هایلایت |
| `/zip` | ساخت در لحظه آرشیو `.zip` از کل پروژه و ارسال در تلگرام |
| `/importgh <owner/repo> [branch]` | ایمپورت مستقیم کدهای ریپوزیتوری از GitHub به داخل پروژه فعال |
| `/pushgh <owner/repo> [branch]` | کامیت و Push تمام فایل‌های پروژه فعال روی شاخه GitHub |
| `/model [name]` | تغییر مدل هوش مصنوعی (`gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash`) |
| `/reset` | پاکسازی تاریخچه گفتگوی پروژه فعلی بدون حذف فایل‌ها |
| `/status` | مشاهده وضعیت زیرساخت Serverless، تعداد فایل‌ها و آمار ابزارها |

---

## 🛠 دستورات مفید توسعه و تست لوکال

```bash
# بررسی وضعیت فایل‌های محلی نسبت به کلود تلگرام
npm run status

# اعتبارسنجی قوانین سخت‌گیرانه V8 Isolate و ایمپورت‌های tgcloud/
npm run validate:tgcloud

# اجرای تست‌های خودکار (Vitest + شبیه‌ساز کامل sdk و SQLite)
npm test
```
