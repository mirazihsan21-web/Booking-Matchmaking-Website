"use client";

import { ImagePlus, X } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { prepareChatPhoto, uploadChatPhoto } from "@/lib/chat/photos";
import { createClient } from "@/lib/supabase/client";
import { m } from "@/messages";

/**
 * Add a photo to a message: the file is checked and shrunk in the browser (nothing leaves the phone if it's the wrong
 * type or too big), uploaded to the sender's own folder, and its path put in a hidden `photoPath` field.
 */
export function PhotoPicker({ userId }: { userId: string }) {
  const [path, setPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // the same file can be picked again
    if (!file) return;
    setProblem(null);
    const prepared = await prepareChatPhoto(file);
    if ("problem" in prepared) {
      setProblem(prepared.problem === "size" ? m.chat.photo.size : m.chat.photo.type);
      return;
    }
    setUploading(true);
    const stored = await uploadChatPhoto(createClient(), userId, prepared.blob);
    setUploading(false);
    if (!stored) {
      setProblem(m.chat.photo.uploadFailed);
      return;
    }
    setPath(stored);
    setPreview(URL.createObjectURL(prepared.blob));
  }

  function clear() {
    setPath(null);
    setPreview(null);
  }

  return (
    <div className="flex flex-col gap-1">
      <input type="hidden" name="photoPath" value={path ?? ""} />
      <div className="flex items-center gap-2">
        {preview ? (
          <span className="relative inline-flex">
            {/* eslint-disable-next-line @next/next/no-img-element -- a blob: preview of the photo just picked */}
            <img src={preview} alt="" className="size-14 rounded-lg object-cover" />
            <button
              type="button"
              aria-label={m.chat.photo.remove}
              onClick={clear}
              className="absolute -right-2 -top-2 rounded-full bg-background p-0.5 shadow ring-1 ring-border"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </span>
        ) : (
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-raised">
            <ImagePlus aria-hidden className="size-4" />
            <span>{uploading ? m.chat.photo.uploading : m.chat.photo.add}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" aria-label={m.chat.photo.add} onChange={pick} disabled={uploading} className="sr-only" />
          </label>
        )}
      </div>
      {problem && (
        <p role="status" className="text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}
