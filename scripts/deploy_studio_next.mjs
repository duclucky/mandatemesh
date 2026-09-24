import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAccount, createClient, isSuccessful } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";

const projectRoot = resolve(import.meta.dirname, "..");
const ownerAddress = process.env.MANDATEMESH_DEPLOYER_ADDRESS?.toLowerCase();

if (!ownerAddress) {
  throw new Error("MANDATEMESH_DEPLOYER_ADDRESS is required");
}

function valuesFromEnvFile(path) {
  try {
    return readFileSync(path, "utf8").split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
      return match && match[1].endsWith("_PRIVATE_KEY") ? [match[2].replace(/^['\"]|['\"]$/g, "")] : [];
    });
  } catch {
    return [];
  }
}

const candidates = [
  ...valuesFromEnvFile(resolve(projectRoot, ".env")),
  ...valuesFromEnvFile(resolve(projectRoot, "..", ".env")),
];
const account = candidates.map((key) => createAccount(key)).find((item) => item.address.toLowerCase() === ownerAddress);
if (!account) {
  throw new Error("No authorized local deployment account matches MANDATEMESH_DEPLOYER_ADDRESS");
}

const chain = {
  ...studioDevnet,
  name: "GenLayer Studio Dev",
  rpcUrls: { default: { http: ["https://studio-next.genlayer.com/api"] } },
};
const client = createClient({ chain, account });
const estimate = await client.estimateTransactionFees();
const summary = {
  network: "Studio Dev",
  chainId: chain.id,
  rpc: chain.rpcUrls.default.http[0],
  feeDepositGen: (Number(estimate.feeValue) / 1e18).toString(),
};

if (process.argv.includes("--estimate-only")) {
  console.log(JSON.stringify(summary));
  process.exit(0);
}

try {
  const hash = await client.deployContract({
    code: readFileSync(resolve(projectRoot, "contracts", "mandate_mesh.py"), "utf8"),
    fees: { distribution: estimate.distribution, feeValue: estimate.feeValue },
  });
  console.log(JSON.stringify({ ...summary, hash, submitted: true }));
  if (process.argv.includes("--submit-only")) process.exit(0);
  const receipt = await client.waitForTransactionReceipt({ hash, waitUntil: "decided", retries: 100, interval: 5000, fullTransaction: true });
  const successful = isSuccessful(receipt);
  const contractAddress = receipt.data?.contract_address ?? receipt.txDataDecoded?.contractAddress ?? null;
  console.log(JSON.stringify({ ...summary, hash, status: receipt.statusName, execution: receipt.txExecutionResultName, successful, contractAddress }));
  if (!successful || !contractAddress) process.exitCode = 1;
} catch {
  console.error("Studio Next deployment failed; inspect status with a safe allowlisted query");
  process.exitCode = 1;
}
