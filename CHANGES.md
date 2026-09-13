# Shop v2

## Architecture
- تفكيك الـbootstrap القديم ونقل الـcore إلى `src/app.js`.
- إضافة طبقة SQLite في `src/db.js`.
- نقل بناء الـembeds/components/modals إلى `src/ui.js`.
- الإعدادات أصبحت مرتبطة بالسيرفر (`guild`) بدل config واحد عالمي.

## Orders
- حالات واضحة للطلب: `pending` → `working` → `completed` / `closed`.
- العميل لا يستطيع إتمام الطلب بنفسه.
- استلام الطلب للستاف مع دعم Work Thread.
- منع فتح أكثر من طلب مفتوح لنفس العميل داخل السيرفر.

## Marketplace
- قنوات Marketplace متعددة لكل سيرفر.
- إعادة نشر العروض عبر Webhook.
- إزالة user/role/everyone mentions من النص الأصلي قبل إعادة النشر.
- حفظ كل عرض في SQLite مع seller/message/status.
- حماية Actions بصلاحية Administrator وcooldown.

## Sellers & Reviews
- تنفيذ فعلي لـ `/seller verify` و`/seller unverify` مع إدارة Verified Seller role.
- التقييم أصبح مرتبطاً بطلب مكتمل.
- العميل يقدر يقيم نفس الطلب مرة واحدة فقط.
- حساب التقييم والطلبات والعروض محفوظ في SQLite.

## Reports
- البلاغات أصبحت records حقيقية في SQLite.
- الحالات: `pending`, `resolved`, `rejected`.
- معالجة البلاغات تحدث الحالة فعلياً.
- إزالة العرض من Marketplace ممكنة من لوحة البلاغ.

## Storage
- المصدر الأساسي للبيانات في `data/shop.sqlite`.
- ملفات JSON القديمة لم تعد هي المصدر الأساسي.
