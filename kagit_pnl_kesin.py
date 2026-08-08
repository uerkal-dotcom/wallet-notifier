"""SALT OKUMA: kagit portfoyunun KESIN P&L'i - cozulme degerinden.

NEDEN AYRI BIR BETIK: `kaynak_bazinda_pnl.py` kapanis fiyatini git
gecmisinde SON GORULEN `lastPrice`tan TAHMIN ediyor. Bot iki commit
arasinda kapatmis olabilir, ya da son yazilan fiyat cozulmeden onceki
ara bir deger olabilir. Etkisi olculdu: o betik toplam +37.91 diyor,
portfoyun kendi `realizedPnl` alani +19.89 - **18 USDC fark**.

Bu betik tahmini kaldirir: her kapanmis pozisyonun pazarini Gamma'dan
ceker ve GERCEK cozulme degerini (`outcomePrices`) kullanir. Bizim
tarafimiz kazandiysa hisse basina 1.00, kaybettiyse 0.00.
Hedge-bot'ta `zincir_muhasebe`nin yaptigi seyin aynisi: varsayimi
kaynakla degistirmek.

⚠️ COZULMEMIS pazarlar AYRI raporlanir, toplama KATILMAZ. Bir pozisyon
portfoyden dusmus ama pazar hala acikysa, o bir kapanis degildir -
sessizce sifir saymak eski betigin hatasini baska bicimde tekrarlardi.

Pozisyon anahtari `<conditionId>:<outcomeIndex>` bicimindedir; index
Gamma'nin `outcomePrices` dizisiyle hizalidir.

Hicbir sey yazmaz, hicbir emir gondermez. Sadece Gamma okur.
Kullanim:
    python kagit_pnl_kesin.py            # onbellekli
    python kagit_pnl_kesin.py --yenile   # onbellegi yok say
"""
import collections
import json
import os
import subprocess
import sys
import time
import datetime as _dt

import httpx


def _zaman(s):
    """ISO ya da '2026-08-06 13:03:57+00' bicimini datetime'a cevirir."""
    if not s:
        return None
    t = str(s).strip().replace(" ", "T")
    if t.endswith("+00"):
        t += ":00"
    try:
        d = _dt.datetime.fromisoformat(t)
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=_dt.timezone.utc)

DOSYA = "paper-portfolio.json"
ONBELLEK = ".kagit-cozulme-onbellek.json"
GAMMA = "https://gamma-api.polymarket.com/markets/slug/"


def _commitler():
    out = subprocess.run(
        # ⚠️ TAM ISO ZAMAN SART - sadece gosterim icin degil. Kapanis
        # sebebini (cozulme mi erken satis mi) pazarin `closedTime`i ile
        # KARSILASTIRARAK buluyoruz. Kisa "%m-%d %H:%M" bicimi yil
        # tasimiyor, `_zaman` None donuyor ve karsilastirma SESSIZCE
        # atlanip her sey "cozulme" sayiliyordu (bir kez yasandi: sonuc
        # "93 cozulme / 0 erken satis" cikti ve bulgu sanildi).
        ["git", "log", "--format=%H %ad", "--date=iso-strict",
         "--reverse", "origin/master", "--", DOSYA],
        capture_output=True, text=True, check=True).stdout
    for satir in out.splitlines():
        if satir.strip():
            h, _, tarih = satir.partition(" ")
            yield h, tarih


def _icerik(h):
    r = subprocess.run(["git", "show", f"{h}:{DOSYA}"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return None
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        return None


def kapananlari_bul():
    """Git gecmisinde KAYBOLAN pozisyonlar = kapanmis pozisyonlar."""
    onceki, kapanan = {}, []
    for h, tarih in _commitler():
        d = _icerik(h)
        if d is None:
            continue
        simdi = d.get("positions") or {}
        for anahtar, p in onceki.items():
            if anahtar in simdi:
                continue
            kapanan.append({
                "anahtar": anahtar,
                "kaynak": p.get("source") or "skyman44",
                "slug": p.get("slug"),
                "baslik": (p.get("title") or "?")[:42],
                "sonuc_adi": p.get("outcome"),
                "stake": float(p.get("stake") or 0),
                "size": float(p.get("size") or 0),
                "giris": float(p.get("entryPrice") or 0),
                "son_gorulen": float(p.get("lastPrice") or 0),
                "tarih": tarih,
            })
        onceki = simdi
    return kapanan


def _onbellek_yukle(yenile):
    if yenile or not os.path.exists(ONBELLEK):
        return {}
    try:
        return json.load(open(ONBELLEK, encoding="utf-8"))
    except Exception:
        return {}


def cozulme_getir(slug, onb, sayac):
    """(cozuldu_mu, outcomePrices). Cekim hatasi -> (None, None).

    ⚠️ User-Agent SART. `urllib.request` varsayilan basligiyla Cloudflare
    403 doner ve ilk surumde bu SESSIZCE "pazar bulunamadi"ya donusuyordu:
    93 pozisyonun 93'u belirsiz sayildi, tablo bos cikti ama betik 0 ile
    bitti. Cekim hatasi ile "pazar acik" AYRI sayilmali, yoksa ariza
    veri gibi gorunur.
    """
    if slug in onb and "closedTime" in onb[slug]:
        v = onb[slug]
        return v.get("closed"), v.get("prices")
    try:
        r = httpx.get(GAMMA + slug, timeout=20,
                      headers={"User-Agent": "kagit-pnl/1.0"})
        r.raise_for_status()
        d = r.json()
    except Exception as exc:
        sayac["cekim_hatasi"] += 1
        sayac["ornek"] = sayac.get("ornek") or f"{type(exc).__name__}: {exc}"
        return None, None
    if isinstance(d, list):
        d = d[0] if d else {}
    try:
        fiy = [float(x) for x in json.loads(d.get("outcomePrices") or "[]")]
    except Exception:
        fiy = []
    onb[slug] = {"closed": bool(d.get("closed")), "prices": fiy,
                 "closedTime": d.get("closedTime")}
    time.sleep(0.1)
    return onb[slug]["closed"], fiy


def main():
    yenile = "--yenile" in sys.argv
    kapanan = kapananlari_bul()
    if not kapanan:
        print("kapanan pozisyon bulunamadi")
        return
    onb = _onbellek_yukle(yenile)
    sayac = collections.Counter()

    kesin, belirsiz = [], []
    for k in kapanan:
        idx = None
        if k["anahtar"] and ":" in k["anahtar"]:
            try:
                idx = int(k["anahtar"].rsplit(":", 1)[1])
            except ValueError:
                idx = None
        closed, fiy = (None, None)
        if k["slug"]:
            closed, fiy = cozulme_getir(k["slug"], onb, sayac)
        if closed and fiy and idx is not None and idx < len(fiy):
            # 🔴 IKI FARKLI KAPANIS SEBEBI, IKI FARKLI DOGRU FIYAT.
            # Kagit bot pozisyonu, trader'in cuzdanindan KAYBOLDUGUNDA
            # kapatiyor ve daima `lastPrice` kullaniyor
            # (`paperTrading.js: closePosition`). Ama kaybolmanin iki
            # sebebi var:
            #   pazar COZULDU      -> dogru fiyat COZULME degeri (0/1)
            #   trader SATTI       -> dogru fiyat son gorulen fiyat
            # Botun kendi realizedPnl'i birinciyi yanlis sayiyor;
            # bu betigin ilk surumu ikinciyi yanlis sayiyordu.
            ct = (onb.get(k["slug"]) or {}).get("closedTime")
            kapanis = _zaman(ct)
            kayb = _zaman(k["tarih"])
            # Pozisyon pazar kapanmadan BELIRGIN once kaybolduysa satistir.
            # Tampon: bot 2 dk'da bir yokluyor, cozulme damgasi da oynayabilir.
            if kapanis and kayb and (kapanis - kayb).total_seconds() > 600:
                k["cikis"] = k["son_gorulen"]
                k["kaynak_veri"] = "erken satis"
            else:
                k["cikis"] = fiy[idx]
                k["kaynak_veri"] = "cozulme"
            k["net"] = k["size"] * k["cikis"] - k["stake"]
            kesin.append(k)
        else:
            k["neden"] = ("CEKIM HATASI" if closed is None else
                          "pazar hala ACIK" if not closed else
                          "sonuc dizisi eslesmedi")
            belirsiz.append(k)

    json.dump(onb, open(ONBELLEK, "w", encoding="utf-8"))

    if sayac["cekim_hatasi"]:
        oran = 100 * sayac["cekim_hatasi"] / max(1, len(kapanan))
        print(f"!!! {sayac['cekim_hatasi']} pazar CEKILEMEDI (%{oran:.0f}) - "
              f"ornek: {sayac.get('ornek')}")
        if oran > 20:
            print("!!! Cekim orani cok dusuk; asagidaki tablo EKSIK, "
                  "sonuc olarak okuma.")
        print()
    print(f"kapanmis pozisyon: {len(kapanan)}   "
          f"cozulmeden dogrulanan: {len(kesin)}   "
          f"belirsiz: {len(belirsiz)}")
    print()

    say = collections.defaultdict(lambda: {"n": 0, "kazanan": 0,
                                           "stake": 0.0, "pnl": 0.0})
    for k in kesin:
        s = say[k["kaynak"]]
        s["n"] += 1
        s["stake"] += k["stake"]
        s["pnl"] += k["net"]
        if k["net"] > 0:
            s["kazanan"] += 1

    coz = [k for k in kesin if k["kaynak_veri"] == "cozulme"]
    sat = [k for k in kesin if k["kaynak_veri"] == "erken satis"]
    print(f"kapanis sebebi:  cozulme {len(coz)}   trader ERKEN SATTI {len(sat)}")
    print()
    print("KESIN P&L (cozulenler cozulme degerinden, satilanlar satis fiyatindan)")
    print(f"{'kaynak':<20} {'n':>4} {'kazanan':>8} {'stake':>9} "
          f"{'P&L':>9} {'getiri':>8}")
    print("-" * 62)
    for kaynak, s in sorted(say.items(), key=lambda x: -x[1]["pnl"]):
        g = 100 * s["pnl"] / s["stake"] if s["stake"] else 0
        print(f"{kaynak:<20} {s['n']:>4} "
              f"{100*s['kazanan']/s['n']:>7.1f}% {s['stake']:>9.2f} "
              f"{s['pnl']:>+9.2f} {g:>+7.1f}%")

    # TAHMIN ile KESIN arasindaki fark - eski betigin hatasinin buyuklugu
    fark = [k for k in kesin
            if abs(k["son_gorulen"] - k["cikis"]) > 0.01]
    tahmin_top = sum(k["size"] * k["son_gorulen"] - k["stake"] for k in kesin)
    hepsi_coz = sum(k["size"] * (k["cikis"] if k["kaynak_veri"] == "cozulme"
                                 else 0) - k["stake"] for k in kesin)
    kesin_top = sum(k["net"] for k in kesin)
    print()
    print("UC MUHASEBE YAN YANA (ayni 93 pozisyon):")
    print(f"  botun yaptigi   (hepsi son fiyattan)   {tahmin_top:+8.2f}")
    print(f"  DOGRU           (sebebe gore ayrilmis) {kesin_top:+8.2f}")
    print(f"  farki           {kesin_top - tahmin_top:+8.2f}  <- botun muhasebe hatasi")
    print(f"  son gorulen fiyati YANLIS olan pozisyon: {len(fark)}/{len(kesin)}")
    for k in sorted(fark, key=lambda x: -abs(x["son_gorulen"] - x["cikis"]))[:6]:
        print(f"    {k['baslik']:<42} son gorulen {k['son_gorulen']:.3f} "
              f"-> gercek {k['cikis']:.0f}")

    if belirsiz:
        print()
        print(f"BELIRSIZ ({len(belirsiz)}) - toplama KATILMADI:")
        n = collections.Counter(k["neden"] for k in belirsiz)
        for neden, adet in n.most_common():
            print(f"  {neden}: {adet}")


if __name__ == "__main__":
    main()
