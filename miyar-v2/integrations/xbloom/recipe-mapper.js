// Pure converter for a future *server-side* xBloom export connector.
// No API calls or credentials here. Not a working export by itself.
export function mapMiyarToXbloomAgent(recipe, { verifiedGrinderSize } = {}) {
  if (!recipe || recipe.schema !== 'miyar.recipe.v2') throw new Error('Invalid Miyar schema');
  if (recipe.device !== 'studio' || recipe.dripper !== 'omni') throw new Error('Studio + Omni only');
  if (!Number.isFinite(recipe.dose) || recipe.dose < 5 || recipe.dose > 18) throw new Error('Invalid dose');
  if (!Number.isFinite(recipe.water) || recipe.water <= 0) throw new Error('Invalid water');
  if (!Number.isInteger(recipe.rpm) || recipe.rpm < 60 || recipe.rpm > 120) throw new Error('Invalid RPM');
  if (!Array.isArray(recipe.pours) || recipe.pours.length < 1 || recipe.pours.length > 8) throw new Error('Invalid pours');
  // Miyar 1–80 grind scale does NOT currently have a verified translation to the
  // 40–120 grinder settings in an unofficial xBloom API implementation.
  // Do not guess an offset or convert based on numeric similarity.
  if (!Number.isInteger(verifiedGrinderSize) || verifiedGrinderSize < 40 || verifiedGrinderSize > 120) {
    throw new Error('Calibrate grind setting with xBloom before export');
  }
  const patterns = { center:'centered', circular:'circular', spiral:'spiral' };
  const pours = recipe.pours.map((p,i)=>{
    if (!Number.isInteger(p.ml) || p.ml < 5 || p.ml > 240) throw new Error('Invalid pour volume #'+(i+1));
    if (!Number.isInteger(p.temp) || p.temp < 40 || p.temp > 95) throw new Error('Invalid pour temperature #'+(i+1));
    if (!Number.isFinite(p.flow) || p.flow < 3 || p.flow > 3.5) throw new Error('Invalid pour flow #'+(i+1));
    if (!patterns[p.pattern]) throw new Error('Invalid pour pattern #'+(i+1));
    if (!Number.isInteger(p.pause) || p.pause < 0 || p.pause > 59) throw new Error('Invalid pour pause #'+(i+1));
    return {
      volume_ml:p.ml, temperature_c:p.temp, pattern:patterns[p.pattern],
      flow_rate:p.flow, pause_seconds:p.pause,
      agitate_before:!!p.before, agitate_after:!!p.after
    };
  });
  const total=pours.reduce((n,p)=>n+p.volume_ml,0);
  if (Math.abs(total-recipe.water)>0.01) throw new Error('Pour total does not match water');
  return {
    name:String(recipe.name||'Coffee recipe').slice(0,100),
    dose_g:recipe.dose, ratio:+(total/recipe.dose).toFixed(3),
    grind_size:verifiedGrinderSize, grind_rpm:recipe.rpm, pours
  };
}
