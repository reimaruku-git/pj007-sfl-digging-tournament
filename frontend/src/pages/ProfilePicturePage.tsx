import { useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFarmProfile, putFarmAvatar, type FarmProfile } from "../api/public";
import { DetailBackLink } from "../components/DetailBackLink";
import { FarmAvatar } from "../components/FarmAvatar";
import { ImageCropModal } from "../components/ImageCropModal";
import { useActivity } from "../components/LoadingPopup";
import { AVATAR_PRESETS } from "../lib/avatars";
import { useFarmSession } from "../lib/farmSession";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

type PictureLocationState = {
  from?: string;
};

type Draft =
  | { kind: "preset"; preset_id: string }
  | { kind: "upload"; content_type: string; data: string }
  | { kind: "none" };

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

function savedDraft(profile: FarmProfile): Draft | null {
  if (profile.avatar_kind === "preset" && profile.avatar_preset) {
    return { kind: "preset", preset_id: profile.avatar_preset };
  }
  if (profile.avatar_kind === "upload") {
    return { kind: "upload", content_type: "", data: "" };
  }
  return null;
}

function draftsEqual(a: Draft | null, b: Draft | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "preset" && b.kind === "preset") return a.preset_id === b.preset_id;
  if (a.kind === "none" && b.kind === "none") return true;
  if (a.kind === "upload" && b.kind === "upload") return a.data === b.data;
  return false;
}

export function ProfilePicturePage() {
  const { identity } = useFarmSession();
  const farmId = identity?.farm_id ?? "";
  const location = useLocation();
  const from = (location.state as PictureLocationState | null)?.from;
  const queryClient = useQueryClient();
  const { setLabel } = useActivity();
  const fileRef = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

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
  const current = savedDraft(profile);
  const pending = draft ?? current;
  const dirty = !draftsEqual(draft, current) && draft !== null;

  async function onSave() {
    if (!draft) return;
    setError(null);
    setLabel("Saving picture…");
    try {
      if (draft.kind === "preset") {
        await save.mutateAsync({ kind: "preset", preset_id: draft.preset_id });
      } else if (draft.kind === "none") {
        await save.mutateAsync({ kind: "none" });
      } else {
        await save.mutateAsync({
          kind: "upload",
          content_type: draft.content_type,
          data: draft.data,
        });
      }
      setDraft(null);
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
    try {
      const data = await fileToBase64(file);
      setDraft({ kind: "upload", content_type: file.type, data });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="card profile-sheet" data-testid="profile-picture-page">
      <div className="detail-chrome">
        <DetailBackLink to="/profile" label="Back to Profile" state={{ from }} />
      </div>
      <div className="kicker">Profile picture</div>
      <div className="profile-hero">
        <FarmAvatar fields={profile} className="profile-avatar-lg" alt="" />
        <div>
          <h2 data-testid="profile-name">{profile.name || identity.name}</h2>
          <p className="farm-id" data-testid="profile-farm-id">
            {identity.farm_id}
          </p>
          <p className="meta">Click an NPC, then save. Your picture elsewhere updates after save.</p>
        </div>
      </div>
      {error && (
        <p className="flash err" role="alert">
          {error}
        </p>
      )}
      <section className="profile-edit" data-testid="profile-edit">
        <div className="preset-grid" data-testid="avatar-presets">
          {AVATAR_PRESETS.map((preset) => {
            const selected = pending?.kind === "preset" && pending.preset_id === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                className={["preset-option", selected ? "is-selected" : ""].filter(Boolean).join(" ")}
                data-testid={`avatar-preset-${preset.id}`}
                aria-pressed={selected}
                disabled={save.isPending}
                onClick={() => setDraft({ kind: "preset", preset_id: preset.id })}
              >
                <img src={`/avatars/${preset.file}`} alt="" />
                <span>{preset.name}</span>
              </button>
            );
          })}
        </div>
        <div className="toolbar profile-picture-toolbar">
          <button
            className="btn primary"
            type="button"
            disabled={!dirty || save.isPending}
            data-testid="avatar-save"
            onClick={() => void onSave()}
          >
            Save
          </button>
          <button
            className="btn"
            type="button"
            disabled={save.isPending}
            data-testid="avatar-upload"
            onClick={() => fileRef.current?.click()}
          >
            Upload picture
          </button>
          {pending?.kind ? (
            <button
              className="btn"
              type="button"
              disabled={save.isPending}
              data-testid="avatar-clear"
              onClick={() => setDraft({ kind: "none" })}
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
