"use client";

import { useEffect, useState } from "react";
import { Field, FieldError } from "@/components/forms/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkSlugAction } from "@/app/(root)/onboarding/actions";
import type { SlugCheck } from "@/lib/orgs/create-organization";
import { normalizeSlug } from "@/lib/tenancy/slug";
import { m } from "@/messages";

/** Venue name plus its web address, suggested from the name and checked live (debounced). */
export function NameAndSlug({ rootDomain }: { rootDomain: string }) {
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const [check, setCheck] = useState<SlugCheck | null>(null);

  useEffect(() => {
    if (!slug) return;
    const timer = setTimeout(async () => setCheck(await checkSlugAction(slug)), 400);
    return () => clearTimeout(timer);
  }, [slug]);

  const message =
    !slug || !check
      ? null
      : check.status === "available"
        ? m.onboarding.slugAvailable(`${check.slug}.${rootDomain}`)
        : check.status === "slug_taken"
          ? m.onboarding.slugTaken
          : check.reason === "reserved"
            ? m.onboarding.slugReserved
            : m.onboarding.slugFormat;

  return (
    <>
      <Field
        name="name"
        label={m.onboarding.venueName}
        required
        onChange={(e) => {
          if (!touched) setSlug(normalizeSlug(e.target.value));
        }}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slug">{m.manage.slug}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="slug"
            name="slug"
            value={slug}
            onChange={(e) => {
              setTouched(true);
              setSlug(e.target.value);
            }}
            required
          />
          <span className="text-sm text-foreground/60">.{rootDomain}</span>
        </div>
        {message && (
          <p className={check?.status === "available" ? "text-xs text-foreground/70" : "text-xs text-destructive"}>{message}</p>
        )}
        <FieldError name="slug" />
      </div>
    </>
  );
}
