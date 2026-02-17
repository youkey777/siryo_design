import { spawnSync } from "node:child_process";

function runPowerShell(command: string): string {
  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "PowerShell実行に失敗しました。");
  }

  return result.stdout.trim();
}

export function encryptWithDpapi(plainText: string): string {
  const b64 = Buffer.from(plainText, "utf8").toString("base64");
  const command = [
    "Add-Type -AssemblyName System.Security",
    "$bytes=[Convert]::FromBase64String('" + b64 + "')",
    "$enc=[System.Security.Cryptography.ProtectedData]::Protect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Convert]::ToBase64String($enc)",
  ].join("; ");
  return runPowerShell(command);
}

export function decryptWithDpapi(encryptedB64: string): string {
  const command = [
    "Add-Type -AssemblyName System.Security",
    "$enc=[Convert]::FromBase64String('" + encryptedB64 + "')",
    "$bytes=[System.Security.Cryptography.ProtectedData]::Unprotect($enc,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Text.Encoding]::UTF8.GetString($bytes)",
  ].join("; ");
  return runPowerShell(command);
}
