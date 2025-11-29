
import { Router } from 'itty-router';

const router = Router();

// Telegram API helper
async function telegramRequest(token, method, body = {}) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return await response.json();
}

// Send message helper
async function sendMessage(token, chatId, text, options = {}) {
  return telegramRequest(token, 'sendMessage', {
    chat_id: chatId,
    text,
    ...options
  });
}

// Get user data from KV
async function getUserData(DB, userId) {
  const data = await DB.get(`user:${userId}`);
  return data ? JSON.parse(data) : { channels: [], backups: {} };
}

// Save user data to KV
async function saveUserData(DB, userId, data) {
  await DB.put(`user:${userId}`, JSON.stringify(data));
}

// Save backup message to KV
async function saveBackupMessage(DB, channelId, messageId, messageData) {
  await DB.put(`backup:${channelId}:${messageId}`, JSON.stringify(messageData));
}

// Get all backup messages for a channel
async function getChannelBackups(DB, channelId) {
  const list = await DB.list({ prefix: `backup:${channelId}:` });
  const messages = [];
  for (const key of list.keys) {
    const data = await DB.get(key.name);
    if (data) messages.push(JSON.parse(data));
  }
  return messages.sort((a, b) => a.message_id - b.message_id);
}

// Download and store file
async function downloadFile(token, fileId) {
  const fileInfo = await telegramRequest(token, 'getFile', { file_id: fileId });
  if (!fileInfo.ok) return null;
  
  const filePath = fileInfo.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const response = await fetch(fileUrl);
  const arrayBuffer = await response.arrayBuffer();
  return {
    data: Array.from(new Uint8Array(arrayBuffer)),
    path: filePath
  };
}

// Handle backup restoration
async function restoreBackup(token, DB, userId, sourceChannelId, targetChannelId) {
  const backups = await getChannelBackups(DB, sourceChannelId);
  let restored = 0;
  
  for (const backup of backups) {
    try {
      if (backup.text) {
        await sendMessage(token, targetChannelId, backup.text);
        restored++;
      } else if (backup.photo) {
        await telegramRequest(token, 'sendPhoto', {
          chat_id: targetChannelId,
          photo: backup.photo,
          caption: backup.caption || ''
        });
        restored++;
      } else if (backup.video) {
        await telegramRequest(token, 'sendVideo', {
          chat_id: targetChannelId,
          video: backup.video,
          caption: backup.caption || ''
        });
        restored++;
      } else if (backup.document) {
        await telegramRequest(token, 'sendDocument', {
          chat_id: targetChannelId,
          document: backup.document,
          caption: backup.caption || ''
        });
        restored++;
      }
    } catch (err) {
      console.error('Error restoring message:', err);
    }
  }
  
  return restored;
}

// Handle Telegram updates
export async function handleUpdate(update, env, context) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const DB = env.DB;
  
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN not set');
    return;
  }
  
  if (!DB) {
    console.error('DB (KV) binding not found');
    return;
  }
  
  const message = update.message || update.channel_post;
  if (!message) return;
  
  const userId = message.from?.id;
  const chatId = message.chat.id;
  const text = message.text || '';
  
  // Handle channel posts (backup)
  if (update.channel_post) {
    const channelId = message.chat.id;
    const messageId = message.message_id;
    
    // Check if file size is within limit (25MB)
    const fileSize = message.video?.file_size || message.document?.file_size || 0;
    if (fileSize > 25 * 1024 * 1024) {
      return; // Skip files larger than 25MB
    }
    
    const backupData = {
      message_id: messageId,
      date: message.date,
      text: message.text,
      caption: message.caption,
      photo: message.photo ? message.photo[message.photo.length - 1].file_id : null,
      video: message.video ? message.video.file_id : null,
      document: message.document ? message.document.file_id : null,
      audio: message.audio ? message.audio.file_id : null
    };
    
    await saveBackupMessage(DB, channelId, messageId, backupData);
    return;
  }
  
  // Handle bot commands
  if (text.startsWith('/start')) {
    await sendMessage(token, chatId, 
      '🤖 به ربات بکاپ گیری کانال خوش آمدید!\n\n' +
      'دستورات موجود:\n' +
      '/addchannel - افزودن کانال جدید\n' +
      '/channels - لیست کانال‌های شما\n' +
      '/backup [channel_id] - مشاهده تعداد بکاپ‌ها\n' +
      '/restore [source_id] [target_id] - انتقال بکاپ به کانال جدید\n' +
      '/help - راهنمای استفاده'
    );
  }
  
  else if (text.startsWith('/addchannel')) {
    await sendMessage(token, chatId,
      'برای افزودن کانال:\n' +
      '1. ربات را به کانال خود اضافه کنید\n' +
      '2. ربات را ادمین کانال کنید\n' +
      '3. ID کانال را ارسال کنید (مثال: -1001234567890)'
    );
  }
  
  else if (text.startsWith('/channels')) {
    const userData = await getUserData(DB, userId);
    if (userData.channels.length === 0) {
      await sendMessage(token, chatId, 'شما هنوز کانالی اضافه نکرده‌اید.');
    } else {
      const channelList = userData.channels.map(ch => `• ${ch.title} (${ch.id})`).join('\n');
      await sendMessage(token, chatId, `کانال‌های شما:\n${channelList}`);
    }
  }
  
  else if (text.startsWith('/backup')) {
    const parts = text.split(' ');
    if (parts.length < 2) {
      await sendMessage(token, chatId, 'لطفا ID کانال را وارد کنید: /backup -1001234567890');
      return;
    }
    
    const channelId = parts[1];
    const backups = await getChannelBackups(DB, channelId);
    await sendMessage(token, chatId, 
      `تعداد پیام‌های بکاپ شده از کانال ${channelId}: ${backups.length}`
    );
  }
  
  else if (text.startsWith('/restore')) {
    const parts = text.split(' ');
    if (parts.length < 3) {
      await sendMessage(token, chatId, 
        'فرمت: /restore [source_channel_id] [target_channel_id]\n' +
        'مثال: /restore -1001234567890 -1009876543210'
      );
      return;
    }
    
    const sourceId = parts[1];
    const targetId = parts[2];
    
    await sendMessage(token, chatId, 'در حال بازیابی بکاپ...');
    const restored = await restoreBackup(token, DB, userId, sourceId, targetId);
    await sendMessage(token, chatId, 
      `✅ بازیابی کامل شد!\n${restored} پیام به کانال جدید منتقل شد.`
    );
  }
  
  else if (text.startsWith('/help')) {
    await sendMessage(token, chatId,
      '📖 راهنمای استفاده:\n\n' +
      '1️⃣ ربات را به کانال خود اضافه و ادمین کنید\n' +
      '2️⃣ از این لحظه همه پیام‌های کانال بکاپ می‌شود\n' +
      '3️⃣ برای انتقال به کانال جدید از دستور /restore استفاده کنید\n\n' +
      '⚠️ فایل‌های بزرگتر از 25 مگابایت بکاپ نمی‌شوند.'
    );
  }
  
  // Handle channel ID input
  else if (text.match(/^-\d+$/)) {
    const channelId = text;
    try {
      const chatInfo = await telegramRequest(token, 'getChat', { chat_id: channelId });
      if (chatInfo.ok) {
        const userData = await getUserData(DB, userId);
        if (!userData.channels.find(ch => ch.id === channelId)) {
          userData.channels.push({
            id: channelId,
            title: chatInfo.result.title || 'Unknown',
            added_at: Date.now()
          });
          await saveUserData(DB, userId, userData);
          await sendMessage(token, chatId, 
            `✅ کانال "${chatInfo.result.title}" با موفقیت اضافه شد!\n` +
            `از این لحظه پیام‌های کانال بکاپ می‌شود.`
          );
        } else {
          await sendMessage(token, chatId, 'این کانال قبلا اضافه شده است.');
        }
      }
    } catch (err) {
      await sendMessage(token, chatId, 
        'خطا در دسترسی به کانال. مطمئن شوید ربات ادمین کانال است.'
      );
    }
  }
}

// Web panel routes
router.get('/', async (request, env) => {
  const tokenSet = !!env.TELEGRAM_BOT_TOKEN;
  const kvConnected = !!env.DB;
  
  const html = `
    <!DOCTYPE html>
    <html dir="rtl" lang="fa">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>پنل ربات تلگرام</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px;
        }
        .panel {
          background: white;
          border-radius: 20px;
          padding: 40px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          max-width: 500px;
          width: 100%;
        }
        h1 {
          color: #667eea;
          margin-bottom: 30px;
          text-align: center;
          font-size: 28px;
        }
        .status {
          margin: 20px 0;
          padding: 15px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .status.success {
          background: #d4edda;
          border: 1px solid #c3e6cb;
          color: #155724;
        }
        .status.error {
          background: #f8d7da;
          border: 1px solid #f5c6cb;
          color: #721c24;
        }
        .status-icon {
          font-size: 24px;
          margin-left: 10px;
        }
        .info {
          margin-top: 30px;
          padding: 20px;
          background: #f8f9fa;
          border-radius: 10px;
          font-size: 14px;
          line-height: 1.6;
        }
        .info h3 {
          color: #667eea;
          margin-bottom: 10px;
        }
      </style>
    </head>
    <body>
      <div class="panel">
        <h1>🤖 پنل ربات بکاپ تلگرام</h1>
        
        <div class="status ${tokenSet ? 'success' : 'error'}">
          <span>توکن تلگرام (TELEGRAM_BOT_TOKEN)</span>
          <span class="status-icon">${tokenSet ? '✅' : '❌'}</span>
        </div>
        
        <div class="status ${kvConnected ? 'success' : 'error'}">
          <span>دیتابیس KV (DB Binding)</span>
          <span class="status-icon">${kvConnected ? '✅' : '❌'}</span>
        </div>
        
        <div class="info">
          <h3>📋 وضعیت سیستم</h3>
          <p>
            ${tokenSet && kvConnected 
              ? '✅ ربات آماده استفاده است! می‌توانید با ربات در تلگرام ارتباط برقرار کنید.' 
              : '⚠️ برای استفاده از ربات، لطفا تنظیمات را کامل کنید.'}
          </p>
        </div>
        
        <div class="info">
          <h3>⚙️ راهنمای تنظیمات</h3>
          <p>
            1. توکن ربات تلگرام را در Environment Variable با نام <strong>TELEGRAM_BOT_TOKEN</strong> تنظیم کنید.<br>
            2. KV Namespace را با Binding Name = <strong>DB</strong> متصل کنید.<br>
            3. Webhook را در آدرس <strong>/functions/webhook</strong> تنظیم کنید.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
});

router.get('/api/status', async (request, env) => {
  return new Response(JSON.stringify({
    token_set: !!env.TELEGRAM_BOT_TOKEN,
    kv_connected: !!env.DB,
    timestamp: Date.now()
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
});

router.all('*', () => new Response('Not Found', { status: 404 }));

export default {
  fetch: (request, env, ctx) => router.handle(request, env, ctx)
};
