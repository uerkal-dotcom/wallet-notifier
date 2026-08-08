"""SALT OKUMA: kagit portfoyunun GIT GECMISINDEN kaynak bazinda P&L cikarir.

Neden gerekli: `paper-portfolio.json` sadece TOPLAM `realizedPnl` tutuyor.
"joblessfinalboss ne durumda" sorusu bu dosyadan cevaplanamiyor - kapanan
pozisyonlar hicbir yerde kaynagiyla birlikte saklanmiyor.

Yontem: dosyanin her commit'indeki halini okur, pozisyon anahtarlarini
takip eder. Bir anahtar KAYBOLDUGUNDA kapanmis demektir; son gorulen
`lastPrice` ile stake'i karsilastirip realize edilen sonucu cikarir.

⚠️ YAKLASIK: son gorulen fiyat, gercek kapanis fiyati OLMAYABILIR (bot iki
commit arasinda kapatmis olabilir). Kapanis 0.99 ustu / 0.01 alti ise
cozulme sayiliyor ve tam 1.00 / 0.00 uygulaniyor.

Hicbir sey yazmaz, hicbir emir gondermez.
Kullanim: python kaynak_bazinda_pnl.py
"""
import collections
import json
import subprocess

DOSYA = "paper-portfolio.json"


def _commitler():
    out = subprocess.run(
        ["git", "log", "--format=%H %ad", "--date=format:%m-%d %H:%M",
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


def main():
    onceki = {}
    kapanan = []
    for h, tarih in _commitler():
        d = _icerik(h)
        if d is None:
            continue
        simdi = d.get("positions") or {}
        for anahtar, p in onceki.items():
            if anahtar in simdi:
                continue
            stake = float(p.get("stake") or 0)
            size = float(p.get("size") or 0)
            son = float(p.get("lastPrice") or 0)
            # cozulmeye cok yakinsa tam degeri uygula
            if son >= 0.99:
                son = 1.0
            elif son <= 0.01:
                son = 0.0
            kapanan.append({
                "kaynak": p.get("source") or "skyman44",
                "baslik": (p.get("title") or "?")[:44],
                "stake": stake,
                "giris": float(p.get("entryPrice") or 0),
                "cikis": son,
                "sonuc": size * son - stake,
                "tarih": tarih,
            })
        onceki = simdi

    if not kapanan:
        print("kapanan pozisyon bulunamadi")
        return

    say = collections.defaultdict(lambda: {"n": 0, "kazanan": 0,
                                           "stake": 0.0, "pnl": 0.0})
    for k in kapanan:
        s = say[k["kaynak"]]
        s["n"] += 1
        s["stake"] += k["stake"]
        s["pnl"] += k["sonuc"]
        if k["sonuc"] > 0:
            s["kazanan"] += 1

    print(f"{'kaynak':<20} {'n':>4} {'kazanan':>8} {'stake':>9} "
          f"{'P&L':>9} {'getiri':>8}")
    print("-" * 62)
    for kaynak, s in sorted(say.items(), key=lambda x: -x[1]["pnl"]):
        getiri = 100 * s["pnl"] / s["stake"] if s["stake"] else 0
        print(f"{kaynak:<20} {s['n']:>4} "
              f"{100*s['kazanan']/s['n']:>7.1f}% {s['stake']:>9.2f} "
              f"{s['pnl']:>+9.2f} {getiri:>+7.1f}%")

    for kaynak in say:
        alt = [k for k in kapanan if k["kaynak"] == kaynak]
        print(f"\n--- {kaynak} ({len(alt)} kapanan) ---")
        for k in alt[-12:]:
            print(f"  {k['tarih']}  {k['baslik']:<44} "
                  f"stake {k['stake']:>5.0f}  {k['giris']:.3f}->{k['cikis']:.3f}  "
                  f"{k['sonuc']:>+7.2f}")


if __name__ == "__main__":
    main()
