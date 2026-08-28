/** Public operator farm. Browser never fetches sunflower-land or sfl.world APIs. */
export const OPERATOR_FARM_ID = "3666918801844311";
export const OPERATOR_FARM_NAME = "rmr";
export const OPERATOR_FARM_URL = `https://sunflower-land.com/play/#/visit/${OPERATOR_FARM_ID}`;
export const OPERATOR_X_URL = "https://x.com/reimaruku";
export const DONATION_WALLET = "0xad89dD77d60e38B45A41028cCDDB0b173b612f2c";

export function truncatedDonationWallet(address: string = DONATION_WALLET): string {
  if (address.length <= 6) return address;
  return `${address.slice(0, 3)}...${address.slice(-3)}`;
}

export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through to execCommand */
  }
  try {
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.left = "-9999px";
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    return ok;
  } catch {
    return false;
  }
}
