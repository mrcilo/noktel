const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const token = process.env.TOKEN;
const bot = new TelegramBot(token, { polling: true });

const OWNER_ID = 123456789; // GANTI DENGAN ID TELEGRAM KAMU

let db = JSON.parse(fs.readFileSync('database.json'));

function saveDB() {
  fs.writeFileSync('database.json', JSON.stringify(db, null, 2));
}

function isBlocked(id) {
  return db.users[id]?.blocked === true;
}

let session = {};
let supportMode = {};
let ownerMode = {};

/* ================= START ================= */

bot.onText(/\/start/, (msg) => {
  const id = msg.from.id;
  if (isBlocked(id)) return;

  if (!db.users[id]) {
    db.users[id] = {
      name: msg.from.first_name,
      username: msg.from.username,
      joinDate: new Date().toLocaleDateString(),
      totalBuy: 0,
      blocked: false
    };
    saveDB();
  }

  const user = db.users[id];

  bot.sendMessage(id,
`👋 Selamat Datang di
NOKTEL OLD BOT

Nama: ${user.name}
Username: @${user.username || "-"}
Total Pembelian: ${user.totalBuy}
Tanggal Pakai Bot: ${user.joinDate}`,
{
  reply_markup: {
    keyboard: [["🛒 Beli Nomor", "🆘 Bantuan"]],
    resize_keyboard: true
  }
});
});

/* ================= MENU UTAMA ================= */

bot.on("message", (msg) => {
  const id = msg.from.id;
  if (!msg.text) return;
  if (isBlocked(id)) return;

/* ===== BANTUAN ===== */

if (msg.text === "🆘 Bantuan") {
  supportMode[id] = true;
  bot.sendMessage(id, "Silakan kirim pesan Anda ke admin.");
  return;
}

if (supportMode[id] && !msg.text.startsWith("/balas")) {
  bot.sendMessage(OWNER_ID,
`📩 PESAN BANTUAN - NOKTEL OLD BOT

Nama: ${db.users[id].name}
Username: @${db.users[id].username || "-"}
ID User: ${id}

Pesan:
${msg.text}

Balas:
/balas ${id} isi pesan`);

  bot.sendMessage(id, "Pesan sudah dikirim ke admin ✅");
  delete supportMode[id];
  return;
}

/* ===== BELI NOMOR ===== */

if (msg.text === "🛒 Beli Nomor") {

  const negaraList = [...new Set(db.numbers
    .filter(n => n.status === "available")
    .map(n => n.negara))];

  if (negaraList.length === 0) {
    bot.sendMessage(id, "Stok belum tersedia.");
    return;
  }

  session[id] = {};
  bot.sendMessage(id, "Pilih Negara:", {
    reply_markup: {
      keyboard: negaraList.map(n => [n]),
      resize_keyboard: true
    }
  });
  return;
}

if (session[id] && !session[id].negara) {
  session[id].negara = msg.text;
  bot.sendMessage(id, "Pilih Digit:", {
    reply_markup: {
      keyboard: [["8 Digit"], ["9 Digit"]],
      resize_keyboard: true
    }
  });
  return;
}

if (session[id] && !session[id].digit) {
  session[id].digit = msg.text.includes("8") ? 8 : 9;

  const list = db.numbers.filter(n =>
    n.negara === session[id].negara &&
    n.digit === session[id].digit &&
    n.status === "available"
  );

  if (list.length === 0) {
    bot.sendMessage(id, "Stok kosong.");
    delete session[id];
    return;
  }

  session[id].list = list;

  bot.sendMessage(id,
    list.map(n =>
      `${n.id} | ${n.tahun} | Rp ${n.harga}`
    ).join("\n")
  );
  return;
}

if (session[id] && session[id].list) {
  const selected = session[id].list.find(n => n.id === msg.text);
  if (!selected) return;

  session[id].selected = selected;

  bot.sendMessage(id,
`Konfirmasi Pembelian

ID: ${selected.id}
Tahun: ${selected.tahun}
Harga: Rp ${selected.harga}`,
{
  reply_markup: {
    inline_keyboard: [
      [{ text: "✅ Setuju", callback_data: "agree" }],
      [{ text: "❌ Batal", callback_data: "cancel" }]
    ]
  }
});
  return;
}

/* ===== OWNER TAMBAH NOMOR ===== */

if (ownerMode[id]?.step === "add_number") {
  const parts = msg.text.split("|");

  if (parts.length !== 6) {
    bot.sendMessage(id, "Format salah.\nContoh:\nID001|Indonesia|8|2021|50000|08123456789");
    return;
  }

  const [idn, negara, digit, tahun, harga, nomorReal] = parts;

  db.numbers.push({
    id: idn.trim(),
    negara: negara.trim(),
    digit: parseInt(digit),
    tahun: tahun.trim(),
    harga: parseInt(harga),
    nomorReal: nomorReal.trim(),
    status: "available"
  });

  saveDB();
  bot.sendMessage(id, "Nomor berhasil ditambahkan ✅");
  delete ownerMode[id];
}
});

/* ================= CALLBACK ================= */

bot.on("callback_query", (q) => {

  const id = q.from.id;

  if (q.data === "agree") {
    session[id].waitingProof = true;

    bot.sendPhoto(id, "qris.jpg", {
      caption: `Silakan bayar Rp ${session[id].selected.harga}
Kirim bukti pembayaran di sini.`
    });
  }

  if (q.data === "cancel") {
    delete session[id];
    bot.sendMessage(id, "Pembelian dibatalkan.");
  }

  if (q.data.startsWith("accept_") && id === OWNER_ID) {
    const trxId = q.data.split("_")[1];
    const trx = db.transactions[trxId];

    const userId = trx.userId;

    db.users[userId].totalBuy += 1;
    trx.numberData.status = "sold";

    saveDB();

    bot.sendMessage(userId,
`✅ Pembelian Anda Diterima

Nomor Anda:
${trx.numberData.nomorReal}`);

    delete db.transactions[trxId];
    saveDB();
  }

  if (q.data.startsWith("reject_") && id === OWNER_ID) {
    const trxId = q.data.split("_")[1];
    const trx = db.transactions[trxId];

    db.users[trx.userId].blocked = true;
    saveDB();

    bot.sendMessage(trx.userId,
`❌ Pembelian Ditolak.
Akses Anda Diblokir Permanen.`);

    delete db.transactions[trxId];
    saveDB();
  }

  bot.answerCallbackQuery(q.id);
});

/* ================= OWNER COMMAND ================= */

bot.onText(/\/ownerpanel/, (msg) => {
  if (msg.from.id !== OWNER_ID) return;

  bot.sendMessage(OWNER_ID,
`🔐 OWNER PANEL - NOKTEL OLD BOT

Pilih:
➕ Tambah Nomor
📦 Lihat Stok`,
{
  reply_markup: {
    keyboard: [["➕ Tambah Nomor"], ["📦 Lihat Stok"]],
    resize_keyboard: true
  }
});
});

bot.onText(/➕ Tambah Nomor/, (msg) => {
  if (msg.from.id !== OWNER_ID) return;

  ownerMode[msg.from.id] = { step: "add_number" };

  bot.sendMessage(msg.from.id,
`Kirim dengan format:

ID001|Indonesia|8|2021|50000|08123456789`);
});

bot.onText(/📦 Lihat Stok/, (msg) => {
  if (msg.from.id !== OWNER_ID) return;

  if (db.numbers.length === 0) {
    bot.sendMessage(OWNER_ID, "Stok kosong.");
    return;
  }

  const list = db.numbers.map(n =>
`${n.id} | ${n.negara} | ${n.digit}D | ${n.tahun} | Rp ${n.harga} | ${n.status}`
  ).join("\n");

  bot.sendMessage(OWNER_ID, list);
});

bot.onText(/\/balas (.+) (.+)/, (msg, match) => {
  if (msg.from.id !== OWNER_ID) return;

  bot.sendMessage(match[1],
`📩 Balasan Admin - NOKTEL OLD BOT

${match[2]}`);
});

/* ================= BUKTI BAYAR ================= */

bot.on("photo", (msg) => {
  const id = msg.from.id;
  if (!session[id]?.waitingProof) return;

  bot.sendMessage(id, "Pembayaran sedang diproses...");

  const trxId = Date.now();

  db.transactions[trxId] = {
    userId: id,
    numberData: session[id].selected
  };

  saveDB();

  bot.sendPhoto(OWNER_ID, msg.photo[msg.photo.length - 1].file_id, {
    caption:
`🛒 Permintaan Pembelian

Nama: ${db.users[id].name}
Username: @${db.users[id].username || "-"}
ID User: ${id}

ID: ${session[id].selected.id}
Harga: Rp ${session[id].selected.harga}`,
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Terima", callback_data: "accept_" + trxId }],
        [{ text: "❌ Tolak", callback_data: "reject_" + trxId }]
      ]
    }
  });

  delete session[id];
});
