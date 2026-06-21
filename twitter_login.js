import fetch from "node-fetch";
import fs from "fs";
import { createInterface } from "readline";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const prompt = (q) => new Promise(r => rl.question(q, r));

const BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I7wlMpo58Ao%3DPnb1Fu6yZe31TV3Gjm5Of67pHVtnKU4VpXMGSMZqJMm6A5hHGw";

const headers = (guest, ct0, auth) => ({
  "authorization": `Bearer ${BEARER}`,
  "content-type": "application/json",
  "x-twitter-active-user": "yes",
  "x-twitter-client-language": "en",
  ...(guest ? { "x-guest-token": guest } : {}),
  ...(ct0 ? { "x-csrf-token": ct0, "cookie": `ct0=${ct0}; auth_token=${auth}` } : {}),
});

async function getGuestToken() {
  const r = await fetch("https://api.twitter.com/1.1/guest/activate.json", {
    method: "POST",
    headers: { "authorization": `Bearer ${BEARER}` },
  });
  const d = await r.json();
  return d.guest_token;
}

async function initLogin(guest) {
  const r = await fetch("https://api.twitter.com/1.1/onboarding/task.json?flow_name=login", {
    method: "POST",
    headers: headers(guest),
    body: JSON.stringify({
      input_flow_data: { flow_context: { debug_overrides: {}, start_location: { location: "splash_screen" } } },
      subtask_versions: {}
    }),
  });
  const d = await r.json();
  return { flowToken: d.flow_token, subtasks: d.subtasks };
}

async function submitTask(guest, flowToken, subtaskInputs) {
  const r = await fetch("https://api.twitter.com/1.1/onboarding/task.json", {
    method: "POST",
    headers: headers(guest),
    body: JSON.stringify({ flow_token: flowToken, subtask_inputs: subtaskInputs }),
  });
  const d = await r.json();
  return d;
}

async function extractCookies(response) {
  const setCookie = response.headers.raw()["set-cookie"] || [];
  let auth_token = "", ct0 = "";
  for (const c of setCookie) {
    if (c.startsWith("auth_token=")) auth_token = c.split(";")[0].split("=")[1];
    if (c.startsWith("ct0=")) ct0 = c.split(";")[0].split("=")[1];
  }
  return { auth_token, ct0 };
}

async function loginAccount(username, password) {
  console.log(`\n[${username}] Mulai login...`);

  const guest = await getGuestToken();
  console.log(`[${username}] ✅ Guest token OK`);

  let { flowToken } = await initLogin(guest);

  // Submit username
  let res = await submitTask(guest, flowToken, [{
    subtask_id: "LoginEnterUserIdentifierSSO",
    settings_list: {
      setting_responses: [{
        key: "user_identifier",
        response_data: { text_data: { result: username } }
      }],
      link: "next_link"
    }
  }]);
  flowToken = res.flow_token;

  // Submit password
  res = await submitTask(guest, flowToken, [{
    subtask_id: "LoginEnterPassword",
    enter_password: { password, link: "next_link" }
  }]);
  flowToken = res.flow_token;

  // Cek subtask berikutnya
  const subtaskId = res.subtasks?.[0]?.subtask_id;
  console.log(`[${username}] Subtask: ${subtaskId}`);

  // OTP/email verification
  if (subtaskId === "LoginAcid") {
    console.log(`[${username}] ⚠️ Butuh verifikasi`);
    const hint = res.subtasks[0]?.enter_text?.hint_text || "";
    console.log(`[${username}] Kirim kode ke: ${hint}`);
    const otp = await prompt(`[${username}] Masukkan kode OTP: `);
    res = await submitTask(guest, flowToken, [{
      subtask_id: "LoginAcid",
      enter_text: { text: otp, link: "next_link" }
    }]);
    flowToken = res.flow_token;
  }

  // AccountDuplicationCheck
  if (res.subtasks?.[0]?.subtask_id === "AccountDuplicationCheck") {
    res = await submitTask(guest, flowToken, [{
      subtask_id: "AccountDuplicationCheck",
      check_logged_in_account: { link: "AccountDuplicationCheck_false" }
    }]);
    flowToken = res.flow_token;
  }

  // Ambil cookies dari response terakhir
  const r = await fetch("https://api.twitter.com/1.1/onboarding/task.json", {
    method: "POST",
    headers: headers(guest),
    body: JSON.stringify({
      flow_token: flowToken,
      subtask_inputs: [{
        subtask_id: "LoginSuccessSubtask",
        open_link: { link: "next_link" }
      }]
    }),
  });

  const { auth_token, ct0 } = await extractCookies(r);

  if (!auth_token) {
    console.log(`[${username}] ❌ Login gagal - auth_token tidak ditemukan`);
    return null;
  }

  console.log(`[${username}] ✅ Login berhasil`);
  return { username, auth_token, ct0 };
}

async function main() {
  const accounts = fs.readFileSync("twitter_accounts.txt", "utf-8")
    .trim().split("\n\n")
    .map(block => {
      const [username, password] = block.trim().split("\n").map(l => l.trim());
      return { username, password };
    });

  console.log(`\nTotal akun: ${accounts.length}`);

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
  console.log(`\n✅ Selesai! ${results.length}/${accounts.length} akun berhasil`);
  console.log(`Tersimpan di twitter_tokens.json`);
  rl.close();
}

main().catch(console.error);
