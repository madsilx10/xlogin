import fetch from "node-fetch";
import fs from "fs";
import { createInterface } from "readline";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const prompt = (q) => new Promise(r => rl.question(q, a => r(a.trim())));

const BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

async function getGuestToken() {
  const r = await fetch("https://api.twitter.com/1.1/guest/activate.json", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${BEARER}`,
      "content-type": "application/json",
      "user-agent": "TwitterAndroid/10.21.0-release.0",
    },
  });
  const d = await r.json();
  return d.guest_token;
}

async function apiPost(path, body, guest, ct0, authToken, att) {
  const cookie = ct0 ? `ct0=${ct0}; auth_token=${authToken}` : "";
  const r = await fetch(`https://api.twitter.com${path}`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${BEARER}`,
      "content-type": "application/json",
      "user-agent": "TwitterAndroid/10.21.0-release.0",
      "x-twitter-active-user": "yes",
      "x-twitter-client-language": "en",
      "x-guest-token": guest || "",

      ...(ct0 ? { "x-csrf-token": ct0, "cookie": cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  try {
    return { data: JSON.parse(text), headers: r.headers };
  } catch {
    throw new Error(`Response bukan JSON: ${text.slice(0, 100)}`);
  }
}

async function loginAccount(username, password) {
  console.log(`\n[${username}] Mulai login...`);

  const guest = await getGuestToken();
  console.log(`[${username}] ✅ Guest token: ${guest}`);

  // Flow init
  let { data } = await apiPost("/1.1/onboarding/task.json?flow_name=login", {
    input_flow_data: {
      flow_context: { debug_overrides: {}, start_location: { location: "splash_screen" } }
    },
    subtask_versions: {
      contacts_live_sync_permission_prompt: 0,
      email_verification: 2,
      topics_selector: 1,
      wait_spinner: 3,
      cta: 7
    }
  }, guest);

  let flowToken = data.flow_token;
  if (!flowToken) throw new Error(`No flow_token: ${JSON.stringify(data).slice(0,200)}`);

  // JS Instrumentation (required step)
  if (data.subtasks?.[0]?.subtask_id === "LoginJsInstrumentationSubtask") {
    ({ data } = await apiPost("/1.1/onboarding/task.json", {
      flow_token: flowToken,
      subtask_inputs: [{
        subtask_id: "LoginJsInstrumentationSubtask",
        js_instrumentation: { response: "{}", link: "next_link" }
      }]
    }, guest));
    flowToken = data.flow_token;
    console.log(`[${username}] JS Inst: ${JSON.stringify(data).slice(0,300)}`);
  }

  // Username
  ({ data } = await apiPost("/1.1/onboarding/task.json", {
    flow_token: flowToken,
    subtask_inputs: [{
      subtask_id: "LoginEnterUserIdentifierSSO",
      settings_list: {
        setting_responses: [{ key: "user_identifier", response_data: { text_data: { result: username } } }],
        link: "next_link"
      }
    }]
  }, guest));
  flowToken = data.flow_token;
  console.log(`[${username}] Username step: ${JSON.stringify(data).slice(0,300)}`);

  // Password
  ({ data } = await apiPost("/1.1/onboarding/task.json", {
    flow_token: flowToken,
    subtask_inputs: [{
      subtask_id: "LoginEnterPassword",
      enter_password: { password, link: "next_link" }
    }]
  }, guest));
  flowToken = data.flow_token;

  // Cek subtask
  let subtaskId = data.subtasks?.[0]?.subtask_id;
  console.log(`[${username}] Subtask: ${subtaskId}`);

  // OTP
  if (subtaskId === "LoginAcid") {
    const hint = data.subtasks[0]?.enter_text?.hint_text || "email/phone";
    console.log(`[${username}] ⚠️ Butuh verifikasi (${hint})`);
    const otp = await prompt(`[${username}] Masukkan OTP: `);
    ({ data } = await apiPost("/1.1/onboarding/task.json", {
      flow_token: flowToken,
      subtask_inputs: [{ subtask_id: "LoginAcid", enter_text: { text: otp, link: "next_link" } }]
    }, guest));
    flowToken = data.flow_token;
    subtaskId = data.subtasks?.[0]?.subtask_id;
  }

  // Duplication check
  if (subtaskId === "AccountDuplicationCheck") {
    ({ data } = await apiPost("/1.1/onboarding/task.json", {
      flow_token: flowToken,
      subtask_inputs: [{ subtask_id: "AccountDuplicationCheck", check_logged_in_account: { link: "AccountDuplicationCheck_false" } }]
    }, guest));
    flowToken = data.flow_token;
  }

  // Extract cookies dari response
  const setCookies = data.subtasks?.[0]?.open_account?.user?.id_str;
  
  // Coba ambil token dari cookies via endpoint verifikasi
  const verifyR = await fetch("https://api.twitter.com/1.1/account/verify_credentials.json", {
    headers: {
      "authorization": `Bearer ${BEARER}`,
      "x-guest-token": guest,
      "user-agent": "TwitterAndroid/10.21.0-release.0",
    }
  });

  // Parse cookies dari response headers
  const rawCookies = verifyR.headers.raw()["set-cookie"] || [];
  let auth_token = "", ct0 = "";
  for (const c of rawCookies) {
    if (c.includes("auth_token=")) auth_token = c.match(/auth_token=([^;]+)/)?.[1] || "";
    if (c.includes("ct0=")) ct0 = c.match(/ct0=([^;]+)/)?.[1] || "";
  }

  // Fallback: ambil dari open_account
  const openAccount = data.subtasks?.find(s => s.subtask_id === "LoginSuccessSubtask" || s.open_account);
  if (!auth_token && openAccount?.open_account) {
    auth_token = openAccount.open_account.oauth_token || "";
    ct0 = openAccount.open_account.oauth_token_secret || "";
  }

  if (!auth_token) {
    console.log(`[${username}] ❌ Gagal ambil auth_token`);
    console.log(`[${username}] Raw: ${JSON.stringify(data).slice(0, 300)}`);
    return null;
  }

  console.log(`[${username}] ✅ Login berhasil`);
  return { username, auth_token, ct0 };
}

async function main() {
  const raw = fs.readFileSync("twitter_accounts.txt", "utf-8").trim();
  const accounts = raw.split("\n\n").map(block => {
    const lines = block.trim().split("\n").map(l => l.trim());
    return { username: lines[0], password: lines[1] };
  });

  console.log(`Total akun: ${accounts.length}`);

  const results = [];
  for (const { username, password } of accounts) {
    try {
      const data = await loginAccount(username, password);
      if (data) results.push(data);
    } catch (e) {
      console.log(`[${username}] ❌ Error: ${e.message}`);
    }
  }

  fs.writeFileSync("twitter_tokens.json", JSON.stringify(results, null, 2));
  console.log(`\n✅ Selesai! ${results.length}/${accounts.length} berhasil`);
  console.log(`Tersimpan: twitter_tokens.json`);
  rl.close();
}

main().catch(console.error);
