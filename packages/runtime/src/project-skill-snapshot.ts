import { constants, type Stats } from "node:fs";
import {
  lstat,
  open,
  opendir,
  realpath,
  stat,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";

import {
  ExecutionError,
  FileError,
  formatSkillInvocation,
  loadSkills,
  type ExecutionEnv,
  type FileInfo,
  type Result,
  type ShellExecOptions,
  type Skill,
} from "@earendil-works/pi-agent-core";
import type {
  ProjectSkillSnapshotManifestV1,
  SkillCatalogBindingV1,
  SkillLoadFailureCode,
  SkillLoadFailureV1,
} from "@napier/contracts/skill-load";
import {
  isProjectSkillSnapshotManifestV1,
  isSkillCatalogBindingV1,
  isSkillLoadFailureV1,
} from "@napier/contracts/skill-load";

import { canonicalJson, sha256 } from "./ed25519.js";
import { loadProjectSkillResource, type ProjectSkillResourceContent, type ProjectSkillResourceHooks } from "./project-skill-resource.js";

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_DIRECTORY_SCAN_ENTRIES = 4096;
const OVERFLOW_IDENTITY = sha256("project_skill_direct_directory_overflow:65");
const VIRTUAL_ROOT = "/project/skills";
const TRUST_POLICY = {
  authorization: "same_canonical_active_user_selected_project",
  discovery: "configured_direct_skill_md_only",
  filesystem: "platform_probed_fd_or_darwin_held_parent_identity_checks",
  resources: "on_demand_text_only_nofollow_64k",
  shell: "denied",
  writes: "denied",
  maxConfiguredRequests: 64,
  maxDirectDirectories: 64,
  maxDirectoryScanEntries: MAX_DIRECTORY_SCAN_ENTRIES,
  maxFileBytes: MAX_FILE_BYTES,
  maxAggregateBytes: MAX_TOTAL_BYTES,
} as const;

export interface ProjectSkillSnapshotEntry {
  canonicalName: string;
  requestedNameSha256: string;
  relativePath: string;
  virtualPath: string;
  directoryKind: "directory";
  fileKind: "regular_file";
  symlinkFree: true;
  sizeBytes: number;
  lineCount: number;
  rawContentSha256: string;
  metadataSha256: string;
  invocationSha256: string;
  rawContentBase64: string;
  metadata: { name: string; description: string; disableModelInvocation: false };
  formattedInvocation: string;
}

export interface ProjectSkillSnapshotV1 {
  kind: "napier.project-skill-snapshot";
  schemaVersion: 1;
  storage: "local_only";
  source: "project";
  trustOrigin: "active_user_selected_project";
  workspaceIdentitySha256: string;
  trustPolicySha256: string;
  configuredSkillRequests: SkillCatalogBindingV1["configuredSkillRequests"];
  selectionSha256: string;
  directDirectoryCount: number;
  directoryIdentitySetSha256: string;
  directoryIdentitySha256s: string[];
  catalogSha256: string;
  availabilitySetSha256: string;
  entryCount: number;
  aggregateRawBytes: number;
  entries: ProjectSkillSnapshotEntry[];
  unavailableSkills: SkillLoadFailureV1[];
  snapshotContentSha256: string;
}

export interface ProjectSkillSnapshot {
  readonly content: Readonly<ProjectSkillSnapshotV1>;
  readonly manifest: Readonly<ProjectSkillSnapshotManifestV1>;
  readonly binding: Readonly<SkillCatalogBindingV1>;
  readonly skills: readonly Skill[];
  entry(name: string): Readonly<ProjectSkillSnapshotEntry> | undefined;
  loadResource(name: string, resourcePath: string, signal?: AbortSignal, hooks?: ProjectSkillResourceHooks): Promise<ProjectSkillResourceContent>;
}

export class ProjectSkillSnapshotError extends Error {
  constructor(
    readonly code: "configured_request_limit" | "project_catalog_overflow" | "workspace_untrusted",
    readonly failure?: SkillLoadFailureV1,
  ) {
    super(`Project Skill snapshot failed: ${code}`);
    this.name = "ProjectSkillSnapshotError";
  }
}

type FailureDraft = { position: number; raw: string; code: SkillLoadFailureCode; diagnostic: string };
type AcquiredEntry = { entry: ProjectSkillSnapshotEntry; skill: Skill };
type AcquisitionFailure = { code: SkillLoadFailureCode; diagnostic: string };
type DirectoryState = { count: number; identityHashes: string[]; entries: Map<string, "directory" | "symlink" | "other"> };
type TraversalStrategy = "fd_relative" | "darwin_held_path";
type HandleTraversalProbe = {
  fdIdentityMatches: boolean;
  directoryOpened: boolean;
  directoryOpenErrorCode?: string;
  childOpened: boolean;
  childOpenErrorCode?: string;
};
type SkillsRootAnchor = {
  path: string;
  relativePath: string;
  handle: FileHandle;
  identity: Stats;
  workspacePath: string;
  workspaceHandle: FileHandle;
  workspaceIdentity: Stats;
  traversalStrategy: TraversalStrategy;
};
export interface ProjectSkillSnapshotHooks {
  afterRootOpen?(): void | Promise<void>;
  afterDirectoryEntry?(scanned: number): void | Promise<void>;
  afterSkillDirectoryOpen?(skillName: string): void | Promise<void>;
  afterSkillFileOpen?(skillName: string): void | Promise<void>;
  afterSkillFileRead?(skillName: string): void | Promise<void>;
}

export async function buildProjectSkillSnapshot(
  workspaceRoot: string,
  configuredNames: readonly string[],
  signal?: AbortSignal,
  hooks: ProjectSkillSnapshotHooks = {},
): Promise<ProjectSkillSnapshot> {
  check(signal);
  if (configuredNames.length > 64) throw new ProjectSkillSnapshotError("configured_request_limit");
  if (typeof constants.O_NOFOLLOW !== "number" || typeof constants.O_DIRECTORY !== "number") {
    throw new ProjectSkillSnapshotError("workspace_untrusted");
  }
  const canonicalWorkspace = await realpath(workspaceRoot).catch(() => undefined);
  check(signal);
  if (!canonicalWorkspace) throw new ProjectSkillSnapshotError("workspace_untrusted");
  const workspaceInfo = await lstat(canonicalWorkspace).catch(() => undefined);
  if (!workspaceInfo?.isDirectory() || workspaceInfo.isSymbolicLink()) {
    throw new ProjectSkillSnapshotError("workspace_untrusted");
  }
  check(signal);
  const skillsRoot = path.join(canonicalWorkspace, "skills");
  const anchor = await openSkillsRoot(canonicalWorkspace, skillsRoot, signal);
  try {
  await hooks.afterRootOpen?.(); check(signal);
  const requestedNames = new Set(configuredNames.filter(validName));
  const directories = await inspectDirectDirectories(anchor, requestedNames, signal, hooks);
  const directoryIdentitySetSha256 = sha256(canonicalJson(directories.identityHashes));
  if (directories.count === 65) {
    const core = {
      kind: "napier.skill-load-failure" as const,
      schemaVersion: 1 as const,
      operation: "skill.load" as const,
      agentToolName: "skill_load" as const,
      source: "project" as const,
      subject: "project_catalog" as const,
      state: "unavailable" as const,
      failureCode: "skill_limit_exceeded" as const,
      observedDirectoryCount: 65 as const,
      directoryIdentitySetSha256,
      catalogSha256: sha256(canonicalJson({ directDirectoryCount: 65, directoryIdentitySetSha256 })),
      diagnosticSha256: sha256("project_skill_direct_directory_limit"),
    };
    const failure = { ...core, contentSha256: sha256(canonicalJson(core)) };
    if (!isSkillLoadFailureV1(failure)) throw new Error("Skill overflow invariant failed");
    throw new ProjectSkillSnapshotError("project_catalog_overflow", failure);
  }

  const acquired = await acquireConfiguredEntries(
    anchor,
    configuredNames,
    directories,
    signal,
    hooks,
  );
  const { failures, entries, skills, aggregateRawBytes } = acquired;
  check(signal);
  entries.sort((left, right) => compare(left.canonicalName, right.canonicalName));
  skills.sort((left, right) => compare(left.name, right.name));
  const catalogSha256 = sha256(canonicalJson({
    directDirectoryCount: directories.count,
    directoryIdentitySetSha256,
    entries: entries.map(publicEntry),
  }));
  const unavailableByPosition = new Map<number, SkillLoadFailureV1>();
  for (const draft of failures) {
    const core = {
      kind: "napier.skill-load-failure" as const, schemaVersion: 1 as const,
      operation: "skill.load" as const, agentToolName: "skill_load" as const,
      source: "project" as const, subject: "skill_request" as const,
      state: "unavailable" as const, failureCode: draft.code,
      requestedNameSha256: sha256(draft.raw),
      ...(validName(draft.raw) ? { canonicalName: draft.raw } : {}),
      catalogSha256, diagnosticSha256: sha256(`snapshot:${draft.diagnostic}`),
    };
    const failure = { ...core, contentSha256: sha256(canonicalJson(core)) };
    if (!isSkillLoadFailureV1(failure)) throw new Error("Skill failure invariant failed");
    unavailableByPosition.set(draft.position, failure);
  }
  const unavailableSkills = [...new Map([...unavailableByPosition.values()].map((item) => [item.contentSha256, item])).values()].sort((left, right) => compare(left.contentSha256, right.contentSha256));
  const configuredSkillRequests = configuredNames.map((raw, position) => {
    const failure = unavailableByPosition.get(position);
    return failure
      ? { position, requestedNameSha256: sha256(raw), state: "unavailable" as const, failureContentSha256: failure.contentSha256, ...(validName(raw) ? { canonicalName: raw } : {}) }
      : { position, requestedNameSha256: sha256(raw), state: "loadable" as const, canonicalName: raw };
  });
  const loadableSkillNames = entries.map((entry) => entry.canonicalName);
  const unavailableFailureContentSha256s = unavailableSkills.map((item) => item.contentSha256);
  const availabilitySetSha256 = sha256(canonicalJson({ configuredSkillRequests, loadableSkillNames, unavailableFailureContentSha256s, catalogSha256 }));
  const privateCore = {
    kind: "napier.project-skill-snapshot" as const, schemaVersion: 1 as const,
    storage: "local_only" as const, source: "project" as const,
    trustOrigin: "active_user_selected_project" as const,
    workspaceIdentitySha256: sha256(canonicalWorkspace),
    trustPolicySha256: sha256(canonicalJson(TRUST_POLICY)),
    configuredSkillRequests, selectionSha256: sha256(canonicalJson(configuredSkillRequests)),
    directDirectoryCount: directories.count, directoryIdentitySetSha256,
    directoryIdentitySha256s: directories.identityHashes, catalogSha256,
    availabilitySetSha256, entryCount: entries.length, aggregateRawBytes,
    entries, unavailableSkills,
  };
  const content: ProjectSkillSnapshotV1 = { ...privateCore, snapshotContentSha256: sha256(canonicalJson(privateCore)) };
  const manifestCore = {
    kind: "napier.project-skill-snapshot-manifest" as const, schemaVersion: 1 as const,
    source: "project" as const, trustOrigin: "active_user_selected_project" as const,
    workspaceIdentitySha256: content.workspaceIdentitySha256,
    trustPolicySha256: content.trustPolicySha256, configuredSkillRequests,
    selectionSha256: content.selectionSha256, directDirectoryCount: directories.count,
    directoryIdentitySetSha256, catalogSha256, availabilitySetSha256,
    entryCount: entries.length, aggregateRawBytes, entries: entries.map(publicEntry),
    unavailableFailureContentSha256s, snapshotContentSha256: content.snapshotContentSha256,
  };
  const manifest = { ...manifestCore, snapshotManifestSha256: sha256(canonicalJson(manifestCore)) };
  const bindingCore = {
    kind: "napier.skill-catalog-binding" as const, schemaVersion: 1 as const,
    operation: "skill.load" as const, agentToolName: "skill_load" as const,
    configuredSkillRequests, loadableSkillNames, unavailableSkills,
    catalogSha256, availabilitySetSha256, snapshotManifestSha256: manifest.snapshotManifestSha256,
  };
  const binding = { ...bindingCore, contentSha256: sha256(canonicalJson(bindingCore)) };
  if (!isProjectSkillSnapshotManifestV1(manifest)) throw new Error("Project Skill manifest invariant failed");
  if (!isSkillCatalogBindingV1(binding)) throw new Error("Project Skill binding invariant failed");
  await assertAnchorCurrent(anchor, signal);
  check(signal);
  const byName = new Map(entries.map((entry) => [entry.canonicalName, entry]));
  return deepFreeze({ content, manifest, binding, skills, entry: (skillName: string) => byName.get(skillName), loadResource: (skillName: string, resourcePath: string, resourceSignal?: AbortSignal, resourceHooks?: ProjectSkillResourceHooks) => { const entry=byName.get(skillName); if(!entry) throw new Error("Skill resource request is not snapshot-bound"); return loadProjectSkillResource(canonicalWorkspace,entry,resourcePath,resourceSignal,resourceHooks); } });
  } finally { await Promise.all([anchor.handle.close(), anchor.workspaceHandle.close()]); }
}

async function acquireConfiguredEntries(
  anchor: SkillsRootAnchor,
  configuredNames: readonly string[],
  directories: DirectoryState,
  signal: AbortSignal | undefined,
  hooks: ProjectSkillSnapshotHooks,
): Promise<{ failures: FailureDraft[]; entries: ProjectSkillSnapshotEntry[]; skills: Skill[]; aggregateRawBytes: number }> {
  const counts = new Map<string, number>();
  for (const raw of configuredNames) if (validName(raw)) counts.set(raw, (counts.get(raw) ?? 0) + 1);
  const failures: FailureDraft[] = [], entries: ProjectSkillSnapshotEntry[] = [], skills: Skill[] = [];
  let aggregateRawBytes = 0;
  for (const [position, raw] of configuredNames.entries()) {
    check(signal);
    if (!validName(raw)) { failures.push({ position, raw, code: "skill_invalid", diagnostic: "invalid_name" }); continue; }
    if ((counts.get(raw) ?? 0) > 1) { failures.push({ position, raw, code: "skill_ambiguous", diagnostic: "duplicate_request" }); continue; }
    const kind = directories.entries.get(raw);
    if (!kind) { failures.push({ position, raw, code: "skill_not_found", diagnostic: "direct_directory_missing" }); continue; }
    if (kind === "symlink") { failures.push({ position, raw, code: "skill_untrusted", diagnostic: "directory_symlink" }); continue; }
    if (kind !== "directory") { failures.push({ position, raw, code: "skill_invalid", diagnostic: "directory_kind" }); continue; }
    const acquired = await acquireEntry(anchor, raw, signal, hooks);
    if ("code" in acquired) { failures.push({ position, raw, ...acquired }); continue; }
    if (aggregateRawBytes + acquired.entry.sizeBytes > MAX_TOTAL_BYTES) { failures.push({ position, raw, code: "skill_limit_exceeded", diagnostic: "aggregate_bytes" }); continue; }
    aggregateRawBytes += acquired.entry.sizeBytes;
    entries.push(acquired.entry); skills.push(acquired.skill);
  }
  return { failures, entries, skills, aggregateRawBytes };
}

async function openSkillsRoot(workspacePath:string,root:string,signal?:AbortSignal):Promise<SkillsRootAnchor>{
  const workspaceInfo=await stableDirectoryInfo(workspacePath,signal);
  const workspaceHandle=await open(workspacePath,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW).catch(()=>undefined);
  if(!workspaceHandle)throw new ProjectSkillSnapshotError("workspace_untrusted");
  let handle:FileHandle|undefined;
  try{
    const workspaceIdentity=await workspaceHandle.stat();check(signal);
    if(!workspaceIdentity.isDirectory()||!sameIdentity(workspaceIdentity,workspaceInfo))throw new ProjectSkillSnapshotError("workspace_untrusted");
    const workspaceTraversal=await handleRelativePath(workspaceHandle,workspaceIdentity,workspacePath,signal);
    const relativeRoot=path.join(workspaceTraversal.path,"skills");
    const pathInfo=await stableDirectoryInfo(root,signal);
    handle=await open(relativeRoot,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW).catch(()=>undefined);
    if(!handle)throw new ProjectSkillSnapshotError("workspace_untrusted");
    const identity=await handle.stat();check(signal);
    if(!identity.isDirectory()||!sameIdentity(identity,pathInfo))throw new ProjectSkillSnapshotError("workspace_untrusted");
    const rootTraversal=await handleRelativePath(handle,identity,root,signal);
    if(rootTraversal.strategy!==workspaceTraversal.strategy)throw new ProjectSkillSnapshotError("workspace_untrusted");
    const anchor={path:root,relativePath:rootTraversal.path,handle,identity,workspacePath,workspaceHandle,workspaceIdentity,traversalStrategy:rootTraversal.strategy};
    await assertAnchorCurrent(anchor,signal);
    return anchor;
  }catch(error){await Promise.allSettled([handle?.close(),workspaceHandle.close()]);throw error;}
}

async function stableDirectoryInfo(target:string,signal?:AbortSignal):Promise<Stats>{
  check(signal);const info=await lstat(target).catch(()=>undefined);check(signal);
  if(!info?.isDirectory()||info.isSymbolicLink())throw new ProjectSkillSnapshotError("workspace_untrusted");
  return info;
}

async function handleRelativePath(handle:FileHandle,identity:Stats,fallbackPath:string,signal?:AbortSignal):Promise<{path:string;strategy:TraversalStrategy}>{
  const candidate=process.platform==="darwin"?`/dev/fd/${handle.fd}`:process.platform==="linux"?`/proc/self/fd/${handle.fd}`:undefined;
  if(!candidate)throw new ProjectSkillSnapshotError("workspace_untrusted");
  check(signal);const resolved=await stat(candidate).catch(()=>undefined);check(signal);
  let directoryOpened=false,directoryOpenErrorCode:string|undefined,childOpened=false,childOpenErrorCode:string|undefined;
  try{const directory=await opendir(candidate);await directory.close();directoryOpened=true;}catch(error){directoryOpenErrorCode=errorCode(error);}
  try{const child=await open(path.join(candidate,"."),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);await child.close();childOpened=true;}catch(error){childOpenErrorCode=errorCode(error);}
  const strategy=resolveProjectSkillTraversalStrategy(process.platform,{fdIdentityMatches:Boolean(resolved?.isDirectory()&&sameHandlePathIdentity(identity,resolved)),directoryOpened,...(directoryOpenErrorCode?{directoryOpenErrorCode}:{}),childOpened,...(childOpenErrorCode?{childOpenErrorCode}:{})});
  if(strategy==="fd_relative")return{path:candidate,strategy};
  const current=await stableDirectoryInfo(fallbackPath,signal);check(signal);
  if(!sameStableState(identity,current))throw new ProjectSkillSnapshotError("workspace_untrusted");
  return{path:fallbackPath,strategy};
}

export function resolveProjectSkillTraversalStrategy(platform:string,probe:HandleTraversalProbe):TraversalStrategy{
  if(!probe.fdIdentityMatches)throw new ProjectSkillSnapshotError("workspace_untrusted");
  if(platform==="linux"){
    if(probe.directoryOpened&&probe.childOpened)return"fd_relative";
    throw new ProjectSkillSnapshotError("workspace_untrusted");
  }
  if(platform==="darwin"){
    if(probe.directoryOpened&&probe.childOpened)return"fd_relative";
    if(!probe.directoryOpened&&!probe.childOpened&&probe.directoryOpenErrorCode==="ENOTDIR"&&(probe.childOpenErrorCode==="ENOENT"||probe.childOpenErrorCode==="ENOTDIR"))return"darwin_held_path";
    throw new ProjectSkillSnapshotError("workspace_untrusted");
  }
  throw new ProjectSkillSnapshotError("workspace_untrusted");
}

async function assertAnchorCurrent(anchor:SkillsRootAnchor,signal?:AbortSignal):Promise<void>{
  check(signal);const [workspaceHeld,held]=await Promise.all([anchor.workspaceHandle.stat(),anchor.handle.stat()]);check(signal);const [workspaceCurrent,current]=await Promise.all([lstat(anchor.workspacePath).catch(()=>undefined),lstat(anchor.path).catch(()=>undefined)]);check(signal);
  if(!workspaceCurrent?.isDirectory()||workspaceCurrent.isSymbolicLink()||!current?.isDirectory()||current.isSymbolicLink()||!sameStableState(anchor.workspaceIdentity,workspaceHeld)||!sameStableState(workspaceHeld,workspaceCurrent)||!sameStableState(anchor.identity,held)||!sameStableState(held,current))throw new ProjectSkillSnapshotError("workspace_untrusted");
}

async function inspectDirectDirectories(anchor:SkillsRootAnchor,requested:Set<string>,signal:AbortSignal|undefined,hooks:ProjectSkillSnapshotHooks):Promise<DirectoryState>{
  check(signal); const entries=new Map<string,"directory"|"symlink"|"other">(), identityHashes:string[]=[];
  const directory=await opendir(anchor.relativePath).catch(()=>undefined); if(!directory) throw new ProjectSkillSnapshotError("workspace_untrusted");
  let count=0, scanned=0;
  try { for (;;) { check(signal); const item=await directory.read(); check(signal); if(!item) break; scanned+=1; if(scanned>MAX_DIRECTORY_SCAN_ENTRIES) throw new ProjectSkillSnapshotError("workspace_untrusted"); await hooks.afterDirectoryEntry?.(scanned); check(signal); const kind=item.isDirectory()?"directory":item.isSymbolicLink()?"symlink":"other"; if(requested.has(item.name)) entries.set(item.name,kind); if(kind!=="directory") continue; count+=1; if(count===65){identityHashes.splice(0,identityHashes.length,OVERFLOW_IDENTITY);break;} identityHashes.push(sha256(item.name)); } }
  finally { await directory.close().catch(()=>undefined); }
  identityHashes.sort(compare); await assertAnchorCurrent(anchor,signal); return {count,identityHashes,entries};
}

async function acquireEntry(anchor:SkillsRootAnchor,skillName:string,signal:AbortSignal|undefined,hooks:ProjectSkillSnapshotHooks):Promise<AcquiredEntry|AcquisitionFailure>{
  check(signal);await assertAnchorCurrent(anchor,signal);const directory=path.join(anchor.path,skillName), relativeDirectory=path.join(anchor.relativePath,skillName), target=path.join(directory,"SKILL.md");
  const dirBefore=await lstat(directory).catch(()=>undefined); check(signal); if(!dirBefore?.isDirectory()||dirBefore.isSymbolicLink()) return {code:"skill_untrusted",diagnostic:"directory_changed"};
  const dirHandle=await open(relativeDirectory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW).catch(()=>undefined); if(!dirHandle) return {code:"skill_untrusted",diagnostic:"directory_nofollow"};
  try {
    const dirOpened=await dirHandle.stat(); check(signal); if(!dirOpened.isDirectory()||!sameIdentity(dirBefore,dirOpened)) return {code:"skill_catalog_drift",diagnostic:"directory_identity"};
    await assertAnchorCurrent(anchor,signal);const dirTraversal=await handleRelativePath(dirHandle,dirOpened,directory,signal);if(dirTraversal.strategy!==anchor.traversalStrategy)throw new ProjectSkillSnapshotError("workspace_untrusted");await hooks.afterSkillDirectoryOpen?.(skillName); check(signal);
    return await acquireFileEntry(dirHandle,dirOpened,dirTraversal.path,directory,target,skillName,signal,hooks);
  } finally {await dirHandle.close();}
}

async function acquireFileEntry(dirHandle:FileHandle,dirOpened:Stats,relativeDir:string,directory:string,target:string,skillName:string,signal:AbortSignal|undefined,hooks:ProjectSkillSnapshotHooks):Promise<AcquiredEntry|AcquisitionFailure>{
  await assertDirectoryCurrent(dirHandle,dirOpened,directory,signal);const relativeTarget=path.join(relativeDir,"SKILL.md"), fileBefore=await lstat(relativeTarget).catch(()=>undefined); check(signal);
  if(!fileBefore) return {code:"skill_not_found",diagnostic:"skill_md_missing"};
  if(fileBefore.isSymbolicLink()) return {code:"skill_untrusted",diagnostic:"file_symlink"};
  if(!fileBefore.isFile()) return {code:"skill_invalid",diagnostic:"file_kind"};
  if(fileBefore.size<1) return {code:"skill_invalid",diagnostic:"file_bytes"};
  if(fileBefore.size>MAX_FILE_BYTES) return {code:"skill_limit_exceeded",diagnostic:"file_bytes"};
  const fileHandle=await open(relativeTarget,constants.O_RDONLY|constants.O_NOFOLLOW).catch(()=>undefined); if(!fileHandle) return {code:"skill_untrusted",diagnostic:"file_nofollow"};
  try {
    const opened=await fileHandle.stat(); check(signal);await assertDirectoryCurrent(dirHandle,dirOpened,directory,signal);
    if(!opened.isFile()||!sameIdentity(fileBefore,opened)) return {code:"skill_catalog_drift",diagnostic:"file_identity"};
    if(opened.size<1) return {code:"skill_invalid",diagnostic:"opened_file_bytes"};
    if(opened.size>MAX_FILE_BYTES) return {code:"skill_limit_exceeded",diagnostic:"opened_file_bytes"};
    await hooks.afterSkillFileOpen?.(skillName); check(signal);
    const bytes=await boundedRead(fileHandle,signal);
    if(bytes.byteLength>MAX_FILE_BYTES) return {code:"skill_limit_exceeded",diagnostic:"file_overread"};
    await hooks.afterSkillFileRead?.(skillName); check(signal);
    return await finalizeAcquiredEntry(fileHandle,dirHandle,opened,dirOpened,directory,target,skillName,bytes,signal);
  } finally {await fileHandle.close();}
}

async function finalizeAcquiredEntry(fileHandle:FileHandle,dirHandle:FileHandle,opened:Stats,dirOpened:Stats,directory:string,target:string,skillName:string,bytes:Buffer,signal?:AbortSignal):Promise<AcquiredEntry|AcquisitionFailure>{
  const heldAfter=await fileHandle.stat(), dirHeldAfter=await dirHandle.stat(), fileAfter=await lstat(target).catch(()=>undefined), dirAfter=await lstat(directory).catch(()=>undefined); check(signal);
  if(!fileAfter?.isFile()||fileAfter.isSymbolicLink()||!dirAfter?.isDirectory()||dirAfter.isSymbolicLink()||!sameStableState(opened,heldAfter)||!sameStableState(opened,fileAfter)||!sameStableState(dirOpened,dirHeldAfter)||!sameStableState(dirOpened,dirAfter)) return {code:"skill_catalog_drift",diagnostic:"path_drift"};
  let text:string; try{text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch{return {code:"skill_invalid",diagnostic:"utf8"};}
  if(text.includes("\0")||!Buffer.from(text,"utf8").equals(bytes)) return {code:"skill_invalid",diagnostic:"text_encoding"};
  check(signal); const parsed=await parseInMemorySkill(skillName,text,signal);
  if(!parsed) return {code:"skill_invalid",diagnostic:"frontmatter"};
  if(parsed.disableModelInvocation) return {code:"skill_disabled",diagnostic:"model_invocation_disabled"};
  check(signal); const formattedInvocation=formatSkillInvocation(parsed); check(signal);
  const metadata={name:parsed.name,description:parsed.description,disableModelInvocation:false as const};
  const entry:ProjectSkillSnapshotEntry={canonicalName:skillName,requestedNameSha256:sha256(skillName),relativePath:`skills/${skillName}/SKILL.md`,virtualPath:`${VIRTUAL_ROOT}/${skillName}/SKILL.md`,directoryKind:"directory",fileKind:"regular_file",symlinkFree:true,sizeBytes:bytes.byteLength,lineCount:1+(text.match(/\n/gu)?.length??0),rawContentSha256:sha256(bytes),metadataSha256:sha256(canonicalJson(metadata)),invocationSha256:sha256(formattedInvocation),rawContentBase64:bytes.toString("base64"),metadata,formattedInvocation};
  return {entry,skill:parsed};
}

async function boundedRead(handle:FileHandle,signal?:AbortSignal):Promise<Buffer>{
  const buffer=Buffer.allocUnsafe(MAX_FILE_BYTES+1); let offset=0;
  while(offset<buffer.byteLength){check(signal);const {bytesRead}=await handle.read(buffer,offset,buffer.byteLength-offset,offset);check(signal);if(bytesRead===0)break;offset+=bytesRead;}
  return buffer.subarray(0,offset);
}

async function parseInMemorySkill(skillName:string,text:string,signal?:AbortSignal):Promise<Skill|undefined>{ const env=new FrozenSkillEnv(skillName,text); try { const result=await loadSkills(env,`${VIRTUAL_ROOT}/${skillName}`); check(signal); return result.diagnostics.length===0&&result.skills.length===1&&result.skills[0]?.name===skillName&&result.skills[0].description.trim().length>0?result.skills[0]:undefined; } finally { await env.cleanup(); } }
function publicEntry(entry:ProjectSkillSnapshotEntry){ const {rawContentBase64:_raw,metadata:_metadata,formattedInvocation:_invocation,...value}=entry; return value; }
function validName(value:unknown):value is string{return typeof value==="string"&&value.length>=1&&value.length<=64&&NAME.test(value);}
function compare(left:string,right:string):number{return left<right?-1:left>right?1:0;}
function sameIdentity(left:{dev:number|bigint;ino:number|bigint},right:{dev:number|bigint;ino:number|bigint}):boolean{return String(left.dev)===String(right.dev)&&String(left.ino)===String(right.ino);}
function sameStableState(left:Stats,right:Stats):boolean{return sameIdentity(left,right)&&left.size===right.size&&left.mtimeMs===right.mtimeMs&&left.ctimeMs===right.ctimeMs;}
function sameHandlePathIdentity(left:{dev:number|bigint;ino:number|bigint},right:{dev:number|bigint;ino:number|bigint}):boolean{return process.platform==="darwin"?String(left.ino)===String(right.ino):sameIdentity(left,right);}
async function assertDirectoryCurrent(handle:FileHandle,identity:Stats,target:string,signal?:AbortSignal):Promise<void>{check(signal);const held=await handle.stat();check(signal);const current=await lstat(target).catch(()=>undefined);check(signal);if(!current?.isDirectory()||current.isSymbolicLink()||!sameStableState(identity,held)||!sameStableState(held,current))throw new ProjectSkillSnapshotError("workspace_untrusted");}
function errorCode(error:unknown):string|undefined{return error&&typeof error==="object"&&"code"in error&&typeof error.code==="string"?error.code:undefined;}
function check(signal?:AbortSignal):void{if(signal?.aborted)throw signal.reason instanceof Error?signal.reason:new DOMException("Operation aborted","AbortError");}
function deepFreeze<T>(value:T):T{if(value&&typeof value==="object"&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value as Record<string,unknown>))deepFreeze(item);}return value;}

class FrozenSkillEnv implements ExecutionEnv {
  readonly cwd="/project"; private readonly dir:string; private readonly file:string;
  constructor(skillName:string,private readonly text:string){this.dir=`${VIRTUAL_ROOT}/${skillName}`;this.file=`${this.dir}/SKILL.md`;}
  private abort<T>(signal?:AbortSignal):Result<T,FileError>|undefined{return signal?.aborted?this.bad<T>("aborted","Memory Skill read aborted"):undefined;}
  private good<T>(value:T):Result<T,FileError>{return{ok:true,value};} private bad<T>(code:ConstructorParameters<typeof FileError>[0],message:string):Result<T,FileError>{return{ok:false,error:new FileError(code,message)};}
  private resolved(value:string){return path.posix.resolve(this.cwd,value);}
  private info(value:string):FileInfo|undefined{const resolved=this.resolved(value);if(resolved===this.file)return{name:"SKILL.md",path:this.file,kind:"file",size:Buffer.byteLength(this.text),mtimeMs:0};if(["/project",VIRTUAL_ROOT,this.dir].includes(resolved))return{name:path.posix.basename(resolved),path:resolved,kind:"directory",size:0,mtimeMs:0};}
  async absolutePath(value:string,signal?:AbortSignal):Promise<Result<string,FileError>>{return this.abort<string>(signal)??this.good(this.resolved(value));}
  async joinPath(parts:string[],signal?:AbortSignal):Promise<Result<string,FileError>>{return this.abort<string>(signal)??this.good(path.posix.join(...parts));}
  async readTextFile(value:string,signal?:AbortSignal):Promise<Result<string,FileError>>{const aborted=this.abort<string>(signal);if(aborted)return aborted;return this.resolved(value)===this.file?this.good(this.text):this.bad("not_found","Memory Skill path not found");}
  async readTextLines(value:string,options?:{maxLines?:number;abortSignal?:AbortSignal}):Promise<Result<string[],FileError>>{const result=await this.readTextFile(value,options?.abortSignal);return result.ok?this.good(result.value.split(/\r?\n/u).slice(0,options?.maxLines)):result;}
  async readBinaryFile(value:string,signal?:AbortSignal):Promise<Result<Uint8Array,FileError>>{const result=await this.readTextFile(value,signal);return result.ok?this.good(new TextEncoder().encode(result.value)):result;}
  async fileInfo(value:string,signal?:AbortSignal):Promise<Result<FileInfo,FileError>>{const aborted=this.abort<FileInfo>(signal);if(aborted)return aborted;const info=this.info(value);return info?this.good(info):this.bad("not_found","Memory Skill path not found");}
  async listDir(value:string,signal?:AbortSignal):Promise<Result<FileInfo[],FileError>>{const aborted=this.abort<FileInfo[]>(signal);if(aborted)return aborted;const resolved=this.resolved(value);if(resolved===this.dir)return this.good([this.info(this.file)!]);if(resolved==="/project")return this.good([this.info(VIRTUAL_ROOT)!]);if(resolved===VIRTUAL_ROOT)return this.good([this.info(this.dir)!]);return this.bad("not_directory","Memory Skill path is not a directory");}
  async canonicalPath(value:string,signal?:AbortSignal):Promise<Result<string,FileError>>{const aborted=this.abort<string>(signal);if(aborted)return aborted;const resolved=this.resolved(value);return this.info(resolved)?this.good(resolved):this.bad("not_found","Memory Skill path not found");}
  async exists(value:string,signal?:AbortSignal):Promise<Result<boolean,FileError>>{const aborted=this.abort<boolean>(signal);return aborted??this.good(Boolean(this.info(value)));}
  async writeFile():Promise<Result<void,FileError>>{return this.bad("permission_denied","Memory Skill writes are denied");} async appendFile():Promise<Result<void,FileError>>{return this.bad("permission_denied","Memory Skill writes are denied");} async createDir():Promise<Result<void,FileError>>{return this.bad("permission_denied","Memory Skill writes are denied");} async remove():Promise<Result<void,FileError>>{return this.bad("permission_denied","Memory Skill writes are denied");} async createTempDir():Promise<Result<string,FileError>>{return this.bad("not_supported","Memory Skill temporary storage is denied");} async createTempFile():Promise<Result<string,FileError>>{return this.bad("not_supported","Memory Skill temporary storage is denied");}
  async exec(_command:string,_options?:ShellExecOptions):Promise<Result<{stdout:string;stderr:string;exitCode:number},ExecutionError>>{return{ok:false,error:new ExecutionError("shell_unavailable","Memory Skill shell is denied")};} async cleanup():Promise<void>{}
}
