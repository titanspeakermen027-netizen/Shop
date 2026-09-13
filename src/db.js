const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "shop.sqlite");
const LEGACY_CONFIG = path.join(ROOT, "config", "config.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH, { timeout: 5000 });
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  shop_channel_id TEXT,
  orders_category_id TEXT,
  staff_role_id TEXT,
  offers_channel_id TEXT,
  reports_channel_id TEXT,
  work_threads_channel_id TEXT,
  seller_role_id TEXT,
  verified_seller_role_id TEXT,
  marketplace_mention_type TEXT NOT NULL DEFAULT 'none',
  marketplace_mention_roles TEXT NOT NULL DEFAULT '[]',
  report_cooldown_seconds INTEGER NOT NULL DEFAULT 600,
  offer_action_cooldown_seconds INTEGER NOT NULL DEFAULT 5,
  order_counter INTEGER NOT NULL DEFAULT 0,
  offer_counter INTEGER NOT NULL DEFAULT 0,
  report_counter INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sellers (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  completed_orders INTEGER NOT NULL DEFAULT 0,
  offers_created INTEGER NOT NULL DEFAULT 0,
  total_reviews INTEGER NOT NULL DEFAULT 0,
  rating_sum INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  public_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  price TEXT NOT NULL,
  category TEXT NOT NULL,
  image_url TEXT,
  source TEXT NOT NULL DEFAULT 'marketplace',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (guild_id, public_id),
  UNIQUE (guild_id, message_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  public_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  seller_id TEXT,
  offer_id INTEGER,
  order_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  worker_id TEXT,
  work_thread_id TEXT,
  created_at TEXT NOT NULL,
  work_started_at TEXT,
  completed_at TEXT,
  closed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (guild_id, public_id),
  UNIQUE (guild_id, channel_id),
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  public_id TEXT NOT NULL,
  offer_id INTEGER,
  reporter_id TEXT NOT NULL,
  seller_id TEXT,
  reason_key TEXT NOT NULL,
  reason_text TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  moderator_id TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (guild_id, public_id),
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  order_id INTEGER NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (guild_id, order_id, reviewer_id),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_offers_guild_status ON offers(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_guild_status ON orders(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_reports_guild_status ON reports(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_reviews_seller ON reviews(guild_id, seller_id);
`);

function now() {
  return new Date().toISOString();
}

function jsonArray(value) {
  try { return JSON.parse(value || "[]"); } catch { return []; }
}

function legacyConfig() {
  try { return JSON.parse(fs.readFileSync(LEGACY_CONFIG, "utf8")); }
  catch { return {}; }
}

function defaultSettings(guildId) {
  const legacy = legacyConfig();
  const t = now();
  return {
    guild_id: guildId,
    shop_channel_id: legacy.shopChannelId || null,
    orders_category_id: legacy.ordersCategoryId || null,
    staff_role_id: legacy.staffRoleId || null,
    offers_channel_id: legacy.offersChannelId || null,
    reports_channel_id: legacy.reportsChannelId || null,
    work_threads_channel_id: legacy.orderWorkThreadsChannelId || null,
    seller_role_id: legacy.sellerRoleId || null,
    verified_seller_role_id: legacy.verifiedSellerRoleId || null,
    marketplace_mention_type: legacy.marketplaceMentions?.type || "none",
    marketplace_mention_roles: JSON.stringify(legacy.marketplaceMentions?.roleIds || []),
    report_cooldown_seconds: Number(legacy.reportCooldownMinutes || 10) * 60,
    offer_action_cooldown_seconds: Number(legacy.offerActionCooldownSeconds || 5),
    order_counter: 0,
    offer_counter: 0,
    report_counter: 0,
    created_at: t,
    updated_at: t
  };
}

function ensureGuild(guildId) {
  let row = db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?").get(guildId);
  if (row) return row;
  const d = defaultSettings(guildId);
  db.prepare(`INSERT INTO guild_settings
    (guild_id,shop_channel_id,orders_category_id,staff_role_id,offers_channel_id,reports_channel_id,work_threads_channel_id,seller_role_id,verified_seller_role_id,marketplace_mention_type,marketplace_mention_roles,report_cooldown_seconds,offer_action_cooldown_seconds,order_counter,offer_counter,report_counter,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      d.guild_id,d.shop_channel_id,d.orders_category_id,d.staff_role_id,d.offers_channel_id,d.reports_channel_id,d.work_threads_channel_id,d.seller_role_id,d.verified_seller_role_id,d.marketplace_mention_type,d.marketplace_mention_roles,d.report_cooldown_seconds,d.offer_action_cooldown_seconds,0,0,0,d.created_at,d.updated_at
    );
  return db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?").get(guildId);
}

function settings(guildId) {
  const r = ensureGuild(guildId);
  return { ...r, marketplace_mention_roles: jsonArray(r.marketplace_mention_roles) };
}

function setSetting(guildId, field, value) {
  const allowed = new Set([
    "shop_channel_id","orders_category_id","staff_role_id","offers_channel_id","reports_channel_id",
    "work_threads_channel_id","seller_role_id","verified_seller_role_id","marketplace_mention_type",
    "report_cooldown_seconds","offer_action_cooldown_seconds"
  ]);
  if (!allowed.has(field)) throw new Error(`Invalid setting: ${field}`);
  ensureGuild(guildId);
  db.prepare(`UPDATE guild_settings SET ${field} = ?, updated_at = ? WHERE guild_id = ?`).run(value, now(), guildId);
}

function setMarketplaceMentions(guildId, type, roleIds = []) {
  ensureGuild(guildId);
  db.prepare("UPDATE guild_settings SET marketplace_mention_type = ?, marketplace_mention_roles = ?, updated_at = ? WHERE guild_id = ?")
    .run(type, JSON.stringify(roleIds), now(), guildId);
}

function nextPublicId(guildId, counter) {
  const row = db.prepare(`SELECT ${counter} AS n FROM guild_settings WHERE guild_id = ?`).get(guildId);
  const next = Number(row?.n || 0) + 1;
  db.prepare(`UPDATE guild_settings SET ${counter} = ?, updated_at = ? WHERE guild_id = ?`).run(next, now(), guildId);
  return String(next).padStart(3, "0");
}

function ensureSeller(guildId, userId) {
  const existing = db.prepare("SELECT * FROM sellers WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
  if (existing) return existing;
  const t = now();
  db.prepare("INSERT INTO sellers (guild_id,user_id,created_at,updated_at) VALUES (?,?,?,?)").run(guildId, userId, t, t);
  return db.prepare("SELECT * FROM sellers WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
}

function seller(guildId, userId) {
  return ensureSeller(guildId, userId);
}

function setSellerVerified(guildId, userId, verified) {
  ensureSeller(guildId, userId);
  db.prepare("UPDATE sellers SET verified = ?, updated_at = ? WHERE guild_id = ? AND user_id = ?").run(verified ? 1 : 0, now(), guildId, userId);
}

function incrementSeller(guildId, userId, field, amount = 1) {
  const allowed = new Set(["completed_orders","offers_created","total_reviews","rating_sum"]);
  if (!allowed.has(field)) throw new Error(`Invalid seller field: ${field}`);
  ensureSeller(guildId, userId);
  db.prepare(`UPDATE sellers SET ${field} = ${field} + ?, updated_at = ? WHERE guild_id = ? AND user_id = ?`).run(amount, now(), guildId, userId);
}

function sellerRating(guildId, userId) {
  const s = seller(guildId, userId);
  return s.total_reviews ? (s.rating_sum / s.total_reviews).toFixed(1) : null;
}

function createOffer(data) {
  const createdAt = now();
  const publicId = data.publicId || nextPublicId(data.guildId, "offer_counter");
  const result = db.prepare(`INSERT INTO offers
    (guild_id,public_id,seller_id,channel_id,message_id,title,description,price,category,image_url,source,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      data.guildId,publicId,data.sellerId,data.channelId,data.messageId,data.title,data.description,data.price,data.category,data.imageUrl || null,data.source || "marketplace","active",createdAt,createdAt
    );
  incrementSeller(data.guildId, data.sellerId, "offers_created", 1);
  return db.prepare("SELECT * FROM offers WHERE id = ?").get(result.lastInsertRowid);
}

function getOffer(guildId, publicId) {
  return db.prepare("SELECT * FROM offers WHERE guild_id = ? AND public_id = ?").get(guildId, publicId);
}
function getOfferByMessage(guildId, messageId) {
  return db.prepare("SELECT * FROM offers WHERE guild_id = ? AND message_id = ?").get(guildId, messageId);
}
function updateOffer(guildId, publicId, patch) {
  const allowed = ["title","description","price","category","image_url","status","message_id"];
  const pairs = Object.entries(patch).filter(([k]) => allowed.includes(k));
  if (!pairs.length) return getOffer(guildId, publicId);
  const sql = `UPDATE offers SET ${pairs.map(([k]) => `${k} = ?`).join(", ")}, updated_at = ? WHERE guild_id = ? AND public_id = ?`;
  db.prepare(sql).run(...pairs.map(([,v]) => v), now(), guildId, publicId);
  return getOffer(guildId, publicId);
}

function createOrder(data) {
  const createdAt = now();
  const publicId = data.publicId || nextPublicId(data.guildId, "order_counter");
  const result = db.prepare(`INSERT INTO orders
    (guild_id,public_id,channel_id,buyer_id,seller_id,offer_id,order_type,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(data.guildId,publicId,data.channelId,data.buyerId,data.sellerId || null,data.offerId || null,data.orderType || "product","pending",createdAt,createdAt);
  return db.prepare("SELECT * FROM orders WHERE id = ?").get(result.lastInsertRowid);
}

function getOrderByChannel(guildId, channelId) {
  return db.prepare("SELECT * FROM orders WHERE guild_id = ? AND channel_id = ?").get(guildId, channelId);
}
function getOrder(guildId, publicId) {
  return db.prepare("SELECT * FROM orders WHERE guild_id = ? AND public_id = ?").get(guildId, publicId);
}
function hasOpenOrder(guildId, buyerId) {
  return !!db.prepare("SELECT 1 FROM orders WHERE guild_id = ? AND buyer_id = ? AND status IN ('pending','working') LIMIT 1").get(guildId, buyerId);
}
function updateOrder(id, patch) {
  const allowed = ["status","seller_id","worker_id","work_thread_id","work_started_at","completed_at","closed_at"];
  const pairs = Object.entries(patch).filter(([k]) => allowed.includes(k));
  if (!pairs.length) return db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  const sql = `UPDATE orders SET ${pairs.map(([k]) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`;
  db.prepare(sql).run(...pairs.map(([,v]) => v), now(), id);
  return db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
}

function createReport(data) {
  const createdAt = now();
  const publicId = data.publicId || nextPublicId(data.guildId, "report_counter");
  const result = db.prepare(`INSERT INTO reports
    (guild_id,public_id,offer_id,reporter_id,seller_id,reason_key,reason_text,details,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(data.guildId,publicId,data.offerId || null,data.reporterId,data.sellerId || null,data.reasonKey,data.reasonText,data.details || null,"pending",createdAt,createdAt);
  return db.prepare("SELECT * FROM reports WHERE id = ?").get(result.lastInsertRowid);
}
function getReport(guildId, publicId) { return db.prepare("SELECT * FROM reports WHERE guild_id = ? AND public_id = ?").get(guildId, publicId); }
function updateReport(id, patch) {
  const allowed = ["status","moderator_id","resolved_at"];
  const pairs = Object.entries(patch).filter(([k]) => allowed.includes(k));
  if (!pairs.length) return db.prepare("SELECT * FROM reports WHERE id = ?").get(id);
  const sql = `UPDATE reports SET ${pairs.map(([k]) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`;
  db.prepare(sql).run(...pairs.map(([,v]) => v), now(), id);
  return db.prepare("SELECT * FROM reports WHERE id = ?").get(id);
}

function addReview({ guildId, sellerId, reviewerId, orderId, rating, comment }) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("Rating must be 1-5");
  const t = now();
  const result = db.prepare("INSERT INTO reviews (guild_id,seller_id,reviewer_id,order_id,rating,comment,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(guildId,sellerId,reviewerId,orderId,rating,comment || null,t);
  incrementSeller(guildId,sellerId,"total_reviews",1);
  incrementSeller(guildId,sellerId,"rating_sum",rating);
  return db.prepare("SELECT * FROM reviews WHERE id = ?").get(result.lastInsertRowid);
}
function hasReviewedOrder(guildId, orderId, reviewerId) {
  return !!db.prepare("SELECT 1 FROM reviews WHERE guild_id = ? AND order_id = ? AND reviewer_id = ?").get(guildId,orderId,reviewerId);
}

module.exports = {
  db,
  settings,
  setSetting,
  setMarketplaceMentions,
  nextPublicId,
  seller,
  ensureSeller,
  setSellerVerified,
  incrementSeller,
  sellerRating,
  createOffer,
  getOffer,
  getOfferByMessage,
  updateOffer,
  createOrder,
  getOrder,
  getOrderByChannel,
  hasOpenOrder,
  updateOrder,
  createReport,
  getReport,
  updateReport,
  addReview,
  hasReviewedOrder,
};
