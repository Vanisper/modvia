const h16Pattern = /^[0-9a-fA-F]{1,4}$/;

export function isValidIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return false;
    if (Number(part) > 255) return false;
  }
  return true;
}

export function isValidIpv6(value: string): boolean {
  if (value.length === 0 || value.includes("%")) return false;
  const halves = value.split("::");
  if (halves.length > 2) return false;

  const leftRaw = halves[0] ?? "";
  const rightRaw = halves[1];

  const leftParts = leftRaw === "" ? [] : leftRaw.split(":");
  const rightParts = rightRaw === undefined || rightRaw === "" ? [] : rightRaw.split(":");
  if (leftRaw === "" && halves.length === 1) return false;

  let trailingIpv4Groups = 0;
  const tailContainer = rightParts.length > 0 ? rightParts : leftParts;
  const lastSegment = tailContainer[tailContainer.length - 1];
  if (lastSegment !== undefined && lastSegment.includes(".")) {
    if (!isValidIpv4(lastSegment)) return false;
    tailContainer.pop();
    trailingIpv4Groups = 2;
  }

  for (const seg of leftParts) {
    if (!h16Pattern.test(seg)) return false;
  }
  for (const seg of rightParts) {
    if (!h16Pattern.test(seg)) return false;
  }

  const totalGroups = leftParts.length + rightParts.length + trailingIpv4Groups;
  return halves.length === 2 ? totalGroups < 8 : totalGroups === 8;
}
