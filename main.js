// ═════════════════════════════════════════════════════════════════════════════
// 🔧 CONFIGURATION & CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════

const TELEGRAM_BASE = (token) => `https://api.telegram.org/bot${token}`;
// Helper function to get admin ID from env or fallback to default
const getAdminId = (env) => (env && env.ADMIN_ID) ? Number(env.ADMIN_ID) : 7240662021;

// ─────────────────────────────────────────────────────────────────────────────
// 📤 Response Helpers
// ─────────────────────────────────────────────────────────────────────────────

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });


// ═════════════════════════════════════════════════════════════════════════════
// 👥 USER QUOTA & HISTORY MANAGEMENT
// ═════════════════════════════════════════════════════════════════════════════
function todayKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// محاسبه زمان باقی‌مانده تا ریست سهمیه (نیمه‌شب UTC)
function getTimeUntilReset() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCHours(24, 0, 0, 0);

  const diff = tomorrow - now;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  return `${hours} ساعت و ${minutes} دقیقه`;
}

async function getUserQuota(kv, userId, type, adminId = 7240662021) {
  const key = `quota:${type}:${userId}:${todayKey()}`;
  const raw = await kv.get(key);
  const count = raw ? Number(raw) || 0 : 0;
  // ادمین محدودیت ندارد
  const limit = Number(userId) === Number(adminId) ? 999999 : 3;
  return { count, limit };
}

async function incUserQuota(kv, userId, type) {
  const key = `quota:${type}:${userId}:${todayKey()}`;
  const raw = await kv.get(key);
  const count = raw ? Number(raw) || 0 : 0;
  const next = count + 1;
  await kv.put(key, String(next), { expirationTtl: 86400 });
  return next;
}

async function addUserHistory(kv, userId, type, item) {
  const key = `history:${type}:${userId}`;
  const raw = await kv.get(key);
  const arr = raw ? JSON.parse(raw) : [];
  arr.unshift({ item, ts: Date.now() });
  while (arr.length > 10) arr.pop();
  await kv.put(key, JSON.stringify(arr));
}

async function getUserHistory(kv, userId, type) {
  const key = `history:${type}:${userId}`;
  const raw = await kv.get(key);
  return raw ? JSON.parse(raw) : [];
}

const html = (s) =>
  new Response(s, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });


// ═════════════════════════════════════════════════════════════════════════════
// 📨 TELEGRAM API HELPERS
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// 📤 ارسال فایل به تلگرام (sendDocument)
// ─────────────────────────────────────────────────────────────────────────────
async function telegramUpload(env, method, formData) {
  try {
    const res = await fetch(`${TELEGRAM_BASE(env.BOT_TOKEN)}/${method}`, {
      method: 'POST',
      body: formData
    });
    return await res.json();
  } catch (e) {
    console.error('خطا در Telegram Upload:', e);
    return {};
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// 🛰️ WIREGUARD CONFIGURATION & HELPERS
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// 🔢 WireGuard Constants
// ─────────────────────────────────────────────────────────────────────────────

const WG_MTUS = [1280, 1320, 1360, 1380, 1400, 1420, 1440, 1480, 1500];
const WG_FIXED_DNS = [
  '1.1.1.1', '1.0.0.1', '8.8.8.8', '8.8.4.4', '9.9.9.9', '10.202.10.10', '78.157.42.100', '208.67.222.222', '208.67.220.220', '185.55.226.26', '185.55.225.25', '185.51.200.2'
];
const OPERATORS = {
  irancell: { title: 'ایرانسل', addresses: ['2.144.0.0/16'] },
  mci: { title: 'همراه اول', addresses: ['5.52.0.0/16'] },
  tci: { title: 'مخابرات', addresses: ['2.176.0.0/15', '2.190.0.0/15'] },
  rightel: { title: 'رایتل', addresses: ['37.137.128.0/17', '95.162.0.0/17'] },
  shatel: { title: 'شاتل موبایل', addresses: ['94.182.0.0/16', '37.148.0.0/18'] }
};

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randName8() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function generateWgFilename(namingType, countryCode) {
  if (namingType === 'location' && countryCode) {
    // استفاده از نام انگلیسی کشور برای نام فایل
    const countryNameEn = getCountryNameEnglish(countryCode);
    return countryNameEn;
  } else {
    // نام تصادفی (پیش‌فرض)
    const randomNum = String(randInt(10000, 99999));
    return `JOJO${randomNum}`;
  }
}

function getCountryNameEnglish(code) {
  const map = {
    'US': 'USA', 'CA': 'Canada', 'MX': 'Mexico',
    'GB': 'UK', 'DE': 'Germany', 'FR': 'France', 'NL': 'Netherlands', 'BE': 'Belgium',
    'CH': 'Switzerland', 'AT': 'Austria', 'IE': 'Ireland', 'LU': 'Luxembourg',
    'IT': 'Italy', 'ES': 'Spain', 'PT': 'Portugal', 'GR': 'Greece', 'MT': 'Malta',
    'SE': 'Sweden', 'NO': 'Norway', 'DK': 'Denmark', 'FI': 'Finland', 'IS': 'Iceland',
    'EE': 'Estonia', 'LV': 'Latvia', 'LT': 'Lithuania',
    'PL': 'Poland', 'CZ': 'Czechia', 'SK': 'Slovakia', 'HU': 'Hungary', 'RO': 'Romania',
    'BG': 'Bulgaria', 'UA': 'Ukraine', 'BY': 'Belarus', 'MD': 'Moldova',
    'RS': 'Serbia', 'HR': 'Croatia', 'SI': 'Slovenia', 'BA': 'Bosnia',
    'MK': 'Macedonia', 'AL': 'Albania', 'ME': 'Montenegro', 'XK': 'Kosovo',
    'RU': 'Russia', 'KZ': 'Kazakhstan', 'UZ': 'Uzbekistan', 'TM': 'Turkmenistan',
    'KG': 'Kyrgyzstan', 'TJ': 'Tajikistan', 'AM': 'Armenia', 'AZ': 'Azerbaijan', 'GE': 'Georgia',
    'IR': 'Iran', 'TR': 'Turkey', 'AE': 'UAE', 'SA': 'Saudi', 'IL': 'Israel',
    'IQ': 'Iraq', 'SY': 'Syria', 'JO': 'Jordan', 'LB': 'Lebanon', 'PS': 'Palestine',
    'KW': 'Kuwait', 'QA': 'Qatar', 'BH': 'Bahrain', 'OM': 'Oman', 'YE': 'Yemen', 'CY': 'Cyprus',
    'DZ': 'Algeria', 'EG': 'Egypt', 'MA': 'Morocco', 'TN': 'Tunisia', 'LY': 'Libya',
    'ZA': 'SouthAfrica', 'NG': 'Nigeria', 'KE': 'Kenya', 'ET': 'Ethiopia', 'GH': 'Ghana',
    'CN': 'China', 'JP': 'Japan', 'KR': 'SouthKorea', 'KP': 'NorthKorea', 'TW': 'Taiwan',
    'HK': 'HongKong', 'MO': 'Macau', 'MN': 'Mongolia',
    'TH': 'Thailand', 'VN': 'Vietnam', 'SG': 'Singapore', 'MY': 'Malaysia', 'ID': 'Indonesia',
    'PH': 'Philippines', 'MM': 'Myanmar', 'KH': 'Cambodia', 'LA': 'Laos', 'BN': 'Brunei',
    'IN': 'India', 'PK': 'Pakistan', 'BD': 'Bangladesh', 'LK': 'SriLanka', 'NP': 'Nepal',
    'BT': 'Bhutan', 'MV': 'Maldives', 'AF': 'Afghanistan',
    'AU': 'Australia', 'NZ': 'NewZealand', 'FJ': 'Fiji',
    'AR': 'Argentina', 'BR': 'Brazil', 'CL': 'Chile', 'CO': 'Colombia',
    'PE': 'Peru', 'VE': 'Venezuela', 'UY': 'Uruguay'
  };
  return map[code.toUpperCase()] || code.toUpperCase();
}

function b64(bytes) {
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  const base = btoa(bin);
  return base;
}

async function generateWireGuardKeys() {
  // Generate a WireGuard-compatible private key (32 random bytes, base64)
  const rawPriv = new Uint8Array(32);
  crypto.getRandomValues(rawPriv);

  // Apply WireGuard key clamping:
  // - Clear the 3 least significant bits of the first byte
  // - Clear the most significant bit of the last byte
  // - Set the second most significant bit of the last byte
  rawPriv[0] &= 248;  // 11111000 - clear bottom 3 bits
  rawPriv[31] &= 127; // 01111111 - clear top bit
  rawPriv[31] |= 64;  // 01000000 - set second top bit

  return { privateKey: b64(rawPriv), publicKey: null };
}

function buildWgConf({ privateKey, addresses, dns, mtu, listenPort }) {
  let addrLines = '';
  if (Array.isArray(addresses) && addresses.length > 0) {
    addrLines = `Address = ${addresses.join(', ')}`;
  } else if (addresses) {
    addrLines = `Address = ${addresses}`;
  } else {
    addrLines = '';
  }
  return `[Interface]
PrivateKey = ${privateKey}
ListenPort = ${listenPort}
${addrLines}
DNS = ${dns}
MTU = ${mtu}
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ⌨️ WireGuard Keyboard Builders
// ─────────────────────────────────────────────────────────────────────────────

function buildWireguardOperatorKb() {
  const rows = [];
  const ops = [
    ['irancell', 'mci'],
    ['tci', 'rightel'],
    ['shatel']
  ];
  ops.forEach(pair => {
    const row = pair.map(code => ({ text: OPERATORS[code].title, callback_data: `wg_op:${code}` }));
    rows.push(row);
  });
  rows.push([{ text: '🔙 بازگشت', callback_data: 'back_main' }]);
  return { inline_keyboard: rows };
}

function buildWireguardNamingKb() {
  return {
    inline_keyboard: [
      [{ text: '🌍 اسم لوکیشن (مثال: Germany.conf)', callback_data: 'wg_name:location' }],
      [{ text: '🎲 اسم اختصاصی (مثال: JOJO12345.conf)', callback_data: 'wg_name:custom' }],
      [{ text: '🔙 بازگشت', callback_data: 'wireguard_dns_back' }]
    ]
  };
}

function buildWireguardDnsKb() {
  const rows = [];
  for (let i = 0; i < WG_FIXED_DNS.length; i += 2) {
    const a = WG_FIXED_DNS[i];
    const b = WG_FIXED_DNS[i + 1];
    const row = [{ text: a, callback_data: `wg_dns_fixed:${a}` }];
    if (b) row.push({ text: b, callback_data: `wg_dns_fixed:${b}` });
    rows.push(row);
  }
  rows.push([{ text: '🔙 بازگشت', callback_data: 'wireguard' }]);
  return { inline_keyboard: rows };
}

// ─────────────────────────────────────────────────────────────────────────────
// 💾 WireGuard State Management
// ─────────────────────────────────────────────────────────────────────────────

async function setWgState(kv, userId, state) {
  await kv.put(`wg_state:${userId}`, JSON.stringify(state), { expirationTtl: 900 });
}
async function getWgState(kv, userId) {
  const raw = await kv.get(`wg_state:${userId}`);
  return raw ? JSON.parse(raw) : null;
}
async function clearWgState(kv, userId) { await kv.delete(`wg_state:${userId}`); }

function buildWireguardCountryKb(entries, page = 0, sortOrder = 'default') {
  const ITEMS_PER_PAGE = 12;

  // ترتیب‌دهی بر اساس موجودی
  let sortedEntries = [...entries];
  if (sortOrder === 'low_to_high') {
    sortedEntries.sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0));
  } else if (sortOrder === 'high_to_low') {
    sortedEntries.sort((a, b) => (b.stock ?? 0) - (a.stock ?? 0));
  }

  const totalPages = Math.ceil(sortedEntries.length / ITEMS_PER_PAGE);
  const startIndex = page * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentEntries = sortedEntries.slice(startIndex, endIndex);

  const rows = [];

  currentEntries.forEach(e => {
    const flag = countryCodeToFlag(e.code);
    const stock = e.stock ?? 0;
    // تبدیل نام کشور به فارسی
    const countryName = ensurePersianCountryName(e.country, e.code);

    let stockEmoji = '🔴';
    if (stock > 10) {
      stockEmoji = '🟢';
    } else if (stock > 5) {
      stockEmoji = '🟡';
    } else if (stock > 0) {
      stockEmoji = '🟡';
    }

    // سه دکمه در یک ردیف - دایره رنگی سمت چپ، تعداد وسط، کشور سمت راست
    rows.push([
      {
        text: `${stockEmoji}`,
        callback_data: `wg_stock:${e.code.toUpperCase()}`
      },
      {
        text: `${stock}`,
        callback_data: `wg_stock:${e.code.toUpperCase()}`
      },
      {
        text: `${flag} ${countryName}`,
        callback_data: `wg_dns_country_pick:${e.code.toUpperCase()}`
      }
    ]);
  });

  // اضافه کردن دکمه فیلتر در اول با نمایش حالت فعلی
  const filterEmoji = sortOrder === 'low_to_high' ? '📈' : sortOrder === 'high_to_low' ? '📉' : '🔀';
  const filterLabel = sortOrder === 'low_to_high' ? 'کم به زیاد' : sortOrder === 'high_to_low' ? 'زیاد به کم' : 'پیش‌فرض';
  const nextSortOrder = sortOrder === 'default' ? 'low_to_high' : sortOrder === 'low_to_high' ? 'high_to_low' : 'default';
  rows.unshift([{
    text: `${filterEmoji} فیلتر: ${filterLabel}`,
    callback_data: `wg_sort:${nextSortOrder}:${page}`
  }]);

  // اضافه کردن دکمه‌های صفحه‌بندی
  if (totalPages > 1) {
    const paginationRow = [];

    // دکمه صفحه قبل
    if (page > 0) {
      paginationRow.push({
        text: '⬅️ قبلی',
        callback_data: `wg_page:${page - 1}:${sortOrder}`
      });
    }

    // نمایش شماره صفحه فعلی
    paginationRow.push({
      text: `${page + 1}/${totalPages}`,
      callback_data: `wg_current_page`
    });

    // دکمه صفحه بعد
    if (page < totalPages - 1) {
      paginationRow.push({
        text: 'بعدی ➡️',
        callback_data: `wg_page:${page + 1}:${sortOrder}`
      });
    }

    rows.push(paginationRow);
  }

  rows.push([{ text: '🔙 بازگشت', callback_data: 'back_main' }]);
  return { inline_keyboard: rows };
}


// ═════════════════════════════════════════════════════════════════════════════
// 🌍 COUNTRY & LOCALIZATION HELPERS
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// 🏳️ تبدیل کد کشور به پرچم
// ─────────────────────────────────────────────────────────────────────────────

function countryCodeToFlag(code) {
  if (!code || code.length !== 2) return '🌐';
  const A = 0x1F1E6;
  return Array.from(code.toUpperCase())
    .map(c => String.fromCodePoint(A + c.charCodeAt(0) - 65))
    .join('');
}


// ═════════════════════════════════════════════════════════════════════════════
// 🎲 UTILITY FUNCTIONS
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// 🎯 انتخاب رندوم از آرایه
// ─────────────────────────────────────────────────────────────────────────────

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function isValidIPv4(ip) {
  return /^(25[0-5]|2[0-4][0-9]|[01]?\d?\d)(\.(25[0-5]|2[0-4][0-9]|[01]?\d?\d)){3}$/.test(ip);
}

function isPublicIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p[0] === 10) return false;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
  if (p[0] === 192 && p[1] === 168) return false;
  if (p[0] === 127) return false;
  if (p[0] === 0) return false;
  if (p[0] === 169 && p[1] === 254) return false;
  if (p[0] >= 224 && p[0] <= 239) return false;
  if (p[0] === 255 && p[1] === 255 && p[2] === 255 && p[3] === 255) return false;
  return true;
}


// ═════════════════════════════════════════════════════════════════════════════
// 💾 KV DATABASE OPERATIONS
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// 📡 DNS IPv4 Database Functions
// ─────────────────────────────────────────────────────────────────────────────

async function listDnsEntries(kv) {
  const res = await kv.list({ prefix: 'dns:' });
  // بارگذاری موازی برای سرعت بیشتر
  const promises = res.keys.map(async k => {
    const raw = await kv.get(k.name);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch { }
    }
    return null;
  });
  const results = await Promise.all(promises);
  const entries = results.filter(e => e !== null);
  entries.sort((a, b) => (a.country || '').localeCompare(b.country || ''));
  return entries;
}

async function getDnsEntry(kv, code) {
  const raw = await kv.get(`dns:${code.toUpperCase()}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function putDnsEntry(kv, entry) {
  await kv.put(`dns:${entry.code.toUpperCase()}`, JSON.stringify(entry));
}

async function deleteDnsEntry(kv, code) {
  await kv.delete(`dns:${code.toUpperCase()}`);
}

// حذف یک آدرس از لیست آدرس‌های کشور و بروزرسانی موجودی
async function removeAddressFromEntry(kv, code, address) {
  const entry = await getDnsEntry(kv, code);
  if (!entry) return false;

  if (Array.isArray(entry.addresses)) {
    // حذف آدرس از لیست
    entry.addresses = entry.addresses.filter(addr => addr !== address);
    // بروزرسانی خودکار موجودی بر اساس تعداد آدرس‌های باقیمانده
    entry.stock = entry.addresses.length;
    await putDnsEntry(kv, entry);
    return true;
  }
  return false;
}


// ─────────────────────────────────────────────────────────────────────────────
// 🌐 IPv6 Database Functions
// ─────────────────────────────────────────────────────────────────────────────

async function listIpv6Entries(kv) {
  const list = await kv.list({ prefix: 'ipv6:' });
  const entries = [];
  for (const k of list.keys) {
    const raw = await kv.get(k.name);
    if (raw) {
      try {
        entries.push(JSON.parse(raw));
      } catch { }
    }
  }
  entries.sort((a, b) => (a.country || '').localeCompare(b.country || ''));
  return entries;
}

async function getIpv6Entry(kv, code) {
  const raw = await kv.get(`ipv6:${code.toUpperCase()}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function putIpv6Entry(kv, entry) {
  await kv.put(`ipv6:${entry.code.toUpperCase()}`, JSON.stringify(entry));
}

async function deleteIpv6Entry(kv, code) {
  await kv.delete(`ipv6:${code.toUpperCase()}`);
}

// حذف یک آدرس IPv6 از لیست و بروزرسانی موجودی
async function removeIpv6AddressFromEntry(kv, code, address) {
  const entry = await getIpv6Entry(kv, code);
  if (!entry) return false;

  if (Array.isArray(entry.addresses)) {
    entry.addresses = entry.addresses.filter(addr => addr !== address);
    entry.stock = entry.addresses.length;
    await putIpv6Entry(kv, entry);
    return true;
  }
  return false;
}

// انتخاب یک IPv6 رندوم از لیست
function getRandomIpv6(entry) {
  if (!Array.isArray(entry.addresses) || entry.addresses.length === 0) {
    return null;
  }
  return entry.addresses[Math.floor(Math.random() * entry.addresses.length)];
}

// اعتبارسنجی آدرس IPv6
function isValidIPv6(ip) {
  // الگوی ساده برای IPv6
  const ipv6Pattern = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
  return ipv6Pattern.test(ip);
}


// ─────────────────────────────────────────────────────────────────────────────
// 👤 User Management
// ─────────────────────────────────────────────────────────────────────────────

async function saveUser(kv, from) {
  if (!from || !from.id) return;
  const data = {
    id: from.id,
    first_name: from.first_name || '',
    last_name: from.last_name || '',
    username: from.username || ''
  };
  await kv.put(`users:${from.id}`, JSON.stringify(data));
}

// انتخاب یک DNS رندوم از لیست
function getRandomDns(entry) {
  if (!Array.isArray(entry.addresses) || entry.addresses.length === 0) {
    return null;
  }
  return entry.addresses[Math.floor(Math.random() * entry.addresses.length)];
}


// ─────────────────────────────────────────────────────────────────────────────
// 🔍 IP Geolocation & Country Detection
// ─────────────────────────────────────────────────────────────────────────────

// تشخیص کشور از IP با استفاده از API و cache در KV
async function detectCountryFromIP(ip, kv) {
  // بررسی cache در KV (دائمی)
  const cacheKey = `ip_cache:${ip}`;
  const cached = await kv.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch { }
  }

  try {
    // timeout 6 ثانیه
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    // استفاده از api.iplocation.net - بدون محدودیت rate limit سخت‌گیرانه
    // این API سریع‌تر و بدون نیاز به ثبت‌نام است
    const res = await fetch(`https://api.iplocation.net/?cmd=ip-country&ip=${ip}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'WireGuard-Bot/1.0'
      }
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    // فرمت پاسخ: {"ip":"8.8.8.8","country_code":"US","country_name":"United States"}
    if (data && data.country_code) {
      const result = {
        code: data.country_code.toUpperCase(),
        name: getCountryNameFromCode(data.country_code.toUpperCase())
      };
      // ذخیره در KV با TTL 30 روز
      await kv.put(cacheKey, JSON.stringify(result), { expirationTtl: 2592000 });
      return result;
    }

    // اگر پاسخ معتبر نبود، تلاش با سرویس پشتیبان iplocation.net
    // مستند: https://api.iplocation.net/?ip=XX.XX.XX.XX
    try {
      const controller2 = new AbortController();
      const t2 = setTimeout(() => controller2.abort(), 4000);
      const res2 = await fetch(`https://api.iplocation.net/?ip=${encodeURIComponent(ip)}`, { signal: controller2.signal });
      clearTimeout(t2);

      if (res2.ok) {
        const data2 = await res2.json();
        // فیلدهای ممکن: country_code2 یا country_code، و country_name
        const codeRaw = (data2.country_code2 || data2.country_code || '').toString().toUpperCase();
        if (codeRaw && codeRaw.length === 2) {
          const result2 = {
            code: codeRaw,
            name: getCountryNameFromCode(codeRaw)
          };
          await kv.put(cacheKey, JSON.stringify(result2), { expirationTtl: 2592000 });
          return result2;
        }
      }
    } catch (e2) {
      // نادیده گرفتن و رفتن به مرحله نهایی (عدم کش موقت تا اینجا)
    }

    // اگر هیچ‌کدام موفق نشد، null را با TTL کوتاه کش کن
    await kv.put(cacheKey, JSON.stringify(null), { expirationTtl: 86400 });
    return null;
  } catch (e) {
    if (e.name === 'AbortError') {
      console.error('Timeout در تشخیص کشور:', ip);
    } else {
      console.error('خطا در تشخیص کشور:', e);
    }
    // در صورت خطا، cache نمی‌کنیم تا بعداً دوباره تلاش شود
    return null;
  }
}

// تبدیل نام کشور به فارسی (اگر انگلیسی باشد از کد آن استفاده می‌کند)
function ensurePersianCountryName(countryName, countryCode) {
  // اگر نام فارسی است (شامل حروف فارسی)، همان را برگردان
  if (/[\u0600-\u06FF]/.test(countryName)) {
    return countryName;
  }
  // اگر انگلیسی است، از کد کشور نام فارسی بگیر
  return getCountryNameFromCode(countryCode);
}

// نقشه نام کشورها به فارسی
function getCountryNameFromCode(code) {
  const map = {
    // آمریکا و کانادا
    'US': 'ایالات متحده آمریکا', 'CA': 'کانادا', 'MX': 'مکزیک',

    // اروپای غربی
    'GB': 'بریتانیا', 'DE': 'آلمان', 'FR': 'فرانسه', 'NL': 'هلند', 'BE': 'بلژیک',
    'CH': 'سوئیس', 'AT': 'اتریش', 'IE': 'ایرلند', 'LU': 'لوکزامبورگ',
    'LI': 'لیختن‌اشتاین', 'MC': 'موناکو',

    // اروپای جنوبی
    'IT': 'ایتالیا', 'ES': 'اسپانیا', 'PT': 'پرتغال', 'GR': 'یونان', 'MT': 'مالت',
    'SM': 'سان مارینو', 'VA': 'واتیکان', 'AD': 'آندورا',

    // اروپای شمالی
    'SE': 'سوئد', 'NO': 'نروژ', 'DK': 'دانمارک', 'FI': 'فنلاند', 'IS': 'ایسلند',
    'EE': 'استونی', 'LV': 'لتونی', 'LT': 'لیتوانی',

    // اروپای شرقی
    'PL': 'لهستان', 'CZ': 'جمهوری چک', 'SK': 'اسلواکی', 'HU': 'مجارستان', 'RO': 'رومانی',
    'BG': 'بلغارستان', 'UA': 'اوکراین', 'BY': 'بلاروس', 'MD': 'مولداوی',
    'RS': 'صربستان', 'HR': 'کرواسی', 'SI': 'اسلوونی', 'BA': 'بوسنی و هرزگوین',
    'MK': 'مقدونیه شمالی', 'AL': 'آلبانی', 'ME': 'مونته‌نگرو', 'XK': 'کوزوو',

    // روسیه و همسایگان
    'RU': 'روسیه', 'KZ': 'قزاقستان', 'UZ': 'ازبکستان', 'TM': 'ترکمنستان',
    'KG': 'قرقیزستان', 'TJ': 'تاجیکستان', 'AM': 'ارمنستان', 'AZ': 'آذربایجان', 'GE': 'گرجستان',

    // خاورمیانه
    'IR': 'ایران', 'TR': 'ترکیه', 'AE': 'امارات متحده عربی', 'SA': 'عربستان سعودی', 'IL': 'اسرائیل',
    'IQ': 'عراق', 'SY': 'سوریه', 'JO': 'اردن', 'LB': 'لبنان', 'PS': 'فلسطین',
    'KW': 'کویت', 'QA': 'قطر', 'BH': 'بحرین', 'OM': 'عمان', 'YE': 'یمن', 'CY': 'قبرس',

    // آفریقا
    'DZ': 'الجزایر', 'AO': 'آنگولا', 'BJ': 'بنین', 'BW': 'بوتسوانا', 'BF': 'بورکینافاسو',
    'BI': 'بوروندی', 'CV': 'کیپ ورد', 'CM': 'کامرون', 'CF': 'جمهوری آفریقای مرکزی',
    'TD': 'چاد', 'KM': 'کومور', 'CG': 'کنگو', 'CD': 'جمهوری دموکراتیک کنگو',
    'CI': 'ساحل عاج', 'DJ': 'جیبوتی', 'EG': 'مصر', 'GQ': 'گینه استوایی', 'ER': 'اریتره',
    'SZ': 'اسواتینی', 'ET': 'اتیوپی', 'GA': 'گابن', 'GM': 'گامبیا', 'GH': 'غنا',
    'GN': 'گینه', 'GW': 'گینه بیسائو', 'KE': 'کنیا', 'LS': 'لسوتو', 'LR': 'لیبریا',
    'LY': 'لیبی', 'MG': 'ماداگاسکار', 'MW': 'مالاوی', 'ML': 'مالی', 'MR': 'موریتانی',
    'MU': 'موریس', 'MA': 'مراکش', 'MZ': 'موزامبیک', 'NA': 'نامیبیا', 'NE': 'نیجر',
    'NG': 'نیجریه', 'RW': 'رواندا', 'ST': 'سائوتومه و پرنسیپ', 'SN': 'سنگال',
    'SC': 'سیشل', 'SL': 'سیرالئون', 'SO': 'سومالی', 'ZA': 'آفریقای جنوبی',
    'SS': 'سودان جنوبی', 'SD': 'سودان', 'TZ': 'تانزانیا', 'TG': 'توگو',
    'TN': 'تونس', 'UG': 'اوگاندا', 'ZM': 'زامبیا', 'ZW': 'زیمبابوه',

    // آسیای شرقی
    'CN': 'چین', 'JP': 'ژاپن', 'KR': 'کره جنوبی', 'KP': 'کره شمالی', 'TW': 'تایوان',
    'HK': 'هنگ‌کنگ', 'MO': 'ماکائو', 'MN': 'مغولستان',

    // جنوب شرقی آسیا
    'TH': 'تایلند', 'VN': 'ویتنام', 'SG': 'سنگاپور', 'MY': 'مالزی', 'ID': 'اندونزی',
    'PH': 'فیلیپین', 'MM': 'میانمار', 'KH': 'کامبوج', 'LA': 'لائوس', 'BN': 'برونئی',
    'TL': 'تیمور شرقی',

    // جنوب آسیا
    'IN': 'هند', 'PK': 'پاکستان', 'BD': 'بنگلادش', 'LK': 'سری‌لانکا', 'NP': 'نپال',
    'BT': 'بوتان', 'MV': 'مالدیو', 'AF': 'افغانستان',

    // اقیانوسیه
    'AU': 'استرالیا', 'NZ': 'نیوزیلند', 'FJ': 'فیجی', 'PG': 'پاپوآ گینه نو',
    'SB': 'جزایر سلیمان', 'VU': 'وانواتو', 'WS': 'ساموآ', 'TO': 'تونگا', 'KI': 'کیریباتی',
    'TV': 'تووالو', 'FM': 'میکرونزی', 'MH': 'جزایر مارشال', 'NR': 'نائورو', 'PW': 'پالائو',

    // آمریکای جنوبی
    'AR': 'آرژانتین', 'BO': 'بولیوی', 'BR': 'برزیل', 'CL': 'شیلی', 'CO': 'کلمبیا',
    'EC': 'اکوادور', 'GY': 'گویان', 'PY': 'پاراگوئه', 'PE': 'پرو', 'SR': 'سورینام',
    'UY': 'اروگوئه', 'VE': 'ونزوئلا',

    // آمریکای مرکزی و کارائیب
    'AG': 'آنتیگوا و باربودا', 'BS': 'باهاما', 'BB': 'باربادوس', 'BZ': 'بلیز',
    'CR': 'کاستاریکا', 'CU': 'کوبا', 'DM': 'دومینیکا', 'DO': 'جمهوری دومینیکن',
    'GD': 'گرانادا', 'GT': 'گواتمالا', 'HT': 'هائیتی', 'HN': 'هندوراس', 'JM': 'جامائیکا',
    'KN': 'سنت کیتس و نویس', 'LC': 'سنت لوسیا', 'VC': 'سنت وینسنت و گرنادین‌ها',
    'NI': 'نیکاراگوئه', 'PA': 'پاناما', 'SV': 'السالوادور', 'TT': 'ترینیداد و توباگو'

  };
  return map[code.toUpperCase()] || code.toUpperCase();
}


// ═════════════════════════════════════════════════════════════════════════════
// 🎨 WEB UI RENDERING & MANAGEMENT
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// 📊 User Statistics
// ─────────────────────────────────────────────────────────────────────────────

async function countUsers(kv) {
  try {
    const res = await kv.list({ prefix: 'users:' });
    return res.keys.length;
  } catch {
    return 0;
  }
}

// محاسبه آمار کاربران
async function getUserStats(kv) {
  try {
    const usersRes = await kv.list({ prefix: 'users:' });
    const totalUsers = usersRes.keys.length;

    // محاسبه بیشترین دریافت کننده DNS
    const historyRes = await kv.list({ prefix: 'history:dns:' });
    let topUser = null;
    let maxCount = 0;

    for (const key of historyRes.keys) {
      const userId = key.name.replace('history:dns:', '');
      const raw = await kv.get(key.name);
      if (raw) {
        try {
          const history = JSON.parse(raw);
          if (history.length > maxCount) {
            maxCount = history.length;
            // دریافت اطلاعات کاربر
            const userRaw = await kv.get(`users:${userId}`);
            if (userRaw) {
              const userData = JSON.parse(userRaw);
              topUser = {
                id: userId,
                name: userData.first_name || 'کاربر',
                username: userData.username || null,
                count: maxCount
              };
            }
          }
        } catch { }
      }
    }

    return {
      totalUsers,
      topUser
    };
  } catch (e) {
    console.error('خطا در محاسبه آمار:', e);
    return {
      totalUsers: 0,
      topUser: null
    };
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// 🖥️ Main Page Renderer (IPv4 DNS Management)
// ─────────────────────────────────────────────────────────────────────────────

function renderMainPage(entries, userCount) {
  const rows = entries.map(e => {
    const flag = countryCodeToFlag(e.code);
    const count = Array.isArray(e.addresses) ? e.addresses.length : 0;
    const stockColor = (e.stock || 0) > 5 ? '#10b981' : (e.stock || 0) > 0 ? '#f59e0b' : '#ef4444';

    const addressesHTML = count > 0
      ? e.addresses.map(addr =>
          '<div class="address-item">' +
            '<code>' + escapeHtml(addr) + '</code>' +
            '<button class="btn-delete-addr" data-code="' + escapeHtml(e.code) + '" data-address="' + escapeHtml(addr) + '" title="حذف این آدرس">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>' +
              '</svg>' +
            '</button>' +
          '</div>'
        ).join('')
      : '<span class="empty">هیچ آدرسی ثبت نشده</span>';

    return `
    <div class="dns-card" data-code="${escapeHtml(e.code)}">
      <div class="card-header">
        <div class="country-info">
          <input type="checkbox" class="country-checkbox" value="${escapeHtml(e.code)}">
          <span class="country-flag">${flag}</span>
          <div class="country-details">
            <h3>${escapeHtml(e.country)}</h3>
            <span class="country-code">${escapeHtml(e.code)}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-edit" data-code="${escapeHtml(e.code)}" data-country="${escapeHtml(e.country)}" title="ویرایش نام">✏️</button>
          <form method="POST" action="/api/admin/delete-dns" style="display:inline;">
            <input type="hidden" name="code" value="${escapeHtml(e.code)}">
            <button type="submit" class="btn-delete" title="حذف">🗑️</button>
          </form>
        </div>
      </div>
      <div class="card-body">
        <div class="stat-item">
          <span class="stat-label">موجودی:</span>
          <span class="stat-value" style="color: ${stockColor};">${e.stock ?? 0}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">تعداد آدرس:</span>
          <span class="stat-value">${count}</span>
        </div>
      </div>
      <div class="card-footer">
        <details>
          <summary>مشاهده آدرس‌ها (${count})</summary>
          <div class="addresses-list">
            ${addressesHTML}
          </div>
        </details>
      </div>
    </div>`;
  }).join('\n');

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>🌐 پنل مدیریت DNS</title>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>${getWebCss()}</style>
</head>
<body>
<div id="toast-container" class="toast-container"></div>
<div class="container">
  <header class="main-header">
    <div class="header-content">
      <h1>🌐 پنل مدیریت DNS</h1>
      <p class="subtitle">مدیریت و پیکربندی سرورهای DNS در سراسر دنیا</p>
    </div>
    <div class="header-actions">
      <div class="search-box">
        <input id="search" type="text" placeholder="جستجو: نام یا کد کشور..." autocomplete="off">
        <span class="search-icon">🔎</span>
      </div>
      <button id="theme-toggle" class="btn-toggle" aria-label="تغییر تم">🌙</button>
    </div>
    <div class="header-stats">
      <div class="stat-box">
        <span class="stat-number">${entries.length}</span>
        <span class="stat-text">کشور</span>
      </div>
      <div class="stat-box">
        <span class="stat-number">${entries.reduce((sum, e) => sum + (e.stock || 0), 0)}</span>
        <span class="stat-text">موجودی کل</span>
      </div>
      <div class="stat-box">
        <span class="stat-number">${userCount}</span>
        <span class="stat-text">کاربر ربات</span>
      </div>
    </div>
    <div style="margin-top: 20px; text-align: center; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
      <a href="/ipv6" class="btn-submit" style="display: inline-block; padding: 12px 24px; text-decoration: none; background: linear-gradient(135deg, #3b82f6, #8b5cf6);">
        🌐 مدیریت IPv6
      </a>
      <button id="bulk-delete-btn" class="btn-submit" style="display: none; padding: 12px 24px; background: linear-gradient(135deg, #ef4444, #dc2626);">
        🗑️ حذف <span id="selected-count">0</span> کشور انتخاب شده
      </button>
      <button id="select-all-btn" class="btn-secondary" style="padding: 12px 24px;">
        ☑️ انتخاب همه
      </button>
    </div>
  </header>

  <section class="section">
    <div class="section-header">
      <h2>📋 لیست DNS‌های موجود (IPv4)</h2>
      <span class="badge">${entries.length} مورد</span>
    </div>
    <div id="dns-grid" class="dns-grid">
      ${rows || '<div class="empty-state">هنوز هیچ DNS ثبت نشده است</div>'}
    </div>
  </section>

  <section class="section">
    <div class="section-header">
      <h2>🚀 افزودن گروهی آدرس‌ها</h2>
      <span class="badge" id="address-count" style="display:none;">0 آدرس</span>
    </div>
    <form method="POST" action="/api/admin/bulk-add" class="dns-form" id="bulk-form">
      <div class="form-row">
        <div class="form-group">
          <label for="manual-country-select">🌍 انتخاب کشور (اختیاری)</label>
          <select id="manual-country-select" name="manual_country">
            <option value="">🔍 تشخیص خودکار (توصیه نمی‌شود)</option>
            ${entries.map(e => `<option value="${e.code.toUpperCase()}">${countryCodeToFlag(e.code)} ${e.country} (${e.code.toUpperCase()})</option>`).join('')}
          </select>
          <small style="color: #ef4444; font-weight: 500;">⚠️ تشخیص خودکار ممکن است کند یا ناموفق باشد. انتخاب دستی کشور توصیه می‌شود.</small>
        </div>
      </div>
      <div class="form-group full-width">
        <div class="label-row">
          <label for="addresses-input">📡 آدرس‌های IP (هر خط یک آدرس)</label>
          <button type="button" id="paste-clipboard-btn" class="btn-helper" title="چسباندن از کلیپ‌بورد">📋 چسباندن</button>
        </div>
        <textarea id="addresses-input" name="addresses" placeholder="1.1.1.1&#10;8.8.8.8&#10;185.55.226.26&#10;9.9.9.9" rows="10" required></textarea>
        <div class="textarea-info">
          <span class="char-count">0 کاراکتر</span>
          <span class="line-count">0 خط</span>
        </div>
        <small>💡 هر آدرس IP را در یک خط جداگانه وارد کنید. آدرس‌های تکراری به‌طور خودکار حذف می‌شوند.</small>
      </div>

      <div class="form-options">
        <label class="checkbox-label">
          <input type="checkbox" id="auto-validate" checked>
          <span>✅ تایید خودکار آدرس‌ها</span>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="remove-duplicates" checked>
          <span>🧹 حذف آدرس‌های تکراری</span>
        </label>
      </div>

      <div id="validation-info" class="validation-info" style="display:none;">
        <div class="info-row">
          <span class="info-label">✅ معتبر:</span>
          <span class="valid-count">0</span>
        </div>
        <div class="info-row">
          <span class="info-label">❌ نامعتبر:</span>
          <span class="invalid-count">0</span>
        </div>
        <div class="info-row">
          <span class="info-label">🔄 تکراری:</span>
          <span class="duplicate-count">0</span>
        </div>
      </div>

      <div id="bulk-progress" class="bulk-progress" style="display:none;">
        <div class="progress-container">
          <div class="progress-bar"><div class="progress-fill"></div></div>
          <span class="progress-percent">0%</span>
        </div>
        <p class="progress-text">⏳ در حال پردازش...</p>
        <p class="current-ip" style="display:none;"></p>
        <p class="speed-info" style="display:none;"></p>
        <div class="error-list" style="display:none;">
          <details>
            <summary class="error-summary">🔴 مشاهده خطاها</summary>
            <div class="error-items"></div>
          </details>
        </div>
        <div class="success-summary" style="display:none;"></div>
      </div>

      <div class="button-group">
        <button type="submit" class="btn-submit" id="bulk-submit">🔍 تشخیص و افزودن</button>
        <button type="button" class="btn-secondary" id="clear-addresses-btn">🗑️ پاک کردن</button>
      </div>
    </form>
  </section>

  <section class="section">
    <div class="section-header">
      <h2>🎯 افزودن آدرس تک کشور</h2>
      <span class="badge">برای اضافه کردن سریع</span>
    </div>
    <form method="POST" action="/api/admin/single-country-add" class="dns-form" id="single-country-form">
      <div class="form-row">
        <div class="form-group">
          <label for="single-country-select">🌍 انتخاب کشور *</label>
          <select id="single-country-select" name="country_code" required>
            <option value="">-- انتخاب کنید --</option>
            ${entries.map(e => `<option value="${e.code.toUpperCase()}">${countryCodeToFlag(e.code)} ${e.country} (${e.code.toUpperCase()}) - ${e.stock} IP</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group full-width">
        <label for="single-country-ips">📡 آدرس‌های IP برای این کشور</label>
        <textarea id="single-country-ips" name="addresses" placeholder="1.1.1.1&#10;8.8.8.8&#10;9.9.9.9" rows="6" required></textarea>
        <small>💡 آدرس‌ها مستقیماً به کشور انتخاب شده اضافه می‌شوند - نیاز به تشخیص خودکار نیست.</small>
      </div>
      <div class="button-group">
        <button type="submit" class="btn-submit" style="background: linear-gradient(135deg, #10b981, #059669);">✅ افزودن به کشور انتخاب شده</button>
      </div>
    </form>
  </section>

  <section class="section">
    <div class="section-header">
      <h2>🔧 ابزارهای مدیریت</h2>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-bottom: 20px;">
      <div>
        <button onclick="fixCountryNames()" class="btn-submit" style="background: linear-gradient(135deg, #667eea, #764ba2); width: 100%;">
          🌍 تبدیل تمام اسم کشورها به فارسی
        </button>
        <small style="display: block; margin-top: 10px; color: #64748b;">
          تبدیل اسم‌های انگلیسی به فارسی
        </small>
      </div>
      <div>
        <button onclick="removeDuplicates()" class="btn-submit" style="background: linear-gradient(135deg, #f59e0b, #d97706); width: 100%;">
          🧹 حذف آدرس‌های تکراری
        </button>
        <small style="display: block; margin-top: 10px; color: #64748b;">
          حذف آدرس‌های IP تکراری از تمام کشورها
        </small>
      </div>
      <div>
        <button onclick="updateAllStock()" class="btn-submit" style="background: linear-gradient(135deg, #10b981, #059669); width: 100%;">
          📊 بروزرسانی موجودی همه
        </button>
        <small style="display: block; margin-top: 10px; color: #64748b;">
          محاسبه مجدد موجودی بر اساس تعداد آدرس‌ها
        </small>
      </div>
    </div>
  </section>
</div>
<script>${getWebJs()}</script>
</body>
</html>
  `;
}


// ─────────────────────────────────────────────────────────────────────────────
// 🎨 CSS Styles for Web UI
// ─────────────────────────────────────────────────────────────────────────────

function getWebCss() {
  return `
    :root {
      /* Color System - Light Mode */
      --bg-gradient-start: #667eea;
      --bg-gradient-end: #764ba2;
      --bg-primary: #ffffff;
      --bg-secondary: #f9fafb;
      --bg-tertiary: #f3f4f6;
      --bg-elevated: #ffffff;
      
      --text-primary: #1f2937;
      --text-secondary: #6b7280;
      --text-tertiary: #9ca3af;
      
      --border-color: #e5e7eb;
      --border-color-hover: #d1d5db;
      
      --accent-primary: #667eea;
      --accent-secondary: #764ba2;
      --accent-gradient: linear-gradient(135deg, #667eea, #764ba2);
      
      --success-color: #10b981;
      --error-color: #ef4444;
      --warning-color: #f59e0b;
      --info-color: #3b82f6;
      
      --shadow-sm: 0 4px 12px rgba(0, 0, 0, 0.05);
      --shadow-md: 0 10px 40px rgba(0, 0, 0, 0.1);
      --shadow-lg: 0 15px 50px rgba(0, 0, 0, 0.15);
      
      --radius-sm: 8px;
      --radius-md: 12px;
      --radius-lg: 16px;
      --radius-xl: 24px;
      
      --transition-fast: 150ms ease;
      --transition-base: 250ms ease;
      --transition-slow: 400ms ease;
    }

    body.dark {
      /* Color System - Dark Mode */
      --bg-gradient-start: #0f172a;
      --bg-gradient-end: #1e293b;
      --bg-primary: #1e293b;
      --bg-secondary: #334155;
      --bg-tertiary: #475569;
      --bg-elevated: #273449;
      
      --text-primary: #f1f5f9;
      --text-secondary: #cbd5e1;
      --text-tertiary: #94a3b8;
      
      --border-color: #334155;
      --border-color-hover: #475569;
      
      --accent-primary: #818cf8;
      --accent-secondary: #a78bfa;
      --accent-gradient: linear-gradient(135deg, #818cf8, #a78bfa);
      
      --shadow-sm: 0 4px 12px rgba(0, 0, 0, 0.3);
      --shadow-md: 0 10px 40px rgba(0, 0, 0, 0.4);
      --shadow-lg: 0 15px 50px rgba(0, 0, 0, 0.5);
    }

    * { 
      margin: 0; 
      padding: 0; 
      box-sizing: border-box; 
    }

    body {
      font-family: 'Vazirmatn', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, var(--bg-gradient-start) 0%, var(--bg-gradient-end) 100%);
      background-attachment: fixed;
      color: var(--text-primary);
      line-height: 1.6;
      min-height: 100vh;
      padding: 20px;
      transition: background var(--transition-slow), color var(--transition-base);
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    .main-header {
      background: var(--bg-elevated);
      border-radius: var(--radius-xl);
      padding: 40px;
      margin-bottom: 30px;
      box-shadow: var(--shadow-md);
      animation: slideDown 0.5s ease;
      transition: all var(--transition-base);
    }

    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-30px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .header-content h1 {
      font-size: 2.5em;
      background: var(--accent-gradient);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 10px;
      font-weight: 700;
    }

    .subtitle {
      color: var(--text-secondary);
      font-size: 1.1em;
    }

    .header-actions {
      display: flex;
      gap: 15px;
      margin-top: 20px;
      flex-wrap: wrap;
    }

    .search-box {
      position: relative;
      flex: 1;
      min-width: 250px;
    }

    .search-box input {
      width: 100%;
      padding: 12px 45px 12px 20px;
      border: 2px solid var(--border-color);
      border-radius: var(--radius-md);
      font-size: 16px;
      transition: all var(--transition-base);
      font-family: inherit;
      background: var(--bg-primary);
      color: var(--text-primary);
    }

    .search-box input:focus {
      outline: none;
      border-color: var(--accent-primary);
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
    }

    .search-icon {
      position: absolute;
      left: 15px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 20px;
    }

    .btn-toggle {
      padding: 12px 20px;
      background: var(--accent-gradient);
      color: white;
      border: none;
      border-radius: var(--radius-md);
      font-size: 20px;
      cursor: pointer;
      transition: all var(--transition-base);
      box-shadow: var(--shadow-sm);
    }

    .btn-toggle:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-md);
    }

    .btn-toggle:active {
      transform: translateY(0);
    }

    .header-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 20px;
      margin-top: 30px;
    }

    .stat-box {
      background: var(--bg-secondary);
      padding: 20px;
      border-radius: var(--radius-lg);
      text-align: center;
      transition: all var(--transition-base);
      border: 1px solid var(--border-color);
    }

    .stat-box:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-sm);
    }

    .stat-number {
      display: block;
      font-size: 2em;
      font-weight: 700;
      background: var(--accent-gradient);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .stat-text {
      display: block;
      color: var(--text-secondary);
      font-size: 0.9em;
      margin-top: 5px;
    }

    .section {
      background: var(--bg-elevated);
      border-radius: var(--radius-xl);
      padding: 30px;
      margin-bottom: 30px;
      box-shadow: var(--shadow-md);
      animation: fadeIn 0.5s ease;
      transition: all var(--transition-base);
      border: 1px solid var(--border-color);
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 25px;
      padding-bottom: 15px;
      border-bottom: 2px solid var(--border-color);
    }

    .section-header h2 {
      font-size: 1.8em;
      color: var(--text-primary);
      font-weight: 700;
    }

    .badge {
      background: var(--accent-gradient);
      color: white;
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 0.9em;
      font-weight: 600;
      box-shadow: var(--shadow-sm);
    }

    .dns-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 20px;
    }

    .dns-card {
      background: var(--bg-secondary);
      border-radius: var(--radius-lg);
      padding: 20px;
      transition: all var(--transition-base);
      animation: slideUp 0.5s ease;
      border: 1px solid var(--border-color);
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .dns-card:hover {
      transform: translateY(-5px);
      box-shadow: var(--shadow-lg);
      border-color: var(--accent-primary);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
      padding-bottom: 15px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.05);
    }

    .country-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .country-checkbox {
      width: 20px;
      height: 20px;
      cursor: pointer;
    }

    .country-flag {
      font-size: 2em;
    }

    .country-details h3 {
      font-size: 1.1em;
      margin-bottom: 3px;
    }

    .country-code {
      font-family: monospace;
      background: rgba(102, 126, 234, 0.1);
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      font-size: 0.85em;
      color: var(--accent-primary);
    }

    .card-actions {
      display: flex;
      gap: 8px;
    }

    .btn-edit, .btn-delete, .btn-delete-addr {
      background: none;
      border: none;
      font-size: 1.3em;
      cursor: pointer;
      padding: 5px;
      transition: transform 0.2s;
    }

    .btn-edit:hover, .btn-delete:hover, .btn-delete-addr:hover {
      transform: scale(1.2);
    }

    .card-body {
      margin-bottom: 15px;
    }

    .stat-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
    }

    .stat-label {
      color: var(--text-secondary);
      font-size: 0.95em;
    }

    .stat-value {
      font-weight: 600;
      font-size: 1.05em;
    }

    .card-footer details {
      cursor: pointer;
    }

    .card-footer summary {
      padding: 10px;
      background: rgba(102, 126, 234, 0.05);
      border-radius: var(--radius-sm);
      font-weight: 600;
      color: var(--accent-primary);
      user-select: none;
      transition: all var(--transition-fast);
    }

    .card-footer summary:hover {
      background: rgba(102, 126, 234, 0.1);
      transform: translateX(2px);
    }

    .addresses-list {
      padding: 15px 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .address-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: var(--bg-primary);
      border-radius: var(--radius-sm);
      gap: 10px;
      transition: all var(--transition-fast);
    }

    .address-item:hover {
      background: var(--bg-tertiary);
    }

    .addresses-list code {
      font-family: 'Courier New', monospace;
      background: rgba(102, 126, 234, 0.1);
      padding: 4px 10px;
      border-radius: var(--radius-sm);
      font-size: 0.9em;
      color: var(--accent-primary);
      flex: 1;
    }

    .empty {
      color: var(--text-tertiary);
      font-style: italic;
      text-align: center;
      padding: 20px;
    }

    .dns-form {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .form-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .form-group.full-width {
      grid-column: 1 / -1;
    }

    .form-group label {
      font-weight: 600;
      color: var(--text-primary);
      font-size: 0.95em;
    }

    .form-group input,
    .form-group textarea {
      padding: 12px 16px;
      border: 2px solid var(--border-color);
      border-radius: var(--radius-md);
      font-size: 16px;
      font-family: inherit;
      transition: all var(--transition-base);
      background: var(--bg-primary);
      color: var(--text-primary);
    }

    .form-group input:focus,
    .form-group textarea:focus {
      outline: none;
      border-color: var(--accent-primary);
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
    }

    .form-group small {
      color: var(--text-secondary);
      font-size: 0.85em;
    }

    .label-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .btn-helper {
      padding: 6px 12px;
      background: linear-gradient(135deg, var(--success-color), #059669);
      color: white;
      border: none;
      border-radius: var(--radius-sm);
      font-size: 0.85em;
      cursor: pointer;
      transition: all var(--transition-base);
    }

    .btn-helper:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-sm);
    }

    .textarea-info {
      display: flex;
      justify-content: space-between;
      font-size: 0.85em;
      color: var(--text-secondary);
      margin-top: -5px;
    }

    .form-options {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
    }

    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }

    .checkbox-label input[type="checkbox"] {
      width: 18px;
      height: 18px;
      cursor: pointer;
    }

    .validation-info {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      padding: 15px;
      background: var(--bg-secondary);
      border-radius: var(--radius-md);
      border: 1px solid var(--border-color);
    }

    .info-row {
      text-align: center;
    }

    .info-label {
      display: block;
      font-size: 0.9em;
      color: var(--text-secondary);
      margin-bottom: 5px;
    }

    .valid-count, .invalid-count, .duplicate-count {
      font-size: 1.5em;
      font-weight: 700;
    }

    .valid-count {
      color: var(--success-color);
    }

    .invalid-count {
      color: var(--error-color);
    }

    .duplicate-count {
      color: var(--warning-color);
    }

    .bulk-progress {
      padding: 20px;
      background: var(--bg-secondary);
      border-radius: var(--radius-md);
      border: 1px solid var(--border-color);
    }

    .progress-container {
      display: flex;
      align-items: center;
      gap: 15px;
      margin-bottom: 15px;
    }

    .progress-bar {
      flex: 1;
      height: 30px;
      background: var(--bg-tertiary);
      border-radius: 15px;
      overflow: hidden;
      border: 1px solid var(--border-color);
    }

    .progress-fill {
      height: 100%;
      background: var(--accent-gradient);
      transition: width var(--transition-base);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 600;
    }

    .progress-percent {
      font-weight: bold;
      font-size: 1.1em;
      min-width: 60px;
      text-align: center;
    }

    .progress-text {
      text-align: center;
      margin: 10px 0;
      font-weight: 600;
    }

    .current-ip {
      text-align: center;
      font-family: monospace;
      color: var(--accent-primary);
      margin: 10px 0;
    }

    .speed-info {
      text-align: center;
      color: var(--text-secondary);
      font-size: 0.9em;
      margin: 10px 0;
    }

    .error-list {
      margin-top: 15px;
    }

    .error-summary {
      cursor: pointer;
      padding: 10px;
      background: rgba(239, 68, 68, 0.1);
      border-radius: var(--radius-sm);
      color: var(--error-color);
      font-weight: 600;
      transition: all var(--transition-fast);
    }

    .error-summary:hover {
      background: rgba(239, 68, 68, 0.15);
    }

    .error-items {
      padding: 15px 10px;
      max-height: 200px;
      overflow-y: auto;
    }

    .error-item {
      padding: 8px;
      background: var(--bg-primary);
      border-radius: var(--radius-sm);
      margin: 5px 0;
      font-size: 0.9em;
    }

    .success-summary {
      padding: 15px;
      background: rgba(16, 185, 129, 0.1);
      border-radius: var(--radius-sm);
      color: var(--success-color);
      margin-top: 15px;
    }

    .button-group {
      display: flex;
      gap: 15px;
      flex-wrap: wrap;
    }

    .btn-submit, .btn-secondary {
      padding: 14px 28px;
      border: none;
      border-radius: var(--radius-md);
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all var(--transition-base);
      flex: 1;
      min-width: 200px;
    }

    .btn-submit {
      background: var(--accent-gradient);
      color: white;
      box-shadow: var(--shadow-sm);
    }

    .btn-submit:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-md);
    }

    .btn-submit:active {
      transform: translateY(0);
    }

    .btn-submit:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .btn-secondary {
      background: var(--bg-secondary);
      color: var(--text-primary);
      border: 1px solid var(--border-color);
    }

    .btn-secondary:hover {
      background: var(--bg-tertiary);
      border-color: var(--border-color-hover);
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--text-tertiary);
      font-size: 1.1em;
    }

    .toast-container {
      position: fixed;
      top: 20px;
      left: 20px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 400px;
    }

    .toast {
      background: var(--bg-elevated);
      border-radius: var(--radius-md);
      padding: 16px 20px;
      box-shadow: var(--shadow-md);
      display: flex;
      align-items: start;
      gap: 12px;
      animation: slideInLeft 0.3s ease;
      border: 1px solid var(--border-color);
    }

    @keyframes slideInLeft {
      from {
        opacity: 0;
        transform: translateX(-100%);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    .toast.removing {
      animation: slideOutLeft 0.3s ease;
    }

    @keyframes slideOutLeft {
      from {
        opacity: 1;
        transform: translateX(0);
      }
      to {
        opacity: 0;
        transform: translateX(-100%);
      }
    }

    .toast-icon {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-weight: bold;
      font-size: 14px;
    }

    .toast.success .toast-icon {
      background: var(--success-color);
      color: white;
    }

    .toast.error .toast-icon {
      background: var(--error-color);
      color: white;
    }

    .toast.warning .toast-icon {
      background: var(--warning-color);
      color: white;
    }

    .toast.info .toast-icon {
      background: var(--info-color);
      color: white;
    }

    .toast-content {
      flex: 1;
    }

    .toast-title {
      font-weight: 600;
      margin-bottom: 4px;
      font-size: 0.95em;
    }

    .toast-message {
      color: var(--text-secondary);
      font-size: 0.9em;
      line-height: 1.4;
    }

    .toast-close {
      background: none;
      border: none;
      font-size: 20px;
      cursor: pointer;
      color: var(--text-tertiary);
      padding: 0;
      width: 24px;
      height: 24px;
      flex-shrink: 0;
      transition: color var(--transition-fast);
    }

    .toast-close:hover {
      color: var(--text-primary);
    }

    @media (max-width: 768px) {
      .dns-grid {
        grid-template-columns: 1fr;
      }

      .form-row {
        grid-template-columns: 1fr;
      }

      .header-stats {
        grid-template-columns: 1fr;
      }

      .button-group {
        flex-direction: column;
      }

      .btn-submit, .btn-secondary {
        min-width: 100%;
      }

      .toast-container {
        left: 10px;
        right: 10px;
        max-width: calc(100% - 20px);
      }
    }
  `;
}


// ─────────────────────────────────────────────────────────────────────────────
// 📜 JavaScript for Web UI
// ─────────────────────────────────────────────────────────────────────────────

function getWebJs() {
  return `
// Placeholder - JavaScript code will be added here
console.log('WireGuard Bot Admin Panel Loaded');
  `;
}


const Toast = {
  container: null,

  init() {
    this.container = document.getElementById('toast-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  },

  show(message, type = 'info', duration = 5000) {
    this.init();

    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };

    const titles = {
      success: 'موفقیت',
      error: 'خطا',
      warning: 'هشدار',
      info: 'اطلاعات'
    };

    const toast = document.createElement('div');
    toast.className = 'toast ' + type;

    toast.innerHTML = '<div class="toast-icon">' + (icons[type] || icons.info) + '</div>' +
      '<div class="toast-content">' +
        '<div class="toast-title">' + (titles[type] || titles.info) + '</div>' +
        '<div class="toast-message">' + message + '</div>' +
      '</div>' +
      '<button class="toast-close">×</button>';

    this.container.appendChild(toast);

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => this.remove(toast));

    if (duration > 0) {
      setTimeout(() => this.remove(toast), duration);
    }

    return toast;
  },

  remove(toast) {
    toast.classList.add('removing');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  },

  success(message, duration) {
    return this.show(message, 'success', duration);
  },

  error(message, duration) {
    return this.show(message, 'error', duration);
  },

  warning(message, duration) {
    return this.show(message, 'warning', duration);
  },

  info(message, duration) {
    return this.show(message, 'info', duration);
  }
};

// Only run client-side code in browser environment
if (typeof document !== 'undefined') {
document.addEventListener('DOMContentLoaded', () => {
  const cards = document.querySelectorAll('.dns-card');
  cards.forEach((card, i) => { card.style.animationDelay = (i * 0.05) + 's'; });

  const toggleBtn = document.getElementById('theme-toggle');
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') { document.body.classList.add('dark'); toggleBtn.textContent = '☀️'; }
  toggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    const dark = document.body.classList.contains('dark');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    toggleBtn.textContent = dark ? '☀️' : '🌙';
  });

  const search = document.getElementById('search');
  const grid = document.getElementById('dns-grid');
  if (search && grid) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      grid.querySelectorAll('.dns-card').forEach(card => {
        const name = card.querySelector('.country-details h3')?.textContent?.toLowerCase() || '';
        const code = card.querySelector('.country-code')?.textContent?.toLowerCase() || '';
        const addrs = Array.from(card.querySelectorAll('.addresses-list code')).map(c => c.textContent.toLowerCase()).join(' ');
        const ok = !q || name.includes(q) || code.includes(q) || addrs.includes(q);
        card.style.display = ok ? '' : 'none';
      });
    });
  }

  // Event delegation for edit buttons
  document.addEventListener('click', (e) => {
    if (e.target.closest('.btn-edit')) {
      const btn = e.target.closest('.btn-edit');
      const code = btn.dataset.code;
      const country = btn.dataset.country;
      if (code && country) {
        editCountry(code, country);
      }
    }

    // Event delegation for delete address buttons
    if (e.target.closest('.btn-delete-addr')) {
      const btn = e.target.closest('.btn-delete-addr');
      const code = btn.dataset.code;
      const address = btn.dataset.address;
      if (code && address) {
        deleteAddress(code, address);
      }
    }
  });

  // Event delegation for delete form submit
  document.addEventListener('submit', (e) => {
    if (e.target.querySelector('.btn-delete')) {
      if (!confirm('آیا مطمئن هستید؟')) {
        e.preventDefault();
      }
    }
  });

  // Event delegation for country checkboxes
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('country-checkbox')) {
      updateBulkDeleteButton();
    }
  });

  // Button click handlers
  const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
  if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener('click', bulkDeleteCountries);
  }

  const selectAllBtn = document.getElementById('select-all-btn');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', toggleSelectAll);
  }

  const pasteBtn = document.getElementById('paste-clipboard-btn');
  if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        const textarea = document.getElementById('addresses-input');
        if (textarea) {
          textarea.value = text;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          Toast.success('✅ متن از کلیپ‌بورد چسباند شد');
        }
      } catch (e) {
        Toast.error('❌ خطا در خواندن کلیپ‌بورد');
      }
    });
  }

  const clearBtn = document.getElementById('clear-addresses-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const textarea = document.getElementById('addresses-input');
      if (textarea && textarea.value.trim()) {
        var msg = 'آیا مطمئن هستید؟';
        if (confirm(msg)) {
          textarea.value = '';
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    });
  }

  // Helper functions for bulk add form
  window.pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const textarea = document.getElementById('addresses-input');
      if (textarea) {
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        Toast.success('✅ متن از کلیپ‌بورد چسباند شد');
      }
    } catch (e) {
      Toast.error('❌ خطا در خواندن کلیپ‌بورد');
    }
  };

  window.clearAddresses = () => {
    const textarea = document.getElementById('addresses-input');
    if (textarea && textarea.value.trim()) {
      if (confirm('آیا مطمئن هستید؟')) {
        textarea.value = '';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  };

  // Live validation and counter for textarea
  const textarea = document.getElementById('addresses-input');
  if (textarea) {
    const updateValidation = () => {
      const text = textarea.value;
      const lines = text.split('\n').filter(l => l.trim());
      const charCount = text.length;

      document.querySelector('.char-count').textContent = charCount + ' کاراکتر';
      document.querySelector('.line-count').textContent = lines.length + ' خط';

      // Live validation if checkbox is checked
      if (document.getElementById('auto-validate')?.checked) {
        const ipRegex = /^(25[0-5]|2[0-4][0-9]|[01]?\d?\d)(\.(25[0-5]|2[0-4][0-9]|[01]?\d?\d)){3}$/;
        const allIps = text.split(/[^0-9.]+/).filter(a => a.trim());
        const validIps = new Set();
        const invalidIps = new Set();
        const duplicates = new Set();

        allIps.forEach(ip => {
          if (ipRegex.test(ip)) {
            if (validIps.has(ip)) {
              duplicates.add(ip);
            } else {
              validIps.add(ip);
            }
          } else if (ip) {
            invalidIps.add(ip);
          }
        });

        const validCount = validIps.size;
        const invalidCount = invalidIps.size;
        const duplicateCount = duplicates.size;

        if (validCount > 0 || invalidCount > 0 || duplicateCount > 0) {
          document.getElementById('validation-info').style.display = 'grid';
          document.querySelector('.valid-count').textContent = validCount;
          document.querySelector('.invalid-count').textContent = invalidCount;
          document.querySelector('.duplicate-count').textContent = duplicateCount;
          document.getElementById('address-count').style.display = 'inline-block';
          document.getElementById('address-count').textContent = validCount + ' آدرس معتبر';
        } else {
          document.getElementById('validation-info').style.display = 'none';
          document.getElementById('address-count').style.display = 'none';
        }
      }
    };

    textarea.addEventListener('input', updateValidation);
    document.getElementById('auto-validate')?.addEventListener('change', updateValidation);
  }

  // Bulk add form with live progress
  const bulkForm = document.querySelector('form[action="/api/admin/bulk-add"]');
  if (bulkForm) {
    let cancelRequested = false;

    bulkForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const progress = document.getElementById('bulk-progress');
      const progressFill = progress.querySelector('.progress-fill');
      const progressText = progress.querySelector('.progress-text');
      const currentIpText = progress.querySelector('.current-ip');
      const errorList = progress.querySelector('.error-list');
      const errorItems = progress.querySelector('.error-items');
      const btn = document.getElementById('bulk-submit');
      const textarea = bulkForm.querySelector('textarea[name="addresses"]');

      if (!textarea.value.trim()) {
        Toast.warning('لطفاً آدرس‌ها را وارد کنید');
        return;
      }

      const rawParts = textarea.value.split(/[^0-9.]+/);
      const addresses = Array.from(new Set(
        rawParts
          .map(a => a.trim())
          .filter(a => a && /^(25[0-5]|2[0-4][0-9]|[01]?\d?\d)(\.(25[0-5]|2[0-4][0-9]|[01]?\d?\d)){3}$/.test(a))
      ));

      if (addresses.length === 0) {
        Toast.error('هیچ آدرس IP معتبری یافت نشد');
        return;
      }

      // نمایش تعداد آدرس‌های یافت شده
      Toast.info('🔍 ' + addresses.length + ' آدرس IP معتبر یافت شد');

      // ریست کردن UI
      progress.style.display = 'block';
      progressFill.style.width = '0%';
      currentIpText.style.display = 'none';
      errorList.style.display = 'none';
      errorItems.innerHTML = '';

      btn.disabled = true;
      btn.textContent = '⏸️ لغو';
      btn.onclick = () => {
        cancelRequested = true;
        btn.textContent = '⏳ در حال لغو...';
        btn.disabled = true;
      };

      let processed = 0;
      let success = 0;
      let failed = 0;
      const byCountry = {};
      const errors = [];

      // تنظیم دینامیک batch size بر اساس تعداد آدرس‌ها (افزایش برای سرعت بیشتر)
      const BATCH_SIZE = addresses.length > 100 ? 15 : addresses.length > 50 ? 10 : 7;

      // تابع بروزرسانی UI با requestAnimationFrame برای عملکرد بهتر
      const updateUI = (currentIp = null) => {
        requestAnimationFrame(() => {
          const percent = Math.round((processed / addresses.length) * 100);
          progressFill.style.width = percent + '%';
          progress.querySelector('.progress-percent').textContent = percent + '%';

          if (currentIp) {
            currentIpText.textContent = '🔄 در حال پردازش: ' + currentIp;
            currentIpText.style.display = 'block';
          }

          progressText.textContent = '📊 ' + processed + '/' + addresses.length + ' | ✅ ' + success + ' موفق | ❌ ' + failed + ' ناموفق';
        });
      };

      // دریافت کشور دستی (اگر انتخاب شده باشد)
      const manualCountry = document.getElementById('manual-country-select')?.value || '';
      
      // شروع پردازش
      const startTime = Date.now();

      for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
        if (cancelRequested) {
          Toast.warning('⏸️ عملیات لغو شد. ' + processed + ' از ' + addresses.length + ' آدرس پردازش شد.');
          break;
        }

        const batch = addresses.slice(i, i + BATCH_SIZE);

        // پردازش موازی batch
        const promises = batch.map(async ip => {
          updateUI(ip);

          let attempt = 0;
          while (attempt < 3) {
            attempt++;
            try {
              const controller = new AbortController();
              const t = setTimeout(() => controller.abort(), 10000);
              const requestBody = { ip };
              if (manualCountry) {
                requestBody.manual_country = manualCountry;
              }
              const res = await fetch('/api/admin/bulk-add-single', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
                signal: controller.signal
              });
              clearTimeout(t);
              const result = await res.json();
              if (result && result.success !== undefined) {
                return { ip, result };
              }
              return { ip, result: { success: false, error: 'پاسخ نامعتبر از سرور' } };
            } catch (e) {
              if (attempt >= 3) {
                return { ip, result: { success: false, error: e.name === 'AbortError' ? 'timeout' : e.message } };
              }
              await new Promise(r => setTimeout(r, 500 * attempt));
            }
          }
          return { ip, result: { success: false, error: 'خطای نامشخص' } };
        });

        // پردازش نتایج
        const results = await Promise.all(promises);
        let duplicates = 0;
        results.forEach(({ ip, result }) => {
          if (result.success) {
            if (result.action === 'duplicate') {
              duplicates++;
            } else {
              success++;
            }
            if (result.country) {
              byCountry[result.country] = (byCountry[result.country] || 0) + 1;
            }
          } else {
            failed++;
            errors.push({ ip, error: result.error || 'خطای نامشخص' });
          }
          processed++;
        });

        // بروزرسانی UI بعد از هر batch
        updateUI();

        // نمایش سرعت پردازش
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = (processed / elapsed).toFixed(1);
        const remaining = addresses.length - processed;
        const eta = remaining > 0 ? Math.ceil(remaining / speed) : 0;

        if (eta > 0 && !cancelRequested) {
          const speedInfo = progress.querySelector('.speed-info');
          speedInfo.textContent = '⚡ سرعت: ' + speed + ' IP/s | ⏱️ زمان تخمینی: ' + eta + 's';
          speedInfo.style.display = 'block';
        }

        // تاخیر کوچک بین batch‌ها برای جلوگیری از rate limit (100ms)
        if (i + BATCH_SIZE < addresses.length && !cancelRequested) {
          await new Promise(r => setTimeout(r, 100));
        }
      }

      // پایان پردازش
      currentIpText.style.display = 'none';

      if (!cancelRequested) {
        const summary = Object.entries(byCountry)
          .sort((a, b) => b[1] - a[1])
          .map(([code, count]) => code + ': ' + count)
          .join(', ');

        const duplicateText = duplicates > 0 ? ' | 🔄 ' + duplicates + ' تکراری' : '';
        progressText.textContent = '✅ تکمیل شد! ' + processed + ' آدرس | ✅ ' + success + ' جدید' + duplicateText + ' | ❌ ' + failed + ' ناموفق';
        progress.querySelector('.speed-info').style.display = 'none';
        btn.textContent = '✅ تکمیل شد';
        btn.onclick = null;

        // نمایش خلاصه موفقیت
        const successSummary = progress.querySelector('.success-summary');
        let summaryHtml = '<strong>✅ نتایج پردازش:</strong><br>';
        summaryHtml += '🎯 ' + success + ' آدرس جدید اضافه شد<br>';
        if (duplicates > 0) summaryHtml += '🔄 ' + duplicates + ' آدرس تکراری<br>';
        if (failed > 0) summaryHtml += '❌ ' + failed + ' آدرس ناموفق<br>';
        if (summary) summaryHtml += '<br><strong>📊 توزیع کشورها:</strong><br>' + summary;
        successSummary.innerHTML = summaryHtml;
        successSummary.style.display = 'block';

        if (summary) {
          const duplicateMsg = duplicates > 0 ? '\\n🔄 ' + duplicates + ' آدرس تکراری نادیده گرفته شد' : '';
          Toast.success('🎉 افزودن گروهی تکمیل شد!\\n' + summary + duplicateMsg, 10000);
        } else {
          const duplicateMsg = duplicates > 0 ? ', ' + duplicates + ' تکراری' : '';
          Toast.success('✅ تکمیل شد! ' + success + ' جدید' + duplicateMsg + ', ' + failed + ' ناموفق', 5000);
        }

        // نمایش خطاها در UI
        if (errors.length > 0) {
          errorList.style.display = 'block';
          errorItems.innerHTML = errors.map(e =>
            '<div class="error-item"><code>' + e.ip + '</code>: ' + e.error + '</div>'
          ).join('');
        }

        // نمایش خلاصه با جزئیات بیشتر
        let message = '✅ ' + success + ' آدرس جدید اضافه شد';
        if (duplicates > 0) {
          message += '\n🔄 ' + duplicates + ' آدرس تکراری';
        }
        if (failed > 0) {
          message += '\n❌ ' + failed + ' آدرس ناموفق';
        }
        if (summary) {
          message += '\n\n📊 توزیع کشورها:\n' + summary;
        }

        Toast.success(message, 8000);
        setTimeout(() => window.location.href = '/', 3000);
      } else {
        btn.textContent = '❌ لغو شد';
        btn.disabled = false;
        btn.onclick = null;
        progressText.textContent = '⏸️ لغو شد | ' + processed + '/' + addresses.length + ' پردازش شد';
      }

      cancelRequested = false;
    });
  }
});
}

function showTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  document.querySelector('[onclick="showTab(\'' + tabName + '\')"]').classList.add('active');
  document.getElementById(tabName + '-form').classList.add('active');
}

async function editCountry(code, currentName) {
  // ایجاد فرم ویرایش با SweetAlert یا Modal ساده
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;';

  const isDark = document.body.classList.contains('dark');
  const bgColor = isDark ? '#1f2937' : 'white';
  const textColor = isDark ? '#f3f4f6' : '#1f2937';
  const labelColor = isDark ? '#9ca3af' : '#6b7280';
  const borderColor = isDark ? '#374151' : '#e5e7eb';
  const inputBg = isDark ? '#374151' : 'white';
  const btnCancelBg = isDark ? '#374151' : '#e5e7eb';
  const btnCancelColor = isDark ? '#9ca3af' : '#6b7280';

  modal.innerHTML = '<div style="background:' + bgColor + ';border-radius:16px;padding:30px;max-width:500px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">' +
    '<h2 style="margin:0 0 20px;color:' + textColor + ';font-size:24px;">✏️ ویرایش کشور</h2>' +
    '<form id="edit-form">' +
      '<div style="margin-bottom:20px;">' +
        '<label style="display:block;margin-bottom:8px;color:' + labelColor + ';font-weight:600;">🌍 نام کشور (فارسی)</label>' +
        '<input type="text" id="edit-name" required style="width:100%;padding:12px;border:2px solid ' + borderColor + ';border-radius:8px;font-size:16px;font-family:inherit;background:' + inputBg + ';color:' + textColor + ';">' +
      '</div>' +
      '<div style="margin-bottom:20px;">' +
        '<label style="display:block;margin-bottom:8px;color:' + labelColor + ';font-weight:600;">🔤 کد کشور (2 حرفی)</label>' +
        '<input type="text" id="edit-code" maxlength="2" required style="width:100%;padding:12px;border:2px solid ' + borderColor + ';border-radius:8px;font-size:16px;text-transform:uppercase;font-family:monospace;background:' + inputBg + ';color:' + textColor + ';">' +
        '<small style="color:' + labelColor + ';display:block;margin-top:5px;">⚠️ تغییر کد کشور ممکن است بر داده‌های مرتبط تأثیر بگذارد</small>' +
      '</div>' +
      '<div style="display:flex;gap:10px;">' +
        '<button type="submit" style="flex:1;padding:12px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:white;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;">💾 ذخیره</button>' +
        '<button type="button" id="cancel-btn" style="flex:1;padding:12px;background:' + btnCancelBg + ';color:' + btnCancelColor + ';border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;">❌ لغو</button>' +
      '</div>' +
    '</form>' +
  '</div>';

  document.body.appendChild(modal);

  const form = modal.querySelector('#edit-form');
  const cancelBtn = modal.querySelector('#cancel-btn');
  const nameInput = modal.querySelector('#edit-name');
  const codeInput = modal.querySelector('#edit-code');

  // تنظیم مقادیر به صورت ایمن
  nameInput.value = currentName;
  codeInput.value = code;

  // فوکوس روی اولین فیلد
  nameInput.focus();
  nameInput.select();

  // بستن با کلیک روی پس‌زمینه
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });

  // دکمه لغو
  cancelBtn.addEventListener('click', () => {
    document.body.removeChild(modal);
  });

  // ارسال فرم
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const newName = nameInput.value.trim();
    const newCode = codeInput.value.trim().toUpperCase();

    if (!newName || !newCode || newCode.length !== 2) {
      Toast.error('لطفاً تمام فیلدها را به درستی پر کنید');
      return;
    }

    if (newName === currentName && newCode === code) {
      Toast.info('هیچ تغییری اعمال نشد');
      document.body.removeChild(modal);
      return;
    }

    try {
      const formData = new FormData();
      formData.append('action', 'edit_full');
      formData.append('old_code', code);
      formData.append('new_code', newCode);
      formData.append('country', newName);

      const response = await fetch('/api/admin/edit-dns', {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        Toast.success('✅ کشور با موفقیت ویرایش شد');
        document.body.removeChild(modal);
        setTimeout(() => window.location.reload(), 1500);
      } else {
        const result = await response.text();
        Toast.error('خطا در ویرایش: ' + result);
      }
    } catch (error) {
      Toast.error('خطا: ' + error.message);
    }
  });
}

// حذف یک آدرس خاص از کشور
async function deleteAddress(countryCode, address) {
  if (!confirm('آیا از حذف این آدرس مطمئن هستید؟\\n\\n' + address + '\\n\\nاز کشور: ' + countryCode)) {
    return;
  }

  try {
    const response = await fetch('/api/admin/delete-address', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: countryCode, address: address })
    });

    const result = await response.json();

    if (result.success) {
      Toast.success('✅ آدرس ' + address + ' با موفقیت حذف شد');
      setTimeout(function() { window.location.reload(); }, 1000);
    } else {
      Toast.error('❌ خطا در حذف آدرس: ' + (result.error || 'خطای نامشخص'));
    }
  } catch (error) {
    Toast.error('❌ خطا: ' + error.message);
  }
}

// به‌روزرسانی دکمه حذف گروهی
function updateBulkDeleteButton() {
  const checkboxes = document.querySelectorAll('.country-checkbox:checked');
  const count = checkboxes.length;
  const btn = document.getElementById('bulk-delete-btn');
  const countSpan = document.getElementById('selected-count');

  if (count > 0) {
    btn.style.display = 'inline-block';
    countSpan.textContent = count;
  } else {
    btn.style.display = 'none';
  }
}

// انتخاب/لغو انتخاب همه کشورها
function toggleSelectAll() {
  const checkboxes = document.querySelectorAll('.country-checkbox');
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);

  checkboxes.forEach(cb => {
    cb.checked = !allChecked;
  });

  updateBulkDeleteButton();

  const btn = document.getElementById('select-all-btn');
  btn.textContent = allChecked ? '☑️ انتخاب همه' : '☐ لغو انتخاب همه';
}

// حذف گروهی کشورهای انتخاب شده
async function bulkDeleteCountries() {
  const checkboxes = document.querySelectorAll('.country-checkbox:checked');
  const codes = Array.from(checkboxes).map(cb => cb.value);

  if (codes.length === 0) {
    Toast.warning('هیچ کشوری انتخاب نشده است');
    return;
  }

  const countryNames = codes.map(function(code) {
    const card = document.querySelector('.dns-card[data-code="' + code + '"]');
    return card ? card.querySelector('.country-details h3').textContent : code;
  }).join('، ');

  if (!confirm('آیا از حذف ' + codes.length + ' کشور مطمئن هستید؟\\n\\n' + countryNames + '\\n\\n⚠️ این عمل غیرقابل بازگشت است!')) {
    return;
  }

  try {
    const response = await fetch('/api/admin/bulk-delete-countries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes: codes })
    });

    const result = await response.json();

    if (result.success) {
      Toast.success('✅ ' + result.deleted + ' کشور با موفقیت حذف شد!');
      setTimeout(function() { window.location.reload(); }, 1500);
    } else {
      Toast.error('❌ خطا: ' + (result.error || 'خطای نامشخص'));
    }
  } catch (error) {
    Toast.error('❌ خطا: ' + error.message);
  }
}

async function fixCountryNames() {
  if (!confirm('آیا مطمئن هستید که می‌خواهید تمام اسم کشورها را به فارسی تبدیل کنید؟')) {
    return;
  }

  try {
    const response = await fetch('/api/admin/fix-country-names');
    const result = await response.json();

    if (result.success) {
      Toast.success(result.message);
      setTimeout(() => window.location.reload(), 1500);
    } else {
      Toast.error('خطا: ' + result.error);
    }
  } catch (error) {
    Toast.error('خطا در ارتباط با سرور: ' + error.message);
  }
}

async function removeDuplicates() {
  if (!confirm('آیا مطمئن هستید که می‌خواهید تمام آدرس‌های تکراری را از همه کشورها حذف کنید؟')) {
    return;
  }

  try {
    const btn = document.querySelector('button[onclick="removeDuplicates()"]');
    if (btn) { btn.disabled = true; btn.textContent = '🧹 در حال حذف تکراری‌ها...'; }

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 15000);
    const response = await fetch('/api/admin/remove-duplicates', { signal: controller.signal });
    clearTimeout(t);

    if (!response.ok) {
      throw new Error('پاسخ نامعتبر از سرور (' + response.status + ')');
    }

    const result = await response.json();

    if (result.success) {
      Toast.success(result.message);
      setTimeout(() => window.location.reload(), 1500);
    } else {
      Toast.error('خطا: ' + result.error);
    }
  } catch (error) {
    Toast.error('خطا در ارتباط با سرور: ' + error.message);
  } finally {
    const btn = document.querySelector('button[onclick="removeDuplicates()"]');
    if (btn) { btn.disabled = false; btn.textContent = '🧹 حذف آدرس‌های تکراری'; }
  }
}

async function downloadJSON() {
  try {
    const response = await fetch('/api/dns');
    const data = await response.json();

    if (!data || data.length === 0) {
      Toast.warning('هیچ داده‌ای برای دانلود وجود ندارد');
      return;
    }

    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().split('T')[0];
    a.download = 'dns-addresses-' + date + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    Toast.success('فایل JSON با موفقیت دانلود شد\\n📊 تعداد کشورها: ' + data.length);
  } catch (error) {
    Toast.error('خطا در دانلود فایل: ' + error.message);
  }
}

async function loadCountryData(code) {
  if (!code) {
    document.getElementById('current-addresses').innerHTML = 'انتخاب کشور را برای مشاهده آدرس‌های فعلی انجام دهید';
    document.getElementById('edit-stock').value = '0';
    return;
  }
  try {
    const response = await fetch('/api/dns');
    const entries = await response.json();
    const country = entries.find(e => e.code.toUpperCase() === code.toUpperCase());

    if (country) {
      document.getElementById('edit-stock').value = country.stock || 0;

      const addressesDiv = document.getElementById('current-addresses');
      if (country.addresses && country.addresses.length > 0) {
        addressesDiv.innerHTML = country.addresses.map(addr =>
          '<code>' + addr + '</code>'
        ).join('');
      } else {
        addressesDiv.innerHTML = '<em style="color: #64748b;">هیچ آدرسی برای این کشور ثبت نشده</em>';
      }
    }
  } catch (error) {
    console.error('خطا در بارگذاری اطلاعات:', error);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// 🌐 IPv6 Page Renderer
// ─────────────────────────────────────────────────────────────────────────────

function renderIpv6Page(entries, userCount) {
  const rows = entries.map(e => {
    const flag = countryCodeToFlag(e.code);
    const count = Array.isArray(e.addresses) ? e.addresses.length : 0;
    const stockColor = (e.stock || 0) > 5 ? '#10b981' : (e.stock || 0) > 0 ? '#f59e0b' : '#ef4444';

    return `
    <div class="dns-card">
      <div class="card-header">
        <div class="country-info">
          <span class="country-flag">${flag}</span>
          <div class="country-details">
            <h3>${escapeHtml(e.country)}</h3>
            <span class="country-code">${escapeHtml(e.code)}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-edit" data-code="${escapeHtml(e.code)}" data-country="${escapeHtml(e.country)}" title="ویرایش نام">✏️</button>
          <form method="POST" action="/api/admin/delete-ipv6" style="display:inline;">
            <input type="hidden" name="code" value="${escapeHtml(e.code)}">
            <button type="submit" class="btn-delete" title="حذف">🗑️</button>
          </form>
        </div>
      </div>
      <div class="card-body">
        <div class="stat-item">
          <span class="stat-label">موجودی:</span>
          <span class="stat-value" style="color: ${stockColor};">${e.stock ?? 0}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">تعداد آدرس:</span>
          <span class="stat-value">${count}</span>
        </div>
      </div>
      <div class="card-footer">
        <details>
          <summary>مشاهده آدرس‌ها</summary>
          <div class="addresses-list">
            ${count > 0 ? e.addresses.map(addr => `<code>${escapeHtml(addr)}</code>`).join('') : '<span class="empty">هیچ آدرسی ثبت نشده</span>'}
          </div>
        </details>
      </div>
    </div>`;
  }).join('\n');

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>🌐 پنل مدیریت IPv6</title>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>${getWebCss()}</style>
</head>
<body>
<div id="toast-container" class="toast-container"></div>
<div class="container">
  <header class="main-header">
    <div class="header-content">
      <h1>🌐 پنل مدیریت IPv6</h1>
      <p class="subtitle">مدیریت و پیکربندی سرورهای IPv6 در سراسر دنیا</p>
    </div>
    <div class="header-actions">
      <div class="search-box">
        <input id="search" type="text" placeholder="جستجو: نام یا کد کشور..." autocomplete="off">
        <span class="search-icon">🔎</span>
      </div>
      <button id="theme-toggle" class="btn-toggle" aria-label="تغییر تم">🌙</button>
    </div>
    <div class="header-stats">
      <div class="stat-box">
        <span class="stat-number">${entries.length}</span>
        <span class="stat-text">کشور</span>
      </div>
      <div class="stat-box">
        <span class="stat-number">${entries.reduce((sum, e) => sum + (e.stock || 0), 0)}</span>
        <span class="stat-text">موجودی کل</span>
      </div>
      <div class="stat-box">
        <span class="stat-number">${userCount}</span>
        <span class="stat-text">کاربر ربات</span>
      </div>
    </div>
    <div style="margin-top: 20px; text-align: center;">
      <a href="/" class="btn-submit" style="display: inline-block; padding: 12px 24px; text-decoration: none; background: linear-gradient(135deg, #3b82f6, #8b5cf6);">
        🌐 بازگشت به IPv4
      </a>
    </div>
  </header>

  <section class="section">
    <div class="section-header">
      <h2>📋 لیست IPv6 های موجود</h2>
      <span class="badge">${entries.length} مورد</span>
    </div>
    <div id="dns-grid" class="dns-grid">
      ${rows || '<div class="empty-state">هنوز هیچ IPv6 ثبت نشده است</div>'}
    </div>
  </section>

  <section class="section">
    <div class="section-header">
      <h2>🚀 افزودن گروهی آدرس‌های IPv6</h2>
    </div>
    <form method="POST" action="/api/admin/bulk-add-ipv6" class="dns-form">
      <div class="form-row">
        <div class="form-group">
          <label>🌍 نام کشور (فارسی)</label>
          <input name="country" placeholder="مثال: آلمان" required autocomplete="off">
        </div>
        <div class="form-group">
          <label>🔤 کد کشور (2 حرفی)</label>
          <input name="code" placeholder="DE" maxlength="2" required autocomplete="off" style="text-transform:uppercase;">
        </div>
      </div>
      <div class="form-group full-width">
        <label>📡 آدرس‌های IPv6 (هر خط یک آدرس)</label>
        <textarea name="addresses" placeholder="2001:4860:4860::8888&#10;2606:4700:4700::1111" rows="8" required></textarea>
        <small>هر آدرس IPv6 را در یک خط جداگانه وارد کنید. موجودی به صورت خودکار بر اساس تعداد آدرس‌ها محاسبه می‌شود.</small>
      </div>
      <button type="submit" class="btn-submit" id="bulk-submit">💾 افزودن گروهی</button>
    </form>
  </section>

  <section class="section">
    <div class="section-header">
      <h2>➕ افزودن IPv6 جدید</h2>
    </div>
    <form method="POST" action="/api/admin/add-ipv6" class="dns-form">
      <div class="form-row">
        <div class="form-group">
          <label>🌍 نام کشور (فارسی)</label>
          <input name="country" placeholder="مثال: ایران" required autocomplete="off">
        </div>
        <div class="form-group">
          <label>🔤 کد کشور (2 حرفی)</label>
          <input name="code" placeholder="IR" maxlength="2" required autocomplete="off" style="text-transform:uppercase;">
        </div>
      </div>
      <div class="form-group full-width">
        <label>📡 آدرس‌های IPv6 (هر خط یک آدرس)</label>
        <textarea name="addresses" placeholder="2001:4860:4860::8888&#10;2606:4700:4700::1111" rows="5" required></textarea>
        <small>هر آدرس IPv6 را در یک خط جداگانه وارد کنید. موجودی به صورت خودکار بر اساس تعداد آدرس‌ها محاسبه می‌شود.</small>
      </div>
      <button type="submit" class="btn-submit">💾 ذخیره اطلاعات</button>
    </form>
  </section>
</div>

<script>
// Toast Notification System
const Toast = {
  container: null,

  init() {
    this.container = document.getElementById('toast-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  },

  show(message, type = 'info', duration = 5000) {
    this.init();

    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };

    const titles = {
      success: 'موفقیت',
      error: 'خطا',
      warning: 'هشدار',
      info: 'اطلاعات'
    };

    const toast = document.createElement('div');
    toast.className = 'toast ' + type;

    toast.innerHTML = '<div class="toast-icon">' + (icons[type] || icons.info) + '</div>' +
      '<div class="toast-content">' +
        '<div class="toast-title">' + (titles[type] || titles.info) + '</div>' +
        '<div class="toast-message">' + message + '</div>' +
      '</div>' +
      '<button class="toast-close">×</button>';

    this.container.appendChild(toast);

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => this.remove(toast));

    if (duration > 0) {
      setTimeout(() => this.remove(toast), duration);
    }

    return toast;
  },

  remove(toast) {
    toast.classList.add('removing');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  },

  success(message, duration) {
    return this.show(message, 'success', duration);
  },

  error(message, duration) {
    return this.show(message, 'error', duration);
  },

  warning(message, duration) {
    return this.show(message, 'warning', duration);
  },

  info(message, duration) {
    return this.show(message, 'info', duration);
  }
};

// Only run client-side code in browser environment
if (typeof document !== 'undefined') {
document.addEventListener('DOMContentLoaded', () => {
  const cards = document.querySelectorAll('.dns-card');
  cards.forEach((card, i) => { card.style.animationDelay = (i * 0.05) + 's'; });

  const toggleBtn = document.getElementById('theme-toggle');
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') { document.body.classList.add('dark'); toggleBtn.textContent = '☀️'; }
  toggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    const dark = document.body.classList.contains('dark');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    toggleBtn.textContent = dark ? '☀️' : '🌙';
  });

  const search = document.getElementById('search');
  const grid = document.getElementById('dns-grid');
  if (search && grid) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      grid.querySelectorAll('.dns-card').forEach(card => {
        const name = card.querySelector('.country-details h3')?.textContent?.toLowerCase() || '';
        const code = card.querySelector('.country-code')?.textContent?.toLowerCase() || '';
        const addrs = Array.from(card.querySelectorAll('.addresses-list code')).map(c => c.textContent.toLowerCase()).join(' ');
        const ok = !q || name.includes(q) || code.includes(q) || addrs.includes(q);
        card.style.display = ok ? '' : 'none';
      });
    });
  }
});
}

async function editCountry(code, currentName) {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;';

  const isDark = document.body.classList.contains('dark');
  const bgColor = isDark ? '#1f2937' : 'white';
  const textColor = isDark ? '#f3f4f6' : '#1f2937';
  const labelColor = isDark ? '#9ca3af' : '#6b7280';
  const borderColor = isDark ? '#374151' : '#e5e7eb';
  const inputBg = isDark ? '#374151' : 'white';
  const btnCancelBg = isDark ? '#374151' : '#e5e7eb';
  const btnCancelColor = isDark ? '#9ca3af' : '#6b7280';

  modal.innerHTML = '<div style="background:' + bgColor + ';border-radius:16px;padding:30px;max-width:500px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">' +
    '<h2 style="margin:0 0 20px;color:' + textColor + ';font-size:24px;">✏️ ویرایش کشور</h2>' +
    '<form id="edit-form">' +
      '<div style="margin-bottom:20px;">' +
        '<label style="display:block;margin-bottom:8px;color:' + labelColor + ';font-weight:600;">🌍 نام کشور (فارسی)</label>' +
        '<input type="text" id="edit-name" required style="width:100%;padding:12px;border:2px solid ' + borderColor + ';border-radius:8px;font-size:16px;font-family:inherit;background:' + inputBg + ';color:' + textColor + ';">' +
      '</div>' +
      '<div style="margin-bottom:20px;">' +
        '<label style="display:block;margin-bottom:8px;color:' + labelColor + ';font-weight:600;">🔤 کد کشور (2 حرفی)</label>' +
        '<input type="text" id="edit-code" maxlength="2" required style="width:100%;padding:12px;border:2px solid ' + borderColor + ';border-radius:8px;font-size:16px;text-transform:uppercase;font-family:monospace;background:' + inputBg + ';color:' + textColor + ';">' +
        '<small style="color:' + labelColor + ';display:block;margin-top:5px;">⚠️ تغییر کد کشور ممکن است بر داده‌های مرتبط تأثیر بگذارد</small>' +
      '</div>' +
      '<div style="display:flex;gap:10px;">' +
        '<button type="submit" style="flex:1;padding:12px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:white;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;">💾 ذخیره</button>' +
        '<button type="button" id="cancel-btn" style="flex:1;padding:12px;background:' + btnCancelBg + ';color:' + btnCancelColor + ';border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;">❌ لغو</button>' +
      '</div>' +
    '</form>' +
  '</div>';

  document.body.appendChild(modal);

  const form = modal.querySelector('#edit-form');
  const cancelBtn = modal.querySelector('#cancel-btn');
  const nameInput = modal.querySelector('#edit-name');
  const codeInput = modal.querySelector('#edit-code');

  // تنظیم مقادیر به صورت ایمن
  nameInput.value = currentName;
  codeInput.value = code;

  nameInput.focus();
  nameInput.select();

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });

  cancelBtn.addEventListener('click', () => {
    document.body.removeChild(modal);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const newName = nameInput.value.trim();
    const newCode = codeInput.value.trim().toUpperCase();

    if (!newName || !newCode || newCode.length !== 2) {
      Toast.error('لطفاً تمام فیلدها را به درستی پر کنید');
      return;
    }

    if (newName === currentName && newCode === code) {
      Toast.info('هیچ تغییری اعمال نشد');
      document.body.removeChild(modal);
      return;
    }

    try {
      const formData = new FormData();
      formData.append('action', 'edit_full');
      formData.append('old_code', code);
      formData.append('new_code', newCode);
      formData.append('country', newName);

      const response = await fetch('/api/admin/update-ipv6-name', {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        Toast.success('کشور با موفقیت ویرایش شد!');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        Toast.error('خطا در ویرایش کشور');
      }
    } catch (error) {
      Toast.error('خطا در ارتباط با سرور');
    }

    document.body.removeChild(modal);
  });
}

</script>
</body>
</html>
`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}


// ─────────────────────────────────────────────────────────────────────────────
// 📡 Telegram API Communication
// ─────────────────────────────────────────────────────────────────────────────

async function telegramApi(env, method, body = {}, timeoutMs = 8000) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
    const res = await fetch(`${TELEGRAM_BASE(env.BOT_TOKEN)}${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(t);
    const json = await res.json().catch(() => ({}));
    return json;
  } catch (e) {
    console.error('خطا در Telegram API:', e);
    return { ok: false, error: e?.message || 'request_failed' };
  }
}

// Cache برای لیست DNS (5 دقیقه)
let dnsListCache = { data: null, timestamp: 0 };
const DNS_CACHE_TTL = 300000; // 5 minutes

async function getCachedDnsList(kv) {
  const now = Date.now();
  if (dnsListCache.data && (now - dnsListCache.timestamp) < DNS_CACHE_TTL) {
    return dnsListCache.data;
  }
  const entries = await listDnsEntries(kv);
  dnsListCache = { data: entries, timestamp: now };
  return entries;
}

function invalidateDnsCache() {
  dnsListCache = { data: null, timestamp: 0 };
}

// ساخت کیبورد اصلی

// ═════════════════════════════════════════════════════════════════════════════
// 🤖 TELEGRAM BOT HANDLERS & KEYBOARDS
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// ⌨️ Telegram Keyboard Builders
// ─────────────────────────────────────────────────────────────────────────────

function buildMainKeyboard(userId, adminId = 7240662021) {
  const rows = [];
  // سطر اول: وایرگارد و دی ان اس کنار هم
  rows.push([
    { text: '🛰️ وایرگارد', callback_data: 'wireguard' },
    { text: '🧭 دی ان اس', callback_data: 'show_dns_menu' }
  ]);
  // سطر دوم: حساب کاربری و ارسال بازخورد
  rows.push([
    { text: '💬 ارسال بازخورد', callback_data: 'send_feedback' },
    { text: '👤 حساب کاربری', callback_data: 'account' }
  ]);
  // سطر سوم: ادمین (در صورت نیاز)
  if (Number(userId) === Number(adminId)) {
    rows.push([
      { text: '📢 پیام همگانی', callback_data: 'broadcast' },
      { text: '🎁 ریست محدودیت', callback_data: 'reset_quota' }
    ]);
    rows.push([{ text: '📊 آمار ربات', callback_data: 'stats' }]);
  }
  return { inline_keyboard: rows };
}

// ساخت کیبورد لیست کشورها با صفحه‌بندی و فیلتر
function buildDnsKeyboard(entries, page = 0, sortOrder = 'default') {
  const ITEMS_PER_PAGE = 12;

  // مرتب‌سازی بر اساس موجودی
  let sortedEntries = [...entries];
  if (sortOrder === 'low_to_high') {
    sortedEntries.sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0));
  } else if (sortOrder === 'high_to_low') {
    sortedEntries.sort((a, b) => (b.stock ?? 0) - (a.stock ?? 0));
  }

  const totalPages = Math.ceil(sortedEntries.length / ITEMS_PER_PAGE);
  const startIndex = page * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentEntries = sortedEntries.slice(startIndex, endIndex);

  const rows = [];

  // اضافه کردن دکمه فیلتر در اول با نمایش حالت فعلی
  const filterEmoji = sortOrder === 'low_to_high' ? '📈' : sortOrder === 'high_to_low' ? '📉' : '🔀';
  const filterLabel = sortOrder === 'low_to_high' ? 'کم به زیاد' : sortOrder === 'high_to_low' ? 'زیاد به کم' : 'پیش‌فرض';
  const nextSortOrder = sortOrder === 'default' ? 'low_to_high' : sortOrder === 'low_to_high' ? 'high_to_low' : 'default';
  rows.push([{
    text: `${filterEmoji} فیلتر: ${filterLabel}`,
    callback_data: `dns_sort:${nextSortOrder}:${page}`
  }]);

  currentEntries.forEach(e => {
    const flag = countryCodeToFlag(e.code);
    const stock = e.stock ?? 0;
    const totalAddresses = Array.isArray(e.addresses) ? e.addresses.length : 0;
    // تبدیل نام کشور به فارسی
    const countryName = ensurePersianCountryName(e.country, e.code);

    let stockEmoji = '🔴';

    if (stock > 10) {
      stockEmoji = '🟢';
    } else if (stock > 5) {
      stockEmoji = '🟡';
    } else if (stock > 0) {
      stockEmoji = '🟡';
    }

    // سه دکمه در یک ردیف - دایره رنگی سمت چپ، تعداد وسط، کشور سمت راست
    rows.push([
      {
        text: `${stockEmoji}`,
        callback_data: `stock:${e.code.toUpperCase()}`
      },
      {
        text: `${stock}`,
        callback_data: `stock:${e.code.toUpperCase()}`
      },
      {
        text: `${flag} ${countryName}`,
        callback_data: `dns:${e.code.toUpperCase()}`
      }
    ]);
  });

  // اضافه کردن دکمه‌های صفحه‌بندی
  if (totalPages > 1) {
    const paginationRow = [];

    // دکمه صفحه قبل
    if (page > 0) {
      paginationRow.push({
        text: '⬅️ قبلی',
        callback_data: `dns_page:${page - 1}:${sortOrder}`
      });
    }

    // نمایش شماره صفحه فعلی
    paginationRow.push({
      text: `${page + 1}/${totalPages}`,
      callback_data: `dns_current_page`
    });

    // دکمه صفحه بعد
    if (page < totalPages - 1) {
      paginationRow.push({
        text: 'بعدی ➡️',
        callback_data: `dns_page:${page + 1}:${sortOrder}`
      });
    }

    rows.push(paginationRow);
  }

  rows.push([{ text: '🔙 بازگشت', callback_data: 'show_dns_menu' }]);

  return { inline_keyboard: rows };
}

// نمایش یک DNS رندوم از کشور انتخابی

// ─────────────────────────────────────────────────────────────────────────────
// 🎯 DNS & IPv6 Selection Handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleDnsSelection(chat, messageId, code, env, userId) {
  const entry = await getDnsEntry(env.DB, code);

  if (!entry) {
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: '❌ هیچ DNSی برای این کشور یافت نشد.',
      reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'show_dns_menu' }]] }
    });
  }

  // تبدیل نام کشور به فارسی (اگر انگلیسی باشد)
  const countryName = ensurePersianCountryName(entry.country, entry.code);

  // بررسی موجودی
  if (!entry.stock || entry.stock <= 0) {
    const flag = countryCodeToFlag(entry.code);
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: `${flag} دی ان اس ${countryName}\n\nناموجود. کشور دیگری را انتخاب کنید.`,
      reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'show_dns_menu' }]] }
    });
  }

  // بررسی وجود آدرس
  if (!Array.isArray(entry.addresses) || entry.addresses.length === 0) {
    const flag = countryCodeToFlag(entry.code);
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: `${flag} دی ان اس ${countryName}\n\nهیچ آدرسی ثبت نشده است.`,
      reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'show_dns_menu' }]] }
    });
  }

  // محدودیت روزانه کاربر برای دریافت DNS
  const quota = await getUserQuota(env.DB, userId, 'dns', getAdminId(env));
  if (quota.count >= quota.limit) {
    const timeLeft = getTimeUntilReset();
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: `⏳ محدودیت روزانه دریافت DNS شما به پایان رسیده است.\n\n📊 امروز مجاز: ${quota.limit} مورد\n⏰ زمان باقی‌مانده تا ریست: ${timeLeft}`,
      reply_markup: { inline_keyboard: [[{ text: '👤 حساب کاربری', callback_data: 'account' }], [{ text: '🔙 بازگشت', callback_data: 'show_dns_menu' }]] }
    });
  }

  // انتخاب یک DNS رندوم
  const selectedDns = getRandomDns(entry);

  if (!selectedDns) {
    const flag = countryCodeToFlag(entry.code);
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: `${flag} دی ان اس ${countryName}\n\nهیچ آدرسی موجود نیست.`,
      reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'show_dns_menu' }]] }
    });
  }

  const flag = countryCodeToFlag(entry.code);

  // افزایش مصرف کاربر و حذف آدرس از لیست
  await incUserQuota(env.DB, userId, 'dns');
  const newQuota = await getUserQuota(env.DB, userId, 'dns', getAdminId(env));
  await addUserHistory(env.DB, userId, 'dns', `${entry.code}:${selectedDns}`);
  // حذف آدرس استفاده شده از لیست و بروزرسانی خودکار موجودی
  await removeAddressFromEntry(env.DB, code, selectedDns);

  // دریافت موجودی جدید
  const updatedEntry = await getDnsEntry(env.DB, code);
  const remainingStock = updatedEntry ? updatedEntry.stock : 0;

  // پیام مینیمال
  let msg = `${flag} دی ان اس ${countryName}\n\n`;
  msg += `آدرس اختصاصی شما:\n\`${selectedDns}\`\n\n`;
  msg += `📊 سهمیه امروز شما: ${newQuota.count}/${newQuota.limit}\n`;
  msg += `📦 موجودی باقی‌مانده ${countryName}: ${remainingStock}\n\n`;
  msg += `🎮 DNS‌های پیشنهادی برای تانل:\n`;
  msg += `• \`178.22.122.100\` - شاتل\n`;
  msg += `• \`185.51.200.2\` - ایرانسل\n`;
  msg += `• \`10.202.10.10\` - رادار\n`;
  msg += `• \`8.8.8.8\` - گوگل\n`;
  msg += `• \`1.1.1.1\` - کلودفلر\n`;
  msg += `• \`4.2.2.4\` - لول 3\n`;
  msg += `• \`78.157.42.100\` - الکترو\n\n`;
  msg += `💡 *نکته مهم:* برای بررسی فیلتر، فقط سرورهای ایران را چک کنید و باید 4/4 باشد.`;

  const checkUrl = `https://check-host.net/check-ping?host=${selectedDns}`;

  return telegramApi(env, '/editMessageText', {
    chat_id: chat,
    message_id: messageId,
    text: msg,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔍 بررسی فیلتر آدرس', url: checkUrl }],
        [{ text: '🔄 دریافت DNS جدید', callback_data: `dns:${code}` }],
        [{ text: '🔙 بازگشت', callback_data: 'show_dns_menu' }]
      ]
    }
  });
}

// ساخت کیبورد لیست کشورها برای IPv6 با صفحه‌بندی
function buildIpv6Keyboard(entries, page = 0) {
  const ITEMS_PER_PAGE = 12;
  const totalPages = Math.ceil(entries.length / ITEMS_PER_PAGE);
  const startIndex = page * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentEntries = entries.slice(startIndex, endIndex);

  const rows = [];

  currentEntries.forEach(e => {
    const flag = countryCodeToFlag(e.code);
    const stock = e.stock ?? 0;
    const countryName = ensurePersianCountryName(e.country, e.code);

    let stockEmoji = '🔴';
    if (stock > 10) {
      stockEmoji = '🟢';
    } else if (stock > 5) {
      stockEmoji = '🟡';
    } else if (stock > 0) {
      stockEmoji = '🟡';
    }

    rows.push([
      {
        text: `${stockEmoji}`,
        callback_data: `stock_ipv6:${e.code.toUpperCase()}`
      },
      {
        text: `${stock}`,
        callback_data: `stock_ipv6:${e.code.toUpperCase()}`
      },
      {
        text: `${flag} ${countryName}`,
        callback_data: `ipv6:${e.code.toUpperCase()}`
      }
    ]);
  });

  // دکمه‌های صفحه‌بندی
  if (totalPages > 1) {
    const paginationRow = [];
    if (page > 0) {
      paginationRow.push({
        text: '⬅️ قبلی',
        callback_data: `page_ipv6:${page - 1}`
      });
    }
    paginationRow.push({
      text: `${page + 1}/${totalPages}`,
      callback_data: `current_page_ipv6`
    });
    if (page < totalPages - 1) {
      paginationRow.push({
        text: 'بعدی ➡️',
        callback_data: `page_ipv6:${page + 1}`
      });
    }
    rows.push(paginationRow);
  }

  rows.push([{ text: '🔙 بازگشت', callback_data: 'show_dns_menu' }]);

  return { inline_keyboard: rows };
}

// نمایش یک IPv6 رندوم از کشور انتخابی
async function handleIpv6Selection(chat, messageId, code, env, userId) {
  const entry = await getIpv6Entry(env.DB, code);

  if (!entry) {
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: '❌ هیچ IPv6 برای این کشور یافت نشد.',
      reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'show_dns_menu' }]] }
    });
  }

  const countryName = ensurePersianCountryName(entry.country, entry.code);

  // بررسی موجودی
  if (!entry.stock || entry.stock <= 0) {
    const flag = countryCodeToFlag(entry.code);
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: `${flag} IPv6 ${countryName}\n\nناموجود. کشور دیگری را انتخاب کنید.`,
      reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'show_dns_menu' }]] }
    });
  }

  // بررسی وجود آدرس
  if (!Array.isArray(entry.addresses) || entry.addresses.length === 0) {
    const flag = countryCodeToFlag(entry.code);
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: `${flag} IPv6 ${countryName}\n\nهیچ آدرسی ثبت نشده است.`,
      reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'show_dns_menu' }]] }
    });
  }

  // محدودیت روزانه کاربر برای دریافت IPv6
  const quota = await getUserQuota(env.DB, userId, 'ipv6', getAdminId(env));
  if (quota.count >= quota.limit) {
    const timeLeft = getTimeUntilReset();
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: `⏳ محدودیت روزانه دریافت IPv6 شما به پایان رسیده است.\n\n📊 امروز مجاز: ${quota.limit} مورد\n⏰ زمان باقی‌مانده تا ریست: ${timeLeft}`,
      reply_markup: { inline_keyboard: [[{ text: '👤 حساب کاربری', callback_data: 'account' }], [{ text: '🔙 بازگشت', callback_data: 'show_dns_menu' }]] }
    });
  }

  // انتخاب 2 آدرس IPv6 رندوم
  const selectedIpv6_1 = getRandomIpv6(entry);

  if (!selectedIpv6_1) {
    const flag = countryCodeToFlag(entry.code);
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: `${flag} IPv6 ${countryName}\n\nهیچ آدرسی موجود نیست.`,
      reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'show_dns_menu' }]] }
    });
  }

  // حذف آدرس اول از لیست
  await removeIpv6AddressFromEntry(env.DB, code, selectedIpv6_1);

  // دریافت entry بروزرسانی شده برای انتخاب آدرس دوم
  const updatedEntry1 = await getIpv6Entry(env.DB, code);
  const selectedIpv6_2 = updatedEntry1 ? getRandomIpv6(updatedEntry1) : null;

  // حذف آدرس دوم از لیست (اگر موجود باشد)
  if (selectedIpv6_2) {
    await removeIpv6AddressFromEntry(env.DB, code, selectedIpv6_2);
  }

  const flag = countryCodeToFlag(entry.code);

  // افزایش مصرف کاربر
  await incUserQuota(env.DB, userId, 'ipv6');
  const newQuota = await getUserQuota(env.DB, userId, 'ipv6', getAdminId(env));

  // ذخیره در تاریخچه
  const historyItem = selectedIpv6_2
    ? `${entry.code}:${selectedIpv6_1},${selectedIpv6_2}`
    : `${entry.code}:${selectedIpv6_1}`;
  await addUserHistory(env.DB, userId, 'ipv6', historyItem);

  // دریافت موجودی جدید
  const updatedEntry = await getIpv6Entry(env.DB, code);
  const remainingStock = updatedEntry ? updatedEntry.stock : 0;

  // پیام مینیمال
  let msg = `${flag} IPv6 ${countryName}\n\n`;
  msg += `آدرس‌های اختصاصی شما:\n`;
  msg += `\`${selectedIpv6_1}\`\n`;
  if (selectedIpv6_2) {
    msg += `\`${selectedIpv6_2}\`\n`;
  }
  msg += `\n📊 سهمیه امروز شما: ${newQuota.count}/${newQuota.limit}\n`;
  msg += `📦 موجودی باقی‌مانده ${countryName}: ${remainingStock}`;

  return telegramApi(env, '/editMessageText', {
    chat_id: chat,
    message_id: messageId,
    text: msg,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 دریافت IPv6 جدید', callback_data: `ipv6:${code}` }],
        [{ text: '🔙 بازگشت', callback_data: 'show_dns_menu' }]
      ]
    }
  });
}

// مدیریت آپدیت‌های تلگرام
// ─────────────────────────────────────────────────────────────────────────────
// 🔄 Main Update Handler (Telegram Webhook)
export async function handleUpdate(update, env) {
  try {
    // پیام‌های عادی
    if (update.message) {
      const msg = update.message;
      const chat = msg.chat.id;
      const text = msg.text || '';
      const from = msg.from || {};

      await saveUser(env.DB, from);

      // پاسخ ندادن در گروه/سوپرگروه/کانال - فقط پیوی
      try {
        const chatType = msg.chat && msg.chat.type;
        if (chatType && chatType !== 'private') {
          return; // هیچ پاسخی در گروه‌ها نده
        }
      } catch {}

      if (Number(from.id) === Number(getAdminId(env))) {
        const state = await env.DB.get(`admin_state:${getAdminId(env)}`);

        // ارسال پیام همگانی (متن، عکس، ویدیو، فایل با کپشن)
        if (state === 'broadcast_waiting') {
          const res = await env.DB.list({ prefix: 'users:' });
          const totalUsers = res.keys.filter(k => {
            const userId = Number(k.name.split(':')[1]);
            return userId && userId !== getAdminId(env);
          }).length;

          let sent = 0;
          let failed = 0;
          let consecutiveFailures = 0;
          const BASE_DELAY_MS = 150;
          const MAX_RETRY_AFTER_MS = 3000;

          // ارسال پیام شروع
          const progressMsg = await telegramApi(env, '/sendMessage', {
            chat_id: chat,
            text: `⏳ در حال ارسال به ${totalUsers} کاربر...\n\n✅ موفق: 0\n❌ ناموفق: 0`
          });
          const progressMsgId = progressMsg?.result?.message_id;

          // Helper: safely update progress (every 3 sends or at final)
          const updateProgress = async (label) => {
            const done = sent + failed;
            if (!progressMsgId) return;
            if (done % 3 !== 0 && done !== totalUsers) return;
            try {
              await telegramApi(env, '/editMessageText', {
                chat_id: chat,
                message_id: progressMsgId,
                text: `⏳ در حال ارسال ${label}...\n\n📊 پیشرفت: ${done}/${totalUsers}\n✅ موفق: ${sent}\n❌ ناموفق: ${failed}`
              }, 3000);
            } catch (e) {
              // ignore edit errors to keep loop running
            }
          };

          // بررسی عکس
          if (msg.photo && msg.photo.length > 0) {
            const photo = msg.photo[msg.photo.length - 1]; // بزرگترین سایز
            const caption = msg.caption || '';

            const userIds = res.keys
              .map(k => Number(k.name.split(':')[1]))
              .filter(uid => uid && uid !== getAdminId(env));

            const BATCH_SIZE = 5;
            for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
              const batch = userIds.slice(i, i + BATCH_SIZE);
              const results = await Promise.allSettled(batch.map(async (userId) => {
                try {
                  const resp = await telegramApi(env, '/sendPhoto', {
                    chat_id: userId,
                    photo: photo.file_id,
                    caption: caption,
                    parse_mode: caption ? 'Markdown' : undefined
                  }, 5000);
                  if (resp && resp.ok === true) {
                    return true;
                  } else {
                    const retryAfter = resp?.parameters?.retry_after;
                    if (retryAfter && Number(retryAfter) > 0) {
                      const waitMs = Math.min((Number(retryAfter) + 1) * 1000, MAX_RETRY_AFTER_MS);
                      await new Promise(r => setTimeout(r, waitMs));
                    }
                    return false;
                  }
                } catch (e) {
                  return false;
                }
              }));

              for (const r of results) {
                if (r.status === 'fulfilled' && r.value === true) {
                  sent++;
                } else {
                  failed++;
                }
              }

              // Reset failure streak if we advanced
              consecutiveFailures = (results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value === false)).length > 0) ? (consecutiveFailures + 1) : 0;

              await updateProgress('عکس');

              if (consecutiveFailures >= 5) {
                await new Promise(r => setTimeout(r, 1000));
                consecutiveFailures = 0;
              } else {
                await new Promise(r => setTimeout(r, BASE_DELAY_MS));
              }
            }
            await env.DB.delete(`admin_state:${getAdminId(env)}`);

            // پیام نهایی
            if (progressMsgId) {
              await telegramApi(env, '/editMessageText', {
                chat_id: chat,
                message_id: progressMsgId,
                text: `✅ *ارسال عکس تکمیل شد!*\n\n📊 کل کاربران: ${totalUsers}\n✅ موفق: ${sent}\n❌ ناموفق: ${failed}`,
                parse_mode: 'Markdown'
              });
            }
            return;
          }
          // بررسی ویدیو
          else if (msg.video) {
            const caption = msg.caption || '';

            const userIds = res.keys
              .map(k => Number(k.name.split(':')[1]))
              .filter(uid => uid && uid !== getAdminId(env));

            const BATCH_SIZE = 5;
            try {
              for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
                const batch = userIds.slice(i, i + BATCH_SIZE);
                const results = await Promise.allSettled(batch.map(async (userId) => {
                  try {
                    const resp = await telegramApi(env, '/sendVideo', {
                      chat_id: userId,
                      video: msg.video.file_id,
                      caption: caption,
                      parse_mode: caption ? 'Markdown' : undefined
                    }, 5000);
                    if (resp && resp.ok === true) {
                      return true;
                    } else {
                      const retryAfter = resp?.parameters?.retry_after;
                      if (retryAfter && Number(retryAfter) > 0) {
                        const waitMs = Math.min((Number(retryAfter) + 1) * 1000, MAX_RETRY_AFTER_MS);
                        await new Promise(r => setTimeout(r, waitMs));
                      }
                      return false;
                    }
                  } catch {
                    return false;
                  }
                }));

                for (const r of results) {
                  if (r.status === 'fulfilled' && r.value === true) {
                    sent++;
                  } else {
                    failed++;
                  }
                }

                consecutiveFailures = (results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value === false)).length > 0) ? (consecutiveFailures + 1) : 0;

                await updateProgress('ویدیو');

                if (consecutiveFailures >= 5) {
                  await new Promise(r => setTimeout(r, 1000));
                  consecutiveFailures = 0;
                } else {
                  await new Promise(r => setTimeout(r, BASE_DELAY_MS));
                }
              }
            } finally {
              await env.DB.delete(`admin_state:${getAdminId(env)}`);
              if (progressMsgId) {
                await telegramApi(env, '/editMessageText', {
                  chat_id: chat,
                  message_id: progressMsgId,
                  text: `✅ *ارسال ویدیو تکمیل شد!*\n\n📊 کل کاربران: ${totalUsers}\n✅ موفق: ${sent}\n❌ ناموفق: ${failed}`,
                  parse_mode: 'Markdown'
                }, 3000);
              }
            }
            return;
          }
          // بررسی فایل
          else if (msg.document) {
            const caption = msg.caption || '';

            const userIds = res.keys
              .map(k => Number(k.name.split(':')[1]))
              .filter(uid => uid && uid !== getAdminId(env));

            const BATCH_SIZE = 5;
            try {
              for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
                const batch = userIds.slice(i, i + BATCH_SIZE);
                const results = await Promise.allSettled(batch.map(async (userId) => {
                  try {
                    const resp = await telegramApi(env, '/sendDocument', {
                      chat_id: userId,
                      document: msg.document.file_id,
                      caption: caption,
                      parse_mode: caption ? 'Markdown' : undefined
                    }, 5000);
                    if (resp && resp.ok === true) {
                      return true;
                    } else {
                      const retryAfter = resp?.parameters?.retry_after;
                      if (retryAfter && Number(retryAfter) > 0) {
                        const waitMs = Math.min((Number(retryAfter) + 1) * 1000, MAX_RETRY_AFTER_MS);
                        await new Promise(r => setTimeout(r, waitMs));
                      }
                      return false;
                    }
                  } catch {
                    return false;
                  }
                }));

                for (const r of results) {
                  if (r.status === 'fulfilled' && r.value === true) {
                    sent++;
                  } else {
                    failed++;
                  }
                }

                consecutiveFailures = (results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value === false)).length > 0) ? (consecutiveFailures + 1) : 0;

                await updateProgress('فایل');

                if (consecutiveFailures >= 5) {
                  await new Promise(r => setTimeout(r, 1000));
                  consecutiveFailures = 0;
                } else {
                  await new Promise(r => setTimeout(r, BASE_DELAY_MS));
                }
              }
            } finally {
              await env.DB.delete(`admin_state:${getAdminId(env)}`);
              if (progressMsgId) {
                await telegramApi(env, '/editMessageText', {
                  chat_id: chat,
                  message_id: progressMsgId,
                  text: `✅ *ارسال فایل تکمیل شد!*\n\n📊 کل کاربران: ${totalUsers}\n✅ موفق: ${sent}\n❌ ناموفق: ${failed}`,
                  parse_mode: 'Markdown'
                }, 3000);
              }
            }
            return;
          }
          // ارسال متن ساده
          else if (text && !text.startsWith('/start')) {
            const userIds = res.keys
              .map(k => Number(k.name.split(':')[1]))
              .filter(uid => uid && uid !== getAdminId(env));

            const BATCH_SIZE = 5;
            for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
              const batch = userIds.slice(i, i + BATCH_SIZE);
              const results = await Promise.allSettled(batch.map(async (userId) => {
                try {
                  const resp = await telegramApi(env, '/sendMessage', { chat_id: userId, text, parse_mode: 'Markdown' }, 5000);
                  if (resp && resp.ok === true) {
                    return true;
                  } else {
                    const retryAfter = resp?.parameters?.retry_after;
                    if (retryAfter && Number(retryAfter) > 0) {
                      const waitMs = Math.min((Number(retryAfter) + 1) * 1000, MAX_RETRY_AFTER_MS);
                      await new Promise(r => setTimeout(r, waitMs));
                    }
                    return false;
                  }
                } catch (e) {
                  return false;
                }
              }));

              for (const r of results) {
                if (r.status === 'fulfilled' && r.value === true) {
                  sent++;
                } else {
                  failed++;
                }
              }

              consecutiveFailures = (results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value === false)).length > 0) ? (consecutiveFailures + 1) : 0;

              await updateProgress('پیام');

              if (consecutiveFailures >= 5) {
                await new Promise(r => setTimeout(r, 1000));
                consecutiveFailures = 0;
              } else {
                await new Promise(r => setTimeout(r, BASE_DELAY_MS));
              }
            }
            await env.DB.delete(`admin_state:${getAdminId(env)}`);

            if (progressMsgId) {
              await telegramApi(env, '/editMessageText', {
                chat_id: chat,
                message_id: progressMsgId,
                text: `✅ *ارسال پیام تکمیل شد!*\n\n📊 کل کاربران: ${totalUsers}\n✅ موفق: ${sent}\n❌ ناموفق: ${failed}`,
                parse_mode: 'Markdown'
              });
            }
            return;
          }
        }

        // پاسخ ادمین به بازخورد کاربر
        else if (state && state.startsWith('reply_feedback:')) {
          const targetUserId = state.split(':')[1];

          // ارسال پاسخ به کاربر
          try {
            if (msg.photo && msg.photo.length > 0) {
              const photo = msg.photo[msg.photo.length - 1];
              const caption = msg.caption || '';
              await telegramApi(env, '/sendPhoto', {
                chat_id: targetUserId,
                photo: photo.file_id,
                caption: `💬 *پاسخ از مدیر:*\n━━━━━━━━━━━━━━━━━━━━\n\n${caption}`,
                parse_mode: 'Markdown'
              });
            } else if (msg.video) {
              const caption = msg.caption || '';
              await telegramApi(env, '/sendVideo', {
                chat_id: targetUserId,
                video: msg.video.file_id,
                caption: `💬 *پاسخ از مدیر:*\n━━━━━━━━━━━━━━━━━━━━\n\n${caption}`,
                parse_mode: 'Markdown'
              });
            } else if (msg.document) {
              const caption = msg.caption || '';
              await telegramApi(env, '/sendDocument', {
                chat_id: targetUserId,
                document: msg.document.file_id,
                caption: `💬 *پاسخ از مدیر:*\n━━━━━━━━━━━━━━━━━━━━\n\n${caption}`,
                parse_mode: 'Markdown'
              });
            } else if (text) {
              await telegramApi(env, '/sendMessage', {
                chat_id: targetUserId,
                text: `💬 *پاسخ از مدیر:*\n━━━━━━━━━━━━━━━━━━━━\n\n${text}`,
                parse_mode: 'Markdown'
              });
            }

            await env.DB.delete(`admin_state:${getAdminId(env)}`);
            await telegramApi(env, '/sendMessage', {
              chat_id: chat,
              text: '✅ پاسخ شما با موفقیت به کاربر ارسال شد!'
            });
          } catch (e) {
            await telegramApi(env, '/sendMessage', {
              chat_id: chat,
              text: '❌ خطا در ارسال پاسخ به کاربر!'
            });
          }
          return;
        }
      }

      // دریافت بازخورد از کاربران عادی
      else {
        const userState = await env.DB.get(`user_state:${from.id}`);

        if (userState === 'feedback_waiting') {
          // ارسال بازخورد به ادمین
          try {
            let feedbackMsg = `💬 *بازخورد جدید از کاربر*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
            feedbackMsg += `👤 نام: ${from.first_name || 'کاربر'}\n`;
            if (from.username) feedbackMsg += `🆔 یوزرنیم: @${from.username}\n`;
            feedbackMsg += `🔢 شناسه: \`${from.id}\`\n`;
            feedbackMsg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

            if (msg.photo && msg.photo.length > 0) {
              const photo = msg.photo[msg.photo.length - 1];
              const caption = msg.caption || '';
              await telegramApi(env, '/sendPhoto', {
                chat_id: getAdminId(env),
                photo: photo.file_id,
                caption: feedbackMsg + (caption ? `📝 متن:\n${caption}` : '🖼️ عکس بدون متن'),
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[{ text: '💬 پاسخ', callback_data: `reply_feedback:${from.id}` }]]
                }
              });
            } else if (msg.video) {
              const caption = msg.caption || '';
              await telegramApi(env, '/sendVideo', {
                chat_id: getAdminId(env),
                video: msg.video.file_id,
                caption: feedbackMsg + (caption ? `📝 متن:\n${caption}` : '🎬 ویدیو بدون متن'),
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[{ text: '💬 پاسخ', callback_data: `reply_feedback:${from.id}` }]]
                }
              });
            } else if (msg.document) {
              const caption = msg.caption || '';
              await telegramApi(env, '/sendDocument', {
                chat_id: getAdminId(env),
                document: msg.document.file_id,
                caption: feedbackMsg + (caption ? `📝 متن:\n${caption}` : '📎 فایل بدون متن'),
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[{ text: '💬 پاسخ', callback_data: `reply_feedback:${from.id}` }]]
                }
              });
            } else if (text) {
              feedbackMsg += `📝 متن:\n${text}`;
              await telegramApi(env, '/sendMessage', {
                chat_id: getAdminId(env),
                text: feedbackMsg,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[{ text: '💬 پاسخ', callback_data: `reply_feedback:${from.id}` }]]
                }
              });
            }

            await env.DB.delete(`user_state:${from.id}`);
            await telegramApi(env, '/sendMessage', {
              chat_id: chat,
              text: '✅ بازخورد شما با موفقیت ارسال شد!\n\n💡 مدیر به زودی به شما پاسخ خواهد داد.'
            });
          } catch (e) {
            await telegramApi(env, '/sendMessage', {
              chat_id: chat,
              text: '❌ خطا در ارسال بازخورد! لطفاً دوباره تلاش کنید.'
            });
          }
          return;
        }
      }

      if (text.startsWith('/start')) {
        const kb = buildMainKeyboard(from.id, getAdminId(env));
        await telegramApi(env, '/sendMessage', {
          chat_id: chat,
          text: '🌍 *به ربات دسترسی جهانی خوش آمدید*\n\n🛡️ دریافت سرورهای DNS و WireGuard از لوکیشن‌های مختلف جهان\n\n🔻 لطفاً سرویس موردنظر خود را انتخاب کنید:',
          parse_mode: 'Markdown',
          reply_markup: kb
        });
      } else {
        await telegramApi(env, '/sendMessage', {
          chat_id: chat,
          text: '❌ دستور نامعتبر است.\n\nلطفاً /start را ارسال کنید.'
        });
      }
    }

    // Callback Query
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data || '';
      const chat = cb.message.chat.id;
      // جلوگیری از پاسخ در گروه‌ها برای کال‌بک‌ها
      try {
        const chatType = cb.message && cb.message.chat && cb.message.chat.type;
        if (chatType && chatType !== 'private') {
          return; // هیچ پاسخی به کال‌بک در گروه‌ها نده
        }
      } catch {}
      const messageId = cb.message.message_id;
      const from = cb.from || {};

      await saveUser(env.DB, from);

      await telegramApi(env, '/answerCallbackQuery', {
        callback_query_id: cb.id
      });

      // نمایش منوی اصلی
      if (data === 'back_main') {
        const kb = buildMainKeyboard(from.id, getAdminId(env));
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: '🌍 *به ربات دسترسی جهانی خوش آمدید*\n\n🛡️ دریافت سرورهای DNS و WireGuard از لوکیشن‌های مختلف جهان\n\n🔻 لطفاً سرویس موردنظر خود را انتخاب کنید:',
          parse_mode: 'Markdown',
          reply_markup: kb
        });
      }

      // نمایش منوی انتخاب نوع DNS (IPv4 یا IPv6)
      else if (data === 'show_dns_menu') {
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: '🧭 *انتخاب نوع DNS*\n━━━━━━━━━━━━━━━━━━━━\n\n💡 لطفاً نسل DNS موردنظر خود را انتخاب کنید:',
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🌐 IPv6', callback_data: 'show_ipv6' },
                { text: '🌐 IPv4', callback_data: 'show_dns' }
              ],
              [{ text: '🔙 بازگشت به منو اصلی', callback_data: 'back_main' }]
            ]
          }
        });
      }

      // نمایش لیست DNS IPv4
      else if (data === 'show_dns' || data.startsWith('dns_page:') || data.startsWith('dns_sort:')) {
        const entries = await getCachedDnsList(env.DB);
        if (entries.length === 0) {
          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: '❌ *هیچ IPv4 موجود نیست*\n\nلطفاً ابتدا از پنل مدیریت، آدرس‌های IPv4 موردنظر را اضافه کنید.',
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'show_dns_menu' }]] }
          });
        } else {
          // تعیین شماره صفحه و ترتیب
          let page = 0;
          let sortOrder = 'default';

          if (data.startsWith('dns_page:')) {
            const parts = data.split(':');
            page = parseInt(parts[1]) || 0;
            sortOrder = parts[2] || 'default';
          } else if (data.startsWith('dns_sort:')) {
            const parts = data.split(':');
            sortOrder = parts[1] || 'default';
            page = parseInt(parts[2]) || 0;
          }

          const kb = buildDnsKeyboard(entries, page, sortOrder);
          const totalStock = entries.reduce((sum, e) => sum + (e.stock || 0), 0);
          const totalPages = Math.ceil(entries.length / 12);
          const currentPage = page + 1;

          const sortText = sortOrder === 'low_to_high' ? '📈 (کم به زیاد)' : sortOrder === 'high_to_low' ? '📉 (زیاد به کم)' : '🔀 (پیش‌فرض)';

          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: `🌍 *لیست کشورهای موجود (IPv4)*\n━━━━━━━━━━━━━━━━━━━━\n\n📊 تعداد کشورها: *${entries.length}*\n📦 موجودی کل: *${totalStock}*\n📄 صفحه: *${currentPage}/${totalPages}*\n🔀 ترتیب: *${sortText}*\n\n💡 کشور موردنظر را انتخاب کنید:\n\n🟢 موجودی زیاد (10+)\n🟡 موجودی متوسط (1-10)\n🔴 ناموجود`,
            parse_mode: 'Markdown',
            reply_markup: kb
          });
        }
      }

      // نمایش لیست IPv6
      else if (data === 'show_ipv6' || data.startsWith('page_ipv6:')) {
        const entries = await listIpv6Entries(env.DB);
        if (entries.length === 0) {
          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: '❌ *هیچ IPv6 موجود نیست*\n\nلطفاً ابتدا از پنل مدیریت، آدرس‌های IPv6 موردنظر را اضافه کنید.',
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'show_dns_menu' }]] }
          });
        } else {
          // تعیین شماره صفحه
          const page = data.startsWith('page_ipv6:') ? parseInt(data.split(':')[1]) || 0 : 0;
          const kb = buildIpv6Keyboard(entries, page);
          const totalStock = entries.reduce((sum, e) => sum + (e.stock || 0), 0);
          const totalPages = Math.ceil(entries.length / 12);
          const currentPage = page + 1;

          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: `🌍 *لیست کشورهای موجود (IPv6)*\n━━━━━━━━━━━━━━━━━━━━\n\n📊 تعداد کشورها: *${entries.length}*\n📦 موجودی کل: *${totalStock}*\n📄 صفحه: *${currentPage}/${totalPages}*\n\n💡 کشور موردنظر را انتخاب کنید:\n\n🟢 موجودی زیاد (10+)\n🟡 موجودی متوسط (1-10)\n🔴 ناموجود`,
            parse_mode: 'Markdown',
            reply_markup: kb
          });
        }
      }

      // انتخاب یک کشور و دریافت DNS IPv4 رندوم
      else if (data.startsWith('dns:')) {
        const code = data.split(':')[1];
        await handleDnsSelection(chat, messageId, code, env, from.id);
      }

      // انتخاب یک کشور و دریافت IPv6 رندوم
      else if (data.startsWith('ipv6:')) {
        const code = data.split(':')[1];
        await handleIpv6Selection(chat, messageId, code, env, from.id);
      }

      // کلیک روی موجودی DNS IPv4 (راهنمایی کاربر)
      else if (data.startsWith('stock:')) {
        await telegramApi(env, '/answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'برای دریافت آدرس، روی دکمه اسم کشور کلیک کنید',
          show_alert: true
        });
      }

      // کلیک روی موجودی IPv6 (راهنمایی کاربر)
      else if (data.startsWith('stock_ipv6:')) {
        await telegramApi(env, '/answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'برای دریافت آدرس، روی دکمه اسم کشور کلیک کنید',
          show_alert: true
        });
      }

      // کلیک روی موجودی WireGuard (راهنمایی کاربر)
      else if (data.startsWith('wg_stock:')) {
        await telegramApi(env, '/answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'برای انتخاب کشور، روی دکمه اسم کشور کلیک کنید',
          show_alert: true
        });
      }

      // کلیک روی شماره صفحه فعلی
      else if (data === 'current_page' || data === 'dns_current_page' || data === 'wg_current_page' || data === 'current_page_ipv6') {
        await telegramApi(env, '/answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'این صفحه فعلی است',
          show_alert: false
        });
      }

      // وایرگارد: شروع => انتخاب کشور
      else if (data === 'wireguard' || data.startsWith('wg_page:') || data.startsWith('wg_sort:')) {
        await clearWgState(env.DB, from.id);
        const entries = await getCachedDnsList(env.DB);

        // تعیین شماره صفحه و ترتیب
        let page = 0;
        let sortOrder = 'default';

        if (data.startsWith('wg_page:')) {
          const parts = data.split(':');
          page = parseInt(parts[1]) || 0;
          sortOrder = parts[2] || 'default';
        } else if (data.startsWith('wg_sort:')) {
          const parts = data.split(':');
          sortOrder = parts[1] || 'default';
          page = parseInt(parts[2]) || 0;
        }

        const kb = buildWireguardCountryKb(entries, page, sortOrder);
        const totalStock = entries.reduce((sum, e) => sum + (e.stock || 0), 0);
        const totalPages = Math.ceil(entries.length / 12);
        const currentPage = page + 1;

        const sortText = sortOrder === 'low_to_high' ? '📈 (کم به زیاد)' : sortOrder === 'high_to_low' ? '📉 (زیاد به کم)' : '🔀 (پیش‌فرض)';

        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: `🛰️ *وایرگارد*\n━━━━━━━━━━━━━━━━━━━━\n\n📊 تعداد کشورها: *${entries.length}*\n📦 موجودی کل: *${totalStock}*\n📄 صفحه: *${currentPage}/${totalPages}*\n🔀 ترتیب: *${sortText}*\n\n💡 کشور موردنظر را انتخاب کنید:\n\n🟢 موجودی زیاد (10+)\n🟡 موجودی متوسط (1-10)\n🔴 ناموجود`,
          parse_mode: 'Markdown',
          reply_markup: kb
        });
      }

      // وایرگارد: انتخاب اپراتور => ساخت فایل (باید DNS و کشور از قبل انتخاب شده باشد)
      else if (data.startsWith('wg_op:')) {
        const opCode = data.split(':')[1];
        if (!OPERATORS[opCode]) {
          await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id, text: 'اپراتور نامعتبر', show_alert: true });
        } else {
          const state = await getWgState(env.DB, from.id);
          if (!state || !state.dns || !state.country) {
            await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id, text: 'ابتدا کشور و دی ان اس را انتخاب کنید', show_alert: true });
          } else {
            // کوئوتا وایرگارد
            const quota = await getUserQuota(env.DB, from.id, 'wg', getAdminId(env));
            if (quota.count >= quota.limit) {
              const timeLeft = getTimeUntilReset();
              await telegramApi(env, '/editMessageText', {
                chat_id: chat,
                message_id: messageId,
                text: `⏳ سهمیه امروز وایرگارد شما تمام شد\n\n📊 امروز مجاز: ${quota.limit} مورد\n⏰ زمان باقی‌مانده تا ریست: ${timeLeft}`,
                reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت به منو اصلی', callback_data: 'back_main' }]] }
              });
            } else {
              // پاسخ به callback
              await telegramApi(env, '/answerCallbackQuery', {
                callback_query_id: cb.id,
                text: 'در حال ساخت فایل...'
              });

              // ساخت و ارسال فایل
              const keys = await generateWireGuardKeys();
              const addresses = OPERATORS[opCode].addresses;
              const mtu = randItem(WG_MTUS);
              const listenPort = randInt(49000, 60000);
              const dnsList = Array.isArray(state.dns) ? state.dns : [state.dns];
              const conf = buildWgConf({ privateKey: keys.privateKey, addresses, dns: dnsList.join(', '), mtu, listenPort });
              const namingType = state.namingType || 'custom'; // پیش‌فرض: اسم اختصاصی
              const filename = `${generateWgFilename(namingType, state.country)}.conf`;

              const fd = new FormData();
              fd.append('chat_id', String(chat));
              const captionText = `📄 <b>نام:</b> ${filename}\n• <b>اپراتور:</b> ${OPERATORS[opCode].title}\n• <b>دی ان اس:</b> ${dnsList.join(' , ')}\n• <b>MTU:</b> ${mtu}\n• <b>پورت شنونده:</b> ${listenPort}\n\n💡 <i>نکته:</i> ListenPort بین 49000 تا 60000 باشد.`;
              fd.append('caption', captionText);
              fd.append('parse_mode', 'HTML');

              // استفاده از File برای اطمینان از وجود نام فایل در multipart
              const file = new File([conf], filename, { type: 'text/plain' });
              fd.append('document', file);

              const uploadRes = await telegramUpload(env, 'sendDocument', fd);
              if (!uploadRes || uploadRes.ok !== true) {
                const err = uploadRes && uploadRes.description ? uploadRes.description : 'ارسال فایل ناموفق بود';
                await telegramApi(env, '/editMessageText', {
                  chat_id: chat,
                  message_id: messageId,
                  text: `❌ ارسال فایل انجام نشد\n\n${err}`,
                  reply_markup: { inline_keyboard: [[{ text: '🔁 تلاش مجدد', callback_data: `wg_op:${opCode}` }], [{ text: '🔙 بازگشت', callback_data: 'wireguard' }]] }
                });
              } else {
                await incUserQuota(env.DB, from.id, 'wg');
                const newQuota = await getUserQuota(env.DB, from.id, 'wg', getAdminId(env));
                await addUserHistory(env.DB, from.id, 'wg', `${state.country}|${dnsList.join('+')}|${mtu}|${listenPort}`);

                // حذف DNS استفاده شده از لیست (اگر از کشور انتخاب شده بود)
                if (dnsList.length > 1) {
                  // DNS دوم (randomDns) را حذف می‌کنیم
                  const usedDns = dnsList[1];
                  await removeAddressFromEntry(env.DB, state.country, usedDns);
                }

                await clearWgState(env.DB, from.id);

                // پیام موفقیت
                await telegramApi(env, '/editMessageText', {
                  chat_id: chat,
                  message_id: messageId,
                  text: `✅ فایل وایرگارد با موفقیت ارسال شد!\n\n📊 سهمیه امروز شما: ${newQuota.count}/${newQuota.limit}`,
                  parse_mode: 'Markdown',
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: '🔄 دریافت فایل جدید', callback_data: 'wireguard' }],
                      [{ text: '🔙 بازگشت به منو اصلی', callback_data: 'back_main' }]
                    ]
                  }
                });
              }
            }
          }
        }
      }

      // وایرگارد: بازگشت از انتخاب DNS به لیست کشورها
      else if (data === 'wireguard_dns_back') {
        const entries = await getCachedDnsList(env.DB);
        const kb = buildWireguardCountryKb(entries, 0);
        const totalStock = entries.reduce((sum, e) => sum + (e.stock || 0), 0);
        const totalPages = Math.ceil(entries.length / 12);

        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: `🛰️ *وایرگارد*\n━━━━━━━━━━━━━━━━━━━━\n\n📊 تعداد کشورها: *${entries.length}*\n📦 موجودی کل: *${totalStock}*\n📄 صفحه: *1/${totalPages}*\n\n💡 کشور موردنظر را انتخاب کنید:\n\n🟢 موجودی زیاد (10+)\n🟡 موجودی متوسط (1-10)\n🔴 ناموجود`,
          parse_mode: 'Markdown',
          reply_markup: kb
        });
      }

      // وایرگارد: نمایش کشورها (میانبر)
      else if (data === 'wg_dns_country') {
        const entries = await getCachedDnsList(env.DB);
        const kb = buildWireguardCountryKb(entries, 0);
        const totalStock = entries.reduce((sum, e) => sum + (e.stock || 0), 0);
        const totalPages = Math.ceil(entries.length / 12);

        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: `🛰️ *وایرگارد*\n━━━━━━━━━━━━━━━━━━━━\n\n📊 تعداد کشورها: *${entries.length}*\n📦 موجودی کل: *${totalStock}*\n📄 صفحه: *1/${totalPages}*\n\n💡 کشور موردنظر را انتخاب کنید:\n\n🟢 موجودی زیاد (10+)\n🟡 موجودی متوسط (1-10)\n🔴 ناموجود`,
          parse_mode: 'Markdown',
          reply_markup: kb
        });
      }

      // وایرگارد: انتخاب کشور => ذخیره و نمایش دی ان اس‌های ثابت برای انتخاب
      else if (data.startsWith('wg_dns_country_pick:')) {
        // پاسخ سریع به callback
        await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id });

        const code = data.split(':')[1];
        const entry = await getDnsEntry(env.DB, code);
        const flag = countryCodeToFlag(code);
        // تبدیل نام کشور به فارسی
        const countryName = entry ? ensurePersianCountryName(entry.country, entry.code) : getCountryNameFromCode(code);

        await setWgState(env.DB, from.id, { country: code, step: 'dns' });
        const kb = buildWireguardDnsKb();
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: `کشور انتخابی: ${flag} ${countryName} (${code})\n\nیکی از دی ان اس‌های زیر را انتخاب کنید:`,
          reply_markup: kb
        });
      }

      // وایرگارد: انتخاب DNS ثابت => اضافه‌کردن یک DNS رندوم از کشور (در صورت وجود) و سپس انتخاب نوع نام‌گذاری
      else if (data.startsWith('wg_dns_fixed:')) {
        const fixedDns = data.split(':')[1];
        const state = await getWgState(env.DB, from.id);
        if (!state || !state.country) {
          await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id, text: 'ابتدا کشور را انتخاب کنید', show_alert: true });
        } else {
          const entry = await getDnsEntry(env.DB, state.country);
          let randomDns = null;
          if (entry) {
            randomDns = getRandomDns(entry);
          }
          const dnsList = randomDns && randomDns !== fixedDns ? [fixedDns, randomDns] : [fixedDns];
          await setWgState(env.DB, from.id, { country: state.country, dns: dnsList, step: 'naming' });
          const kb = buildWireguardNamingKb();
          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: `🏷️ *نوع نام‌گذاری فایل*\n━━━━━━━━━━━━━━━━━━━━\n\n📝 نحوه نام‌گذاری فایل کانفیگ را انتخاب کنید:\n\n🌍 *اسم لوکیشن:* نام کشور به عنوان نام فایل\n🎲 *اسم اختصاصی:* نام تصادفی منحصر به فرد`,
            parse_mode: 'Markdown',
            reply_markup: kb
          });
        }
      }

      // حساب کاربری
      else if (data === 'account') {
        const dnsQuota = await getUserQuota(env.DB, from.id, 'dns', getAdminId(env));
        const wgQuota = await getUserQuota(env.DB, from.id, 'wg', getAdminId(env));
        const dnsHistory = await getUserHistory(env.DB, from.id, 'dns');
        const wgHistory = await getUserHistory(env.DB, from.id, 'wg');

        let msg = '👤 *حساب کاربری*\n';
        msg += '━━━━━━━━━━━━━━━━━━━━\n\n';
        msg += `👋 نام: ${from.first_name || 'کاربر'}\n`;
        if (from.username) msg += `🆔 یوزرنیم: @${from.username}\n`;
        msg += `🔢 شناسه: \`${from.id}\`\n\n`;

        msg += '📊 *سهمیه روزانه:*\n';
        msg += `🧭 DNS: ${dnsQuota.count}/${dnsQuota.limit}\n`;
        msg += `🛰️ WireGuard: ${wgQuota.count}/${wgQuota.limit}\n\n`;

        if (dnsHistory.length > 0) {
          msg += '📜 *آخرین دریافت‌های DNS:*\n';
          dnsHistory.slice(0, 5).forEach((h, i) => {
            const parts = h.item.split(':');
            msg += `${i + 1}. ${parts[0]} - \`${parts[1]}\`\n`;
          });
          msg += '\n';
        }

        if (wgHistory.length > 0) {
          msg += '📜 *آخرین فایل‌های WireGuard:*\n';
          wgHistory.slice(0, 3).forEach((h, i) => {
            const parts = h.item.split('|');
            msg += `${i + 1}. ${parts[0]} - MTU: ${parts[2]}\n`;
          });
        }

        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: msg,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت به منو اصلی', callback_data: 'back_main' }]] }
        });
      }

      // ارسال بازخورد
      else if (data === 'send_feedback') {
        await env.DB.put(`user_state:${from.id}`, 'feedback_waiting');
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: '💬 *ارسال بازخورد*\n━━━━━━━━━━━━━━━━━━━━\n\n✍️ پیام خود را ارسال کنید:\n\n📝 *می‌توانید ارسال کنید:*\n• پیشنهادات\n• انتقادات\n• گزارش باگ\n• سوالات\n• هر بازخورد دیگری\n\n💡 *نکات:*\n• پیام شما مستقیماً به مدیر ارسال می‌شود\n• می‌توانید متن، عکس، ویدیو یا فایل ارسال کنید\n• مدیر می‌تواند به شما پاسخ دهد',
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'cancel_feedback' }]] }
        });
      }

      else if (data === 'cancel_feedback') {
        await env.DB.delete(`user_state:${from.id}`);
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: '❌ لغو شد',
          reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'back_main' }]] }
        });
      }

      // پاسخ به بازخورد کاربر (فقط ادمین)
      else if (data.startsWith('reply_feedback:')) {
        if (Number(from.id) !== Number(getAdminId(env))) {
          await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id, text: 'اجازه دسترسی ندارید', show_alert: true });
        } else {
          const targetUserId = data.split(':')[1];
          await env.DB.put(`admin_state:${getAdminId(env)}`, `reply_feedback:${targetUserId}`);
          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: `💬 *پاسخ به بازخورد کاربر*\n━━━━━━━━━━━━━━━━━━━━\n\n👤 شناسه کاربر: \`${targetUserId}\`\n\n✍️ پاسخ خود را ارسال کنید:\n\n💡 می‌توانید متن، عکس، ویدیو یا فایل ارسال کنید`,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'cancel_reply_feedback' }]] }
          });
        }
      }

      else if (data === 'cancel_reply_feedback') {
        if (Number(from.id) === Number(getAdminId(env))) {
          await env.DB.delete(`admin_state:${getAdminId(env)}`);
        }
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: '❌ لغو شد',
          reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'back_main' }]] }
        });
      }

      // پیام همگانی (فقط ادمین)
      else if (data === 'broadcast') {
        if (Number(from.id) !== Number(getAdminId(env))) {
          await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id, text: 'اجازه دسترسی ندارید', show_alert: true });
        } else {
          await env.DB.put(`admin_state:${getAdminId(env)}`, 'broadcast_waiting');
          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: '📢 *پیام همگانی*\n━━━━━━━━━━━━━━━━━━━━\n\n✍️ پیام خود را ارسال کنید:\n\n📝 *انواع پشتیبانی شده:*\n• متن ساده\n• 🖼️ عکس (با یا بدون کپشن)\n• 🎬 ویدیو (با یا بدون کپشن)\n• 📎 فایل (با یا بدون کپشن)\n\n💡 *نکات:*\n• از Markdown پشتیبانی می‌شود\n• ادمین پیام دریافت نمی‌کند\n• آمار ارسال موفق/ناموفق نمایش داده می‌شود',
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'cancel_broadcast' }]] }
          });
        }
      }

      else if (data === 'cancel_broadcast') {
        if (Number(from.id) === Number(getAdminId(env))) {
          await env.DB.delete(`admin_state:${getAdminId(env)}`);
        }
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: '❌ لغو شد',
          reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'back_main' }]] }
        });
      }

      // ریست محدودیت (فقط ادمین)
      else if (data === 'reset_quota') {
        if (Number(from.id) !== Number(getAdminId(env))) {
          await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id, text: 'اجازه دسترسی ندارید', show_alert: true });
        } else {
          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: '🎁 *ریست محدودیت کاربران*\n\nآیا مطمئن هستید که می‌خواهید محدودیت روزانه تمام کاربران را صفر کنید؟\n\n⚠️ این عمل قابل بازگشت نیست و به همه کاربران اطلاع داده می‌شود.',
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '✅ بله، ریست کن', callback_data: 'confirm_reset_quota' }],
                [{ text: '❌ لغو', callback_data: 'back_main' }]
              ]
            }
          });
        }
      }

      // نمایش آمار (فقط ادمین)
      else if (data === 'stats') {
        if (Number(from.id) !== Number(getAdminId(env))) {
          await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id, text: 'اجازه دسترسی ندارید', show_alert: true });
        } else {
          const stats = await getUserStats(env.DB);

          let msg = '📊 *آمار ربات*\n';
          msg += '━━━━━━━━━━━━━━━━━━━━\n\n';
          msg += `👥 *تعداد کل کاربران:* ${stats.totalUsers}\n`;

          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: msg,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'back_main' }]] }
          });
        }
      }

      // تایید ریست محدودیت
      else if (data === 'confirm_reset_quota') {
        if (Number(from.id) !== Number(getAdminId(env))) {
          await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id, text: 'اجازه دسترسی ندارید', show_alert: true });
        } else {
          // حذف تمام کلیدهای quota
          const today = todayKey();
          const dnsKeys = await env.DB.list({ prefix: `quota:dns:` });
          const wgKeys = await env.DB.list({ prefix: `quota:wg:` });

          let deleted = 0;
          for (const k of dnsKeys.keys) {
            if (k.name.includes(today)) {
              await env.DB.delete(k.name);
              deleted++;
            }
          }
          for (const k of wgKeys.keys) {
            if (k.name.includes(today)) {
              await env.DB.delete(k.name);
              deleted++;
            }
          }

          // ارسال پیام به همه کاربران
          const users = await env.DB.list({ prefix: 'users:' });
          let notified = 0;
          const giftMsg = '🎁 *خبر خوش!*\n\nمحدودیت روزانه شما توسط مدیریت ربات ریست شد!\n\n✨ می‌توانید مجدداً از خدمات استفاده کنید.\n\n💝 از صبر و همراهی شما سپاسگزاریم.';

          for (const k of users.keys) {
            try {
              const userId = k.name.replace('users:', '');
              if (Number(userId) !== Number(getAdminId(env))) {
                await telegramApi(env, '/sendMessage', {
                  chat_id: userId,
                  text: giftMsg,
                  parse_mode: 'Markdown'
                });
                notified++;
                await new Promise(r => setTimeout(r, 50)); // جلوگیری از rate limit
              }
            } catch (e) {
              console.error('خطا در ارسال به کاربر:', e);
            }
          }

          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: `✅ *ریست محدودیت انجام شد*\n\n🗑️ ${deleted} محدودیت حذف شد\n📨 ${notified} کاربر مطلع شدند`,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'back_main' }]] }
          });
        }
      }
    }
  } catch (e) {
    console.error('خطا در handleUpdate:', e);
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// 🌐 CLOUDFLARE WORKER FETCH HANDLER
// ═════════════════════════════════════════════════════════════════════════════

export default {
  async fetch(req, env) {
    try {
      // بررسی وجود env variables ضروری
      if (!env || !env.DB) {
        return new Response(
          JSON.stringify({
            error: 'تنظیمات محیطی ناقص است',
            message: 'KV namespace (DB) تنظیم نشده است. لطفاً در تنظیمات Cloudflare Pages، KV binding با نام DB را اضافه کنید.',
            help: 'Settings > Functions > KV namespace bindings > Add binding (Variable name: DB)'
          }, null, 2),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          }
        );
      }

      const url = new URL(req.url);

      // ─────────────────────────────────────────────────────────────────────────────
      // 🏠 Web Pages Routes
      // ─────────────────────────────────────────────────────────────────────────────

      // صفحه اصلی
      if (url.pathname === '/' && req.method === 'GET') {
        const entries = await listDnsEntries(env.DB);
        const userCount = await countUsers(env.DB);
        return html(renderMainPage(entries, userCount));
      }

      // مسیر جایگزین پنل ادمین
      if (url.pathname === '/admini' && req.method === 'GET') {
        const entries = await listDnsEntries(env.DB);
        const userCount = await countUsers(env.DB);
        return html(renderMainPage(entries, userCount));
      }

      // صفحه تست برای بررسی تنظیمات
      if (url.pathname === '/health' && req.method === 'GET') {
        const checks = {
          timestamp: new Date().toISOString(),
          env_db: !!env.DB,
          env_bot_token: !!env.BOT_TOKEN,
          status: 'OK'
        };

        // تست اتصال به KV
        try {
          await env.DB.put('health_check', Date.now().toString(), { expirationTtl: 60 });
          const testValue = await env.DB.get('health_check');
          checks.kv_connection = !!testValue;
        } catch (e) {
          checks.kv_connection = false;
          checks.kv_error = e.message;
        }

        // تست اتصال به Telegram API
        if (env.BOT_TOKEN) {
          try {
            const res = await fetch(`${TELEGRAM_BASE(env.BOT_TOKEN)}/getMe`);
            const data = await res.json();
            checks.telegram_api = data.ok;
            if (data.ok) {
              checks.bot_info = {
                username: data.result.username,
                first_name: data.result.first_name,
                id: data.result.id
              };
            }
          } catch (e) {
            checks.telegram_api = false;
            checks.telegram_error = e.message;
          }
        }

        const allOk = checks.env_db && checks.env_bot_token && checks.kv_connection && checks.telegram_api;

        return html(`<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Health Check</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: ${allOk ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)'};
      min-height: 100vh;
      padding: 40px 20px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      border-radius: 20px;
      padding: 40px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    h1 {
      color: ${allOk ? '#27ae60' : '#e74c3c'};
      margin-bottom: 10px;
      font-size: 32px;
      text-align: center;
    }
    .status-icon {
      text-align: center;
      font-size: 60px;
      margin-bottom: 20px;
    }
    .check-item {
      background: #f8f9fa;
      border-radius: 10px;
      padding: 15px 20px;
      margin: 10px 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .check-label {
      font-weight: bold;
      color: #2c3e50;
    }
    .check-value {
      font-family: 'Courier New', monospace;
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 14px;
    }
    .check-value.ok {
      background: #d4edda;
      color: #155724;
    }
    .check-value.error {
      background: #f8d7da;
      color: #721c24;
    }
    .bot-info {
      background: #e3f2fd;
      border-radius: 10px;
      padding: 15px;
      margin: 20px 0;
      border-right: 4px solid #2196f3;
    }
    .bot-info h3 {
      color: #1976d2;
      margin-bottom: 10px;
    }
    .bot-info p {
      margin: 5px 0;
      color: #424242;
    }
    .timestamp {
      text-align: center;
      color: #7f8c8d;
      font-size: 14px;
      margin-top: 20px;
    }
    .btn {
      display: inline-block;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 12px 30px;
      border-radius: 25px;
      text-decoration: none;
      font-weight: bold;
      transition: transform 0.2s;
      margin: 20px 10px 0 10px;
    }
    .btn:hover {
      transform: translateY(-2px);
    }
    .btn-group {
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="status-icon">${allOk ? '✅' : '⚠️'}</div>
    <h1>${allOk ? 'همه چیز آماده است!' : 'مشکلاتی وجود دارد'}</h1>

    <div class="check-item">
      <span class="check-label">🗄️ KV Database (DB)</span>
      <span class="check-value ${checks.env_db ? 'ok' : 'error'}">${checks.env_db ? 'متصل' : 'تنظیم نشده'}</span>
    </div>

    <div class="check-item">
      <span class="check-label">🔑 Bot Token</span>
      <span class="check-value ${checks.env_bot_token ? 'ok' : 'error'}">${checks.env_bot_token ? 'تنظیم شده' : 'تنظیم نشده'}</span>
    </div>

    <div class="check-item">
      <span class="check-label">💾 اتصال KV</span>
      <span class="check-value ${checks.kv_connection ? 'ok' : 'error'}">${checks.kv_connection ? 'موفق' : 'ناموفق'}</span>
    </div>

    <div class="check-item">
      <span class="check-label">🤖 Telegram API</span>
      <span class="check-value ${checks.telegram_api ? 'ok' : 'error'}">${checks.telegram_api ? 'موفق' : 'ناموفق'}</span>
    </div>

    ${checks.bot_info ? `
    <div class="bot-info">
      <h3>🤖 اطلاعات ربات</h3>
      <p><strong>نام کاربری:</strong> @${checks.bot_info.username}</p>
      <p><strong>نام:</strong> ${checks.bot_info.first_name}</p>
      <p><strong>شناسه:</strong> ${checks.bot_info.id}</p>
    </div>
    ` : ''}

    ${checks.kv_error ? `<p style="color: #e74c3c; margin-top: 15px;">❌ خطای KV: ${checks.kv_error}</p>` : ''}
    ${checks.telegram_error ? `<p style="color: #e74c3c; margin-top: 15px;">❌ خطای Telegram: ${checks.telegram_error}</p>` : ''}

    <div class="btn-group">
      <a href="/" class="btn">🏠 صفحه اصلی</a>
      <a href="/health" class="btn">🔄 بررسی مجدد</a>
    </div>

    <div class="timestamp">
      زمان بررسی: ${new Date().toLocaleString('fa-IR')}
    </div>
  </div>
</body>
</html>`);
      }


      // ─────────────────────────────────────────────────────────────────────────────
      // 🔌 API Endpoints
      // ─────────────────────────────────────────────────────────────────────────────

      // API: لیست DNS‌ها
      if (url.pathname === '/api/dns' && req.method === 'GET') {
        const entries = await listDnsEntries(env.DB);
        return json(entries);
      }

      // API: افزودن/ویرایش DNS
      if (url.pathname === '/api/admin/add-dns' && req.method === 'POST') {
        const form = await req.formData();
        const action = form.get('action') || 'new';

        if (action === 'new') {
          // ایجاد کشور جدید
          const addresses = (form.get('addresses') || '')
            .split(/\r?\n/)
            .map(s => s.trim())
            .filter(Boolean);

          const code = (form.get('code') || '').toUpperCase().trim();
          let countryName = (form.get('country') || '').trim();

          // اگر نام خالی است، از نام فارسی پیش‌فرض استفاده کن
          if (!countryName && code) {
            countryName = getCountryNameFromCode(code);
          }

          const entry = {
            country: countryName,
            code: code,
            addresses: addresses,
            stock: addresses.length  // موجودی خودکار بر اساس تعداد آدرس‌ها
          };

          if (!entry.country || !entry.code || entry.code.length !== 2) {
            return html(`<script>
            Toast.error('❌ اطلاعات نامعتبر است');
            setTimeout(() => history.back(), 2000);
          </script>`);
          }

          // بررسی عدم تکرار کد کشور
          const existing = await getDnsEntry(env.DB, entry.code);
          if (existing) {
            return html(`<script>
            Toast.warning('⚠️ این کد کشور قبلاً ثبت شده است');
            setTimeout(() => history.back(), 2000);
          </script>`);
          }

          await putDnsEntry(env.DB, entry);
          invalidateDnsCache();

          // نمایش صفحه موفقیت با جزئیات
          return html(`<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>✅ کشور جدید اضافه شد</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .success-card {
      background: white;
      border-radius: 24px;
      padding: 40px;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      animation: slideUp 0.5s ease;
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .success-icon {
      width: 80px;
      height: 80px;
      background: linear-gradient(135deg, #10b981, #059669);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      animation: scaleIn 0.5s ease 0.2s both;
    }
    @keyframes scaleIn {
      from { transform: scale(0); }
      to { transform: scale(1); }
    }
    .success-icon::after {
      content: '✓';
      color: white;
      font-size: 48px;
      font-weight: bold;
    }
    h1 {
      color: #1f2937;
      text-align: center;
      margin-bottom: 10px;
      font-size: 28px;
    }
    .subtitle {
      color: #6b7280;
      text-align: center;
      margin-bottom: 30px;
      font-size: 16px;
    }
    .info-box {
      background: linear-gradient(135deg, #f3f4f6, #e5e7eb);
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid rgba(0, 0, 0, 0.05);
    }
    .info-row:last-child { border-bottom: none; }
    .info-label {
      color: #6b7280;
      font-size: 14px;
      font-weight: 500;
    }
    .info-value {
      color: #1f2937;
      font-size: 16px;
      font-weight: 600;
    }
    .country-code {
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white;
      padding: 4px 12px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 18px;
    }
    .btn-home {
      width: 100%;
      padding: 16px;
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .btn-home:hover {
      transform: translateY(-2px);
    }
    .countdown {
      text-align: center;
      color: #9ca3af;
      font-size: 13px;
      margin-top: 15px;
    }
  </style>
</head>
<body>
  <div class="success-card">
    <div class="success-icon"></div>
    <h1>🎉 کشور جدید اضافه شد!</h1>
    <p class="subtitle">کشور با موفقیت به سیستم اضافه شد</p>

    <div class="info-box">
      <div class="info-row">
        <span class="info-label">🌍 نام کشور</span>
        <span class="info-value">${entry.country}</span>
      </div>
      <div class="info-row">
        <span class="info-label">🏳️ کد کشور</span>
        <span class="country-code">${entry.code}</span>
      </div>
      <div class="info-row">
        <span class="info-label">📡 تعداد آدرس‌ها</span>
        <span class="info-value">${entry.addresses.length} آدرس</span>
      </div>
      <div class="info-row">
        <span class="info-label">📊 موجودی</span>
        <span class="info-value">${entry.stock} IP</span>
      </div>
    </div>

    <button class="btn-home" onclick="window.location.href='/'">
      🏠 بازگشت به صفحه اصلی
    </button>
    <p class="countdown">بازگشت خودکار در <span id="timer">3</span> ثانیه...</p>
  </div>

  <script>
    let seconds = 3;
    const timer = setInterval(() => {
      seconds--;
      document.getElementById('timer').textContent = seconds;
      if (seconds <= 0) {
        clearInterval(timer);
        window.location.href = '/';
      }
    }, 1000);
  </script>
</body>
</html>`);
        }
        else if (action === 'edit') {
          // ویرایش کشور موجود - اضافه کردن آدرس‌های جدید
          const code = (form.get('existing_code') || '').toUpperCase().trim();
          const newAddresses = (form.get('addresses') || '')
            .split(/\r?\n/)
            .map(s => s.trim())
            .filter(Boolean);
          const newCountryName = form.get('country') ? form.get('country').trim() : null;

          if (!code || code.length !== 2) {
            return html(`<script>
            Toast.error('❌ کد کشور نامعتبر است');
            setTimeout(() => history.back(), 2000);
          </script>`);
          }

          // دریافت اطلاعات فعلی
          const existing = await getDnsEntry(env.DB, code);
          if (!existing) {
            return html(`<script>
            Toast.error('❌ کشور انتخابی یافت نشد');
            setTimeout(() => history.back(), 2000);
          </script>`);
          }

          // بروزرسانی نام کشور (در صورت وجود)
          if (newCountryName) {
            existing.country = newCountryName;
          }

          // اضافه کردن آدرس‌های جدید به آدرس‌های موجود
          if (newAddresses.length > 0) {
            const currentAddresses = Array.isArray(existing.addresses) ? existing.addresses : [];
            const combinedAddresses = [...currentAddresses, ...newAddresses];
            // حذف آدرس‌های تکراری
            existing.addresses = [...new Set(combinedAddresses)];
            // بروزرسانی خودکار موجودی بر اساس تعداد کل آدرس‌ها
            existing.stock = existing.addresses.length;
          }

          await putDnsEntry(env.DB, existing);
          invalidateDnsCache(); // بروزرسانی cache

          // نمایش صفحه موفقیت برای ویرایش
          const addedCount = newAddresses.length;
          const totalCount = existing.addresses.length;
          return html(`<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>✅ کشور بروزرسانی شد</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .success-card {
      background: white;
      border-radius: 24px;
      padding: 40px;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      animation: slideUp 0.5s ease;
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .success-icon {
      width: 80px;
      height: 80px;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      animation: scaleIn 0.5s ease 0.2s both;
    }
    @keyframes scaleIn {
      from { transform: scale(0); }
      to { transform: scale(1); }
    }
    .success-icon::after {
      content: '✓';
      color: white;
      font-size: 48px;
      font-weight: bold;
    }
    h1 {
      color: #1f2937;
      text-align: center;
      margin-bottom: 10px;
      font-size: 28px;
    }
    .subtitle {
      color: #6b7280;
      text-align: center;
      margin-bottom: 30px;
      font-size: 16px;
    }
    .info-box {
      background: linear-gradient(135deg, #f3f4f6, #e5e7eb);
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid rgba(0, 0, 0, 0.05);
    }
    .info-row:last-child { border-bottom: none; }
    .info-label {
      color: #6b7280;
      font-size: 14px;
      font-weight: 500;
    }
    .info-value {
      color: #1f2937;
      font-size: 16px;
      font-weight: 600;
    }
    .highlight {
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      color: white;
      padding: 4px 12px;
      border-radius: 8px;
    }
    .btn-home {
      width: 100%;
      padding: 16px;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .btn-home:hover {
      transform: translateY(-2px);
    }
    .countdown {
      text-align: center;
      color: #9ca3af;
      font-size: 13px;
      margin-top: 15px;
    }
  </style>
</head>
<body>
  <div class="success-card">
    <div class="success-icon"></div>
    <h1>✅کشور بروزرسانی شد!</h1>
    <p class="subtitle">اطلاعات کشور با موفقیت بروزرسانی شد</p>

    <div class="info-box">
      <div class="info-row">
        <span class="info-label">🌍 نام کشور</span>
        <span class="info-value">${existing.country}</span>
      </div>
      <div class="info-row">
        <span class="info-label">🏳️ کد کشور</span>
        <span class="info-value">${existing.code}</span>
      </div>
      <div class="info-row">
        <span class="info-label">➕ آدرس‌های جدید</span>
        <span class="highlight">${addedCount} آدرس</span>
      </div>
      <div class="info-row">
        <span class="info-label">📊 مجموع آدرس‌ها</span>
        <span class="info-value">${totalCount} آدرس</span>
      </div>
    </div>

    <button class="btn-home" onclick="window.location.href='/'">
      🏠 بازگشت به صفحه اصلی
    </button>
    <p class="countdown">بازگشت خودکار در <span id="timer">3</span> ثانیه...</p>
  </div>

  <script>
    let seconds = 3;
    const timer = setInterval(() => {
      seconds--;
      document.getElementById('timer').textContent = seconds;
      if (seconds <= 0) {
        clearInterval(timer);
        window.location.href = '/';
      }
    }, 1000);
  </script>
</body>
</html>`);
        }

        return html('<script>window.location.href="/";</script>');
      }

      // API: ویرایش کامل DNS (نام و کد کشور)
      if (url.pathname === '/api/admin/edit-dns' && req.method === 'POST') {
        try {
          const form = await req.formData();
          const oldCode = (form.get('old_code') || '').toUpperCase().trim();
          const newCode = (form.get('new_code') || '').toUpperCase().trim();
          const newName = (form.get('country') || '').trim();

          if (!oldCode || !newCode || !newName || oldCode.length !== 2 || newCode.length !== 2) {
            return html('<script>alert("❌ اطلاعات نامعتبر است"); history.back();</script>');
          }

          // دریافت اطلاعات فعلی
          const existing = await getDnsEntry(env.DB, oldCode);
          if (!existing) {
            return html('<script>alert("❌ کشور یافت نشد"); history.back();</script>');
          }

          // اگر کد تغییر کرده، بررسی تکراری بودن کد جدید
          if (oldCode !== newCode) {
            const duplicate = await getDnsEntry(env.DB, newCode);
            if (duplicate) {
              return html('<script>alert("⚠️ کد کشور جدید قبلاً استفاده شده است"); history.back();</script>');
            }

            // حذف کشور قدیم و ایجاد با کد جدید
            await deleteDnsEntry(env.DB, oldCode);
            existing.code = newCode;
          }

          // بروزرسانی نام
          existing.country = newName;
          await putDnsEntry(env.DB, existing);
          invalidateDnsCache();

          return html(`<!doctype html>
<html lang="fa" dir="rtl">
<meta charset="utf-8">
<meta http-equiv="refresh" content="2;url=/">
<title>موفقیت</title>
<body style="font-family: sans-serif; padding:20px;">
  <h2>✅ کشور با موفقیت ویرایش شد</h2>
  <p>نام: ${newName}</p>
  <p>کد: ${newCode}</p>
  <p><a href="/">بازگشت به صفحه اصلی</a></p>
  <script>setTimeout(()=>location.href='/',2000)</script>
</body>
</html>`);
        } catch (e) {
          console.error('خطا در ویرایش DNS:', e);
          return html(`<script>alert("❌ خطا: ${e.message}"); history.back();</script>`);
        }
      }

      // API: حذف DNS
      if (url.pathname === '/api/admin/delete-dns' && req.method === 'POST') {
        const form = await req.formData();
        const code = form.get('code');

        if (code) {
          const entry = await getDnsEntry(env.DB, code);
          await deleteDnsEntry(env.DB, code);
          invalidateDnsCache(); // بروزرسانی cache

          return html(`<!doctype html>
<html lang="fa" dir="rtl">
<meta charset="utf-8">
<meta http-equiv="refresh" content="1.5;url=/">
<title>حذف کشور</title>
<body style="font-family: sans-serif; padding:20px;">
  <p>🗑️ کشور ${entry ? entry.country : code} با موفقیت حذف شد. انتقال به صفحه اصلی...</p>
  <p><a href="/">بازگشت به صفحه اصلی</a></p>
  <script>setTimeout(()=>location.href='/',1500)</script>
</body>
</html>`);
        }

        return html(`<!doctype html>
<html lang="fa" dir="rtl">
<meta charset="utf-8">
<meta http-equiv="refresh" content="2;url=/">
<title>خطا</title>
<body style="font-family: sans-serif; padding:20px;">
  <p>❌ خطا در حذف کشور. انتقال به صفحه اصلی...</p>
  <p><a href="/">بازگشت به صفحه اصلی</a></p>
  <script>setTimeout(()=>location.href='/',2000)</script>
</body>
</html>`);
      }

      // API: حذف آدرس خاص از کشور
      if (url.pathname === '/api/admin/delete-address' && req.method === 'POST') {
        try {
          const body = await req.json();
          const code = (body.code || '').toUpperCase().trim();
          const address = (body.address || '').trim();

          if (!code || !address) {
            return json({ success: false, error: 'کد کشور یا آدرس نامعتبر است' });
          }

          const success = await removeAddressFromEntry(env.DB, code, address);

          if (success) {
            invalidateDnsCache();
            return json({ success: true, message: 'آدرس با موفقیت حذف شد' });
          } else {
            return json({ success: false, error: 'کشور یا آدرس یافت نشد' });
          }
        } catch (e) {
          console.error('خطا در حذف آدرس:', e);
          return json({ success: false, error: e.message || 'خطای نامشخص' });
        }
      }

      // API: حذف گروهی کشورها
      if (url.pathname === '/api/admin/bulk-delete-countries' && req.method === 'POST') {
        try {
          const body = await req.json();
          const codes = body.codes || [];

          if (!Array.isArray(codes) || codes.length === 0) {
            return json({ success: false, error: 'لیست کشورها خالی است' });
          }

          let deleted = 0;
          for (const code of codes) {
            try {
              await deleteDnsEntry(env.DB, code.toUpperCase());
              deleted++;
            } catch (e) {
              console.error(`خطا در حذف کشور ${code}:`, e);
            }
          }

          invalidateDnsCache();
          return json({
            success: true,
            deleted: deleted,
            message: `${deleted} کشور با موفقیت حذف شد`
          });
        } catch (e) {
          console.error('خطا در حذف گروهی:', e);
          return json({ success: false, error: e.message || 'خطای نامشخص' });
        }
      }

      // API: افزودن تک IP (برای نمایش پیشرفت زنده)
      if (url.pathname === '/api/admin/bulk-add-single' && req.method === 'POST') {
        try {
          const body = await req.json();
          const ip = (body.ip || '').trim();
          const manualCountryCode = (body.manual_country || '').trim().toUpperCase();

          // اعتبارسنجی ورودی
          if (!ip) {
            return json({ success: false, error: 'IP خالی است' });
          }

          if (!isValidIPv4(ip)) {
            return json({ success: false, error: 'فرمت IP نامعتبر است' });
          }

          if (!isPublicIPv4(ip)) {
            return json({ success: false, error: 'IP باید عمومی باشد (نه خصوصی)' });
          }

          let code, countryName;

          // استفاده از کشور دستی (اگر انتخاب شده باشد)
          if (manualCountryCode) {
            code = manualCountryCode;
            const manualEntry = await getDnsEntry(env.DB, code);
            countryName = manualEntry ? manualEntry.country : getCountryNameFromCode(code);
          } else {
            // تشخیص خودکار کشور از IP
            const country = await detectCountryFromIP(ip, env.DB);
            if (!country || !country.code) {
              return json({ success: false, error: 'تشخیص کشور ناموفق - لطفاً کشور را به صورت دستی انتخاب کنید' });
            }
            code = country.code.toUpperCase();
            countryName = country.name;
          }

          const existing = await getDnsEntry(env.DB, code);

          if (existing) {
            // حذف آدرس‌های تکراری از لیست موجود
            existing.addresses = [...new Set(existing.addresses)];

            if (!existing.addresses.includes(ip)) {
              existing.addresses.push(ip);
              existing.stock = existing.addresses.length;
              await putDnsEntry(env.DB, existing);
              invalidateDnsCache();
              return json({
                success: true,
                country: code,
                countryName: existing.country,
                action: 'updated',
                totalIps: existing.stock
              });
            } else {
              // آدرس تکراری است
              return json({
                success: true,
                country: code,
                countryName: existing.country,
                action: 'duplicate',
                totalIps: existing.stock
              });
            }
          } else {
            // ایجاد کشور جدید
            const newEntry = {
              code: code,
              country: countryName,
              addresses: [ip],
              stock: 1
            };
            await putDnsEntry(env.DB, newEntry);
            invalidateDnsCache();
            return json({
              success: true,
              country: code,
              countryName: countryName,
              action: 'created',
              totalIps: 1
            });
          }
        } catch (e) {
          console.error('خطا در افزودن IP:', e);
          return json({
            success: false,
            error: e.message || 'خطای نامشخص در سرور'
          });
        }
      }

      // API: افزودن آدرس به کشور مشخص (تک کشور)
      if (url.pathname === '/api/admin/single-country-add' && req.method === 'POST') {
        try {
          const form = await req.formData();
          const countryCode = (form.get('country_code') || '').toUpperCase().trim();
          const addressesRaw = form.get('addresses');

          if (!countryCode) {
            return html(`<!doctype html>
<html lang="fa" dir="rtl">
<meta charset="utf-8">
<meta http-equiv="refresh" content="3;url=/">
<title>خطا</title>
<body style="font-family: Vazirmatn, sans-serif; padding:30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-align: center;">
  <h2>❌ لطفاً کشور را انتخاب کنید</h2>
  <p style="margin-top: 20px;"><a href="/" style="color: white; text-decoration: underline;">بازگشت به صفحه اصلی</a></p>
  <script>setTimeout(()=>location.href='/',3000)</script>
</body>
</html>`);
          }

          if (!addressesRaw || !addressesRaw.trim()) {
            return html(`<!doctype html>
<html lang="fa" dir="rtl">
<meta charset="utf-8">
<meta http-equiv="refresh" content="3;url=/">
<title>خطا</title>
<body style="font-family: Vazirmatn, sans-serif; padding:30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-align: center;">
  <h2>❌ لطفاً آدرس‌ها را وارد کنید</h2>
  <p style="margin-top: 20px;"><a href="/" style="color: white; text-decoration: underline;">بازگشت به صفحه اصلی</a></p>
  <script>setTimeout(()=>location.href='/',3000)</script>
</body>
</html>`);
          }

          // پارس کردن آدرس‌ها
          const addresses = addressesRaw
            .split(/[\r\n,;\s]+/)
            .map(a => a.trim())
            .filter(a => a && isValidIPv4(a) && isPublicIPv4(a));

          if (addresses.length === 0) {
            return html(`<!doctype html>
<html lang="fa" dir="rtl">
<meta charset="utf-8">
<meta http-equiv="refresh" content="3;url=/">
<title>خطا</title>
<body style="font-family: Vazirmatn, sans-serif; padding:30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-align: center;">
  <h2>❌ هیچ آدرس IP معتبری یافت نشد</h2>
  <p style="margin-top: 20px;"><a href="/" style="color: white; text-decoration: underline;">بازگشت به صفحه اصلی</a></p>
  <script>setTimeout(()=>location.href='/',3000)</script>
</body>
</html>`);
          }

          // بررسی وجود کشور
          const existing = await getDnsEntry(env.DB, countryCode);
          const countryName = existing ? existing.country : getCountryNameFromCode(countryCode);

          // حذف تکراری‌ها
          const uniqueAddresses = [...new Set(addresses)];
          
          let added = 0;
          let duplicate = 0;

          if (existing) {
            // اضافه کردن به کشور موجود
            existing.addresses = [...new Set(existing.addresses)];
            const beforeCount = existing.addresses.length;
            
            uniqueAddresses.forEach(ip => {
              if (!existing.addresses.includes(ip)) {
                existing.addresses.push(ip);
                added++;
              } else {
                duplicate++;
              }
            });

            existing.stock = existing.addresses.length;
            await putDnsEntry(env.DB, existing);
          } else {
            // ایجاد کشور جدید
            added = uniqueAddresses.length;
            const newEntry = {
              code: countryCode,
              country: countryName,
              addresses: uniqueAddresses,
              stock: uniqueAddresses.length
            };
            await putDnsEntry(env.DB, newEntry);
          }

          invalidateDnsCache();

          return html(`<!doctype html>
<html lang="fa" dir="rtl">
<meta charset="utf-8">
<meta http-equiv="refresh" content="2;url=/">
<title>موفق</title>
<body style="font-family: Vazirmatn, sans-serif; padding:30px; background: linear-gradient(135deg, #10b981, #059669); color: white; text-align: center;">
  <h2>✅ ${added} آدرس جدید اضافه شد</h2>
  <p>🔄 ${duplicate} آدرس تکراری</p>
  <p>📍 کشور: ${countryCodeToFlag(countryCode)} ${countryName}</p>
  <p style="margin-top: 20px;">در حال انتقال به صفحه اصلی...</p>
  <p><a href="/" style="color: white; text-decoration: underline;">بازگشت فوری</a></p>
  <script>setTimeout(()=>location.href='/',2000)</script>
</body>
</html>`);
        } catch (e) {
          console.error('خطا در افزودن تک کشور:', e);
          return html(`<!doctype html>
<html lang="fa" dir="rtl">
<meta charset="utf-8">
<meta http-equiv="refresh" content="3;url=/">
<title>خطا</title>
<body style="font-family: Vazirmatn, sans-serif; padding:30px; background: linear-gradient(135deg, #ef4444, #dc2626); color: white; text-align: center;">
  <h2>❌ خطا: ${e.message || 'خطای نامشخص'}</h2>
  <p style="margin-top: 20px;"><a href="/" style="color: white; text-decoration: underline;">بازگشت به صفحه اصلی</a></p>
  <script>setTimeout(()=>location.href='/',3000)</script>
</body>
</html>`);
        }
      }

      // API: افزودن گروهی با تشخیص خودکار کشور (fallback - برای JavaScript غیرفعال)
      if (url.pathname === '/api/admin/bulk-add' && req.method === 'POST') {
        try {
          const form = await req.formData();
          const addressesRaw = form.get('addresses');

          if (!addressesRaw || !addressesRaw.trim()) {
            return html(`<!doctype html>
<html lang="fa" dir="rtl">
<meta charset="utf-8">
<meta http-equiv="refresh" content="3;url=/">
<title>ورودی نامعتبر</title>
<body style="font-family: Vazirmatn, sans-serif; padding:30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-align: center;">
  <h2>⚠️ ورودی نامعتبر</h2>
  <p>لطفاً آدرس‌های IP را وارد کنید</p>
  <p style="margin-top: 20px;"><a href="/" style="color: white; text-decoration: underline;">بازگشت به صفحه اصلی</a></p>
  <script>setTimeout(()=>location.href='/',3000)</script>
</body>
</html>`);
          }

          // پارس کردن و اعتبارسنجی آدرس‌ها
          const allIps = addressesRaw.split(/[\r\n,;\s]+/)
            .map(a => a.trim())
            .filter(Boolean);

          const validIps = [];
          const invalidIps = [];

          for (const ip of allIps) {
            if (isValidIPv4(ip) && isPublicIPv4(ip)) {
              validIps.push(ip);
            } else if (ip) {
              invalidIps.push(ip);
            }
          }

          // حذف تکراری‌ها
          const uniqueIps = [...new Set(validIps)];

          if (uniqueIps.length === 0) {
            return html(`<!doctype html>
<html lang="fa" dir="rtl">
<meta charset="utf-8">
<meta http-equiv="refresh" content="3;url=/">
<title>بدون IP معتبر</title>
<body style="font-family: Vazirmatn, sans-serif; padding:30px; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; text-align: center;">
  <h2>❌ هیچ آدرس IP معتبری یافت نشد</h2>
  <p>از ${allIps.length} آدرس، هیچ IP عمومی معتبری شناسایی نشد</p>
  ${invalidIps.length > 0 ? `<p style="font-size: 0.9em; opacity: 0.9;">نامعتبر: ${invalidIps.slice(0, 5).join(', ')}${invalidIps.length > 5 ? '...' : ''}</p>` : ''}
  <p style="margin-top: 20px;"><a href="/" style="color: white; text-decoration: underline;">بازگشت به صفحه اصلی</a></p>
  <script>setTimeout(()=>location.href='/',3000)</script>
</body>
</html>`);
          }

          const results = {
            success: 0,
            failed: 0,
            duplicate: 0,
            byCountry: {},
            errors: []
          };

          // پردازش هر IP
          for (const ip of uniqueIps) {
            try {
              const country = await detectCountryFromIP(ip, env.DB);

              if (!country || !country.code) {
                results.failed++;
                results.errors.push({ ip, reason: 'تشخیص کشور ناموفق' });
                continue;
              }

              const code = country.code.toUpperCase();
              const existing = await getDnsEntry(env.DB, code);

              if (existing) {
                // حذف آدرس‌های تکراری از لیست موجود
                existing.addresses = [...new Set(existing.addresses)];

                if (!existing.addresses.includes(ip)) {
                  existing.addresses.push(ip);
                  existing.stock = existing.addresses.length;
                  await putDnsEntry(env.DB, existing);
                  results.success++;
                  results.byCountry[code] = (results.byCountry[code] || 0) + 1;
                } else {
                  // آدرس تکراری است
                  results.duplicate++;
                }
              } else {
                // ایجاد کشور جدید
                const newEntry = {
                  code: code,
                  country: country.name,
                  addresses: [ip],
                  stock: 1
                };
                await putDnsEntry(env.DB, newEntry);
                results.success++;
                results.byCountry[code] = 1;
              }
            } catch (e) {
              results.failed++;
              results.errors.push({ ip, reason: e.message });
            }
          }

          // بروزرسانی cache
          invalidateDnsCache();

          // آماده‌سازی خلاصه
          const summary = Object.entries(results.byCountry)
            .sort((a, b) => b[1] - a[1])
            .map(([code, count]) => `${code}: ${count}`)
            .join(', ');

          const totalProcessed = results.success + results.failed + results.duplicate;

          return html(`<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="4;url=/">
  <title>نتیجه افزودن گروهی</title>
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: Vazirmatn, sans-serif;
      padding: 30px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-align: center;
      line-height: 1.8;
    }
    .result-box {
      background: rgba(255,255,255,0.1);
      backdrop-filter: blur(10px);
      border-radius: 15px;
      padding: 30px;
      max-width: 600px;
      margin: 0 auto;
      box-shadow: 0 8px 32px rgba(0,0,0,0.1);
    }
    h1 { font-size: 2em; margin-bottom: 20px; }
    .stat { font-size: 1.2em; margin: 10px 0; }
    .summary { 
      background: rgba(255,255,255,0.15); 
      padding: 15px; 
      border-radius: 10px; 
      margin: 20px 0;
      font-size: 0.95em;
    }
    a { color: white; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="result-box">
    <h1>📊 نتیجه افزودن گروهی</h1>
    <div class="stat">✅ <strong>${results.success}</strong> آدرس جدید اضافه شد</div>
    <div class="stat">🔄 <strong>${results.duplicate}</strong> آدرس تکراری</div>
    <div class="stat">❌ <strong>${results.failed}</strong> ناموفق</div>
    <div class="stat">📍 <strong>${totalProcessed}</strong> از ${uniqueIps.length} پردازش شد</div>
    ${summary ? `<div class="summary"><strong>توزیع کشورها:</strong><br>${summary}</div>` : ''}
    ${invalidIps.length > 0 ? `<div class="stat" style="font-size: 0.9em; opacity: 0.9;">⚠️ ${invalidIps.length} IP نامعتبر نادیده گرفته شد</div>` : ''}
    <p style="margin-top: 30px; font-size: 0.9em;">در حال انتقال به صفحه اصلی...</p>
    <p><a href="/">بازگشت فوری</a></p>
  </div>
  <script>setTimeout(()=>location.href='/',4000)</script>
</body>
</html>`);
        } catch (e) {
          console.error('خطا در افزودن گروهی:', e);
          return html(`<!doctype html>
<html lang="fa" dir="rtl">
<meta charset="utf-8">
<title>خطا</title>
<body style="font-family: sans-serif; padding:30px; text-align: center;">
  <h2>❌ خطا در پردازش</h2>
  <p>${e.message || 'خطای نامشخص'}</p>
  <p><a href="/">بازگشت به صفحه اصلی</a></p>
</body>
</html>`);
        }
      }

      // صفحه IPv6
      if (url.pathname === '/ipv6' && req.method === 'GET') {
        const entries = await listIpv6Entries(env.DB);
        const userCount = await countUsers(env.DB);
        return html(renderIpv6Page(entries, userCount));
      }

      // API: افزودن IPv6 جدید
      if (url.pathname === '/api/admin/add-ipv6' && req.method === 'POST') {
        const form = await req.formData();
        const addresses = (form.get('addresses') || '')
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(Boolean);

        const code = (form.get('code') || '').toUpperCase().trim();
        let countryName = (form.get('country') || '').trim();

        if (!countryName && code) {
          countryName = getCountryNameFromCode(code);
        }

        const entry = {
          country: countryName,
          code: code,
          addresses: addresses,
          stock: addresses.length
        };

        if (!entry.country || !entry.code || entry.code.length !== 2) {
          return html(`<script>
          alert('❌ اطلاعات نامعتبر است');
          setTimeout(() => history.back(), 1000);
        </script>`);
        }

        const existing = await getIpv6Entry(env.DB, entry.code);
        if (existing) {
          return html(`<script>
          alert('⚠️ این کد کشور قبلاً ثبت شده است');
          setTimeout(() => history.back(), 1000);
        </script>`);
        }

        await putIpv6Entry(env.DB, entry);

        return html(`<!doctype html>
<html lang="fa" dir="rtl">
<meta charset="utf-8">
<meta http-equiv="refresh" content="2;url=/ipv6">
<title>موفقیت</title>
<body style="font-family: sans-serif; padding:20px;">
  <p>✅ IPv6 ${entry.country} با موفقیت اضافه شد!</p>
  <p><a href="/ipv6">بازگشت به صفحه IPv6</a></p>
  <script>setTimeout(()=>location.href='/ipv6',2000)</script>
</body>
</html>`);
      }

      // API: افزودن گروهی IPv6
      if (url.pathname === '/api/admin/bulk-add-ipv6' && req.method === 'POST') {
        const form = await req.formData();
        const addresses = (form.get('addresses') || '')
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(s => s && isValidIPv6(s));

        const code = (form.get('code') || '').toUpperCase().trim();
        let countryName = (form.get('country') || '').trim();

        if (!countryName && code) {
          countryName = getCountryNameFromCode(code);
        }

        if (!code || code.length !== 2 || addresses.length === 0) {
          return html(`<script>
          alert('❌ اطلاعات نامعتبر است');
          setTimeout(() => history.back(), 1000);
        </script>`);
        }

        const existing = await getIpv6Entry(env.DB, code);

        if (existing) {
          // اضافه کردن به کشور موجود
          existing.addresses = [...new Set([...existing.addresses, ...addresses])];
          existing.stock = existing.addresses.length;
          await putIpv6Entry(env.DB, existing);
        } else {
          // ایجاد کشور جدید
          const uniqueIpv6Addresses = [...new Set(addresses)];
          const newEntry = {
            code: code,
            country: countryName,
            addresses: uniqueIpv6Addresses,
            stock: uniqueIpv6Addresses.length
          };
          await putIpv6Entry(env.DB, newEntry);
        }

        return html(`<!doctype html>
<html lang="fa" dir="rtl">
<meta charset="utf-8">
<meta http-equiv="refresh" content="2;url=/ipv6">
<title>موفقیت</title>
<body style="font-family: sans-serif; padding:20px;">
  <p>✅ ${addresses.length} آدرس IPv6 برای ${countryName} اضافه شد!</p>
  <p><a href="/ipv6">بازگشت به صفحه IPv6</a></p>
  <script>setTimeout(()=>location.href='/ipv6',2000)</script>
</body>
</html>`);
      }

      // API: حذف IPv6
      if (url.pathname === '/api/admin/delete-ipv6' && req.method === 'POST') {
        const form = await req.formData();
        const code = form.get('code');

        if (code) {
          const entry = await getIpv6Entry(env.DB, code);
          await deleteIpv6Entry(env.DB, code);

          return html(`<!doctype html>
<html lang="fa" dir="rtl">
<meta charset="utf-8">
<meta http-equiv="refresh" content="1.5;url=/ipv6">
<title>حذف کشور</title>
<body style="font-family: sans-serif; padding:20px;">
  <p>🗑️ IPv6 ${entry ? entry.country : code} با موفقیت حذف شد.</p>
  <p><a href="/ipv6">بازگشت به صفحه IPv6</a></p>
  <script>setTimeout(()=>location.href='/ipv6',1500)</script>
</body>
</html>`);
        }

        return html(`<!doctype html>
<html lang="fa" dir="rtl">
<meta charset="utf-8">
<meta http-equiv="refresh" content="2;url=/ipv6">
<title>خطا</title>
<body style="font-family: sans-serif; padding:20px;">
  <p>❌ خطا در حذف. انتقال به صفحه IPv6...</p>
  <p><a href="/ipv6">بازگشت به صفحه IPv6</a></p>
  <script>setTimeout(()=>location.href='/ipv6',2000)</script>
</body>
</html>`);
      }

      // API: بروزرسانی نام کشور IPv6
      if (url.pathname === '/api/admin/update-ipv6-name' && req.method === 'POST') {
        const form = await req.formData();
        const code = (form.get('code') || '').toUpperCase().trim();
        const newName = (form.get('country') || '').trim();

        if (code && newName) {
          const entry = await getIpv6Entry(env.DB, code);
          if (entry) {
            entry.country = newName;
            await putIpv6Entry(env.DB, entry);
          }
        }

        return html(`<!doctype html>
<html lang="fa" dir="rtl">
<meta charset="utf-8">
<meta http-equiv="refresh" content="1;url=/ipv6">
<title>بروزرسانی</title>
<body style="font-family: sans-serif; padding:20px;">
  <p>✅ نام کشور بروزرسانی شد.</p>
  <script>setTimeout(()=>location.href='/ipv6',1000)</script>
</body>
</html>`);
      }


      // ─────────────────────────────────────────────────────────────────────────────
      // 📨 Telegram Webhook
      // ─────────────────────────────────────────────────────────────────────────────

      // Webhook تلگرام
      if (url.pathname === '/webhook' && req.method === 'POST') {
        try {
          const update = await req.json();
          await handleUpdate(update, env);
          return json({ ok: true });
        } catch (e) {
          console.error('خطا در webhook:', e);
          return json({ ok: false, error: e.message }, 500);
        }
      }


      // ─────────────────────────────────────────────────────────────────────────────
      // ⚙️ Webhook Management
      // ─────────────────────────────────────────────────────────────────────────────

      // تنظیم webhook
      if (url.pathname === '/api/set-webhook' && req.method === 'GET') {
        if (!env.BOT_TOKEN) {
          return json({
            ok: false,
            error: 'BOT_TOKEN تنظیم نشده است',
            help: 'لطفاً در Settings > Functions > Environment variables متغیر BOT_TOKEN را اضافه کنید'
          }, 500);
        }
        const webhookUrl = `${url.origin}/webhook`;
        const res = await fetch(`${TELEGRAM_BASE(env.BOT_TOKEN)}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: webhookUrl })
        });
        const result = await res.json();
        return json(result);
      }

      // حذف webhook
      if (url.pathname === '/api/delete-webhook' && req.method === 'GET') {
        const res = await fetch(`${TELEGRAM_BASE(env.BOT_TOKEN)}/deleteWebhook`, {
          method: 'POST'
        });
        const result = await res.json();
        return json(result);
      }

      // وضعیت webhook
      if (url.pathname === '/api/webhook-info' && req.method === 'GET') {
        const res = await fetch(`${TELEGRAM_BASE(env.BOT_TOKEN)}/getWebhookInfo`);
        const result = await res.json();
        return json(result);
      }


      // ─────────────────────────────────────────────────────────────────────────────
      // 🛠️ Admin Utilities
      // ─────────────────────────────────────────────────────────────────────────────

      // تبدیل تمام اسم کشورها به فارسی
      if (url.pathname === '/api/admin/fix-country-names' && req.method === 'GET') {
        try {
          const entries = await listDnsEntries(env.DB);
          let updated = 0;
          let skipped = 0;

          for (const entry of entries) {
            const persianName = getCountryNameFromCode(entry.code);

            // اگر اسم فعلی با اسم فارسی متفاوت است، بروزرسانی کن
            if (entry.country !== persianName) {
              entry.country = persianName;
              await putDnsEntry(env.DB, entry);
              updated++;
            } else {
              skipped++;
            }
          }

          invalidateDnsCache();

          return json({
            success: true,
            message: `✅ ${updated} کشور بروزرسانی شد، ${skipped} کشور نیازی به تغییر نداشت`,
            updated,
            skipped,
            total: entries.length
          });
        } catch (e) {
          return json({ success: false, error: e.message }, 500);
        }
      }

      // حذف آدرس‌های تکراری از تمام کشورها
      if (url.pathname === '/api/admin/remove-duplicates' && req.method === 'GET') {
        try {
          const entries = await listDnsEntries(env.DB);
          let totalRemoved = 0;
          let countriesUpdated = 0;

          for (const entry of entries) {
            if (Array.isArray(entry.addresses)) {
              const originalCount = entry.addresses.length;
              // حذف تکراری‌ها با استفاده از Set
              entry.addresses = [...new Set(entry.addresses)];
              const newCount = entry.addresses.length;
              const removed = originalCount - newCount;

              if (removed > 0) {
                entry.stock = entry.addresses.length;
                await putDnsEntry(env.DB, entry);
                totalRemoved += removed;
                countriesUpdated++;
              }
            }
          }

          invalidateDnsCache();

          return json({
            success: true,
            message: `✅ ${totalRemoved} آدرس تکراری از ${countriesUpdated} کشور حذف شد`,
            totalRemoved,
            countriesUpdated,
            totalCountries: entries.length
          });
        } catch (e) {
          return json({ success: false, error: e.message }, 500);
        }
      }


      // ─────────────────────────────────────────────────────────────────────────────
      // ❌ 404 Handler
      // ─────────────────────────────────────────────────────────────────────────────

      return html('<h1>404 - صفحه یافت نشد</h1>');

    } catch (error) {
      // مدیریت خطاهای غیرمنتظره برای جلوگیری از خطای 1101
      console.error('خطای Worker:', error);
      console.error('Stack:', error.stack);

      // بررسی نوع درخواست برای ارسال پاسخ مناسب
      const acceptHeader = req.headers.get('accept') || '';
      const isJsonRequest = acceptHeader.includes('application/json');

      if (isJsonRequest) {
        // پاسخ JSON برای API requests
        return new Response(
          JSON.stringify({
            error: 'خطای داخلی سرور',
            message: error.message || 'خطای نامشخص',
            stack: error.stack,
            timestamp: new Date().toISOString()
          }, null, 2),
          {
            status: 500,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*'
            }
          }
        );
      } else {
        // پاسخ HTML برای browser requests
        return html(`<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>خطای سرور</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .error-container {
      background: white;
      border-radius: 20px;
      padding: 40px;
      max-width: 600px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
    }
    .error-icon {
      font-size: 80px;
      margin-bottom: 20px;
    }
    h1 {
      color: #e74c3c;
      margin-bottom: 15px;
      font-size: 28px;
    }
    .error-message {
      color: #555;
      margin-bottom: 20px;
      line-height: 1.6;
      font-size: 16px;
    }
    .error-details {
      background: #f8f9fa;
      border: 1px solid #dee2e6;
      border-radius: 10px;
      padding: 15px;
      margin: 20px 0;
      text-align: right;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      color: #d63031;
      max-height: 200px;
      overflow-y: auto;
      word-break: break-word;
    }
    .btn {
      display: inline-block;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 12px 30px;
      border-radius: 25px;
      text-decoration: none;
      font-weight: bold;
      transition: transform 0.2s;
      margin-top: 20px;
    }
    .btn:hover {
      transform: translateY(-2px);
    }
    .help-text {
      margin-top: 20px;
      font-size: 14px;
      color: #7f8c8d;
    }
  </style>
</head>
<body>
  <div class="error-container">
    <div class="error-icon">⚠️</div>
    <h1>خطای داخلی سرور</h1>
    <div class="error-message">
      متأسفانه یک خطای غیرمنتظره رخ داده است. لطفاً دوباره تلاش کنید.
    </div>
    <div class="error-details">
      <strong>پیام خطا:</strong><br>
      ${error.message || 'خطای نامشخص'}
    </div>
    <div class="help-text">
      اگر این خطا همچنان ادامه دارد، لطفاً با مدیر سیستم تماس بگیرید.
      <br>
      <small>زمان: ${new Date().toLocaleString('fa-IR')}</small>
    </div>
    <a href="/" class="btn">🏠 بازگشت به صفحه اصلی</a>
  </div>
</body>
</html>`);
      }
    }
  }
};
