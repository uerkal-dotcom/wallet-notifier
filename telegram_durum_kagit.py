"""POLYCAT "DURUM" KOMUTU - kagit portfoyun tam + gunluk ozeti.

Kullanici istegi (2026-08-08): *"ayni seyi polycat icin de yap - durum
yazinca full durum ve gunluk durum ciksin"*. Polycat = wallet-notifier'in
Telegram botu (skyman44 kopya-takip bildirimleri buradan gelir).

Calisma sekli hedge-bot'taki telegram_durum.py ile ayni desen:
  - AYRI SUREC, Windows gorevi (TelegramDurumKagit, 5 dk tetik + bayt-0
    kilit) - oturumdan bagimsiz, olurse dirilir.
  - Yalniz bizim chat_id'ye cevap verir; SADECE OKUR, islem acmaz.
  - Tazelik: her soruda once `git pull --ff-only` (portfoyu GitHub
    Actions guncelliyor, yerel kopya geride kalabilir). Pull olmazsa
    eldeki dosya + yas uyarisi.

Kullanim:
  python telegram_durum_kagit.py          # dinleyici (gorev bunu kosar)
  python telegram_durum_kagit.py --test   # tek rapor gonder, cik
"""
import asyncio
import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx
from dotenv import load_dotenv

KOK = Path(__file__).parent
load_dotenv(KOK / ".env")
TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
CHAT = os.environ.get("TELEGRAM_CHAT_ID", "")

PORTFOY = KOK / "paper-portfolio.json"
OFSET = KOK / ".telegram-durum-kagit-ofset.json"
TETIKLER = {"durum", "/durum", "durum?", "status", "/status", "rapor", "/rapor"}


def _kilit():
    handle = (KOK / ".telegram-durum-kagit.lock").open("a+")
    try:
        import msvcrt
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        sys.exit(0)
    return handle


def _tazele() -> str:
    """GitHub'daki guncel portfoyu ceker; sonucu tek satir not olarak doner."""
    try:
        r = subprocess.run(
            ["git", "pull", "--ff-only", "origin", "master"],
            cwd=KOK, capture_output=True, text=True, timeout=30)
        if r.returncode == 0:
            return ""
    except Exception:
        pass
    try:
        yas_dk = (time.time() - PORTFOY.stat().st_mtime) / 60
        return f"(uyari: guncelleme cekilemedi, veri ~{yas_dk:.0f} dk eski olabilir)\n"
    except Exception:
        return "(uyari: guncelleme cekilemedi)\n"


def rapor_metni() -> str:
    onek = _tazele()
    try:
        d = json.loads(PORTFOY.read_text("utf-8"))
    except Exception:
        return onek + "Portfoy dosyasi okunamadi."

    poz = list((d.get("positions") or {}).values())
    parcalar = [onek + "KAGIT PORTFOY (kopya ticaret - gercek para DEGIL)"]

    # FULL DURUM
    bakiye = float(d.get("balance") or 0)
    gerceklesen = float(d.get("realizedPnl") or 0)
    kagit_acik = 0.0
    stake_toplam = 0.0
    anlik_deger = 0.0
    for p in poz:
        son = p.get("lastPrice")
        stake_toplam += float(p.get("stake") or 0)
        if son is not None:
            anlik_deger += float(p["size"]) * float(son)
            kagit_acik += float(p["size"]) * float(son) - float(p.get("stake") or 0)
    # "Bakiye" tek basina yaniltiyordu (kullanici 2026-08-08: "380'den
    # baslatmistik, 296 gozukuyor"): dosyadaki balance SERBEST paradir,
    # acik pozisyonlara baglanan stake dusulmus halde. Baslangic ve
    # toplam varlik acikca yazilir.
    baslangic = bakiye + stake_toplam - gerceklesen
    varlik = bakiye + anlik_deger
    parcalar.append(
        f"Baslangic {baslangic:.2f} -> TOPLAM VARLIK {varlik:.2f} "
        f"({varlik - baslangic:+.2f})")
    parcalar.append(
        f"Serbest para {bakiye:.2f} | acik pozisyonlarda bagli "
        f"{stake_toplam:.2f} (anlik degeri {anlik_deger:.2f}) | "
        f"gerceklesen {gerceklesen:+.2f} | aciklarin kagit K/Z {kagit_acik:+.2f}")
    parcalar.append(f"Acik {len(poz)} pozisyon:")
    for p in sorted(poz, key=lambda x: -(x.get("notifiedAt") or 0)):
        son = p.get("lastPrice")
        fark = ""
        if son is not None:
            k = float(p["size"]) * float(son) - float(p.get("stake") or 0)
            fark = f" -> {'🟢' if k > 0 else ('🔴' if k < -0.005 else '⚪')} {k:+.2f}"
        baslik = (p.get("title") or p.get("slug") or "?")
        if ": " in baslik:
            baslik = baslik.split(": ", 1)[1]
        baslik = baslik.split(" - ")[0][:48]
        parcalar.append(
            f"  {baslik} | {p.get('outcome')} @ {p.get('entryPrice')}"
            f" ({p.get('source')}){fark}")

    # GUNLUK DURUM (bugun acilanlar; kapananlar dosyadan dusuyor -
    # gunluk kapanis dokumu icin kesin muhasebe betigi gerekir)
    gun_basi = datetime.now().replace(hour=0, minute=0, second=0,
                                      microsecond=0).timestamp() * 1000
    bugun = [p for p in poz if (p.get("notifiedAt") or 0) >= gun_basi]
    if bugun:
        parcalar.append(f"Bugun acilan {len(bugun)} pozisyon (yukarida en ustte).")
    else:
        parcalar.append("Bugun yeni pozisyon acilmadi.")
    parcalar.append("Saat " + datetime.now().strftime("%H:%M")
                    + ". Kesin kapanis muhasebesi aksam raporunda.")
    return "\n".join(parcalar)


async def _gonder(metin: str):
    async with httpx.AsyncClient(timeout=20) as c:
        for _ in range(2):
            try:
                r = await c.post(
                    f"https://api.telegram.org/bot{TOKEN}/sendMessage",
                    json={"chat_id": CHAT, "text": metin})
                r.raise_for_status()
                return
            except Exception:
                await asyncio.sleep(3)


async def dinle():
    try:
        ofset = json.loads(OFSET.read_text("utf-8")).get("ofset", 0)
    except Exception:
        ofset = 0
    print("polycat durum dinleyicisi basladi", flush=True)
    while True:
        try:
            async with httpx.AsyncClient(timeout=40) as c:
                r = await c.get(
                    f"https://api.telegram.org/bot{TOKEN}/getUpdates",
                    params={"timeout": 25, "offset": ofset + 1,
                            "allowed_updates": '["message"]'})
                r.raise_for_status()
                veriler = r.json().get("result", [])
            for u in veriler:
                ofset = max(ofset, u.get("update_id", 0))
                msg = u.get("message") or {}
                if str((msg.get("chat") or {}).get("id")) != str(CHAT):
                    continue
                if (msg.get("text") or "").strip().lower() in TETIKLER:
                    await _gonder(rapor_metni())
            if veriler:
                OFSET.write_text(json.dumps({"ofset": ofset}), "utf-8")
        except Exception as exc:
            print(f"dinleyici hatasi: {type(exc).__name__}: {exc}", flush=True)
            await asyncio.sleep(10)


if __name__ == "__main__":
    if not TOKEN or not CHAT:
        print("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID bulunamadi (.env).")
        sys.exit(1)
    _handle = _kilit()
    if "--test" in sys.argv:
        print(rapor_metni())
        asyncio.run(_gonder("(test) " + rapor_metni()))
    else:
        asyncio.run(dinle())
