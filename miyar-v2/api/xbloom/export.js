/**
 * Miyar private xBloom Studio export experiment.
 * Based on the published request model from MIT-licensed denull0/xbloom-agent.
 * xBloom APIs are unofficial and may change; use only with an account you own.
 * ALL credentials are kept in Vercel's encrypted environment variables.
 * No public exports: requires a private admin key and opt-in flag.
 */
import { publicEncrypt, constants, timingSafeEqual } from 'node:crypto';

const API = 'https://client-api.xbloom.com';
const SHARE = 'https://share-h5.xbloom.com/';
const ALLOWED = new Set(['https://miyar-coffee.vercel.app','https://anlo-blip.github.io']);
const PEM = '-----BEGIN PUBLIC KEY-----\n' +
  ('MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC4LF40GZ72SdhMyl765K/i4nY5' +
  'CPcHz2Q1IKWKZ9S79xmK7G8pUhbVf4EZLvnNF1+9IvOFQUKV5Z7ZNNviqSpnql9' +
  'tAT+8+J/He0R7pcirvVSxgdr2i9V/C/gmqAEZ5qVTzRnd3uWdFoKzPdEBxP0Ipor' +
  'J1VBbCv90yBSOhVxO+QIDAQAB').match(/.{1,64}/g).join('\n') +
  '\n-----END PUBLIC KEY-----';

function fail(res, code, error) {
  return res.status(code).json({ status:'error', error });
}
function encode(payload) {
  const buffer = Buffer.from(JSON.stringify(payload),'utf8');
  const chunks = [];
  for (let offset=0;offset<buffer.length;offset+=117) {
    chunks.push(publicEncrypt({key:PEM,padding:constants.RSA_PKCS1_PADDING},
      buffer.subarray(offset,offset+117)));
  }
  return Buffer.concat(chunks).toString('base64');
}
async function apiCall(path, data, encrypted=false) {
  const ctrl = new AbortController();
  const timer = setTimeout(()=>ctrl.abort(),12000);
  try {
    const response = await fetch(API + '/' + path, {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Referer':SHARE,
        'User-Agent':'Miyar-Private-Recipe-Integration/0.1'
      },
      body:JSON.stringify(encrypted ? encode(data):data),
      signal:ctrl.signal
    });
    if (!response.ok) throw new Error('upstream_http_' + response.status);
    const result=await response.json();
    if(!result||typeof result!=='object')throw new Error('upstream_invalid_json');
    return result;
  } finally { clearTimeout(timer); }
}
function matchKey(received, expected) {
  if(typeof received!=='string'||!expected||typeof expected!=='string')return false;
  const a=Buffer.from(received);const b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}
function validate(recipe, grinder) {
  if(!recipe||recipe.schema!=='miyar.recipe.v2'||recipe.device!=='studio'||recipe.dripper!=='omni')throw new Error('recipe_not_supported');
  if(typeof recipe.name!=='string'||recipe.name.length<1||recipe.name.length>100)throw new Error('invalid_name');
  if(!Number.isFinite(recipe.dose)||recipe.dose<5||recipe.dose>18)throw new Error('invalid_dose');
  if(!Number.isFinite(recipe.water)||recipe.water<120||recipe.water>288)throw new Error('invalid_total_water');
  if(!Number.isInteger(recipe.rpm)||recipe.rpm<60||recipe.rpm>120)throw new Error('invalid_rpm');
  // Miyar displays 1..80; unofficial API documentation says 40..120.
  // We require a separately verified API grinder setting, never guess a conversion.
  if(!Number.isInteger(grinder)||grinder<40||grinder>120)throw new Error('grinder_calibration_required');
  if(!Array.isArray(recipe.pours)||recipe.pours.length<1||recipe.pours.length>8)throw new Error('invalid_pours');
  const patterns={center:1,spiral:2,circular:3};
  const pours=recipe.pours.map((p,i)=>{
    if(!p||!Number.isInteger(p.ml)||p.ml<5||p.ml>240)throw new Error('invalid_pour_volume_'+i);
    if(!Number.isInteger(p.temp)||p.temp<40||p.temp>95)throw new Error('invalid_pour_temperature_'+i);
    if(!Number.isFinite(p.flow)||p.flow<3||p.flow>3.5)throw new Error('invalid_pour_flow_'+i);
    if(!Object.hasOwn(patterns,p.pattern))throw new Error('invalid_pattern_'+i);
    if(!Number.isInteger(p.pause)||p.pause<0||p.pause>59)throw new Error('invalid_pause_'+i);
    return {
      theName:i===0?'Bloom':'Pour '+(i+1),
      volume:p.ml,temperature:p.temp,flowRate:p.flow,pattern:patterns[p.pattern],
      pausing:p.pause,isEnableVibrationBefore:p.before?1:2,isEnableVibrationAfter:p.after?1:2
    };
  });
  if(Math.abs(pours.reduce((s,p)=>s+p.volume,0)-recipe.water)>0.01)throw new Error('pour_total_mismatch');
  return {pours,ratio:+(recipe.water/recipe.dose).toFixed(4)};
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  const origin=req.headers.origin||'';
  if(ALLOWED.has(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
  res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Miyar-Test-Key');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='POST')return fail(res,405,'method_not_allowed');
  if(origin && !ALLOWED.has(origin))return fail(res,403,'origin_not_allowed');
  if(req.headers['content-length'] && Number(req.headers['content-length'])>16000)return fail(res,413,'payload_too_large');
  if(process.env.XBLOOM_UNOFFICIAL_TEST!=='1')return fail(res,503,'test_mode_not_enabled');
  if(!matchKey(req.headers['x-miyar-test-key'],process.env.MIYAR_EXPORT_TEST_KEY))return fail(res,401,'invalid_test_key');
  const email=process.env.XBLOOM_LOGIN_EMAIL;
  const password=process.env.XBLOOM_LOGIN_PASSWORD;
  if(!email||!password)return fail(res,503,'xbloom_credentials_missing');
  let input;
  try {input=typeof req.body==='string'?JSON.parse(req.body):req.body||{};}
  catch {return fail(res,400,'invalid_json');}
  if(input.action==='inspect_test'){
    try{
      const login=await apiCall('tMemberLogin.thtml',{
        interfaceVersion:20240918,skey:'testskey',clientType:2,
        phoneType:'Android',languageType:1,email,password
      });
      if(login.result!=='success'||!login.member?.tableId||!login.token)
        return fail(res,502,'xbloom_login_failed');
      const auth={
        interfaceVersion:20240918,skey:'testskey',phoneType:'Android',
        memberId:login.member.tableId,clientType:2,languageType:1,token:login.token,
        pageNumber:1,countPerPage:100,adaptedModel:1
      };
      const listed=await apiCall('tuMyTeaRecipeCreated.tuhtml',auth,true);
      if(listed.result!=='success')return fail(res,502,'xbloom_list_failed');
      const tests=(Array.isArray(listed.list)?listed.list:[])
        .filter(item=>typeof item.theName==='string'&&item.theName.startsWith('MIYAR INTEGRATION TEST'))
        .slice(0,8).map(item=>{
          const id=String(item.tableId||'');
          return {name:item.theName,dose:item.dose,grindSize:item.grinderSize,
            shareUrl:id?SHARE+'?id='+encodeURIComponent(Buffer.from(id).toString('base64')):null};
        });
      return res.status(200).json({status:'listed',testRecipes:tests});
    }catch(error){
      console.error('miyar_list_error',String(error?.message||error).slice(0,70));
      return fail(res,502,'xbloom_list_transport_error');
    }
  }
  let prepared;
  try {prepared=validate(input.recipe,input.verifiedGrinderSize);}
  catch(e){return fail(res,422,e.message);}
  try {
    const login=await apiCall('tMemberLogin.thtml',{
      interfaceVersion:20240918,skey:'testskey',clientType:2,
      phoneType:'Android',languageType:1,email,password
    });
    if(login.result!=='success'||!login.member?.tableId||!login.token)return fail(res,502,'xbloom_login_failed');
    const auth={
      interfaceVersion:20240918,skey:'testskey',phoneType:'Android',
      memberId:login.member.tableId,clientType:2,languageType:1,token:login.token
    };
    const recipe=input.recipe;
    const payload={
      ...auth,theName:recipe.name,dose:recipe.dose,grandWater:prepared.ratio,
      grinderSize:input.verifiedGrinderSize,rpm:recipe.rpm,
      cupType:2,adaptedModel:1,isEnableBypassWater:2,isSetGrinderSize:1,
      theColor:'#C9D5B8',theSubsetId:0,bypassTemp:85.0,bypassVolume:5.0,
      subSetType:2,appPlace:[4],createTimeStamp:Date.now(),isShortcuts:2,
      pourDataJSONStr:JSON.stringify(prepared.pours)
    };
    // WARNING: this is a write to an unofficial API. Never retry automatically.
    const created=await apiCall('tuRecipeAdd.tuhtml',payload,true);
    if(created.result!=='success'||!created.tableId)return fail(res,502,'xbloom_create_failed');
    const id=Buffer.from(String(created.tableId)).toString('base64');
    const verified=await apiCall('RecipeDetail.html',{
      tableIdOfRSA:id,interfaceVersion:19700101,skey:'testskey'
    });
    if(verified.result!=='success'||!verified.recipeVo ||
       Math.abs(Number(verified.recipeVo.dose)-recipe.dose)>.05) {
      // Recipe may exist; tell caller not to repeat blindly.
      return res.status(202).json({status:'saved_unverified',error:'share_verification_failed',retry:false});
    }
    const shareUrl=SHARE+'?id='+encodeURIComponent(id);
    return res.status(201).json({status:'ready',shareUrl,verified:true});
  } catch(error) {
    console.error('miyar_export_error',String(error?.message||error).slice(0,70));
    return fail(res,502,'xbloom_transport_or_api_error');
  }
}
