const DEFAULT_PRODUCTION={drumStyle:"studio",bassStyle:"round",leadStyle:"clean",timingMs:10,velocityJitter:.05,swing:.08};
export function serializeProject(project){
  const clean=structuredClone(project);
  if(clean.source)clean.source={...clean.source,localAudioRequired:true};
  return JSON.stringify(clean,null,2);
}
export function deserializeProject(text){
  const p=JSON.parse(text);
  if(!p||typeof p!=="object")throw new Error("Invalid project file");
  if(!Number.isFinite(Number(p.version)))throw new Error("Project version missing");
  p.regions=Array.isArray(p.regions)?p.regions:[];
  p.mix=p.mix||{};
  p.mastering={preset:"natural",room:.12,...(p.mastering||{})};
  p.production={...DEFAULT_PRODUCTION,...(p.production||{})};
  return p;
}
