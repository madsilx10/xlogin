#!/usr/bin/env python3
"""
X (Twitter) Login Script — pakai twikit
- Support single akun / semua akun dari accounts.txt
- Format accounts.txt: username:email:password
- Handle OTP otomatis (input manual)
- Save session cookies ke folder sessions/
"""

import asyncio
import os
import time

try:
    from twikit import Client
    from twikit.errors import BadRequest, Unauthorized, TweetNotAvailable
except ImportError:
    print("[!] twikit belum terinstall. Jalankan:")
    print("    pip install twikit")
    exit(1)

SESSIONS_DIR = "sessions"
ACCOUNTS_FILE = "accounts.txt"

# ── Login ──────────────────────────────────────────────────────────────────────
async def login(username, email, password):
    client = Client("en-US")
    cookies_path = os.path.join(SESSIONS_DIR, f"{username}.json")

    # Cek session existing
    if os.path.exists(cookies_path):
        print(f"  [~] Session sudah ada, skip login")
        return True

    print(f"  [*] Mencoba login...")
    try:
        await client.login(
            auth_info_1=username,
            auth_info_2=email,
            password=password
        )
        os.makedirs(SESSIONS_DIR, exist_ok=True)
        client.save_cookies(cookies_path)
        print(f"  [+] Login berhasil! Session disimpan: {cookies_path}")
        return True

    except Exception as e:
        err = str(e).lower()

        # Handle OTP / email verification
        if "challenge" in err or "verification" in err or "acid" in err:
            print(f"  [!] OTP diminta!")
            otp = input("  Masukkan kode OTP dari email/SMS: ").strip()
            try:
                # twikit handle challenge via task
                await client.login(
                    auth_info_1=username,
                    auth_info_2=email,
                    password=password,
                    auth_info_2_fallback=otp
                )
                os.makedirs(SESSIONS_DIR, exist_ok=True)
                client.save_cookies(cookies_path)
                print(f"  [+] Login berhasil setelah OTP!")
                return True
            except Exception as e2:
                print(f"  [!] Gagal setelah OTP: {e2}")
                return False

        print(f"  [!] Login gagal: {e}")
        return False

# ── Load accounts ──────────────────────────────────────────────────────────────
def load_accounts():
    if not os.path.exists(ACCOUNTS_FILE):
        print(f"[!] File {ACCOUNTS_FILE} tidak ditemukan!")
        print(f"    Buat file dengan format (3 baris per akun):")
        print(f"    username")
        print(f"    email")
        print(f"    password")
        print(f"    (pisah antar akun dengan baris kosong)")
        return []

    accounts = []
    with open(ACCOUNTS_FILE) as f:
        lines = [l.strip() for l in f.readlines()]

    # Filter baris kosong jadi separator, kumpulkan per grup 3
    chunks = []
    current = []
    for line in lines:
        if line.startswith("#"):
            continue
        if line == "":
            if current:
                chunks.append(current)
                current = []
        else:
            current.append(line)
    if current:
        chunks.append(current)

    for chunk in chunks:
        if len(chunk) >= 3:
            accounts.append((chunk[0], chunk[1], chunk[2]))
        else:
            print(f"  [!] Data akun tidak lengkap, skip: {chunk}")

    return accounts

def session_exists(username):
    return os.path.exists(os.path.join(SESSIONS_DIR, f"{username}.json"))

# ── Main ───────────────────────────────────────────────────────────────────────
async def main():
    print("=== X Login Script (twikit) ===")
    print(f"Sessions disimpan di: ./{SESSIONS_DIR}/\n")

    accounts = load_accounts()
    if not accounts:
        return

    print(f"Ditemukan {len(accounts)} akun di {ACCOUNTS_FILE}")
    print("\nPilih mode:")
    print("  1. Login 1 akun")
    print("  2. Login semua akun")
    choice = input("\nPilihan (1/2): ").strip()

    if choice == "1":
        print("\nDaftar akun:")
        for i, (u, e, _) in enumerate(accounts, 1):
            status = "✓ ada session" if session_exists(u) else "  belum login"
            print(f"  {i}. @{u}  [{status}]")

        idx = input("\nPilih nomor akun: ").strip()
        try:
            idx = int(idx) - 1
            if 0 <= idx < len(accounts):
                u, e, p = accounts[idx]
                print(f"\n{'='*50}")
                print(f"Akun: @{u}")
                await login(u, e, p)
            else:
                print("[!] Nomor tidak valid")
        except ValueError:
            print("[!] Input tidak valid")

    elif choice == "2":
        success = 0
        for u, e, p in accounts:
            print(f"\n{'='*50}")
            print(f"Akun: @{u}")
            ok = await login(u, e, p)
            if ok:
                success += 1
            time.sleep(2)

        print(f"\n{'='*50}")
        print(f"Selesai: {success}/{len(accounts)} akun berhasil")

    else:
        print("[!] Pilihan tidak valid")

if __name__ == "__main__":
    asyncio.run(main())
