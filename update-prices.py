# Auto price updater for Namakkal - runs daily 6:05 AM
# Tries public sources, falls back to last price if network blocks
import json, re, os, datetime, urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
PRICE_FILE = os.path.join(BASE, "prices.json")

def load_old():
    try:
        with open(PRICE_FILE) as f: return json.load(f)
    except: return {"petrol_ltr":108.7,"diesel_ltr":93.06,"cng_kg":89.5}

def fetch_businessline():
    # Businessline page has: Namakkal ₹108.70 pattern
    url = "https://www.thehindubusinessline.com/fuel-prices/petrol-price-today/tamil-nadu/namakkal/"
    req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"})
    html = urllib.request.urlopen(req, timeout=15).read().decode("utf-8", "ignore")
    # find first ₹xxx.xx near Namakkal
    m = re.search(r"₹\s?(\d{2,3}\.\d{2})", html)
    if m: return float(m.group(1))
    return None

def fetch_ndtv_diesel():
    # NDTV diesel page fallback - parse Diesel (₹/L)93.06 pattern
    try:
        url = "https://www.ndtv.com/fuel-prices/diesel-price-in-namakkal-city"
        req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"})
        html = urllib.request.urlopen(req, timeout=15).read().decode("utf-8","ignore")
        m = re.search(r"Diesel[^\d]{0,20}(\d{2,3}\.\d{2})", html)
        if m: return float(m.group(1))
    except Exception as e:
        print("diesel fetch fail:", e)
    return None

def main():
    old = load_old()
    petrol, diesel = old.get("petrol_ltr"), old.get("diesel_ltr")
    try:
        p = fetch_businessline()
        if p and 80 < p < 130:
            petrol = p
            print(f"scraped petrol={p}")
        else:
            print("petrol scrape empty, keep old")
    except Exception as e:
        print("petrol fetch fail:", e)
    try:
        d = fetch_ndtv_diesel()
        if d and 70 < d < 120:
            diesel = d
            print(f"scraped diesel={d}")
    except Exception as e:
        print("diesel fail:", e)

    out = {
        "city": "Namakkal",
        "state": "Tamil Nadu",
        "date": datetime.date.today().isoformat(),
        "petrol_ltr": petrol,
        "diesel_ltr": diesel,
        "cng_kg": old.get("cng_kg", 89.5),
        "cng_note": "IRM Energy Namakkal range - rarely changes, confirm at bunk",
        "source": "auto-updater Businessline/NDTV scraped + fallback",
        "updated_at": datetime.datetime.now().isoformat()
    }
    with open(PRICE_FILE, "w") as f: json.dump(out, f, indent=2)
    print("wrote", PRICE_FILE, out)
    # append to 30-day history so trend never rots
    try:
        HF = os.path.join(BASE, "price-history.json")
        hist = []
        try: hist = json.load(open(HF))
        except: hist = []
        today = datetime.date.today().isoformat()
        hist = [h for h in hist if h.get("date") != today]
        hist.append({"date": today, "petrol": petrol, "diesel": diesel})
        hist = hist[-30:]
        json.dump(hist, open(HF, "w"), indent=1)
        print("history appended", today)
    except Exception as e:
        print("history fail:", e)

if __name__ == "__main__":
    main()