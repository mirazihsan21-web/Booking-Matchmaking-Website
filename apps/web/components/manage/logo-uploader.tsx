"use client";

import { useState, type ChangeEvent } from "react";
import { FieldError } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { m } from "@/messages";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Uploads straight to Storage as the signed-in owner (RLS allows only their organization's folder) under a
 * new name, then puts the path in a hidden `logo_path` field for the surrounding form to save. "Remove
 * logo" empties it. PNG, JPG or WebP only: a public SVG can carry script.
 */
export function LogoUploader({ organizationId, currentPath, currentUrl }: { organizationId: string; currentPath?: string; currentUrl: string | null }) {
  const [path, setPath] = useState(currentPath ?? "");
  const [preview, setPreview] = useState(currentUrl);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "removed" | "error">("idle");

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const ext = file && EXT[file.type];
    if (!file || !ext || file.size > MAX_BYTES) {
      setStatus("error");
      return;
    }
    setStatus("uploading");
    const target = `${organizationId}/logo-${crypto.randomUUID()}.${ext}`;
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
      <Label htmlFor="logo">{m.manage.logo}</Label>
      {/* eslint-disable-next-line @next/next/no-img-element -- a blob: preview of the file just chosen, or the current logo */}
      {preview && <img src={preview} alt="" className="size-16 rounded-lg border border-border object-contain" />}
      <div className="flex flex-wrap items-center gap-3">
        <input id="logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} className="text-sm" />
        {path && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setPath("");
              setPreview(null);
              setStatus("removed");
            }}
          >
            {m.manage.brandPage.removeLogo}
          </Button>
        )}
      </div>
      <input type="hidden" name="logo_path" value={path} />
      {status === "uploading" && <p className="text-xs text-muted-foreground">{m.manage.website.uploading}</p>}
      {status === "done" && <p className="text-xs text-muted-foreground">{m.manage.logoUploaded}</p>}
      {status === "removed" && <p className="text-xs text-muted-foreground">{m.manage.brandPage.logoRemoved}</p>}
      {status === "error" && <p className="text-xs text-destructive">{m.manage.logoFailed}</p>}
      <FieldError name="logo_path" />
    </div>
  );
}
