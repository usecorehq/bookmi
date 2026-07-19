import { useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { uploadToCloudinary } from "@/lib/cloudinary";

const MAX_BYTES = 3 * 1024 * 1024; // 3 MB — no compression, keep the raw file lean
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Circular avatar picker. On file select it uploads to Cloudinary (unsigned
 * preset) and returns the URL via `onUploaded`. The parent owns the persisted
 * URL — the component just fires the upload.
 *
 *   - Optional: users can skip it entirely.
 *   - Rejects >3 MB files and non-image mime types at the input.
 *   - Placeholder shows initials on the accent color (or #7856FF fallback).
 */
export function AvatarUploader({
  value,
  onUploaded,
  initials,
  accentColor,
  folder = "bookmi/avatars",
  size = 96,
}: {
  value: string | null;
  onUploaded: (url: string) => void;
  initials?: string;
  accentColor?: string | null;
  folder?: string;
  size?: number;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const openPicker = () => {
    setError(null);
    inputRef.current?.click();
  };

  const handleFile = async (file: File) => {
    setError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Use a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image must be under 3 MB.");
      return;
    }

    setUploading(true);
    setProgress(0);
    try {
      const url = await uploadToCloudinary(file, {
        folder,
        onProgress: (p) => setProgress(p.progress),
      });
      onUploaded(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const bg = value ? undefined : accentColor || "#7856FF";
  const style: React.CSSProperties = {
    width: size,
    height: size,
    backgroundColor: bg,
    backgroundImage: value ? `url(${value})` : undefined,
    backgroundSize: "cover",
    backgroundPosition: "center",
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={openPicker}
        disabled={uploading}
        className="relative flex items-center justify-center text-white overflow-hidden ring-2 ring-white shadow-sm hover:opacity-90 disabled:opacity-60 rounded-full"
        style={style}
        aria-label={value ? "Change photo" : "Add photo"}
      >
        {!value && (
          <span
            className="text-xl font-bold uppercase pointer-events-none"
            aria-hidden
          >
            {initials || <Camera className="w-6 h-6 opacity-80" />}
          </span>
        )}
        {uploading && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-xs">
            <Loader2 className="w-4 h-4 animate-spin mr-1" />
            {progress}%
          </span>
        )}
      </button>
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={openPicker}
          disabled={uploading}
          className="text-primary hover:underline"
        >
          {value ? "Change photo" : "Add photo"}
        </button>
        {value && !uploading && (
          <button
            type="button"
            onClick={() => onUploaded("")}
            className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-red-600"
          >
            <X className="w-3 h-3" />
            Remove
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // allow same-file reselect
          if (f) void handleFile(f);
        }}
      />
    </div>
  );
}
