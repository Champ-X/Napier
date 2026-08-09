const MAX_RESOURCE_COUNT = 8;
const MAX_RESOURCE_BYTES = 256 * 1024;

export interface SkillAccessState {
  markSkillLoaded(name: string): void;
  isSkillLoaded(name: string): boolean;
  acceptResource(key: string, sizeBytes: number): boolean;
}

export function createSkillAccessState(): SkillAccessState {
  const loadedSkills = new Set<string>();
  const resources = new Map<string, number>();
  let aggregateResourceBytes = 0;
  return Object.freeze({
    markSkillLoaded(name: string) {
      loadedSkills.add(name);
    },
    isSkillLoaded(name: string) {
      return loadedSkills.has(name);
    },
    acceptResource(key: string, sizeBytes: number) {
      if (resources.has(key)) return true;
      if (
        resources.size >= MAX_RESOURCE_COUNT ||
        sizeBytes < 1 ||
        aggregateResourceBytes + sizeBytes > MAX_RESOURCE_BYTES
      ) {
        return false;
      }
      resources.set(key, sizeBytes);
      aggregateResourceBytes += sizeBytes;
      return true;
    },
  });
}
