
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
    parse_mode: 'HTML',
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

// Handle backup restoration
async function restoreBackup(token, DB, sourceChannelId, targetChannelId) {
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
      } else if (backup.audio) {
        await telegramRequest(token, 'sendAudio', {
          chat_id: targetChannelId,
          audio: backup.audio,
          caption: backup.caption || ''
        });
        restored++;
      }
      // کمی تاخیر برای جلوگیری از rate limit
      await new Promise(resolve => setTimeout(resolve, 100));
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
  
  if (!token || !DB) {
    console.error('Environment not configured properly');
    return;
  }
  
  const message = update.message || update.channel_post;
  if (!message) return;
  
  const userId = message.from?.id;
  const chatId = message.chat.id;
  const text = message.text || '';
  
  // Handle channel posts (automatic backup)
  if (update.channel_post) {
    const channelId = message.chat.id;
    const messageId = message.message_id;
    
    // Check file size limit (25MB)
    const fileSize = message.video?.file_size || message.document?.file_size || message.audio?.file_size || 0;
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
      audio: message.audio ? message.audio.file_id : null,
      voice: message.voice ? message.voice.file_id : null
    };
    
    await saveBackupMessage(DB, channelId, messageId, backupData);
    return;
  }
  
  // Handle private messages (bot commands)
  if (!userId) return;
  
  if (text.startsWith('/start')) {
    await sendMessage(token, chatId, 
      '🤖 <b>به ربات بکاپ‌گیری کانال خوش آمدید!</b>\n\n' +
      '📋 <b>دستورات موجود:</b>\n' +
      '/addchannel - افزودن کانال جدید\n' +
      '/channels - لیست کانال‌های شما\n' +
      '/backup - مشاهده تعداد بکاپ‌ها\n' +
      '/restore - انتقال بکاپ به کانال جدید\n' +
      '/help - راهنمای کامل\n\n' +
      '💡 ربات به صورت خودکار تمام پیام‌های کانال‌های شما را بکاپ می‌گیرد.'
    );
  }
  
  else if (text.startsWith('/addchannel')) {
    await sendMessage(token, chatId,
      '📝 <b>راهنمای افزودن کانال:</b>\n\n' +
      '1️⃣ ربات را به کانال خود اضافه کنید\n' +
      '2️⃣ ربات را ادمین کانال کنید (با دسترسی پست کردن)\n' +
      '3️⃣ ID کانال را ارسال کنید\n\n' +
      '💡 برای دریافت ID کانال، @userinfobot را به کانال اضافه کنید یا از @RawDataBot استفاده کنید.\n' +
      'مثال ID: <code>-1001234567890</code>'
    );
  }
  
  else if (text.startsWith('/channels')) {
    const userData = await getUserData(DB, userId);
    if (userData.channels.length === 0) {
      await sendMessage(token, chatId, '❌ شما هنوز کانالی اضافه نکرده‌اید.\n\nاز /addchannel برای افزودن کانال استفاده کنید.');
    } else {
      let channelList = '📋 <b>کانال‌های شما:</b>\n\n';
      for (let i = 0; i < userData.channels.length; i++) {
        const ch = userData.channels[i];
        const backupCount = (await DB.list({ prefix: `backup:${ch.id}:` })).keys.length;
        channelList += `${i + 1}. <b>${ch.title}</b>\n`;
        channelList += `   ID: <code>${ch.id}</code>\n`;
        channelList += `   بکاپ‌ها: ${backupCount} پیام\n\n`;
      }
      await sendMessage(token, chatId, channelList);
    }
  }
  
  else if (text.startsWith('/backup')) {
    const userData = await getUserData(DB, userId);
    if (userData.channels.length === 0) {
      await sendMessage(token, chatId, '❌ شما هنوز کانالی اضافه نکرده‌اید.');
      return;
    }
    
    let backupInfo = '💾 <b>اطلاعات بکاپ کانال‌ها:</b>\n\n';
    for (const ch of userData.channels) {
      const backups = await getChannelBackups(DB, ch.id);
      backupInfo += `📺 <b>${ch.title}</b>\n`;
      backupInfo += `ID: <code>${ch.id}</code>\n`;
      backupInfo += `تعداد بکاپ: ${backups.length} پیام\n\n`;
    }
    await sendMessage(token, chatId, backupInfo);
  }
  
  else if (text.startsWith('/restore')) {
    const parts = text.split(' ');
    if (parts.length < 3) {
      await sendMessage(token, chatId, 
        '📤 <b>راهنمای بازیابی بکاپ:</b>\n\n' +
        'فرمت: <code>/restore [source_channel_id] [target_channel_id]</code>\n\n' +
        'مثال:\n<code>/restore -1001234567890 -1009876543210</code>\n\n' +
        '⚠️ توجه: ربات باید در هر دو کانال ادمین باشد.'
      );
      return;
    }
    
    const sourceId = parts[1];
    const targetId = parts[2];
    
    // بررسی دسترسی به کانال‌ها
    try {
      const sourceChat = await telegramRequest(token, 'getChat', { chat_id: sourceId });
      const targetChat = await telegramRequest(token, 'getChat', { chat_id: targetId });
      
      if (!sourceChat.ok || !targetChat.ok) {
        await sendMessage(token, chatId, '❌ خطا در دسترسی به کانال‌ها. مطمئن شوید ربات ادمین هر دو کانال است.');
        return;
      }
    } catch (err) {
      await sendMessage(token, chatId, '❌ خطا در بررسی دسترسی به کانال‌ها.');
      return;
    }
    
    await sendMessage(token, chatId, '⏳ در حال بازیابی بکاپ...\nلطفا صبر کنید.');
    
    const restored = await restoreBackup(token, DB, sourceId, targetId);
    
    await sendMessage(token, chatId, 
      `✅ <b>بازیابی با موفقیت انجام شد!</b>\n\n` +
      `📊 تعداد پیام‌های منتقل شده: ${restored}\n` +
      `📺 کانال مقصد: <code>${targetId}</code>`
    );
  }
  
  else if (text.startsWith('/help')) {
    await sendMessage(token, chatId,
      '📖 <b>راهنمای کامل استفاده از ربات</b>\n\n' +
      '<b>1️⃣ نحوه شروع:</b>\n' +
      '• ربات را به کانال خود اضافه کنید\n' +
      '• ربات را ادمین کانال کنید\n' +
      '• از دستور /addchannel برای ثبت کانال استفاده کنید\n\n' +
      '<b>2️⃣ بکاپ خودکار:</b>\n' +
      '• پس از افزودن کانال، تمام پیام‌ها به صورت خودکار بکاپ می‌شوند\n' +
      '• فایل‌های تا 25 مگابایت پشتیبانی می‌شوند\n\n' +
      '<b>3️⃣ بازیابی بکاپ:</b>\n' +
      '• از دستور /restore برای انتقال بکاپ استفاده کنید\n' +
      '• ربات باید در کانال جدید نیز ادمین باشد\n\n' +
      '<b>4️⃣ مدیریت کانال‌ها:</b>\n' +
      '• /channels - مشاهده کانال‌های ثبت شده\n' +
      '• /backup - مشاهده آمار بکاپ‌ها\n\n' +
      '⚠️ <b>نکات مهم:</b>\n' +
      '• فایل‌های بزرگتر از 25 مگابایت بکاپ نمی‌شوند\n' +
      '• در بازیابی، ترتیب پیام‌ها حفظ می‌شود\n' +
      '• اطلاعات شما به صورت امن ذخیره می‌شود'
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
            title: chatInfo.result.title || 'Unknown Channel',
            username: chatInfo.result.username || null,
            added_at: Date.now()
          });
          await saveUserData(DB, userId, userData);
          await sendMessage(token, chatId, 
            `✅ <b>کانال با موفقیت اضافه شد!</b>\n\n` +
            `📺 نام: <b>${chatInfo.result.title}</b>\n` +
            `🆔 ID: <code>${channelId}</code>\n\n` +
            `💾 از این لحظه تمام پیام‌های کانال به صورت خودکار بکاپ می‌شود.`
          );
        } else {
          await sendMessage(token, chatId, '⚠️ این کانال قبلا اضافه شده است.');
        }
      } else {
        await sendMessage(token, chatId, 
          '❌ خطا در دسترسی به کانال.\n\n' +
          'مطمئن شوید:\n' +
          '1. ربات را به کانال اضافه کرده‌اید\n' +
          '2. ربات ادمین کانال است\n' +
          '3. ID کانال صحیح است'
        );
      }
    } catch (err) {
      await sendMessage(token, chatId, '❌ خطا در پردازش درخواست. لطفا دوباره تلاش کنید.');
    }
  }
}

// Web panel HTML
function getPanelHTML(tokenSet, kvConnected) {
  return `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>پنل ربات تلگرام - بکاپ کانال</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
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
      max-width: 600px;
      width: 100%;
      animation: slideUp 0.5s ease-out;
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }
    h1 {
      color: #667eea;
      margin-bottom: 10px;
      text-align: center;
      font-size: 28px;
    }
    .subtitle {
      text-align: center;
      color: #666;
      margin-bottom: 30px;
      font-size: 14px;
    }
    .status {
      margin: 15px 0;
      padding: 15px 20px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: all 0.3s ease;
    }
    .status:hover {
      transform: translateX(-5px);
    }
    .status.success {
      background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
      border-right: 4px solid #28a745;
      color: #155724;
    }
    .status.error {
      background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%);
      border-right: 4px solid #dc3545;
      color: #721c24;
    }
    .status-icon {
      font-size: 24px;
      margin-left: 10px;
    }
    .status-label {
      font-weight: 600;
    }
    .info {
      margin-top: 25px;
      padding: 20px;
      background: #f8f9fa;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.8;
    }
    .info h3 {
      color: #667eea;
      margin-bottom: 12px;
      font-size: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .info p {
      color: #555;
      margin-bottom: 10px;
    }
    .info ul {
      margin-right: 20px;
      color: #555;
    }
    .info ul li {
      margin-bottom: 8px;
    }
    .info code {
      background: #e9ecef;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      color: #d63384;
    }
    .status-summary {
      margin-top: 25px;
      padding: 20px;
      background: ${tokenSet && kvConnected ? 'linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%)' : 'linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%)'};
      border-radius: 12px;
      text-align: center;
      font-weight: 600;
      color: ${tokenSet && kvConnected ? '#155724' : '#856404'};
      border: 2px solid ${tokenSet && kvConnected ? '#28a745' : '#ffc107'};
    }
    .footer {
      margin-top: 25px;
      text-align: center;
      color: #999;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="panel">
    <h1>🤖 پنل ربات بکاپ تلگرام</h1>
    <p class="subtitle">Cloudflare Pages Deployment</p>
    
    <div class="status ${tokenSet ? 'success' : 'error'}">
      <span class="status-label">🔑 توکن تلگرام (TELEGRAM_BOT_TOKEN)</span>
      <span class="status-icon">${tokenSet ? '✅' : '❌'}</span>
    </div>
    
    <div class="status ${kvConnected ? 'success' : 'error'}">
      <span class="status-label">💾 دیتابیس KV (DB Binding)</span>
      <span class="status-icon">${kvConnected ? '✅' : '❌'}</span>
    </div>
    
    <div class="status-summary">
      ${tokenSet && kvConnected 
        ? '✅ سیستم آماده و در حال اجرا است' 
        : '⚠️ نیاز به تکمیل تنظیمات'}
    </div>
    
    <div class="info">
      <h3>📋 وضعیت سیستم</h3>
      <p>
        ${tokenSet && kvConnected 
          ? 'سیستم به درستی پیکربندی شده و آماده دریافت پیام‌های تلگرام است. می‌توانید ربات را در تلگرام استارت کنید.' 
          : 'برای استفاده از ربات، لطفا تنظیمات زیر را انجام دهید:'}
      </p>
      ${!tokenSet || !kvConnected ? `
        <ul>
          ${!tokenSet ? '<li>توکن ربات را در Environment Variables تنظیم کنید</li>' : ''}
          ${!kvConnected ? '<li>KV Namespace را به پروژه متصل کنید</li>' : ''}
        </ul>
      ` : ''}
    </div>
    
    <div class="info">
      <h3>⚙️ راهنمای تنظیمات</h3>
      <ul>
        <li>در بخش <strong>Settings → Environment Variables</strong>:
          <br>متغیر <code>TELEGRAM_BOT_TOKEN</code> را با توکن ربات خود تنظیم کنید
        </li>
        <li>در بخش <strong>Settings → Functions</strong>:
          <br>KV Namespace با Binding Name = <code>DB</code> متصل کنید
        </li>
        <li>Webhook را با دستور زیر تنظیم کنید:
          <br><code>https://api.telegram.org/bot[TOKEN]/setWebhook?url=https://[DOMAIN]/webhook</code>
        </li>
      </ul>
    </div>
    
    <div class="info">
      <h3>🚀 قابلیت‌های ربات</h3>
      <ul>
        <li>✅ بکاپ خودکار تمام پیام‌های کانال</li>
        <li>✅ پشتیبانی از متن، عکس، ویدیو، فایل و صوت</li>
        <li>✅ انتقال بکاپ به کانال جدید</li>
        <li>✅ مدیریت چند کانال برای هر کاربر</li>
        <li>✅ پشتیبانی از فایل‌های تا 25 مگابایت</li>
      </ul>
    </div>
    
    <div class="footer">
      Powered by Cloudflare Pages • ${new Date().toLocaleString('fa-IR')}
    </div>
  </div>
</body>
</html>`;
}

// Main export for Cloudflare Pages
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // API Status endpoint
    if (url.pathname === '/api/status') {
      return new Response(JSON.stringify({
        token_set: !!env.TELEGRAM_BOT_TOKEN,
        kv_connected: !!env.DB,
        timestamp: Date.now(),
        version: '1.0.0'
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // Home page
    if (url.pathname === '/' || url.pathname === '') {
      const html = getPanelHTML(!!env.TELEGRAM_BOT_TOKEN, !!env.DB);
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    
    // 404 for unknown routes
    return new Response('Not Found', { status: 404 });
  }
};
