"use client";

import { useState, type ChangeEvent } from "react";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { m } from "@/messages";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/**
 * Uploads straight to Storage as the signed-in owner (RLS allows only their organization's folder),
 * then puts the path in a hidden `logo_path` field for the surrounding form to save.
 */
export function LogoUploader({ organizationId, currentPath, currentUrl }: { organizationId: string; currentPath?: string; currentUrl: string | null }) {
  const [path, setPath] = useState(currentPath ?? "");
  const [preview, setPreview] = useState(currentUrl);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const ext = file && EXT[file.type];
    if (!file || !ext || file.size > 1024 * 1024) {
      setStatus("error");
      return;
    }
    setStatus("uploading");
    const target = `${organizationId}/logo.${ext}`;
    const { error } = await createClient().storage.from("org-assets").upload(target, file, { upsert: true, contentType: file.type });
    if (error) {
      setStatus("error");
      return;
    }
    setPath(target);
    setPreview(URL.createObjectURL(file));
    setStatus("done");
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="logo">{m.manage.logo}</Label>
      {/* eslint-disable-next-line @next/next/no-img-element -- local blob: preview of the file being uploaded */}
      {preview && <img src={preview} alt="" className="h-16 w-16 rounded-lg border border-border object-contain" />}
      <input id="logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} className="text-sm" />
      <input type="hidden" name="logo_path" value={path} />
      {status === "done" && <p className="text-xs text-foreground/70">{m.manage.logoUploaded}</p>}
      {status === "error" && <p className="text-xs text-destructive">{m.manage.logoFailed}</p>}
    </div>
  );
}
