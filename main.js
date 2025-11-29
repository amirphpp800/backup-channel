
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

// Resolve channel username to ID
async function resolveChannelId(token, channelInput) {
  // اگر با @ شروع می‌شود، username است
  if (channelInput.startsWith('@')) {
    try {
      const result = await telegramRequest(token, 'getChat', { 
        chat_id: channelInput 
      });
      if (result.ok) {
        return result.result.id.toString();
      }
    } catch (err) {
      return null;
    }
  }
  // اگر با - شروع می‌شود یا عدد است، ID است
  if (channelInput.match(/^-?\d+$/)) {
    return channelInput;
  }
  return null;
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
      '/addchannel [کانال] - افزودن کانال جدید\n' +
      '/channels - لیست کانال‌های شما\n' +
      '/backup - مشاهده تعداد بکاپ‌ها\n' +
      '/restore - انتقال بکاپ به کانال جدید\n' +
      '/removechannel [کانال] - حذف کانال\n' +
      '/help - راهنمای کامل\n\n' +
      '💡 <b>نحوه استفاده:</b>\n' +
      '• <code>/addchannel @mychannel</code>\n' +
      '• <code>/addchannel -1001234567890</code>\n\n' +
      '✨ ربات به صورت خودکار تمام پیام‌های کانال‌های شما را بکاپ می‌گیرد.'
    );
  }
  
  else if (text.startsWith('/addchannel')) {
    const parts = text.trim().split(/\s+/);
    
    if (parts.length < 2) {
      await sendMessage(token, chatId,
        '📝 <b>راهنمای افزودن کانال:</b>\n\n' +
        '<b>فرمت دستور:</b>\n' +
        '<code>/addchannel [کانال]</code>\n\n' +
        '<b>مثال‌ها:</b>\n' +
        '• <code>/addchannel @mychannel</code>\n' +
        '• <code>/addchannel -1001234567890</code>\n\n' +
        '⚠️ <b>توجه مهم:</b>\n' +
        '1️⃣ ابتدا ربات را به کانال اضافه کنید\n' +
        '2️⃣ ربات را ادمین کانال کنید (با دسترسی ارسال پیام)\n' +
        '3️⃣ سپس دستور را با ID یا username کانال ارسال کنید\n\n' +
        '💡 <b>نکته:</b> برای دریافت ID کانال می‌توانید از @userinfobot یا @RawDataBot استفاده کنید.'
      );
      return;
    }
    
    const channelInput = parts[1];
    await sendMessage(token, chatId, '⏳ در حال بررسی کانال...');
    
    const channelId = await resolveChannelId(token, channelInput);
    if (!channelId) {
      await sendMessage(token, chatId, 
        '❌ <b>خطا در شناسایی کانال!</b>\n\n' +
        'لطفا مطمئن شوید:\n' +
        '• فرمت ورودی صحیح است (@username یا ID)\n' +
        '• کانال عمومی است یا ربات در آن عضو است'
      );
      return;
    }
    
    try {
      const chatInfo = await telegramRequest(token, 'getChat', { chat_id: channelId });
      
      if (!chatInfo.ok) {
        await sendMessage(token, chatId, 
          '❌ <b>خطا در دسترسی به کانال!</b>\n\n' +
          'لطفا مطمئن شوید:\n' +
          '1️⃣ ربات را به کانال اضافه کرده‌اید\n' +
          '2️⃣ ربات ادمین کانال است\n' +
          '3️⃣ ربات دسترسی "ارسال پیام" دارد\n\n' +
          '💡 پس از اضافه کردن ربات، چند ثانیه صبر کنید و دوباره تلاش کنید.'
        );
        return;
      }
      
      const userData = await getUserData(DB, userId);
      
      // بررسی اینکه کانال قبلا اضافه نشده باشد
      if (userData.channels.find(ch => ch.id === channelId)) {
        await sendMessage(token, chatId, 
          '⚠️ <b>این کانال قبلا اضافه شده است!</b>\n\n' +
          '📺 نام کانال: <b>' + chatInfo.result.title + '</b>\n' +
          '🆔 ID: <code>' + channelId + '</code>\n\n' +
          'برای مشاهده لیست کانال‌ها از دستور /channels استفاده کنید.'
        );
        return;
      }
      
      // اضافه کردن کانال جدید
      userData.channels.push({
        id: channelId,
        title: chatInfo.result.title || 'Unknown Channel',
        username: chatInfo.result.username || null,
        added_at: Date.now()
      });
      
      await saveUserData(DB, userId, userData);
      
      await sendMessage(token, chatId, 
        '✅ <b>کانال با موفقیت اضافه شد!</b>\n\n' +
        '📺 نام: <b>' + chatInfo.result.title + '</b>\n' +
        '🆔 ID: <code>' + channelId + '</code>\n' +
        (chatInfo.result.username ? '👤 Username: @' + chatInfo.result.username + '\n' : '') +
        '📅 تاریخ افزودن: ' + new Date().toLocaleString('fa-IR') + '\n\n' +
        '💾 <b>از این لحظه تمام پیام‌های کانال به صورت خودکار بکاپ می‌شود.</b>\n\n' +
        '💡 برای مشاهده آمار بکاپ از دستور /backup استفاده کنید.'
      );
      
    } catch (err) {
      console.error('Error adding channel:', err);
      await sendMessage(token, chatId, 
        '❌ <b>خطا در پردازش درخواست!</b>\n\n' +
        'لطفا:\n' +
        '• اتصال اینترنت خود را بررسی کنید\n' +
        '• چند لحظه بعد دوباره تلاش کنید\n' +
        '• مطمئن شوید ربات در کانال ادمین است\n\n' +
        'در صورت ادامه مشکل، با پشتیبانی تماس بگیرید.'
      );
    }
  }
  
  else if (text.startsWith('/removechannel')) {
    const parts = text.trim().split(/\s+/);
    
    if (parts.length < 2) {
      await sendMessage(token, chatId,
        '🗑 <b>راهنمای حذف کانال:</b>\n\n' +
        '<b>فرمت دستور:</b>\n' +
        '<code>/removechannel [کانال]</code>\n\n' +
        '<b>مثال‌ها:</b>\n' +
        '• <code>/removechannel @mychannel</code>\n' +
        '• <code>/removechannel -1001234567890</code>\n\n' +
        '⚠️ <b>توجه:</b> حذف کانال، بکاپ‌های موجود را پاک نمی‌کند.'
      );
      return;
    }
    
    const channelInput = parts[1];
    const channelId = await resolveChannelId(token, channelInput);
    
    if (!channelId) {
      await sendMessage(token, chatId, '❌ فرمت کانال نامعتبر است!');
      return;
    }
    
    const userData = await getUserData(DB, userId);
    const channelIndex = userData.channels.findIndex(ch => ch.id === channelId);
    
    if (channelIndex === -1) {
      await sendMessage(token, chatId, '❌ این کانال در لیست شما یافت نشد!');
      return;
    }
    
    const removedChannel = userData.channels[channelIndex];
    userData.channels.splice(channelIndex, 1);
    await saveUserData(DB, userId, userData);
    
    await sendMessage(token, chatId, 
      '✅ <b>کانال با موفقیت حذف شد!</b>\n\n' +
      '📺 نام: <b>' + removedChannel.title + '</b>\n' +
      '🆔 ID: <code>' + channelId + '</code>\n\n' +
      '💾 بکاپ‌های این کانال همچنان در سیستم موجود است و می‌توانید از آن‌ها برای بازیابی استفاده کنید.'
    );
  }
  
  else if (text.startsWith('/channels')) {
    const userData = await getUserData(DB, userId);
    
    if (userData.channels.length === 0) {
      await sendMessage(token, chatId, 
        '❌ <b>شما هنوز کانالی اضافه نکرده‌اید!</b>\n\n' +
        'برای افزودن کانال از دستور زیر استفاده کنید:\n' +
        '<code>/addchannel @yourchannel</code>\n' +
        'یا\n' +
        '<code>/addchannel -1001234567890</code>'
      );
      return;
    }
    
    let channelList = '📋 <b>کانال‌های شما:</b>\n\n';
    
    for (let i = 0; i < userData.channels.length; i++) {
      const ch = userData.channels[i];
      const backupCount = (await DB.list({ prefix: `backup:${ch.id}:` })).keys.length;
      
      channelList += `${i + 1}. <b>${ch.title}</b>\n`;
      channelList += `   🆔 ID: <code>${ch.id}</code>\n`;
      if (ch.username) {
        channelList += `   👤 Username: @${ch.username}\n`;
      }
      channelList += `   💾 بکاپ‌ها: ${backupCount} پیام\n`;
      channelList += `   📅 افزودن: ${new Date(ch.added_at).toLocaleDateString('fa-IR')}\n\n`;
    }
    
    channelList += '💡 برای حذف کانال: <code>/removechannel [ID]</code>';
    
    await sendMessage(token, chatId, channelList);
  }
  
  else if (text.startsWith('/backup')) {
    const userData = await getUserData(DB, userId);
    
    if (userData.channels.length === 0) {
      await sendMessage(token, chatId, '❌ شما هنوز کانالی اضافه نکرده‌اید.');
      return;
    }
    
    let backupInfo = '💾 <b>اطلاعات بکاپ کانال‌ها:</b>\n\n';
    let totalBackups = 0;
    
    for (const ch of userData.channels) {
      const backups = await getChannelBackups(DB, ch.id);
      totalBackups += backups.length;
      
      backupInfo += `📺 <b>${ch.title}</b>\n`;
      backupInfo += `   🆔 ID: <code>${ch.id}</code>\n`;
      backupInfo += `   💾 تعداد بکاپ: ${backups.length} پیام\n`;
      
      if (backups.length > 0) {
        const lastBackup = backups[backups.length - 1];
        backupInfo += `   📅 آخرین بکاپ: ${new Date(lastBackup.date * 1000).toLocaleString('fa-IR')}\n`;
      }
      
      backupInfo += '\n';
    }
    
    backupInfo += `📊 <b>مجموع کل:</b> ${totalBackups} پیام بکاپ شده\n\n`;
    backupInfo += '💡 برای انتقال بکاپ از دستور /restore استفاده کنید.';
    
    await sendMessage(token, chatId, backupInfo);
  }
  
  else if (text.startsWith('/restore')) {
    const parts = text.trim().split(/\s+/);
    
    if (parts.length < 3) {
      await sendMessage(token, chatId, 
        '📤 <b>راهنمای بازیابی بکاپ:</b>\n\n' +
        '<b>فرمت دستور:</b>\n' +
        '<code>/restore [کانال_مبدا] [کانال_مقصد]</code>\n\n' +
        '<b>مثال:</b>\n' +
        '<code>/restore -1001234567890 -1009876543210</code>\n' +
        '<code>/restore @source @target</code>\n\n' +
        '⚠️ <b>توجه مهم:</b>\n' +
        '• ربات باید در هر دو کانال ادمین باشد\n' +
        '• کانال مقصد باید خالی باشد (توصیه می‌شود)\n' +
        '• فرآیند ممکن است زمان‌بر باشد\n\n' +
        '💡 برای مشاهده کانال‌های خود: /channels'
      );
      return;
    }
    
    const sourceInput = parts[1];
    const targetInput = parts[2];
    
    const sourceId = await resolveChannelId(token, sourceInput);
    const targetId = await resolveChannelId(token, targetInput);
    
    if (!sourceId || !targetId) {
      await sendMessage(token, chatId, '❌ فرمت کانال‌ها نامعتبر است!');
      return;
    }
    
    // بررسی دسترسی به کانال‌ها
    try {
      const sourceChat = await telegramRequest(token, 'getChat', { chat_id: sourceId });
      const targetChat = await telegramRequest(token, 'getChat', { chat_id: targetId });
      
      if (!sourceChat.ok || !targetChat.ok) {
        await sendMessage(token, chatId, 
          '❌ <b>خطا در دسترسی به کانال‌ها!</b>\n\n' +
          'مطمئن شوید:\n' +
          '• ربات در هر دو کانال ادمین است\n' +
          '• ربات دسترسی ارسال پیام دارد\n' +
          '• ID یا username کانال‌ها صحیح است'
        );
        return;
      }
      
      const backupCount = (await DB.list({ prefix: `backup:${sourceId}:` })).keys.length;
      
      if (backupCount === 0) {
        await sendMessage(token, chatId, 
          '❌ <b>هیچ بکاپی برای این کانال یافت نشد!</b>\n\n' +
          '📺 کانال مبدا: <b>' + sourceChat.result.title + '</b>\n' +
          '🆔 ID: <code>' + sourceId + '</code>\n\n' +
          'لطفا مطمئن شوید کانال صحیح را انتخاب کرده‌اید.'
        );
        return;
      }
      
      await sendMessage(token, chatId, 
        '⏳ <b>شروع بازیابی بکاپ...</b>\n\n' +
        '📺 کانال مبدا: <b>' + sourceChat.result.title + '</b>\n' +
        '📺 کانال مقصد: <b>' + targetChat.result.title + '</b>\n' +
        '💾 تعداد پیام‌ها: ' + backupCount + '\n\n' +
        '⏰ لطفا صبر کنید... این فرآیند ممکن است چند دقیقه طول بکشد.'
      );
      
      const restored = await restoreBackup(token, DB, sourceId, targetId);
      
      await sendMessage(token, chatId, 
        '✅ <b>بازیابی با موفقیت انجام شد!</b>\n\n' +
        '📊 تعداد پیام‌های منتقل شده: ' + restored + '\n' +
        '📺 کانال مقصد: <b>' + targetChat.result.title + '</b>\n' +
        '🆔 ID: <code>' + targetId + '</code>\n\n' +
        '🎉 تمام پیام‌های بکاپ شده با موفقیت به کانال جدید انتقال یافت!'
      );
      
    } catch (err) {
      console.error('Restore error:', err);
      await sendMessage(token, chatId, 
        '❌ <b>خطا در بازیابی بکاپ!</b>\n\n' +
        'ممکن است دلایل زیر باشد:\n' +
        '• ربات دسترسی کافی ندارد\n' +
        '• تلگرام محدودیت ارسال اعمال کرده\n' +
        '• مشکل در اتصال به سرور\n\n' +
        'لطفا چند دقیقه بعد دوباره تلاش کنید.'
      );
    }
  }
  
  else if (text.startsWith('/help')) {
    await sendMessage(token, chatId,
      '📖 <b>راهنمای کامل ربات بکاپ‌گیری کانال</b>\n\n' +
      '━━━━━━━━━━━━━━━━━━━━\n\n' +
      '<b>🚀 شروع کار:</b>\n' +
      '1️⃣ ربات را به کانال خود اضافه کنید\n' +
      '2️⃣ ربات را ادمین کانال کنید\n' +
      '3️⃣ از دستور <code>/addchannel @yourchannel</code> استفاده کنید\n\n' +
      '<b>📋 دستورات اصلی:</b>\n\n' +
      '<b>/addchannel [کانال]</b>\n' +
      '↳ افزودن کانال جدید برای بکاپ خودکار\n' +
      '   مثال: <code>/addchannel @mychannel</code>\n\n' +
      '<b>/channels</b>\n' +
      '↳ مشاهده لیست کانال‌های ثبت شده\n\n' +
      '<b>/backup</b>\n' +
      '↳ مشاهده آمار و تعداد بکاپ‌ها\n\n' +
      '<b>/restore [مبدا] [مقصد]</b>\n' +
      '↳ انتقال بکاپ به کانال جدید\n' +
      '   مثال: <code>/restore @old @new</code>\n\n' +
      '<b>/removechannel [کانال]</b>\n' +
      '↳ حذف کانال از لیست\n\n' +
      '━━━━━━━━━━━━━━━━━━━━\n\n' +
      '<b>💡 ویژگی‌ها:</b>\n' +
      '✅ بکاپ خودکار تمام پیام‌ها\n' +
      '✅ پشتیبانی از متن، عکس، ویدیو، فایل، صوت\n' +
      '✅ فایل‌های تا 25 مگابایت\n' +
      '✅ حفظ ترتیب پیام‌ها در بازیابی\n' +
      '✅ مدیریت چند کانال همزمان\n' +
      '✅ امن و سریع\n\n' +
      '<b>⚠️ نکات مهم:</b>\n' +
      '• ربات باید ادمین کانال باشد\n' +
      '• فایل‌های بزرگتر از 25MB بکاپ نمی‌شوند\n' +
      '• در بازیابی، ربات در کانال مقصد هم باید ادمین باشد\n' +
      '• بکاپ‌ها به صورت امن در سرور ذخیره می‌شود\n\n' +
      '━━━━━━━━━━━━━━━━━━━━\n\n' +
      '💬 سوال یا مشکل دارید؟ با پشتیبانی تماس بگیرید.'
    );
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
        version: '2.0.0'
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
