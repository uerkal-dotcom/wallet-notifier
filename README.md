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

## 4) Kagit (paper) trading

`WALLETS` listesindeki bir cuzdan `PAPER_TRADING_WALLETS` icinde de gecerse, o
cuzdan icin ham islem bildirimi yerine **fiyat bandina ve market tipine gore
boyutlandirilmis kagit trading** calisir (bkz. `src/sizing.js` - wallet-analytics
raporundaki geriye donuk analize dayanir):

- Her calistirmada cuzdanin guncel acik pozisyonlari (`data-api.polymarket.com/positions`)
  cekilir; cozulmus/redeem edilebilir eski bahisler (`redeemable: true`) hariç
  tutulur.
- Yeni bir pozisyon ilk goruldugunde, boyut **trader'in yatirdigi tutara degil**,
  o anki fiyat bandina ve market tipine gore hesaplanir:
  - `map_number` (Map 2/3 kazanani) turu tamamen atlanir (analizde net kaybeden kategori)
  - `tournament_winner` (sampiyonluk marketi): sabit kucuk tutar (kasa'nin %1'i, max $4)
  - fiyat 0.75-0.90 arasi: kasa'nin %3.5'i (raporun en verimli bandi, ~%23 ROI)
  - fiyat 0.00-0.40 arasi: kasa'nin %2'si (ikinci en verimli bant, ~%11 ROI)
  - fiyat 0.40-0.75 arasi: kasa'nin %1'i (en zayif orta bant, ~%2 ROI)
  - fiyat 0.90 ustu: kasa'nin %1'i (buyuk ama dolar-basina zayif getiri, ~%7 ROI)
  - Ayrica ayni `eventSlug` altindaki toplam maruziyet kasa'nin %12.5'ini
    gecemez (korelasyon tavani) - asarsa tutar kirpilir veya atlanir.
- Boyut sadece pozisyon **ilk acildiginda** hesaplanir ve sabit kalir (trader'in
  o pozisyona sonradan ekleme yapmasi boyutu degistirmez); pozisyon trader
  kapatana/market cozulene kadar acik kalir.
- Sanal bakiye ve acik kagit pozisyonlar `paper-portfolio.json` dosyasinda
  tutulur ve `state.json` gibi otomatik commit'lenir.
- Kurallari degistirmek icin `src/sizing.js` dosyasini duzenleyin.

### Bildirimler artik secici

Sanal takip her calistirmada sessizce devam eder (bankroll/olay tavani
hesabi icin gerekli), ama Telegram bildirimi **sadece** su uc durumda gider:

1. **Giris**: trader'in o pozisyona gercekten yatirdigi tutar (`initialValue`)
   500$'in ustundeyse - bildirimde onerilen yatirim tutari da gosterilir.
2. **Onerilen tutar artisi**: ayni pozisyon icin sonradan hesaplanan onerilen
   tutar (kasa buyudukce veya olay tavaninda yer actikca) daha once bildirilen
   tutardan yuksekse.
3. **Panik satis suphesi**: takip edilen bir pozisyon, market henuz cozulmeden
   (yani `redeemable` olmadan) ortadan kayboluyorsa - trader'in hisseleri
   sattigi anlamina gelir, bu nadir goruldugu icin ayrica isaretlenir.

Normal cozum (market kapanip pozisyon dogal olarak bitmesi) veya 500$'in
altindaki girisler icin bildirim gitmez, sadece sessizce kayit guncellenir.

## Ayarlar (.env / Actions secrets)

| Degisken | Aciklama | Varsayilan |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | BotFather token | - (zorunlu) |
| `TELEGRAM_CHAT_ID` | Bildirim gidecek chat id | - (zorunlu) |
| `WALLETS` | `adres:etiket` listesi, virgulle ayrilmis | - (zorunlu) |
| `POLL_INTERVAL_SECONDS` | Yerel calistirmada kontrol araligi (saniye) | 30 |
| `MIN_USDC_SIZE` | Bu tutarin altindaki islemler atlanir (kagit trading uygulanmayan cuzdanlar icin) | 0 |
| `STATE_PATH` | Durum dosyasi yolu | `./data/state.json` |
| `PAPER_TRADING_WALLETS` | Kagit trading uygulanacak cuzdan adresleri, virgulle ayrilmis | - |
| `PAPER_START_BALANCE` | Kagit portfoyun baslangic bakiyesi | 380 |
| `PAPER_STATE_PATH` | Kagit portfoy durum dosyasi yolu | `./data/paper-portfolio.json` |

## Notlar

- Sadece alim/satim islemleri bildirilir; yatirma/cekme gibi diger
  aktiviteler `src/market.js` icindeki `type` parametresi degistirilerek
  eklenebilir.
- Ilk calistirmada mevcut islem gecmisi icin bildirim gonderilmez; sadece o
  andan sonraki yeni islemler bildirilir.
- Islem verisi `data-api.polymarket.com` adresinden cekilir; kullanici
  adindan cuzdan adresi bulmak icin ilgili profil sayfasindaki
  `/api/profile/userData?address=0x...` cagrisi kullanilabilir.
