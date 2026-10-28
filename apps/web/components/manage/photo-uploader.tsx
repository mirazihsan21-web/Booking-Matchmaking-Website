"use client";

import { useState, type ChangeEvent } from "react";
import { FieldError } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { m } from "@/messages";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * A section's photo: uploads straight to Storage as the signed-in owner (RLS allows only their brand's
 * folder) under a new name in the section's folder, and puts the path in a hidden `photo_path` field for
 * the form to save. "Use the default photo" empties it, so the stock photo shows again.
 */
export function PhotoUploader({
  folder,
  currentPath,
  currentUrl,
  stockUrl,
}: {
  /** `<organization>/sections/<section>` */
  folder: string;
  currentPath: string | null;
  currentUrl: string;
  stockUrl: string;
}) {
  const w = m.manage.website;
  const [path, setPath] = useState(currentPath ?? "");
  const [preview, setPreview] = useState(currentUrl);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const ext = file && EXT[file.type];
    if (!file || !ext || file.size > MAX_BYTES) {
      setStatus("error");
      return;
    }
    setStatus("uploading");
    const target = `${folder}/${crypto.randomUUID()}.${ext}`;
    const { error } = await createClient().storage.from("org-assets").upload(target, file, { contentType: file.type });
    if (error) {
      setStatus("error");
      return;
    }
    setPath(target);
    setPreview(URL.createObjectURL(file));
    setStatus("done");
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="photo" className="text-sm font-medium">
        {w.photo}
      </label>
      {/* eslint-disable-next-line @next/next/no-img-element -- a blob: preview of the file just chosen, or the current photo */}
      <img src={preview} alt="" className="aspect-[16/10] w-full max-w-sm rounded-lg border-b-[3px] border-section object-cover" />
      <p className="text-xs text-muted-foreground">{path ? w.ownPhoto : w.stockPhoto}</p>
      <div className="flex flex-wrap items-center gap-3">
        <input id="photo" type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} className="text-sm" />
        {path && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setPath("");
              setPreview(stockUrl);
              setStatus("idle");
            }}
          >
            {w.useDefault}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{w.photoHint}</p>
      <input type="hidden" name="photo_path" value={path} />
      {status === "uploading" && <p className="text-xs text-muted-foreground">{w.uploading}</p>}
      {status === "done" && <p className="text-xs text-muted-foreground">{w.uploaded}</p>}
      {status === "error" && <p className="text-xs text-destructive">{w.photoFailed}</p>}
      <FieldError name="photo_path" />
    </div>
  );
}
