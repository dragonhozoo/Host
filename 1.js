/**
 * HOZOO SHOP BOT - CLEAN FINAL
 * pake puppeteer-core + chromium sistem
 * Owner: 8530130542
 */

let TelegramBot = require('node-telegram-bot-api');
if (typeof TelegramBot !== 'function') {
  TelegramBot = TelegramBot.default || TelegramBot.TelegramBot || TelegramBot;
}

const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const moment = require('moment');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const puppeteer = require('puppeteer-core');

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

// Deteksi chromium otomatis
function findChromium() {
  const paths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium'
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const CHROMIUM_PATH = findChromium();
console.log(`[INIT] Chromium: ${CHROMIUM_PATH || '❌ GAK KETEMU'}`);

const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN || '8904423806:AAHwEceSnUvBZxdoMp_Xyd0Jw6ccR2u99xE',
  OWNER_ID: 8530130542,
  ADMIN_USERNAME: '@HOZOOSHOP',
  PAYMENT_IMAGE: 'https://i.ibb.co.com/99sCVHsw/IMG-20260929-224759-634.jpg',
  BASE_URL: process.env.BASE_URL || `http://${getLocalIP()}:3000`,
  PORT: process.env.PORT || 3000,
  UPLOAD_DIR: path.join(__dirname, 'uploads'),
  DB_FILE: path.join(__dirname, 'database.json'),
  MAX_FILE_SIZE: 50 * 1024 * 1024,
  EDGEONE_URL: 'https://pages.edgeone.ai/drop',
  EDGEONE_AUTO_DEPLOY: true
};

console.log(`[INIT] BASE_URL = ${CONFIG.BASE_URL}`);

// ═══ DATABASE ═══
class Database {
  constructor(file) {
    this.file = file;
    this.data = { users: {}, purchases: {}, hosts: {}, stats: { totalOrders: 0, totalRevenue: 0 } };
    this.load();
  }
  load() {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = {
          users: parsed.users || {},
          purchases: parsed.purchases || {},
          hosts: parsed.hosts || {},
          stats: parsed.stats || { totalOrders: 0, totalRevenue: 0 }
        };
      }
    } catch (e) { console.log('[DB] Load error:', e.message); }
    this.save();
  }
  save() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2)); }
    catch (e) { console.log('[DB] Save error:', e.message); }
  }
  getUser(id) {
    id = String(id);
    if (!this.data.users[id]) {
      this.data.users[id] = { id, joined: moment().format(), verified: false, balance: 0, hosts: [] };
      this.save();
    }
    return this.data.users[id];
  }
  updateUser(id, updates) {
    id = String(id);
    this.data.users[id] = { ...this.getUser(id), ...updates };
    this.save();
    return this.data.users[id];
  }
  getHost(hostId) { return this.data.hosts[hostId]; }
  getStats() { return this.data.stats; }
  addPurchase(userId, item, price, note = '') {
    const buyId = 'BUY' + uuidv4().slice(0, 8).toUpperCase();
    this.data.purchases[buyId] = {
      buyId, userId: String(userId), item, price: Number(price), note,
      status: 'pending', created: moment().format(), confirmedAt: null
    };
    this.save();
    return this.data.purchases[buyId];
  }
  getPurchase(buyId) { return this.data.purchases[buyId]; }
  getUserPurchases(userId) {
    return Object.values(this.data.purchases).filter(p => p.userId === String(userId));
  }
  deletePurchase(buyId) {
    if (this.data.purchases[buyId]) {
      delete this.data.purchases[buyId];
      this.save();
      return true;
    }
    return false;
  }
  deleteUserPurchases(userId) {
    const ids = Object.keys(this.data.purchases).filter(k => this.data.purchases[k].userId === String(userId));
    ids.forEach(k => delete this.data.purchases[k]);
    this.save();
    return ids.length;
  }
  confirmPurchase(buyId) {
    if (this.data.purchases[buyId]) {
      this.data.purchases[buyId].status = 'confirmed';
      this.data.purchases[buyId].confirmedAt = moment().format();
      this.data.stats.totalOrders++;
      this.data.stats.totalRevenue += this.data.purchases[buyId].price;
      this.save();
      return true;
    }
    return false;
  }
}

const db = new Database(CONFIG.DB_FILE);

const ownerUser = db.getUser(CONFIG.OWNER_ID);
if (!ownerUser.verified) {
  db.updateUser(CONFIG.OWNER_ID, { verified: true });
  console.log(`[AUTO] Owner ${CONFIG.OWNER_ID} auto-verified ✅`);
}

let bot;
try {
  bot = new TelegramBot(CONFIG.BOT_TOKEN, { polling: true });
} catch (e) {
  console.error('FATAL:', e.message);
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(CONFIG.UPLOAD_DIR));

fs.ensureDirSync(CONFIG.UPLOAD_DIR);
const userState = {};

const isOwner = (id) => String(id) === String(CONFIG.OWNER_ID);
const log = (type, msg) => console.log(`[${moment().format('HH:mm:ss')}] [${type}] ${msg}`);
const rupiah = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');

const safeSend = async (chatId, text, options = {}) => {
  const safe = String(text || '');
  try {
    return await bot.sendMessage(chatId, safe, { parse_mode: 'Markdown', ...options });
  } catch (e) {
    try { return await bot.sendMessage(chatId, safe.replace(/[*_`\[\]]/g, ''), options); }
    catch (e2) { log('ERR', `fallback: ${e2.message}`); }
  }
};

// ═══ EDGEONE AUTO-DEPLOY ═══
async function deployToEdgeOne(htmlFilePath, customName = '') {
  if (!CHROMIUM_PATH) {
    throw new Error('Chromium gak ketemu. Install: sudo apt install chromium');
  }

  log('EDGEONE', `Pake browser: ${CHROMIUM_PATH}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROMIUM_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--window-size=1280,800'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    log('EDGEONE', 'Buka halaman...');
    await page.goto('https://pages.edgeone.ai/drop', { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 5000));

    await page.screenshot({ path: '/tmp/edgeone_1.png' });
    log('EDGEONE', 'Screenshot: /tmp/edgeone_1.png');

    // Cari input file
    let fileInput = await page.$('input[type="file"]');

    if (!fileInput) {
      log('EDGEONE', 'Input file gak ada di main frame, cek iframe...');
      const frames = page.frames();
      for (const frame of frames) {
        try {
          const inputInFrame = await frame.$('input[type="file"]');
          if (inputInFrame) {
            fileInput = inputInFrame;
            log('EDGEONE', 'Ketemu di iframe!');
            break;
          }
        } catch (e) {}
      }
    }

    if (!fileInput) {
      await page.screenshot({ path: '/tmp/edgeone_2_nofile.png' });
      throw new Error('Input file gak ketemu. Cek /tmp/edgeone_2_nofile.png');
    }

    log('EDGEONE', `Upload: ${htmlFilePath}`);
    await fileInput.uploadFile(htmlFilePath);
    await new Promise(r => setTimeout(r, 8000));
    await page.screenshot({ path: '/tmp/edgeone_3_uploaded.png' });
    log('EDGEONE', 'Screenshot: /tmp/edgeone_3_uploaded.png');

    // Kalo ada customName
    if (customName) {
      try {
        const inputs = await page.$$('input[type="text"]');
        if (inputs.length > 0) {
          await inputs[0].click({ clickCount: 3 });
          await inputs[0].type(customName);
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (e) { log('EDGEONE', `Skip custom: ${e.message}`); }
    }

    // Cari tombol deploy
    log('EDGEONE', 'Cari tombol deploy...');
    const buttons = await page.$$('button');
    let deployBtn = null;
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      log('EDGEONE', `Button: "${text}"`);
      if (text && (text.toLowerCase().includes('deploy') || text.toLowerCase().includes('发布') || text.toLowerCase().includes('publish'))) {
        deployBtn = btn;
        break;
      }
    }

    if (!deployBtn) {
      await page.screenshot({ path: '/tmp/edgeone_4_nobutton.png' });
      throw new Error('Tombol deploy gak ketemu. Cek /tmp/edgeone_4_nobutton.png');
    }

    await deployBtn.click();
    log('EDGEONE', 'Diklik, tunggu 30 detik...');
    await new Promise(r => setTimeout(r, 30000));
    await page.screenshot({ path: '/tmp/edgeone_5_result.png' });

    // Ambil URL
    const url = await page.evaluate(() => {
      const all = document.querySelectorAll('a, input, span, div, code');
      for (const el of all) {
        const text = el.textContent || el.value || '';
        const href = el.href || '';
        const match = (href + ' ' + text).match(/https?:\/\/[a-z0-9-]+\.edgeone\.dev[^\s"'<>]*/i);
        if (match) return match[0];
      }
      return null;
    });

    if (!url) {
      throw new Error('URL gak ketemu. Cek /tmp/edgeone_5_result.png');
    }

    log('EDGEONE', `✅ BERHASIL: ${url}`);
    return url;
  } finally {
    await browser.close();
  }
}

// ═══ KEYBOARDS ═══
const mainKeyboard = () => ({
  reply_markup: {
    inline_keyboard: [
      [{ text: '🛒 Beli Paket', callback_data: 'menu_buy' }],
      [{ text: '💳 QR Pembayaran', callback_data: 'menu_qr' }],
      [{ text: '📤 Upload File (Hosting)', callback_data: 'menu_upload' }],
      [{ text: '👤 Akun Saya', callback_data: 'menu_akun' }],
      [{ text: '📊 Status Server', callback_data: 'menu_status' }],
      [{ text: '💬 Chat Admin', url: `https://t.me/${CONFIG.ADMIN_USERNAME.replace('@', '')}` }]
    ]
  }
});

const paketKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '🚀 5k - Auto Deploy EdgeOne', callback_data: 'buy_5k' }],
      [{ text: '🌐 10k - Auto Deploy + Custom', callback_data: 'buy_10k' }],
      [{ text: '⬅️ Kembali', callback_data: 'menu_back' }]
    ]
  }
};

const uploadKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📖 Cara Upload', callback_data: 'help_upload' }],
      [{ text: '⬅️ Kembali', callback_data: 'menu_back' }]
    ]
  }
};

// ═══ HANDLERS ═══
async function handleStart(msg) {
  const chatId = msg.chat.id;
  const user = db.getUser(chatId);
  const text = `╔══════════════════════════╗
║   *HOZOO SHOP BOT* 🛒     ║
╚══════════════════════════╝

Halo *${msg.from?.first_name || 'Bro'}*! 👋

*📋 COMMAND:*
/start /buy /qr /akun /status /riwayat

*💰 HARGA:*
• 5k → Auto Deploy EdgeOne
• 10k → Auto Deploy + Custom

*📌 Admin:* ${CONFIG.ADMIN_USERNAME}
*Chat ID:* \`${chatId}\`
*Status:* ${user.verified ? '✅ TERVERIFIKASI' : '❌ BELUM VERIFIKASI'}`;
  await safeSend(chatId, text, mainKeyboard());
}

async function handleQr(msg) {
  const chatId = msg.chat.id;
  await safeSend(chatId, `💳 *QRIS*\n\n*Paket:*\n• 5k → Auto Deploy EdgeOne\n• 10k → Auto Deploy + Custom\n\n*Kirim bukti ke:* ${CONFIG.ADMIN_USERNAME}\n*Chat ID:* \`${chatId}\``);
  try {
    await bot.sendPhoto(chatId, CONFIG.PAYMENT_IMAGE, { caption: `💳 *QRIS HOZOO SHOP*\n\nChat ID: \`${chatId}\`` });
  } catch (e) { log('ERR', `Photo: ${e.message}`); }
  await safeSend(chatId, 'Pilih paket 👇', paketKeyboard);
}

async function handleMenu(msg) {
  await safeSend(msg.chat.id, `📋 *MENU*\n\n/start /buy /qr /akun /status /riwayat`, mainKeyboard());
}

async function handleBuy(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const parts = text.split(/\s+/).slice(1);

  if (parts.length === 0) {
    const p = db.addPurchase(chatId, 'Auto Deploy EdgeOne', 5000, 'Auto /buy');
    return safeSend(chatId, `✅ *PESANAN DIBUAT!*\n\n🆔 \`${p.buyId}\`\n📦 Auto Deploy EdgeOne\n💰 ${rupiah(5000)}\n📌 PENDING`, mainKeyboard());
  }

  if (parts.length === 1) {
    const price = parseInt(parts[0]);
    if (!isNaN(price) && price > 0) {
      const p = db.addPurchase(chatId, `Paket ${rupiah(price)}`, price, 'Auto /buy');
      return safeSend(chatId, `✅ *PESANAN DIBUAT!*\n\n🆔 \`${p.buyId}\`\n💰 ${rupiah(price)}`, mainKeyboard());
    }
  }

  if (parts.length >= 2) {
    const price = parseInt(parts[0]);
    const item = parts.slice(1).join(' ');
    if (isNaN(price) || price <= 0) return safeSend(chatId, '❌ Harga gak valid.');
    const p = db.addPurchase(chatId, item, price, 'Via /buy');
    return safeSend(chatId, `✅ *PESANAN DIBUAT!*\n\n🆔 \`${p.buyId}\`\n📦 ${item}\n💰 ${rupiah(price)}`, mainKeyboard());
  }
}

async function handleRiwayat(msg) {
  const chatId = msg.chat.id;
  const purchases = db.getUserPurchases(chatId);
  if (purchases.length === 0) return safeSend(chatId, '📭 *Belum ada riwayat.*', mainKeyboard());
  let text = `📜 *RIWAYAT*\n\n`;
  purchases.slice(-10).reverse().forEach((p, i) => {
    text += `${i + 1}. \`${p.buyId}\`\n   📦 ${p.item}\n   💰 ${rupiah(p.price)}\n   📌 ${p.status}\n\n`;
  });
  await safeSend(chatId, text, mainKeyboard());
}

async function handleAkun(msg) {
  const chatId = msg.chat.id;
  const user = db.getUser(chatId);
  let hostList = '_(belum ada)_';
  if (user.hosts && user.hosts.length > 0) {
    hostList = user.hosts.map((h, i) => {
      const host = db.getHost(h);
      if (!host) return '';
      const link = host.edgeoneUrl || `${CONFIG.BASE_URL}/host/${host.hostId}`;
      return `${i + 1}. \`${host.hostId}\`\n   🔗 ${link}`;
    }).filter(Boolean).join('\n');
  }
  await safeSend(chatId, `👤 *AKUN*\n\nNama: ${msg.from?.first_name || '-'}\nChat ID: \`${chatId}\`\nStatus: ${user.verified ? '✅ Verified' : '❌ Belum'}\n\n*HOSTING:*\n${hostList}`, mainKeyboard());
}

async function handleStatus(msg) {
  const stats = db.getStats();
  const up = process.uptime();
  const h = Math.floor(up / 3600);
  const m = Math.floor((up % 3600) / 60);
  await safeSend(msg.chat.id, `📊 *STATUS*\n\n🟢 ONLINE\n⏱ ${h}h ${m}m\n📦 Orders: ${stats.totalOrders}\n💰 Revenue: ${rupiah(stats.totalRevenue)}\n🚀 EdgeOne: ${CONFIG.EDGEONE_AUTO_DEPLOY ? 'ON' : 'OFF'}\n🌐 Chromium: ${CHROMIUM_PATH ? '✅' : '❌'}`, mainKeyboard());
}

bot.onText(/\/start/, (msg) => handleStart(msg).catch(e => log('ERR', e.message)));
bot.onText(/\/qr/, (msg) => handleQr(msg).catch(e => log('ERR', e.message)));
bot.onText(/\/menu/, (msg) => handleMenu(msg).catch(e => log('ERR', e.message)));
bot.onText(/\/akun/, (msg) => handleAkun(msg).catch(e => log('ERR', e.message)));
bot.onText(/\/status/, (msg) => handleStatus(msg).catch(e => log('ERR', e.message)));
bot.onText(/\/riwayat/, (msg) => handleRiwayat(msg).catch(e => log('ERR', e.message)));
bot.onText(/^\/buy(?:@\w+)?(?:\s+(.*))?$/, (msg) => handleBuy(msg).catch(e => log('ERR', e.message)));

// ═══ OWNER COMMANDS ═══
bot.onText(/\/delbuy (.+)/, async (msg, match) => {
  if (!isOwner(msg.chat.id)) return safeSend(msg.chat.id, '❌ Owner only.');
  const buyId = match[1].trim().toUpperCase();
  const purchase = db.getPurchase(buyId);
  if (!purchase) return safeSend(msg.chat.id, `❌ Order \`${buyId}\` gak ada.`);
  db.deletePurchase(buyId);
  await safeSend(msg.chat.id, `✅ *ORDER DIHAPUS*\n\n🆔 \`${buyId}\``);
  bot.sendMessage(purchase.userId, `❌ *PESANAN DIBATALKAN*\n\nID: \`${buyId}\``).catch(() => {});
});

bot.onText(/\/confirmbuy (.+)/, async (msg, match) => {
  if (!isOwner(msg.chat.id)) return safeSend(msg.chat.id, '❌ Owner only.');
  const buyId = match[1].trim().toUpperCase();
  const purchase = db.getPurchase(buyId);
  if (!purchase) return safeSend(msg.chat.id, `❌ Order \`${buyId}\` gak ada.`);
  db.confirmPurchase(buyId);
  db.updateUser(purchase.userId, { verified: true });
  await safeSend(msg.chat.id, `✅ *ORDER DIKONFIRMASI*\n\n🆔 \`${buyId}\`\n👤 \`${purchase.userId}\``);
  bot.sendMessage(purchase.userId, `✅ *PEMBAYARAN DIKONFIRMASI!*\n\nID: \`${buyId}\`\n\nAkun lo udah *VERIFIED*. /host_30hari untuk upload.`).catch(() => {});
});

bot.onText(/\/getbuy (\d+)/, async (msg, match) => {
  if (!isOwner(msg.chat.id)) return safeSend(msg.chat.id, '❌ Owner only.');
  const targetId = match[1].trim();
  const purchases = db.getUserPurchases(targetId);
  if (purchases.length === 0) return safeSend(msg.chat.id, `📭 User \`${targetId}\` gak ada pesanan.`);
  const user = db.getUser(targetId);
  let text = `📋 *PESANAN USER* \`${targetId}\`\n👤 Verified: ${user.verified ? '✅' : '❌'}\n📦 Total: ${purchases.length}\n\n`;
  purchases.forEach((p, i) => {
    text += `${i + 1}. \`${p.buyId}\`\n   📦 ${p.item}\n   💰 ${rupiah(p.price)}\n   📌 ${p.status}\n\n`;
  });
  await safeSend(msg.chat.id, text);
});

bot.onText(/\/getdel (\d+)/, async (msg, match) => {
  if (!isOwner(msg.chat.id)) return safeSend(msg.chat.id, '❌ Owner only.');
  const targetId = match[1].trim();
  const purchases = db.getUserPurchases(targetId);
  if (purchases.length === 0) return safeSend(msg.chat.id, `📭 User \`${targetId}\` gak ada pesanan.`);
  const count = db.deleteUserPurchases(targetId);
  await safeSend(msg.chat.id, `✅ *SEMUA PESANAN DIHAPUS*\n\n👤 \`${targetId}\`\n🗑 Total: ${count}`);
  bot.sendMessage(targetId, `❌ *PESANAN LO DIBATALKAN*`).catch(() => {});
});

bot.onText(/\/listbuy/, async (msg) => {
  if (!isOwner(msg.chat.id)) return;
  const purchases = Object.values(db.data.purchases);
  if (purchases.length === 0) return safeSend(msg.chat.id, '📭 Belum ada pembelian.');
  let text = `📋 *SEMUA PEMBELIAN (${purchases.length})*\n\n`;
  purchases.slice(-30).reverse().forEach((p, i) => {
    text += `${i + 1}. \`${p.buyId}\`\n   👤 \`${p.userId}\`\n   📦 ${p.item}\n   💰 ${rupiah(p.price)}\n   📌 ${p.status}\n\n`;
  });
  await safeSend(msg.chat.id, text);
});

bot.onText(/\/verify (\d+)/, async (msg, match) => {
  if (!isOwner(msg.chat.id)) return;
  db.updateUser(match[1], { verified: true });
  await safeSend(msg.chat.id, `✅ User \`${match[1]}\` verified!`);
  bot.sendMessage(match[1], '✅ *AKSES DIBUKA!*').catch(() => {});
});

bot.onText(/\/unverify (\d+)/, async (msg, match) => {
  if (!isOwner(msg.chat.id)) return;
  db.updateUser(match[1], { verified: false });
  await safeSend(msg.chat.id, `❌ User \`${match[1]}\` di-unverify.`);
});

bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  if (!isOwner(msg.chat.id)) return;
  const users = Object.keys(db.data.users);
  let sent = 0;
  for (const uid of users) {
    try { await bot.sendMessage(uid, `📢 *BROADCAST*\n\n${match[1]}`, { parse_mode: 'Markdown' }); sent++; } catch (e) {}
  }
  await safeSend(msg.chat.id, `✅ Terkirim ${sent}/${users.length}`);
});

bot.onText(/\/listuser/, async (msg) => {
  if (!isOwner(msg.chat.id)) return;
  const users = Object.keys(db.data.users);
  let text = `📋 *USERS (${users.length})*\n\n`;
  users.slice(0, 50).forEach((uid, i) => {
    const u = db.getUser(uid);
    text += `${i + 1}. \`${uid}\` - ${u.verified ? '✅' : '❌'}\n`;
  });
  await safeSend(msg.chat.id, text);
});

bot.onText(/\/helpowner/, async (msg) => {
  if (!isOwner(msg.chat.id)) return;
  await safeSend(msg.chat.id, `🔐 *OWNER MENU*\n\n/buy /delbuy /confirmbuy /getbuy /getdel /listbuy /listuser /verify /unverify /broadcast\n/edgeon /edgeoff`);
});

bot.onText(/\/edgeon/, async (msg) => {
  if (!isOwner(msg.chat.id)) return;
  CONFIG.EDGEONE_AUTO_DEPLOY = true;
  await safeSend(msg.chat.id, '✅ EdgeOne: ON');
});

bot.onText(/\/edgeoff/, async (msg) => {
  if (!isOwner(msg.chat.id)) return;
  CONFIG.EDGEONE_AUTO_DEPLOY = false;
  await safeSend(msg.chat.id, '❌ EdgeOne: OFF');
});

// ═══ CALLBACK ═══
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  bot.answerCallbackQuery(query.id).catch(() => {});
  const fakeMsg = { chat: { id: chatId }, from: query.from || { first_name: 'User', id: chatId } };
  try {
    switch (data) {
      case 'menu_buy': {
        const p = db.addPurchase(chatId, 'Auto Deploy EdgeOne', 5000, 'Via button');
        await safeSend(chatId, `✅ *PESANAN DIBUAT!*\n\n🆔 \`${p.buyId}\`\n💰 ${rupiah(5000)}`, mainKeyboard());
        break;
      }
      case 'menu_qr': await handleQr(fakeMsg); break;
      case 'menu_upload': await handleHost30Hari(fakeMsg); break;
      case 'menu_akun': await handleAkun(fakeMsg); break;
      case 'menu_status': await handleStatus(fakeMsg); break;
      case 'menu_back': await safeSend(chatId, '🏠 *Menu Utama*', mainKeyboard()); break;
      case 'buy_5k': {
        const p = db.addPurchase(chatId, 'Auto Deploy EdgeOne', 5000, 'Via button');
        await safeSend(chatId, `✅ *PESANAN DIBUAT!*\n\n🆔 \`${p.buyId}\`\n💰 ${rupiah(5000)}`, mainKeyboard());
        break;
      }
      case 'buy_10k': {
        const p = db.addPurchase(chatId, 'Auto Deploy + Custom', 10000, 'Via button');
        await safeSend(chatId, `✅ *PESANAN DIBUAT!*\n\n🆔 \`${p.buyId}\`\n💰 ${rupiah(10000)}`, mainKeyboard());
        break;
      }
      case 'help_upload': await safeSend(chatId, '📖 Cara upload:\n1. Verified\n2. /host_30hari\n3. Kirim file .html\n4. Otomatis deploy ke EdgeOne'); break;
    }
  } catch (e) { log('ERR', `callback: ${e.message}`); }
});

// ═══ UPLOAD ═══
async function handleHost30Hari(msg) {
  const chatId = msg.chat.id;
  const user = db.getUser(chatId);
  if (!user.verified) {
    return safeSend(chatId, `❌ *AKSES DITOLAK*\n\nLo belum verified.\n\n1. /buy\n2. /qr\n3. Kirim bukti ke ${CONFIG.ADMIN_USERNAME}`, mainKeyboard());
  }
  userState[chatId] = { step: 'awaiting_file', started: moment().format() };
  await safeSend(chatId, `📤 *UPLOAD FILE*\n\nKirim file HTML lo sekarang.\nFormat: .html .htm .zip .css .js\nMax: 50MB`, uploadKeyboard);
}

bot.onText(/\/host_30hari/, (msg) => handleHost30Hari(msg).catch(e => log('ERR', e.message)));

bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const state = userState[chatId];
  if (!state || state.step !== 'awaiting_file') return;
  const user = db.getUser(chatId);
  if (!user.verified) return;
  const doc = msg.document;
  const allowed = ['.html', '.htm', '.zip', '.css', '.js'];
  const ext = path.extname(doc.file_name || '').toLowerCase();
  if (!allowed.includes(ext)) return safeSend(chatId, `❌ Format *${ext}* gak didukung.`);
  if (doc.file_size > CONFIG.MAX_FILE_SIZE) return safeSend(chatId, '❌ Max 50MB.');

  await safeSend(chatId, `⏳ Download dari Telegram...`);

  try {
    const fileInfo = await bot.getFile(doc.file_id);
    const fileLink = `https://api.telegram.org/file/bot${CONFIG.BOT_TOKEN}/${fileInfo.file_path}`;
    const hostId = 'HZ' + uuidv4().slice(0, 6).toUpperCase();
    const userDir = path.join(CONFIG.UPLOAD_DIR, String(chatId), hostId);
    fs.ensureDirSync(userDir);
    const filePath = path.join(userDir, doc.file_name);

    const response = await axios({ url: fileLink, method: 'GET', responseType: 'stream', timeout: 60000, maxContentLength: CONFIG.MAX_FILE_SIZE, maxBodyLength: CONFIG.MAX_FILE_SIZE });
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    await new Promise((res, rej) => { writer.on('finish', res); writer.on('error', rej); });

    log('UPLOAD', `${doc.file_name} - ${fs.statSync(filePath).size} bytes`);

    db.data.hosts[hostId] = {
      hostId, userId: String(chatId), label: 'Auto Deploy EdgeOne', price: 5000, days: 30,
      file: doc.file_name, filePath, created: moment().format(),
      expires: moment().add(30, 'days').format(), active: true,
      edgeoneUrl: null
    };
    user.hosts = user.hosts || [];
    user.hosts.push(hostId);
    db.data.stats.totalOrders++;
    db.data.stats.totalRevenue += 5000;
    db.save();
    userState[chatId] = null;

    if (CONFIG.EDGEONE_AUTO_DEPLOY && ext === '.html') {
      await safeSend(chatId, `🚀 *Deploy ke EdgeOne...*\n\n30-60 detik. Sabar ya.`);
      try {
        const edgeoneUrl = await deployToEdgeOne(filePath);
        db.data.hosts[hostId].edgeoneUrl = edgeoneUrl;
        db.save();
        log('EDGEONE_SUCCESS', edgeoneUrl);

        await safeSend(chatId, `✅ *BERHASIL DEPLOY!*

📦 \`${doc.file_name}\`
🆔 \`${hostId}\`
🌐 *LINK PUBLIK:*
${edgeoneUrl}

📅 Expired: ${moment().add(30, 'days').format('DD/MM/YYYY')}`, {
          reply_markup: { inline_keyboard: [
            [{ text: '🌐 Buka Website', url: edgeoneUrl }],
            [{ text: '🏠 Menu', callback_data: 'menu_back' }]
          ]}
        });
      } catch (e) {
        log('EDGEONE_FAIL', e.message);
        const localUrl = `${CONFIG.BASE_URL}/host/${hostId}`;
        await safeSend(chatId, `⚠️ *EdgeOne gagal:*

\`${e.message}\`

*Fallback lokal:*
${localUrl}

Coba manual: ${CONFIG.EDGEONE_URL}`);
      }
    } else {
      const localUrl = `${CONFIG.BASE_URL}/host/${hostId}`;
      await safeSend(chatId, `✅ *BERHASIL!*

📦 \`${doc.file_name}\`
🆔 \`${hostId}\`
🔗 ${localUrl}`, {
        reply_markup: { inline_keyboard: [
          [{ text: '🌐 Buka', url: localUrl }],
          [{ text: '🏠 Menu', callback_data: 'menu_back' }]
        ]}
      });
    }
  } catch (e) {
    log('ERR', `Upload: ${e.message}`);
    await safeSend(chatId, `❌ Gagal: ${e.message}`);
  }
});

// ═══ EXPRESS ═══
app.get('/', (req, res) => {
  res.json({ status: 'online', service: 'HOZOO SHOP', edgeone_auto: CONFIG.EDGEONE_AUTO_DEPLOY, chromium: !!CHROMIUM_PATH });
});

app.get('/host/:hostId', (req, res) => {
  const host = db.getHost(req.params.hostId);
  if (!host) return res.status(404).send('<h1>404</h1>');
  if (moment().isAfter(moment(host.expires))) return res.status(410).send('<h1>410 Expired</h1>');
  if (host.filePath && fs.existsSync(host.filePath)) return res.sendFile(path.resolve(host.filePath));
  res.status(404).send('File gak ada.');
});

app.listen(CONFIG.PORT, '0.0.0.0', () => {
  log('SERVER', `Port ${CONFIG.PORT} @ 0.0.0.0`);
  log('BOT', `HOZOO SHOP started`);
  log('OWNER', `Owner ID: ${CONFIG.OWNER_ID}`);
  log('CHROMIUM', CHROMIUM_PATH || '❌ GAK KETEMU');
  log('BASE_URL', CONFIG.BASE_URL);
});

process.on('uncaughtException', (e) => log('CRASH', e.message));
process.on('unhandledRejection', (e) => log('REJECT', e?.message || e));
bot.on('polling_error', (e) => log('POLL', e.message));
