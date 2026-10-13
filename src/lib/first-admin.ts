/** The first admin. Other accounts stay non-admin until an admin grants it. */
export const FIRST_ADMIN_EMAIL = "psyo_o@naver.com";

/** FIRST_ADMIN_EMAIL 환경변수가 올바른 이메일이면 그 주소가 첫 관리자다. */
export function firstAdminEmail(): string {
  const fromEnv = process.env.FIRST_ADMIN_EMAIL?.trim().toLowerCase();
  if (fromEnv && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEnv)) return fromEnv;
  return FIRST_ADMIN_EMAIL;
}
