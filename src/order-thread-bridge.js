const {
  ChannelType,
  EmbedBuilder,
  GuildChannelManager,
} = require("discord.js");

const store = require("./db");

let installed = false;
const originalCreate = GuildChannelManager.prototype.create;

function parseTopic(topic = "") {
  const buyer = topic.match(/Buyer\s+(\d+)/i)?.[1] || null;
  const seller = topic.match(/Seller\s+(\d+)/i)?.[1] || null;
  return { buyer, seller };
}

function buildProfessionalOrderEmbed(source) {
  const title = source?.data?.title || "🛒 Order";
  const description = source?.data?.description || "";
  const orderId = title.match(/#([\d]+)/)?.[1] || "---";
  const buyer = description.match(/العميل:\s*<@(\d+)>/)?.[1] || null;
  const seller = description.match(/البائع:\s*<@(\d+)>/)?.[1] || null;
  const offer = description.match(/Offer\s+#([\d]+)/)?.[1] || null;
  const type = description.match(/النوع:\s*\*\*([^*]+)\*\*/)?.[1] || "غير محدد";

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🛒 Order #${orderId}`)
    .setDescription("تم إنشاء الطلب بنجاح. المرجو إبقاء جميع تفاصيل الاتفاق والتواصل داخل هذا الـThread للحفاظ على سجل واضح للطلب.")
    .addFields(
      { name: "👤 العميل", value: buyer ? `<@${buyer}>` : "غير معروف", inline: true },
      { name: "🏪 البائع", value: seller ? `<@${seller}>` : "غير معروف", inline: true },
      { name: "📦 العرض", value: offer ? `Offer #${offer}` : "طلب مباشر", inline: true },
      { name: "📂 النوع", value: type, inline: true },
      { name: "📌 الحالة", value: "🟡 قيد الانتظار", inline: true },
      { name: "🧾 رقم الطلب", value: `#${orderId}`, inline: true },
      { name: "🔐 الخصوصية", value: "هذا الـThread مخصص للعميل والبائع وفريق المتجر.", inline: false },
    )
    .setFooter({ text: "Shop • Order Center" })
    .setTimestamp();
}

function installOrderThreadBridge() {
  if (installed) return;
  installed = true;

  GuildChannelManager.prototype.create = async function createOrderAwareChannel(options = {}) {
    const looksLikeShopOrder =
      options.type === ChannelType.GuildText &&
      typeof options.name === "string" &&
      options.name.startsWith("order-") &&
      typeof options.topic === "string" &&
      options.topic.includes("Buyer ") &&
      options.topic.includes("Seller ");

    if (!looksLikeShopOrder) return originalCreate.call(this, options);

    const guild = this.guild;
    const settings = store.settings(guild.id);
    const workChannelId = settings.work_threads_channel_id;

    if (!workChannelId) {
      throw new Error("SHOP_WORK_THREADS_CHANNEL_NOT_CONFIGURED");
    }

    const parent = guild.channels.cache.get(workChannelId) || await guild.channels.fetch(workChannelId).catch(() => null);
    if (!parent || !parent.threads || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(parent.type)) {
      throw new Error("SHOP_WORK_THREADS_CHANNEL_INVALID");
    }

    const { buyer, seller } = parseTopic(options.topic);

    const thread = await parent.threads.create({
      name: options.name,
      type: ChannelType.PrivateThread,
      autoArchiveDuration: 10080,
      reason: "Shop order thread",
      invitable: false,
    });

    if (buyer) await thread.members.add(buyer).catch(error => console.error("[Shop] buyer thread member add failed:", error));
    if (seller && seller !== buyer) await thread.members.add(seller).catch(error => console.error("[Shop] seller thread member add failed:", error));

    if (!thread.permissionOverwrites) {
      Object.defineProperty(thread, "permissionOverwrites", {
        configurable: true,
        enumerable: false,
        value: {
          edit: async () => thread,
        },
      });
    }

    const originalSend = thread.send.bind(thread);
    let firstSend = true;
    thread.send = async (payload) => {
      if (firstSend && payload && Array.isArray(payload.embeds) && payload.embeds[0]) {
        firstSend = false;
        const source = payload.embeds[0];
        payload = {
          ...payload,
          embeds: [buildProfessionalOrderEmbed(source)],
        };
      }
      return originalSend(payload);
    };

    return thread;
  };
}

module.exports = { installOrderThreadBridge };
