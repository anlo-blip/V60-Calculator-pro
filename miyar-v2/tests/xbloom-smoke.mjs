/**
 * MIYAR smoke tests: no xBloom account, network, or sensitive variables needed.
 * Run: node tests/xbloom-smoke.mjs (from miyar-v2)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(x=>x.trim());
assert.ok(scripts.length>=2,'Expected engine and frontend');
scripts.forEach(s=>new vm.Script(s));
const context={};
vm.runInNewContext(scripts[0],context);
const engine=context.MiyarEngine;
assert.ok(engine,'Recipe engine missing');
for(let water=120;water<=288;water++){
  for(const variant of ['balanced','aroma']){
    const recipe=engine.makeRecipe({water,name:'Audit Sample',dripper:'omni'},variant);
    assert.equal(engine.validate(recipe).length,0,'Invalid calculated recipe '+water+' '+variant);
    assert.equal(recipe.pours.reduce((sum,p)=>sum+p.ml,0),water);
    assert.ok(recipe.grind>=1&&recipe.grind<=80);
    assert.ok(recipe.rpm>=60&&recipe.rpm<=120);
    assert.ok(recipe.pours.every(p=>p.temp>=40&&p.temp<=95&&p.flow>=3&&p.flow<=3.5));
  }
}
const {default:handler}=await import('../api/xbloom/export.js');
process.env.XBLOOM_UNOFFICIAL_TEST='1';
process.env.MIYAR_EXPORT_TEST_KEY='TEST_ONLY_KEY';
process.env.XBLOOM_LOGIN_EMAIL='fixture@example.invalid';
process.env.XBLOOM_LOGIN_PASSWORD='TEST_ONLY_PASSWORD';
const recipe={
 schema:'miyar.recipe.v2',device:'studio',dripper:'omni',
 name:'Audit Fixture',dose:15.6,water:250,grind:47,rpm:90,
 pours:[
  {ml:45,temp:92,flow:3,pattern:'center',pause:30,before:false,after:true},
  {ml:75,temp:92,flow:3.2,pattern:'spiral',pause:12,before:false,after:false},
  {ml:70,temp:92,flow:3.3,pattern:'circular',pause:10,before:false,after:false},
  {ml:60,temp:91,flow:3.2,pattern:'center',pause:0,before:false,after:false}
 ]
};
const patternIds={center:1,spiral:2,circular:3};
const pours=recipe.pours.map((p,i)=>({
 theName:i===0?'Bloom':'Pour '+(i+1),volume:p.ml,temperature:p.temp,flowRate:p.flow,
 pattern:patternIds[p.pattern],pausing:p.pause,
 isEnableVibrationBefore:p.before?1:2,isEnableVibrationAfter:p.after?1:2
}));
const ratio=Number((recipe.water/recipe.dose).toFixed(4));
const canonical=JSON.stringify({
 name:recipe.name,dose:recipe.dose,ratio,water:recipe.water,
 grind:recipe.grind,rpm:recipe.rpm,pours
});
const digest=createHash('sha256').update(canonical).digest('hex').slice(0,12);
const fullName=recipe.name+' · MYR-'+digest;
const share='https://share-h5.xbloom.com/?id=dDwCkUUHhaRWWsaRC6EYlA%3D%3D';
let saved=false,createCalls=0,reject=false;
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>{
 const path=new URL(url).pathname;
 let response;
 if(path.includes('tMemberLogin'))response={result:'success',member:{tableId:111},token:'mock'};
 else if(path.includes('tuMyTeaRecipeCreated'))response={result:'success',list:saved?[{
  tableId:493084,theName:fullName,dose:recipe.dose,grandWater:ratio,grinderSize:47,shareRecipeLink:share
 }]:[]};
 else if(path.includes('tuRecipeAdd')){createCalls++;if(reject)response={result:'fail',msg:'mock rejection'};else{saved=true;response={result:'success',tableId:493084}}}
 else if(path.includes('RecipeDetail'))response={result:'success',recipeVo:{tableId:493084,dose:recipe.dose,shareRecipeLink:share}};
 else throw new Error('Unexpected mock endpoint '+path);
 return new Response(JSON.stringify(response),{status:200});
};
async function send(body,key='TEST_ONLY_KEY'){
 let statusCode=null,answer=null;
 const res={
  setHeader(){},status(code){statusCode=code;return this;},
  json(data){answer=data;return this;},end(){}
 };
 await handler({
  method:'POST',headers:{origin:'https://miyar-coffee.vercel.app','x-miyar-test-key':key},
  body
 },res);
 return {statusCode,answer};
}
try{
 const first=await send({recipe});
 assert.equal(first.statusCode,201);
 assert.equal(first.answer.status,'ready');
 assert.equal(first.answer.shareUrl,share);
 assert.equal(createCalls,1);
 const second=await send({recipe});
 assert.equal(second.statusCode,200);
 assert.equal(second.answer.existing,true);
 assert.equal(createCalls,1,'Repeat must not create duplicate');
 saved=false;reject=true;
 const denied=await send({recipe});
 assert.equal(denied.statusCode,502);
 assert.equal(denied.answer.providerMessage,'mock rejection');
 const invalid=await send({recipe:{...recipe,grind:81}});
 assert.equal(invalid.statusCode,422);
 const xpod=await send({recipe:{...recipe,dripper:'xpod'}});
 assert.equal(xpod.statusCode,422);
 const noKey=await send({recipe},'wrong-key');
 assert.equal(noKey.statusCode,401);
 assert.equal(createCalls,2,'Invalid recipes must never be written');
 console.log('PASS: 338 recipe variants, frontend syntax, provider save/link, idempotency, failure handling and access control');
}finally{globalThis.fetch=originalFetch;}
