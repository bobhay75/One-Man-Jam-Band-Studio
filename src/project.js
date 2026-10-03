export function createProject() {
  return {
    version: 5,
    createdAt: new Date().toISOString(),
    source: null,
    analysis: null,
    arrangement: null,
    regions: [],
    stems: { drums: null, bass: null, lead: null },
    mix: { sourceGain: 1, drumsGain: .65, bassGain: .6, leadGain: .45, masterGain: .9 },
    mastering:{preset:"natural",room:.12},
    production:{
      drumStyle:"studio",
      bassStyle:"round",
      leadStyle:"clean",
      timingMs:10,
      velocityJitter:.05,
      swing:.08
    }
  };
}
export function setSource(project, source) {
  return { ...project, source: { ...source, originalPreserved: true }, analysis:null, arrangement:null };
}
