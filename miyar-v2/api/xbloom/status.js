export default function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
  const ready=process.env.XBLOOM_UNOFFICIAL_TEST==='1'
    && Boolean(process.env.XBLOOM_LOGIN_EMAIL)
    && Boolean(process.env.XBLOOM_LOGIN_PASSWORD)
    && Boolean(process.env.MIYAR_EXPORT_TEST_KEY);
  return res.status(200).json({
    service:'miyar-xbloom-private-test',
    configured:ready,xbloomConnected:false,exportEnabled:false,
    requiresPrivateTestKey:true,
    status:ready?'ready_for_private_test':'configuration_required'
  });
}