"use client";

import { useState } from "react";

export function PasswordField({
  name,
  label,
  hint,
  error,
  autoComplete,
  minLength = 8,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  autoComplete?: string;
  minLength?: number;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-bold">{label}</span>
      <div className="relative">
        <input
          name={name}
          type={show ? "text" : "password"}
          required
          minLength={minLength}
          autoComplete={autoComplete}
          className="field pr-20"
        />
        <button
          type="button"
          className="tap absolute top-0 right-0 px-3 text-sm font-bold text-[var(--accent)]"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "비밀번호 숨기기" : "비밀번호 보기"}
        >
          {show ? "숨기기" : "보기"}
        </button>
      </div>
      {error ? <p className="field-error">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </label>
  );
}
