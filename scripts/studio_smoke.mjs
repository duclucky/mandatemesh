import { readFileSync } from "node:fs";
import { createAccount, createClient, isSuccessful } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";

const root = new URL("../../.env", import.meta.url);
const contractAddress = "0xfbc7F7A19Cd82E2b9d1B4BE0EbAD0c3be55fa5EB";
const roundId = "smoke-13798f8";
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
console.log(JSON.stringify({ roundId, canonicalView: { phase: state.phase, submittedCount: state.submitted_count, remainingLiabilityGen: Number(state.remaining_liability) / 1e18 } }));
