import { Scraper } from "agent-twitter-client";
import fs from "fs";
import { createInterface } from "readline";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const prompt = (q) => new Promise(r => rl.question(q, a => r(a.trim())));

async function loginAccount(username, password, email) {
  console.log(`\n[${username}] Mulai login...`);
  const scraper = new Scraper();

  try {
    await scraper.login(username, password, email);
    const loggedIn = await scraper.isLoggedIn();
    if (!loggedIn) throw new Error("Login gagal");

    const cookies = await scraper.getCookies();
    const auth_token = cookies.find(c => c.key === "auth_token")?.value || "";
    const ct0 = cookies.find(c => c.key === "ct0")?.value || "";

    if (!auth_token) throw new Error("auth_token tidak ditemukan");

    console.log(`[${username}] ✅ Login berhasil`);
    return { username, auth_token, ct0 };
  } catch (e) {
    console.log(`[${username}] ❌ ${e.message}`);
    return null;
  }
}

async function main() {
  const raw = fs.readFileSync("twitter_accounts.txt", "utf-8").trim();
  const accounts = raw.split("\n\n").map(block => {
    const lines = block.trim().split("\n").map(l => l.trim());
    return { username: lines[0], password: lines[1], email: lines[2] || "" };
  });

  console.log(`Total akun: ${accounts.length}`);

  const results = [];
  for (const { username, password, email } of accounts) {
    const data = await loginAccount(username, password, email);
    if (data) results.push(data);
  }

  fs.writeFileSync("twitter_tokens.json", JSON.stringify(results, null, 2));
  console.log(`\n✅ Selesai! ${results.length}/${accounts.length} berhasil`);
  console.log(`Tersimpan: twitter_tokens.json`);
  rl.close();
}

main().catch(console.error);
