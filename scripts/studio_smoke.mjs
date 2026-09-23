import { readFileSync } from "node:fs";
import { createAccount, createClient, isSuccessful } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";

const root = new URL("../../.env", import.meta.url);
const contractAddress = "0x99538358a68b298E2a08B61888A9E97F45475073";
const roundId = "smoke-v04-99538358";
const GEN = 1_000_000_000_000_000_000n;
const chain = { ...studioDevnet, name: "GenLayer Studio Dev", rpcUrls: { default: { http: ["https://studio-next.genlayer.com/api"] } } };

function envKeys() {
  const text = readFileSync(root, "utf8");
  return text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(STUDIONET(?:_INTEGRATOR|_STEWARD)?_PRIVATE_KEY)\s*=\s*(.+?)\s*$/);
    return match ? [{ name: match[1], key: match[2] }] : [];
  });
}

const keys = envKeys();
if (keys.length < 3) throw new Error("three authorized Studio Dev keys are required");
const accounts = keys.slice(0, 3).map(({ key }) => createAccount(key));
const ownerClient = createClient({ chain, account: accounts[0] });
const readClient = createClient({ chain });

async function write(functionName, args) {
  const quote = await ownerClient.estimateTransactionFees();
  const hash = await ownerClient.writeContract({ address: contractAddress, functionName, args, fees: { distribution: quote.distribution, feeValue: quote.feeValue } });
  const receipt = await ownerClient.waitForTransactionReceipt({ hash, waitUntil: "decided", retries: 60, interval: 5000 });
  console.log(JSON.stringify({ roundId, action: functionName, hash, status: receipt.statusName, execution: receipt.txExecutionResultName, successful: isSuccessful(receipt) }));
  if (!isSuccessful(receipt)) throw new Error(`${functionName} was not successful`);
}

let existing;
try {
  existing = await readClient.readContract({ address: contractAddress, functionName: "get_round", args: [roundId] });
} catch {
  existing = null;
}

if (!existing) {
  const now = Math.floor(Date.now() / 1000);
  const writeArgs = [roundId, accounts[1].address, accounts[2].address, accounts[0].address, now + 90, now + 300];
  const quote = await ownerClient.estimateTransactionFeesForWrite({ address: contractAddress, functionName: "create_round", args: writeArgs, value: 2n * GEN });
  const hash = await ownerClient.writeContract({
    address: contractAddress,
    functionName: "create_round",
    args: writeArgs,
    value: 2n * GEN,
    fees: { distribution: quote.distribution, feeValue: quote.feeValue },
  });
  const receipt = await ownerClient.waitForTransactionReceipt({ hash, waitUntil: "decided", retries: 60, interval: 5000 });
  const failure = Object.fromEntries(Object.entries(receipt).filter(([key, value]) => /error|reason|message/i.test(key) && typeof value === "string").map(([key, value]) => [key, String(value).slice(0, 200)]));
  console.log(JSON.stringify({ roundId, action: "create_round", hash, status: receipt.statusName, execution: receipt.txExecutionResultName, successful: isSuccessful(receipt), ...(Object.keys(failure).length ? { failure } : {}) }));
  if (!isSuccessful(receipt)) throw new Error("Studio Dev smoke create_round was not successful");
}

const state = JSON.parse(String(await readClient.readContract({ address: contractAddress, functionName: "get_round", args: [roundId] })));
if (process.argv.includes("--recover")) {
  if (state.phase === "OPEN" && Number(state.proposal_deadline) <= Math.floor(Date.now() / 1000)) {
    await write("freeze_round", [roundId]);
  }
  const beforeRecovery = JSON.parse(String(await readClient.readContract({ address: contractAddress, functionName: "get_round", args: [roundId] })));
  if (["FROZEN", "RETRYABLE"].includes(beforeRecovery.phase) && Number(beforeRecovery.recovery_deadline) <= Math.floor(Date.now() / 1000)) {
    await write("recover_expired", [roundId]);
  }
  const afterRecovery = JSON.parse(String(await readClient.readContract({ address: contractAddress, functionName: "get_round", args: [roundId] })));
  if (afterRecovery.phase === "EXPIRED_REFUNDED" && Number(afterRecovery.sponsor_credit) > 0) {
    await write("withdraw_sponsor_credit", [roundId]);
  }
}
const finalState = JSON.parse(String(await readClient.readContract({ address: contractAddress, functionName: "get_round", args: [roundId] })));
console.log(JSON.stringify({ roundId, canonicalView: { phase: finalState.phase, submittedCount: finalState.submitted_count, remainingLiabilityGen: Number(finalState.remaining_liability) / 1e18, sponsorCreditGen: Number(finalState.sponsor_credit) / 1e18 } }));
