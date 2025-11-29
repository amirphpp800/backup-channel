
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

// Check if message is already backed up
async function isMessageBackedUp(DB, channelId, messageId) {
  const existing = await DB.get(`backup:${channelId}:${messageId}`);
  return !!existing;
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

// Get last N backup messages for a channel
async function getLastBackups(DB, channelId, count = 50) {
  const allBackups = await getChannelBackups(DB, channelId);
  return allBackups.slice(-count);
}

// Backup a single message
async function backupMessage(token, DB, channelId, messageId) {
  try {
    // Check if already backed up
    if (await isMessageBackedUp(DB, channelId, messageId)) {
      return { success: true, exists: true };
    }

    const result = await telegramRequest(token, 'forwardMessage', {
      chat_id: channelId,
      from_chat_id: channelId,
      message_id: messageId
    });

    if (!result.ok) {
      return { success: false, error: result.description };
    }

    // Get message details
    const msgResult = await telegramRequest(token, 'getUpdates', {
      offset: -1,
      limit: 1
    });

    // Try to get message by copying it
    const copyResult = await telegramRequest(token, 'copyMessage', {
      chat_id: channelId,
      from_chat_id: channelId,
      message_id: messageId
    });

    if (copyResult.ok) {
      // Delete the copied message
      await telegramRequest(token, 'deleteMessage', {
        chat_id: channelId,
        message_id: copyResult.result.message_id
      });
    }

    // Save minimal backup info
    const backupData = {
      message_id: messageId,
      date: Date.now(),
      backed_up: true
    };

    await saveBackupMessage(DB, channelId, messageId, backupData);
    return { success: true, exists: false };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Backup existing messages when channel is added
async function backupExistingMessages(token, DB, channelId, userId) {
  let backedUpCount = 0;
  let failedCount = 0;
  let currentMessageId = null;

  try {
    // Get latest message ID from channel
    const updates = await telegramRequest(token, 'getUpdates', {
      offset: -1,
      limit: 100
    });

    // Try to find the latest message ID for this channel
    let latestMessageId = 1000; // Start from a reasonable number

    // Try to get chat info which might have message count
    const chatInfo = await telegramRequest(token, 'getChat', { 
      chat_id: channelId 
    });

    if (chatInfo.ok) {
      // Start from a high number and work backwards
      latestMessageId = 10000;
    }

    // Notify user that backup is starting
    await sendMessage(token, userId, 
      '⏳ <b>شروع بکاپ‌گیری پیام‌های قبلی...</b>\n\n' +
      '📺 این فرآیند ممکن است چند دقیقه طول بکشد.\n' +
      '💡 پیام‌ها از جدیدترین به قدیمی‌ترین بکاپ می‌شوند.\n\n' +
      'لطفا صبر کنید...'
    );

    // Try to find messages by going backwards from latest
    let consecutiveFailures = 0;
    const maxConsecutiveFailures = 50; // Stop after 50 consecutive failures

    for (let msgId = latestMessageId; msgId > 0 && consecutiveFailures < maxConsecutiveFailures; msgId--) {
      currentMessageId = msgId;

      // Try to forward message to check if it exists
      const forwardResult = await telegramRequest(token, 'forwardMessage', {
        chat_id: channelId,
        from_chat_id: channelId,
        message_id: msgId
      });

      if (forwardResult.ok) {
        consecutiveFailures = 0; // Reset counter

        // Delete the forwarded message
        await telegramRequest(token, 'deleteMessage', {
          chat_id: channelId,
          message_id: forwardResult.result.message_id
        });

        // Check if already backed up
        if (await isMessageBackedUp(DB, channelId, msgId)) {
          continue;
        }

        // Save backup
        const backupData = {
          message_id: msgId,
          date: forwardResult.result.date || Date.now(),
          backed_up: true,
          original_exists: true
        };

        await saveBackupMessage(DB, channelId, msgId, backupData);
        backedUpCount++;

        // Send progress update every 20 messages
        if (backedUpCount % 20 === 0) {
          await sendMessage(token, userId, 
            `📊 <b>پیشرفت بکاپ:</b> ${backedUpCount} پیام ذخیره شد...`
          );
        }

        // Rate limiting - wait between requests
        await new Promise(resolve => setTimeout(resolve, 100));

      } else {
        consecutiveFailures++;
      }

      // Extra delay after failures
      if (consecutiveFailures > 0) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    return { success: true, count: backedUpCount, failed: failedCount };

  } catch (err) {
    console.error('Error in backupExistingMessages:', err);
    return { success: false, error: err.message, count: backedUpCount };
  }
}

// Enhanced backup for channel posts with file info
async function backupChannelPost(DB, message) {
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
    voice: message.voice ? message.voice.file_id : null,
    video_note: message.video_note ? message.video_note.file_id : null,
    sticker: message.sticker ? message.sticker.file_id : null,
    animation: message.animation ? message.animation.file_id : null,
    backed_up: true,
    auto_backup: true
  };

  await saveBackupMessage(DB, channelId, messageId, backupData);
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
      } else if (backup.animation) {
        await telegramRequest(token, 'sendAnimation', {
          chat_id: targetChannelId,
          animation: backup.animation,
          caption: backup.caption || ''
        });
        restored++;
      } else if (backup.sticker) {
        await telegramRequest(token, 'sendSticker', {
          chat_id: targetChannelId,
          sticker: backup.sticker
        });
        restored++;
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (err) {
      console.error('Error restoring message:', err);
    }
  }
  
  return restored;
}

// Resolve channel username to ID
async function resolveChannelId(token, channelInput) {
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
  
  // Handle callback queries (button clicks)
  if (update.callback_query) {
    const callbackQuery = update.callback_query;
    const userId = callbackQuery.from.id;
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.callback_data;
    
    // Answer callback query to remove loading state
    await telegramRequest(token, 'answerCallbackQuery', {
      callback_query_id: callbackQuery.id
    });
    
    if (data.startsWith('restore_source:')) {
      const sourceId = data.replace('restore_source:', '');
      
      // Save selected source channel
      await DB.put(`restore_temp:${userId}:source`, sourceId);
      
      const userData = await getUserData(DB, userId);
      const sourceChannel = userData.channels.find(ch => ch.id === sourceId);
      
      await sendMessage(token, chatId,
        '✅ <b>کانال مبدا انتخاب شد</b>\n\n' +
        '📺 ' + (sourceChannel ? sourceChannel.title : sourceId) + '\n\n' +
        '🔹 <b>مرحله 2:</b> ID یا username کانال مقصد را ارسال کنید:\n\n' +
        'مثال:\n' +
        '• <code>@newchannel</code>\n' +
        '• <code>-1001234567890</code>\n\n' +
        '⚠️ ربات باید در کانال مقصد ادمین باشد.'
      );
      
      // Set state for next message
      await DB.put(`restore_state:${userId}`, 'waiting_target');
    }
    
    return;
  }
  
  const message = update.message || update.channel_post;
  if (!message) return;
  
  const userId = message.from?.id;
  const chatId = message.chat.id;
  const text = message.text || '';
  
  // Handle channel posts (automatic backup)
  if (update.channel_post) {
    await backupChannelPost(DB, message);
    return;
  }
  
  // Handle private messages (bot commands)
  if (!userId) return;
  
  // Check if user is in restore flow
  const restoreState = await DB.get(`restore_state:${userId}`);
  
  if (restoreState === 'waiting_target' && text && !text.startsWith('/')) {
    const sourceId = await DB.get(`restore_temp:${userId}:source`);
    const targetId = await resolveChannelId(token, text.trim());
    
    if (!targetId) {
      await sendMessage(token, chatId, 
        '❌ فرمت کانال نامعتبر است!\n\n' +
        'لطفا ID یا username صحیح وارد کنید.'
      );
      return;
    }
    
    try {
      const sourceChat = await telegramRequest(token, 'getChat', { chat_id: sourceId });
      const targetChat = await telegramRequest(token, 'getChat', { chat_id: targetId });
      
      if (!sourceChat.ok || !targetChat.ok) {
        await sendMessage(token, chatId, 
          '❌ خطا در دسترسی!\n\n' +
          'مطمئن شوید ربات در هر دو کانال ادمین است.'
        );
        return;
      }
      
      const backupCount = (await DB.list({ prefix: `backup:${sourceId}:` })).keys.length;
      
      if (backupCount === 0) {
        await sendMessage(token, chatId, '❌ هیچ بکاپی یافت نشد!');
        await DB.delete(`restore_state:${userId}`);
        await DB.delete(`restore_temp:${userId}:source`);
        return;
      }
      
      await sendMessage(token, chatId, 
        '⏳ <b>شروع بازیابی...</b>\n\n' +
        '📺 مبدا: <b>' + sourceChat.result.title + '</b>\n' +
        '📺 مقصد: <b>' + targetChat.result.title + '</b>\n' +
        '💾 تعداد: ' + backupCount + '\n\n' +
        'این فرآیند ممکن است چند دقیقه طول بکشد...'
      );
      
      // Start background restore
      context.waitUntil(
        (async () => {
          const restored = await restoreBackup(token, DB, sourceId, targetId);
          
          await sendMessage(token, userId, 
            '✅ <b>بازیابی تکمیل شد!</b>\n\n' +
            '📊 منتقل شده: ' + restored + ' پیام\n' +
            '📺 مقصد: <b>' + targetChat.result.title + '</b>\n\n' +
            '🎉 تمام بکاپ‌ها با موفقیت به کانال جدید منتقل شدند!'
          );
        })()
      );
      
      // Clean up state
      await DB.delete(`restore_state:${userId}`);
      await DB.delete(`restore_temp:${userId}:source`);
      
    } catch (err) {
      console.error('Restore error:', err);
      await sendMessage(token, chatId, 
        '❌ خطا در بازیابی!\n\n' +
        'خطا: ' + err.message
      );
      await DB.delete(`restore_state:${userId}`);
      await DB.delete(`restore_temp:${userId}:source`);
    }
    
    return;
  }
  
  if (text.startsWith('/start')) {
    await sendMessage(token, chatId, 
      '🤖 <b>به ربات بکاپ‌گیری کانال خوش آمدید!</b>\n\n' +
      '📋 <b>دستورات موجود:</b>\n' +
      '/addchannel [کانال] - افزودن کانال\n' +
      '/manualbackup [کانال] - بکاپ دستی\n' +
      '/channels - لیست کانال‌ها\n' +
      '/backup - مشاهده بکاپ‌ها\n' +
      '/trust [کانال] - نمایش 50 پیام آخر\n' +
      '/restore - انتقال بکاپ (با دکمه)\n' +
      '/removechannel [کانال] - حذف کانال\n' +
      '/help - راهنمای کامل\n\n' +
      '💡 <b>نحوه استفاده:</b>\n' +
      '• <code>/addchannel @mychannel</code>\n' +
      '• <code>/manualbackup @mychannel</code>\n' +
      '• سپس پیام‌ها را فوروارد کنید\n\n' +
      '✨ <b>ویژگی‌های جدید:</b>\n' +
      '🔹 بکاپ خودکار پیام‌های قبلی\n' +
      '🔹 بکاپ دستی با فوروارد\n' +
      '🔹 انتقال آسان با دکمه شیشه‌ای'
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
        '2️⃣ ربات را ادمین کانال کنید (با دسترسی حذف پیام)\n' +
        '3️⃣ سپس دستور را با ID یا username کانال ارسال کنید\n\n' +
        '💡 <b>نکته:</b> برای دریافت ID کانال می‌توانید از @userinfobot استفاده کنید.\n\n' +
        '✨ <b>قابلیت جدید:</b> تمام پیام‌های قبلی کانال نیز به صورت خودکار بکاپ می‌شود!'
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
          '3️⃣ ربات دسترسی "حذف پیام" دارد\n\n' +
          '💡 پس از اضافه کردن ربات، چند ثانیه صبر کنید و دوباره تلاش کنید.'
        );
        return;
      }
      
      const userData = await getUserData(DB, userId);
      
      if (userData.channels.find(ch => ch.id === channelId)) {
        await sendMessage(token, chatId, 
          '⚠️ <b>این کانال قبلا اضافه شده است!</b>\n\n' +
          '📺 نام کانال: <b>' + chatInfo.result.title + '</b>\n' +
          '🆔 ID: <code>' + channelId + '</code>\n\n' +
          'برای مشاهده لیست کانال‌ها از دستور /channels استفاده کنید.'
        );
        return;
      }
      
      // Add channel
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
        '⏳ <b>در حال شروع بکاپ‌گیری پیام‌های قبلی...</b>\n' +
        'این فرآیند در پس‌زمینه انجام می‌شود و چند دقیقه طول می‌کشد.'
      );

      // Start background backup of existing messages
      context.waitUntil(
        (async () => {
          const backupResult = await backupExistingMessages(token, DB, channelId, userId);
          
          if (backupResult.success) {
            await sendMessage(token, userId, 
              '🎉 <b>بکاپ‌گیری اولیه تکمیل شد!</b>\n\n' +
              '📺 کانال: <b>' + chatInfo.result.title + '</b>\n' +
              '💾 تعداد پیام‌های بکاپ شده: ' + backupResult.count + '\n\n' +
              '✅ از این لحظه تمام پیام‌های جدید نیز به صورت خودکار بکاپ می‌شود.\n\n' +
              '💡 برای مشاهده بکاپ‌ها از دستور /trust استفاده کنید.'
            );
          } else {
            await sendMessage(token, userId, 
              '⚠️ <b>بکاپ‌گیری اولیه با مشکل مواجه شد</b>\n\n' +
              '💾 پیام‌های بکاپ شده: ' + backupResult.count + '\n' +
              '❌ خطا: ' + (backupResult.error || 'نامشخص') + '\n\n' +
              '✅ پیام‌های جدید همچنان به صورت خودکار بکاپ می‌شوند.\n' +
              '💡 می‌توانید دوباره کانال را حذف و اضافه کنید.'
            );
          }
        })()
      );
      
    } catch (err) {
      console.error('Error adding channel:', err);
      await sendMessage(token, chatId, 
        '❌ <b>خطا در پردازش درخواست!</b>\n\n' +
        'لطفا:\n' +
        '• اتصال اینترنت خود را بررسی کنید\n' +
        '• چند لحظه بعد دوباره تلاش کنید\n' +
        '• مطمئن شوید ربات در کانال ادمین است\n\n' +
        'خطا: ' + err.message
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
      '💾 بکاپ‌های این کانال همچنان در سیستم موجود است.'
    );
  }
  
  else if (text.startsWith('/channels')) {
    const userData = await getUserData(DB, userId);
    
    if (userData.channels.length === 0) {
      await sendMessage(token, chatId, 
        '❌ <b>شما هنوز کانالی اضافه نکرده‌اید!</b>\n\n' +
        'برای افزودن کانال از دستور زیر استفاده کنید:\n' +
        '<code>/addchannel @yourchannel</code>'
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
    
    channelList += '💡 برای حذف: <code>/removechannel [ID]</code>';
    
    await sendMessage(token, chatId, channelList);
  }
  
  else if (text.startsWith('/backup')) {
    const userData = await getUserData(DB, userId);
    
    if (userData.channels.length === 0) {
      await sendMessage(token, chatId, '❌ شما هنوز کانالی اضافه نکرده‌اید.');
      return;
    }
    
    let backupInfo = '💾 <b>اطلاعات بکاپ:</b>\n\n';
    let totalBackups = 0;
    
    for (const ch of userData.channels) {
      const backups = await getChannelBackups(DB, ch.id);
      totalBackups += backups.length;
      
      backupInfo += `📺 <b>${ch.title}</b>\n`;
      backupInfo += `   💾 تعداد: ${backups.length} پیام\n`;
      
      if (backups.length > 0) {
        const lastBackup = backups[backups.length - 1];
        backupInfo += `   📅 آخرین: ${new Date(lastBackup.date * 1000).toLocaleString('fa-IR')}\n`;
      }
      
      backupInfo += '\n';
    }
    
    backupInfo += `📊 <b>مجموع:</b> ${totalBackups} پیام\n\n`;
    backupInfo += '💡 دستور /restore برای انتقال بکاپ';
    
    await sendMessage(token, chatId, backupInfo);
  }
  
  else if (text.startsWith('/trust')) {
    const parts = text.trim().split(/\s+/);
    
    if (parts.length < 2) {
      await sendMessage(token, chatId,
        '🔍 <b>راهنمای بررسی بکاپ:</b>\n\n' +
        '<code>/trust [کانال]</code>\n\n' +
        'مثال: <code>/trust @mychannel</code>\n\n' +
        '📊 نمایش 50 پیام آخر بکاپ شده'
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
    const channel = userData.channels.find(ch => ch.id === channelId);
    
    if (!channel) {
      await sendMessage(token, chatId, 
        '❌ این کانال در لیست شما یافت نشد!\n\n' +
        'ابتدا با <code>/addchannel</code> اضافه کنید.'
      );
      return;
    }
    
    await sendMessage(token, chatId, '⏳ در حال دریافت بکاپ‌ها...');
    
    const lastBackups = await getLastBackups(DB, channelId, 50);
    
    if (lastBackups.length === 0) {
      await sendMessage(token, chatId, 
        '❌ هیچ بکاپی یافت نشد!\n\n' +
        '📺 کانال: <b>' + channel.title + '</b>'
      );
      return;
    }
    
    await sendMessage(token, chatId, 
      '✅ <b>بکاپ‌های کانال:</b>\n\n' +
      '📺 <b>' + channel.title + '</b>\n' +
      '📊 تعداد: ' + lastBackups.length + ' پیام\n\n' +
      '⏰ در حال ارسال...'
    );
    
    let sentCount = 0;
    
    for (const backup of lastBackups) {
      try {
        const dateStr = new Date(backup.date * 1000).toLocaleString('fa-IR');
        const prefix = `📄 #${backup.message_id}\n📅 ${dateStr}\n\n`;
        
        if (backup.text) {
          await sendMessage(token, chatId, prefix + backup.text);
          sentCount++;
        } else if (backup.photo) {
          await telegramRequest(token, 'sendPhoto', {
            chat_id: chatId,
            photo: backup.photo,
            caption: `📸 #${backup.message_id}\n${backup.caption || ''}`
          });
          sentCount++;
        } else if (backup.video) {
          await telegramRequest(token, 'sendVideo', {
            chat_id: chatId,
            video: backup.video,
            caption: `🎥 #${backup.message_id}\n${backup.caption || ''}`
          });
          sentCount++;
        } else if (backup.document) {
          await telegramRequest(token, 'sendDocument', {
            chat_id: chatId,
            document: backup.document,
            caption: `📎 #${backup.message_id}\n${backup.caption || ''}`
          });
          sentCount++;
        } else if (backup.audio) {
          await telegramRequest(token, 'sendAudio', {
            chat_id: chatId,
            audio: backup.audio,
            caption: `🎵 #${backup.message_id}\n${backup.caption || ''}`
          });
          sentCount++;
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (err) {
        console.error('Error sending backup:', err);
      }
    }
    
    await sendMessage(token, chatId, 
      `✅ <b>اتمام ارسال</b>\n\n` +
      `📊 ارسال شده: ${sentCount} پیام`
    );
  }
  
  else if (text.startsWith('/manualbackup')) {
    const parts = text.trim().split(/\s+/);
    
    if (parts.length < 2) {
      await sendMessage(token, chatId,
        '📥 <b>راهنمای بکاپ دستی:</b>\n\n' +
        '<code>/manualbackup [کانال]</code>\n\n' +
        'مثال: <code>/manualbackup @mychannel</code>\n\n' +
        '💡 در صورت شکست بکاپ خودکار، پیام‌ها را از کانال به ربات فوروارد کنید.\n' +
        'ربات به صورت خودکار آن‌ها را ذخیره می‌کند.'
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
    const channel = userData.channels.find(ch => ch.id === channelId);
    
    if (!channel) {
      await sendMessage(token, chatId, 
        '❌ این کانال در لیست شما یافت نشد!\n\n' +
        'ابتدا با <code>/addchannel</code> اضافه کنید.'
      );
      return;
    }
    
    // Set manual backup mode
    await DB.put(`manual_backup:${userId}`, channelId);
    
    await sendMessage(token, chatId,
      '✅ <b>حالت بکاپ دستی فعال شد!</b>\n\n' +
      '📺 کانال: <b>' + channel.title + '</b>\n\n' +
      '📝 <b>راهنما:</b>\n' +
      '1️⃣ به کانال خود بروید\n' +
      '2️⃣ پیام‌های مورد نظر را انتخاب کنید\n' +
      '3️⃣ آن‌ها را به این ربات فوروارد کنید\n\n' +
      '💾 ربات به صورت خودکار پیام‌های فوروارد شده را بکاپ می‌گیرد.\n\n' +
      '⏹ برای توقف: <code>/stopmanual</code>'
    );
  }
  
  else if (text.startsWith('/stopmanual')) {
    await DB.delete(`manual_backup:${userId}`);
    await sendMessage(token, chatId, 
      '⏹ <b>حالت بکاپ دستی غیرفعال شد.</b>\n\n' +
      'پیام‌های فوروارد شده دیگر ذخیره نمی‌شوند.'
    );
  }
  
  else if (text.startsWith('/restore')) {
    const userData = await getUserData(DB, userId);
    
    if (userData.channels.length === 0) {
      await sendMessage(token, chatId, '❌ شما هنوز کانالی اضافه نکرده‌اید.');
      return;
    }
    
    // Create inline keyboard with channels
    const keyboard = {
      inline_keyboard: userData.channels.map(ch => [{
        text: `📺 ${ch.title}`,
        callback_data: `restore_source:${ch.id}`
      }])
    };
    
    await sendMessage(token, chatId, 
      '📤 <b>انتقال بکاپ به کانال جدید</b>\n\n' +
      '🔹 <b>مرحله 1:</b> کانال مبدا را انتخاب کنید:\n\n' +
      '(کانالی که بکاپ‌هایش را می‌خواهید منتقل کنید)',
      { reply_markup: keyboard }
    );
  }
  
  else if (message.forward_from_chat) {
    // Handle forwarded messages for manual backup
    const manualBackupChannel = await DB.get(`manual_backup:${userId}`);
    
    if (manualBackupChannel && message.forward_from_chat.id.toString() === manualBackupChannel) {
      const forwardedMsg = message;
      const channelId = message.forward_from_chat.id;
      const originalMessageId = message.forward_from_message_id;
      
      // Check if already backed up
      if (await isMessageBackedUp(DB, channelId, originalMessageId)) {
        await sendMessage(token, chatId, '⚠️ این پیام قبلا بکاپ گرفته شده است.');
        return;
      }
      
      // Save manual backup
      const backupData = {
        message_id: originalMessageId,
        date: forwardedMsg.forward_date || Date.now(),
        text: forwardedMsg.text,
        caption: forwardedMsg.caption,
        photo: forwardedMsg.photo ? forwardedMsg.photo[forwardedMsg.photo.length - 1].file_id : null,
        video: forwardedMsg.video ? forwardedMsg.video.file_id : null,
        document: forwardedMsg.document ? forwardedMsg.document.file_id : null,
        audio: forwardedMsg.audio ? forwardedMsg.audio.file_id : null,
        voice: forwardedMsg.voice ? forwardedMsg.voice.file_id : null,
        backed_up: true,
        manual_backup: true
      };
      
      await saveBackupMessage(DB, channelId, originalMessageId, backupData);
      
      await sendMessage(token, chatId, 
        '✅ بکاپ شد!\n\n' +
        '📄 پیام #' + originalMessageId
      );
    }
  }
  
  else if (text.startsWith('/help')) {
    await sendMessage(token, chatId,
      '📖 <b>راهنمای کامل</b>\n\n' +
      '━━━━━━━━━━━━━━━━\n\n' +
      '<b>🚀 شروع:</b>\n' +
      '1️⃣ ربات را به کانال اضافه کنید\n' +
      '2️⃣ ربات را ادمین کنید (دسترسی حذف پیام)\n' +
      '3️⃣ دستور: <code>/addchannel @channel</code>\n\n' +
      '<b>📋 دستورات:</b>\n\n' +
      '<b>/addchannel [کانال]</b>\n' +
      '↳ افزودن کانال + بکاپ خودکار\n\n' +
      '<b>/manualbackup [کانال]</b>\n' +
      '↳ بکاپ دستی با فوروارد پیام‌ها\n\n' +
      '<b>/channels</b>\n' +
      '↳ لیست کانال‌ها و آمار\n\n' +
      '<b>/backup</b>\n' +
      '↳ مشاهده تعداد بکاپ‌ها\n\n' +
      '<b>/trust [کانال]</b>\n' +
      '↳ نمایش 50 پیام آخر\n\n' +
      '<b>/restore</b>\n' +
      '↳ انتقال بکاپ با دکمه (مرحله‌ای)\n\n' +
      '<b>/removechannel [کانال]</b>\n' +
      '↳ حذف کانال از لیست\n\n' +
      '━━━━━━━━━━━━━━━━\n\n' +
      '<b>✨ ویژگی‌ها:</b>\n' +
      '✅ بکاپ خودکار پیام‌های جدید\n' +
      '✅ بکاپ پیام‌های قبلی هنگام افزودن\n' +
      '✅ بکاپ دستی با فوروارد\n' +
      '✅ انتقال آسان با دکمه شیشه‌ای\n' +
      '✅ متن، عکس، ویدیو، فایل، صوت\n' +
      '✅ فایل‌های تا 25MB\n' +
      '✅ مدیریت چند کانال\n' +
      '✅ حفظ ترتیب در بازیابی\n\n' +
      '<b>📥 بکاپ دستی:</b>\n' +
      '1️⃣ <code>/manualbackup @channel</code>\n' +
      '2️⃣ پیام‌ها را از کانال فوروارد کنید\n' +
      '3️⃣ <code>/stopmanual</code> برای پایان\n\n' +
      '<b>⚠️ نکات:</b>\n' +
      '• ربات باید ادمین باشد\n' +
      '• دسترسی "حذف پیام" ضروری است\n' +
      '• فایل‌های بالای 25MB بکاپ نمی‌شوند'
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
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
    .version {
      display: inline-block;
      background: #667eea;
      color: white;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 11px;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="panel">
    <h1>🤖 پنل ربات بکاپ تلگرام</h1>
    <p class="subtitle">Cloudflare Pages • نسخه 3.0</p>
    
    <div class="status ${tokenSet ? 'success' : 'error'}">
      <span class="status-label">🔑 توکن تلگرام</span>
      <span class="status-icon">${tokenSet ? '✅' : '❌'}</span>
    </div>
    
    <div class="status ${kvConnected ? 'success' : 'error'}">
      <span class="status-label">💾 دیتابیس KV</span>
      <span class="status-icon">${kvConnected ? '✅' : '❌'}</span>
    </div>
    
    <div class="status-summary">
      ${tokenSet && kvConnected 
        ? '✅ سیستم آماده و در حال اجرا' 
        : '⚠️ نیاز به تکمیل تنظیمات'}
    </div>
    
    <div class="info">
      <h3>✨ قابلیت‌های جدید نسخه 3.0</h3>
      <ul>
        <li>✅ بکاپ خودکار پیام‌های قبلی هنگام افزودن کانال</li>
        <li>✅ بکاپ از آخرین به اولین پیام</li>
        <li>✅ نمایش پیشرفت بکاپ‌گیری</li>
        <li>✅ پشتیبانی از انواع فایل (استیکر، انیمیشن، ...)</li>
        <li>✅ بهبود سرعت و پایداری</li>
      </ul>
    </div>
    
    <div class="info">
      <h3>⚙️ تنظیمات</h3>
      <ul>
        <li><code>TELEGRAM_BOT_TOKEN</code> در Environment Variables</li>
        <li>KV Namespace با Binding Name = <code>DB</code></li>
        <li>ربات باید دسترسی "حذف پیام" داشته باشد</li>
      </ul>
    </div>
    
    <div class="footer">
      Powered by Cloudflare Pages<br>
      <span class="version">v3.0.0 - Auto Backup</span>
    </div>
  </div>
</body>
</html>`;
}

// Main export
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    if (url.pathname === '/api/status') {
      return new Response(JSON.stringify({
        token_set: !!env.TELEGRAM_BOT_TOKEN,
        kv_connected: !!env.DB,
        timestamp: Date.now(),
        version: '3.0.0'
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    if (url.pathname === '/' || url.pathname === '') {
      const html = getPanelHTML(!!env.TELEGRAM_BOT_TOKEN, !!env.DB);
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    
    return new Response('Not Found', { status: 404 });
  }
};
