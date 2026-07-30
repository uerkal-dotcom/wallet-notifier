# Cuzdan Takip Botu

Belirlediginiz cuzdan adreslerinin actigi islemleri Telegram uzerinden bildirim
olarak gonderir. Telegram hem telefonda hem bilgisayarda calistigi icin ayri
bir uygulama gelistirmeye gerek kalmiyor.

## Nasil calisir

- Belirli araliklarla (varsayilan: her 5 dakikada bir, GitHub Actions
  uzerinden) her cuzdan icin islem gecmisi sorgulanir.
- Daha once gorulmemis yeni islemler tespit edilir ve Telegram botunuz
  araciligiyla size mesaj olarak gonderilir.
- Hangi islemlerin daha once bildirildigi `state.json` dosyasinda tutulur ve
  her calistirmadan sonra otomatik olarak repoya geri commit'lenir; boylece
  yeniden calistirmalarda ayni islem tekrar bildirilmez.

## 1) Telegram botu olusturma

1. Telegram'da **@BotFather** ile konusun, `/newbot` komutunu calistirin, bir isim verin.
2. Size verilen **token**'i not edin (`TELEGRAM_BOT_TOKEN`).
3. Olusturdugunuz bota Telegram'dan `/start` yazip bir mesaj gonderin (bildirim
   alacaginiz hesap bu olmali).

## 2) Yerel kurulum ve test

```bash
npm install
cp .env.example .env
```

`.env` dosyasini doldurun:

- `TELEGRAM_BOT_TOKEN`: BotFather'dan aldiginiz token.
- `TELEGRAM_CHAT_ID`: asagidaki komutla bulun (once bota `/start` mesaji gonderin):

```bash
node src/get-chat-id.js
```

- `WALLETS`: takip edilecek cuzdanlar, `adres:etiket` formatinda virgulle ayrilmis:

```
WALLETS=0x1234...abcd:Ahmet,0xabcd...5678:Mehmet
```

Calistirmak icin:

```bash
npm start
```

## 3) GitHub Actions ile 7/24 calistirma (ucretsiz)

Repo `.github/workflows/poll.yml` isimli bir GitHub Actions workflow'u icerir.
Bu workflow GitHub'in sunucularinda calisir; bilgisayariniz kapali olsa da
calismaya devam eder.

1. Bu kodu kendi GitHub reponuza push edin.
2. Repo ayarlarindan asagidaki **Actions secrets**'lari tanimlayin
   (Settings > Secrets and variables > Actions):
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `WALLETS`
   - `MIN_USDC_SIZE` (opsiyonel)
3. Workflow varsayilan olarak her 5 dakikada bir otomatik calisir. Elle
   tetiklemek icin Actions sekmesinden "Wallet Poller" workflow'unu secip
   "Run workflow" butonuna basabilirsiniz.

Not: Public (herkese acik) repolarda GitHub Actions calisma dakikasi
sinirsiz ve ucretsizdir. Private (gizli) repolarda aylik 2000 dakikalik
ucretsiz kota oldugu icin, gizliligi tercih ederseniz kontrol araligini
(cron ifadesini) 20-30 dakikaya cikarmak gerekebilir.

## Ayarlar (.env / Actions secrets)

| Degisken | Aciklama | Varsayilan |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | BotFather token | - (zorunlu) |
| `TELEGRAM_CHAT_ID` | Bildirim gidecek chat id | - (zorunlu) |
| `WALLETS` | `adres:etiket` listesi, virgulle ayrilmis | - (zorunlu) |
| `POLL_INTERVAL_SECONDS` | Yerel calistirmada kontrol araligi (saniye) | 30 |
| `MIN_USDC_SIZE` | Bu tutarin altindaki islemler atlanir | 0 |
| `STATE_PATH` | Durum dosyasi yolu | `./data/state.json` |

## Notlar

- Sadece alim/satim islemleri bildirilir; yatirma/cekme gibi diger
  aktiviteler `src/market.js` icindeki `type` parametresi degistirilerek
  eklenebilir.
- Ilk calistirmada mevcut islem gecmisi icin bildirim gonderilmez; sadece o
  andan sonraki yeni islemler bildirilir.
- Islem verisi `data-api.polymarket.com` adresinden cekilir; kullanici
  adindan cuzdan adresi bulmak icin ilgili profil sayfasindaki
  `/api/profile/userData?address=0x...` cagrisi kullanilabilir.
