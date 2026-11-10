import dotenv from 'dotenv';
import { Bot } from 'grammy';
import { TelegramBotApiService } from '../services/telegram/bot-api.service.js';

dotenv.config();

async function migrateToLocalBotApiServer(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const localApiRoot = (process.env.TELEGRAM_API_ROOT || 'http://127.0.0.1:8081').replace(
    /\/+$/,
    '',
  );

  if (!token) {
    console.error('❌ خطا: متغیر TELEGRAM_BOT_TOKEN در فایل .env تنظیم نشده است.');
    process.exit(1);
  }

  if (localApiRoot === 'https://api.telegram.org') {
    console.error(
      '❌ خطا: مقدار TELEGRAM_API_ROOT هنوز روی https://api.telegram.org است. آن را روی آدرس سرور لوکال (مثلاً http://127.0.0.1:8081) قرار دهید.',
    );
    process.exit(1);
  }

  console.log('1️⃣ در حال خروج (logOut) ربات از سرور ابری رسمی تلگرام (api.telegram.org)...');
  try {
    await TelegramBotApiService.logOutFromCloudServer(token);
    console.log('✅ خروج از سرور ابری با موفقیت انجام شد.');
  } catch (err) {
    console.warn(
      '⚠️ پیام سرور ابری (احتمالاً قبلاً خارج شده است):',
      err instanceof Error ? err.message : String(err),
    );
  }

  console.log(`2️⃣ در حال اتصال و ثبت ربات روی Local Telegram Bot API Server (${localApiRoot})...`);
  const localBot = new Bot(token, {
    client: { apiRoot: localApiRoot },
  });

  const me = await localBot.api.getMe();
  console.log(
    `🎉 انتقال با موفقیت کامل شد! ربات @${me.username} (ID: ${me.id}) اکنون روی سرور اختصاصی ${localApiRoot} فعال است.`,
  );
}

migrateToLocalBotApiServer().catch((err) => {
  console.error('❌ خطا در انتقال به Local Bot API Server:', err);
  process.exit(1);
});
