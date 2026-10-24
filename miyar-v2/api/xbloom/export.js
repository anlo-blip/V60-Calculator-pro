/**
 * Miyar private xBloom Studio export experiment.
 * Based on the published request model from MIT-licensed denull0/xbloom-agent.
 * xBloom APIs are unofficial and may change; use only with an account you own.
 * ALL credentials are kept in Vercel's encrypted environment variables.
 * No public exports: requires a private admin key and opt-in flag.
 */
import { publicEncrypt, constants, timingSafeEqual, createHash } from 'node:crypto';

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
  // xBloom Studio grinder size is 1..80; 60..120 is the separate RPM range.
  // Use the recipe's own validated grind size without asking for another number.
  if(!Number.isInteger(recipe.grind)||recipe.grind<1||recipe.grind>80)throw new Error('invalid_grind_size');
  if(grinder!==undefined && grinder!==recipe.grind)throw new Error('grind_mismatch');
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
  // xBloom Studio cloud recipes use brew ratios in steps of 0.5.
  // Each pour is whole ml and the total must be exactly dose * ratio.
  // Reject stale client recipes here: never mutate brew settings silently.
  const ratio=recipe.water/recipe.dose;
  const alignedRatio=Math.round(ratio*2)/2;
  if(!Number.isFinite(ratio)||ratio<10||ratio>22)throw new Error('invalid_brew_ratio');
  if(Math.abs(ratio-alignedRatio)>1e-7||
     Math.abs(recipe.dose*alignedRatio-recipe.water)>1e-7)
    throw new Error('xbloom_pour_total_not_aligned');
  return {pours,ratio:alignedRatio};
}
// Official xBloom share IDs are opaque; base64(tableId) is NOT a valid share ID.
function officialShareUrl(value) {
  if(typeof value!=='string'||value.length>500)return null;
  try {
    const u=new URL(value);
    if(u.protocol!=='https:'||u.hostname!=='share-h5.xbloom.com'||u.pathname!=='/')return null;
    const id=u.searchParams.get('id');
    if(!id||id.length>250||!/^[A-Za-z0-9+/=]+$/.test(id))return null;
    return 'https://share-h5.xbloom.com/?id='+encodeURIComponent(id);
  } catch {return null;}
}
function authForList(creds){
  return {
    interfaceVersion:20240918,skey:'testskey',phoneType:'Android',
    memberId:creds.memberId,clientType:2,languageType:1,token:creds.token,
    pageNumber:1,countPerPage:100,adaptedModel:1
  };
}
async function listOwnRecipes(creds){
  const data=await apiCall('tuMyTeaRecipeCreated.tuhtml',authForList(creds),true);
  return data.result==='success'&&Array.isArray(data.list)?data.list:null;
}
function providerRecipeName(recipe,prepared) {
  const canonical=JSON.stringify({
    name:recipe.name, dose:recipe.dose, ratio:prepared.ratio,
    water:recipe.water, grind:recipe.grind, rpm:recipe.rpm,
    pours:prepared.pours
  });
  const fp=createHash('sha256').update(canonical).digest('hex').slice(0,12);
  return {name:recipe.name.trim().slice(0,78)+' · MYR-'+fp, fingerprint:fp};
}
async function verifyOfficialShare(url,expectedTableId,expectedDose){
  const share=officialShareUrl(url);
  if(!share)return false;
  const id=new URL(share).searchParams.get('id');
  const data=await apiCall('RecipeDetail.html',{
    tableIdOfRSA:id,interfaceVersion:19700101,skey:'testskey'
  });
  const v=data.recipeVo;
  return data.result==='success'&&v&&
    String(v.tableId)===String(expectedTableId)&&
    Math.abs(Number(v.dose)-Number(expectedDose))<=0.05;
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
      const creds={memberId:login.member.tableId,token:login.token};
      const listed=await listOwnRecipes(creds);
      if(!listed)return fail(res,502,'xbloom_list_failed');
      const tests=listed
        .filter(item=>typeof item.theName==='string'&&item.theName.startsWith('MIYAR INTEGRATION TEST'))
        .slice(0,8).map(item=>({
          name:item.theName,dose:item.dose,grindSize:item.grinderSize,
          shareUrl:officialShareUrl(item.shareRecipeLink), // provider-issued, never fabricated
          providerId:String(item.tableId||'')
        }));
      const recentRecipes=listed.slice(0,25).map(item=>({
        name:String(item.theName||'').slice(0,100),
        dose:Number(item.dose)||0,
        ratio:Number(item.grandWater)||0,
        grinderSize:Number(item.grinderSize)||0,
        shareUrl:officialShareUrl(item.shareRecipeLink)
      }));
      return res.status(200).json({status:'listed',testRecipes:tests,recentRecipes});
    }catch(error){
      console.error('miyar_list_error',String(error?.message||error).slice(0,70));
      return fail(res,502,'xbloom_list_transport_error');
    }
  }
  let prepared;
  try {prepared=validate(input.recipe);}
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
    // Check for this exact brew fingerprint BEFORE any write. A previous write
    // may have succeeded even when client-side verification was delayed.
    const labeled=providerRecipeName(recipe,prepared);
    const existingList=await listOwnRecipes({
      memberId:login.member.tableId,token:login.token
    });
    if(!existingList)return fail(res,502,'xbloom_preflight_list_failed');
    const existing=existingList.find(r=>String(r.theName)===labeled.name);
    if(existing){
      const existingUrl=officialShareUrl(existing.shareRecipeLink);
      if(existingUrl){
        const valid=await verifyOfficialShare(existingUrl,existing.tableId,recipe.dose)
          .catch(()=>false);
        return res.status(valid?200:202).json({
          status:valid?'ready':'saved_unverified',shareUrl:existingUrl,
          verified:valid,existing:true,retry:false,
          ...(valid?{}:{error:'share_verification_pending'})
        });
      }
      return res.status(202).json({
        status:'saved_unverified',error:'official_share_link_pending',
        existing:true,verified:false,retry:false
      });
    }
    const payload={
      ...auth,theName:labeled.name,dose:recipe.dose,grandWater:prepared.ratio,
      grinderSize:recipe.grind,rpm:recipe.rpm,
      cupType:2,adaptedModel:1,isEnableBypassWater:2,isSetGrinderSize:1,
      theColor:'#C9D5B8',theSubsetId:0,bypassTemp:85.0,bypassVolume:5.0,
      subSetType:2,appPlace:[4],createTimeStamp:Date.now(),isShortcuts:2,
      pourDataJSONStr:JSON.stringify(prepared.pours)
    };
    // WARNING: this is a write to an unofficial API. Never retry automatically.
    const created=await apiCall('tuRecipeAdd.tuhtml',payload,true);
    if(created.result!=='success'||!created.tableId) {
      // Return non-secret failure classification; do not expose provider credentials.
      const kind=String(created.result||'no_result').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,32);
      const text=[created.msg,created.message,created.errorMsg,created.errorMessage,created.reason,created.info,created.tips]
        .find(v=>typeof v==='string'&&v.trim());
      const safeMessage=typeof text==='string'&&!/token|password|secret|bearer|login credential/i.test(text)
        ?text.slice(0,140):null;
      return res.status(502).json({status:'error',error:'xbloom_create_failed',stage:'save',providerResult:kind,providerMessage:safeMessage});
    }
    // Creation succeeded. Obtain the share link FROM xBloom, never derive it from tableId.
    const targetId=String(created.tableId);
    let shareUrl=officialShareUrl(created.shareRecipeLink);
    for(let attempt=0;attempt<3&&!shareUrl;attempt++){
      if(attempt)await new Promise(resolve=>setTimeout(resolve,500));
      const list=await listOwnRecipes({memberId:login.member.tableId,token:login.token})
        .catch(()=>null);
      const matched=list?.find(item=>String(item.tableId)===targetId);
      if(matched)shareUrl=officialShareUrl(matched.shareRecipeLink);
    }
    if(!shareUrl){
      // A real record might exist; do not retry saving or invent an invalid share link.
      return res.status(202).json({
        status:'saved_unverified',error:'official_share_link_pending',
        recipeId:targetId,verified:false,retry:false
      });
    }
    try{
      if(await verifyOfficialShare(shareUrl,targetId,recipe.dose)){
        return res.status(201).json({status:'ready',shareUrl,verified:true});
      }
    }catch(error){
      console.error('miyar_share_verify_error',String(error?.message||error).slice(0,60));
    }
    return res.status(202).json({
      status:'saved_unverified',shareUrl,verified:false,retry:false,
      error:'share_verification_pending'
    });
  } catch(error) {
    const cause=String(error?.message||error).slice(0,70);
    console.error('miyar_export_error',cause);
    const kind=/^upstream_http_\d{3}$/.test(cause)?cause:
      cause==='upstream_invalid_json'?'upstream_invalid_json':
      cause==='This operation was aborted'?'upstream_timeout':'upstream_error';
    // The save might have succeeded despite a network timeout; never auto-retry.
    return res.status(502).json({status:'error',error:'xbloom_transport_or_api_error',stage:'unknown',cause:kind,possibleDuplicate:true});
  
  }
}
