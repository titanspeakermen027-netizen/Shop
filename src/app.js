const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const store = require("./db");
const ui = require("./ui");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

store.db.exec(`
CREATE TABLE IF NOT EXISTS marketplace_channels (
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, channel_id)
);
CREATE INDEX IF NOT EXISTS idx_marketplace_channels ON marketplace_channels(guild_id);
`);

const reportCooldowns = new Map();
const actionCooldowns = new Map();

function admin(interaction) {
  return !!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}
function staff(interaction, settings) {
  return admin(interaction) || (!!settings.staff_role_id && interaction.member?.roles?.cache?.has(settings.staff_role_id));
}
function sellerAllowed(interaction, settings) {
  return admin(interaction) || (!!settings.seller_role_id && interaction.member?.roles?.cache?.has(settings.seller_role_id));
}
function mentionText(settings) {
  if (settings.marketplace_mention_type === "everyone") return "@everyone";
  if (settings.marketplace_mention_type === "here") return "@here";
  if (settings.marketplace_mention_type === "roles") return settings.marketplace_mention_roles.map(id => `<@&${id}>`).join(" ");
  return "";
}
function allowedMentions(settings) {
  if (settings.marketplace_mention_type === "everyone" || settings.marketplace_mention_type === "here") return { parse: ["everyone"] };
  if (settings.marketplace_mention_type === "roles") return { roles: settings.marketplace_mention_roles };
  return { parse: [] };
}
function sanitize(text) {
  return String(text || "")
    .replace(/<@&\d+>|<@!?\d+>|@everyone|@here/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
function normalizeText(text, max) {
  const cleaned = sanitize(text);
  return cleaned.length > max ? cleaned.slice(0, max - 1) + "…" : cleaned;
}
function channelList(guildId) {
  return store.db.prepare("SELECT channel_id FROM marketplace_channels WHERE guild_id = ? ORDER BY created_at").all(guildId).map(r => r.channel_id);
}
function isMarketplace(guildId, channelId) {
  return channelList(guildId).includes(channelId);
}
function setMarketplaceChannel(guildId, channelId, add) {
  if (add) {
    store.db.prepare("INSERT OR IGNORE INTO marketplace_channels (guild_id,channel_id,created_at) VALUES (?,?,?)").run(guildId, channelId, new Date().toISOString());
  } else {
    store.db.prepare("DELETE FROM marketplace_channels WHERE guild_id = ? AND channel_id = ?").run(guildId, channelId);
  }
}

function commandDefinitions() {
  return [
    { name: "shop", description: "إرسال لوحة الطلبات" },
    { name: "setup-shop", description: "إرسال لوحة الطلبات" },
    {
      name: "marketplace", description: "إدارة Marketplace", options: [
        { type: 1, name: "channel-add", description: "إضافة قناة Marketplace", options: [{ type: 7, name: "channel", description: "القناة", required: true }] },
        { type: 1, name: "channel-remove", description: "إزالة قناة Marketplace", options: [{ type: 7, name: "channel", description: "القناة", required: true }] },
        { type: 1, name: "channel-list", description: "عرض قنوات Marketplace" },
        { type: 1, name: "mention", description: "إعداد المنشن", options: [
          { type: 3, name: "type", description: "نوع المنشن", required: true, choices: [
            { name: "بدون منشن", value: "none" }, { name: "رتبة", value: "role" }, { name: "@here", value: "here" }, { name: "@everyone", value: "everyone" }
          ] },
          { type: 8, name: "role", description: "الرتبة", required: false },
        ] },
        { type: 1, name: "mention-show", description: "عرض إعداد المنشن" },
      ]
    },
    {
      name: "settings", description: "إعدادات Shop", options: [
        ...["shop-channel","orders-category","staff-role","work-threads-channel","reports-channel","offers-channel","seller-role","verified-seller-role"].map((name) => ({ type: 1, name, description: `إعداد ${name}`, options: [{ type: ["staff-role","seller-role","verified-seller-role"].includes(name) ? 8 : name === "orders-category" ? 7 : 7, name: name === "orders-category" ? "category" : ["staff-role","seller-role","verified-seller-role"].includes(name) ? "role" : "channel", description: "الاختيار", required: true }] })),
        { type: 1, name: "show", description: "عرض الإعدادات" },
      ]
    },
    {
      name: "seller", description: "إدارة البائعين", options: [
        { type: 1, name: "profile", description: "عرض ملف البائع", options: [{ type: 6, name: "user", description: "البائع", required: false }] },
        { type: 1, name: "verify", description: "توثيق بائع", options: [{ type: 6, name: "user", description: "البائع", required: true }] },
        { type: 1, name: "unverify", description: "إلغاء توثيق بائع", options: [{ type: 6, name: "user", description: "البائع", required: true }] },
      ]
    },
    {
      name: "offer", description: "إدارة العروض", options: [
        { type: 1, name: "create", description: "إنشاء عرض", options: [
          { type: 3, name: "title", description: "العنوان", required: true },
          { type: 3, name: "description", description: "الوصف", required: true },
          { type: 3, name: "price", description: "السعر", required: true },
          { type: 3, name: "category", description: "التصنيف", required: true, choices: Object.entries(ui.CATEGORY_NAMES).map(([value, name]) => ({ name, value })) },
          { type: 3, name: "image", description: "رابط صورة", required: false },
        ] },
        { type: 1, name: "setup", description: "تحديد قناة العروض" },
      ]
    },
  ];
}

async function safeReply(interaction, payload) {
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload).catch(() => {});
  return interaction.reply(payload).catch(() => {});
}

async function createOrderFromOffer(interaction, offer) {
  const settings = store.settings(interaction.guild.id);
  if (store.hasOpenOrder(interaction.guild.id, interaction.user.id)) return safeReply(interaction, { content: "❌ عندك طلب مفتوح بالفعل. كملو أو سدو قبل تفتح واحد جديد.", ephemeral: true });
  const channel = await interaction.guild.channels.create({
    name: `order-${offer.public_id}`,
    type: ChannelType.GuildText,
    parent: settings.orders_category_id || null,
    topic: `Order #${offer.public_id} • Offer #${offer.public_id} • Buyer ${interaction.user.id} • Seller ${offer.seller_id}`,
    permissionOverwrites: [
      { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: offer.seller_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ],
  }).catch(() => null);
  if (!channel) return safeReply(interaction, { content: "❌ ما قدرتش ننشئ غرفة الطلب. راجع صلاحيات البوت والقسم.", ephemeral: true });
  if (settings.staff_role_id) await channel.permissionOverwrites.edit(settings.staff_role_id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
  const order = store.createOrder({ guildId: interaction.guild.id, channelId: channel.id, buyerId: interaction.user.id, sellerId: offer.seller_id, offerId: offer.id, orderType: offer.category });
  const embed = ui.orderControls ? new (require("discord.js").EmbedBuilder)() : null;
  const { EmbedBuilder } = require("discord.js");
  await channel.send({
    content: `<@${interaction.user.id}> <@${offer.seller_id}>`,
    embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`🛒 Order #${order.public_id}`).setDescription([
      `👤 العميل: <@${order.buyer_id}>`,
      `🏪 البائع: <@${order.seller_id}>`,
      `🛍️ العرض: **Offer #${offer.public_id}**`,
      `📂 النوع: **${ui.TYPE_NAMES[order.order_type] || order.order_type}**`,
      "",
      "تم إنشاء الطلب. خلي التواصل كامل هنا باش يبقى عند المتجر سجل واضح.",
      "",
      "📌 الحالة: **pending**",
    ].join("\n")).setTimestamp()],
    components: [ui.orderControls(channel.id)],
    allowedMentions: { users: [interaction.user.id, offer.seller_id] },
  });
  await interaction.user.send(`🛒 تفتح ليك الطلب **#${order.public_id}** فـ ${interaction.guild.name}: ${channel}`).catch(() => {});
  await interaction.reply({ content: `✅ تفتح الطلب بنجاح: ${channel}`, ephemeral: true });
}

async function publishMarketplaceMessage(message) {
  const settings = store.settings(message.guild.id);
  if (!sellerAllowed({ memberPermissions: { has: () => false }, member: message.member }, settings)) return;
  const content = normalizeText(message.content, 1800);
  const attachments = [...message.attachments.values()];
  if (!content && !attachments.length) return message.delete().catch(() => {});
  const webhookList = await message.channel.fetchWebhooks().catch(() => null);
  if (!webhookList) return;
  let webhook = webhookList.find(w => w.owner?.id === client.user.id && w.name === "Shop Marketplace");
  if (!webhook) webhook = await message.channel.createWebhook({ name: "Shop Marketplace", reason: "Shop marketplace relay" }).catch(() => null);
  if (!webhook) return;
  const publicId = store.nextPublicId(message.guild.id, "offer_counter");
  const title = normalizeText(content.split("\n")[0] || "عرض جديد", 100);
  const description = normalizeText(content || "عرض بدون وصف", 1000);
  const payload = {
    content: [mentionText(settings), content].filter(Boolean).join("\n") || "🛍️ عرض جديد",
    username: message.member?.displayName || message.author.username,
    avatarURL: message.author.displayAvatarURL({ extension: "png", size: 256 }),
    files: attachments.map(a => ({ attachment: a.url, name: a.name || "attachment" })),
    components: [ui.offerButtons(publicId, message.author.id)],
    allowedMentions: allowedMentions(settings),
  };
  const sent = await webhook.send(payload).catch(() => null);
  if (!sent) return;
  store.createOffer({ guildId: message.guild.id, publicId, sellerId: message.author.id, channelId: message.channel.id, messageId: sent.id, title, description, price: "يحدد مع البائع", category: "product", source: "marketplace" });
  await message.delete().catch(() => {});
}

async function handleCommand(interaction) {
  const guildId = interaction.guild.id;
  const settings = store.settings(guildId);

  if (interaction.commandName === "shop" || interaction.commandName === "setup-shop") return interaction.reply(ui.shopPanel());

  if (interaction.commandName === "marketplace") {
    if (!admin(interaction)) return safeReply(interaction, { content: "❌ هذا الأمر للإدارة فقط.", ephemeral: true });
    const sub = interaction.options.getSubcommand();
    if (sub === "channel-add" || sub === "channel-remove") {
      const channel = interaction.options.getChannel("channel");
      if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) return safeReply(interaction, { content: "❌ اختار قناة نصية صالحة.", ephemeral: true });
      setMarketplaceChannel(guildId, channel.id, sub === "channel-add");
      return safeReply(interaction, { content: sub === "channel-add" ? `✅ تزادت ${channel} للـMarketplace.` : `✅ تحيدات ${channel} من الـMarketplace.`, ephemeral: true });
    }
    if (sub === "channel-list") {
      const ids = channelList(guildId);
      return safeReply(interaction, { content: ids.length ? `🛍️ **قنوات Marketplace:**\n${ids.map(id => `<#${id}>`).join("\n")}` : "❌ ما كايناش قنوات Marketplace.", ephemeral: true });
    }
    if (sub === "mention") {
      const type = interaction.options.getString("type");
      const role = interaction.options.getRole("role");
      if (type === "role" && !role) return safeReply(interaction, { content: "❌ خاصك تختار الرتبة.", ephemeral: true });
      store.setMarketplaceMentions(guildId, type === "role" ? "roles" : type, role ? [role.id] : []);
      return safeReply(interaction, { content: `✅ تسجل إعداد المنشن: **${role ? role : `@${type}`}**`, ephemeral: true });
    }
    const m = store.settings(guildId);
    return safeReply(interaction, { content: `📣 المنشن الحالي: **${m.marketplace_mention_type === "roles" ? m.marketplace_mention_roles.map(id => `<@&${id}>`).join(", ") : `@${m.marketplace_mention_type}`}**`, ephemeral: true });
  }

  if (interaction.commandName === "settings") {
    if (!admin(interaction)) return safeReply(interaction, { content: "❌ هذا الأمر للإدارة فقط.", ephemeral: true });
    const sub = interaction.options.getSubcommand();
    if (sub === "show") {
      const s = store.settings(guildId);
      return safeReply(interaction, { content: [
        "⚙️ **Shop Settings**",
        `🛒 Shop: ${s.shop_channel_id ? `<#${s.shop_channel_id}>` : "غير محدد"}`,
        `📁 Orders Category: ${s.orders_category_id ? `<#${s.orders_category_id}>` : "غير محدد"}`,
        `🛡️ Staff: ${s.staff_role_id ? `<@&${s.staff_role_id}>` : "غير محدد"}`,
        `🧵 Work Threads: ${s.work_threads_channel_id ? `<#${s.work_threads_channel_id}>` : "غير محدد"}`,
        `🚨 Reports: ${s.reports_channel_id ? `<#${s.reports_channel_id}>` : "غير محدد"}`,
        `🛍️ Offers: ${s.offers_channel_id ? `<#${s.offers_channel_id}>` : "غير محدد"}`,
        `👤 Seller: ${s.seller_role_id ? `<@&${s.seller_role_id}>` : "غير محدد"}`,
        `✅ Verified Seller: ${s.verified_seller_role_id ? `<@&${s.verified_seller_role_id}>` : "غير محدد"}`,
      ].join("\n"), ephemeral: true });
    }
    const maps = {
      "shop-channel": ["shop_channel_id", "channel"],
      "orders-category": ["orders_category_id", "category"],
      "staff-role": ["staff_role_id", "role"],
      "work-threads-channel": ["work_threads_channel_id", "channel"],
      "reports-channel": ["reports_channel_id", "channel"],
      "offers-channel": ["offers_channel_id", "channel"],
      "seller-role": ["seller_role_id", "role"],
      "verified-seller-role": ["verified_seller_role_id", "role"],
    };
    const [field, option] = maps[sub] || [];
    const target = field ? interaction.options.get(option, true) : null;
    if (!field || !target) return safeReply(interaction, { content: "❌ إعداد غير صالح.", ephemeral: true });
    store.setSetting(guildId, field, target.id);
    return safeReply(interaction, { content: `✅ تحفّظ الإعداد **${sub}** بنجاح.`, ephemeral: true });
  }

  if (interaction.commandName === "seller") {
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser("user") || interaction.user;
    if ((sub === "verify" || sub === "unverify") && !admin(interaction)) return safeReply(interaction, { content: "❌ التوثيق للإدارة فقط.", ephemeral: true });
    const data = store.seller(guildId, target.id);
    if (sub === "verify" || sub === "unverify") {
      const verified = sub === "verify";
      store.setSellerVerified(guildId, target.id, verified);
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (member && settings.verified_seller_role_id) {
        if (verified) await member.roles.add(settings.verified_seller_role_id).catch(() => {});
        else await member.roles.remove(settings.verified_seller_role_id).catch(() => {});
      }
      return safeReply(interaction, { content: verified ? `✅ توثّق ${target}.` : `✅ تحيد التوثيق من ${target}.`, ephemeral: true });
    }
    return safeReply(interaction, { embeds: [ui.sellerProfile(target, data, store.sellerRating(guildId, target.id))], ephemeral: false });
  }

  if (interaction.commandName === "offer") {
    const sub = interaction.options.getSubcommand();
    if (sub === "setup") {
      if (!admin(interaction)) return safeReply(interaction, { content: "❌ هذا الأمر للإدارة فقط.", ephemeral: true });
      store.setSetting(guildId, "offers_channel_id", interaction.channel.id);
      return safeReply(interaction, { content: `✅ تحددت ${interaction.channel} كقناة العروض.`, ephemeral: true });
    }
    if (sub === "create") {
      if (!sellerAllowed(interaction, settings)) return safeReply(interaction, { content: "❌ خاصك تكون Seller باش تنشئ عرض.", ephemeral: true });
      if (settings.offers_channel_id && settings.offers_channel_id !== interaction.channel.id) return safeReply(interaction, { content: `❌ خاصك تستعمل قناة العروض المحددة: <#${settings.offers_channel_id}>`, ephemeral: true });
      const title = normalizeText(interaction.options.getString("title"), 100);
      const description = normalizeText(interaction.options.getString("description"), 1000);
      const price = normalizeText(interaction.options.getString("price"), 100);
      const category = interaction.options.getString("category");
      const imageUrl = interaction.options.getString("image");
      if (!title || !description || !price) return safeReply(interaction, { content: "❌ بيانات العرض ناقصة.", ephemeral: true });
      if (imageUrl && !/^https?:\/\/\S+$/i.test(imageUrl)) return safeReply(interaction, { content: "❌ رابط الصورة غير صالح.", ephemeral: true });
      const publicId = store.nextPublicId(guildId, "offer_counter");
      const sent = await interaction.reply({
        embeds: [ui.offerEmbed({ publicId, title, description, price, category, seller: interaction.user, imageUrl })],
        components: [ui.offerButtons(publicId, interaction.user.id)],
        fetchReply: true,
      });
      store.createOffer({ guildId, publicId, sellerId: interaction.user.id, channelId: interaction.channel.id, messageId: sent.id, title, description, price, category, imageUrl, source: "command" });
      return;
    }
  }
}

async function handleInteraction(interaction) {
  if (!interaction.guild) return;
  const settings = store.settings(interaction.guild.id);

  if (interaction.isChatInputCommand()) return handleCommand(interaction);

  if (interaction.isStringSelectMenu() && interaction.customId === "shop_order_type") {
    if (store.hasOpenOrder(interaction.guild.id, interaction.user.id)) return safeReply(interaction, { content: "❌ عندك طلب مفتوح بالفعل.", ephemeral: true });
    const type = interaction.values[0];
    const channel = await interaction.guild.channels.create({
      name: `order-new`, type: ChannelType.GuildText, parent: settings.orders_category_id || null,
      permissionOverwrites: [
        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ...(settings.staff_role_id ? [{ id: settings.staff_role_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] : []),
      ],
    }).catch(() => null);
    if (!channel) return safeReply(interaction, { content: "❌ تعذر إنشاء الطلب. راجع صلاحيات البوت.", ephemeral: true });
    const order = store.createOrder({ guildId: interaction.guild.id, channelId: channel.id, buyerId: interaction.user.id, orderType: type });
    await channel.setName(`order-${order.public_id}`).catch(() => {});
    const { EmbedBuilder } = require("discord.js");
    await channel.send({ content: `<@${interaction.user.id}>`, embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`🛒 Order #${order.public_id}`).setDescription([`👤 العميل: <@${order.buyer_id}>`,`📂 النوع: **${ui.TYPE_NAMES[type]}**`,"","كتب تفاصيل الطلب ديالك هنا، وفريق المتجر غادي يتابع معاك.","","📌 الحالة: **pending**"].join("\n")).setTimestamp()], components: [ui.orderControls(channel.id)], allowedMentions: { users: [interaction.user.id] } });
    return safeReply(interaction, { content: `✅ تفتح الطلب ديالك: ${channel}`, ephemeral: true });
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("report_reason_")) {
    const [, , offerId, sellerId] = interaction.customId.split("_");
    const reasonKey = interaction.values[0];
    if (reasonKey === "other") return interaction.showModal(ui.reportDetailsModal(offerId, sellerId));
    const last = reportCooldowns.get(`${interaction.guild.id}:${interaction.user.id}`) || 0;
    if (Date.now() - last < settings.report_cooldown_seconds * 1000) return safeReply(interaction, { content: "❌ صبّر شوية قبل ما ترسل بلاغ آخر.", ephemeral: true });
    const offer = store.getOffer(interaction.guild.id, offerId);
    if (!offer) return safeReply(interaction, { content: "❌ العرض ما بقاش موجود.", ephemeral: true });
    if (!settings.reports_channel_id) return safeReply(interaction, { content: "❌ الإدارة ما عيّنتش قناة البلاغات.", ephemeral: true });
    reportCooldowns.set(`${interaction.guild.id}:${interaction.user.id}`, Date.now());
    const report = store.createReport({ guildId: interaction.guild.id, offerId: offer.id, reporterId: interaction.user.id, sellerId: sellerId || offer.seller_id, reasonKey, reasonText: ui.REPORT_REASONS[reasonKey], details: null });
    const reportChannel = interaction.guild.channels.cache.get(settings.reports_channel_id);
    if (!reportChannel?.isTextBased()) return safeReply(interaction, { content: "❌ قناة البلاغات غير صالحة.", ephemeral: true });
    const msg = await reportChannel.send({ embeds: [ui.reportEmbed(report, offer)], components: [ui.reportActions(report.public_id)] }).catch(() => null);
    if (!msg) return safeReply(interaction, { content: "❌ فشل إرسال البلاغ للإدارة.", ephemeral: true });
    return safeReply(interaction, { content: `✅ تسجل البلاغ **#${report.public_id}**.`, ephemeral: true });
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("report_modal_")) {
    const [, , offerId, sellerId] = interaction.customId.split("_");
    const details = normalizeText(interaction.fields.getTextInputValue("details"), 1000);
    const offer = store.getOffer(interaction.guild.id, offerId);
    if (!offer) return safeReply(interaction, { content: "❌ العرض ما بقاش موجود.", ephemeral: true });
    if (!settings.reports_channel_id) return safeReply(interaction, { content: "❌ الإدارة ما عيّنتش قناة البلاغات.", ephemeral: true });
    const report = store.createReport({ guildId: interaction.guild.id, offerId: offer.id, reporterId: interaction.user.id, sellerId: sellerId || offer.seller_id, reasonKey: "other", reasonText: ui.REPORT_REASONS.other, details });
    const channel = interaction.guild.channels.cache.get(settings.reports_channel_id);
    if (!channel?.isTextBased()) return safeReply(interaction, { content: "❌ قناة البلاغات غير صالحة.", ephemeral: true });
    await channel.send({ embeds: [ui.reportEmbed(report, offer)], components: [ui.reportActions(report.public_id)] }).catch(() => {});
    return safeReply(interaction, { content: `✅ تسجل البلاغ **#${report.public_id}**.`, ephemeral: true });
  }

  if (interaction.isButton()) {
    const id = interaction.customId;

    if (id.startsWith("offer_order_")) {
      const [, , publicId] = id.split("_");
      const offer = store.getOffer(interaction.guild.id, publicId);
      if (!offer || offer.status !== "active") return safeReply(interaction, { content: "❌ هاد العرض ما بقاش متاح.", ephemeral: true });
      return createOrderFromOffer(interaction, offer);
    }

    if (id.startsWith("offer_report_")) {
      const [, , offerId, sellerId] = id.split("_");
      return safeReply(interaction, { content: "🚨 اختار سبب البلاغ:", components: [ui.reportMenu(offerId, sellerId)], ephemeral: true });
    }

    if (id.startsWith("offer_actions_")) {
      if (!admin(interaction)) return safeReply(interaction, { content: "❌ هاد الإجراءات للإدارة فقط.", ephemeral: true });
      const [, , publicId, sellerId] = id.split("_");
      const cdKey = `${interaction.guild.id}:${interaction.user.id}:offer:${publicId}`;
      const last = actionCooldowns.get(cdKey) || 0;
      if (Date.now() - last < settings.offer_action_cooldown_seconds * 1000) return safeReply(interaction, { content: "❌ صبّر شوية قبل إجراء آخر على نفس العرض.", ephemeral: true });
      actionCooldowns.set(cdKey, Date.now());
      return safeReply(interaction, { content: `⚙️ إجراءات **Offer #${publicId}**`, components: [new (require("discord.js").ActionRowBuilder)().addComponents(
        new (require("discord.js").ButtonBuilder)().setCustomId(`offer_delete_${publicId}`).setLabel("حذف العرض").setStyle(require("discord.js").ButtonStyle.Danger),
        new (require("discord.js").ButtonBuilder)().setCustomId(`seller_profile_${sellerId}`).setLabel("ملف البائع").setStyle(require("discord.js").ButtonStyle.Secondary),
      )], ephemeral: true });
    }

    if (id.startsWith("offer_delete_")) {
      if (!admin(interaction)) return safeReply(interaction, { content: "❌ للإدارة فقط.", ephemeral: true });
      const publicId = id.split("_")[2];
      const offer = store.getOffer(interaction.guild.id, publicId);
      if (!offer) return safeReply(interaction, { content: "❌ العرض غير موجود.", ephemeral: true });
      const msg = await interaction.channel.messages.fetch(offer.message_id).catch(() => null);
      if (msg) await msg.delete().catch(() => {});
      store.updateOffer(interaction.guild.id, publicId, { status: "deleted" });
      return safeReply(interaction, { content: `✅ تحذف العرض **#${publicId}**.`, ephemeral: true });
    }

    if (id.startsWith("seller_profile_")) {
      const sellerId = id.split("_")[2];
      const user = await interaction.client.users.fetch(sellerId).catch(() => null);
      if (!user) return safeReply(interaction, { content: "❌ البائع غير موجود.", ephemeral: true });
      const data = store.seller(interaction.guild.id, sellerId);
      return safeReply(interaction, { embeds: [ui.sellerProfile(user, data, store.sellerRating(interaction.guild.id, sellerId))], ephemeral: true });
    }

    if (id.startsWith("report_")) {
      if (!admin(interaction)) return safeReply(interaction, { content: "❌ معالجة البلاغات للإدارة فقط.", ephemeral: true });
      const [, action, publicId] = id.split("_");
      const report = store.getReport(interaction.guild.id, publicId);
      if (!report) return safeReply(interaction, { content: "❌ البلاغ غير موجود.", ephemeral: true });
      const offer = report.offer_id ? store.db.prepare("SELECT * FROM offers WHERE id = ?").get(report.offer_id) : null;
      if (action === "resolve" || action === "reject") {
        if (report.status !== "pending") return safeReply(interaction, { content: "❌ البلاغ تمت معالجته من قبل.", ephemeral: true });
        const status = action === "resolve" ? "resolved" : "rejected";
        const updated = store.updateReport(report.id, { status, moderator_id: interaction.user.id, resolved_at: new Date().toISOString() });
        return interaction.update({ embeds: [ui.reportEmbed(updated, offer)], components: [] });
      }
      if (action === "remove") {
        if (offer) {
          const ch = interaction.guild.channels.cache.get(offer.channel_id);
          const msg = ch ? await ch.messages.fetch(offer.message_id).catch(() => null) : null;
          if (msg) await msg.delete().catch(() => {});
          store.updateOffer(interaction.guild.id, offer.public_id, { status: "removed" });
        }
        const updated = store.updateReport(report.id, { status: "resolved", moderator_id: interaction.user.id, resolved_at: new Date().toISOString() });
        return interaction.update({ embeds: [ui.reportEmbed(updated, offer)], components: [] });
      }
      if (action === "warn") {
        const updated = store.updateReport(report.id, { status: "resolved", moderator_id: interaction.user.id, resolved_at: new Date().toISOString() });
        return interaction.update({ embeds: [ui.reportEmbed(updated, offer).setFooter({ text: `تم التعامل مع البلاغ والتحذير • ${interaction.user.tag}` })], components: [] });
      }
    }

    if (id.startsWith("order_work_")) {
      if (!staff(interaction, settings)) return safeReply(interaction, { content: "❌ استلام الطلب مخصص للستاف.", ephemeral: true });
      const channelId = id.split("_")[2];
      const order = store.getOrderByChannel(interaction.guild.id, channelId);
      if (!order) return safeReply(interaction, { content: "❌ الطلب غير موجود.", ephemeral: true });
      if (order.status === "completed" || order.status === "closed") return safeReply(interaction, { content: "❌ الطلب مسدود.", ephemeral: true });
      if (order.worker_id && order.worker_id !== interaction.user.id) return safeReply(interaction, { content: `❌ الطلب مستلم من <@${order.worker_id}>.`, ephemeral: true });
      let workThreadId = order.work_thread_id;
      if (!workThreadId && settings.work_threads_channel_id) {
        const hub = interaction.guild.channels.cache.get(settings.work_threads_channel_id);
        if (hub?.isTextBased()) {
          const seed = await hub.send(`🛠️ Order #${order.public_id} • ${interaction.user}`).catch(() => null);
          if (seed) {
            const thread = await seed.startThread({ name: `order-${order.public_id}-work`, autoArchiveDuration: 1440 }).catch(() => null);
            if (thread) { workThreadId = thread.id; await thread.members.add(interaction.user.id).catch(() => {}); await thread.send(`📦 Order #${order.public_id}\n👤 Client: <@${order.buyer_id}>\n🛠️ Staff: <@${interaction.user.id}>`); }
          }
        }
      }
      const updated = store.updateOrder(order.id, { status: "working", worker_id: interaction.user.id, work_thread_id: workThreadId || null, work_started_at: order.work_started_at || new Date().toISOString() });
      return interaction.update({ embeds: [require("discord.js").EmbedBuilder.from(interaction.message.embeds[0]).setDescription(`${interaction.message.embeds[0]?.description || ""}\n\n🛠️ **تم استلام الطلب من <@${interaction.user.id}>**`)], components: [ui.orderControls(channelId)] });
    }

    if (id.startsWith("order_complete_") || id.startsWith("order_close_")) {
      const channelId = id.split("_")[2];
      const order = store.getOrderByChannel(interaction.guild.id, channelId);
      if (!order) return safeReply(interaction, { content: "❌ الطلب غير موجود.", ephemeral: true });
      const isBuyer = order.buyer_id === interaction.user.id;
      const isSeller = order.seller_id === interaction.user.id;
      const isStaff = staff(interaction, settings);
      if (!isBuyer && !isSeller && !isStaff) return safeReply(interaction, { content: "❌ ما عندكش صلاحية على هاد الطلب.", ephemeral: true });
      if (id.startsWith("order_complete_")) {
        if (!isStaff && !isSeller) return safeReply(interaction, { content: "❌ إتمام الطلب مخصص للبائع أو الستاف.", ephemeral: true });
        if (order.status === "completed") return safeReply(interaction, { content: "❌ الطلب مكتمل من قبل.", ephemeral: true });
        const updated = store.updateOrder(order.id, { status: "completed", completed_at: new Date().toISOString() });
        if (order.seller_id) store.incrementSeller(interaction.guild.id, order.seller_id, "completed_orders", 1);
        return interaction.update({ embeds: [require("discord.js").EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x57f287).setDescription(`${interaction.message.embeds[0]?.description || ""}\n\n✅ **تم إتمام الطلب.**`)], components: order.seller_id ? [ui.reviewButton(order.id)] : [] });
      }
      const updated = store.updateOrder(order.id, { status: "closed", closed_at: new Date().toISOString() });
      await interaction.update({ embeds: [require("discord.js").EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x747f8d).setDescription(`${interaction.message.embeds[0]?.description || ""}\n\n🔒 **تم إغلاق الطلب.**`)], components: [] });
      setTimeout(() => interaction.channel?.delete().catch(() => {}), 5000);
      return updated;
    }

    if (id.startsWith("order_review_")) {
      const orderId = Number(id.split("_")[2]);
      const order = store.db.prepare("SELECT * FROM orders WHERE id = ? AND guild_id = ?").get(orderId, interaction.guild.id);
      if (!order || order.status !== "completed") return safeReply(interaction, { content: "❌ التقييم متاح من بعد إتمام الطلب.", ephemeral: true });
      if (order.buyer_id !== interaction.user.id) return safeReply(interaction, { content: "❌ غير العميل يقدر يقيم البائع.", ephemeral: true });
      if (store.hasReviewedOrder(interaction.guild.id, orderId, interaction.user.id)) return safeReply(interaction, { content: "❌ سبق ليك قيمتي هاد الطلب.", ephemeral: true });
      return interaction.showModal(ui.reviewModal(orderId));
    }
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("review_modal_")) {
    const orderId = Number(interaction.customId.split("_")[2]);
    const order = store.db.prepare("SELECT * FROM orders WHERE id = ? AND guild_id = ?").get(orderId, interaction.guild.id);
    if (!order || order.status !== "completed" || order.buyer_id !== interaction.user.id || !order.seller_id) return safeReply(interaction, { content: "❌ ما يمكنش تسجل هاد التقييم.", ephemeral: true });
    if (store.hasReviewedOrder(interaction.guild.id, orderId, interaction.user.id)) return safeReply(interaction, { content: "❌ سبق ليك قيمتي هاد الطلب.", ephemeral: true });
    const rating = Number(interaction.fields.getTextInputValue("rating"));
    const comment = normalizeText(interaction.fields.getTextInputValue("comment"), 500);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return safeReply(interaction, { content: "❌ التقييم خاصو يكون بين 1 و5.", ephemeral: true });
    store.addReview({ guildId: interaction.guild.id, sellerId: order.seller_id, reviewerId: interaction.user.id, orderId, rating, comment });
    return safeReply(interaction, { content: `✅ تسجل تقييمك **${rating}/5**. شكراً!`, ephemeral: true });
  }
}

async function registerAndStart() {
  await client.application.commands.set(commandDefinitions());
  client.on("interactionCreate", async interaction => {
    try { await handleInteraction(interaction); }
    catch (error) {
      console.error("[Shop] interaction error:", error);
      await safeReply(interaction, { content: "❌ وقع خطأ غير متوقع. جرّب من جديد.", ephemeral: true });
    }
  });
  client.on("messageCreate", async message => {
    if (message.author.bot || !message.guild || !isMarketplace(message.guild.id, message.channel.id)) return;
    try { await publishMarketplaceMessage(message); }
    catch (error) { console.error("[Shop] marketplace error:", error); }
  });
  client.once("ready", () => console.log(`[Shop] Logged in as ${client.user.tag}`));
  return client;
}

module.exports = { client, registerAndStart };
