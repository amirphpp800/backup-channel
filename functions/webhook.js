
import { handleUpdate } from '../main.js';

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const update = await request.json();
    
    // Process update in background
    const promise = handleUpdate(update, env, { waitUntil });
    if (waitUntil && promise) {
      waitUntil(promise);
    }
    
    // Respond immediately to Telegram
    return new Response('OK', { 
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });
  } catch (err) {
    console.error('Webhook error:', err);
    return new Response('Bad Request', { status: 400 });
  }
}

export async function onRequestGet({ env }) {
  const html = `
    <!DOCTYPE html>
    <html dir="rtl" lang="fa">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Telegram Webhook Endpoint</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          margin: 0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }
        .container {
          text-align: center;
          background: rgba(255,255,255,0.1);
          padding: 40px;
          border-radius: 20px;
          backdrop-filter: blur(10px);
        }
        h1 { margin-bottom: 20px; }
        p { font-size: 14px; opacity: 0.9; }
        .status {
          margin-top: 20px;
          padding: 10px 20px;
          background: ${!!env.TELEGRAM_BOT_TOKEN && !!env.DB ? '#28a745' : '#ffc107'};
          border-radius: 10px;
          display: inline-block;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 Telegram Webhook Endpoint</h1>
        <p>این endpoint برای دریافت پیام‌های تلگرام است.</p>
        <p>فقط سرورهای تلگرام می‌توانند به این آدرس POST ارسال کنند.</p>
        <div class="status">
          ${!!env.TELEGRAM_BOT_TOKEN && !!env.DB ? '✅ سرویس فعال' : '⚠️ نیاز به تنظیمات'}
        </div>
      </div>
    </body>
    </html>
  `;
  
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
