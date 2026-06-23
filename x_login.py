#!/usr/bin/env python3
"""
X (Twitter) Login Script
- Support single akun / semua akun dari accounts.txt
- Handle OTP/email verification
- Save session cookies ke folder sessions/
"""

import requests
import json
import os
import time

# ── Constants ──────────────────────────────────────────────────────────────────
BEARER_TOKEN = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LTMGsbGosIfl7vyFn8UCIUrsA17I8TzXDLCX2kbQ1XSB1dHQDFbA"

HEADERS_BASE = {
    "authorization": f"Bearer {BEARER_TOKEN}",
    "content-type": "application/json",
    "user-agent": "Mozilla/5.0 (Linux; Android 11; Termux) AppleWebKit/537.36",
    "x-twitter-active-user": "yes",
    "x-twitter-client-language": "en",
}

SESSIONS_DIR = "sessions"
ACCOUNTS_FILE = "accounts.txt"

# ── Session setup ──────────────────────────────────────────────────────────────
def make_session():
    s = requests.Session()
    s.headers.update(HEADERS_BASE)
    return s

def get_guest_token(s):
    r = s.post("https://api.twitter.com/1.1/guest/activate.json")
    r.raise_for_status()
    token = r.json()["guest_token"]
    s.headers["x-guest-token"] = token
    return token

# ── Login flow ─────────────────────────────────────────────────────────────────
def init_flow(s):
    payload = {
        "flow_name": "login",
        "input_flow_data": {
            "flow_context": {
                "debug_overrides": {},
                "start_location": {"location": "splash_screen"}
            }
        }
    }
    r = s.post(
        "https://api.twitter.com/1.1/onboarding/task.json?flow_name=login",
        json=payload
    )
    r.raise_for_status()
    return r.json()

def next_flow(s, flow_token, subtask_inputs):
    payload = {
        "flow_token": flow_token,
        "subtask_inputs": subtask_inputs
    }
    r = s.post("https://api.twitter.com/1.1/onboarding/task.json", json=payload)
    r.raise_for_status()
    return r.json()

def get_subtask_id(flow_resp):
    subtasks = flow_resp.get("subtasks", [])
    if subtasks:
        return subtasks[0].get("subtask_id", "")
    return ""

# ── Login steps ────────────────────────────────────────────────────────────────
def login(username, password):
    s = make_session()
    print(f"  [*] Getting guest token...")
    get_guest_token(s)

    print(f"  [*] Init login flow...")
    flow = init_flow(s)
    flow_token = flow["flow_token"]

    # Step 1: JS instrumentation
    print(f"  [*] Step 1: instrumentation...")
    flow = next_flow(s, flow_token, [{
        "subtask_id": "LoginJsInstrumentationSubtask",
        "js_instrumentation": {
            "response": json.dumps({"rf": {}, "s": ""}),
            "link": "next_link"
        }
    }])
    flow_token = flow["flow_token"]

    # Step 2: Enter username
    print(f"  [*] Step 2: username...")
    flow = next_flow(s, flow_token, [{
        "subtask_id": "LoginEnterUserIdentifierSSO",
        "settings_list": {
            "setting_responses": [{
                "key": "user_identifier",
                "response_data": {"text_data": {"result": username}}
            }],
            "link": "next_link"
        }
    }])
    flow_token = flow["flow_token"]
    subtask = get_subtask_id(flow)

    # Handle unusual activity check (kadang X minta username lagi)
    if subtask == "LoginEnterAlternateIdentifierSubtask":
        print(f"  [!] X minta verifikasi tambahan (username/email/phone):")
        alt = input("  Masukkan username/email/no HP terdaftar: ").strip()
        flow = next_flow(s, flow_token, [{
            "subtask_id": "LoginEnterAlternateIdentifierSubtask",
            "enter_text": {"text": alt, "link": "next_link"}
        }])
        flow_token = flow["flow_token"]

    # Step 3: Enter password
    print(f"  [*] Step 3: password...")
    flow = next_flow(s, flow_token, [{
        "subtask_id": "LoginEnterPassword",
        "enter_password": {"password": password, "link": "next_link"}
    }])
    flow_token = flow["flow_token"]
    subtask = get_subtask_id(flow)

    # Step 4: Handle OTP / email verification
    if subtask in ("LoginAcid", "ArkoseLogin"):
        print(f"  [!] OTP diminta!")
        otp = input("  Masukkan kode OTP dari email/SMS: ").strip()
        flow = next_flow(s, flow_token, [{
            "subtask_id": subtask,
            "enter_text": {"text": otp, "link": "next_link"}
        }])
        flow_token = flow["flow_token"]
        subtask = get_subtask_id(flow)

    # Step 5: Account duplication check
    if subtask == "AccountDuplicationCheck":
        flow = next_flow(s, flow_token, [{
            "subtask_id": "AccountDuplicationCheck",
            "check_logged_in_account": {"link": "AccountDuplicationCheck_false"}
        }])
        flow_token = flow["flow_token"]

    # Cek sukses
    subtask = get_subtask_id(flow)
    if subtask not in ("", None) and "LoginSuccess" not in subtask:
        print(f"  [?] Subtask tidak dikenal: {subtask}")
        print(f"  Response: {json.dumps(flow, indent=2)[:500]}")
        return None

    # Ambil auth token dari cookies
    cookies = dict(s.cookies)
    if "auth_token" not in cookies:
        print(f"  [!] Login gagal — auth_token tidak ditemukan")
        return None

    print(f"  [+] Login berhasil!")
    return cookies

# ── Save / load session ────────────────────────────────────────────────────────
def save_session(username, cookies):
    os.makedirs(SESSIONS_DIR, exist_ok=True)
    path = os.path.join(SESSIONS_DIR, f"{username}.json")
    with open(path, "w") as f:
        json.dump(cookies, f, indent=2)
    print(f"  [+] Session disimpan: {path}")

def load_session(username):
    path = os.path.join(SESSIONS_DIR, f"{username}.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return None

# ── Process accounts ───────────────────────────────────────────────────────────
def process_account(username, password):
    print(f"\n{'='*50}")
    print(f"Akun: @{username}")

    existing = load_session(username)
    if existing and "auth_token" in existing:
        print(f"  [~] Session sudah ada, skip login")
        return True

    try:
        cookies = login(username, password)
        if cookies:
            save_session(username, cookies)
            return True
        return False
    except requests.HTTPError as e:
        print(f"  [!] HTTP Error: {e.response.status_code} - {e.response.text[:200]}")
        return False
    except Exception as e:
        print(f"  [!] Error: {e}")
        return False

def load_accounts():
    if not os.path.exists(ACCOUNTS_FILE):
        print(f"[!] File {ACCOUNTS_FILE} tidak ditemukan!")
        print(f"    Buat file dengan format: username:password (satu per baris)")
        return []
    accounts = []
    with open(ACCOUNTS_FILE) as f:
        for line in f:
            line = line.strip()
            if line and ":" in line:
                parts = line.split(":", 1)
                accounts.append((parts[0].strip(), parts[1].strip()))
    return accounts

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    print("=== X Login Script ===")
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
        for i, (u, _) in enumerate(accounts, 1):
            status = "✓ ada session" if load_session(u) else "  belum login"
            print(f"  {i}. @{u}  [{status}]")
        idx = input("\nPilih nomor akun: ").strip()
        try:
            idx = int(idx) - 1
            if 0 <= idx < len(accounts):
                u, p = accounts[idx]
                process_account(u, p)
            else:
                print("[!] Nomor tidak valid")
        except ValueError:
            print("[!] Input tidak valid")

    elif choice == "2":
        success = 0
        for u, p in accounts:
            ok = process_account(u, p)
            if ok:
                success += 1
            time.sleep(2)  # jeda antar akun biar gak rate limit
        print(f"\n{'='*50}")
        print(f"Selesai: {success}/{len(accounts)} akun berhasil")

    else:
        print("[!] Pilihan tidak valid")

if __name__ == "__main__":
    main()
