# 🤖 ایجنت کدنویسی اهواز — نسخه Telegram Serverless (`v2.1.0`)

یک **ایجنت کدنویسی خودمختار (Autonomous Coding Agent)** به همراه **استودیوی کدنویسی گرافیکی (Telegram Mini App Code Studio)** که ۱۰۰٪ بومی برای پلتفرم **Telegram Serverless** (`https://core.telegram.org/bots/serverless` / `@tgcloud/cli`) طراحی شده و از **مدل‌های رایگان OpenCode Zen**، **روتر FreeLLMAPI**، **ApiFreeLLM.com**، **سرویس‌های رایگان بدون کلید (LLM7 & Pollinations)**، **OpenRouter `:free`**، **Groq** و **Google Gemini** پشتیبانی می‌کند.

---

## ✨ ویژگی‌های کلیدی نسخه `2.1.0`

### ۱. پشتیبانی چندگانه از سرویس‌ها و مدل‌های رایگان هوش مصنوعی (Multi-Provider Free LLMs)

| شناسه سرویس | عنوان سرویس | نیازمند کلید؟ | مدل‌های کدنویسی رایگان شاخص |
| :--- | :--- | :---: | :--- |
| **`opencode`** | **🆓 OpenCode Zen (`opencode.ai/zen/v1`)** | کلید رایگان بدون کارت (`opencode.ai/auth`) | `big-pickle`, `deepseek-v4.1-flash-free`, `glm-5.3-flash-free`, `mimo-v2.6-flash-free`, `nemotron-3-ultra-free` + **استعلام زنده `/models`** |
| **`freellmapi`** | **🔀 FreeLLMAPI Router (تجمیع ۳۴ سرویس رایگان)** | کلید روتر (`freellmapi-...`) + آدرس HTTPS `/v1` | `auto`, `auto:smart`, `auto:fast` یا هر مدل دلخواه روتر + نمایش هدر `X-Routed-Via` |
| **`apifreellm`** | **🆓 ApiFreeLLM.com (`apifreellm.com/api/v1/chat`)** | کلید رایگان با اکانت گوگل | `apifreellm` (اجرای ابزارها با موتور ReAct هوشمند) |
| **`llm7`** | **⚡ LLM7.io Free API** | **خیر (بدون نیاز به کلید!)** | `default`, `gpt-oss`, `fast` (با Failover خودکار به Pollinations) |
| **`pollinations`** | **🌸 Pollinations Free AI** | **خیر (بدون نیاز به کلید!)** | `openai` (GPT-OSS رایگان) |
| **`openrouter`** | **🌐 OpenRouter Free Tier** | کلید رایگان OpenRouter | `qwen/qwen3-coder:free`, `deepseek/deepseek-chat:free`, `meta-llama/llama-3.3-70b-instruct:free` |
| **`groq`** | **⚡ Groq Free LPU API** | کلید رایگان Groq | `llama-3.3-70b-versatile`, `qwen-qwq-32b` |
| **`gemini`** | **✨ Google Gemini (AI Studio)** | کلید Google AI Studio | `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash` |
| **`custom`** | **🔧 هر سرویس سازگار با OpenAI** | اختیاری | هر اندپوینت دلخواه با دستور `/setcustom` |

### ۲. موتور دوگانه اجرای ابزارها (Dual-Mode Tool-Calling Engine)
بسیاری از مدل‌های رایگان یا اندپوینت‌هایی مثل `apifreellm.com` از پارامتر استاندارد `tools` در OpenAI پشتیبانی نمی‌کنند. در `tgcloud/lib/agent/llm-router.js` یک **موتور دوگانه هوشمند** پیاده‌سازی شده است:
- **حالت اول (Native Function Calling)**: ارسال مستقیم `tools` استاندارد (با تبدیل خودکار JSON Schema برای OpenAI و حفظ `thoughtSignature` برای Gemini).
- **حالت دوم (Automatic ReAct `<tool_call>` Fallback)**: اگر یک مدل رایگان از `tools` پشتیبانی نکند (خطای `400/422`) یا سرویس `apifreellm` انتخاب شده باشد، روتر به صورت **کاملاً خودکار** به پروتکل ساخت‌یافته `<tool_call>` سوییچ می‌کند تا هر ۱۱ ابزار ایجنت (`write_file`, `edit_file`, `verify_javascript`, `export_project_zip`, `github_import_repo`, ...) روی **تمام مدل‌های رایگان** کار کنند!

### ۳. محیط توسعه کامل روی Telegram Serverless (`@tgcloud`)
- **فضای کاری پایدار در SQLite (`sdk/db`)**: ساخت نامحدود پروژه مجزا، ویرایش، جستجو و مدیریت فایل‌ها بدون نیاز به سرور خارجی.
- **سندباکس V8 (`verify_javascript`)**: تست و اجرای منطق جاوااسکریپت قبل از تحویل کد.
- **پشتیبانی دوطرفه ZIP و GitHub**: آپلود فایل `.zip` در چت برای ایمپورت پروژه، دانلود کل پروژه با `/zip`، و کلون/پوش مستقیم به GitHub (`/ghclone`, `/ghpush`).
- **استودیوی گرافیکی Mini App (`miniapp-dist/`)**: انتخاب سرویس و مدل رایگان، همگام‌سازی زنده مدل‌های OpenCode، چت با ایجنت، مرورگر فایل‌ها و ویرایشگر کد درون تلگرام!

---

## 🚀 راهنمای نصب و استقرار روی Telegram Serverless

```bash
# ۱. نصب ابزار CLI تلگرام سرورلس (فقط برای دیپلوی و تست محلی)
npm install

# ۲. بیلد استودیو Mini App و اعتبارسنجی ماژول‌های V8
npm run build
npm run validate:tgcloud
npm test

# ۳. ورود به حساب Telegram Serverless و اتصال به ربات
npx tgcloud login
npx tgcloud init

# ۴. ارسال کدها، ساخت جداول SQLite و فعال‌سازی وبهوک
npm run deploy
npx tgcloud migrate
npx tgcloud webhook set
```

---

## 💬 دستورات کاربردی در چت تلگرام

### دستورات هوش مصنوعی و مدل‌های رایگان
- `/provider` — باز کردن منوی شیشه‌ای انتخاب سرویس (`OpenCode Zen`, `FreeLLMAPI`, `ApiFreeLLM`, `LLM7`, `Pollinations`, `OpenRouter`, `Groq`, `Gemini`)
- `/opencode` — مشاهده و انتخاب **مدل‌های رایگان OpenCode Zen** + دکمه **🔄 دریافت زنده مدل‌های رایگان از `opencode.ai`**
- `/opencode <YOUR_FREE_KEY>` — ثبت امن کلید رایگان دریافتی از `https://opencode.ai/auth` (حذف خودکار پیام حاوی کلید!)
- `/freellm https://your-router.example.com/v1 freellmapi-xxx [auto:smart]` — اتصال به سرور روتر **FreeLLMAPI** (تجمیع ۳۴ سرویس رایگان در یک `/v1`)
- `/freellm <YOUR_APIFREELLM_KEY>` — اتصال مستقیم به سرویس رایگان **ApiFreeLLM.com**
- `/provider llm7` — استفاده فوری و **بدون نیاز به هیچ کلید API** روی سرویس رایگان LLM7!
- `/setkey [provider] <API_KEY>` — ثبت امن کلید هر سرویس (تشخیص خودکار سرویس از پیشوند کلید مثل `AIza...`, `sk-or-...`, `gsk_...`)
- `/setcustom <BASE_URL> [API_KEY] [MODEL]` — اتصال به هر سرویس سازگار با OpenAI
- `/model [model_id]` — تغییر مدل فعال از منوی شیشه‌ای یا با نام دلخواه

### دستورات پروژه، فایل و GitHub
- `/project <name>` — ساخت یا تغییر پروژه فعال
- `/files` — لیست فایل‌های پروژه فعال
- `/cat <file_path>` — نمایش محتوای فایل در چت
- `/zip` — دریافت کل پروژه به صورت آرشیو `.zip`
- `/ghclone <owner/repo> [branch]` — ایمپورت ریپازیتوری از GitHub به پروژه فعال
- `/ghpush <owner/repo> <commit_msg>` — کامیت و پوش مستقیم فایل‌های پروژه به GitHub
- `/clear` — پاکسازی حافظه چت پروژه فعال
- `/allow <tg_id>` / `/revoke <tg_id>` — مدیریت دسترسی کاربران توسط ادمین
