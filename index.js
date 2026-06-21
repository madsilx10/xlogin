import { ethers } from "ethers";
import { createInterface } from "readline";
import fs from "fs";

// ============ CONFIG ============
const REFERRAL_CODE = "invincible-inferno-6364";
const PRIVY_APP_ID = "cmdonap9700d3ky0jcrppiz4x";
const PRIVY_CA_ID = "ff0b9728-e059-4245-b816-a1e516520407";
const CHAIN_ID = "eip155:21894";
const BASE_URL = "https://evm-api.pulsar.money";
const PRIVY_URL = "https://auth.privy.io";

// ============ HELPERS ============
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

function loadWallets() {
  return fs.readFileSync("wallets.txt", "utf-8")
    .split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
}

function loadAnswers() {
  const raw = fs.readFileSync("answers.txt", "utf-8").replace(/\r/g, "");
  return raw.split(/\n\s*\n/).map(block =>
    block.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"))
    .map(l => ({ text: l }))
  ).filter(g => g.length > 0);
}

const icon = (s) => s === "SUCCESSFUL" ? "✅" : s === "PENDING" ? "⏳" : s === "ERROR" ? "❌" : "?";
const log = (msg) => console.log(msg);

// ============ AUTH ============
function privyHeaders() {
  return {
    "Content-Type": "application/json",
    "privy-app-id": PRIVY_APP_ID,
    "privy-ca-id": PRIVY_CA_ID,
    "privy-client": "react-auth:3.21.3",
    "Origin": "https://app.ethraship.io",
    "Referer": "https://app.ethraship.io/",
  };
}

function apiHeaders(token) {
  return {
    "Content-Type": "application/json",
    "X-Privy-Access-Token": `Bearer ${token}`,
    "Origin": "https://app.ethraship.io",
  };
}

async function login(wallet) {
  const { nonce } = await fetch(`${PRIVY_URL}/api/v1/siwe/init`, {
    method: "POST", headers: privyHeaders(),
    body: JSON.stringify({ address: wallet.address }),
  }).then(r => r.json());

  const issuedAt = new Date().toISOString();
  const message =
    `app.ethraship.io wants you to sign in with your Ethereum account:\n${wallet.address}\n\n` +
    `By signing, you are proving you own this wallet and logging in. This does not initiate a transaction or cost any fees.\n\n` +
    `URI: https://app.ethraship.io\nVersion: 1\nChain ID: 21894\nNonce: ${nonce}\nIssued At: ${issuedAt}\nResources:\n- https://privy.io`;

  const signature = await wallet.signMessage(message);

  const data = await fetch(`${PRIVY_URL}/api/v1/siwe/authenticate`, {
    method: "POST", headers: privyHeaders(),
    body: JSON.stringify({ message, signature, chainId: CHAIN_ID, walletClientType: "metamask", connectorType: "injected", mode: "login-or-sign-up", referralCode: REFERRAL_CODE }),
  }).then(r => r.json());

  if (!data.token) throw new Error("Login gagal: " + JSON.stringify(data));
  return data.token;
}

// ============ REFERRAL ============
async function createReferral(token) {
  await fetch(`${BASE_URL}/challenges/ethra-portal/create-referral/2`, {
    method: "POST", headers: apiHeaders(token),
    body: JSON.stringify({ referralCode: REFERRAL_CODE }),
  });
}


// ============ CONNECT X ============
function loadXTokens() {
  try {
    const raw = fs.readFileSync("xtoken.txt", "utf-8").replace(/\r/g, "");
    return raw.split(/\n\s*\n/).map(block => {
      const lines = block.trim().split("\n").map(l => l.trim());
      return { username: lines[0], auth_token: lines[1], ct0: lines[2] };
    }).filter(t => t.auth_token && t.ct0);
  } catch { return []; }
}

async function connectTwitter(token, xtoken, w) {
  // Step 1: Register twitter - dapet OAuth params
  const reg = await fetch(`${BASE_URL}/social-pay/register/twitter`, {
    method: "POST", headers: apiHeaders(token),
    body: JSON.stringify({ type: "register", redirectUrl: "https://app.ethraship.io/" }),
  }).then(r => r.json());

  if (!reg.authUrl) {
    log(`${w} ❌ Connect X: gagal dapet authUrl`);
    return false;
  }

  const url = new URL(reg.authUrl);
  const client_id = url.searchParams.get("client_id");
  const code_challenge = url.searchParams.get("code_challenge");
  const state = url.searchParams.get("state");
  const redirect_uri = url.searchParams.get("redirect_uri");
  const scope = url.searchParams.get("scope");

  // Step 2: GET authorize page (init session)
  const authUrl = `https://x.com/i/api/2/oauth2/authorize?client_id=${client_id}&code_challenge=${code_challenge}&code_challenge_method=plain&redirect_uri=${encodeURIComponent(redirect_uri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}`;
  
  const initRes = await fetch(authUrl, {
    headers: {
      "Authorization": `Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA`,
      "Cookie": `auth_token=${xtoken.auth_token}; ct0=${xtoken.ct0}`,
      "X-Csrf-Token": xtoken.ct0,
      "X-Twitter-Auth-Type": "OAuth2Session",
      "X-Twitter-Active-User": "yes",
      "X-Twitter-Client-Language": "en",
    }
  }).then(r => r.json());

  if (!initRes.auth_code) {
    // Step 3: POST approve
    const approveRes = await fetch("https://x.com/i/api/2/oauth2/authorize", {
      method: "POST",
      headers: {
        "Authorization": `Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": `auth_token=${xtoken.auth_token}; ct0=${xtoken.ct0}`,
        "X-Csrf-Token": xtoken.ct0,
        "X-Twitter-Auth-Type": "OAuth2Session",
        "X-Twitter-Active-User": "yes",
      },
      body: `approval=true&code=${initRes.auth_code || ""}&client_id=${client_id}&redirect_uri=${encodeURIComponent(redirect_uri)}&response_type=code&state=${state}&code_challenge=${code_challenge}&code_challenge_method=plain`
    }).then(r => r.json());

    if (!approveRes.redirect_uri) {
      log(`${w} ❌ Connect X: gagal approve (${JSON.stringify(approveRes).slice(0,100)})`);
      return false;
    }

    const code = new URL(approveRes.redirect_uri).searchParams.get("code");
    
    // Step 4: Callback ke EthraShip
    const cbRes = await fetch(`${BASE_URL}/social-pay/register/twitter/callback?code=${code}&state=${state}`, {
      headers: apiHeaders(token),
    }).then(r => r.json());

    if (cbRes.refresh_token) {
      // Step 5: Update Privy session
      await fetch(`${PRIVY_URL}/api/v1/sessions`, {
        method: "POST",
        headers: { ...privyHeaders(), "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ refresh_token: cbRes.refresh_token }),
      });
      log(`${w} ✅ Connect X: ${xtoken.username}`);
      return true;
    }
  }

  log(`${w} ❌ Connect X gagal`);
  return false;
}

// ============ TASKS ============
async function getTasks(token) {
  const r = await fetch(`${BASE_URL}/challenges/ethra-portal/tasks-status/2`, { headers: apiHeaders(token) }).then(r => r.json());
  const tasks = r.tasksStatus || [];
  log(`   Raw tasks: ${tasks.length}, quiz: ${tasks.filter(t=>t.taskName==='questionnaire').length}`);
  return tasks;
}

async function doTask(token, taskGuid, extraArguments = []) {
  return fetch(`${BASE_URL}/challenges/do-task`, {
    method: "POST", headers: apiHeaders(token),
    body: JSON.stringify({ taskGuid, extraArguments }),
  }).then(r => r.json());
}

// ============ TASK RUNNERS ============
async function runSimpleTask(token, task, w) {
  if (task.status === "SUCCESSFUL") {
    log(`${w} ✅ ${task.title}`);
    return;
  }
  const r = await doTask(token, task.taskGuid);
  const pts = r.points ? ` (${parseFloat(r.points).toFixed(0)}p)` : '';
  log(`${w} ${icon(r.state)} ${task.title}${pts}`);
}

async function runQuestionnaire(token, task, answers, w) {
  if (task.status === "SUCCESSFUL") {
    log(`${w} ✅ ${task.title}`);
    return;
  }
  if (!answers || answers.length === 0) {
    log(`${w} - ${task.title} (no answers)`);
    return;
  }
  for (let i = 0; i < answers.length; i++) {
    const { text } = answers[i];
    const r = await doTask(token, task.taskGuid, [String(i), text]);
    if (r.state === "SUCCESSFUL") log(`${w} ✅ ${task.title}`);
    await sleep(1000);
  }
}

// ============ MAIN RUNNER ============
async function runWallet(privateKey, answers, idx, xTokens = []) {
  const wallet = new ethers.Wallet(privateKey);
  const w = `[Wallet ${idx+1}]`;
  log(`\n${w} Mulai...`);
  log(`${w} ${wallet.address}`);

  let token;
  try {
    token = await login(wallet);
    try { await createReferral(token); } catch (_) {}
    log(`${w} ✅ Login OK`);
    // Connect X
    if (xTokens.length > 0) {
      const xt = xTokens[idx % xTokens.length];
      try { await connectTwitter(token, xt, w); } catch (e) { log(`${w} ❌ Connect X error: ${e.message}`); }
    }
  } catch (e) {
    log(`${w} ❌ Login gagal: ${e.message}`);
    return;
  }

  let tasks;
  try {
    tasks = await getTasks(token);
  } catch (e) {
    log(`${w} ❌ Fetch tasks gagal: ${e.message}`);
    return;
  }

  const done = tasks.filter(t => t.status === "SUCCESSFUL").length;
  log(`${w} ${done}/${tasks.length} task selesai`);

  let quizIdx = 0;
  for (const task of tasks) {
    try {
      if (task.taskName === "click_link") {
        await runSimpleTask(token, task, w);
      } else if (task.taskName === "retweet_post") {
        await runSimpleTask(token, task, w);
      } else if (task.taskName === "questionnaire") {
        await runQuestionnaire(token, task, answers[quizIdx], w);
        quizIdx++;
      }
      if (task.status !== "SUCCESSFUL") await sleep(1500);
    } catch (e) {
      log(`${w} ❌ Error: ${e.message}`);
    }
  }

  log(`${w} ✅ Selesai!`);
}

// ============ ENTRY ============
async function main() {
  log("\n  EthraShip Bot");
  log("  ─────────────");
  log("  1. 1 wallet");
  log("  2. Semua wallet");
  log("  3. Dari wallet ke-N\n");

  const choice = await prompt("Pilih: ");
  const wallets = loadWallets();
  const answers = loadAnswers();
  const xTokens = loadXTokens();
  log(`   Answers loaded: ${answers.length} quiz`);
  let selected = [];

  if (choice === "1") {
    const n = parseInt(await prompt(`Wallet ke (1-${wallets.length}): `)) - 1;
    if (n < 0 || n >= wallets.length) { log("Tidak valid."); process.exit(1); }
    selected = [{ key: wallets[n], idx: n }];
  } else if (choice === "2") {
    selected = wallets.map((key, idx) => ({ key, idx }));
  } else if (choice === "3") {
    const n = parseInt(await prompt(`Mulai dari wallet ke (1-${wallets.length}): `)) - 1;
    selected = wallets.slice(n).map((key, i) => ({ key, idx: n + i }));
  } else {
    log("Tidak valid."); process.exit(1);
  }

  log(`\n  Total: ${selected.length} wallet\n`);

  for (let i = 0; i < selected.length; i++) {
    await runWallet(selected[i].key, answers, selected[i].idx, xTokens);
    if (i < selected.length - 1) await sleep(3000);
  }

  log("\n  ✅ Semua wallet selesai\n");
}

main().catch(console.error);
