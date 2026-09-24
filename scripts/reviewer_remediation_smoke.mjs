import { readFileSync } from "node:fs";
import { createAccount, createClient, isSuccessful } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";

const contractAddress = "0x6bF7a01031d3371aB23Adb76e3c907F968C7458A";
const roundId = "review-v046-single-20260924";
const clockReferenceHash = "0x7a63b1c9960c964d4d2f2099d059182a794027ddc528a721f2a8762f7f8eae6f";
const expectedConfigDigest = "09c4c9ad79f9f9432b36d0a4b21eb7138ee745abb46543badac92cce1e470633";
const GEN = 1_000_000_000_000_000_000n;
const chain = { ...studioDevnet, name: "GenLayer Studio Dev",
  rpcUrls: { default: { http: ["https://studio-next.genlayer.com/api"] } } };

function authorizedAccounts() {
  const text = readFileSync(new URL("../../.env", import.meta.url), "utf8");
  const names = ["STUDIONET_PRIVATE_KEY", "STUDIONET_INTEGRATOR_PRIVATE_KEY", "STUDIONET_STEWARD_PRIVATE_KEY"];
  return names.map((name) => {
    const match = text.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, "m"));
    if (!match) throw new Error(`${name} is required`);
    return createAccount(match[1].replace(/^['\"]|['\"]$/g, ""));
  });
}

const accounts = authorizedAccounts();
const clients = accounts.map((account) => createClient({ chain, account }));
const readClient = createClient({ chain });

async function readJson(functionName, args) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      return JSON.parse(String(await readClient.readContract({ address: contractAddress, functionName, args })));
    } catch {
      if (attempt === 8) throw new Error(`${functionName} read failed`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
}

async function write(client, functionName, args, value = 0n, waitUntil = "decided") {
  try {
    // Studio Next can reject simulation for time-gated writes even when the
    // authoritative transaction timestamp is already legal. Use the generic
    // network quote for zero-value writes, matching the verified smoke path.
    const quote = value === 0n
      ? await client.estimateTransactionFees()
      : await client.estimateTransactionFeesForWrite({ address: contractAddress, functionName, args, value });
    const hash = await client.writeContract({ address: contractAddress, functionName, args, value,
      fees: { distribution: quote.distribution, feeValue: quote.feeValue } });
    const receipt = await client.waitForTransactionReceipt({ hash, waitUntil, retries: 120, interval: 5000 });
    const summary = { action: functionName, hash, status: receipt.statusName,
      execution: receipt.txExecutionResultName, successful: isSuccessful(receipt) };
    console.log(JSON.stringify(summary));
    if (!summary.successful) throw new Error("unsuccessful transaction");
    return hash;
  } catch (error) {
    const values = [];
    const seen = new Set();
    const visit = (item, depth = 0) => {
      if (depth > 5 || item === null || item === undefined || seen.has(item)) return;
      if (typeof item === "string") { values.push(item); return; }
      if (typeof item !== "object") return;
      seen.add(item);
      for (const key of Object.keys(item)) visit(item[key], depth + 1);
    };
    visit(error);
    const knownReasons = ["only sponsor", "round is not open", "proposal deadline has not passed",
      "review deadline has passed", "round is not ready for review"];
    const reason = knownReasons.find((candidate) => values.some((value) => value.includes(candidate)));
    throw new Error(`${functionName} transaction failed${reason ? `: ${reason}` : ""}`);
  }
}

async function networkNow() {
  const transaction = await readClient.getTransaction({ hash: clockReferenceHash });
  return Number(transaction.current_timestamp);
}

async function sleepUntil(timestamp) {
  while (await networkNow() < timestamp) {
    const remaining = timestamp - await networkNow();
    console.log(JSON.stringify({ waitingForProposalDeadlineSeconds: remaining }));
    await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 15) * 1000));
  }
}

async function main() {
const config = await readJson("get_mandate_config", []);
if (!config.valid || config.config_digest !== expectedConfigDigest) {
  throw new Error("canonical mandate configuration did not match the reviewed digest");
}
let round;
try {
  round = await readJson("get_round", [roundId]);
} catch {
  const now = await networkNow();
  await write(clients[0], "create_round",
    [roundId, accounts[1].address, accounts[2].address, accounts[0].address, now + 120, now + 86400], 2n * GEN);
  round = await readJson("get_round", [roundId]);
}

const plans = [
  "Restaurants will partner with local food pantries to provide healthy meals. Families will pick up the food at monthly healthy food workshops focused on health issues. Services will be multilingual.",
];
const planClients = [clients[1]];
for (let index = Number(round.submitted_count); index < plans.length; index += 1) {
  await write(planClients[index], "submit_plan", [roundId, plans[index]]);
  round = await readJson("get_round", [roundId]);
}

if (round.phase === "OPEN") {
  console.log(JSON.stringify({ phase: round.phase, proposalDeadline: round.proposal_deadline,
    networkNow: await networkNow() }));
  await sleepUntil(Number(round.proposal_deadline) + 5);
  await write(clients[0], "freeze_round", [roundId]);
  round = await readJson("get_round", [roundId]);
}

for (let attempt = 0; attempt < 2 && ["FROZEN", "RETRYABLE"].includes(round.phase); attempt += 1) {
  await write(clients[0], "adjudicate_round", [roundId]);
  round = await readJson("get_round", [roundId]);
}
if (round.phase !== "ALLOCATED") throw new Error(`expected ALLOCATED, received ${round.phase}`);

for (let index = 0; index < accounts.length; index += 1) {
  const credit = await readJson("get_credit", [roundId, accounts[index].address]);
  if (BigInt(credit.amount) > 0n && !credit.withdrawn) {
    await write(clients[index], "withdraw_credit", [roundId], 0n, "finalized");
  }
}
round = await readJson("get_round", [roundId]);
if (BigInt(round.sponsor_credit) > 0n) {
  await write(clients[0], "withdraw_sponsor_credit", [roundId], 0n, "finalized");
}

round = await readJson("get_round", [roundId]);
const matrix = await readJson("get_public_matrix", [roundId]);
const credits = await Promise.all(accounts.map((account) => readJson("get_credit", [roundId, account.address])));
const contractBalance = await readClient.getBalance({ address: contractAddress });
console.log(JSON.stringify({ roundId, configDigest: round.config_digest, phase: round.phase,
  submittedCount: round.submitted_count, attemptCount: round.attempt_count,
  remainingLiabilityGen: `${Number(round.remaining_liability) / 1e18} GEN`,
  sponsorCreditGen: `${Number(round.sponsor_credit) / 1e18} GEN`, matrix,
  contractBalanceGen: `${Number(contractBalance) / 1e18} GEN`,
  credits: credits.map((credit) => ({ amountGen: `${Number(credit.amount) / 1e18} GEN`, withdrawn: credit.withdrawn })) }));
}

main().catch((error) => {
  const safeMessages = new Set([
    "canonical mandate configuration did not match the reviewed digest",
    "expected ALLOCATED, received FROZEN",
    "expected ALLOCATED, received RETRYABLE",
    "get_mandate_config read failed",
    "get_round read failed",
    "get_credit read failed",
    "get_public_matrix read failed",
  ]);
  const message = error instanceof Error &&
    (safeMessages.has(error.message) || /^(create_round|submit_plan|freeze_round|adjudicate_round|withdraw_credit|withdraw_sponsor_credit) transaction failed(?:: [a-z ]+)?$/.test(error.message))
    ? error.message
    : "reviewer remediation smoke failed";
  console.error(message);
  process.exitCode = 1;
});
