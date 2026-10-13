export const MEMBER_STATUSES = ["pending", "active", "suspended", "withdrawn"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const MEMBER_ROLES = ["admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MIN_SIGNUP_AGE = 14;
export const NAME_MAX = 40;
export const NOTE_KO_MAX = 80;
export const REASON_KO_MAX = 200;
export const SIGNUP_LIMIT = 5;
export const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

export const UNDERAGE_KO = "만 14세 미만은 가입할 수 없어요.";
export const BIRTHDATE_KO = "생년월일을 확인해 주세요.";
export const NAME_KO = "이름을 입력해 주세요.";

export function isMemberStatus(value: unknown): value is MemberStatus {
  return value === "pending" || value === "active" || value === "suspended" || value === "withdrawn";
}

export function isMemberRole(value: unknown): value is MemberRole {
  return value === "admin" || value === "member";
}

/** 알 수 없는 상태는 생성·기록을 막기 위해 pending으로 본다. */
export function asMemberStatus(value: unknown): MemberStatus {
  return isMemberStatus(value) ? value : "pending";
}

export function seoulToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isRealDate(iso: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2100) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/** 만 나이. 생일 당일부터 한 살이다. */
export function ageYears(birthDate: string, today: string): number | null {
  if (!isRealDate(birthDate) || !isRealDate(today)) return null;
  const [year, month, day] = birthDate.split("-").map(Number);
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  let age = todayYear - year;
  if (todayMonth < month || (todayMonth === month && todayDay < day)) age -= 1;
  return age;
}

export function validateDisplayName(value: unknown): { name: string } | { error: string } {
  if (typeof value !== "string") return { error: NAME_KO };
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > NAME_MAX) return { error: NAME_KO };
  if (/[\u0000-\u001f]/.test(name)) return { error: NAME_KO };
  return { name };
}

export function validateBirthDate(value: unknown, today = seoulToday()): { birthDate: string } | { error: string } {
  if (typeof value !== "string" || !isRealDate(value)) return { error: BIRTHDATE_KO };
  const age = ageYears(value, today);
  if (age == null || age < 0 || value > today) return { error: BIRTHDATE_KO };
  if (age < MIN_SIGNUP_AGE) return { error: UNDERAGE_KO };
  return { birthDate: value };
}

export function validateNoteKo(value: unknown): { note: string } | { error: string } {
  if (value == null) return { note: "" };
  if (typeof value !== "string") return { error: "메모는 글자만 적을 수 있어요." };
  const note = value.trim();
  if (note.length > NOTE_KO_MAX) return { error: `메모는 ${NOTE_KO_MAX}자까지예요.` };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(note)) return { error: "메모는 글자만 적을 수 있어요." };
  return { note };
}

export function validateReasonKo(value: unknown): { reason: string } | { error: string } {
  if (typeof value !== "string") return { error: "사유를 입력해 주세요." };
  const reason = value.trim();
  if (!reason || reason.length > REASON_KO_MAX) return { error: "사유를 입력해 주세요." };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(reason)) return { error: "사유를 입력해 주세요." };
  return { reason };
}
