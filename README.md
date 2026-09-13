# Shop v2

بوت Marketplace وOrders احترافي لـDiscord مبني على `discord.js 14` وSQLite المدمج مع Node.js الحديث.

## المتطلبات
- Node.js `>= 24.15.0`
- `DISCORD_TOKEN` داخل `.env`

## التشغيل
```bash
npm install
npm start
```

## الإعداد من Discord
### Shop
- `/shop` — إرسال لوحة الطلبات.
- `/settings shop-channel` — قناة لوحة الطلبات.
- `/settings orders-category` — Category ديال الطلبات.
- `/settings staff-role` — رتبة الستاف.
- `/settings work-threads-channel` — Hub ديال Staff Work Threads.
- `/settings reports-channel` — قناة البلاغات.
- `/settings offers-channel` — القناة الرسمية للعروض التي تنشأ عبر `/offer create`.
- `/settings seller-role` — الرتبة المطلوبة لإنشاء العروض والنشر في Marketplace.
- `/settings verified-seller-role` — رتبة البائع الموثق.
- `/settings show` — عرض إعدادات السيرفر.

### Marketplace
- `/marketplace channel-add`
- `/marketplace channel-remove`
- `/marketplace channel-list`
- `/marketplace mention`
- `/marketplace mention-show`

البائع يرسل العرض في قناة Marketplace مسجلة، والبوت يعيد نشره عبر Webhook بدون ping للمستخدمين الموجودين في محتوى الرسالة. الصور والمرفقات تبقى كمرفقات Discord.

### Offers
`/offer create` ينشئ عرضاً محفوظاً في SQLite، مع رقم عرض وحالة `active` وأزرار Order / Report / Actions.

### Orders
الطلب يمر بالحالات:
`pending` → `working` → `completed` أو `closed`

العميل لا يستطيع إتمام الطلب بنفسه؛ الإتمام للبائع أو الستاف. بعد الإتمام يقدر العميل يقيّم البائع مرة واحدة فقط على نفس الطلب.

### Sellers
- `/seller profile`
- `/seller verify`
- `/seller unverify`

التقييمات مرتبطة بالطلبات المكتملة، وليس بمجرد الضغط على زر في ملف البائع.

### Reports
البلاغات محفوظة في SQLite، عندها رقم وحالة `pending / resolved / rejected`، والإجراءات الإدارية تغيّر الحالة فعلياً ويمكنها إزالة العرض من Marketplace.

## التخزين
البيانات التشغيلية أصبحت في:
`data/shop.sqlite`

والملفات JSON القديمة باقية في المشروع كمرجع/توافق خلفي، لكنها ليست مصدر البيانات الأساسي في v2.

## ملاحظات الصلاحيات
البوت يحتاج على الأقل: View Channel, Send Messages, Read Message History, Manage Channels, Manage Webhooks، وإدارة الرتب إذا كنت ستستعمل نظام Verified Seller.
