import type { ProjectCatalog } from "../../shared/customization.ts";

export interface ProjectReadError { name: string; message: string; at: number; status: number | null; code: string | null }
export interface ProjectLoad { catalog: ProjectCatalog | null; unavailable: boolean; error: ProjectReadError | null }

export function projectReadSucceeded(catalog: ProjectCatalog): ProjectLoad {
  return { catalog, unavailable: false, error: null };
}

/** Preserve the last result and bounded diagnostics; error details are not normal sidebar text. */
export function projectReadFailed(previous: ProjectLoad | undefined, error: unknown): ProjectLoad {
  const details = error as { status?: unknown; code?: unknown } | null;
  return {
    catalog: previous?.catalog ?? null, unavailable: true,
    error: {
      name: error instanceof Error ? error.name.slice(0, 80) : "Error",
      message: (error instanceof Error ? error.message : String(error)).slice(0, 400), at: Date.now(),
      status: typeof details?.status === "number" ? details.status : null,
      code: typeof details?.code === "string" ? details.code.slice(0, 80) : null,
    },
  };
}
