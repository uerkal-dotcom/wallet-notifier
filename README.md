# Polymarket Cuzdan Takip Botu

Belirlediginiz Polymarket cuzdan adreslerinin actigi islemleri Telegram uzerinden
bildirim olarak gonderir. Telegram hem telefonda hem bilgisayarda calistigi icin
ayri bir uygulama gelistirmeye gerek kalmiyor.

## Nasil calisir

- `data-api.polymarket.com/activity` uc noktasi belirli araliklarla (varsayilan 30s)
  her cuzdan icin sorgulanir.
- Daha once gorulmemis yeni islemler tespit edilir ve Telegram botunuz araciligiyla
  size mesaj olarak gonderilir.
- Hangi islemlerin daha once bildirildigi `data/state.json` dosyasinda tutulur,
  boylece yeniden baslatmalarda ayni islem tekrar bildirilmez.

## 1) Telegram botu olusturma

1. Telegram'da **@BotFather** ile konusun, `/newbot` komutunu calistirin, bir isim verin.
2. Size verilen **token**'i not edin (`TELEGRAM_BOT_TOKEN`).
3. Olusturdugunuz bota Telegram'dan `/start` yazip bir mesaj gonderin (bildirim
   alacaginiz hesap bu olmali).

## 2) Yerel kurulum

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

## 3) Fly.io'ya deploy (7/24 calisir, ucretsiz kotaya uygun)

1. [Fly.io CLI'i kurun](https://fly.io/docs/flyctl/install/) ve `fly auth login` ile giris yapin.
2. Bu klasorde:

```bash
fly launch --no-deploy
```

   (mevcut `fly.toml` dosyasini kullanmasina izin verin, uzerine yazmasin)

3. Kalici disk olusturun (state.json icin, restart sonrasi tekrar bildirim gitmesin diye):

```bash
fly volumes create polymarket_notifier_data --size 1 --region fra
```

4. Sirlari (secrets) tanimlayin:

```bash
fly secrets set TELEGRAM_BOT_TOKEN=xxxx TELEGRAM_CHAT_ID=xxxx WALLETS="0x...:Ahmet"
```

5. Deploy edin:

```bash
fly deploy
```

Loglari izlemek icin: `fly logs`

## Ayarlar (.env)

| Degisken | Aciklama | Varsayilan |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | BotFather token | - (zorunlu) |
| `TELEGRAM_CHAT_ID` | Bildirim gidecek chat id | - (zorunlu) |
| `WALLETS` | `adres:etiket` listesi, virgulle ayrilmis | - (zorunlu) |
| `POLL_INTERVAL_SECONDS` | Kontrol araligi (saniye) | 30 |
| `MIN_USDC_SIZE` | Bu tutarin altindaki islemler atlanir | 0 |
| `STATE_PATH` | Durum dosyasi yolu | `./data/state.json` |

## Notlar

- Sadece `TRADE` tipi islemler (al/sat) bildirilir; yatirma/cekme gibi diger
  aktiviteler `src/polymarket.js` icindeki `type` parametresi degistirilerek
  eklenebilir.
- Ilk calistirmada mevcut islem gecmisi icin bildirim gonderilmez; sadece o
  andan sonraki yeni islemler bildirilir.
