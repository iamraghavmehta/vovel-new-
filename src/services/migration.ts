/**
 * Local → cloud migration. Reuses the import pipeline, so it is two-phase (preview, then
 * explicit confirmation), skips words the account already has, never overwrites anything,
 * and never touches the local copy — local data is kept until the user chooses to erase it.
 */
import type { VovelRepository } from "../data/repository";
import { applyImport, buildExport, parseImport, planImport, type ImportPlan, type ImportSummary } from "./importExport";

export async function previewMigration(local: VovelRepository, cloud: VovelRepository): Promise<ImportPlan> {
  const parsed = parseImport(JSON.stringify(buildExport(await local.exportSnapshot(), new Date())));
  if (!parsed.ok) throw new Error(parsed.error);
  return planImport(parsed, { words: await cloud.listWords(), collections: await cloud.listCollections() });
}

/** Call only after the user has seen the preview and confirmed. */
export async function runMigration(cloud: VovelRepository, plan: ImportPlan): Promise<ImportSummary> {
  return applyImport(cloud, plan);
}
