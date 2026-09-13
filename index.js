require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const configPath = path.join(__dirname, "config", "config.json");

function loadConfig() {
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function saveConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}


function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(file, data) {
  const fullPath = path.join(__dirname, file);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), "utf8");
}

function getSellerData(userId) {
  const sellers = loadJson("data/sellers.json", {});
  if (!sellers[userId]) {
    sellers[userId] = {
      userId,
      verified: false,
      completedOrders: 0,
      totalReviews: 0,
      ratingSum: 0,
      offersCreated: 0
    };
    saveJson("data/sellers.json", sellers);
  }
  return sellers[userId];
}

function getSellerRating(data) {
  if (!data.totalReviews) return "لا توجد تقييمات";
  return (data.ratingSum / data.totalReviews).toFixed(1) + " / 5";
}

function buildSellerProfileEmbed(user, data) {
  return new EmbedBuilder()
    .setColor(data.verified ? 0x57f287 : 0xff7b4d)
    .setTitle(`👤 Seller Profile • ${user.username}`)
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: "🛡️ الحالة", value: data.verified ? "✅ Verified Seller" : "⏳ Seller", inline: true },
      { name: "⭐ التقييم", value: getSellerRating(data), inline: true },
      { name: "📦 الطلبات المكتملة", value: String(data.completedOrders), inline: true },
      { name: "🛍️ العروض المنشورة", value: String(data.offersCreated), inline: true },
      { name: "📝 عدد التقييمات", value: String(data.totalReviews), inline: true }
    )
    .setFooter({ text: "Shop Marketplace • Seller System" })
    .setTimestamp();
}

function buildSellerActions(sellerId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`seller_review_${sellerId}`)
      .setLabel("تقييم البائع")
      .setEmoji("⭐")
      .setStyle(ButtonStyle.Primary)
  );
}

function buildReviewModal(sellerId) {
  const modal = new ModalBuilder()
    .setCustomId(`seller_review_modal_${sellerId}`)
    .setTitle("⭐ تقييم البائع");

  const rating = new TextInputBuilder()
    .setCustomId("rating")
    .setLabel("التقييم من 1 إلى 5")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(1)
    .setPlaceholder("مثال: 5");

  const comment = new TextInputBuilder()
    .setCustomId("comment")
    .setLabel("تعليقك")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder().addComponents(rating),
    new ActionRowBuilder().addComponents(comment)
  );

  return modal;
}


function isMarketplaceChannel(channelId) {
  const config = loadConfig();
  return Array.isArray(config.marketplaceChannelIds) &&
    config.marketplaceChannelIds.includes(channelId);
}

function hybridFrancoEncode(text) {
  const replacements = {
    "ح": ["7"],
    "ت": ["T"],
    "ش": ["ch", "sh"],
    "ك": ["K"]
  };

  let output = "";
  for (const char of text) {
    if (!replacements[char]) {
      output += char;
      continue;
    }
    const variants = replacements[char];
    output += variants[Math.floor(Math.random() * variants.length)];
  }
  return output;
}

async function getUserBannerUrl(user) {
  try {
    const fetched = await user.fetch();
    return fetched.bannerURL({ extension: "png", size: 1024 }) || null;
  } catch {
    return null;
  }
}

async function getOrCreateMarketplaceWebhook(channel) {
  const webhooks = await channel.fetchWebhooks();
  let webhook = webhooks.find(
    wh => wh.owner?.id === channel.client.user.id &&
      wh.name === "Marketplace Webhook"
  );

  if (!webhook) {
    webhook = await channel.createWebhook({
      name: "Marketplace Webhook",
      reason: "Marketplace message relay"
    });
  }

  return webhook;
}

const categoryNames = {
  product: "🛒 منتج",
  design: "🎨 تصميم",
  programming: "💻 برمجة"
};

const offerTypeNames = {
  product: "طلب منتج",
  design: "طلب تصميم",
  programming: "طلب خدمة برمجية"
};

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const commands = [
    {
      name: "shop",
      description: "إرسال لوحة فتح الطلبات"
    },
    {
      name: "setup-shop",
      description: "إرسال لوحة فتح الطلبات"
    },
    {
      name: "marketplace",
      description: "إدارة قنوات البيع",
      options: [
        {
          type: 1,
          name: "channel-add",
          description: "إضافة قناة للبيع",
          options: [{
            type: 7,
            name: "channel",
            description: "القناة",
            required: true
          }]
        },
        {
          type: 1,
          name: "channel-remove",
          description: "إزالة قناة من قنوات البيع",
          options: [{
            type: 7,
            name: "channel",
            description: "القناة",
            required: true
          }]
        },
        {
          type: 1,
          name: "channel-list",
          description: "عرض قنوات البيع"
        }
,
        {
          type: 1,
          name: "mention",
          description: "إعداد المنشن التلقائي",
          options: [
            { type: 3, name: "type", description: "نوع المنشن", required: true, choices: [
              { name: "بدون منشن", value: "none" }, { name: "رتبة", value: "role" }, { name: "@here", value: "here" }, { name: "@everyone", value: "everyone" }
            ] },
            { type: 8, name: "role", description: "الرتبة عند اختيار رتبة", required: false }
          ]
        },
        { type: 1, name: "mention-show", description: "عرض إعداد المنشن" }
      ]
    },
    {
      name: "settings",
      description: "إعدادات ShopBot",
      options: [
        { type: 1, name: "shop-channel", description: "تحديد قناة لوحة الطلبات", options: [{ type: 7, name: "channel", description: "القناة", required: true }] },
        { type: 1, name: "orders-category", description: "تحديد Category الطلبات", options: [{ type: 7, name: "category", description: "التصنيف", required: true }] },
        { type: 1, name: "staff-role", description: "تحديد رتبة الستاف", options: [{ type: 8, name: "role", description: "الرتبة", required: true }] },
        { type: 1, name: "work-threads-channel", description: "تحديد روم Work Threads", options: [{ type: 7, name: "channel", description: "القناة", required: true }] },
        { type: 1, name: "reports-channel", description: "تحديد روم البلاغات", options: [{ type: 7, name: "channel", description: "القناة", required: true }] },
        { type: 1, name: "offers-channel", description: "تحديد روم العروض", options: [{ type: 7, name: "channel", description: "القناة", required: true }] },
        { type: 1, name: "seller-role", description: "تحديد رتبة البائع", options: [{ type: 8, name: "role", description: "الرتبة", required: true }] },
        { type: 1, name: "verified-seller-role", description: "تحديد رتبة البائع الموثق", options: [{ type: 8, name: "role", description: "الرتبة", required: true }] },
        { type: 1, name: "show", description: "عرض الإعدادات الحالية" }
      ]
    },
    {
      name: "seller",
      description: "عرض معلومات البائع",
      options: [
        {
          type: 1,
          name: "profile",
          description: "عرض ملف بائع",
          options: [
            {
              type: 6,
              name: "user",
              description: "البائع",
              required: false
            }
          ]
        },
        {
          type: 1,
          name: "verify",
          description: "توثيق بائع",
          options: [
            {
              type: 6,
              name: "user",
              description: "البائع",
              required: true
            }
          ]
        },
        {
          type: 1,
          name: "unverify",
          description: "إلغاء توثيق بائع",
          options: [
            {
              type: 6,
              name: "user",
              description: "البائع",
              required: true
            }
          ]
        }
      ]
    },
    {
      name: "report",
      description: "إدارة نظام البلاغات",
      options: [
        {
          type: 1,
          name: "setup",
          description: "تحديد قناة البلاغات"
        }
      ]
    },
    {
      name: "offer",
      description: "إدارة نظام العروض",
      options: [
        {
          type: 1,
          name: "create",
          description: "إنشاء عرض جديد",
          options: [
            {
              type: 3,
              name: "title",
              description: "عنوان العرض",
              required: true
            },
            {
              type: 3,
              name: "description",
              description: "وصف العرض",
              required: true
            },
            {
              type: 3,
              name: "price",
              description: "السعر",
              required: true
            },
            {
              type: 3,
              name: "category",
              description: "تصنيف العرض",
              required: true,
              choices: [
                { name: "🛒 منتج", value: "product" },
                { name: "🎨 تصميم", value: "design" },
                { name: "💻 برمجة", value: "programming" }
              ]
            },
            {
              type: 3,
              name: "image",
              description: "رابط صورة اختياري",
              required: false
            }
          ]
        },
        {
          type: 1,
          name: "setup",
          description: "تحديد قناة العروض"
        }
      ]
    }
  ];

  try {
    await client.application.commands.set(commands);
    console.log("✅ Slash commands registered");
  } catch (error) {
    console.error("❌ Command registration error:", error);
  }
});

function buildShopEmbed() {
  return new EmbedBuilder()
    .setColor(0xff7b4d)
    .setTitle("🛒 طلب منتج")
    .setDescription(
      [
        "مرحباً بك في نظام الطلبات 🛍️",
        "",
        "قبل فتح الطلب، تأكد من قراءة القوانين والالتزام بها.",
        "",
        "اضغط على القائمة بالأسفل لاختيار نوع الطلب الخاص بك."
      ].join("\n")
    )
    .setFooter({ text: "Shop Marketplace • Phase 2" });
}

function buildOrderTypeMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("shop_order_type")
      .setPlaceholder("اختر نوع الطلب")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("طلب منتج")
          .setDescription("فتح طلب لشراء منتج")
          .setEmoji("🛒")
          .setValue("product"),
        new StringSelectMenuOptionBuilder()
          .setLabel("طلب تصميم")
          .setDescription("فتح طلب لخدمة تصميم")
          .setEmoji("🎨")
          .setValue("design"),
        new StringSelectMenuOptionBuilder()
          .setLabel("طلب خدمة برمجية")
          .setDescription("فتح طلب لخدمة برمجية")
          .setEmoji("💻")
          .setValue("programming")
      )
  );
}

function buildOfferEmbed({ title, description, price, category, seller, image, offerId }) {
  const embed = new EmbedBuilder()
    .setColor(0xff7b4d)
    .setTitle(`${categoryNames[category]} • ${title}`)
    .setDescription(description)
    .addFields(
      { name: "💰 السعر", value: String(price), inline: true },
      { name: "📂 التصنيف", value: categoryNames[category], inline: true },
      { name: "👤 البائع", value: `${seller}`, inline: true }
    )
    .setFooter({ text: `Offer #${offerId} • Shop Marketplace` })
    .setTimestamp();

  if (image && /^https?:\/\/\S+/i.test(image)) {
    embed.setImage(image);
  }

  return embed;
}


function buildOfferActionsMenu(offerId, messageId = "", sellerId = "") {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`offer_action_menu_${offerId}_${messageId}_${sellerId}`)
      .setPlaceholder("اختر إجراء الإدارة")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("تعديل العرض")
          .setDescription("تعديل بيانات العرض")
          .setEmoji("✏️")
          .setValue("edit"),
        new StringSelectMenuOptionBuilder()
          .setLabel("حذف العرض")
          .setDescription("حذف رسالة العرض")
          .setEmoji("🗑️")
          .setValue("delete"),
        new StringSelectMenuOptionBuilder()
          .setLabel("تثبيت العرض")
          .setDescription("تثبيت العرض في القناة")
          .setEmoji("📌")
          .setValue("pin"),
        new StringSelectMenuOptionBuilder()
          .setLabel("إلغاء تثبيت العرض")
          .setDescription("إلغاء تثبيت العرض")
          .setEmoji("📍")
          .setValue("unpin"),
        new StringSelectMenuOptionBuilder()
          .setLabel("عرض معلومات البائع")
          .setDescription("عرض معلومات صاحب العرض")
          .setEmoji("👤")
          .setValue("seller")
      )
  );
}

function buildOfferEditModal(offerId) {
  const modal = new ModalBuilder()
    .setCustomId(`offer_edit_modal_${offerId}`)
    .setTitle(`✏️ تعديل العرض #${offerId}`);

  const title = new TextInputBuilder()
    .setCustomId("edit_title")
    .setLabel("العنوان الجديد")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const description = new TextInputBuilder()
    .setCustomId("edit_description")
    .setLabel("الوصف الجديد")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  const price = new TextInputBuilder()
    .setCustomId("edit_price")
    .setLabel("السعر الجديد")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  modal.addComponents(
    new ActionRowBuilder().addComponents(title),
    new ActionRowBuilder().addComponents(description),
    new ActionRowBuilder().addComponents(price)
  );

  return modal;
}

function buildOfferButtons(offerId, sellerId = "") {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`offer_order_${offerId}_${sellerId}`).setLabel("Order").setEmoji("🛒").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`offer_report_${offerId}_${sellerId}`).setLabel("Report").setEmoji("❗").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`offer_actions_${offerId}_${sellerId}`).setLabel("Actions").setEmoji("⚙️").setStyle(ButtonStyle.Secondary)
  );
}


const reportReasons = {
  scam: "🚫 نصب / احتيال",
  fake_product: "📦 منتج وهمي أو غير موجود",
  misleading_price: "💰 سعر مضلل",
  stolen_content: "📄 سرقة محتوى أو عرض شخص آخر",
  prohibited: "🔞 محتوى ممنوع",
  rules: "⚠️ مخالفة قوانين المتجر",
  other: "📝 سبب آخر"
};

function buildReportMenu(offerId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`report_reason_${offerId}`)
      .setPlaceholder("اختر سبب البلاغ")
      .addOptions(
        Object.entries(reportReasons).map(([value, label]) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(label.replace(/^[^ ]+ /, ""))
            .setDescription(`الإبلاغ بسبب: ${label}`)
            .setValue(value)
        )
      )
  );
}

function buildReportActions(reportId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`report_resolve_${reportId}`)
      .setLabel("حل البلاغ")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`report_reject_${reportId}`)
      .setLabel("رفض البلاغ")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`report_delete_${reportId}`)
      .setLabel("حذف العرض")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`report_warn_${reportId}`)
      .setLabel("تحذير البائع")
      .setEmoji("⚠️")
      .setStyle(ButtonStyle.Primary)
  );
}

function buildReportEmbed({ reportId, offerId, reporter, seller, reason, details, status = "🟡 Pending" }) {
  return new EmbedBuilder()
    .setColor(status.includes("Resolved") ? 0x57f287 : status.includes("Rejected") ? 0xed4245 : 0xfee75c)
    .setTitle(`🚨 Report #${reportId}`)
    .addFields(
      { name: "📌 الحالة", value: status, inline: true },
      { name: "🛍️ العرض", value: `Offer #${offerId}`, inline: true },
      { name: "👤 المبلّغ", value: `${reporter}`, inline: true },
      { name: "🏪 صاحب العرض", value: `${seller}`, inline: true },
      { name: "🚨 السبب", value: reason, inline: false },
      { name: "📝 التفاصيل", value: details || "لا توجد تفاصيل إضافية.", inline: false }
    )
    .setTimestamp();
}


function getOrderData() {
  return loadJson("data/orders.json", {});
}

function saveOrderData(data) {
  saveJson("data/orders.json", data);
}

function hasOpenOrderForBuyer(guildId, buyerId) {
  return Object.values(getOrderData()).some(o => o.guildId === guildId && o.buyerId === buyerId && ["pending", "working"].includes(o.status));
}

function sanitizeMarketplaceContent(content) {
  return (content || "").replace(/<@&?\d+>|<@!?\d+>|@everyone|@here/g, "").replace(/\s{2,}/g, " ").trim();
}

function extractUserIdFromMention(value) {
  return value?.match(/<@!?(\d+)>/)?.[1] || null;
}

async function createOrderFromOffer(interaction, offerId, sellerIdFromButton = null) {
  const config = loadConfig();

  if (hasOpenOrderForBuyer(interaction.guild.id, interaction.user.id)) {
    return interaction.reply({ content: "❌ لديك طلب مفتوح بالفعل.", ephemeral: true });
  }

  const offerMessage = interaction.message;
  const sellerField = offerMessage.embeds[0]?.fields?.find(
    field => field.name === "👤 البائع"
  );

  const sellerId = sellerIdFromButton || extractUserIdFromMention(sellerField?.value);

  if (!sellerId) {
    return interaction.reply({
      content: "❌ تعذر العثور على صاحب العرض.",
      ephemeral: true
    });
  }

  const seller = await interaction.client.users.fetch(sellerId).catch(() => null);

  if (!seller) {
    return interaction.reply({
      content: "❌ تعذر العثور على حساب البائع.",
      ephemeral: true
    });
  }

  config.orderCounter += 1;
  saveConfig(config);

  const orderNumber = String(config.orderCounter).padStart(3, "0");
  const orders = getOrderData();

  const channel = await interaction.guild.channels.create({
    name: `order-${orderNumber}`,
    type: ChannelType.GuildText,
    parent: config.ordersCategoryId || null,
    topic: `Order #${orderNumber} • Offer #${offerId} • Buyer ${interaction.user.tag} • Seller ${seller.tag}`,
    permissionOverwrites: [
      {
        id: interaction.guild.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      },
      {
        id: seller.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      }
    ]
  });

  if (config.staffRoleId) {
    await channel.permissionOverwrites.edit(config.staffRoleId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true
    });
  }

  orders[channel.id] = {
    channelId: channel.id,
    guildId: interaction.guild.id,
    orderNumber,
    offerId,
    buyerId: interaction.user.id,
    sellerId: seller.id,
    status: "pending",
    createdAt: new Date().toISOString()
  };
  saveOrderData(orders);

  const orderEmbed = new EmbedBuilder()
    .setColor(0xff7b4d)
    .setTitle(`🛒 Order #${orderNumber}`)
    .setDescription(
      [
        `👤 العميل: ${interaction.user}`,
        `🏪 البائع: ${seller}`,
        `🛍️ العرض: **Offer #${offerId}**`,
        "",
        "تم إنشاء الطلب من العرض.",
        "يمكن للعميل والبائع التواصل هنا.",
        "",
        "📌 الحالة: **قيد الانتظار**"
      ].join("\n")
    )
    .setTimestamp();

  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`order_complete_${channel.id}`)
      .setLabel("إتمام الطلب")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`order_close_${channel.id}`)
      .setLabel("إغلاق الطلب")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: `${interaction.user} ${seller}`,
    embeds: [orderEmbed],
    components: [controls]
  });

  await seller.send(
    `🛒 تم إنشاء طلب جديد لك في سيرفر **${interaction.guild.name}** من العرض **Offer #${offerId}**.\nالطلب: ${channel}`
  ).catch(() => {});

  return interaction.reply({
    content: `✅ تم إنشاء الطلب وإضافة البائع تلقائياً: ${channel}`,
    ephemeral: true
  });
}

client.on("messageCreate", async message => {
  try {
    if (message.author.bot || !message.guild) return;
    if (!isMarketplaceChannel(message.channel.id)) return;
    if (!message.content && message.attachments.size === 0) return;

    const config = loadConfig();
    config.offerCounter = Number(config.offerCounter || 0) + 1;
    const offerId = String(config.offerCounter).padStart(3, "0");
    saveConfig(config);

    const sellerData = getSellerData(message.author.id);
    sellerData.offersCreated += 1;
    const sellers = loadJson("data/sellers.json", {});
    sellers[message.author.id] = sellerData;
    saveJson("data/sellers.json", sellers);

    const webhook = await getOrCreateMarketplaceWebhook(message.channel);

    // Keep the user's text in Arabic/Hybrid Franco, while attachments are
    // uploaded as native Discord files (not converted into embeds).
    const content = hybridFrancoEncode(sanitizeMarketplaceContent(message.content || ""));
    const files = [...message.attachments.values()].map((attachment, index) => ({
      attachment: attachment.url,
      name: attachment.name || `attachment-${index + 1}`
    }));

    const mentionConfig = config.marketplaceMentions || { type: "none", roleIds: [] };
    const mentionText = mentionConfig.type === "everyone" ? "@everyone" : mentionConfig.type === "here" ? "@here" : mentionConfig.type === "roles" ? (mentionConfig.roleIds || []).map(id => `<@&${id}>`).join(" ") : "";
    const sentOffer = await webhook.send({
      content: [mentionText, content].filter(Boolean).join("\n") || undefined,
      username: message.member?.displayName || message.author.username,
      avatarURL: message.author.displayAvatarURL({
        extension: "png",
        size: 256
      }),
      files,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`offer_order_${offerId}_${message.author.id}`)
            .setLabel("Order")
            .setEmoji("🛒")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`offer_report_${offerId}_${message.author.id}`)
            .setLabel("Report")
            .setEmoji("❗")
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`offer_actions_${offerId}_${message.author.id}`)
            .setLabel("Actions")
            .setEmoji("⚙️")
            .setStyle(ButtonStyle.Secondary)
        )
      ],
      allowedMentions: mentionConfig.type === "everyone" ? { parse: ["everyone"] } : mentionConfig.type === "here" ? { parse: ["everyone"] } : mentionConfig.type === "roles" ? { roles: mentionConfig.roleIds || [] } : { parse: [] }
    });

    const offers = loadJson("data/offers.json", {});
    offers[offerId] = { offerId, sellerId: message.author.id, channelId: message.channel.id, messageId: sentOffer.id, content: message.content || "", status: "active", createdAt: new Date().toISOString() };
    saveJson("data/offers.json", offers);

    await message.delete().catch(() => {});
  } catch (error) {
    console.error("❌ Marketplace message error:", error);
  }
});


// Create one private staff work thread when a staff member starts working in an order.
client.on("messageCreate", async message => {
  try {
    if (message.author.bot || !message.guild) return;
    const orders = getOrderData();
    const order = orders[message.channel.id];
    if (!order || order.workThreadId) return;
    const config = loadConfig();
    if (!config.orderWorkThreadsChannelId || !config.staffRoleId) return;
    if (!message.member.roles.cache.has(config.staffRoleId)) return;
    const hub = message.guild.channels.cache.get(config.orderWorkThreadsChannelId);
    if (!hub || hub.type !== ChannelType.GuildText) return;
    const seed = await hub.send(`🛠️ Work started by ${message.author} • Order #${order.orderNumber}`);
    const thread = await seed.startThread({ name: `order-${order.orderNumber}-work`, autoArchiveDuration: 1440, type: ChannelType.PrivateThread });
    await thread.members.add(message.author.id).catch(() => {});
    await thread.send(`📦 **Order #${order.orderNumber}**
👤 Client: <@${order.buyerId}>
🔗 Order channel: ${message.channel}
🛠️ العامل: ${message.author}`);
    order.workThreadId = thread.id; order.workerId = message.author.id; order.status = "working"; order.workStartedAt = new Date().toISOString();
    saveOrderData(orders);
  } catch (error) { console.error("❌ Order work thread error:", error); }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "marketplace") {
      if (
        !interaction.memberPermissions ||
        !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)
      ) {
        return interaction.reply({
          content: "❌ هذا الأمر مخصص للإدارة فقط.",
          ephemeral: true
        });
      }

      const config = loadConfig();

      if (!Array.isArray(config.marketplaceChannelIds)) {
        config.marketplaceChannelIds = [];
      }

      const subcommand = interaction.options.getSubcommand();

      if (subcommand === "channel-add") {
        const channel = interaction.options.getChannel("channel");

        if (!channel || channel.type !== ChannelType.GuildText) {
          return interaction.reply({
            content: "❌ خاصك تختار قناة نصية صالحة.",
            ephemeral: true
          });
        }

        if (!config.marketplaceChannelIds.includes(channel.id)) {
          config.marketplaceChannelIds.push(channel.id);
          saveConfig(config);
        }

        return interaction.reply({
          content: `✅ تمت إضافة ${channel} إلى قنوات Marketplace.`,
          ephemeral: true
        });
      }

      if (subcommand === "channel-remove") {
        const channel = interaction.options.getChannel("channel");

        if (!channel) {
          return interaction.reply({
            content: "❌ خاصك تختار القناة.",
            ephemeral: true
          });
        }

        config.marketplaceChannelIds =
          config.marketplaceChannelIds.filter(id => id !== channel.id);

        saveConfig(config);

        return interaction.reply({
          content: `✅ تمت إزالة ${channel} من قنوات Marketplace.`,
          ephemeral: true
        });
      }

      if (subcommand === "channel-list") {
        const channels = config.marketplaceChannelIds
          .map(id => `<#${id}>`)
          .join("\n");

        return interaction.reply({
          content: channels
            ? `🛍️ **قنوات Marketplace:**\n${channels}`
            : "❌ لا توجد أي قنوات Marketplace حالياً.",
          ephemeral: true
        });
      }

      if (subcommand === "mention") {
        const type = interaction.options.getString("type");
        const role = interaction.options.getRole("role");
        if (type === "role" && !role) return interaction.reply({ content: "❌ خاصك تختار رتبة.", ephemeral: true });
        config.marketplaceMentions = { type: type === "role" ? "roles" : type, roleIds: type === "role" ? [role.id] : [] };
        saveConfig(config);
        return interaction.reply({ content: `✅ تم حفظ إعداد المنشن: **${type === "role" ? role.name : type}**`, ephemeral: true });
      }
      if (subcommand === "mention-show") {
        const m = config.marketplaceMentions || { type: "none", roleIds: [] };
        const value = m.type === "roles" ? (m.roleIds || []).map(id => `<@&${id}>`).join(", ") : `@${m.type}`;
        return interaction.reply({ content: `📣 إعداد Marketplace الحالي: **${value || "بدون منشن"}**`, ephemeral: true });
      }

      return interaction.reply({
        content: "❌ أمر Marketplace غير معروف.",
        ephemeral: true
      });
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "settings") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ هذا الأمر مخصص للإدارة فقط.", ephemeral: true });
      const config = loadConfig();
      const sub = interaction.options.getSubcommand();
      const map = {
        "shop-channel": ["shopChannelId", "channel"], "orders-category": ["ordersCategoryId", "category"],
        "staff-role": ["staffRoleId", "role"], "work-threads-channel": ["orderWorkThreadsChannelId", "channel"],
        "reports-channel": ["reportsChannelId", "channel"], "offers-channel": ["offersChannelId", "channel"],
        "seller-role": ["sellerRoleId", "role"], "verified-seller-role": ["verifiedSellerRoleId", "role"]
      };
      if (sub === "show") {
        return interaction.reply({ content: `⚙️ **إعدادات ShopBot**
🛒 Shop: ${config.shopChannelId ? `<#${config.shopChannelId}>` : "غير محدد"}
📁 Orders Category: ${config.ordersCategoryId ? `<#${config.ordersCategoryId}>` : "غير محدد"}
🛡️ Staff: ${config.staffRoleId ? `<@&${config.staffRoleId}>` : "غير محدد"}
🧵 Work Threads: ${config.orderWorkThreadsChannelId ? `<#${config.orderWorkThreadsChannelId}>` : "غير محدد"}
🚨 Reports: ${config.reportsChannelId ? `<#${config.reportsChannelId}>` : "غير محدد"}
🛍️ Offers: ${config.offersChannelId ? `<#${config.offersChannelId}>` : "غير محدد"}`, ephemeral: true });
      }
      const entry = map[sub]; const target = entry && interaction.options.get(entry[1]);
      if (!entry || !target) return interaction.reply({ content: "❌ إعداد غير صالح.", ephemeral: true });
      config[entry[0]] = target.id; saveConfig(config);
      return interaction.reply({ content: `✅ تم حفظ الإعداد **${sub}** بنجاح: ${target}`, ephemeral: true });
    }

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "shop" || interaction.commandName === "setup-shop") {
        return interaction.reply({
          embeds: [buildShopEmbed()],
          components: [buildOrderTypeMenu()]
        });
      }

      if (interaction.commandName === "offer") {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === "setup") {
          if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
              content: "❌ هذا الأمر مخصص للإدارة فقط.",
              ephemeral: true
            });
          }

          const config = loadConfig();
          config.offersChannelId = interaction.channel.id;
          saveConfig(config);

          return interaction.reply({
            content: `✅ تم تحديد هذه القناة كقناة العروض: ${interaction.channel}`,
            ephemeral: true
          });
        }

        if (subcommand === "create") {
          const config = loadConfig();

          if (
            config.offersChannelId &&
            interaction.channel.id !== config.offersChannelId
          ) {
            return interaction.reply({
              content: `❌ يجب إنشاء العروض في قناة العروض المحددة فقط.`,
              ephemeral: true
            });
          }

          config.offerCounter += 1;
          const offerId = String(config.offerCounter).padStart(3, "0");
          saveConfig(config);

          const sellerData = getSellerData(interaction.user.id);
          sellerData.offersCreated += 1;
          const sellers = loadJson("data/sellers.json", {});
          sellers[interaction.user.id] = sellerData;
          saveJson("data/sellers.json", sellers);

          const offer = {
            title: interaction.options.getString("title"),
            description: interaction.options.getString("description"),
            price: interaction.options.getString("price"),
            category: interaction.options.getString("category"),
            image: interaction.options.getString("image"),
            seller: interaction.user
          };

          await interaction.reply({
            embeds: [
              buildOfferEmbed({
                ...offer,
                offerId
              })
            ],
            components: [buildOfferButtons(offerId)]
          });

          return;
        }
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("offer_action_menu_")) {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: "❌ هذا الإجراء مخصص للإدارة فقط.",
          ephemeral: true
        });
      }

      const actionParts = interaction.customId.split("_");
      const offerId = actionParts[3];
      const originalMessageId = actionParts[4];
      const sellerIdFromMenu = actionParts[5] || "";
      const action = interaction.values[0];

      const originalMessage = await interaction.channel.messages.fetch(originalMessageId).catch(() => null);

      if (!originalMessage) {
        return interaction.update({
          content: "❌ تعذر العثور على رسالة العرض الأصلية.",
          components: []
        });
      }

      if (action === "edit") {
        return interaction.showModal(buildOfferEditModal(offerId));
      }

      if (action === "delete") {
        await originalMessage.edit({
          content: `🗑️ تم حذف العرض **Offer #${offerId}** بواسطة ${interaction.user}.`,
          components: []
        }).catch(() => {});

        return interaction.update({
          content: "✅ تم حذف العرض.",
          components: []
        });
      }

      if (action === "pin") {
        await originalMessage.pin().catch(() => {});
        return interaction.update({
          content: "📌 تم تثبيت العرض.",
          components: []
        });
      }

      if (action === "unpin") {
        await originalMessage.unpin().catch(() => {});
        return interaction.update({
          content: "📍 تم إلغاء تثبيت العرض.",
          components: []
        });
      }

      if (action === "seller") {
        const sellerField = originalMessage.embeds[0]?.fields?.find(
          field => field.name === "👤 البائع"
        );

        const sellerId = sellerIdFromMenu || sellerField?.value?.match(/<@!?(\d+)>/)?.[1];

        if (!sellerId) {
          return interaction.update({
            content: "❌ تعذر العثور على معرف البائع.",
            components: []
          });
        }

        const seller = await interaction.client.users.fetch(sellerId).catch(() => null);

        if (!seller) {
          return interaction.update({
            content: "❌ تعذر العثور على البائع.",
            components: []
          });
        }

        const data = getSellerData(seller.id);

        return interaction.update({
          content: "",
          embeds: [buildSellerProfileEmbed(seller, data)],
          components: [buildSellerActions(seller.id)]
        });
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("report_reason_")) {
      const reportTarget = interaction.customId.replace("report_reason_", "");
      const [offerId, sellerId = "unknown"] = reportTarget.split("_");
      const reasonKey = interaction.values[0];
      const reason = reportReasons[reasonKey];

      if (reasonKey === "other") {
        const modal = new ModalBuilder()
          .setCustomId(`report_modal_${offerId}_${sellerId}`)
          .setTitle("📝 تفاصيل البلاغ");

        const detailsInput = new TextInputBuilder()
          .setCustomId("report_details")
          .setLabel("اشرح سبب البلاغ")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(5)
          .setMaxLength(1000)
          .setPlaceholder("اكتب التفاصيل هنا...");

        modal.addComponents(
          new ActionRowBuilder().addComponents(detailsInput)
        );

        return interaction.showModal(modal);
      }

      const config = loadConfig();

      if (!config.reportsChannelId) {
        return interaction.update({
          content: "❌ لم يتم إعداد قناة البلاغات بعد.",
          components: []
        });
      }

      config.reportCounter += 1;
      const reportId = String(config.reportCounter).padStart(3, "0");
      saveConfig(config);

      const reportChannel = interaction.guild.channels.cache.get(config.reportsChannelId);

      if (!reportChannel) {
        return interaction.update({
          content: "❌ قناة البلاغات غير موجودة.",
          components: []
        });
      }

      const reportEmbed = buildReportEmbed({
        reportId,
        offerId,
        reporter: interaction.user,
        seller: "غير معروف من رسالة العرض",
        reason,
        details: "تم الإبلاغ من خلال زر Report."
      });

      await reportChannel.send({
        embeds: [reportEmbed],
        components: [buildReportActions(reportId)]
      });

      return interaction.update({
        content: `✅ تم إرسال البلاغ بنجاح. رقم البلاغ: **REPORT-${reportId}**`,
        components: []
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "shop_order_type") {
      const typeNames = {
        product: "طلب منتج",
        design: "طلب تصميم",
        programming: "طلب خدمة برمجية"
      };

      const selectedType = interaction.values[0];
      const config = loadConfig();

      if (hasOpenOrderForBuyer(interaction.guild.id, interaction.user.id)) {
        return interaction.reply({ content: "❌ لديك طلب مفتوح بالفعل.", ephemeral: true });
      }

      config.orderCounter += 1;
      saveConfig(config);

      const orderNumber = String(config.orderCounter).padStart(3, "0");

      const channel = await interaction.guild.channels.create({
        name: `order-${orderNumber}`,
        type: ChannelType.GuildText,
        parent: config.ordersCategoryId || null,
        topic: `Order #${orderNumber} • ${typeNames[selectedType]} • ${interaction.user.tag}`,
        permissionOverwrites: [
          {
            id: interaction.guild.id,
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory
            ]
          }
        ]
      });

      if (config.staffRoleId) {
        await channel.permissionOverwrites.edit(config.staffRoleId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
      }

      const orders = getOrderData();
      orders[channel.id] = { channelId: channel.id, guildId: interaction.guild.id, orderNumber, offerId: null, buyerId: interaction.user.id, sellerId: null, type: selectedType, status: "pending", createdAt: new Date().toISOString() };
      saveOrderData(orders);

      const orderEmbed = new EmbedBuilder()
        .setColor(0xff7b4d)
        .setTitle(`🛒 Order #${orderNumber}`)
        .setDescription(
          [
            `👤 العميل: ${interaction.user}`,
            `📦 النوع: **${typeNames[selectedType]}**`,
            "",
            "اكتب تفاصيل طلبك هنا وسيتم الرد عليك من فريق المتجر.",
            "",
            "📌 الحالة: **قيد الانتظار**"
          ].join("\n")
        )
        .setTimestamp();

      const controls = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`order_close_${channel.id}`)
          .setLabel("إغلاق الطلب")
          .setEmoji("🔒")
          .setStyle(ButtonStyle.Danger)
      );

      await channel.send({
        content: `${interaction.user}`,
        embeds: [orderEmbed],
        components: [controls]
      });

      return interaction.reply({
        content: `✅ تم إنشاء طلبك بنجاح: ${channel}`,
        ephemeral: true
      });
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("offer_edit_modal_")) {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: "❌ هذا الإجراء مخصص للإدارة فقط.",
          ephemeral: true
        });
      }

      const offerId = interaction.customId.replace("offer_edit_modal_", "");
      const title = interaction.fields.getTextInputValue("edit_title");
      const description = interaction.fields.getTextInputValue("edit_description");
      const price = interaction.fields.getTextInputValue("edit_price");

      const message = interaction.channel.messages.cache.find(msg =>
        msg.embeds.some(embed =>
          embed.footer?.text?.includes(`Offer #${offerId}`)
        )
      );

      if (!message) {
        return interaction.reply({
          content: "❌ لم يتم العثور على رسالة العرض.",
          ephemeral: true
        });
      }

      const oldEmbed = message.embeds[0];
      const category = oldEmbed.fields?.find(f => f.name === "📂 التصنيف")?.value || "غير محدد";
      const seller = oldEmbed.fields?.find(f => f.name === "👤 البائع")?.value || "غير معروف";

      const updated = EmbedBuilder.from(oldEmbed)
        .setTitle(`${category} • ${title}`)
        .setDescription(description)
        .setFields(
          { name: "💰 السعر", value: price, inline: true },
          { name: "📂 التصنيف", value: category, inline: true },
          { name: "👤 البائع", value: seller, inline: true }
        )
        .setTimestamp();

      await message.edit({
        embeds: [updated],
        components: [buildOfferButtons(offerId)]
      });

      return interaction.reply({
        content: `✅ تم تعديل العرض **Offer #${offerId}** بنجاح.`,
        ephemeral: true
      });
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("seller_review_modal_")) {
      const sellerId = interaction.customId.replace("seller_review_modal_", "");
      const rating = Number(interaction.fields.getTextInputValue("rating"));
      const comment = interaction.fields.getTextInputValue("comment") || "بدون تعليق";

      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return interaction.reply({
          content: "❌ التقييم يجب أن يكون رقماً من 1 إلى 5.",
          ephemeral: true
        });
      }

      const reviews = loadJson("data/reviews.json", []);
      const alreadyReviewed = reviews.some(
        review => review.sellerId === sellerId && review.reviewerId === interaction.user.id
      );

      if (alreadyReviewed) {
        return interaction.reply({
          content: "❌ سبق لك تقييم هذا البائع.",
          ephemeral: true
        });
      }

      reviews.push({
        sellerId,
        reviewerId: interaction.user.id,
        rating,
        comment,
        createdAt: new Date().toISOString()
      });
      saveJson("data/reviews.json", reviews);

      const sellers = loadJson("data/sellers.json", {});
      const sellerData = getSellerData(sellerId);
      sellerData.totalReviews += 1;
      sellerData.ratingSum += rating;
      sellers[sellerId] = sellerData;
      saveJson("data/sellers.json", sellers);

      return interaction.reply({
        content: `✅ تم تسجيل تقييمك: **${rating}/5**`,
        ephemeral: true
      });
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("report_modal_")) {
      const reportTarget = interaction.customId.replace("report_modal_", "");
      const [offerId, sellerId = "unknown"] = reportTarget.split("_");
      const details = interaction.fields.getTextInputValue("report_details");
      const config = loadConfig();

      if (!config.reportsChannelId) {
        return interaction.reply({
          content: "❌ لم يتم إعداد قناة البلاغات بعد.",
          ephemeral: true
        });
      }

      config.reportCounter += 1;
      const reportId = String(config.reportCounter).padStart(3, "0");
      saveConfig(config);

      const reportChannel = interaction.guild.channels.cache.get(config.reportsChannelId);

      if (!reportChannel) {
        return interaction.reply({
          content: "❌ قناة البلاغات غير موجودة.",
          ephemeral: true
        });
      }

      await reportChannel.send({
        embeds: [
          buildReportEmbed({
            reportId,
            offerId,
            reporter: interaction.user,
            seller: sellerId !== "unknown" ? `<@${sellerId}>` : "غير معروف من رسالة العرض",
            reason: reportReasons.other,
            details
          })
        ],
        components: [buildReportActions(reportId)]
      });

      return interaction.reply({
        content: `✅ تم إرسال البلاغ بنجاح. رقم البلاغ: **REPORT-${reportId}**`,
        ephemeral: true
      });
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("offer_order_")) {
        const parts = interaction.customId.split("_");
        const offerId = parts[2];
        const sellerId = parts[3] || null;
        return createOrderFromOffer(interaction, offerId, sellerId);
      }

      if (interaction.customId.startsWith("offer_report_")) {
        const parts = interaction.customId.split("_");
        const offerId = parts[2];
        const sellerId = parts[3] || "unknown";

        return interaction.reply({
          content: "🚨 اختر سبب البلاغ:",
          components: [buildReportMenu(`${offerId}_${sellerId}`)],
          ephemeral: true
        });
      }

      if (interaction.customId.startsWith("offer_actions_")) {
        const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator);

        if (!isAdmin) {
          return interaction.reply({
            content: "❌ هذا الزر مخصص للإدارة فقط.",
            ephemeral: true
          });
        }

        const actionParts = interaction.customId.split("_");
        const offerId = actionParts[2];
        const sellerId = actionParts[3] || "";

        return interaction.reply({
          content: `⚙️ إجراءات الإدارة للعرض **Offer #${offerId}**`,
          components: [buildOfferActionsMenu(offerId, interaction.message.id, sellerId)],
          ephemeral: true
        });
      }

      if (
        interaction.customId.startsWith("report_resolve_") ||
        interaction.customId.startsWith("report_reject_") ||
        interaction.customId.startsWith("report_delete_") ||
        interaction.customId.startsWith("report_warn_")
      ) {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({
            content: "❌ هذا الإجراء مخصص للإدارة فقط.",
            ephemeral: true
          });
        }

        const action = interaction.customId.split("_")[1];
        const labels = {
          resolve: "🟢 تم حل البلاغ.",
          reject: "🔴 تم رفض البلاغ.",
          delete: "🗑️ تم تحديد العرض للحذف.",
          warn: "⚠️ تم تسجيل تحذير للبائع."
        };

        return interaction.update({
          content: `${labels[action]}\\n👮 بواسطة: ${interaction.user}`,
          components: []
        });
      }

      if (
        interaction.customId.startsWith("order_complete_") ||
        interaction.customId.startsWith("order_close_")
      ) {
        const orderId = interaction.customId.split("_").slice(2).join("_");
        const orders = getOrderData();
        const order = orders[orderId];

        if (!order) {
          return interaction.reply({
            content: "❌ بيانات هذا الطلب غير موجودة.",
            ephemeral: true
          });
        }

        const isParticipant =
          interaction.user.id === order.buyerId ||
          interaction.user.id === order.sellerId;

        const isAdmin = interaction.memberPermissions.has(
          PermissionFlagsBits.Administrator
        );

        if (!isParticipant && !isAdmin) {
          return interaction.reply({
            content: "❌ هذا الطلب لا يخصك.",
            ephemeral: true
          });
        }

        if (interaction.customId.startsWith("order_complete_")) {
          if (order.status === "completed") {
            return interaction.reply({
              content: "❌ هذا الطلب مكتمل بالفعل.",
              ephemeral: true
            });
          }

          order.status = "completed";
          order.completedAt = new Date().toISOString();
          saveOrderData(orders);

          const sellers = loadJson("data/sellers.json", {});
          const sellerData = getSellerData(order.sellerId);
          sellerData.completedOrders += 1;
          sellers[order.sellerId] = sellerData;
          saveJson("data/sellers.json", sellers);

          const completedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x57f287)
            .setDescription(
              [
                `👤 العميل: <@${order.buyerId}>`,
                `🏪 البائع: <@${order.sellerId}>`,
                `🛍️ العرض: **Offer #${order.offerId}**`,
                "",
                "✅ تم إتمام الطلب بنجاح.",
                "",
                "📌 الحالة: **مكتمل**"
              ].join("\n")
            );

          await interaction.update({
            embeds: [completedEmbed],
            components: []
          });

          return;
        }

        await interaction.reply("🔒 سيتم إغلاق الطلب خلال 5 ثوانٍ...");

        order.status = "closed";
        order.closedAt = new Date().toISOString();
        saveOrderData(orders);

        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
      }
    }
  } catch (error) {
    console.error("❌ Interaction error:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ حدث خطأ غير متوقع.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN غير موجود في ملف .env");
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
