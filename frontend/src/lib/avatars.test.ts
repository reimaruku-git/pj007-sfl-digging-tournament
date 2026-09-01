import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AVATAR_PRESETS, avatarSrc, presetSrc } from "./avatars";

describe("avatar presets", () => {
  it("ships one frontend file per NPC preset", () => {
    const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../public/avatars");
    const files = new Set(readdirSync(publicRoot));
    expect(AVATAR_PRESETS.map((row) => row.id)).toEqual([
      "jafar",
      "betty",
      "blacksmith",
      "corale",
      "tango",
      "old_salty",
      "victoria",
      "jester",
      "tywin",
      "timmy",
      "pumpkin_pete",
      "bert",
      "finley",
      "pharaoh",
      "cornwell",
      "miranda",
      "raven",
      "finn",
      "gambit",
      "gordo",
      "grimbly",
      "grimtooth",
      "grubnuk",
      "guria",
      "hammerin_harry",
      "mayor",
    ]);
    for (const preset of AVATAR_PRESETS) {
      expect(files.has(preset.file)).toBe(true);
      const bytes = readFileSync(resolve(publicRoot, preset.file));
      expect(bytes.byteLength).toBeGreaterThan(100);
      expect(presetSrc(preset.id)).toBe(`/avatars/${preset.file}`);
    }
  });

  it("resolves preset paths and upload URLs", () => {
    expect(avatarSrc({ avatar_kind: "preset", avatar_preset: "betty" })).toBe("/avatars/betty.webp");
    expect(
      avatarSrc({
        avatar_kind: "upload",
        avatar_url: "https://api.example/media/avatars/1/avatar.jpg",
      }),
    ).toBe("https://api.example/media/avatars/1/avatar.jpg");
    expect(avatarSrc({ avatar_kind: "preset", avatar_preset: "missing" })).toBeNull();
    expect(avatarSrc({})).toBeNull();
  });
});
