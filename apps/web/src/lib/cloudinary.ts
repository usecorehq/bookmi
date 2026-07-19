/**
 * Bookmi's client-side Cloudinary helper. Mirrors qore-menu's approach:
 * unsigned upload preset + folder path. No backend involvement.
 *
 * Required Vite env:
 *   - VITE_CLOUDINARY_CLOUD_NAME
 *   - VITE_CLOUDINARY_UPLOAD_PRESET
 */
export interface UploadProgress {
  stage: "preparing" | "uploading" | "complete";
  /** 0-100 */
  progress: number;
}

function getCloudinaryEnv() {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined;
  if (!cloudName) throw new Error("VITE_CLOUDINARY_CLOUD_NAME is not configured.");
  if (!uploadPreset) throw new Error("VITE_CLOUDINARY_UPLOAD_PRESET is not configured.");
  return { cloudName, uploadPreset };
}

/**
 * Upload a file to Cloudinary and resolve to the secure_url. Callers should
 * cap the file size in the UI (we do NOT compress here — 3 MB is fine for
 * avatars; anything larger should be rejected by the input's max-size check).
 */
export async function uploadToCloudinary(
  file: File,
  opts: { folder: string; onProgress?: (p: UploadProgress) => void },
): Promise<string> {
  const { cloudName, uploadPreset } = getCloudinaryEnv();
  opts.onProgress?.({ stage: "preparing", progress: 10 });

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);
  if (opts.folder) formData.append("folder", opts.folder);

  const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        const pct = 30 + (e.loaded / e.total) * 60;
        opts.onProgress?.({ stage: "uploading", progress: Math.round(pct) });
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (data.secure_url) {
            opts.onProgress?.({ stage: "complete", progress: 100 });
            resolve(data.secure_url as string);
          } else {
            reject(new Error("Upload failed: no URL returned."));
          }
        } catch {
          reject(new Error("Upload failed: invalid response."));
        }
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          reject(new Error(data.error?.message || `Upload failed (${xhr.status}).`));
        } catch {
          reject(new Error(`Upload failed (${xhr.status}).`));
        }
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error during upload.")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled.")));

    opts.onProgress?.({ stage: "uploading", progress: 30 });
    xhr.open("POST", uploadUrl);
    xhr.send(formData);
  });
}
