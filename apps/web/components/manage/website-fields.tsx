"use client";

import { useState } from "react";
import { cn } from "cn";
import { FieldError, useFormState } from "@/components/forms/action-form";
import { sectionStyle } from "@/components/site/section-style";
import { buttonVariants } from "@/components/ui/button";
import { accentReadability } from "@/lib/manage/colour";
import { m } from "@/messages";

const MAX = 300;

/** The description (with what is left of its 300 characters) and the colour, with a live preview. */
export function WebsiteFields({ name, description, accent }: { name: string; description: string | null; accent: string }) {
  const w = m.manage.website;
  const [text, setText] = useState(description ?? "");
  const [colour, setColour] = useState(accent);
  const readable = accentReadability(colour);
  const descriptionInvalid = Boolean(useFormState()?.errors?.description);

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className="text-sm font-medium">
          {w.description}
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          maxLength={MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={w.descriptionPlaceholder}
          aria-invalid={descriptionInvalid || undefined}
          aria-describedby="description-count"
          className="w-full rounded-lg border border-input bg-input/30 px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
        />
        <p id="description-count" className="text-xs text-muted-foreground">
          {w.left(MAX - text.length)} {text.trim() === "" && w.emptyDescription}
        </p>
        <FieldError name="description" />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="accent" className="text-sm font-medium">
          {w.colour}
        </label>
        <div className="flex flex-wrap items-start gap-4">
          <input id="accent" name="accent" type="color" value={colour} onChange={(e) => setColour(e.target.value)} className="h-10 w-16 cursor-pointer rounded-lg border border-input bg-transparent" />
          <div style={sectionStyle(colour)} aria-label={w.preview} className="flex min-w-60 flex-1 flex-col gap-3 rounded-xl border-l-[3px] border-section bg-card p-4">
            <span className="font-display text-2xl uppercase tracking-wide text-section">{name}</span>
            <span className={cn(buttonVariants({ variant: "section", size: "sm" }), "pointer-events-none self-start")}>{w.previewButton}</span>
          </div>
        </div>
        <p className={cn("text-xs", readable.ok ? "text-muted-foreground" : "text-destructive")}>
          {readable.ok ? w.readable : w.unreadable(Math.min(readable.onCard, readable.onColour))}
        </p>
        <FieldError name="accent" />
      </div>
    </>
  );
}
