import { useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFarmProfile, putFarmAvatar, type FarmProfile } from "../api/public";
import { FarmAvatar } from "../components/FarmAvatar";
import { ImageCropModal } from "../components/ImageCropModal";
import { useActivity } from "../components/LoadingPopup";
import { AVATAR_PRESETS } from "../lib/avatars";
import { useFarmSession } from "../lib/farmSession";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const comma = text.indexOf(",");
      resolve(comma >= 0 ? text.slice(comma + 1) : text);
    };
    reader.onerror = () => reject(new Error("failed to read image"));
    reader.readAsDataURL(file);
  });
}

export function ProfilePage() {
  const { identity } = useFarmSession();
  const farmId = identity?.farm_id ?? "";
  const queryClient = useQueryClient();
  const { setLabel } = useActivity();
  const fileRef = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ["profile", farmId],
    queryFn: () => fetchFarmProfile(farmId),
    enabled: Boolean(farmId),
  });

  const save = useMutation({
    mutationFn: async (body: Parameters<typeof putFarmAvatar>[1]) => putFarmAvatar(farmId, body),
    onSuccess: (next) => {
      queryClient.setQueryData(["profile", farmId], next);
      void queryClient.invalidateQueries({ queryKey: ["tournament"] });
      void queryClient.invalidateQueries({ queryKey: ["farm"] });
    },
  });

  if (!identity) {
    return <Navigate to="/" replace />;
  }

  const profile: FarmProfile = profileQuery.data ?? {
    farm_id: identity.farm_id,
    name: identity.name,
  };

  async function onPreset(presetId: string) {
    setError(null);
    setLabel("Saving picture…");
    try {
      await save.mutateAsync({ kind: "preset", preset_id: presetId });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLabel(null);
    }
  }

  function onPickFile(file: File | undefined) {
    if (!file) return;
    if (!ALLOWED_TYPES.has(file.type)) {
      setError("Use a JPEG, PNG, WebP, or GIF image.");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setError("Image must be 10 MB or smaller.");
      return;
    }
    setError(null);
    setCropFile(file);
  }

  async function onCrop(file: File) {
    setCropFile(null);
    setLabel("Uploading picture…");
    try {
      const data = await fileToBase64(file);
      await save.mutateAsync({ kind: "upload", content_type: file.type, data });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLabel(null);
    }
  }

  async function onClear() {
    setError(null);
    setLabel("Removing picture…");
    try {
      await save.mutateAsync({ kind: "none" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLabel(null);
    }
  }

  return (
    <div className="card profile-sheet" data-testid="profile-page">
      <div className="kicker">Your profile</div>
      <p className="meta">
        <Link to={`/farm/${identity.farm_id}`}>View tournament result →</Link>
      </p>
      <div className="profile-hero">
        <FarmAvatar fields={profile} className="profile-avatar-lg" alt="" />
        <div>
          <h2 data-testid="profile-name">{profile.name || identity.name}</h2>
          <p className="farm-id" data-testid="profile-farm-id">
            {identity.farm_id}
          </p>
        </div>
      </div>
      {error && (
        <p className="flash err" role="alert">
          {error}
        </p>
      )}
      <section className="profile-edit" data-testid="profile-edit">
        <h3>Profile picture</h3>
        <p className="meta">Pick an NPC from Sunflower Land, or upload your own photo.</p>
        <div className="preset-grid" data-testid="avatar-presets">
          {AVATAR_PRESETS.map((preset) => {
            const selected = profile.avatar_kind === "preset" && profile.avatar_preset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                className={["preset-option", selected ? "is-selected" : ""].filter(Boolean).join(" ")}
                data-testid={`avatar-preset-${preset.id}`}
                aria-pressed={selected}
                disabled={save.isPending}
                onClick={() => void onPreset(preset.id)}
              >
                <img src={`/avatars/${preset.file}`} alt="" />
                <span>{preset.name}</span>
              </button>
            );
          })}
        </div>
        <div className="toolbar">
          <button
            className="btn primary"
            type="button"
            disabled={save.isPending}
            data-testid="avatar-upload"
            onClick={() => fileRef.current?.click()}
          >
            Upload picture
          </button>
          {profile.avatar_kind ? (
            <button
              className="btn"
              type="button"
              disabled={save.isPending}
              data-testid="avatar-clear"
              onClick={() => void onClear()}
            >
              Remove picture
            </button>
          ) : null}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          hidden
          data-testid="avatar-file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            onPickFile(file);
          }}
        />
      </section>
      {cropFile ? (
        <ImageCropModal job={{ slot: "avatar", file: cropFile }} onApply={onCrop} onCancel={() => setCropFile(null)} />
      ) : null}
    </div>
  );
}
