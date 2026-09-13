const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const CATEGORY_NAMES = {
  product: "🛒 منتج",
  design: "🎨 تصميم",
  programming: "💻 برمجة",
};

const TYPE_NAMES = {
  product: "طلب منتج",
  design: "طلب تصميم",
  programming: "طلب خدمة برمجية",
};

const REPORT_REASONS = {
  scam: "نصب أو احتيال",
  fake_product: "منتج غير موجود أو غير مطابق",
  misleading_price: "سعر مضلل",
  stolen_content: "سرقة محتوى أو عرض",
  prohibited: "مخالفة قوانين المتجر",
  other: "سبب آخر",
};

function shopPanel() {
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🛍️ متجرنا")
      .setDescription([
        "مرحبا بك في نظام الطلبات.",
        "",
        "اختر نوع الطلب من القائمة بالأسفل وسيتم إنشاء غرفة خاصة لك.",
        "",
        "🔒 الطلبات خاصة بين العميل وفريق المتجر، ويضاف البائع تلقائيا عند اختيار عرض من Marketplace.",
      ].join("\n"))
      .setFooter({ text: "Shop • Order Center" })
      .setTimestamp()],
    components: [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("shop_order_type")
        .setPlaceholder("اختر نوع الطلب")
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel("طلب منتج").setDescription("شراء أو طلب منتج").setEmoji("🛒").setValue("product"),
          new StringSelectMenuOptionBuilder().setLabel("طلب تصميم").setDescription("طلب تصميم أو خدمة إبداعية").setEmoji("🎨").setValue("design"),
          new StringSelectMenuOptionBuilder().setLabel("طلب برمجة").setDescription("طلب خدمة برمجية").setEmoji("💻").setValue("programming"),
        ),
    )],
  };
}

function offerEmbed({ publicId, title, description, price, category, seller, imageUrl }) {
  const e = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${CATEGORY_NAMES[category] || "🛍️ عرض"} • ${title}`)
    .setDescription(description)
    .addFields(
      { name: "💰 السعر", value: String(price), inline: true },
      { name: "📂 التصنيف", value: CATEGORY_NAMES[category] || category, inline: true },
      { name: "👤 البائع", value: `<@${seller.id}>`, inline: true },
    )
    .setFooter({ text: `Offer #${publicId} • Shop Marketplace` })
    .setTimestamp();
  if (imageUrl) e.setImage(imageUrl);
  return e;
}

function offerButtons(publicId, sellerId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`offer_order_${publicId}_${sellerId}`).setLabel("Order").setEmoji("🛒").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`offer_report_${publicId}_${sellerId}`).setLabel("Report").setEmoji("❗").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`offer_actions_${publicId}_${sellerId}`).setLabel("Actions").setEmoji("⚙️").setStyle(ButtonStyle.Secondary),
  );
}

function orderControls(channelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`order_work_${channelId}`).setLabel("استلام الطلب").setEmoji("🛠️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`order_complete_${channelId}`).setLabel("إتمام الطلب").setEmoji("✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`order_close_${channelId}`).setLabel("إغلاق").setEmoji("🔒").setStyle(ButtonStyle.Danger),
  );
}

function reviewButton(orderId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`order_review_${orderId}`).setLabel("تقييم البائع").setEmoji("⭐").setStyle(ButtonStyle.Primary),
  );
}

function reportMenu(offerId, sellerId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`report_reason_${offerId}_${sellerId}`)
      .setPlaceholder("اختر سبب البلاغ")
      .addOptions(Object.entries(REPORT_REASONS).map(([value, label]) =>
        new StringSelectMenuOptionBuilder().setLabel(label).setDescription(`الإبلاغ: ${label}`).setValue(value))),
  );
}

function reportActions(reportId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`report_resolve_${reportId}`).setLabel("حل البلاغ").setEmoji("✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`report_reject_${reportId}`).setLabel("رفض").setEmoji("❌").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`report_remove_${reportId}`).setLabel("حذف العرض").setEmoji("🗑️").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`report_warn_${reportId}`).setLabel("تحذير").setEmoji("⚠️").setStyle(ButtonStyle.Primary),
  );
}

function reportEmbed(report, offer) {
  const color = report.status === "resolved" ? 0x57f287 : report.status === "rejected" ? 0xed4245 : 0xfee75c;
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`🚨 Report #${report.public_id}`)
    .addFields(
      { name: "📌 الحالة", value: report.status, inline: true },
      { name: "🛍️ العرض", value: offer ? `Offer #${offer.public_id}` : "غير متوفر", inline: true },
      { name: "👤 المبلّغ", value: `<@${report.reporter_id}>`, inline: true },
      { name: "🏪 البائع", value: report.seller_id ? `<@${report.seller_id}>` : "غير معروف", inline: true },
      { name: "🚨 السبب", value: report.reason_text, inline: false },
      { name: "📝 التفاصيل", value: report.details || "لا توجد تفاصيل إضافية.", inline: false },
    )
    .setTimestamp(new Date(report.created_at));
}

function sellerProfile(user, data, rating) {
  return new EmbedBuilder()
    .setColor(data.verified ? 0x57f287 : 0x5865f2)
    .setTitle(`👤 ملف البائع • ${user.username}`)
    .setThumbnail(user.displayAvatarURL({ extension: "png", size: 256 }))
    .addFields(
      { name: "🛡️ الحالة", value: data.verified ? "✅ موثق" : "👤 بائع", inline: true },
      { name: "⭐ التقييم", value: rating ? `${rating} / 5` : "لا توجد تقييمات", inline: true },
      { name: "📦 الطلبات المكتملة", value: String(data.completed_orders), inline: true },
      { name: "🛍️ العروض المنشورة", value: String(data.offers_created), inline: true },
      { name: "📝 التقييمات", value: String(data.total_reviews), inline: true },
    )
    .setFooter({ text: "Shop • Seller System" })
    .setTimestamp();
}

function reviewModal(orderId) {
  const modal = new ModalBuilder().setCustomId(`review_modal_${orderId}`).setTitle("⭐ تقييم البائع");
  const rating = new TextInputBuilder().setCustomId("rating").setLabel("التقييم من 1 إلى 5").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(1).setPlaceholder("5");
  const comment = new TextInputBuilder().setCustomId("comment").setLabel("تعليق اختياري").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500);
  modal.addComponents(new ActionRowBuilder().addComponents(rating), new ActionRowBuilder().addComponents(comment));
  return modal;
}

function reportDetailsModal(offerId, sellerId) {
  const modal = new ModalBuilder().setCustomId(`report_modal_${offerId}_${sellerId}`).setTitle("📝 تفاصيل البلاغ");
  const details = new TextInputBuilder().setCustomId("details").setLabel("اشرح المشكلة").setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(5).setMaxLength(1000);
  modal.addComponents(new ActionRowBuilder().addComponents(details));
  return modal;
}

module.exports = {
  CATEGORY_NAMES,
  TYPE_NAMES,
  REPORT_REASONS,
  shopPanel,
  offerEmbed,
  offerButtons,
  orderControls,
  reviewButton,
  reportMenu,
  reportActions,
  reportEmbed,
  sellerProfile,
  reviewModal,
  reportDetailsModal,
};
