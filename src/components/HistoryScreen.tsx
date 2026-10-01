"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { BottomSheet } from "@/components/BottomSheet";
import { addDays, formatHistoryDate, monthMatrix, visibleCompareRows, weekOf } from "@/lib/month-plan/history-day";
import type { HistoryCard } from "@/lib/month-plan/history";

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"] as const;

function monthOf(iso: string): { year: number; month: number } {
  const [year, month] = iso.split("-").map(Number);
  return { year: year || 2026, month: month || 1 };
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 };
}

function dayNumber(iso: string): number {
  return Number(iso.slice(8, 10));
}

export function HistoryScreen({ initialDate, cards }: { initialDate: string; cards: HistoryCard[] }) {
  const [selected, setSelected] = useState(initialDate);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cursor, setCursor] = useState(() => monthOf(initialDate));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const ignoreClick = useRef(false);
  const logged = useMemo(() => new Set(cards.map((card) => card.date)), [cards]);
  const week = weekOf(selected);
  const dayCards = cards.filter((card) => card.date === selected);
  const matrix = monthMatrix(cursor.year, cursor.month);
  const monthKey = `${cursor.year}-${String(cursor.month).padStart(2, "0")}`;

  function openSheet() {
    setCursor(monthOf(selected));
    setSheetOpen(true);
  }

  function pick(date: string) {
    setSelected(date);
    setSheetOpen(false);
    setExpanded({});
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        className="tap flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--bg-card)] px-4 text-left"
        onClick={openSheet}
        aria-haspopup="dialog"
      >
        <span className="text-3xl font-black leading-none">{formatHistoryDate(selected)}</span>
        <span className="shrink-0 text-sm font-bold text-[var(--muted)]">달력</span>
      </button>

      <div
        className="mt-3 flex touch-pan-y gap-1"
        onPointerDown={(event) => {
          swipe.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
        }}
        onPointerUp={(event) => {
          const start = swipe.current;
          swipe.current = null;
          if (!start || start.id !== event.pointerId) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (Math.abs(dx) < 56 || Math.abs(dx) <= Math.abs(dy)) return;
          ignoreClick.current = true;
          setExpanded({});
          setSelected((current) => addDays(current, dx < 0 ? 7 : -7));
        }}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        {week.map((date, index) => {
          const active = date === selected;
          const hasLog = logged.has(date);
          return (
            <button
              key={date}
              type="button"
              className={`tap flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center rounded-xl border text-sm font-black leading-none ${
                active
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[#1a1204]"
                  : "border-[var(--line)] bg-[var(--bg-card)] text-[var(--text)]"
              }`}
              aria-pressed={active}
              onClick={() => {
                if (ignoreClick.current) {
                  ignoreClick.current = false;
                  return;
                }
                setExpanded({});
                setSelected(date);
              }}
            >
              <span>{WEEKDAYS[index]}</span>
              <span className="mt-0.5 text-xs font-bold tabular-nums">{dayNumber(date)}</span>
              <span
                className={`mt-0.5 h-1.5 w-1.5 rounded-full ${hasLog ? (active ? "bg-[#1a1204]" : "bg-[var(--accent)]") : "bg-transparent"}`}
                aria-hidden
              />
            </button>
          );
        })}
      </div>

      {dayCards.length === 0 ? (
        <p className="mt-8 text-center text-base font-bold">이 날 기록 없음</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {dayCards.map((card) => (
            <li key={card.key}>
              {card.badge === "리프트" ? <LiftCard card={card} /> : <MetconCard card={card} open={Boolean(expanded[card.key])} onExpand={() => setExpanded((prev) => ({ ...prev, [card.key]: true }))} />}
            </li>
          ))}
        </ul>
      )}

      <BottomSheet open={sheetOpen} title="날짜" onClose={() => setSheetOpen(false)}>
        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost tap min-h-14 shrink-0 px-4 text-sm font-bold"
            onClick={() => setCursor((current) => shiftMonth(current.year, current.month, -1))}
          >
            이전
          </button>
          <div className="min-w-0 flex-1 text-center text-lg font-black">
            {cursor.year}년 {cursor.month}월
          </div>
          <button
            type="button"
            className="btn-ghost tap min-h-14 shrink-0 px-4 text-sm font-bold"
            onClick={() => setCursor((current) => shiftMonth(current.year, current.month, 1))}
          >
            다음
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((label) => (
            <div key={label} className="py-1 text-center text-xs font-bold text-[var(--muted)]">
              {label}
            </div>
          ))}
          {matrix.flat().map((date) => {
            const inMonth = date.startsWith(monthKey);
            const active = date === selected;
            const hasLog = logged.has(date);
            return (
              <button
                key={date}
                type="button"
                className={`tap flex min-h-14 flex-col items-center justify-center rounded-xl text-sm font-black ${
                  active ? "bg-[var(--accent)] text-[#1a1204]" : inMonth ? "text-[var(--text)]" : "text-[var(--muted)]"
                }`}
                onClick={() => pick(date)}
              >
                <span className="tabular-nums">{dayNumber(date)}</span>
                <span
                  className={`mt-0.5 h-1.5 w-1.5 rounded-full ${hasLog ? (active ? "bg-[#1a1204]" : "bg-[var(--accent)]") : "bg-transparent"}`}
                  aria-hidden
                />
              </button>
            );
          })}
        </div>
      </BottomSheet>
    </div>
  );
}

function LiftCard({ card }: { card: HistoryCard }) {
  return (
    <article className="card min-w-0 p-4">
      <Link href={card.href} className="block min-w-0">
        <div className="text-xs font-bold text-[var(--accent)]">{card.badge}</div>
        <div className="mt-1 line-clamp-2 break-words text-lg font-black leading-snug">{card.name}</div>
      </Link>
      {card.sets.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {card.sets.map((line, index) => (
            <li key={`${card.key}-${index}`} className="whitespace-normal break-words text-base font-bold tabular-nums">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function MetconCard({ card, open, onExpand }: { card: HistoryCard; open: boolean; onExpand: () => void }) {
  const visible = visibleCompareRows(card.compares, open);
  const title = card.summary ? `${card.name} · ${card.summary}` : card.name;
  const metcon = card.badge === "메트콘";
  return (
    <article className="card min-w-0 p-4">
      {metcon ? (
        <div className="flex items-start gap-2">
          <Link href={card.href} className="flex min-w-0 items-start gap-2">
            <span className="shrink-0 pt-1 text-xs font-bold text-[var(--accent)]">메트콘</span>
            <span className="min-w-0 line-clamp-2 break-words text-lg font-black leading-snug">{title}</span>
          </Link>
          {card.stimulus ? (
            <span className="mt-0.5 shrink-0 rounded-full border border-[var(--line)] bg-[var(--bg-elev)] px-2 py-0.5 text-xs font-bold leading-none">
              {card.stimulus}
            </span>
          ) : null}
        </div>
      ) : (
        <Link href={card.href} className="block min-w-0">
          <div className="text-xs font-bold text-[var(--accent)]">{card.badge}</div>
          <div className="mt-1 line-clamp-2 break-words text-lg font-black leading-snug">{title}</div>
        </Link>
      )}
      {card.score ? <p className="mt-3 text-4xl font-black tabular-nums text-[var(--text)]">{card.score}</p> : null}
      {card.rankKo ? <p className="mt-1 text-sm font-bold tabular-nums">{card.rankKo}</p> : null}
      {visible.length > 0 ? (
        <ul className="mt-4 space-y-2 border-t border-[var(--line)] pt-3">
          {visible.map((row, index) => (
            <li key={`${row.labelKo}-${row.date}-${row.score}-${index}`} className="text-sm text-[var(--muted)]">
              <span className="font-bold">{row.labelKo}</span>
              <span className="ml-2">{formatHistoryDate(row.date)}</span>
              <span className="ml-2 font-bold tabular-nums">{row.score}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {card.compares.length > visible.length ? (
        <button type="button" className="tap mt-2 w-full text-sm font-bold" onClick={onExpand}>
          더 보기
        </button>
      ) : null}
    </article>
  );
}
