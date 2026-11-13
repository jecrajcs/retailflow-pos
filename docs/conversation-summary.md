# DailyPlazaa POS बातचीत का सारांश

> **दस्तावेज़ का दायरा:** यह उपलब्ध chat context, implementation notes और session checkpoints के आधार पर तैयार किया गया विषयवार पुनर्निर्मित सारांश है। यह पूरी बातचीत का शब्दशः transcript नहीं है; कुछ शुरुआती messages summarized थे। इसमें कोई password, password hash, cookie, Supabase key या auth secret शामिल नहीं है।

## 1. प्रोजेक्ट और शुरुआती अनुरोध

उपयोगकर्ता ने DailyPlazaa POS प्रोजेक्ट को हिंदी में समझाने और फिर अधूरे काम पूरे करने को कहा। सहमत product scope:

- Billing और receipts
- Inventory, stock movement, transfer और adjustment
- Purchases
- Cash drawer और cash reconciliation
- Offline operation और बाद में sync
- Staff sign-in, roles और location-based access

Customer/e-commerce login इस scope से बाहर रखा गया। पहले से काम कर रही POS सुविधाओं को दोबारा बनाने के बजाय verified gaps ठीक करने और regression tests बनाए रखने पर जोर दिया गया।

## 2. Authentication का निर्णय

उपयोगकर्ता ने स्पष्ट किया कि staff authentication app के अपने server code से चलनी चाहिए—Supabase Auth या किसी hosted external identity provider पर निर्भर नहीं होना चाहिए।

चुना गया design:

- **Better Auth** को self-hosted application server पर चलने वाली authentication library के रूप में उपयोग करना।
- **Supabase PostgreSQL** को application data और app-managed auth records का database बनाए रखना।
- Staff identity, role, active state और location access को DailyPlazaa के staff profile में रखना।
- Password को केवल Better Auth-compatible one-way hash के रूप में store करना; plaintext password या recoverable password नहीं।
- Authentication secret और Supabase server key को server-only environment variables में रखना।

इसका अर्थ: Better Auth इस setup में कोई अलग hosted auth service नहीं है। यह project में install की गई third-party library है, जिसे DailyPlazaa server चलाता और configure करता है।

## 3. Auth configuration और error handling

शुरुआत में missing `BETTER_AUTH_SECRET` के कारण route imports के समय app crash हो रहा था। बाद में:

- Better Auth initialization को lazy किया गया ताकि import के समय secret validation पूरी app को न गिराए।
- Missing/invalid auth configuration के लिए सुरक्षित, user-facing service-unavailable response जोड़ा गया।
- Canonical `BETTER_AUTH_URL` और `BETTER_AUTH_TRUSTED_ORIGIN` की जरूरत पहचानी और setup docs में बताई गई।
- Technical server errors को UI में सीधे दिखाने के बजाय business-friendly messages देने का साझा approach बनाया गया।
- Unexpected failures के लिए server-side diagnostics बनाए रखने और client को सुरक्षित संदेश देने का लक्ष्य रखा गया।

स्थानीय dev में URL/origin browser के वास्तविक host और port से मेल खाने चाहिए। उदाहरण के लिए `localhost` और `127.0.0.1` अलग origins हैं।

## 4. Public और protected access policy

उपयोगकर्ता ने आपत्ति की कि पूरा app sign-in के पीछे होने से बिना login कोई progress/overview नहीं दिखता। सहमत नीति:

- Public home page पर सीमित, aggregate daily overview दिखे।
- Operational screens और records staff authentication के पीछे रहें।
- Role तथा assigned locations तय करें कि कौन-सा staff member कौन-सा data/action देख या कर सकता है।
- Cashier को purchase cost/supplier और कुछ customer-sensitive details न दिखें।
- Admin को वर्तमान policy के अनुसार सभी active locations का access मिले।

Implementation notes में public overview को business date, completed bill count और total sales जैसे सीमित totals तक रखा गया। Sales total को public दिखाने की commercial sensitivity production से पहले दोबारा evaluate करने योग्य बताया गया।

## 5. Initial Admin और staff creation

उपयोगकर्ता का प्राथमिक उद्देश्य एक Admin login पाना था, जिससे वे Admin UI से staff accounts, roles और location assignments बना सकें। प्रारंभिक Admin के लिए उपयोगकर्ता ने नाम **DailyPlazaa Admin** और अपना email/mobile दिया था; वास्तविक login password साझा या assistant द्वारा बनाया नहीं जाना है।

Bootstrap पर हुए निर्णय:

- Assistant live database में Admin provision नहीं करेगा।
- उपयोगकर्ता अपने trusted Supabase SQL Editor में seed चलाएगा।
- App की वर्तमान auth schema के अनुरूप seed में staff profile, auth identity, credential account और login identifiers बनते हैं।
- Seed `must_change_password=true` रखता है ताकि पहली sign-in के बाद temporary password बदलना जरूरी हो।
- Seed transaction और duplicate/collision guards के साथ है।
- [generate-admin-password-hash.mjs](../scripts/generate-admin-password-hash.mjs) local interactive terminal में password बिना echo लिए hash बनाता है।
- [seed-initial-admin.sql](../scripts/seed-initial-admin.sql) में केवल उस local hash को रखना है; password को SQL/chat में नहीं डालना है।
- [staff-access-setup.md](./staff-access-setup.md) में migrations, backup, seed, sign-in और staff setup के निर्देश हैं।

Helper का no-echo behavior और Better Auth hash compatibility throwaway test password से जांचे गए। SQL seed को disposable local PostgreSQL instance पर चलाकर expected records, forced-password-change flag और duplicate-Admin guard जांचे गए। **इन local tests ने live Supabase account या live schema को verify नहीं किया।** उपयोगकर्ता के seed चलाने और sign-in की पुष्टि अभी आवश्यक है।

Sign-in के बाद Admin UI का अपेक्षित काम:

1. Admin staff profile बनाता है, role और authorized locations चुनता है।
2. App temporary password एक बार दिखाता है।
3. Staff उस password से sign in करके अपना password बदलता है।
4. Admin access को deactivate या reset कर सकता है।

## 6. Database और offline-store rationalization

उपयोगकर्ता ने table drops से पहले पूरे database को समझने, redundant/non-useful tables पहचानने, backup/rollback सोचने और पहले से बने plans में छूटे बिंदु मिलाने को कहा। सहमत सीमाएँ:

- Source migrations और code references से शुरुआती inventory/proposal बन सकती है, लेकिन इससे live DB state प्रमाणित नहीं होती।
- Live catalog, row counts, foreign keys, policies, functions और migration history की read-only जांच तथा verified backup/restore के बिना destructive cleanup नहीं करना।
- कोई table drop/merge करने से पहले उपयोगकर्ता की स्पष्ट मंजूरी चाहिए।
- प्रारंभिक स्रोत-आधारित प्रस्ताव में business ledger/operational और offline stores को रखने, `auth_login_identifiers` को canonical staff email/phone से merge करने की संभावना जांचने, और `auth_accounts`/`auth_sessions` रखने की बात हुई।
- `auth_users` को अभी रखना; इसे `users` में merge करना केवल अलग adapter proof और compatibility tests के बाद विचारना।
- Bootstrap-token table/route को manual seed और recovery flow सफल होने के बाद retire करने पर विचार करना।

पहले सुझाई गई inventory संख्या source review की working estimate थी, live database inventory नहीं। Migration `0008` लागू होने की बात उपयोगकर्ता ने बताई थी; assistant ने live DB से स्वतंत्र पुष्टि नहीं की।

## 7. Offline behavior और regression scope

Auth बदलावों के साथ पहले से मौजूद POS/offline व्यवहार सुरक्षित रखना है:

- पहले से authorized device पर स्थानीय billing और saves चलते रहें।
- Offline logout device को lock करे, पर pending bills/outbox न मिटाए।
- Connectivity लौटने पर sync हो।
- Staff owner के बिना पुराने outbox operations को अनंत retry करने के बजाय review के लिए रखा जाए।
- Purchase attachment sync और cash denomination/count reconciliation भी regression coverage में रहें।

अंतिम regression scope में billing/payment/receipt, inventory transfer/adjustment, purchase attachment, cash drawer, staff provisioning, role/location boundaries और offline recovery शामिल हैं।

## 8. हाल का login troubleshooting

उपयोगकर्ता ने sign-in पर generic unavailable संदेश और “Network panel में request नहीं दिख रही” जैसी समस्या बताई। बाद में दिए curl responses और server stack traces से:

- `/api/staff-login` request server तक पहुँचती है और `503` लौटाती है।
- Server log में `SUPABASE_SERVICE_ROLE_KEY` missing है।
- Login handler पहले login identifier से staff profile resolve करता है; यह Supabase server client के बिना नहीं हो सकता। इसलिए इस failure पर password/hash verification तक request पहुँची ही नहीं।
- बिना session cookie `/api/staff-session` का active staff session न होना expected है; यह अलग परिणाम है।
- स्थानीय `.env` की जाँच में `SUPABASE_URL` था, लेकिन `SUPABASE_SERVICE_ROLE_KEY` नहीं था। किसी key value को पढ़ा या साझा नहीं किया गया।
- उपयोगकर्ता के curl में एक password value शामिल थी। यदि वह वास्तविक password था, तो उसे exposed मानकर बदलना/reset करना चाहिए; इस दस्तावेज़ में वह value दोहराई नहीं गई है।

आगे के सुरक्षित कदम:

1. उपयोगकर्ता स्वयं Supabase का सही server-only service role/secret key अपने ignored local `.env` में जोड़े; उसे chat, browser, source या curl history में साझा न करे।
2. Dev server restart करे।
3. App को उसी origin से खोले जो `BETTER_AUTH_URL` और `BETTER_AUTH_TRUSTED_ORIGIN` में सेट है।
4. Network panel में request का status और safe error body देखें; password, cookie या authorization header साझा न करें।
5. Server configuration ठीक होने के बाद ही credential/hash, seeded rows और identifier mapping की जांच करें।

इस debugging चरण में login endpoint के origin rejection को invalid credentials से अलग safe message देने और `503` response को UI में छिपने से रोकने के लिए code changes किए गए। Focused staff-auth tests, ESLint और production build सफल बताए गए। **Live login अभी सत्यापित नहीं है**, क्योंकि local server key उपलब्ध नहीं थी और server restart के बाद की request जांच नहीं हुई।

## 9. अभी बाकी मुख्य काम

- उपयोगकर्ता local Supabase server key configure करके app restart करे।
- User-run Admin SQL seed सफल होने की पुष्टि करे।
- Email/mobile login, forced password change और Admin staff-management flow end-to-end जांचें।
- Staff role/location restrictions और offline behavior regressions सत्यापित करें।
- First-admin route/bootstrap token retire करने का निर्णय manual seed/recovery path के प्रमाण के बाद लें।
- Database rationalization के लिए live evidence, backup/restore और अलग user approval लें।

## 10. संवेदनशीलता और सत्यापन संबंधी नोट

इस summary में कोई password, generated hash, browser cookie, service-role key या Better Auth secret नहीं है। कोई live SQL seed, live DB mutation या Admin provisioning assistant ने नहीं की। Local build/test परिणामों को production/live database verification नहीं समझना चाहिए।
