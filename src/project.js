export function createProject() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    source: null,
    analysis: null,
    regions: [],
    stems: { drums: null, bass: null, lead: null },
    mix: { sourceGain: 1, drumsGain: .8, bassGain: .8, leadGain: .8, masterGain: 1 }
  };
}

export function setSource(project, source) {
  return { ...project, source: { ...source, originalPreserved: true } };
}
