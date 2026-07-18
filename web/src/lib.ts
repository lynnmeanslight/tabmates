import { formatEther } from "viem";

export function fmtMon(wei: bigint, dp = 4): string {
  const s = formatEther(wei < 0n ? -wei : wei);
  const [int, frac = ""] = s.split(".");
  const trimmed = frac.slice(0, dp).replace(/0+$/, "");
  return trimmed ? `${int}.${trimmed}` : int;
}

export function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Deterministic pastel-ish hue per address, for identity dots. */
export function addrHue(a: string): number {
  let h = 0;
  for (let i = 2; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) % 360;
  return h;
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function isAddress(v: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(v.trim());
}
